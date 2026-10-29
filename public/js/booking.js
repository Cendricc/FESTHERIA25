const form = document.getElementById('bookingForm');
const btnLanjut = document.getElementById('btnLanjut');
const btnLanjutText = document.getElementById('btnLanjutText');

let selectedKtmFile = null;

function batchLabel(batchNumber) {
  return parseInt(batchNumber, 10) === 4 ? 'OTS' : `Batch ${batchNumber}`;
}

// Jaga-jaga: cek status pendaftaran begitu halaman dibuka
(async function checkRegistrationOpen() {
  try {
    const settings = await fetch('/api/settings').then(r => r.json());
    if (!settings.registration_open) {
      document.querySelector('.ticket').innerHTML = `
        <div class="alert alert-info">Pendaftaran ${batchLabel(settings.current_batch)} sedang ditutup sementara.</div>
        <a class="btn btn-secondary" href="index.html" style="text-decoration:none;">Kembali ke Beranda</a>
      `;
    }
  } catch (err) { /* biarkan form tetap tampil kalau gagal cek, validasi tetap ada di server */ }
})();

const validators = {
  email: (v) => /^\S+@\S+\.\S+$/.test(v) ? null : 'Masukkan alamat email yang valid.',
  nama: (v) => v.trim().length >= 3 ? null : 'Nama wajib diisi (minimal 3 karakter).',
  no_hp: (v) => /^[0-9+\s-]{8,15}$/.test(v) ? null : 'Masukkan nomor telepon yang valid.',
  asal_instansi: (v) => v.trim().length >= 2 ? null : 'Asal instansi wajib diisi.',
  jumlah_tiket: (v) => {
    const n = parseInt(v, 10);
    return (n >= 1 && n <= 10) ? null : 'Jumlah tiket harus antara 1 - 10.';
  }
};

function showFieldError(name, message) {
  const fieldEl = document.getElementById(`f-${name}`);
  fieldEl.classList.add('invalid');
  if (message) fieldEl.querySelector('.error-msg').textContent = message;
}
function clearFieldError(name) {
  document.getElementById(`f-${name}`).classList.remove('invalid');
}

function validateAll(data) {
  let valid = true;
  for (const key of Object.keys(validators)) {
    const errMsg = validators[key](data[key] ?? '');
    if (errMsg) { showFieldError(key, errMsg); valid = false; } else { clearFieldError(key); }
  }
  if (!selectedKtmFile) {
    showFieldError('bukti_ktm', 'Foto KTM wajib diunggah.');
    valid = false;
  } else {
    clearFieldError('bukti_ktm');
  }
  return valid;
}

Object.keys(validators).forEach((name) => {
  const input = form.querySelector(`[name="${name}"]`);
  input.addEventListener('blur', () => {
    const errMsg = validators[name](input.value);
    if (errMsg) showFieldError(name, errMsg); else clearFieldError(name);
  });
});

const ktmInput = form.querySelector('[name="bukti_ktm"]');
const ktmPreviewArea = document.getElementById('ktmPreviewArea');

ktmInput.addEventListener('change', () => {
  const file = ktmInput.files[0];
  clearFieldError('bukti_ktm');

  if (!file) {
    selectedKtmFile = null;
    ktmPreviewArea.innerHTML = '';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showFieldError('bukti_ktm', 'Ukuran file maksimal 5MB.');
    ktmInput.value = '';
    selectedKtmFile = null;
    ktmPreviewArea.innerHTML = '';
    return;
  }
  selectedKtmFile = file;
  const url = URL.createObjectURL(file);
  ktmPreviewArea.innerHTML = `<div class="qr-frame"><img src="${url}" style="max-width:100%;max-height:220px;object-fit:contain;"></div>`;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());

  if (!validateAll(data)) return;

  btnLanjut.disabled = true;
  btnLanjutText.textContent = 'Memproses...';

  try {
    // Dikirim sebagai FormData (multipart), bukan JSON, karena ada file KTM yang ikut diunggah.
    const res = await fetch('/api/booking', { method: 'POST', body: formData });
    const result = await res.json();

    if (!res.ok || !result.success) {
      alert(result.errors ? result.errors.join('\n') : (result.message || 'Terjadi kesalahan, coba lagi.'));
      btnLanjut.disabled = false;
      btnLanjutText.textContent = 'Lanjut ke Pembayaran';
      return;
    }

    if (result.resumed && result.message) alert(result.message);
    window.location.href = `payment.html?order_id=${result.order_id}`;
  } catch (err) {
    alert('Gagal terhubung ke server. Periksa koneksi kamu dan coba lagi.');
    btnLanjut.disabled = false;
    btnLanjutText.textContent = 'Lanjut ke Pembayaran';
  }
});
