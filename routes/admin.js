const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
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

// Cek username+password BENAR atau tidak, dipisah dari middleware auth supaya bisa dipakai
// juga oleh rate limiter di bawah (lihat catatan di loginAttemptLimiter).
function hasValidAdminCredentials(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) return false;

  const decoded = Buffer.from(authHeader.split(' ')[1], 'base64').toString('utf8');
  const [username, password] = decoded.split(':');
  const usernameOk = timingSafeStringEqual(username || '', process.env.ADMIN_USERNAME || '');
  const passwordOk = timingSafeStringEqual(password || '', process.env.ADMIN_PASSWORD || '');
  return usernameOk && passwordOk;
}

// Rate limiter KHUSUS untuk cegah tebak-tebakan password admin berkali-kali.
// PENTING: cara kerjanya beda dari limiter lain - ini menghitung berdasarkan BENAR/SALAH
// kredensialnya, BUKAN berdasarkan kode status HTTP yang dihasilkan endpoint-nya.
// Kenapa ini penting: endpoint seperti check-in/approve-payment itu WAJAR menghasilkan
// status "gagal" (404 tiket tidak ketemu, 409 sudah pernah check-in, dst) sebagai bagian
// dari pemakaian normal sehari-hari (misal banyak orang di pintu masuk scan tiket yang
// sama dua kali) - itu BUKAN tanda ada yang coba membobol sistem, jadi tidak boleh ikut
// mengurangi jatah limit. Yang bener-bener mau dicegah cuma nebak password berkali-kali.
const loginAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => hasValidAdminCredentials(req), // kredensial benar -> tidak dihitung sama sekali, apapun hasil endpoint-nya nanti
  message: { success: false, message: 'Terlalu banyak percobaan login gagal. Coba lagi beberapa menit lagi.' }
});
router.use(loginAttemptLimiter);

// Middleware auth sederhana pakai Basic Auth (cukup untuk skala panitia internal).
function requireAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Admin Panitia"');
    return res.status(401).json({ success: false, message: 'Autentikasi diperlukan.' });
  }

  if (!hasValidAdminCredentials(req)) {
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
// Pesanan BARU MASUK ke dashboard admin setelah pemesan mengunggah bukti pembayaran
// (pesanan yang masih di halaman pembayaran / belum kirim bukti disembunyikan).
const VISIBLE_SQL = `(bukti_pembayaran IS NOT NULL OR status_pembayaran = 'paid')`;

router.get('/bookings', (req, res) => {
  const { status, batch } = req.query;
  const conditions = [VISIBLE_SQL];
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
  const V = VISIBLE_SQL;
  const one = (sql) => db.prepare(sql).get().c;
  const totalPemesanan = one(`SELECT COUNT(*) AS c FROM bookings WHERE ${V} AND status_pembayaran IN ('pending','paid')`);
  const totalLunas = one(`SELECT COUNT(*) AS c FROM bookings WHERE ${V} AND status_pembayaran = 'paid'`);
  const totalPending = one(`SELECT COUNT(*) AS c FROM bookings WHERE ${V} AND status_pembayaran = 'pending'`);
  const totalGagal = one(`SELECT COUNT(*) AS c FROM bookings WHERE ${V} AND status_pembayaran = 'failed'`);
  // Tiket terjual = semua tiket dari pesanan yang sudah masuk dashboard (bukti terkirim), tanpa
  // menunggu ACC. totalTiketLunas = bagian yang sudah di-ACC.
  const totalTiketTerjual = one(`SELECT COALESCE(SUM(jumlah_tiket),0) AS c FROM bookings WHERE ${V} AND status_pembayaran IN ('pending','paid')`);
  const totalTiketLunas = one(`SELECT COALESCE(SUM(jumlah_tiket),0) AS c FROM bookings WHERE status_pembayaran = 'paid'`);
  const totalPendapatan = one(`SELECT COALESCE(SUM(total_harga),0) AS c FROM bookings WHERE status_pembayaran = 'paid'`);
  const totalHadir = one('SELECT COUNT(*) AS c FROM tickets WHERE checked_in = 1');

  // Rincian per batch (1/2/3/4=OTS): jumlah pemesan DAN jumlah tiket (pending+paid, bukti sudah terkirim).
  const batchBreakdown = [1, 2, 3, 4].map((batchNum) => {
    const row = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status_pembayaran = 'paid' THEN 1 ELSE 0 END) AS lunas,
        SUM(CASE WHEN status_pembayaran = 'pending' THEN 1 ELSE 0 END) AS pending,
        COALESCE(SUM(jumlah_tiket), 0) AS tiket,
        COALESCE(SUM(CASE WHEN status_pembayaran = 'paid' THEN jumlah_tiket ELSE 0 END), 0) AS tiket_lunas,
        COALESCE(SUM(CASE WHEN status_pembayaran = 'pending' THEN jumlah_tiket ELSE 0 END), 0) AS tiket_pending
      FROM bookings WHERE batch = ? AND ${V} AND status_pembayaran IN ('pending','paid')
    `).get(batchNum);
    return {
      batch: batchNum, total: row.total || 0, lunas: row.lunas || 0, pending: row.pending || 0,
      tiket: row.tiket || 0, tiket_lunas: row.tiket_lunas || 0, tiket_pending: row.tiket_pending || 0
    };
  });

  res.json({
    success: true,
    summary: { totalPemesanan, totalLunas, totalPending, totalGagal, totalTiketTerjual, totalTiketLunas, totalPendapatan, totalHadir, batchBreakdown }
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
  try {
    const { order_id } = req.body;
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(order_id);
    if (!booking) return res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan.' });
    if (booking.status_pembayaran === 'paid') {
      return res.status(400).json({ success: false, message: 'Pemesanan ini sudah lunas.' });
    }

    // ACC SEBAGIAN: admin boleh meng-ACC kurang dari jumlah yang dipesan (mis. pesan 3 tapi baru
    // bayar 2). Kalau jumlah_acc tidak dikirim, dianggap ACC semua tiket yang dipesan.
    const jumlahAcc = req.body.jumlah_acc === undefined ? booking.jumlah_tiket : parseInt(req.body.jumlah_acc, 10);
    if (!Number.isInteger(jumlahAcc) || jumlahAcc < 1 || jumlahAcc > booking.jumlah_tiket) {
      return res.status(400).json({ success: false, message: `Jumlah tiket yang di-ACC harus antara 1 - ${booking.jumlah_tiket}.` });
    }

    if (jumlahAcc < booking.jumlah_tiket) {
      // Pesanan disesuaikan ke jumlah yang dibayar: jumlah tiket & total dihitung ulang,
      // jumlah awal disimpan di jumlah_dipesan sebagai catatan.
      db.prepare(`
        UPDATE bookings
        SET jumlah_dipesan = COALESCE(jumlah_dipesan, jumlah_tiket),
            jumlah_tiket = ?, total_harga = harga_satuan * ?,
            status_pembayaran = 'paid', paid_at = datetime('now','localtime')
        WHERE id = ?
      `).run(jumlahAcc, jumlahAcc, order_id);
    } else {
      db.prepare(`
        UPDATE bookings SET status_pembayaran = 'paid', paid_at = datetime('now','localtime')
        WHERE id = ?
      `).run(order_id);
    }

    const tickets = generateTicketsForBooking(order_id, jumlahAcc);

    res.json({
      success: true,
      message: jumlahAcc < booking.jumlah_tiket
        ? `Pembayaran di-ACC sebagian: ${jumlahAcc} dari ${booking.jumlah_tiket} tiket diterbitkan.`
        : 'Pembayaran di-ACC, tiket berhasil dibuat.',
      jumlah_tiket: tickets.length
    });
  } catch (err) {
    console.error('Gagal ACC pembayaran:', err);
    res.status(503).json({ success: false, message: 'Server sedang sibuk. Coba klik ACC lagi dalam beberapa detik.' });
  }
});

// POST /api/admin/revoke-approval - TARIK KEMBALI ACC (mis. salah klik ACC / perlu ditinjau lagi).
// Pesanan kembali "pending" (bukti tetap ada), semua kode QR pesanan itu dihapus sehingga tiket lama
// tidak bisa dipakai masuk dan pembeli tidak bisa lagi melihat tiketnya di Cek Tiket sampai di-ACC ulang.
// Ditolak kalau salah satu tiketnya sudah dipakai check-in. Jumlah tiket dikembalikan ke jumlah
// yang awalnya dipesan (kalau tadinya di-ACC sebagian), supaya bisa ditentukan ulang saat ACC lagi.
router.post('/revoke-approval', (req, res) => {
  try {
    const { order_id } = req.body;
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(order_id);
    if (!booking) return res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan.' });
    if (booking.status_pembayaran !== 'paid') {
      return res.status(400).json({ success: false, message: 'Hanya pesanan yang sudah di-ACC yang bisa ditarik kembali.' });
    }
    const sudahHadir = db.prepare('SELECT COUNT(*) AS c FROM tickets WHERE booking_id = ? AND checked_in = 1').get(order_id).c;
    if (sudahHadir > 0) {
      return res.status(409).json({ success: false, message: `Tidak bisa ditarik: ${sudahHadir} tiket pesanan ini sudah dipakai check-in.` });
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM tickets WHERE booking_id = ?').run(order_id);
      db.prepare(`
        UPDATE bookings
        SET status_pembayaran = 'pending', paid_at = NULL,
            jumlah_tiket = COALESCE(jumlah_dipesan, jumlah_tiket),
            total_harga = harga_satuan * COALESCE(jumlah_dipesan, jumlah_tiket),
            jumlah_dipesan = NULL,
            ditarik_at = datetime('now','localtime')
        WHERE id = ?
      `).run(order_id);
      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }

    res.json({ success: true, message: 'ACC ditarik kembali. Pesanan kembali ke status menunggu verifikasi dan kode tiket lama dinonaktifkan.' });
  } catch (err) {
    console.error('Gagal menarik ACC:', err);
    res.status(503).json({ success: false, message: 'Server sedang sibuk. Coba lagi dalam beberapa detik.' });
  }
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

// Catatan: sengaja TIDAK ada endpoint untuk menghapus data pemesanan lewat dashboard/API.
// Kemampuan hapus data dari web (bahkan yang butuh konfirmasi) tetap membuka celah
// data bisa dimanipulasi/dihilangkan oleh siapa pun yang punya akses login admin.
// Kalau memang perlu mengosongkan data (misal untuk pemeliharaan server), itu sengaja
// dibuat harus lewat akses langsung ke server (lihat scripts/reset-db.js / `npm run reset-db`),
// supaya ada jejak & barrier akses yang lebih tinggi daripada sekadar login dashboard.

module.exports = router;
