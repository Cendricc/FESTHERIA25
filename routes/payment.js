const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const { generateQRCodeDataUrl, getTicketsForBooking } = require('../services/qrService');
const { UPLOAD_DIR } = require('../services/storagePaths');

// Ekstensi file DITENTUKAN SENDIRI oleh server berdasarkan MIME type, bukan diambil dari nama
// file asli yang diupload pengguna - supaya tidak bisa dipakai untuk path traversal
// (mis. nama file jahat berisi "../../../sesuatu").
const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

// Signature byte pertama tiap format gambar, dipakai untuk memverifikasi file BENAR-BENAR
// gambar (bukan cuma mengaku lewat header Content-Type yang gampang dipalsukan client).
const MAGIC_BYTES = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/jpg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/webp': null // dicek khusus (RIFF....WEBP) di bawah
};

function fileSignatureValid(filePath, mimetype) {
  const buffer = Buffer.alloc(12);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, 12, 0);
  fs.closeSync(fd);

  if (mimetype === 'image/webp') {
    return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  }
  const sig = MAGIC_BYTES[mimetype];
  if (!sig) return false;
  return sig.every((byte, i) => buffer[i] === byte);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const orderId = (req.body.order_id || 'unknown').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
    const ext = EXT_BY_MIME[file.mimetype] || '.jpg';
    cb(null, `${orderId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // maksimal 5MB
  fileFilter: (req, file, cb) => {
    if (!EXT_BY_MIME[file.mimetype]) {
      return cb(new Error('Format file harus JPG, PNG, atau WEBP.'));
    }
    cb(null, true);
  }
});

// POST /api/payment/submit-proof - pembeli mengunggah bukti transfer/QRIS.
// Tidak ada lagi batas waktu - pesanan tetap bisa menerima bukti kapan saja selama
// belum lunas dan belum ditandai gagal oleh admin.
router.post('/submit-proof', (req, res) => {
  upload.single('bukti_pembayaran')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'Gagal mengunggah file.' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Bukti pembayaran wajib diunggah.' });
    }

    const cleanupUploadedFile = () => fs.unlink(req.file.path, () => {});

    // Verifikasi isi file benar-benar gambar (bukan cuma header Content-Type yang dipalsukan)
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

    // Hapus file bukti lama kalau sebelumnya sudah pernah upload (mengganti bukti)
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

// POST /api/payment/lookup - pembeli cek status/ambil tiket dengan input Email + Order ID.
// Ini "gerbang" utama supaya orang tidak bisa lihat data/tiket orang lain hanya dengan menebak Order ID.
router.post('/lookup', (req, res) => {
  const orderId = (req.body.order_id || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();

  if (!orderId || !email) {
    return res.status(400).json({ success: false, message: 'Email dan Booking ID wajib diisi.' });
  }

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(orderId);

  // Pesan error sengaja dibuat generik (tidak membedakan "order id salah" vs "email salah")
  // supaya tidak bisa dipakai orang lain untuk menebak-nebak/mengonfirmasi data pemesan.
  if (!booking || booking.email.trim().toLowerCase() !== email) {
    return res.status(404).json({ success: false, message: 'Data tidak ditemukan. Pastikan Email dan Booking ID sudah benar.' });
  }

  if (booking.status_pembayaran === 'paid') {
    return res.json({ success: true, status: 'paid' });
  }
  if (booking.status_pembayaran === 'failed') {
    return res.json({ success: true, status: 'failed' });
  }
  return res.json({ success: true, status: 'pending', ada_bukti: !!booking.bukti_pembayaran });
});

// GET /api/payment/ticket/:orderId?email=... - ambil data tiket + QR (satu per lembar) setelah lunas.
// Wajib menyertakan email pemesan yang cocok - order ID saja tidak cukup untuk melihat tiket orang lain.
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
