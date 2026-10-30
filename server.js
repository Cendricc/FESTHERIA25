require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const bookingRoutes = require('./routes/booking');
const paymentRoutes = require('./routes/payment');
const adminRoutes = require('./routes/admin');
const { getSettings } = require('./services/settingsService');
const { PRODI_LIST, TINGKAT_LIST } = require('./services/prodiList');

const app = express();
const PORT = process.env.PORT || 3000;

// Kalau di-deploy di belakang reverse proxy (Nginx/Railway/Render), ini diperlukan supaya
// rate limiter & deteksi HTTPS membaca IP/protokol asli pengunjung, bukan punya proxy-nya.
app.set('trust proxy', 1);

// ===== Security headers (helmet) =====
// CSP diatur manual supaya tetap mengizinkan Google Fonts dan library QR scanner (unpkg)
// yang dipakai dashboard admin, sambil tetap memblokir script dari sumber tak dikenal.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://unpkg.com'],
      styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));

// Tidak pakai CORS terbuka sama sekali - frontend & API berjalan di server & origin yang sama,
// jadi tidak ada alasan untuk mengizinkan situs lain memanggil API ini lewat browser.

// ===== Rate limiting =====
// Diatur LONGGAR karena prioritas utama adalah banyak orang bisa akses bersamaan
// (termasuk yang berbagi 1 alamat IP publik yang sama, misal WiFi kampus/NAT kantor -
// dari sudut pandang server, puluhan/ratusan orang berbeda itu bisa terlihat seperti "1 IP").
// Ini bukan berarti tanpa proteksi sama sekali - limitnya cuma dibuat jauh lebih tinggi,
// supaya cuma menahan skrip/bot yang benar-benar ugal-ugalan, bukan pemakaian normal.
//
// Perhatian khusus: halaman "Cek Tiket" (cek-tiket.js) otomatis mengecek status berkali-kali
// tiap beberapa detik selagi menunggu ACC admin - kalau banyak orang melakukan ini bersamaan
// dari jaringan yang sama, itu bisa menghasilkan RIBUAN request dalam 15 menit dari satu
// alamat IP yang sama, padahal itu sepenuhnya pemakaian normal (bukan serangan). Makanya
// lookupLimiter sengaja dibuat jauh lebih tinggi daripada limiter lain.
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10000, standardHeaders: true, legacyHeaders: false });
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Terlalu banyak percobaan pemesanan dari jaringan ini. Coba lagi beberapa menit lagi.' }
});
const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 3000, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Terlalu banyak percobaan pencarian dari jaringan ini. Coba lagi beberapa menit lagi.' }
});
// Catatan: rate limiter khusus dashboard admin (proteksi brute-force password) sekarang
// ditangani di dalam routes/admin.js sendiri (loginAttemptLimiter) - supaya bisa menghitung
// berdasarkan BENAR/SALAH kredensial, bukan berdasarkan kode status HTTP endpoint-nya
// (endpoint seperti check-in itu wajar sering menghasilkan status "gagal" 404/409 sebagai
// bagian dari pemakaian normal, jadi tidak boleh ikut kena limit brute-force login).

app.use('/api/', apiLimiter);

app.use(express.json({ limit: '1mb' }));
// Semua respons API (harga, batch aktif, status pendaftaran, dll) tidak boleh disimpan cache
// browser/proxy, supaya perubahan batch & harga dari admin langsung terlihat oleh semua pengguna.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/booking', bookingLimiter, bookingRoutes);
app.use('/api/payment/lookup', lookupLimiter);
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);

// Expose beberapa config non-sensitif ke frontend (nama event, info rekening & QRIS)
app.get('/api/config', (req, res) => {
  res.json({
    event_name: process.env.EVENT_NAME || 'Nama Event',
    bank_name: process.env.BANK_NAME || '-',
    bank_account_number: process.env.BANK_ACCOUNT_NUMBER || '-',
    bank_account_holder: process.env.BANK_ACCOUNT_HOLDER || '-'
  });
});

// Status pendaftaran (buka/tutup + batch aktif + harga tiket batch itu) - dipakai dashboard & halaman booking.
// Harga tiket TIDAK lagi dari .env - sepenuhnya dikontrol admin lewat dashboard (tab Kontrol Pendaftaran).
app.get('/api/settings', (req, res) => {
  const settings = getSettings();
  res.json({
    registration_open: !!settings.registration_open,
    current_batch: settings.current_batch,
    ticket_price: settings[`price_batch_${settings.current_batch}`]
  });
});

// Daftar prodi & tingkat - dipakai untuk mengisi dropdown di form pemesanan.
// Diambil dari satu sumber yang sama dengan yang dipakai validasi backend, supaya selalu sinkron.
app.get('/api/prodi-list', (req, res) => {
  res.json({ prodi: PRODI_LIST, tingkat: TINGKAT_LIST });
});

app.listen(PORT, () => {
  console.log(`\n🎫  Server berjalan di http://localhost:${PORT}`);
  console.log(`    Mode pembayaran: Transfer Bank / QRIS manual (di-ACC admin)\n`);
});
