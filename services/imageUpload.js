const multer = require('multer');
const fs = require('fs');
const { UPLOAD_DIR } = require('./storagePaths');

// Ekstensi file DITENTUKAN SENDIRI oleh server berdasarkan MIME type, bukan diambil dari nama
// file asli yang diupload pengguna - supaya tidak bisa dipakai untuk path traversal.
const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const MAGIC_BYTES = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/jpg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/webp': null
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

// Bikin instance multer siap pakai, dengan awalan nama file yang bisa disesuaikan tiap
// pemanggil (misal "ktm" vs "bukti") supaya gampang dibedakan pas lihat isi folder uploads/proofs.
function createImageUpload(prefix) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const orderId = (req.body.order_id || 'unknown').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
      const ext = EXT_BY_MIME[file.mimetype] || '.jpg';
      cb(null, `${prefix}-${orderId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
  });

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (!EXT_BY_MIME[file.mimetype]) {
        return cb(new Error('Format file harus JPG, PNG, atau WEBP.'));
      }
      cb(null, true);
    }
  });
}

module.exports = { createImageUpload, fileSignatureValid, EXT_BY_MIME };
