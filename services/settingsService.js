const db = require('../db/database');

function getSettings() {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get();
}

// Ambil harga tiket untuk nomor batch tertentu (1/2/3)
function getPriceForBatch(batchNumber) {
  const settings = getSettings();
  return settings[`price_batch_${batchNumber}`];
}

function updateSettings({ registration_open, current_batch, price_batch_1, price_batch_2, price_batch_3, price_batch_4 }) {
  const current = getSettings();

  const newOpen = registration_open !== undefined ? (registration_open ? 1 : 0) : current.registration_open;
  const newBatch = current_batch !== undefined ? parseInt(current_batch, 10) : current.current_batch;
  const newPrice1 = price_batch_1 !== undefined ? parseInt(price_batch_1, 10) : current.price_batch_1;
  const newPrice2 = price_batch_2 !== undefined ? parseInt(price_batch_2, 10) : current.price_batch_2;
  const newPrice3 = price_batch_3 !== undefined ? parseInt(price_batch_3, 10) : current.price_batch_3;
  const newPrice4 = price_batch_4 !== undefined ? parseInt(price_batch_4, 10) : current.price_batch_4;

  db.prepare(`
    UPDATE settings
    SET registration_open = ?, current_batch = ?,
        price_batch_1 = ?, price_batch_2 = ?, price_batch_3 = ?, price_batch_4 = ?,
        updated_at = datetime('now','localtime')
    WHERE id = 1
  `).run(newOpen, newBatch, newPrice1, newPrice2, newPrice3, newPrice4);

  return getSettings();
}

module.exports = { getSettings, updateSettings, getPriceForBatch };
