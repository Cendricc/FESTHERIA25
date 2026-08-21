const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db/database');
const { getSettings, updateSettings } = require('../services/settingsService');
const { generateTicketsForBooking } = require('../services/qrService');
const { UPLOAD_DIR } = require('../services/storagePaths');

// Bandingkan dua string dengan waktu yang konstan, supaya penyerang tidak bisa menebak
// password admin karakter demi karakter dari selisih waktu respons server.
function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Tetap jalankan pembanding waktu-konstan walau panjangnya beda, supaya tidak ada
    // perbedaan waktu proses yang bisa dipakai menebak panjang password.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Middleware auth sederhana pakai Basic Auth (cukup untuk skala panitia internal).
function requireAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Admin Panitia"');
    return res.status(401).json({ success: false, message: 'Autentikasi diperlukan.' });
  }

  const decoded = Buffer.from(authHeader.split(' ')[1], 'base64').toString('utf8');
  const [username, password] = decoded.split(':');
  const usernameOk = timingSafeStringEqual(username || '', process.env.ADMIN_USERNAME || '');
  const passwordOk = timingSafeStringEqual(password || '', process.env.ADMIN_PASSWORD || '');

  if (!usernameOk || !passwordOk) {
    res.set('WWW-Authenticate', 'Basic realm="Admin Panitia"');
    return res.status(401).json({ success: false, message: 'Username atau password salah.' });
  }

  next();
}

router.use(requireAdminAuth);

// GET /api/admin/bookings - rekap data pemesanan.
// PENTING: status=all / status=active TIDAK PERNAH menyertakan pesanan berstatus "failed" -
// data gagal/ditolak sengaja dipisah dan hanya bisa diambil lewat status=failed secara eksplisit
// (dipakai tab "Data Gagal/Kedaluwarsa" yang terpisah dari rekap utama & tidak ikut ke-export CSV utama).
router.get('/bookings', (req, res) => {
  const { status, batch } = req.query;
  const conditions = [];
  const values = [];

  if (!status || status === 'all' || status === 'active') {
    conditions.push(`status_pembayaran IN ('pending', 'paid')`);
  } else {
    conditions.push('status_pembayaran = ?');
    values.push(status);
  }
  if (batch && batch !== 'all') {
    conditions.push('batch = ?');
    values.push(parseInt(batch, 10));
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const bookings = db.prepare(`SELECT * FROM bookings ${whereClause} ORDER BY created_at DESC`).all(...values);

  const withCheckin = bookings.map((b) => {
    const total = db.prepare('SELECT COUNT(*) AS c FROM tickets WHERE booking_id = ?').get(b.id).c;
    const hadir = db.prepare('SELECT COUNT(*) AS c FROM tickets WHERE booking_id = ? AND checked_in = 1').get(b.id).c;
    return { ...b, tiket_hadir: hadir, tiket_total: total };
  });

  res.json({ success: true, bookings: withCheckin });
});

// GET /api/admin/summary - ringkasan statistik untuk kartu di dashboard admin.
// totalPemesanan/totalPending/totalLunas SENGAJA tidak menghitung pesanan "failed" -
// itu dihitung terpisah (totalGagal) supaya tidak mengotori statistik utama.
router.get('/summary', (req, res) => {
  const totalPemesanan = db.prepare("SELECT COUNT(*) AS c FROM bookings WHERE status_pembayaran IN ('pending','paid')").get().c;
  const totalLunas = db.prepare("SELECT COUNT(*) AS c FROM bookings WHERE status_pembayaran = 'paid'").get().c;
  const totalPending = db.prepare("SELECT COUNT(*) AS c FROM bookings WHERE status_pembayaran = 'pending'").get().c;
  const totalGagal = db.prepare("SELECT COUNT(*) AS c FROM bookings WHERE status_pembayaran = 'failed'").get().c;
  const totalTiketTerjual = db.prepare("SELECT COALESCE(SUM(jumlah_tiket),0) AS c FROM bookings WHERE status_pembayaran = 'paid'").get().c;
  const totalPendapatan = db.prepare("SELECT COALESCE(SUM(total_harga),0) AS c FROM bookings WHERE status_pembayaran = 'paid'").get().c;
  const totalHadir = db.prepare('SELECT COUNT(*) AS c FROM tickets WHERE checked_in = 1').get().c;

  // Rincian jumlah pendaftar per batch (1/2/3/4=OTS) - hanya menghitung yang aktif (pending+paid),
  // dipakai untuk kartu "Pendaftar per Batch" di dashboard supaya panitia bisa pantau real-time.
  const batchBreakdown = [1, 2, 3, 4].map((batchNum) => {
    const row = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status_pembayaran = 'paid' THEN 1 ELSE 0 END) AS lunas,
        SUM(CASE WHEN status_pembayaran = 'pending' THEN 1 ELSE 0 END) AS pending
      FROM bookings WHERE batch = ? AND status_pembayaran IN ('pending','paid')
    `).get(batchNum);
    return { batch: batchNum, total: row.total || 0, lunas: row.lunas || 0, pending: row.pending || 0 };
  });

  res.json({
    success: true,
    summary: { totalPemesanan, totalLunas, totalPending, totalGagal, totalTiketTerjual, totalPendapatan, totalHadir, batchBreakdown }
  });
});

// GET /api/admin/proof/:orderId - lihat gambar bukti pembayaran (hanya bisa diakses admin yang login)
router.get('/proof/:orderId', (req, res) => {
  const booking = db.prepare('SELECT bukti_pembayaran FROM bookings WHERE id = ?').get(req.params.orderId);
  if (!booking || !booking.bukti_pembayaran) {
    return res.status(404).json({ success: false, message: 'Bukti pembayaran tidak ditemukan.' });
  }
  const filePath = path.join(UPLOAD_DIR, booking.bukti_pembayaran);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'File bukti pembayaran tidak ditemukan di server.' });
  }
  res.sendFile(filePath);
});

// POST /api/admin/approve-payment - admin meng-ACC bukti pembayaran, status jadi "paid" + tiket dibuat
router.post('/approve-payment', (req, res) => {
  const { order_id } = req.body;
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(order_id);
  if (!booking) return res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan.' });
  if (booking.status_pembayaran === 'paid') {
    return res.status(400).json({ success: false, message: 'Pemesanan ini sudah lunas.' });
  }

  db.prepare(`
    UPDATE bookings SET status_pembayaran = 'paid', paid_at = datetime('now','localtime')
    WHERE id = ?
  `).run(order_id);

  const tickets = generateTicketsForBooking(order_id, booking.jumlah_tiket);

  res.json({ success: true, message: 'Pembayaran di-ACC, tiket berhasil dibuat.', jumlah_tiket: tickets.length });
});

// POST /api/admin/reject-payment - admin menandai pesanan sebagai gagal/ditolak.
// TIDAK menghapus data (beda dari perilaku lama yang otomatis hapus saat expired) -
// datanya tetap tersimpan di tabel bookings untuk keperluan audit/pemeliharaan server,
// tapi dipisahkan dari rekap utama (tidak muncul di tab Rekap & tidak ikut ke-export CSV utama).
// Email pemesan otomatis "bebas" lagi untuk dipakai pesan ulang, karena pengecekan
// email duplikat hanya melihat status 'paid'/'pending', bukan 'failed'.
router.post('/reject-payment', (req, res) => {
  const { order_id } = req.body;
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(order_id);
  if (!booking) return res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan.' });
  if (booking.status_pembayaran === 'paid') {
    return res.status(400).json({ success: false, message: 'Pemesanan ini sudah lunas, tidak bisa ditandai gagal.' });
  }

  db.prepare(`UPDATE bookings SET status_pembayaran = 'failed' WHERE id = ?`).run(order_id);

  res.json({ success: true, message: 'Pesanan ditandai gagal/kedaluwarsa.' });
});

// POST /api/admin/check-in - validasi tiket saat pemesan datang ke acara (hasil scan QR)
router.post('/check-in', (req, res) => {
  const kodeTiket = (req.body.kode_tiket || '').trim().toUpperCase();
  const ticket = db.prepare('SELECT * FROM tickets WHERE UPPER(kode_tiket) = ?').get(kodeTiket);

  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Kode tiket tidak ditemukan / tidak valid.' });
  }
  if (ticket.checked_in) {
    return res.status(409).json({
      success: false,
      message: `Tiket ini sudah pernah check-in sebelumnya pada ${ticket.checked_in_at}.`
    });
  }

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(ticket.booking_id);
  db.prepare("UPDATE tickets SET checked_in = 1, checked_in_at = datetime('now','localtime') WHERE kode_tiket = ?").run(ticket.kode_tiket);

  res.json({
    success: true,
    message: `Check-in berhasil! (Tiket ${ticket.urutan} dari ${booking.jumlah_tiket})`,
    booking
  });
});

// GET /api/admin/settings - lihat status pendaftaran & batch aktif saat ini
router.get('/settings', (req, res) => {
  const settings = getSettings();
  res.json({ success: true, settings });
});

// POST /api/admin/settings - buka/tutup pendaftaran, ganti batch aktif, dan/atau ubah harga per batch
// Batch 4 = OTS (On The Spot / pendaftaran di tempat saat hari-H)
router.post('/settings', (req, res) => {
  const { registration_open, current_batch, price_batch_1, price_batch_2, price_batch_3, price_batch_4 } = req.body;

  if (current_batch !== undefined && ![1, 2, 3, 4].includes(parseInt(current_batch, 10))) {
    return res.status(400).json({ success: false, message: 'Batch harus 1, 2, 3, atau 4 (OTS).' });
  }

  const priceFields = [
    ['Batch 1', price_batch_1], ['Batch 2', price_batch_2], ['Batch 3', price_batch_3], ['OTS', price_batch_4]
  ];
  for (const [label, val] of priceFields) {
    if (val !== undefined && (isNaN(parseInt(val, 10)) || parseInt(val, 10) < 0)) {
      return res.status(400).json({ success: false, message: `Harga ${label} tidak valid.` });
    }
  }

  const settings = updateSettings({ registration_open, current_batch, price_batch_1, price_batch_2, price_batch_3, price_batch_4 });
  res.json({ success: true, settings });
});

// DELETE /api/admin/bookings/:orderId - hapus PERMANEN satu pesanan (data + tiket + file bukti).
// Beda dari "Tolak" (yang cuma mengubah status jadi failed) - ini benar-benar menghapus baris
// dari database. Dipakai untuk beres-beres data testing/duplikat/kesalahan input dari dashboard,
// tanpa perlu masuk ke terminal server.
router.delete('/bookings/:orderId', (req, res) => {
  const orderId = req.params.orderId;
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(orderId);
  if (!booking) return res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan.' });

  if (booking.bukti_pembayaran) {
    fs.unlink(path.join(UPLOAD_DIR, booking.bukti_pembayaran), () => {});
  }

  db.prepare('DELETE FROM tickets WHERE booking_id = ?').run(orderId);
  db.prepare('DELETE FROM bookings WHERE id = ?').run(orderId);

  res.json({ success: true, message: 'Pesanan berhasil dihapus permanen.' });
});

// POST /api/admin/reset-all-data - hapus SEMUA data pemesanan, tiket, dan file bukti pembayaran.
// Setara dengan "npm run reset-db" tapi lewat dashboard, jadi bisa dipakai kapan saja tanpa
// perlu akses terminal ke server produksi. Pengaturan batch/harga/buka-tutup TIDAK ikut terhapus.
// Wajib kirim confirm persis "HAPUS SEMUA DATA" - pengaman supaya tidak kepencet tidak sengaja.
router.post('/reset-all-data', (req, res) => {
  const { confirm } = req.body;
  if (confirm !== 'HAPUS SEMUA DATA') {
    return res.status(400).json({ success: false, message: 'Konfirmasi tidak cocok. Ketik persis "HAPUS SEMUA DATA".' });
  }

  const allProofs = db.prepare('SELECT bukti_pembayaran FROM bookings WHERE bukti_pembayaran IS NOT NULL').all();
  allProofs.forEach((row) => fs.unlink(path.join(UPLOAD_DIR, row.bukti_pembayaran), () => {}));

  db.exec('DELETE FROM tickets');
  db.exec('DELETE FROM bookings');

  res.json({ success: true, message: 'Semua data pemesanan, tiket, dan bukti pembayaran berhasil dihapus.' });
});

module.exports = router;
