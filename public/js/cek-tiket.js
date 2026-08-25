const content = document.getElementById('content');
const prefillOrderId = new URLSearchParams(window.location.search).get('order_id') || '';

let pollTimer = null;
let lastLookup = null; // { order_id, email } - dipakai untuk auto-refresh status pending

function formatRupiah(n) { return 'Rp ' + Number(n).toLocaleString('id-ID'); }

function renderForm(errorMsg) {
  clearInterval(pollTimer);
  content.innerHTML = `
    <div class="ticket">
      <h2>Cek Status &amp; Unduh Tiket</h2>
      <p class="lead">Masukkan Email dan Booking ID (Order ID) yang kamu pakai saat memesan.</p>

      ${errorMsg ? `<div class="alert alert-error">${escapeHtml(errorMsg)}</div>` : ''}

      <form id="lookupForm" novalidate>
        <div class="field">
          <label>Email <span class="req">*</span></label>
          <input type="email" id="inputEmail" required>
        </div>
        <div class="field">
          <label>Booking ID / Order ID <span class="req">*</span></label>
          <input type="text" id="inputOrderId" placeholder="TIX-XXXXXXXX" value="${escapeHtml(prefillOrderId)}" required>
        </div>
        <button type="submit" class="btn btn-primary" id="btnCek">Cek Status</button>
      </form>
    </div>
  `;

  document.getElementById('lookupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('inputEmail').value.trim();
    const orderId = document.getElementById('inputOrderId').value.trim();
    if (!email || !orderId) return;

    const btn = document.getElementById('btnCek');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Memeriksa...`;

    await doLookup(orderId, email);
  });
}

async function doLookup(orderId, email) {
  try {
    const res = await fetch('/api/payment/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, email })
    });
    const result = await res.json();

    if (!res.ok || !result.success) {
      renderForm(result.message || 'Data tidak ditemukan.');
      return;
    }

    lastLookup = { order_id: orderId, email };

    if (result.status === 'paid') {
      clearInterval(pollTimer);
      await renderTicket(orderId, email);
    } else if (result.status === 'failed') {
      clearInterval(pollTimer);
      renderRejected();
    } else {
      renderPending(result.ada_bukti);
      // Sambil pembeli membuka halaman ini, cek ulang status tiap beberapa detik -
      // kalau admin meng-ACC saat itu juga, halaman otomatis update ke tampilan tiket.
      clearInterval(pollTimer);
      pollTimer = setInterval(() => doLookup(lastLookup.order_id, lastLookup.email), 8000);
    }
  } catch (err) {
    renderForm('Gagal terhubung ke server. Coba lagi.');
  }
}

function renderPending(adaBukti) {
  content.innerHTML = `
    <div class="ticket" style="text-align:center;">
      <span class="badge badge-pending">Menunggu Verifikasi</span>
      <h2 style="margin-top:14px;">Bukti Pembayaran Kamu Sedang Ditinjau</h2>
      <p class="lead">${adaBukti
        ? 'Panitia akan memeriksa bukti pembayaran kamu secepatnya. Halaman ini otomatis update begitu pembayaran dikonfirmasi.'
        : 'Kami belum menerima bukti pembayaran untuk pesanan ini.'}</p>
      <div class="center-loading"><span class="spinner" style="border-top-color: var(--gold);"></span> Memeriksa status...</div>
    </div>
    <button class="btn btn-secondary" id="btnGantiData" style="margin-bottom:10px;">Cek dengan Data Lain</button>
  `;
  document.getElementById('btnGantiData').addEventListener('click', () => renderForm());
}

function renderRejected() {
  content.innerHTML = `
    <div class="alert alert-error">Pesanan ini ditandai gagal oleh panitia (bukti tidak valid, atau tidak ada progres). Kamu bisa langsung pesan ulang dengan email yang sama.</div>
    <a class="btn btn-primary" href="booking.html" style="text-decoration:none;">Pesan Ulang</a>
  `;
}

function batchLabelPrint(batchNumber) {
  return parseInt(batchNumber, 10) === 4 ? 'OTS' : `Batch ${batchNumber}`;
}

async function renderTicket(orderId, email) {
  content.innerHTML = `<div class="center-loading"><span class="spinner"></span> Memuat tiket...</div>`;

  const [ticketRes, configRes] = await Promise.all([
    fetch(`/api/payment/ticket/${encodeURIComponent(orderId)}?email=${encodeURIComponent(email)}`).then(r => r.json()),
    fetch('/api/config').then(r => r.json()).catch(() => ({ event_name: 'Event' }))
  ]);
  const result = ticketRes;

  if (!result.success) {
    renderForm(result.message || 'Gagal memuat tiket.');
    return;
  }

  const b = result.booking;
  const tickets = result.tickets;

  const ticketCardsHtml = tickets.map((t) => `
    <div class="ticket">
      <div style="text-align:center;">
        <span class="badge badge-paid">${t.checked_in ? 'Sudah Check-in' : 'Lunas'}</span>
        <div style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted);margin-top:8px;">Tiket ${t.urutan} dari ${tickets.length}</div>
      </div>
      <div class="qr-frame"><img src="${t.qr_code}" alt="QR Tiket ${t.urutan}"></div>
      <div class="kode-tiket">${escapeHtml(t.kode_tiket)}</div>
    </div>
  `).join('');

  // Struktur KHUSUS untuk dicetak/disimpan sebagai PDF - beda dari tampilan di layar.
  // Sengaja dipisah supaya bisa diformat pas untuk kertas A4 (lihat @media print di style.css):
  // nama pemesan di pojok kiri atas, QR + kode di tengah, dan SATU HALAMAN untuk SATU TIKET
  // (kalau pesanannya >1 tiket, otomatis jadi beberapa halaman terpisah saat dicetak).
  const printPagesHtml = tickets.map((t) => `
    <div class="print-page">
      <div class="print-header">
        <div>
          <div class="label">Nama Pemesan</div>
          <div class="nama">${escapeHtml(b.nama)}</div>
        </div>
        <div class="event-brand">🌿 ${escapeHtml(configRes.event_name || 'Event')}</div>
      </div>

      <div class="print-qr-block">
        <img src="${t.qr_code}" alt="QR Tiket ${t.urutan}">
        <div class="print-kode">${escapeHtml(t.kode_tiket)}</div>
        <div class="print-urutan">Tiket ${t.urutan} dari ${tickets.length}</div>
      </div>

      <table class="print-info-table">
        <tr><td>Order ID</td><td>${escapeHtml(b.id)}</td></tr>
        <tr><td>Prodi</td><td>${escapeHtml(b.prodi)}</td></tr>
        <tr><td>Tingkat</td><td>${escapeHtml(b.tingkat)}</td></tr>
        <tr><td>Batch</td><td>${escapeHtml(batchLabelPrint(b.batch))}</td></tr>
      </table>

      <div class="print-footer">Tunjukkan kode QR ini saat masuk acara &mdash; satu kode hanya berlaku untuk satu orang.</div>
    </div>
  `).join('');

  content.innerHTML = `
    <div class="alert alert-success">Pembayaran dikonfirmasi! Tunjukkan kode QR ini satu per satu saat masuk acara (1 kode = 1 orang).</div>

    ${ticketCardsHtml}

    <div class="ticket">
      <div class="row"><span class="k">Nama</span><span class="v">${escapeHtml(b.nama)}</span></div>
      <div class="row"><span class="k">Email</span><span class="v">${escapeHtml(b.email)}</span></div>
      <div class="row"><span class="k">Prodi</span><span class="v">${escapeHtml(b.prodi)}</span></div>
      <div class="row"><span class="k">Tingkat</span><span class="v">${escapeHtml(b.tingkat)}</span></div>
      <div class="row"><span class="k">Jumlah tiket</span><span class="v">${escapeHtml(b.jumlah_tiket)}</span></div>
      <div class="row total"><span class="k">Total dibayar</span><span class="v">${formatRupiah(b.total_harga)}</span></div>
    </div>

    <button class="btn btn-secondary" id="btnCetak" style="margin-bottom:10px;">Cetak / Simpan sebagai PDF</button>
    <a class="btn btn-primary" href="index.html" style="text-decoration:none;">Buat Pesanan Baru</a>

    <div id="printArea">${printPagesHtml}</div>
  `;

  document.getElementById('btnCetak').addEventListener('click', () => window.print());
}

// Kalau datang dari halaman pembayaran dengan order_id di URL, langsung tampilkan form
// dengan Order ID sudah terisi - tapi Email tetap harus diketik manual sebagai lapisan keamanan.
renderForm();
