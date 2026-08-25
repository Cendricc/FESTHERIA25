// Script untuk mengosongkan database (menghapus semua data pemesanan/tiket).
// Jalankan dengan: npm run reset-db
//
// PERINGATAN: ini akan menghapus SELURUH data pemesanan secara permanen.
// Pengaturan (buka/tutup pendaftaran, batch aktif) TIDAK ikut terhapus.

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { DB_PATH, UPLOAD_DIR } = require('../services/storagePaths');

if (!fs.existsSync(DB_PATH)) {
  console.log('Database belum ada / sudah kosong. Tidak ada yang perlu dihapus.');
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('Yakin mau menghapus SEMUA data pemesanan & tiket? Ketik "hapus" untuk konfirmasi: ', (answer) => {
  if (answer.trim().toLowerCase() !== 'hapus') {
    console.log('Dibatalkan. Tidak ada data yang dihapus.');
    rl.close();
    return;
  }

  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH);
  db.exec('DELETE FROM tickets');
  db.exec('DELETE FROM bookings');

  // Hapus juga file-file bukti pembayaran yang sudah diupload
  if (fs.existsSync(UPLOAD_DIR)) {
    for (const file of fs.readdirSync(UPLOAD_DIR)) {
      if (file === '.gitkeep') continue;
      fs.unlinkSync(path.join(UPLOAD_DIR, file));
    }
  }

  console.log('✅ Semua data pemesanan, tiket, dan file bukti pembayaran sudah dihapus. Pengaturan batch/buka-tutup tetap tersimpan.');
  rl.close();
});
