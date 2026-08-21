const path = require('path');
const fs = require('fs');

// Di server produksi (Railway/VPS), set env var STORAGE_DIR menunjuk ke folder yang di-mount
// sebagai persistent volume - misal "/app/storage". SATU folder ini menampung baik file
// database (tickets.db) MAUPUN folder upload bukti pembayaran, jadi cukup SATU volume saja
// (tidak perlu 2 volume terpisah yang beberapa paket Railway tidak mengizinkan).
//
// PENTING: sengaja TIDAK menaruh database di folder yang sama dengan kode aplikasi (db/schema.sql
// dkk) - kalau volume di-mount tepat di folder kode, isi foldernya (termasuk schema.sql) akan
// tertimpa kosong oleh volume yang baru, menyebabkan server crash saat start (file schema.sql
// dianggap hilang). Makanya lokasi data selalu dipisah ke STORAGE_DIR sendiri.
//
// Kalau STORAGE_DIR tidak di-set (misalnya waktu development di laptop), otomatis fallback
// ke folder lokal seperti biasa - tidak ada yang berubah untuk kamu yang masih coba-coba di lokal.

const STORAGE_DIR = process.env.STORAGE_DIR || null;

const DB_PATH = STORAGE_DIR
  ? path.join(STORAGE_DIR, 'tickets.db')
  : path.join(__dirname, '..', 'db', 'tickets.db');

const UPLOAD_DIR = STORAGE_DIR
  ? path.join(STORAGE_DIR, 'uploads', 'proofs')
  : path.join(__dirname, '..', 'uploads', 'proofs');

// Pastikan foldernya ada sebelum dipakai (aman dipanggil berkali-kali)
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

module.exports = { STORAGE_DIR, DB_PATH, UPLOAD_DIR };
