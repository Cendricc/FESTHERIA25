const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const { generateQRCodeDataUrl, getTicketsForBooking } = require('../services/qrService');
const { UPLOAD_DIR } = require('../services/storagePaths');
const { createImageUpload, fileSignatureValid } = require('../services/imageUpload');

const uploadBukti = createImageUpload('bukti');

router.post('/submit-proof', (req, res) => {
  uploadBukti.single('bukti_pembayaran')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'Gagal mengunggah file.' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Bukti pembayaran wajib diunggah.' });
    }

    const cleanupUploadedFile = () => fs.unlink(req.file.path, () => {});

    if (!fileSignatureValid(req.file.path, req.file.mimetype)) {
      cleanupUploadedFile();
      return res.status(400).json({ success: false, message: 'File tidak dikenali sebagai gambar yang valid.' });
    }

    const { order_id } = req.body;
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(order_id);

    if (!booking) {
      cleanupUploadedFile();
      return res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan.' });
    }
    if (booking.status_pembayaran === 'paid') {
      cleanupUploadedFile();
      return res.status(400).json({ success: false, message: 'Pemesanan ini sudah dibayar.' });
    }
    if (booking.status_pembayaran === 'failed') {
      cleanupUploadedFile();
      return res.status(400).json({ success: false, message: 'Pemesanan ini sudah ditandai gagal oleh panitia. Silakan buat pesanan baru.' });
    }

    if (booking.bukti_pembayaran) {
      fs.unlink(path.join(UPLOAD_DIR, booking.bukti_pembayaran), () => {});
    }

    db.prepare(`
      UPDATE bookings SET bukti_pembayaran = ?, metode_pembayaran = 'manual'
      WHERE id = ?
    `).run(req.file.filename, order_id);

    res.json({ success: true, message: 'Bukti pembayaran berhasil dikirim. Menunggu verifikasi panitia.' });
  });
});

// Pembatas percobaan GAGAL per email (di memori): mencegah orang menebak No HP / Booking ID
// untuk satu email. Percobaan benar tidak dihitung. 10 gagal / 15 menit per email.
const failedLookups = new Map(); // email -> { count, resetAt }
const MAX_FAILED = 10;
const WINDOW_MS = 15 * 60 * 1000;

function isBlocked(email) {
  const rec = failedLookups.get(email);
  if (!rec) return false;
  if (Date.now() > rec.resetAt) { failedLookups.delete(email); return false; }
  return rec.count >= MAX_FAILED;
}
function recordFailure(email) {
  const rec = failedLookups.get(email);
  if (!rec || Date.now() > rec.resetAt) failedLookups.set(email, { count: 1, resetAt: Date.now() + WINDOW_MS });
  else rec.count += 1;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of failedLookups) if (now > v.resetAt) failedLookups.delete(k);
}, WINDOW_MS).unref();

// Samakan format nomor: "+62812-345" dan "0812345" dianggap sama.
function normPhone(v) {
  return String(v || '').replace(/\D/g, '').replace(/^62/, '0');
}

// POST /api/payment/lookup - pembeli cek status/ambil tiket dengan Email + No HP
// (Booking ID juga masih bisa dipakai sebagai pengganti No HP).
router.post('/lookup', (req, res) => {
  const orderId = (req.body.order_id || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const noHp = normPhone(req.body.no_hp);

  if (!email || (!noHp && !orderId)) {
    return res.status(400).json({ success: false, message: 'Email dan Nomor HP wajib diisi.' });
  }
  if (isBlocked(email)) {
    return res.status(429).json({ success: false, message: 'Terlalu banyak percobaan gagal untuk email ini. Coba lagi dalam 15 menit.' });
  }

  let booking = null;
  if (orderId) {
    const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(orderId);
    if (b && b.email.trim().toLowerCase() === email) booking = b;
  } else {
    // Prioritas: pesanan aktif (paid/pending) dulu, baru yang gagal terbaru.
    const rows = db.prepare(`
      SELECT * FROM bookings WHERE LOWER(TRIM(email)) = ?
      ORDER BY CASE status_pembayaran WHEN 'paid' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, created_at DESC
    `).all(email);
    booking = rows.find((r) => normPhone(r.no_hp) === noHp) || null;
  }

  // Pesan error sengaja generik (tidak membedakan email salah / HP salah) supaya tidak bisa
  // dipakai menebak data pemesan lain.
  if (!booking) {
    recordFailure(email);
    return res.status(404).json({ success: false, message: 'Data tidak ditemukan. Pastikan Email dan Nomor HP sama seperti saat mendaftar.' });
  }

  if (booking.status_pembayaran === 'paid') {
    return res.json({ success: true, status: 'paid', order_id: booking.id });
  }
  if (booking.status_pembayaran === 'failed') {
    return res.json({ success: true, status: 'failed', order_id: booking.id });
  }
  return res.json({ success: true, status: 'pending', order_id: booking.id, ada_bukti: !!booking.bukti_pembayaran });
});

router.get('/ticket/:orderId', async (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase();
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.orderId);

  if (!booking || !email || booking.email.trim().toLowerCase() !== email) {
    return res.status(404).json({ success: false, message: 'Data tidak ditemukan. Pastikan Email dan Booking ID sudah benar.' });
  }
  if (booking.status_pembayaran !== 'paid') {
    return res.status(400).json({ success: false, message: 'Pembayaran belum dikonfirmasi oleh panitia.' });
  }

  const ticketRows = getTicketsForBooking(booking.id);
  const tickets = await Promise.all(ticketRows.map(async (t) => ({
    kode_tiket: t.kode_tiket,
    urutan: t.urutan,
    checked_in: !!t.checked_in,
    qr_code: await generateQRCodeDataUrl(t.kode_tiket)
  })));

  res.json({ success: true, booking, tickets });
});

module.exports = router;
