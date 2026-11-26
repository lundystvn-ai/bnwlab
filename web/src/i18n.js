// Two languages: Indonesian (id) and English (en). Text is written in place as L('Indonesia', 'English').
// Choice is saved per browser. First visit: Indonesian when the browser or time zone looks Indonesian, otherwise English.
const KEY = 'bnw-lang';

function detect() {
  try { const s = localStorage.getItem(KEY); if (s === 'id' || s === 'en') return s; } catch {}
  const langs = (navigator.languages?.length ? navigator.languages : [navigator.language || '']).map((x) => String(x).toLowerCase());
  if (langs.some((x) => x.startsWith('id') || x.startsWith('jv') || x.startsWith('su'))) return 'id';
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  if (/^Asia\/(Jakarta|Pontianak|Makassar|Jayapura)$/.test(tz)) return 'id';
  return 'en';
}

export const lang = detect();
document.documentElement.lang = lang;
export const L = (id, en) => (lang === 'en' ? en : id);
export const locale = () => (lang === 'en' ? 'en-GB' : 'id-ID');

export function setLang(next) {
  if (next !== 'id' && next !== 'en') return;
  try { localStorage.setItem(KEY, next); } catch {}
  location.reload();
}

// Messages that come from the server (database / edge functions) are written in Indonesian.
const SERVER = {
  'Silakan login terlebih dahulu.': 'Please sign in first.',
  'Kuota upscale bulan ini sudah habis. Coba lagi bulan depan atau hubungi admin.': 'This month\'s upscale quota is used up. Try again next month or contact the admin.',
  'Kuota upscale bulan ini sudah habis di semua akun. Kredit dikembalikan.': 'This month\'s upscale quota is used up. Your credits were refunded.',
  'Layanan upscale belum aktif. Hubungi admin.': 'Upscale is not available yet. Please contact the admin.',
  'Layanan upscale sedang bermasalah. Kredit dikembalikan, hubungi admin.': 'Upscale is having problems. Your credits were refunded; please contact the admin.',
  'Skala ini belum tersedia. Kredit dikembalikan, coba 2× atau 4×.': 'This scale is not available. Your credits were refunded; try 2× or 4×.',
  'Kuota upscale bulan ini sudah habis. Kredit dikembalikan, hubungi admin.': 'This month\'s upscale quota is used up. Your credits were refunded; please contact the admin.',
  'Pengaturan upscale tidak valid. Kredit dikembalikan, coba lagi.': 'Invalid upscale settings. Your credits were refunded; please try again.',
  'Gambar tidak dapat dibaca server. Kredit dikembalikan, coba unggah ulang.': 'The server could not read the image. Your credits were refunded; please upload it again.',
  'Server upscale tidak dapat dihubungi. Kredit dikembalikan, coba lagi.': 'Could not reach the upscale server. Your credits were refunded; please try again.',
  'Server tidak mengembalikan hasil. Coba cek lagi sebentar.': 'The server returned no result yet. Check again in a moment.',
  'Gambar gagal diproses. Kredit dikembalikan.': 'The image could not be processed. Your credits were refunded.',
  'Status belum bisa dicek. Coba lagi sebentar.': 'Status could not be checked. Try again in a moment.',
  'Gambar tidak ditemukan di penyimpanan. Coba unggah ulang.': 'Image not found in storage. Please upload it again.',
  'Riwayat ini sudah diproses.': 'This job was already processed.',
  'Riwayat tidak ditemukan.': 'Job not found.',
  'Tugas belum dimulai.': 'The job has not started yet.',
  'Format gambar harus PNG, JPG, atau WebP.': 'Image must be PNG, JPG or WebP.',
  'Terjadi kesalahan di server.': 'Something went wrong on the server.',
  'Gambar gagal diproses.': 'The image could not be processed.',
  'Belum selesai setelah 30 menit. Gunakan tombol Cek lagi dari riwayat.': 'Not finished after 30 minutes. Use "Check again" in the history.',
  'Invalid login credentials': 'Wrong email or password.',
};
export function tr(msg) {
  const m = String(msg ?? '');
  if (lang !== 'en') return m;
  if (SERVER[m]) return SERVER[m];
  const credit = m.match(/^Kredit tidak cukup\. Upscale (\d+)x membutuhkan (\d+) kredit\.$/);
  if (credit) return `Not enough credits. ${credit[1]}× upscale needs ${credit[2]} credit${credit[2] === '1' ? '' : 's'}.`;
  const rej = m.match(/^Upscale ditolak server(.*)\. Kredit dikembalikan\.$/);
  if (rej) return `The upscale was rejected${rej[1]}. Your credits were refunded.`;
  return m;
}

// Package names/notes are stored in Indonesian in the database.
const PKG_NAME = { hemat: 'Saver' };
const PKG_NOTE = {
  'Coba dulu untuk pesanan kecil': 'Try it on small orders',
  'Pas untuk beberapa pesanan': 'Good for a few orders',
  'Pas untuk produksi rutin': 'For regular production',
  'Untuk studio / banyak desain': 'For studios and high volume',
};
export const pkgName = (p) => (lang === 'en' ? PKG_NAME[p?.id] || p?.nama : p?.nama) || '';
export const pkgNote = (p) => (lang === 'en' ? PKG_NOTE[p?.catatan] || p?.catatan : p?.catatan) || '';
