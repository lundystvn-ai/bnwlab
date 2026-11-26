// Wording for the image checker, shared by the Editor panel and the Cek Gambar page.
import { L } from './i18n.js';
import { num } from './util.js';

const CK_TEXT = {
  dpi: {
    ok: (d) => L(`Resolusi cukup: ${d.dpi} DPI.`, `Resolution is fine: ${d.dpi} DPI.`),
    warn: (d) => L(`Resolusi pas-pasan: ${d.dpi} DPI. Hasil bisa sedikit buram; idealnya 300 DPI.`, `Borderline resolution: ${d.dpi} DPI. The print may look a little soft; 300 DPI is ideal.`),
    bad: (d) => L(`Resolusi terlalu rendah: ${d.dpi} DPI. Gambar akan pecah. Perkecil lebar cetak atau upscale dulu.`, `Resolution too low: ${d.dpi} DPI. The print will look pixelated. Print smaller or upscale first.`),
  },
  background: {
    ok: () => L('Latar sudah transparan.', 'The background is transparent.'),
    bad: (d) => L(`Latar ${d.bg === 'white' ? 'putih' : 'hitam'} belum dibuang dan akan ikut tercetak sebagai kotak.`, `The ${d.bg} background has not been removed and will print as a box.`),
    warn: () => L('Gambar tidak punya bagian transparan. Kalau latarnya tidak ingin dicetak, buang dengan pipet: klik warna latarnya di gambar.', 'The image has no transparent areas. If the background should not print, remove it with the eyedropper: click the background colour on the image.'),
  },
  haze: {
    ok: () => L('Tidak ada piksel setengah transparan.', 'No semi-transparent pixels.'),
    warn: (d) => L(`${pct(d.pct)} piksel setengah transparan (bayangan, glow, tepi halus). Printer tetap memberi tinta putih di bawahnya, jadi bisa muncul kabut putih.`, `${pct(d.pct)} of pixels are semi-transparent (shadows, glows, soft edges). The printer still lays white ink under them, which can leave a white haze.`),
  },
  fringe: {
    ok: () => L('Tepi objek bersih.', 'Edges are clean.'),
    warn: (d) => L(`Ada garis tipis putih/hitam di pinggir objek (${num(d.count)} piksel), sisa latar yang kurang bersih.`, `A thin white/black outline sits on the edges (${num(d.count)} pixels), left over from the background.`),
  },
  specks: {
    ok: () => L('Tidak ada bintik nyasar.', 'No stray specks.'),
    warn: (d) => L(`${num(d.count)} bintik kecil di area kosong akan ikut tercetak.`, `${num(d.count)} tiny specks in empty areas will print.`),
  },
  thin: {
    ok: () => L('Tidak ada detail yang terlalu tipis untuk tinta putih.', 'No details too thin for white ink.'),
    warn: () => L('Ada garis/teks lebih tipis dari 0,5 mm di ukuran cetak. Tinta putih bisa putus atau hilang di bagian itu.', 'Some lines or text are thinner than 0.5 mm at print size. The white ink may break or vanish there.'),
  },
  shapes: { info: () => L('Hasil raster memang terdiri dari titik/garis kecil, jadi cek tepi, bintik, dan detail tipis dilewati.', 'Raster results are made of small dots/lines on purpose, so the edge, speck and thin-detail checks are skipped.') },
  jpeg: { warn: () => L('File asli JPEG: tidak punya transparansi dan bisa ada noise kotak-kotak di sekitar objek. Pakai PNG kalau ada.', 'The original is a JPEG: it has no transparency and may show blocky noise around objects. Use a PNG if you have one.') },
};
const CK_TITLE = {
  dpi: L('Resolusi', 'Resolution'), background: L('Latar', 'Background'), haze: L('Kabut putih', 'White haze'), fringe: L('Tepi / halo', 'Edge halo'),
  specks: L('Bintik', 'Specks'), thin: L('Detail tipis', 'Thin details'), shapes: L('Raster', 'Raster'), jpeg: 'JPEG',
};
const pct = (v) => (v * 100 < 1 ? '<1%' : `${Math.round(v * 100)}%`);

export const ISSUE_ICON = { ok: 'check', warn: 'alert', bad: 'x', info: 'info' };
export const issueTitle = (id) => CK_TITLE[id] || id;
export function issueText(it) {
  const t = CK_TEXT[it.id] || {};
  const lv = it.level === 'bad' && !t.bad ? 'warn' : it.level;
  return (t[lv] || t.warn || t.info || (() => ''))(it.data);
}
// Summary for a list of issues: { problems, bad, label }
export function summary(issues) {
  const probs = issues.filter((i) => i.level === 'warn' || i.level === 'bad');
  return {
    problems: probs.length, bad: probs.some((i) => i.level === 'bad'),
    label: probs.length ? L(`${probs.length} masalah`, `${probs.length} issue${probs.length > 1 ? 's' : ''}`) : L('Siap cetak', 'Print ready'),
  };
}
