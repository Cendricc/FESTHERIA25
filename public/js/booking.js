const form = document.getElementById('bookingForm');
const btnLanjut = document.getElementById('btnLanjut');
const btnLanjutText = document.getElementById('btnLanjutText');

function batchLabel(batchNumber) {
  return parseInt(batchNumber, 10) === 4 ? 'OTS' : `Batch ${batchNumber}`;
}

// Jaga-jaga: cek status pendaftaran begitu halaman dibuka, kalau ternyata sudah
// ditutup panitia sementara user masih di halaman ini, langsung diberi tahu.
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

// Isi dropdown Prodi & Tingkat dari sumber data yang sama dengan validasi backend,
// supaya daftar di form selalu sinkron dengan yang diterima server.
(async function loadProdiTingkatOptions() {
  const selectProdi = form.querySelector('[name="prodi"]');
  const selectTingkat = form.querySelector('[name="tingkat"]');

  try {
    const data = await fetch('/api/prodi-list').then(r => r.json());

    selectProdi.innerHTML = '<option value="">Pilih prodi</option>' +
      data.prodi.map((p) => `<option value="${p}">${p}</option>`).join('');

    selectTingkat.innerHTML = '<option value="">Pilih tingkat</option>' +
      data.tingkat.map((t) => `<option value="${t}">Tingkat ${t}</option>`).join('');
  } catch (err) {
    selectProdi.innerHTML = '<option value="">Gagal memuat daftar prodi, muat ulang halaman</option>';
  }
})();

const validators = {
  email: (v) => /^\S+@\S+\.\S+$/.test(v) ? null : 'Masukkan alamat email yang valid.',
  nama: (v) => v.trim().length >= 3 ? null : 'Nama wajib diisi (minimal 3 karakter).',
  no_hp: (v) => /^[0-9+\s-]{8,15}$/.test(v) ? null : 'Masukkan nomor telepon yang valid.',
  prodi: (v) => v ? null : 'Prodi wajib dipilih.',
  tingkat: (v) => v ? null : 'Tingkat wajib dipilih.',
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
    if (errMsg) {
      showFieldError(key, errMsg);
      valid = false;
    } else {
      clearFieldError(key);
    }
  }
  return valid;
}

// Validasi real-time - pakai event "change" untuk dropdown, "blur" untuk input teks biasa
Object.keys(validators).forEach((name) => {
  const input = form.querySelector(`[name="${name}"]`);
  const eventName = input.tagName === 'SELECT' ? 'change' : 'blur';
  input.addEventListener(eventName, () => {
    const errMsg = validators[name](input.value);
    if (errMsg) showFieldError(name, errMsg); else clearFieldError(name);
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());

  if (!validateAll(data)) return;

  btnLanjut.disabled = true;
  btnLanjutText.textContent = 'Memproses...';

  try {
    const res = await fetch('/api/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();

    if (!res.ok || !result.success) {
      alert(result.errors ? result.errors.join('\n') : 'Terjadi kesalahan, coba lagi.');
      btnLanjut.disabled = false;
      btnLanjutText.textContent = 'Lanjut ke Pembayaran';
      return;
    }

    window.location.href = `payment.html?order_id=${result.order_id}`;
  } catch (err) {
    alert('Gagal terhubung ke server. Periksa koneksi kamu dan coba lagi.');
    btnLanjut.disabled = false;
    btnLanjutText.textContent = 'Lanjut ke Pembayaran';
  }
});
