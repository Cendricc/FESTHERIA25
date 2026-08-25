const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { DB_PATH } = require('../services/storagePaths');

const db = new DatabaseSync(DB_PATH);

// schema.sql SELALU dibaca dari folder kode (bukan dari volume), jadi aman walau lokasi
// database (DB_PATH) dipindah ke volume terpisah di server produksi.
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// ===== Migrasi ringan untuk database lama yang dibuat sebelum kolom/tabel ini ada =====
const columns = db.prepare("PRAGMA table_info(bookings)").all();
const columnNames = columns.map((col) => col.name);

if (!columnNames.includes('expires_at')) {
  db.exec(`ALTER TABLE bookings ADD COLUMN expires_at TEXT`);
  db.exec(`UPDATE bookings SET expires_at = datetime('now','localtime') WHERE expires_at IS NULL`);
}

if (!columnNames.includes('batch')) {
  db.exec(`ALTER TABLE bookings ADD COLUMN batch INTEGER NOT NULL DEFAULT 1`);
}

if (!columnNames.includes('bukti_pembayaran')) {
  db.exec(`ALTER TABLE bookings ADD COLUMN bukti_pembayaran TEXT`);
}

if (!columnNames.includes('tingkat')) {
  db.exec(`ALTER TABLE bookings ADD COLUMN tingkat INTEGER NOT NULL DEFAULT 1`);
}

// Migrasi skema lama (kode_tiket/checked_in pernah ada langsung di tabel bookings)
// ke tabel "tickets" terpisah, supaya pesanan >1 tiket bisa punya kode QR berbeda per lembar.
if (columnNames.includes('kode_tiket')) {
  try {
    const oldBookings = db.prepare(`
      SELECT id, kode_tiket, jumlah_tiket, checked_in, checked_in_at
      FROM bookings WHERE kode_tiket IS NOT NULL
    `).all();

    const { customAlphabet } = require('nanoid');
    const nanoid = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 10);

    for (const b of oldBookings) {
      const alreadyMigrated = db.prepare('SELECT 1 FROM tickets WHERE booking_id = ?').get(b.id);
      if (alreadyMigrated) continue;

      // Tiket pertama pakai kode lama supaya QR yang mungkin sudah dibagikan tetap valid.
      db.prepare('INSERT OR IGNORE INTO tickets (kode_tiket, booking_id, urutan, checked_in, checked_in_at) VALUES (?, ?, ?, ?, ?)')
        .run(b.kode_tiket, b.id, 1, b.checked_in || 0, b.checked_in_at || null);

      for (let i = 2; i <= b.jumlah_tiket; i++) {
        db.prepare('INSERT INTO tickets (kode_tiket, booking_id, urutan) VALUES (?, ?, ?)')
          .run(`TIX-${nanoid()}`, b.id, i);
      }
    }
    console.log(`Migrasi ${oldBookings.length} tiket lama ke tabel tickets selesai.`);
  } catch (err) {
    console.error('Migrasi tiket lama gagal (bisa diabaikan kalau ini instalasi baru):', err.message);
  }
}

// ===== Migrasi settings: kolom harga per batch =====
const settingsColumns = db.prepare("PRAGMA table_info(settings)").all().map((c) => c.name);
const defaultPrice = parseInt(process.env.EVENT_TICKET_PRICE || '50000', 10);

if (!settingsColumns.includes('price_batch_1')) {
  db.exec(`ALTER TABLE settings ADD COLUMN price_batch_1 INTEGER`);
  db.exec(`ALTER TABLE settings ADD COLUMN price_batch_2 INTEGER`);
  db.exec(`ALTER TABLE settings ADD COLUMN price_batch_3 INTEGER`);
}
if (!settingsColumns.includes('price_batch_4')) {
  db.exec(`ALTER TABLE settings ADD COLUMN price_batch_4 INTEGER`); // batch 4 = OTS
}

// Isi kolom harga yang masih kosong (baris settings lama dari sebelum fitur ini ada,
// atau baris yang baru saja ditambahkan kolomnya lewat migrasi di atas) pakai EVENT_TICKET_PRICE dari .env.
db.prepare(`
  UPDATE settings SET
    price_batch_1 = COALESCE(price_batch_1, ?),
    price_batch_2 = COALESCE(price_batch_2, ?),
    price_batch_3 = COALESCE(price_batch_3, ?),
    price_batch_4 = COALESCE(price_batch_4, ?)
  WHERE id = 1
`).run(defaultPrice, defaultPrice, defaultPrice, defaultPrice);

// Pastikan baris settings (id=1) selalu ada - dulu dibuat lewat schema.sql, sekarang di sini
// supaya nilai harga awal bisa langsung diisi dari .env saat instalasi baru pertama kali.
const settingsExists = db.prepare('SELECT COUNT(*) AS c FROM settings WHERE id = 1').get().c > 0;
if (!settingsExists) {
  db.prepare(`
    INSERT INTO settings (id, registration_open, current_batch, price_batch_1, price_batch_2, price_batch_3, price_batch_4)
    VALUES (1, 1, 1, ?, ?, ?, ?)
  `).run(defaultPrice, defaultPrice, defaultPrice, defaultPrice);
}

module.exports = db;
