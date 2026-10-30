CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,              -- order_id unik, misal: TIX-XXXXXXXX
  email TEXT NOT NULL,
  nama TEXT NOT NULL,
  no_hp TEXT NOT NULL,
  prodi TEXT NOT NULL,
  tingkat INTEGER NOT NULL DEFAULT 1,       -- tingkat/semester: 1-4
  jumlah_tiket INTEGER NOT NULL,
  harga_satuan INTEGER NOT NULL,
  total_harga INTEGER NOT NULL,
  batch INTEGER NOT NULL DEFAULT 1,        -- batch pendaftaran saat pesanan dibuat (1/2/3)
  metode_pembayaran TEXT,                  -- selalu 'manual' (transfer bank / QRIS manual)
  bukti_pembayaran TEXT,                   -- path file gambar bukti transfer/QRIS yang diupload pembeli
  status_pembayaran TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  expires_at TEXT,                         -- LEGACY, sudah tidak dipakai (dulu batas waktu 15 menit, sekarang dihapus)
  paid_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status_pembayaran);
CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(email);

-- Satu baris per LEMBAR tiket (bukan per pesanan) - supaya pesanan >1 tiket
-- tetap mendapat kode QR yang berbeda-beda untuk tiap lembarnya.
-- Baris di tabel ini baru dibuat saat admin meng-ACC pembayaran (status jadi "paid").
CREATE TABLE IF NOT EXISTS tickets (
  kode_tiket TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  urutan INTEGER NOT NULL,          -- tiket ke berapa dalam 1 pesanan (1, 2, 3, ...)
  checked_in INTEGER NOT NULL DEFAULT 0,   -- otomatis "blacklist" setelah check-in pertama
  checked_in_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_booking ON tickets(booking_id);

-- Tabel pengaturan tunggal untuk kontrol buka/tutup pendaftaran, batch aktif, & harga per batch
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  registration_open INTEGER NOT NULL DEFAULT 1,
  current_batch INTEGER NOT NULL DEFAULT 1,
  price_batch_1 INTEGER NOT NULL DEFAULT 50000,
  price_batch_2 INTEGER NOT NULL DEFAULT 50000,
  price_batch_3 INTEGER NOT NULL DEFAULT 50000,
  price_batch_4 INTEGER NOT NULL DEFAULT 50000, -- batch 4 = OTS (On The Spot)
  updated_at TEXT
);
