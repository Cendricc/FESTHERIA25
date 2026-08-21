const params = new URLSearchParams(window.location.search);
const orderId = params.get('order_id');
const content = document.getElementById('content');

let selectedFile = null;

function formatRupiah(n) {
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

function renderRejectedScreen() {
  content.innerHTML = `
    <div class="alert alert-error">Pesanan ini ditandai gagal oleh panitia (bukti tidak valid, atau tidak ada progres). Kamu bisa langsung membuat pesanan baru dengan email yang sama.</div>
    <a class="btn btn-primary" href="booking.html" style="text-decoration:none;">Pesan Ulang</a>
  `;
}

async function init() {
  if (!orderId) {
    content.innerHTML = `<div class="alert alert-error">Order ID tidak ditemukan. Silakan mulai pemesanan dari awal.</div>
      <a class="btn btn-secondary" href="booking.html" style="text-decoration:none;">Kembali ke Pemesanan</a>`;
    return;
  }

  const [bookingRes, configRes] = await Promise.all([
    fetch(`/api/booking/${orderId}`).then(r => r.json()),
    fetch('/api/config').then(r => r.json())
  ]);

  if (!bookingRes.success) {
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(bookingRes.message)}</div>`;
    return;
  }

  const booking = bookingRes.booking;

  if (booking.status_pembayaran === 'paid') {
    renderAlreadyPaidScreen(booking);
    return;
  }

  if (booking.status_pembayaran === 'failed') {
    renderRejectedScreen();
    return;
  }

  renderPaymentForm(booking, configRes);
}

function renderAlreadyPaidScreen(booking) {
  content.innerHTML = `
    <div class="alert alert-success">Pesanan ini sudah lunas. Gunakan halaman "Cek Tiket" untuk mengunduh tiketmu.</div>
    <a class="btn btn-primary" href="cek-tiket.html?order_id=${encodeURIComponent(booking.id)}" style="text-decoration:none;">Cek & Unduh Tiket</a>
  `;
}

function renderPaymentForm(booking, config) {
  content.innerHTML = `
    <div class="ticket">
      <h2>Ringkasan Pesanan</h2>
      <div class="row"><span class="k">Order ID</span><span class="v">${escapeHtml(booking.id)}</span></div>
      <div class="row"><span class="k">Nama</span><span class="v">${escapeHtml(booking.nama)}</span></div>
      <div class="row"><span class="k">Jumlah tiket</span><span class="v">${escapeHtml(booking.jumlah_tiket)}</span></div>
      <div class="row total"><span class="k">Total yang Harus Dibayar</span><span class="v">${formatRupiah(booking.total_harga)}</span></div>
    </div>

    <div class="ticket">
      <h2>Transfer ke Rekening Berikut</h2>
      <div class="row"><span class="k">Bank</span><span class="v">${escapeHtml(config.bank_name)}</span></div>
      <div class="row"><span class="k">No. Rekening</span><span class="v" style="font-family:var(--font-mono);font-size:16px;">${escapeHtml(config.bank_account_number)}</span></div>
      <div class="row"><span class="k">Atas Nama</span><span class="v">${escapeHtml(config.bank_account_holder)}</span></div>

      <div class="group-title">Atau Scan QRIS</div>
      <div class="qr-frame">
        <img id="qrisImage" src="images/qris.jpg" alt="QRIS" style="width:240px;height:240px;object-fit:contain;">
      </div>
    </div>

    <div class="ticket">
      <h2>Upload Bukti Pembayaran</h2>
      <p class="lead">Unggah screenshot bukti transfer atau bukti pembayaran QRIS. Wajib diisi sebelum bisa lanjut.</p>

      <div class="field" id="f-bukti">
        <label>Bukti Pembayaran (JPG/PNG/WEBP, maks 5MB) <span class="req">*</span></label>
        <input type="file" id="buktiInput" accept="image/jpeg,image/png,image/webp">
        <div class="error-msg">Bukti pembayaran wajib diunggah sebelum melanjutkan.</div>
      </div>

      <div id="previewArea"></div>

      <button class="btn btn-primary" id="btnLanjutkan" disabled>Lanjutkan</button>
    </div>
  `;

  const qrisImage = document.getElementById('qrisImage');
  qrisImage.addEventListener('error', function onQrisError() {
    qrisImage.removeEventListener('error', onQrisError);
    qrisImage.src = 'images/qris-placeholder.svg';
  });

  const buktiInput = document.getElementById('buktiInput');
  const btnLanjutkan = document.getElementById('btnLanjutkan');
  const previewArea = document.getElementById('previewArea');
  const fieldBukti = document.getElementById('f-bukti');

  buktiInput.addEventListener('change', () => {
    const file = buktiInput.files[0];
    fieldBukti.classList.remove('invalid');

    if (!file) {
      selectedFile = null;
      btnLanjutkan.disabled = true;
      previewArea.innerHTML = '';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      fieldBukti.classList.add('invalid');
      fieldBukti.querySelector('.error-msg').textContent = 'Ukuran file maksimal 5MB.';
      buktiInput.value = '';
      selectedFile = null;
      btnLanjutkan.disabled = true;
      return;
    }

    selectedFile = file;
    btnLanjutkan.disabled = false;
    const url = URL.createObjectURL(file);
    previewArea.innerHTML = `<div class="qr-frame"><img src="${url}" style="max-width:100%;max-height:280px;object-fit:contain;"></div>`;
  });

  btnLanjutkan.addEventListener('click', async () => {
    if (!selectedFile) {
      fieldBukti.classList.add('invalid');
      return;
    }

    btnLanjutkan.disabled = true;
    btnLanjutkan.innerHTML = `<span class="spinner"></span> Mengunggah...`;

    const formData = new FormData();
    formData.append('order_id', booking.id);
    formData.append('bukti_pembayaran', selectedFile);

    try {
      const res = await fetch('/api/payment/submit-proof', { method: 'POST', body: formData });
      const result = await res.json();

      if (!res.ok || !result.success) {
        alert(result.message || 'Gagal mengunggah bukti pembayaran.');
        btnLanjutkan.disabled = false;
        btnLanjutkan.textContent = 'Lanjutkan';
        return;
      }

      renderSuccessScreen(booking);
    } catch (err) {
      alert('Gagal terhubung ke server.');
      btnLanjutkan.disabled = false;
      btnLanjutkan.textContent = 'Lanjutkan';
    }
  });
}

// Setelah bukti berhasil dikirim - TIDAK auto-redirect ke halaman status manapun.
// Pembeli diberi Order ID untuk dicatat, dan diarahkan ke halaman "Cek Tiket" terpisah
// yang mengharuskan input Email + Booking ID (supaya aman diakses kapan saja, dari perangkat manapun,
// tanpa bergantung pada sesi browser yang mungkin tertutup/keluar).
function renderSuccessScreen(booking) {
  content.innerHTML = `
    <div class="ticket" style="text-align:center;">
      <span class="badge badge-pending">Bukti Terkirim</span>
      <h2 style="margin-top:14px;">Bukti Pembayaran Berhasil Dikirim</h2>
      <p class="lead">Panitia akan memeriksa bukti pembayaran kamu secepatnya. Catat Order ID di bawah ini untuk mengecek status atau mengunduh tiket kapan saja.</p>
      <div class="perforation"></div>
      <div class="kode-tiket" style="font-size:18px;">${escapeHtml(booking.id)}</div>
    </div>

    <a class="btn btn-primary" href="cek-tiket.html?order_id=${encodeURIComponent(booking.id)}" style="text-decoration:none;margin-bottom:10px;display:block;text-align:center;">Cek Status / Unduh Tiket</a>
    <a class="btn btn-secondary" href="index.html" style="text-decoration:none;display:block;text-align:center;">Kembali ke Beranda</a>
  `;
}

init();
