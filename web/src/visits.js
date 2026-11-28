// Admin → Pengunjung: anonymous visit statistics (see track.js and admin_visit_stats in the database).
import { db } from './supa.js';
import { esc, notice, rupiah, num } from './util.js';

const PAGE = {
  home: 'Beranda', cek: 'Cek Gambar', editor: 'Halftone', vektor: 'Vektor', gangsheet: 'Gangsheet', upscale: 'Upscale', ai: 'Redraw AI',
  kredit: 'Riwayat kredit', redraw: 'Redraw AI (beranda)',
  support: 'Support', harga: 'Harga (beranda)', faq: 'FAQ (beranda)', fitur: 'Fitur (beranda)', cara: 'Cara kerja (beranda)',
  privasi: 'Kebijakan privasi', ketentuan: 'Ketentuan layanan',
};
const DEVICE = { mobile: 'HP', desktop: 'Komputer', tablet: 'Tablet' };
const LANG = { id: 'Indonesia', en: 'English', '?': 'Tidak diketahui' };
function sourceName(s) {
  if (!s) return 'Langsung / tidak diketahui';
  const known = [[/instagram/, 'Instagram'], [/(^|\.)google\./, 'Google'], [/facebook|fb\.com/, 'Facebook'], [/tiktok/, 'TikTok'],
    [/(^|\.)t\.co$|twitter|x\.com/, 'X / Twitter'], [/whatsapp|wa\.me/, 'WhatsApp'], [/bing\./, 'Bing'], [/youtube|youtu\.be/, 'YouTube']];
  for (const [re, name] of known) if (re.test(s)) return `${name} <span class="subtle">${esc(s)}</span>`;
  return esc(s);
}
const fmtDay = (d, opt) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', opt);

function delta(cur, prev, days) {
  if (!prev && !cur) return `<span class="subtle">sama seperti ${days} hari sebelumnya</span>`;
  if (!prev) return `<span class="subtle">baru · ${days} hari sebelumnya 0</span>`;
  const p = Math.round(((cur - prev) / prev) * 100);
  const arrow = p > 0 ? '▲' : p < 0 ? '▼' : '•';
  return `<span class="muted">${arrow} ${Math.abs(p)}%</span> <span class="subtle">vs ${days} hari sebelumnya</span>`;
}
const tile = (label, value, sub) => `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div><div class="xs" style="margin-top:4px">${sub}</div></div>`;

// Single-series bar chart of visitors per day, with a hover tooltip per day.
function chart(daily, W, H) {
  const L = 34, R = 8, T = 12, B = 26;
  const max = Math.max(4, ...daily.map((d) => d.visitors));
  const step = Math.pow(10, Math.floor(Math.log10(max))); const nice = Math.ceil(max / step) * step;
  const ticks = [0, nice / 2, nice].filter((v, i, a) => a.indexOf(v) === i);
  const n = daily.length, cw = (W - L - R) / n, bw = Math.max(2, Math.min(28, cw - 2));
  const y = (v) => T + (H - T - B) * (1 - v / nice);
  const every = Math.ceil(n / Math.max(2, Math.floor((W - L - R) / 70)));
  let g = ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="vz-grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="vz-tick">${num(v)}</text>`).join('');
  daily.forEach((d, i) => {
    const x = L + i * cw + (cw - bw) / 2, top = y(d.visitors), base = y(0), h = base - top, r = Math.min(4, bw / 2, h);
    if (d.visitors > 0) g += `<path class="vz-bar" d="M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z"/>`;
    if ((i % every === 0 && n - 1 - i >= every) || i === n - 1) g += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" class="vz-tick">${fmtDay(d.day, { day: 'numeric', month: 'short' })}</text>`;
    g += `<rect class="vz-hit" data-i="${i}" x="${L + i * cw}" y="${T}" width="${cw}" height="${H - T - B}"/>`;
  });
  return `<div class="vz-wrap"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="vz" role="img" aria-label="Pengunjung per hari">${g}</svg><div class="vz-tip" hidden></div></div>`;
}

function table(title, head, rows, val) {
  const max = Math.max(1, ...rows.map(val));
  return `<section class="card stack vz-card"><h3 style="margin:0;font-size:var(--text-base)">${title}</h3>
    ${rows.length ? `<table class="vz-table"><thead><tr>${head.map((h, i) => `<th${i ? ' style="text-align:right"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r) => `<tr><td><div class="vz-name">${r._label}</div><div class="vz-meter"><span style="width:${(val(r) / max) * 100}%"></span></div></td>${r._cells.map((c) => `<td style="text-align:right" class="mono">${c}</td>`).join('')}</tr>`).join('')}
    </tbody></table>` : '<p class="small muted" style="margin:0">Belum ada data.</p>'}</section>`;
}

export function renderVisits(box, isAlive) {
  let days = 30;
  async function load() {
    box.innerHTML = '<div class="empty">Memuat…</div>';
    const { data, error } = await db.rpc('admin_visit_stats', { p_days: days });
    if (!isAlive()) return;
    if (error) { box.innerHTML = notice(/admin_visit_stats/.test(error.message) ? 'Fitur pengunjung belum aktif di database.' : esc(error.message), 'error'); return; }
    const s = data.summary, p = data.previous;
    const conv = s.visitors ? ((s.signups / s.visitors) * 100).toFixed(1).replace('.', ',') + '%' : '–';
    const share = (rows) => { const t = rows.reduce((a, r) => a + r.visitors, 0) || 1; return (r) => Math.round((r.visitors / t) * 100) + '%'; };
    const dv = share(data.devices), lg = share(data.langs);
    box.innerHTML = `
      <div class="toolbar"><h2 style="margin:0">Pengunjung website</h2><span class="grow"></span>
        <div class="seg" role="radiogroup" aria-label="Rentang waktu" id="vzRange">${[7, 30, 90].map((d) => `<button role="radio" aria-checked="${d === days}" data-d="${d}">${d} hari</button>`).join('')}</div></div>
      <div class="metrics">
        ${tile('Sedang online', num(data.online), '<span class="subtle">aktif 5 menit terakhir</span>')}
        ${tile('Pengunjung hari ini', num(data.today), '<span class="subtle">orang berbeda</span>')}
        ${tile(`Pengunjung ${days} hari`, num(s.visitors), delta(s.visitors, p.visitors, days) + '<br><span class="subtle">dijumlah per hari</span>')}
        ${tile('Tampilan halaman', num(s.pageviews), delta(s.pageviews, p.pageviews, days))}
      </div>
      <div class="metrics">
        ${tile('Kunjungan (sesi)', num(s.sessions), delta(s.sessions, p.sessions, days))}
        ${tile('Akun baru', num(s.signups), delta(s.signups, p.signups, days))}
        ${tile('Pengunjung → daftar', conv, '<span class="subtle">akun baru ÷ pengunjung</span>')}
        ${tile('Top up dibayar', rupiah(s.revenue), `<span class="subtle">${num(s.paid)} transaksi</span>`)}
      </div>
      <section class="card stack" style="margin-top:4px"><h3 style="margin:0;font-size:var(--text-base)">Pengunjung per hari</h3><div id="vzChart"></div></section>
      <p class="xs subtle" style="margin:12px 0 0">Rincian di bawah ini mencakup 7 hari terakhir.</p>
      <div class="vz-grid2">
        ${data.tools ? table('Menu alat', ['Alat', 'Pengunjung', 'Dilihat'], data.tools.map((r) => ({ ...r, _label: esc(PAGE[r.name] || r.name), _cells: [num(r.visitors), num(r.pageviews)] })), (r) => r.pageviews) : ''}
        ${table('Halaman teratas', ['Halaman', 'Pengunjung', 'Dilihat'], data.pages.map((r) => ({ ...r, _label: esc(PAGE[r.name] || r.name), _cells: [num(r.visitors), num(r.pageviews)] })), (r) => r.pageviews)}
        ${table('Sumber kunjungan', ['Dari', 'Kunjungan'], data.sources.map((r) => ({ ...r, _label: sourceName(r.name), _cells: [num(r.sessions)] })), (r) => r.sessions)}
        ${table('Perangkat', ['Jenis', 'Pengunjung', 'Porsi'], data.devices.map((r) => ({ ...r, _label: esc(DEVICE[r.name] || r.name), _cells: [num(r.visitors), dv(r)] })), (r) => r.visitors)}
        ${table('Bahasa yang dipilih', ['Bahasa', 'Pengunjung', 'Porsi'], data.langs.map((r) => ({ ...r, _label: esc(LANG[r.name] || r.name), _cells: [num(r.visitors), lg(r)] })), (r) => r.visitors)}
      </div>
      <p class="xs subtle">Pencatatan mulai 26 November 2026. Data rinci disimpan 7 hari; setelah itu hanya ringkasan harian (jumlah pengunjung, kunjungan, tampilan halaman) yang disimpan. Kunjungan dari perangkat admin tidak dihitung. Tidak ada IP atau data pribadi yang disimpan; "pengunjung" dihitung per browser.</p>`;
    box.querySelector('#vzRange').onclick = (e) => { const b = e.target.closest('[data-d]'); if (b && Number(b.dataset.d) !== days) { days = Number(b.dataset.d); load(); } };
    const holder = box.querySelector('#vzChart');
    let lastW = 0;
    const draw = () => {
      const w = Math.floor(holder.clientWidth); if (!w || w === lastW) return; lastW = w;
      holder.innerHTML = chart(data.daily, w, w < 520 ? 180 : 230); wire();
    };
    const ro = new ResizeObserver(() => { if (!isAlive() || !holder.isConnected) { ro.disconnect(); return; } draw(); });
    ro.observe(holder); draw();
    function wire() {
    const wrap = holder.querySelector('.vz-wrap'), tip = wrap.querySelector('.vz-tip');
    wrap.querySelectorAll('.vz-hit').forEach((r) => {
      const d = data.daily[Number(r.dataset.i)];
      r.onmouseenter = () => {
        wrap.querySelectorAll('.vz-hit.on').forEach((x) => x.classList.remove('on')); r.classList.add('on');
        tip.innerHTML = `<b>${fmtDay(d.day, { weekday: 'short', day: 'numeric', month: 'long' })}</b><span>${num(d.visitors)} pengunjung</span><span class="subtle">${num(d.pageviews)} tampilan halaman</span>`;
        tip.hidden = false;
        const rb = r.getBoundingClientRect(), wb = wrap.getBoundingClientRect();
        const left = Math.min(Math.max(rb.left - wb.left + rb.width / 2, 70), wb.width - 70);
        tip.style.left = left + 'px';
      };
      r.onmouseleave = () => { r.classList.remove('on'); tip.hidden = true; };
    });
    }
  }
  load();
}
