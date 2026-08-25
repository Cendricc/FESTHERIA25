// Utility kecil untuk mencegah XSS: selalu escape data yang berasal dari input pengguna
// (nama, email, prodi, dll) sebelum dimasukkan ke innerHTML.
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
