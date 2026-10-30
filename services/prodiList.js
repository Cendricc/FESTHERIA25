// Daftar program studi resmi. Sengaja dipusatkan di satu file supaya validasi backend
// dan pilihan dropdown di frontend selalu sinkron (frontend ambil lewat GET /api/prodi-list).
const PRODI_LIST = [
  'D-III Gizi',
  'STR Gizi & Dietetika',
  'D-III Keperawatan Malang di Lawang',
  'D-III Keperawatan Lawang',
  'D-III Keperawatan Blitar',
  'D-III Keperawatan Trenggalek',
  'D-III Keperawatan Ponorogo',
  'STR Keperawatan Malang',
  'STR Keperawatan Lawang',
  'D-III Kebidanan Malang',
  'D-III Kebidanan Jember',
  'D-III Kebidanan Kediri',
  'STR Kebidanan Malang',
  'STR Kebidanan Jember',
  'STR Kebidanan Kediri',
  'D-III Rekam Medis dan Informasi Kesehatan',
  'D-III Asuransi Kesehatan',
  'STR Promosi Kesehatan',
  'STR Keselamatan dan Kesehatan Kerja (K3)',
  'D-III Analisis Farmasi dan Makanan',
  'D-III Teknologi Bank Darah'
];

const TINGKAT_LIST = [1, 2, 3, 4];

module.exports = { PRODI_LIST, TINGKAT_LIST };
