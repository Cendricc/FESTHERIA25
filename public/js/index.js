function batchLabel(batchNumber) {
  return parseInt(batchNumber, 10) === 4 ? 'OTS (On The Spot)' : `Batch ${batchNumber}`;
}

async function loadEvent() {
  const statusArea = document.getElementById('statusArea');
  try {
    const [config, settings] = await Promise.all([
      fetch('/api/config').then(r => r.json()),
      fetch('/api/settings').then(r => r.json())
    ]);

    document.getElementById('eventName').textContent = config.event_name;
    document.getElementById('eventPrice').textContent = 'Rp ' + settings.ticket_price.toLocaleString('id-ID');
    document.getElementById('batchInfo').textContent = batchLabel(settings.current_batch);

    if (settings.registration_open) {
      statusArea.innerHTML = `<button class="btn btn-primary" id="btnPesan">Pesan Sekarang</button>`;
      document.getElementById('btnPesan').addEventListener('click', () => {
        window.location.href = 'booking.html';
      });
    } else {
      statusArea.innerHTML = `
        <div class="alert alert-info">Pendaftaran ${batchLabel(settings.current_batch)} sedang <strong>ditutup sementara</strong>. Pantau terus untuk informasi pembukaan berikutnya.</div>
        <button class="btn btn-secondary" disabled>Pendaftaran Ditutup</button>
      `;
    }
  } catch (err) {
    document.getElementById('eventName').textContent = 'Gagal memuat data event';
  }
}
loadEvent();
