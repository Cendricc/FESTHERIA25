let authHeader = sessionStorage.getItem('admin_auth') || null;
let currentFilter = 'active';
let currentBatchFilter = 'all';
let currentSort = 'waktu_desc';
let allBookings = [];
let failedBookings = [];
let refreshTimer = null;

const loginBox = document.getElementById('loginBox');
const dashboard = document.getElementById('dashboard');

function formatRupiah(n) { return 'Rp ' + Number(n).toLocaleString('id-ID'); }
function batchLabel(batchNumber) {
  return parseInt(batchNumber, 10) === 4 ? 'OTS' : `Batch ${batchNumber}`;
}

// Semua pemanggilan API dibungkus try/catch supaya kegagalan JARINGAN (internet putus,
// server belum bangun, dll) bisa dibedakan dari "memang tidak ada data". Kalau fetch gagal
// total, dilempar sebagai Error dengan flag networkError supaya pemanggilnya bisa menampilkan
// pesan yang jelas ("gagal memuat, coba lagi") alih-alih diam-diam menampilkan tabel kosong.
async function apiGet(path) {
  let res;
  try {
    res = await fetch(path, { headers: { Authorization: authHeader } });
  } catch (err) {
    const e = new Error('Gagal terhubung ke server. Cek koneksi internet kamu.');
    e.networkError = true;
    throw e;
  }
  if (res.status === 401) { logout(); throw new Error('unauthorized'); }
  return res.json();
}
async function apiPost(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify(body)
    });
  } catch (err) {
    const e = new Error('Gagal terhubung ke server. Cek koneksi internet kamu.');
    e.networkError = true;
    throw e;
  }
  if (res.status === 401) { logout(); throw new Error('unauthorized'); }
  return res.json();
}
async function apiDelete(path) {
  let res;
  try {
    res = await fetch(path, { method: 'DELETE', headers: { Authorization: authHeader } });
  } catch (err) {
    const e = new Error('Gagal terhubung ke server. Cek koneksi internet kamu.');
    e.networkError = true;
    throw e;
  }
  if (res.status === 401) { logout(); throw new Error('unauthorized'); }
  return res.json();
}

function logout() {
  sessionStorage.removeItem('admin_auth');
  authHeader = null;
  clearInterval(refreshTimer);
  loginBox.style.display = 'block';
  dashboard.style.display = 'none';
}

document.getElementById('btnLogin').addEventListener('click', async () => {
  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  const candidate = 'Basic ' + btoa(`${user}:${pass}`);

  const res = await fetch('/api/admin/summary', { headers: { Authorization: candidate } });
  if (res.status === 401) {
    const errEl = document.getElementById('loginError');
    errEl.textContent = 'Username atau password salah.';
    errEl.style.display = 'block';
    return;
  }

  authHeader = candidate;
  sessionStorage.setItem('admin_auth', candidate);
  loginBox.style.display = 'none';
  dashboard.style.display = 'block';
  initDashboard();
});

(async function tryAutoLogin() {
  if (!authHeader) return;
  const res = await fetch('/api/admin/summary', { headers: { Authorization: authHeader } });
  if (res.ok) {
    loginBox.style.display = 'none';
    dashboard.style.display = 'block';
    initDashboard();
  } else {
    logout();
  }
})();

function initDashboard() {
  loadSummary();
  loadBookings();
  loadSettingsIntoBatchTab();
  setupTabs();
  setupFilters();
  setupScanner();
  setupBatchControls();
  setupModal();
  setupTableActions();
  setupSort();
  setupDangerZone();

  document.getElementById('btnExport').addEventListener('click', exportCsv);
  document.getElementById('btnExportGagal').addEventListener('click', exportCsvGagal);
  document.getElementById('btnManualCheck').addEventListener('click', () => {
    const code = document.getElementById('manualCode').value.trim();
    if (code) handleCheckIn(code);
  });

  // "Realtime" monitoring: refresh data rekap otomatis tiap 15 detik selagi tab yang relevan aktif
  refreshTimer = setInterval(() => {
    const rekapVisible = document.getElementById('tab-rekap').style.display !== 'none';
    const gagalVisible = document.getElementById('tab-gagal').style.display !== 'none';
    if (rekapVisible) { loadSummary(); loadBookings(); }
    if (gagalVisible) { loadFailedBookings(); }
  }, 15000);
}

async function loadSummary() {
  try {
    const result = await apiGet('/api/admin/summary');
    if (!result.success) return;
    const s = result.summary;
    document.getElementById('statGrid').innerHTML = `
      <div class="stat-card"><div class="num">${s.totalPemesanan}</div><div class="label">Total Pemesanan</div></div>
      <div class="stat-card"><div class="num">${s.totalLunas}</div><div class="label">Lunas</div></div>
      <div class="stat-card"><div class="num">${s.totalPending}</div><div class="label">Menunggu Verifikasi</div></div>
      <div class="stat-card"><div class="num">${s.totalTiketTerjual}</div><div class="label">Tiket Terjual</div></div>
      <div class="stat-card"><div class="num">${s.totalHadir}</div><div class="label">Sudah Hadir</div></div>
      <div class="stat-card"><div class="num" style="font-size:18px;">${formatRupiah(s.totalPendapatan)}</div><div class="label">Total Pendapatan</div></div>
      <div class="stat-card"><div class="num" style="color:var(--text-muted);">${s.totalGagal}</div><div class="label">Gagal/Ditolak (lihat tab terpisah)</div></div>
    `;

    document.getElementById('batchBreakdownGrid').innerHTML = s.batchBreakdown.map((b) => `
      <div class="stat-card">
        <div class="num">${b.total}</div>
        <div class="label">${batchLabel(b.batch)} <span style="opacity:0.7;">(${b.lunas} lunas, ${b.pending} pending)</span></div>
      </div>
    `).join('');
  } catch (err) {
    if (err.networkError) {
      document.getElementById('rekapErrorBanner').style.display = 'block';
      document.getElementById('rekapErrorBanner').textContent = err.message;
    }
  }
}

async function loadBookings() {
  const banner = document.getElementById('rekapErrorBanner');
  try {
    const result = await apiGet(`/api/admin/bookings?status=${currentFilter}&batch=${currentBatchFilter}`);
    if (!result.success) return;
    allBookings = result.bookings;
    banner.style.display = 'none';
    renderTable();
  } catch (err) {
    if (err.networkError) {
      banner.style.display = 'block';
      banner.innerHTML = `${escapeHtml(err.message)} <button class="action-btn" id="btnRetryRekap" style="margin-left:8px;">Coba Lagi</button>`;
      document.getElementById('btnRetryRekap').addEventListener('click', () => { loadSummary(); loadBookings(); });
      // Penting: kalau gagal karena jaringan, JANGAN kosongkan allBookings atau render ulang -
      // tabel sengaja dibiarkan menampilkan data terakhir yang berhasil dimuat (kalau ada),
      // supaya tidak terlihat seperti semua data hilang padahal cuma gagal memuat ulang.
    }
  }
}

// Mengurutkan HANYA untuk kebutuhan tampilan - selalu bikin salinan array baru (bukan
// mengubah allBookings aslinya) dan tidak pernah mengubah isi/field data booking itu sendiri.
// Jadi sort di sini murni soal urutan baris ditampilkan, data di database sama sekali tidak tersentuh.
function getSortedBookings() {
  const sorted = [...allBookings];

  const comparators = {
    waktu_desc: (a, b) => new Date(b.created_at) - new Date(a.created_at),
    waktu_asc: (a, b) => new Date(a.created_at) - new Date(b.created_at),
    nama_asc: (a, b) => a.nama.localeCompare(b.nama, 'id'),
    nama_desc: (a, b) => b.nama.localeCompare(a.nama, 'id'),
    prodi_asc: (a, b) => a.prodi.localeCompare(b.prodi, 'id'),
    prodi_desc: (a, b) => b.prodi.localeCompare(a.prodi, 'id'),
    tingkat_asc: (a, b) => a.tingkat - b.tingkat,
    tingkat_desc: (a, b) => b.tingkat - a.tingkat
  };

  sorted.sort(comparators[currentSort] || comparators.waktu_desc);
  return sorted;
}

function renderTable() {
  const tbody = document.getElementById('bookingTbody');
  if (allBookings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;color:var(--text-muted);">Belum ada data.</td></tr>`;
    return;
  }

  const sortedBookings = getSortedBookings();

  // Semua data yang berasal dari input pengguna (nama, email, no_hp, prodi) di-escape dulu
  // sebelum dimasukkan ke innerHTML, supaya tidak bisa dipakai untuk menyisipkan script (XSS).
  tbody.innerHTML = sortedBookings.map((b) => {
    const statusClass = b.status_pembayaran === 'paid' ? 'paid' : b.status_pembayaran === 'pending' ? 'pending' : 'failed';
    const buktiCell = b.bukti_pembayaran
      ? `<button class="action-btn" data-action="view-proof" data-order-id="${escapeHtml(b.id)}">Lihat Bukti</button>`
      : `<span style="color:var(--text-muted);font-size:12px;">Belum ada</span>`;

    let aksiCell = '';
    if (b.status_pembayaran === 'pending') {
      const accDisabled = !b.bukti_pembayaran ? 'disabled title="Belum ada bukti pembayaran"' : '';
      aksiCell += `
        <button class="action-btn" data-action="approve" data-order-id="${escapeHtml(b.id)}" ${accDisabled} style="margin-right:6px;">ACC Pembayaran</button>
        <button class="action-btn" data-action="reject" data-order-id="${escapeHtml(b.id)}" style="margin-right:6px;">Tolak</button>
      `;
    }
    aksiCell += `<button class="action-btn" data-action="delete" data-order-id="${escapeHtml(b.id)}" style="color:var(--red);border-color:var(--red);">Hapus</button>`;

    const checkinCell = b.status_pembayaran === 'paid' ? `${b.tiket_hadir}/${b.tiket_total} hadir` : '-';
    const waktuAccCell = b.paid_at ? escapeHtml(b.paid_at) : '-';

    return `
      <tr>
        <td>${escapeHtml(b.id)}</td>
        <td>${escapeHtml(batchLabel(b.batch))}</td>
        <td>${escapeHtml(b.nama)}</td>
        <td>${escapeHtml(b.email)}</td>
        <td>${escapeHtml(b.no_hp)}</td>
        <td>${escapeHtml(b.prodi)}</td>
        <td>${escapeHtml(b.tingkat)}</td>
        <td>${escapeHtml(b.jumlah_tiket)}</td>
        <td>${formatRupiah(b.total_harga)}</td>
        <td><span class="badge badge-${statusClass}">${escapeHtml(b.status_pembayaran)}</span></td>
        <td>${buktiCell}</td>
        <td>${waktuAccCell}</td>
        <td>${checkinCell}</td>
        <td>${aksiCell}</td>
      </tr>
    `;
  }).join('');
}

function setupSort() {
  document.getElementById('sortSelect').addEventListener('change', (e) => {
    currentSort = e.target.value;
    renderTable();
  });
}

function setupTableActions() {
  document.getElementById('bookingTbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || btn.disabled) return;

    const orderId = btn.dataset.orderId;
    if (btn.dataset.action === 'view-proof') viewProof(orderId);
    else if (btn.dataset.action === 'approve') approvePayment(orderId);
    else if (btn.dataset.action === 'reject') rejectPayment(orderId);
    else if (btn.dataset.action === 'delete') deleteBooking(orderId, false);
  });

  // Tabel di tab "Data Gagal/Kedaluwarsa" cuma punya tombol Lihat Bukti & Hapus (read-only, tidak ada ACC/Tolak)
  document.getElementById('failedTbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'view-proof') viewProof(btn.dataset.orderId);
    else if (btn.dataset.action === 'delete') deleteBooking(btn.dataset.orderId, true);
  });
}

async function deleteBooking(orderId, isFromFailedTab) {
  if (!confirm(`Hapus PERMANEN pesanan ${orderId}? Data ini tidak bisa dikembalikan lagi setelah dihapus.`)) return;
  try {
    const result = await apiDelete(`/api/admin/bookings/${encodeURIComponent(orderId)}`);
    if (result.success) {
      loadSummary();
      if (isFromFailedTab) loadFailedBookings(); else loadBookings();
    } else {
      alert(result.message || 'Gagal menghapus pesanan.');
    }
  } catch (err) {
    alert(err.message || 'Gagal menghapus pesanan.');
  }
}

async function approvePayment(orderId) {
  if (!confirm(`ACC pembayaran untuk pesanan ${orderId}? Tiket QR akan langsung diterbitkan untuk pembeli.`)) return;
  const result = await apiPost('/api/admin/approve-payment', { order_id: orderId });
  if (result.success) { loadSummary(); loadBookings(); }
  else alert(result.message || 'Gagal meng-ACC pembayaran.');
}

async function rejectPayment(orderId) {
  if (!confirm(`Tandai pesanan ${orderId} sebagai GAGAL? Pesanan akan dipindah ke tab "Data Gagal/Kedaluwarsa" dan tidak lagi muncul di rekap utama. Emailnya otomatis bisa dipakai pesan ulang.`)) return;
  const result = await apiPost('/api/admin/reject-payment', { order_id: orderId });
  if (result.success) { loadSummary(); loadBookings(); }
  else alert(result.message || 'Gagal menandai pesanan.');
}

// ===== MODAL LIHAT BUKTI PEMBAYARAN =====
function setupModal() {
  document.getElementById('btnCloseModal').addEventListener('click', closeModal);
  document.getElementById('proofModal').addEventListener('click', (e) => {
    if (e.target.id === 'proofModal') closeModal();
  });
}

function closeModal() {
  document.getElementById('proofModal').style.display = 'none';
  document.getElementById('modalImageArea').innerHTML = '';
}

async function viewProof(orderId) {
  const modal = document.getElementById('proofModal');
  const area = document.getElementById('modalImageArea');
  area.innerHTML = `<div class="center-loading"><span class="spinner"></span> Memuat gambar...</div>`;
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/admin/proof/${encodeURIComponent(orderId)}`, { headers: { Authorization: authHeader } });
    if (!res.ok) {
      area.innerHTML = `<div class="alert alert-error">Gagal memuat bukti pembayaran.</div>`;
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    area.innerHTML = `<img src="${url}" style="max-width:100%;max-height:70vh;border-radius:10px;">`;
  } catch (err) {
    area.innerHTML = `<div class="alert alert-error">Gagal memuat bukti pembayaran.</div>`;
  }
}

function setupFilters() {
  document.getElementById('filterBar').addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    document.querySelectorAll('#filterBar button').forEach((b) => b.classList.remove('active'));
    e.target.classList.add('active');
    currentFilter = e.target.dataset.status;
    loadBookings();
  });

  document.getElementById('batchFilterBar').addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    document.querySelectorAll('#batchFilterBar button').forEach((b) => b.classList.remove('active'));
    e.target.classList.add('active');
    currentBatchFilter = e.target.dataset.batch;
    loadBookings();
  });
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-rekap').style.display = btn.dataset.tab === 'rekap' ? 'block' : 'none';
      document.getElementById('tab-scan').style.display = btn.dataset.tab === 'scan' ? 'block' : 'none';
      document.getElementById('tab-batch').style.display = btn.dataset.tab === 'batch' ? 'block' : 'none';
      document.getElementById('tab-gagal').style.display = btn.dataset.tab === 'gagal' ? 'block' : 'none';
      if (btn.dataset.tab === 'batch') loadSettingsIntoBatchTab();
      if (btn.dataset.tab === 'gagal') loadFailedBookings();
    });
  });
}

function exportCsv() {
  if (allBookings.length === 0) return alert('Tidak ada data untuk diekspor.');
  const headers = ['Order ID', 'Batch', 'Nama', 'Email', 'No HP', 'Prodi', 'Tingkat', 'Jumlah Tiket', 'Total', 'Status', 'Ada Bukti', 'Waktu ACC', 'Check-in', 'Waktu Pesan'];
  const rows = getSortedBookings().map((b) => [
    b.id, batchLabel(b.batch), b.nama, b.email, b.no_hp, b.prodi, b.tingkat, b.jumlah_tiket, b.total_harga,
    b.status_pembayaran, b.bukti_pembayaran ? 'Ya' : 'Tidak', b.paid_at || '-', `${b.tiket_hadir}/${b.tiket_total}`, b.created_at
  ]);
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `rekap-tiket-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

// ===== TAB DATA GAGAL/KEDALUWARSA (terpisah dari rekap utama) =====
async function loadFailedBookings() {
  const banner = document.getElementById('gagalErrorBanner');
  try {
    const result = await apiGet('/api/admin/bookings?status=failed&batch=all');
    if (!result.success) return;
    failedBookings = result.bookings;
    banner.style.display = 'none';
    renderFailedTable();
  } catch (err) {
    if (err.networkError) {
      banner.style.display = 'block';
      banner.innerHTML = `${escapeHtml(err.message)} <button class="action-btn" id="btnRetryGagal" style="margin-left:8px;">Coba Lagi</button>`;
      document.getElementById('btnRetryGagal').addEventListener('click', loadFailedBookings);
    }
  }
}

function renderFailedTable() {
  const tbody = document.getElementById('failedTbody');
  if (failedBookings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:var(--text-muted);">Belum ada data gagal/kedaluwarsa.</td></tr>`;
    return;
  }

  tbody.innerHTML = failedBookings.map((b) => {
    const buktiCell = b.bukti_pembayaran
      ? `<button class="action-btn" data-action="view-proof" data-order-id="${escapeHtml(b.id)}">Lihat Bukti</button>`
      : `<span style="color:var(--text-muted);font-size:12px;">Tidak ada</span>`;

    return `
      <tr>
        <td>${escapeHtml(b.id)}</td>
        <td>${escapeHtml(batchLabel(b.batch))}</td>
        <td>${escapeHtml(b.nama)}</td>
        <td>${escapeHtml(b.email)}</td>
        <td>${escapeHtml(b.no_hp)}</td>
        <td>${escapeHtml(b.prodi)}</td>
        <td>${escapeHtml(b.tingkat)}</td>
        <td>${escapeHtml(b.jumlah_tiket)}</td>
        <td>${formatRupiah(b.total_harga)}</td>
        <td>${buktiCell}</td>
        <td>${escapeHtml(b.created_at)}</td>
        <td><button class="action-btn" data-action="delete" data-order-id="${escapeHtml(b.id)}" style="color:var(--red);border-color:var(--red);">Hapus</button></td>
      </tr>
    `;
  }).join('');
}

function exportCsvGagal() {
  if (failedBookings.length === 0) return alert('Tidak ada data gagal untuk diekspor.');
  const headers = ['Order ID', 'Batch', 'Nama', 'Email', 'No HP', 'Prodi', 'Tingkat', 'Jumlah Tiket', 'Total', 'Ada Bukti', 'Waktu Pesan'];
  const rows = failedBookings.map((b) => [
    b.id, batchLabel(b.batch), b.nama, b.email, b.no_hp, b.prodi, b.tingkat, b.jumlah_tiket, b.total_harga,
    b.bukti_pembayaran ? 'Ya' : 'Tidak', b.created_at
  ]);
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `data-gagal-kedaluwarsa-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

// ===== KONTROL PENDAFTARAN / BATCH =====
async function loadSettingsIntoBatchTab() {
  const result = await apiGet('/api/admin/settings');
  if (!result.success) return;
  const s = result.settings;

  document.getElementById('currentRegStatus').textContent = s.registration_open ? 'Terbuka' : 'Ditutup';
  document.getElementById('currentRegStatus').style.color = s.registration_open ? 'var(--teal)' : 'var(--red)';
  document.getElementById('currentBatchLabel').textContent = batchLabel(s.current_batch);
  document.getElementById('currentPriceLabel').textContent = formatRupiah(s[`price_batch_${s.current_batch}`]);
  document.getElementById('batchSelect').value = s.current_batch;
  document.getElementById('priceBatch1').value = s.price_batch_1;
  document.getElementById('priceBatch2').value = s.price_batch_2;
  document.getElementById('priceBatch3').value = s.price_batch_3;
  document.getElementById('priceBatch4').value = s.price_batch_4;

  const btnToggle = document.getElementById('btnToggleReg');
  if (s.registration_open) {
    btnToggle.textContent = 'Tutup Pendaftaran Sekarang';
    btnToggle.className = 'btn btn-danger-outline';
  } else {
    btnToggle.textContent = 'Buka Pendaftaran Sekarang';
    btnToggle.className = 'btn btn-primary';
  }
}

function setupBatchControls() {
  document.getElementById('btnToggleReg').addEventListener('click', async () => {
    const result = await apiGet('/api/admin/settings');
    const isOpen = result.settings.registration_open;
    const confirmMsg = isOpen
      ? 'Tutup pendaftaran sekarang? Pemesan baru tidak akan bisa memesan tiket sampai dibuka lagi.'
      : 'Buka pendaftaran sekarang?';
    if (!confirm(confirmMsg)) return;

    const updated = await apiPost('/api/admin/settings', { registration_open: !isOpen });
    if (updated.success) loadSettingsIntoBatchTab();
  });

  document.getElementById('btnSaveBatch').addEventListener('click', async () => {
    const batch = parseInt(document.getElementById('batchSelect').value, 10);
    if (!confirm(`Set ${batchLabel(batch)} sebagai batch aktif?`)) return;

    const updated = await apiPost('/api/admin/settings', { current_batch: batch });
    if (updated.success) loadSettingsIntoBatchTab();
  });

  document.getElementById('btnSavePrices').addEventListener('click', async () => {
    const p1 = document.getElementById('priceBatch1').value;
    const p2 = document.getElementById('priceBatch2').value;
    const p3 = document.getElementById('priceBatch3').value;
    const p4 = document.getElementById('priceBatch4').value;

    if (p1 === '' || p2 === '' || p3 === '' || p4 === '') {
      alert('Semua harga (termasuk OTS) wajib diisi.');
      return;
    }
    if (!confirm(`Simpan harga baru?\nBatch 1: ${formatRupiah(p1)}\nBatch 2: ${formatRupiah(p2)}\nBatch 3: ${formatRupiah(p3)}\nOTS: ${formatRupiah(p4)}\n\nCatatan: pesanan yang sudah ada tidak ikut berubah.`)) return;

    const updated = await apiPost('/api/admin/settings', { price_batch_1: p1, price_batch_2: p2, price_batch_3: p3, price_batch_4: p4 });
    if (updated.success) loadSettingsIntoBatchTab();
    else alert(updated.message || 'Gagal menyimpan harga.');
  });
}

// ===== ZONA BERBAHAYA: hapus semua data =====
function setupDangerZone() {
  const input = document.getElementById('resetConfirmInput');
  const btn = document.getElementById('btnResetAll');

  input.addEventListener('input', () => {
    btn.disabled = input.value !== 'HAPUS SEMUA DATA';
  });

  btn.addEventListener('click', async () => {
    if (!confirm('BENAR-BENAR YAKIN? Semua data pemesanan, tiket, dan bukti pembayaran akan hilang PERMANEN dan tidak bisa dikembalikan.')) return;

    btn.disabled = true;
    btn.textContent = 'Menghapus...';

    try {
      const result = await apiPost('/api/admin/reset-all-data', { confirm: input.value });
      if (result.success) {
        alert('Semua data berhasil dihapus.');
        input.value = '';
        loadSummary(); loadBookings(); loadFailedBookings();
      } else {
        alert(result.message || 'Gagal menghapus data.');
      }
    } catch (err) {
      alert(err.message || 'Gagal menghapus data.');
    }
    btn.textContent = 'Hapus Semua Data Pemesanan';
    btn.disabled = input.value !== 'HAPUS SEMUA DATA';
  });
}

// ===== QR SCANNER =====
let scannerStarted = false;
let html5QrCodeInstance = null;

function setupScanner() {
  document.querySelector('[data-tab="scan"]').addEventListener('click', () => {
    if (scannerStarted) return;
    scannerStarted = true;
    startCameraScanner();
  });
}

async function startCameraScanner() {
  const readerEl = document.getElementById('reader');

  try {
    // Minta daftar kamera SUNGGUHAN yang tersedia di device ini (ini juga yang memicu
    // permintaan izin kamera). Ini lebih diandalkan daripada cuma minta facingMode
    // "environment" (kamera belakang) - di laptop biasanya cuma ada 1 kamera depan,
    // dan meminta facingMode yang tidak ada bisa bikin video jalan tapi framenya
    // tidak pernah benar-benar diproses untuk di-scan.
    const cameras = await Html5Qrcode.getCameras();
    if (!cameras || cameras.length === 0) {
      throw new Error('Tidak ada kamera terdeteksi.');
    }

    if (cameras.length > 1) {
      renderCameraPicker(cameras);
    }

    // Kalau ada beberapa kamera dan salah satu labelnya kelihatan seperti kamera
    // belakang (biasanya di HP), pakai itu. Kalau tidak ada (laptop, cuma 1 kamera),
    // pakai kamera pertama yang tersedia.
    const preferred = cameras.find((c) => /back|belakang|rear|environment/i.test(c.label || '')) || cameras[0];
    await startWithCameraId(preferred.id);
  } catch (err) {
    readerEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Kamera tidak tersedia / izin ditolak. Gunakan input manual di bawah.</p>';
  }
}

async function startWithCameraId(cameraId) {
  const readerEl = document.getElementById('reader');

  if (html5QrCodeInstance) {
    try { await html5QrCodeInstance.stop(); } catch (e) { /* abaikan kalau memang belum jalan */ }
  }

  readerEl.innerHTML = '';
  html5QrCodeInstance = new Html5Qrcode('reader', {
    formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], // fokus cuma ke QR code, lebih cepat & stabil
    verbose: false
  });

  await html5QrCodeInstance.start(
    cameraId,
    { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
    (decodedText) => handleCheckIn(decodedText),
    () => { /* dipanggil terus-menerus tiap frame yang belum ketemu QR - ini normal, bukan error */ }
  );
}

function renderCameraPicker(cameras) {
  if (document.getElementById('cameraSelect')) return; // jangan dobel kalau sudah ada
  const picker = document.createElement('select');
  picker.id = 'cameraSelect';
  picker.style.cssText = 'display:block;width:100%;max-width:400px;margin:0 auto 10px;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-alt);color:var(--text);';
  picker.innerHTML = cameras.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label || 'Kamera')}</option>`).join('');
  picker.addEventListener('change', () => startWithCameraId(picker.value));
  document.getElementById('reader').insertAdjacentElement('beforebegin', picker);
}

async function handleCheckIn(kodeTiket) {
  const result = await apiPost('/api/admin/check-in', { kode_tiket: kodeTiket });
  const el = document.getElementById('scanResult');
  el.classList.add('show');

  if (result.success) {
    el.className = 'scan-result show alert-success';
    el.textContent = `✅ ${result.message} — ${result.booking.nama}`;
    loadSummary(); loadBookings();
  } else {
    el.className = 'scan-result show alert-error';
    el.textContent = `❌ ${result.message}`;
  }
  document.getElementById('manualCode').value = '';
}
