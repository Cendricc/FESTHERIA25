const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { customAlphabet } = require('nanoid');
const { getSettings } = require('../services/settingsService');
const { PRODI_LIST, TINGKAT_LIST } = require('../services/prodiList');

const nanoidOrder = customAlphabet('0123456789', 8);

// Validasi sederhana di server (jangan pernah percaya validasi frontend saja).
// Prodi & tingkat divalidasi terhadap daftar resmi supaya tidak ada yang bisa mengirim
// nilai sembarangan lewat panggilan API langsung (di luar dropdown yang disediakan).
function validateBookingInput(body) {
  const errors = [];
  const { email, nama, no_hp, prodi, tingkat, jumlah_tiket } = body;

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) errors.push('Email tidak valid.');
  if (!nama || nama.trim().length < 3) errors.push('Nama wajib diisi minimal 3 karakter.');
  if (!no_hp || !/^[0-9+\s-]{8,15}$/.test(no_hp)) errors.push('Nomor yang dapat dihubungi tidak valid.');
  if (!prodi || !PRODI_LIST.includes(prodi)) errors.push('Prodi wajib dipilih dari daftar yang tersedia.');

  const tingkatNum = parseInt(tingkat, 10);
  if (!TINGKAT_LIST.includes(tingkatNum)) errors.push('Tingkat wajib dipilih (1-4).');

  const jumlah = parseInt(jumlah_tiket, 10);
  if (!jumlah || jumlah < 1 || jumlah > 10) errors.push('Jumlah tiket harus antara 1 - 10.');

  return { errors, jumlah, tingkatNum };
}

// POST /api/booking - membuat pemesanan baru berstatus "pending"
// Catatan: TIDAK ADA lagi batas waktu pembayaran otomatis. Pesanan tetap "pending" sampai
// admin secara manual meng-ACC (jadi "paid") atau menolak/menandai gagal (jadi "failed").
router.post('/', (req, res) => {
  const settings = getSettings();
  if (!settings.registration_open) {
    const batchLabel = settings.current_batch === 4 ? 'OTS' : `Batch ${settings.current_batch}`;
    return res.status(403).json({
      success: false,
      message: `Pendaftaran sedang ditutup sementara. Pantau terus untuk informasi pembukaan ${batchLabel}.`
    });
  }

  const { errors, jumlah, tingkatNum } = validateBookingInput(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ success: false, errors });
  }

  const { email, nama, no_hp, prodi } = req.body;
  const emailNormalized = email.trim().toLowerCase();

  // Tolak email yang masih punya pesanan AKTIF (lunas, atau pending yang belum diputuskan admin).
  // Pesanan berstatus "failed" (ditolak/gagal admin) SENGAJA tidak dihitung di sini -
  // supaya orang yang pesanannya gagal bisa langsung coba pesan lagi pakai email yang sama.
  const existing = db.prepare(`
    SELECT id FROM bookings
    WHERE LOWER(email) = ? AND status_pembayaran IN ('paid', 'pending')
  `).get(emailNormalized);

  if (existing) {
    return res.status(409).json({
      success: false,
      errors: [`Email sudah terdaftar sebagai peserta ${process.env.EVENT_NAME || 'event ini'}.`]
    });
  }

  const hargaSatuan = settings[`price_batch_${settings.current_batch}`];
  const totalHarga = hargaSatuan * jumlah;
  const orderId = `TIX-${nanoidOrder()}`;

  const stmt = db.prepare(`
    INSERT INTO bookings (id, email, nama, no_hp, prodi, tingkat, jumlah_tiket, harga_satuan, total_harga, batch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    orderId,
    email.trim(),
    nama.trim(),
    no_hp.trim(),
    prodi,
    tingkatNum,
    jumlah,
    hargaSatuan,
    totalHarga,
    settings.current_batch
  );

  res.json({ success: true, order_id: orderId, total_harga: totalHarga });
});

// GET /api/booking/:orderId - ambil detail pemesanan (dipakai halaman pembayaran & tiket)
router.get('/:orderId', (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.orderId);
  if (!booking) return res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan.' });
  res.json({ success: true, booking });
});

module.exports = router;
