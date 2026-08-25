const QRCode = require('qrcode');
const { customAlphabet } = require('nanoid');
const db = require('../db/database');

// Kode tiket pakai huruf besar + angka, tanpa karakter yang gampang salah baca (0/O, 1/I)
const nanoid = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 10);

function generateKodeTiket() {
  return `TIX-${nanoid()}`;
}

// Menghasilkan QR code dalam bentuk Data URL (base64) supaya bisa langsung ditampilkan
// di <img src="..."> tanpa perlu menyimpan file gambar terpisah.
async function generateQRCodeDataUrl(kodeTiket) {
  return QRCode.toDataURL(kodeTiket, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 320,
    color: {
      dark: '#0f172a',
      light: '#ffffff'
    }
  });
}

/**
 * Membuat satu baris tiket (dengan kode unik masing-masing) untuk SETIAP lembar
 * tiket dalam sebuah pesanan. Dipanggil sekali saat admin meng-ACC pembayaran.
 * Aman dipanggil berkali-kali untuk booking yang sama - kalau tiketnya sudah ada, tidak dibuat ulang.
 */
function generateTicketsForBooking(bookingId, jumlahTiket) {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM tickets WHERE booking_id = ?').get(bookingId).c;
  if (existing > 0) return getTicketsForBooking(bookingId);

  const insert = db.prepare('INSERT INTO tickets (kode_tiket, booking_id, urutan) VALUES (?, ?, ?)');
  for (let i = 1; i <= jumlahTiket; i++) {
    insert.run(generateKodeTiket(), bookingId, i);
  }
  return getTicketsForBooking(bookingId);
}

function getTicketsForBooking(bookingId) {
  return db.prepare('SELECT * FROM tickets WHERE booking_id = ? ORDER BY urutan ASC').all(bookingId);
}

module.exports = { generateKodeTiket, generateQRCodeDataUrl, generateTicketsForBooking, getTicketsForBooking };
