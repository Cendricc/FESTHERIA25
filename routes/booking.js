const express = require('express');
const router = express.Router();
const fs = require('fs');
const db = require('../db/database');
const { customAlphabet } = require('nanoid');
const { getSettings } = require('../services/settingsService');
const { createImageUpload, fileSignatureValid } = require('../services/imageUpload');

const nanoidOrder = customAlphabet('0123456789', 8);
const uploadKtm = createImageUpload('ktm');

function validateBookingInput(body) {
  const errors = [];
  const { email, nama, no_hp, asal_instansi, jumlah_tiket } = body;

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) errors.push('Email tidak valid.');
  if (!nama || nama.trim().length < 3) errors.push('Nama wajib diisi minimal 3 karakter.');
  if (!no_hp || !/^[0-9+\s-]{8,15}$/.test(no_hp)) errors.push('Nomor yang dapat dihubungi tidak valid.');
  if (!asal_instansi || asal_instansi.trim().length < 2) errors.push('Asal instansi wajib diisi.');

  const jumlah = parseInt(jumlah_tiket, 10);
  if (!jumlah || jumlah < 1 || jumlah > 10) errors.push('Jumlah tiket harus antara 1 - 10.');

  return { errors, jumlah };
}

// POST /api/booking - beda dari versi internal: WAJIB sekalian upload foto KTM sebagai
// bukti kuat peserta eksternal, jadi request-nya multipart/form-data (bukan JSON biasa).
router.post('/', (req, res) => {
  uploadKtm.single('bukti_ktm')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, errors: [err.message || 'Gagal mengunggah foto KTM.'] });
    }

    const cleanupUploadedFile = () => { if (req.file) fs.unlink(req.file.path, () => {}); };

    try {
      const settings = getSettings();
      if (!settings.registration_open) {
        cleanupUploadedFile();
        const batchLabel = settings.current_batch === 4 ? 'OTS' : `Batch ${settings.current_batch}`;
        return res.status(403).json({
          success: false,
          message: `Pendaftaran sedang ditutup sementara. Pantau terus untuk informasi pembukaan ${batchLabel}.`
        });
      }

      const { errors, jumlah } = validateBookingInput(req.body);

      if (!req.file) {
        errors.push('Foto KTM/kartu identitas wajib diunggah.');
      } else if (!fileSignatureValid(req.file.path, req.file.mimetype)) {
        errors.push('File KTM tidak dikenali sebagai gambar yang valid.');
      }

      if (errors.length > 0) {
        cleanupUploadedFile();
        return res.status(400).json({ success: false, errors });
      }

      const { email, nama, no_hp, asal_instansi } = req.body;
      const emailNormalized = email.trim().toLowerCase();

      const existing = db.prepare(`
        SELECT id, no_hp, status_pembayaran, bukti_pembayaran FROM bookings
        WHERE LOWER(email) = ? AND status_pembayaran IN ('paid', 'pending')
        ORDER BY created_at DESC LIMIT 1
      `).get(emailNormalized);

      if (existing) {
        cleanupUploadedFile(); // KTM yang baru diunggah tidak dipakai; pesanan lama tetap dengan KTM-nya
        const eventName = process.env.EVENT_NAME || 'event ini';
        const normPhone = (v) => String(v || '').replace(/\D/g, '').replace(/^62/, '0');
        const phoneMatch = normPhone(existing.no_hp) === normPhone(no_hp);
        const belumKirimBukti = existing.status_pembayaran === 'pending' && !existing.bukti_pembayaran;

        // Pemesan yang kembali sebelum kirim bukti dilanjutkan ke pesanan yang sama (wajib No HP cocok).
        if (belumKirimBukti && phoneMatch) {
          return res.json({
            success: true,
            resumed: true,
            order_id: existing.id,
            message: 'Kamu sudah punya pesanan yang belum dibayar. Kami lanjutkan ke halaman pembayaran pesananmu sebelumnya.'
          });
        }
        if (belumKirimBukti) {
          return res.status(409).json({
            success: false,
            errors: [`Email sudah terdaftar sebagai peserta ${eventName}. Untuk melanjutkan pesanan yang belum dibayar, isi dengan Nomor HP yang sama seperti saat pendaftaran pertama, atau buka halaman "Cek Tiket".`]
          });
        }
        return res.status(409).json({
          success: false,
          errors: [`Email sudah terdaftar sebagai peserta ${eventName}. Bukti pembayaran sudah diterima / pesanan sudah lunas - cek status dan tiketmu di halaman "Cek Tiket".`]
        });
      }

      const hargaSatuan = settings[`price_batch_${settings.current_batch}`];
      const totalHarga = hargaSatuan * jumlah;
      const orderId = `TIX-${nanoidOrder()}`;

      const stmt = db.prepare(`
        INSERT INTO bookings (id, email, nama, no_hp, asal_instansi, bukti_ktm, jumlah_tiket, harga_satuan, total_harga, batch)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        orderId, email.trim(), nama.trim(), no_hp.trim(), asal_instansi.trim(),
        req.file.filename, jumlah, hargaSatuan, totalHarga, settings.current_batch
      );

      res.json({ success: true, order_id: orderId, total_harga: totalHarga });
    } catch (dbErr) {
      console.error('Gagal membuat booking:', dbErr);
      cleanupUploadedFile();
      res.status(503).json({
        success: false,
        message: 'Server sedang sibuk menerima banyak pesanan sekaligus. Silakan coba tekan tombol lagi dalam beberapa detik.'
      });
    }
  });
});

router.get('/:orderId', (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.orderId);
  if (!booking) return res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan.' });
  res.json({ success: true, booking });
});

module.exports = router;
