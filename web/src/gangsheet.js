// Gangsheet: arrange many designs on a roll of DTF film, then export print files at real size.
// Arranging and previewing are free and run in the browser; exporting PNG/PDF costs 1 credit per
// started metre of film. The work is kept on this device (IndexedDB) between visits.
import { db } from './supa.js';
import { $, esc, icon, notice, num, toast, uuid, openModal, closeModal } from './util.js';
import { L, tr, locale } from './i18n.js';
import { state, authDialog, topupDialog, setCredits, regionId, clearSession } from './session.js';
import { takeHandoff } from './handoff.js';
import {
  DEFAULTS, MAX_COPIES, newJob, uid, box, cropOf, normalAngle, effectiveDpi, mmToPx, pack, fillPage, pagesOf, inspect, validateJob, validateSettings, exportCost,
} from './gangsheet/engine.js';
import { readArtwork, makeText, removeColor, knockColor, edgeColor, applyEdits, imageFor, releaseUnused } from './gangsheet/media.js';

// ---------- state kept between page visits ----------
const G = {
  job: null, selected: null, pageIndex: 0, zoom: 1, showGrid: true, hand: false, lockAspect: true, bg: 'checker',
  past: [], future: [], rev: 0, seq: 0, conflicted: false, restored: false, panel: 'design',
};
const urls = new Map();   // artwork data URI -> object URL for previews

const fmt = (v, max = 2) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString(locale(), { maximumFractionDigits: max }) : '—');
const val = (v) => (Number.isFinite(Number(v)) ? String(Number(Number(v).toFixed(4))) : '');
const find = (arr, id) => arr.find((x) => x.id === id);
const clone = (j) => ({ ...j, settings: { ...j.settings }, arts: j.arts.map((a) => ({ ...a })), items: j.items.map((i) => ({ ...i })) });
const copyFor = (artId) => ({ id: uid(), artId, x: 0, y: 0, page: -1, angle: 0, baseAngle: 0, flipX: false, flipY: false });

const errorText = (code) => ({
  empty: L('Desain sepenuhnya transparan.', 'The design is fully transparent.'),
  svg: L('SVG tidak valid.', 'The SVG is not valid.'),
  svg_external: L('Gunakan SVG mandiri: gambar di dalamnya harus tertanam, bukan tautan.', 'Use a self-contained SVG: images inside must be embedded, not linked.'),
  format: L('Gunakan PNG, JPG, WebP, SVG, atau PDF.', 'Use PNG, JPG, WebP, SVG or PDF.'),
  size: L('Ukuran gambar tidak terbaca.', 'The image size cannot be read.'),
  image: L('Gambar tidak bisa dibuka.', 'The image cannot be opened.'),
  read: L('File tidak bisa dibaca.', 'The file cannot be read.'),
  too_large: L('Hapus latar hanya untuk gambar sampai 36 megapiksel.', 'Background removal supports images up to 36 megapixels.'),
  no_edge_color: L('Warna itu tidak ditemukan di tepi luar gambar. Pilih "Semua bagian warna ini" kalau warnanya ada di dalam desain.', 'That colour was not found on the outer edge. Choose "Every area of this colour" if it is inside the design.'),
  no_color: L('Warna itu tidak ditemukan di gambar.', 'That colour was not found in the image.'),
  project: L('File proyek tidak dikenali atau rusak.', 'The project file is not recognised or is damaged.'),
  settings: L('Periksa lebar, panjang, margin, dan jarak film.', 'Check the film width, length, margin and gap.'),
  canvas: L('Browser tidak bisa membuat kanvas cetak. Coba DPI lebih kecil atau lembar lebih pendek.', 'The browser could not create a print canvas. Try a lower DPI or a shorter sheet.'),
})[code] || L('Proses gagal. Coba lagi.', 'Something went wrong. Please try again.');

function issueText(x) {
  const n = esc(x.name || L('Desain', 'Design'));
  switch (x.type) {
    case 'dpi': return L(`${n} · ${x.dpi} DPI di ukuran cetak ini (disarankan 300 DPI).`, `${n} · ${x.dpi} DPI at this print size (300 DPI recommended).`);
    case 'opaque': return L(`${n} tidak punya latar transparan, jadi latarnya ikut tercetak.`, `${n} has no transparent background, so the background prints too.`);
    case 'bounds': return L(`${n} melewati batas cetak lembar ${x.page + 1}.`, `${n} goes past the print area of sheet ${x.page + 1}.`);
    case 'unplaced': return L(`${x.count} salinan ${n} belum muat di film. Perkecil desain atau ubah pengaturan film.`, `${x.count} ${x.count === 1 ? 'copy' : 'copies'} of ${n} do not fit on the film. Make the design smaller or change the film settings.`);
    case 'spacing': return L(`${n} dan ${esc(x.otherName)} bertumpuk atau kurang jarak di lembar ${x.page + 1}.`, `${n} and ${esc(x.otherName)} overlap or are too close on sheet ${x.page + 1}.`);
    default: return L('Sumber desain hilang.', 'A design source is missing.');
  }
}

function previewURL(a) {
  if (!urls.has(a.src)) {
    const comma = a.src.indexOf(','), bin = atob(a.src.slice(comma + 1)), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    urls.set(a.src, URL.createObjectURL(new Blob([arr], { type: a.src.slice(5, a.src.indexOf(';')) })));
  }
  return urls.get(a.src);
}
function cleanup() {
  const srcs = new Set([G.job, ...G.past, ...G.future].flatMap((j) => j.arts.map((a) => a.src)));
  for (const [src, url] of urls) if (!srcs.has(src)) { URL.revokeObjectURL(url); urls.delete(src); }
  releaseUnused(srcs);
}

// ---------- draft on this device ----------
let database = null;
function openDb() {
  if (!database) database = new Promise((resolve, reject) => {
    try {
      const r = indexedDB.open('bnw-gangsheet', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('draft')) r.result.createObjectStore('draft'); };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    } catch (e) { reject(e); }
  });
  database.catch(() => {});
  return database;
}
async function restoreDraft() {
  const d = await openDb();
  return new Promise((resolve, reject) => { const r = d.transaction('draft').objectStore('draft').get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
let saves = Promise.resolve();
function saveDraft(setLabel) {
  if (G.conflicted) return;
  const snapshot = G.job, version = ++G.seq;
  setLabel(L('Menyimpan draf…', 'Saving draft…'));
  saves = saves.catch(() => {}).then(async () => {
    if (version !== G.seq || G.conflicted) return;
    const d = await openDb(), next = G.rev + 1;
    await new Promise((resolve, reject) => {
      const tx = d.transaction('draft', 'readwrite'), store = tx.objectStore('draft'), r = store.get('current');
      r.onsuccess = () => { if ((r.result?.revision || 0) !== G.rev) { G.conflicted = true; tx.abort(); return; } store.put({ revision: next, job: snapshot }, 'current'); };
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('conflict'));
    });
    G.rev = next;
    if (version === G.seq) setLabel(L('Draf tersimpan di perangkat ini', 'Draft saved on this device'));
  }).catch(() => setLabel(G.conflicted ? L('Draf berubah di tab lain. Unduh file proyek untuk menyimpan.', 'The draft changed in another tab. Download the project file to keep it.') : L('Penyimpanan lokal tidak tersedia. Unduh file proyek.', 'Local storage is unavailable. Download the project file.')));
}

// ---------- sample designs (drawn here, BNW themed) ----------
function sampleSvgs() {
  const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="380" viewBox="0 0 600 380"><path d="M40 20h520l30 40v260l-30 40H40L10 320V60z" fill="#111" /><path d="M54 40h492l22 30v240l-22 30H54l-22-30V70z" fill="#f6c213"/><text x="300" y="170" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="120" text-anchor="middle" fill="#111">BNW</text><rect x="70" y="200" width="460" height="70" fill="#111"/><text x="300" y="250" font-family="Arial,sans-serif" font-weight="700" font-size="44" letter-spacing="6" text-anchor="middle" fill="#f6c213">DESIGN LAB</text><text x="300" y="318" font-family="Arial,sans-serif" font-weight="700" font-size="22" letter-spacing="4" text-anchor="middle" fill="#111">DTF PRINT STUDIO</text></svg>`;
  const dots = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><circle cx="200" cy="200" r="190" fill="#111"/><circle cx="150" cy="160" r="70" fill="#12b8d6" opacity=".9"/><circle cx="250" cy="160" r="70" fill="#e0267d" opacity=".9"/><circle cx="200" cy="245" r="70" fill="#f6c213" opacity=".9"/><text x="200" y="360" font-family="Arial Black,Arial,sans-serif" font-size="40" text-anchor="middle" fill="#fff">CMYK</text></svg>`;
  const tag = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="160" viewBox="0 0 520 160"><path d="M10 80 70 10h440v140H70z" fill="#e0267d"/><circle cx="62" cy="80" r="14" fill="#fff"/><text x="300" y="104" font-family="Arial Black,Arial,sans-serif" font-size="68" text-anchor="middle" fill="#fff">PRINT</text></svg>`;
  return [['BNW Badge', badge, 200, 4], ['CMYK Dots', dots, 110, 6], ['Print Tag', tag, 150, 5]];
}

// ---------- page ----------
let pageApi = null;
export function onSignIn() { pageApi?.render(); return true; }

export function mount(host) {
  if (!G.job) G.job = newJob();
  let alive = true, busy = false, drag = null, pages = [], report = { errors: [], warnings: [] };
  const nodes = new Map();

  host.innerHTML = `
  <div class="gs" id="gs">
    <div class="tabsbar gs-top">
      <div class="gs-sheets" id="gsSheets" role="tablist" aria-label="${L('Lembar cetak', 'Print sheets')}"></div>
      <span class="grow"></span>
      <div class="gs-actions">
        <button class="ibtn" id="gsUndo" title="${L('Urungkan (Ctrl+Z)', 'Undo (Ctrl+Z)')}" aria-label="${L('Urungkan', 'Undo')}">${icon('undo', 'i i-sm')}</button>
        <button class="ibtn" id="gsRedo" title="${L('Ulangi (Ctrl+Shift+Z)', 'Redo (Ctrl+Shift+Z)')}" aria-label="${L('Ulangi', 'Redo')}">${icon('redo', 'i i-sm')}</button>
        <button class="btn btn-quiet btn-sm" id="gsArrange">${icon('sheet', 'i i-sm')}<span>${L('Susun otomatis', 'Auto arrange')}</span></button>
        <button class="btn btn-quiet btn-sm" id="gsProject">${icon('folder', 'i i-sm')}<span class="hide-sm">${L('Proyek', 'Project')}</span></button>
      </div>
    </div>

    <main class="gs-stage" id="gsStage" aria-label="${L('Area lembar cetak', 'Sheet area')}">
      <div class="gs-scroll" id="gsScroll" tabindex="0">
        <div class="gs-pad"><div class="gs-paperwrap">
          <canvas class="gs-ruler gs-rx" id="gsRx" aria-hidden="true"></canvas>
          <canvas class="gs-ruler gs-ry" id="gsRy" aria-hidden="true"></canvas>
          <div class="gs-paper" id="gsPaper"><div class="gs-guide" id="gsGuide" aria-hidden="true"></div><div class="gs-pieces" id="gsPieces"></div></div>
        </div></div>
      </div>
      <div class="gs-empty" id="gsEmpty">
        <label class="dropzone" id="gsDropzone" tabindex="0">
          <span class="big">${icon('sheet')}</span>
          <strong id="gsEmptyTitle"></strong>
          <span class="muted small" id="gsEmptyText"></span>
          <span class="xs subtle">PNG, JPG, WebP, SVG, PDF</span>
        </label>
        <button class="btn btn-quiet btn-sm" id="gsSample">${L('Coba pakai contoh', 'Try a sample')}</button>
      </div>
      <div class="gs-dropover" id="gsDropOver" hidden><span>${icon('upload', 'i i-sm')}${L('Lepaskan desain untuk menambahkan', 'Drop designs to add them')}</span></div>
      <div class="float gs-float">
        <button id="gsPointer" aria-pressed="true" title="${L('Pilih dan geser desain', 'Select and move designs')}" aria-label="${L('Pilih', 'Select')}">${icon('pointer', 'i i-sm')}</button>
        <button id="gsHand" aria-pressed="false" title="${L('Geser kanvas', 'Pan the canvas')}" aria-label="${L('Geser kanvas', 'Pan')}">${icon('hand', 'i i-sm')}</button>
        <span class="sep"></span>
        <button id="gsZoomOut" aria-label="${L('Perkecil', 'Zoom out')}">${icon('minus', 'i i-sm')}</button>
        <button id="gsZoomVal" title="${L('Pas ke layar', 'Fit to view')}">100%</button>
        <button id="gsZoomIn" aria-label="${L('Perbesar', 'Zoom in')}">${icon('plus', 'i i-sm')}</button>
        <button id="gsGrid" aria-pressed="true" title="${L('Penggaris dan margin', 'Rulers and margin')}" aria-label="${L('Penggaris dan margin', 'Rulers and margin')}">${icon('grid', 'i i-sm')}</button>
        <span class="sep"></span>
        <span role="radiogroup" aria-label="${L('Latar pratinjau', 'Preview background')}" style="display:flex;gap:2px" id="gsBgs">
          <button role="radio" data-bg="checker" aria-label="${L('Transparan', 'Transparent')}"><span class="sw" style="background:repeating-conic-gradient(#ccc 0 25%,#fff 0 50%) 0 0/6px 6px"></span><span class="t">${L('Transparan', 'Transparent')}</span></button>
          <button role="radio" data-bg="white" aria-label="${L('Kaos putih', 'White shirt')}"><span class="sw" style="background:#fff"></span><span class="t">${L('Putih', 'White')}</span></button>
          <button role="radio" data-bg="black" aria-label="${L('Kaos hitam', 'Black shirt')}"><span class="sw" style="background:#0b0b0b"></span><span class="t">${L('Hitam', 'Black')}</span></button>
        </span>
      </div>
      <div class="busy" id="gsBusy" hidden><div class="card"><b id="gsBusyText">${L('Memproses…', 'Processing…')}</b><div class="bar"><i id="gsBusyBar"></i></div><span class="xs muted">${L('Diproses di perangkatmu, tidak diunggah.', 'Processed on your device, never uploaded.')}</span></div></div>
    </main>

    <aside class="panel gs-panel" aria-label="${L('Desain dan film', 'Designs and film')}">
      <div class="ptabs" role="tablist">
        <button role="tab" data-ptab="design">${L('Desain', 'Designs')} <span class="badge" id="gsArtCount">0</span></button>
        <button role="tab" data-ptab="film">${L('Film', 'Film')}</button>
      </div>
      <div id="gsTabDesign" class="gs-tab">
        <div class="sec-body" style="padding-top:12px">
          <input type="file" id="gsFiles" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg,application/pdf,.pdf" multiple hidden>
          <div class="grid2">
            <button class="btn btn-secondary" id="gsUpload">${icon('upload', 'i i-sm')}${L('Tambah desain', 'Add designs')}</button>
            <button class="btn btn-secondary" id="gsAddText">${icon('type', 'i i-sm')}${L('Tambah teks', 'Add text')}</button>
          </div>
          <div class="gs-arts" id="gsArts" aria-label="${L('Daftar desain', 'Design list')}"></div>
        </div>
        <div id="gsInspector"></div>
      </div>
      <div id="gsTabFilm" class="gs-tab" hidden></div>
      <div class="pfoot">
        <button class="btn btn-secondary" id="gsCheck"></button>
        <button class="btn btn-primary btn-lg" id="gsExport">${icon('download', 'i i-sm')}<span>${L('Ekspor file cetak', 'Export print files')}</span><span class="cost" id="gsCost"></span></button>
        <div class="status-msg" id="gsMsg" aria-live="polite"></div>
      </div>
    </aside>

    <div class="status gs-status" id="gsMetrics"></div>
  </div>`;

  const setSaved = (t) => { const el = $('gsSaved'); if (el) el.textContent = t; };
  const say = (m, t = 'ok') => { const el = $('gsMsg'); if (el) el.innerHTML = m ? notice(m, t) : ''; };
  const item = () => find(G.job.items, G.selected);
  const art = () => find(G.job.arts, item()?.artId);
  const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };

  function showBusy(text, fraction) {
    const b = $('gsBusy'); if (!b) return;
    b.hidden = !text; if (!text) return;
    $('gsBusyText').textContent = text;
    $('gsBusyBar').style.width = Number.isFinite(fraction) ? Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%' : '35%';
  }
  async function run(label, fn) {
    if (busy) return undefined;
    busy = true;
    const timer = setTimeout(() => showBusy(label), 200);
    try { return await fn((m, f) => { clearTimeout(timer); showBusy(m || label, f); }); }
    catch (e) { say(e?.message && e.message.length > 24 ? esc(e.message) : errorText(e?.message), 'error'); return undefined; }
    finally { clearTimeout(timer); busy = false; showBusy(''); }
  }
  function refreshSelected(id) {
    G.selected = find(G.job.items, id)?.id ?? G.job.items[0]?.id ?? null;
    if (item()?.page >= 0) G.pageIndex = item().page;
  }
  function commit(next, id = G.selected) {
    G.past.push(G.job); if (G.past.length > 25) G.past.shift();
    G.future = []; G.job = next;
    const distinct = [...new Set(G.job.items.filter((i) => i.page >= 0).map((i) => i.page))].sort((a, b) => a - b);
    const index = new Map(distinct.map((p, n) => [p, n]));
    G.job.items.forEach((i) => { if (i.page >= 0) i.page = index.get(i.page); });
    refreshSelected(id); render(); saveDraft(setSaved); cleanup();
  }
  function history(redo) {
    if (busy) return;
    const src = redo ? G.future : G.past, dest = redo ? G.past : G.future;
    if (!src.length) return;
    dest.push(G.job); G.job = src.pop(); refreshSelected(G.selected); render(); saveDraft(setSaved); cleanup();
  }
  async function arrange(next) {
    if (!next.items.length) return;
    const layout = { settings: next.settings, items: next.items, arts: next.arts.map(({ id, w, h, vector, trim, fullMask, trimMask }) => ({ id, w, h, vector, trim, fullMask, trimMask })) };
    next.items = await new Promise((resolve, reject) => {
      let worker;
      try { worker = new Worker(new URL('./gangsheet/pack-worker.js', import.meta.url), { type: 'module' }); }
      catch { try { resolve(pack(layout)); } catch (e) { reject(e); } return; }
      worker.onmessage = (e) => { worker.terminate(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.items); };
      worker.onerror = (e) => { e.preventDefault?.(); worker.terminate(); try { resolve(pack(layout)); } catch (err) { reject(err); } };
      worker.postMessage(layout);
    });
  }
  const alter = (fn, repack = false, id = G.selected) => run(repack ? L('Menyusun lembar…', 'Arranging sheets…') : L('Memperbarui…', 'Updating…'), async () => {
    const next = clone(G.job); fn(next);
    if (repack) await arrange(next);
    commit(next, id);
  });
  const currentPage = () => pages.find((p) => p.index === G.pageIndex) ?? { index: 0, length: Math.min(G.job.settings.maxLength, G.job.settings.width * 0.66), area: 0, items: [] };

  // ---------- render ----------
  function render() {
    if (!alive) return;
    pages = pagesOf(G.job); report = inspect(G.job);
    if (!pages.some((p) => p.index === G.pageIndex)) G.pageIndex = pages[0]?.index ?? 0;
    $('gsArtCount').textContent = String(G.job.arts.length);
    $('gsUndo').disabled = !G.past.length; $('gsRedo').disabled = !G.future.length; $('gsArrange').disabled = !G.job.items.length;
    const issues = report.errors.length + report.warnings.length;
    const chk = $('gsCheck');
    chk.className = 'btn btn-secondary gs-check' + (report.errors.length ? ' bad' : report.warnings.length ? ' warn' : '');
    chk.innerHTML = icon(issues ? 'tri' : 'scan', 'i i-sm') + `<span>${L('Cek cetak', 'Print check')}${issues ? ' · ' + issues : ''}</span>`;
    const cost = pages.length ? exportCost(pages) : 0;
    $('gsCost').textContent = pages.length ? ` · ${cost} ${L('kredit', cost === 1 ? 'credit' : 'credits')}` : '';
    $('gsExport').disabled = !G.job.items.length;
    document.querySelectorAll('[data-ptab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.ptab === G.panel)));
    $('gsTabDesign').hidden = G.panel !== 'design'; $('gsTabFilm').hidden = G.panel !== 'film';
    $('gsSheets').innerHTML = (pages.length ? pages : [{ index: 0, length: 0 }]).map((p) => `<button role="tab" class="doc gs-sheet" aria-selected="${p.index === G.pageIndex}" data-page="${p.index}">${icon('sheet', 'i i-sm')}<span class="name">${L('Lembar', 'Sheet')} ${p.index + 1}</span>${p.length ? `<span class="num subtle">${fmt(p.length / 10, 1)} cm</span>` : ''}</button>`).join('');
    const s = G.job.settings, total = pages.reduce((n, p) => n + p.length, 0), area = pages.reduce((n, p) => n + p.area, 0), placed = G.job.items.filter((i) => i.page >= 0).length;
    $('gsMetrics').innerHTML = `<span>${L('Lembar', 'Sheets')} <b class="val">${pages.length}</b></span><span>${L('Salinan', 'Copies')} <b class="val">${placed === G.job.items.length ? placed : placed + ' / ' + G.job.items.length}</b></span>
      <span>${L('Panjang film', 'Film length')} <b class="val">${fmt(total / 10, 1)} cm</b></span><span>${L('Terisi', 'Filled')} <b class="val">${fmt(total ? Math.min(100, (100 * area) / (s.width * total)) : 0, 1)}%</b></span>
      <span class="grow"></span><span class="hide-sm"><span class="dot"></span><span id="gsSaved">${L('Diproses di perangkat ini', 'Processed on this device')}</span></span>`;
    renderArts(); renderInspector(); renderFilm(); renderPaper();
  }

  function renderArts() {
    const active = art(), groups = new Map();
    for (const i of G.job.items) { if (!groups.has(i.artId)) groups.set(i.artId, []); groups.get(i.artId).push(i); }
    const opaque = new Set(report.warnings.filter((w) => w.type === 'opaque').map((w) => w.artId));
    $('gsArts').innerHTML = G.job.arts.map((a) => `<button class="gs-art${a.id === active?.id ? ' on' : ''}" data-art="${esc(a.id)}">
      <span class="gs-thumb"><img alt="" src="${esc(previewURL(a))}"></span>
      <span class="gs-names"><b>${esc(a.name)}</b><small>${fmt(a.w / 10)} × ${fmt(a.h / 10)} cm${a.vector ? ' · ' + L('vektor', 'vector') : ' · ' + fmt(Math.round(effectiveDpi(a)), 0) + ' DPI'}${opaque.has(a.id) ? ' · <span class="gs-warn">' + L('tidak transparan', 'not transparent') + '</span>' : ''}</small></span>
      <span class="gs-copies">×${groups.get(a.id)?.length || 0}</span></button>`).join('');
    for (const r of $('gsArts').children) r.onclick = () => {
      const list = groups.get(r.dataset.art); if (!list?.length) return;
      const i = list.find((x) => x.page === G.pageIndex) ?? list[0];
      G.selected = i.id; if (i.page >= 0) G.pageIndex = i.page; render();
    };
  }

  function field(id, label, value, unit, min, max, step = 'any') {
    return `<label class="gs-f" for="${id}"><span>${label}</span><span class="inp"><input type="number" inputmode="decimal" id="${id}" value="${esc(val(Math.round(Number(value) * 100) / 100))}" min="${min}" max="${max}" step="${step}">${unit ? `<span class="u">${unit}</span>` : ''}</span></label>`;
  }

  function renderInspector() {
    const el = $('gsInspector'), a = art(), i = item();
    if (!a || !i) { el.innerHTML = ''; return; }
    const n = G.job.items.filter((x) => x.artId === a.id).length;
    const openMore = el.dataset.art === a.id && el.querySelector('details.gs-more')?.open;
    const pageOpts = [...pages.map((p) => `<option value="${p.index}"${p.index === i.page ? ' selected' : ''}>${L('Lembar', 'Sheet')} ${p.index + 1}</option>`),
      ...(i.page < 0 ? [`<option value="-1" selected>${L('Belum ditempatkan', 'Not placed')}</option>`] : []), `<option value="new">${L('Lembar baru', 'New sheet')}</option>`].join('');
    const opaque = report.warnings.some((w) => w.type === 'opaque' && w.artId === a.id);
    el.dataset.art = a.id;
    el.innerHTML = `<details class="sec" open><summary>${icon('chev', 'i i-sm chev')}${L('Desain terpilih', 'Selected design')}<span class="badge">${a.vector ? L('Vektor', 'Vector') : fmt(Math.round(effectiveDpi(a)), 0) + ' DPI'}</span></summary>
      <div class="sec-body">
        <p class="gs-name" title="${esc(a.name)}">${esc(a.name)}</p>
        ${a.fileDpi ? `<p class="hint" style="margin:-6px 0 0">${L(`Ukuran awal dari DPI file (${fmt(a.fileDpi, 0)} DPI).`, `Initial size from the file's DPI (${fmt(a.fileDpi, 0)} DPI).`)}</p>` : ''}
        ${opaque ? `<div class="notice warn">${icon('tri')}<span>${L('Gambar ini tidak punya latar transparan; latarnya ikut tercetak.', 'This image has no transparent background; the background will print.')} <button class="linklike" id="gsBgFix">${L('Hapus warna latar', 'Remove background colour')}</button></span></div>` : ''}
        <div class="grid2">${field('gsW', L('Lebar', 'Width'), a.w / 10, 'cm', 0.1, 500)}${field('gsH', L('Tinggi', 'Height'), a.h / 10, 'cm', 0.1, 500)}</div>
        <label class="gs-check-line"><input type="checkbox" id="gsAspect"${G.lockAspect ? ' checked' : ''}> ${L('Kunci proporsi', 'Keep proportions')}</label>
        <div class="grid2">${field('gsQty', L('Jumlah', 'Copies'), n, 'pcs', 1, MAX_COPIES, 1)}${field('gsAngle', L('Rotasi salinan', 'Copy rotation'), i.angle, '°', -360, 360)}</div>
        <div class="gs-tools">
          <button class="ibtn" id="gsRotate" title="${L('Putar 90° (R)', 'Rotate 90° (R)')}" aria-label="${L('Putar 90°', 'Rotate 90°')}">${icon('rotate', 'i i-sm')}</button>
          <button class="ibtn" id="gsFlipX" title="${L('Cerminkan horizontal', 'Flip horizontally')}" aria-label="${L('Cerminkan horizontal', 'Flip horizontally')}">${icon('flip', 'i i-sm')}</button>
          <button class="ibtn" id="gsFlipY" title="${L('Cerminkan vertikal', 'Flip vertically')}" aria-label="${L('Cerminkan vertikal', 'Flip vertically')}">${icon('flipv', 'i i-sm')}</button>
          <button class="ibtn" id="gsDup" title="${L('Tambah 1 salinan (Ctrl+D)', 'Add a copy (Ctrl+D)')}" aria-label="${L('Tambah salinan', 'Add a copy')}">${icon('copy', 'i i-sm')}</button>
          <button class="ibtn" id="gsDel" title="${L('Hapus salinan ini (Delete)', 'Delete this copy (Delete)')}" aria-label="${L('Hapus salinan', 'Delete copy')}">${icon('trash', 'i i-sm')}</button>
          <span class="grow"></span>
          <button class="btn btn-quiet btn-sm" id="gsFill">${icon('sheet', 'i i-sm')}${L('Penuhi lembar', 'Fill sheet')}</button>
        </div>
        <p class="hint">${L('Ukuran dan jumlah berlaku untuk semua salinan desain ini. Rotasi, cermin, dan posisi berlaku per salinan.', 'Size and quantity apply to every copy of this design. Rotation, flip and position apply per copy.')}</p>
      </div></details>
      <details class="sec gs-more"${openMore ? ' open' : ''}><summary>${icon('chev', 'i i-sm chev')}${L('Posisi & pengolahan', 'Position & processing')}</summary>
      <div class="sec-body">
        <div class="grid2">${field('gsX', 'X', i.x / 10, 'cm', -500, 500)}${field('gsY', 'Y', i.y / 10, 'cm', -500, 500)}</div>
        <div class="row"><span class="lbl">${L('Pindah ke', 'Move to')}</span><select class="sel" id="gsMovePage">${pageOpts}</select></div>
        <div class="row"><span class="lbl">${L('Ratakan', 'Align')}</span><select class="sel" id="gsAlign"><option value="">${L('Pilih…', 'Choose…')}</option>${[L('Kiri', 'Left'), L('Tengah horizontal', 'Centre horizontally'), L('Kanan', 'Right'), L('Atas', 'Top'), L('Tengah vertikal', 'Centre vertically'), L('Bawah', 'Bottom')].map((v, k) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <label class="gs-check-line"><input type="checkbox" id="gsTrim"${a.trim ? ' checked' : ''}> ${L('Pangkas tepi transparan', 'Trim transparent edges')}</label>
        <div class="grid2">
          ${a.textConfig ? `<button class="btn btn-secondary btn-sm" id="gsEditText">${icon('type', 'i i-sm')}${L('Edit teks', 'Edit text')}</button>` : ''}
          ${a.textConfig ? '' : `<button class="btn btn-secondary btn-sm" id="gsRemoveBg">${icon('pipette', 'i i-sm')}${L('Hapus warna', 'Remove a colour')}</button>`}
        </div>
        <button class="linklike danger" id="gsRemoveAll">${L('Hapus semua salinan desain ini', 'Delete every copy of this design')}</button>
      </div></details>`;

    on('gsAspect', 'change', () => { G.lockAspect = $('gsAspect').checked; });
    for (const [fid, key] of [['gsW', 'w'], ['gsH', 'h']]) on(fid, 'change', () => {
      const v = $(fid).valueAsNumber * 10;
      if (!Number.isFinite(v) || v < 1 || v > 5000) { renderInspector(); return; }
      alter((j) => { const t = find(j.arts, a.id), ratio = t.w / t.h; t[key] = v; if (G.lockAspect) { if (key === 'w') t.h = v / ratio; else t.w = v * ratio; } }, true);
    });
    on('gsQty', 'change', () => quantity($('gsQty').valueAsNumber));
    on('gsAngle', 'change', () => rotateTo($('gsAngle').valueAsNumber));
    on('gsRotate', 'click', () => rotateTo(i.angle + 90));
    on('gsDup', 'click', () => quantity(n + 1));
    on('gsFlipX', 'click', () => alter((j) => { const t = find(j.items, i.id); t.flipX = !t.flipX; }));
    on('gsFlipY', 'click', () => alter((j) => { const t = find(j.items, i.id); t.flipY = !t.flipY; }));
    on('gsDel', 'click', () => remove());
    on('gsRemoveAll', 'click', () => remove(true));
    on('gsFill', 'click', () => fillDialog(a));
    on('gsBgFix', 'click', () => bgDialog(a));
    on('gsRemoveBg', 'click', () => bgDialog(a));
    on('gsEditText', 'click', () => textDialog(a));
    for (const [fid, key] of [['gsX', 'x'], ['gsY', 'y']]) on(fid, 'change', () => {
      const v = $(fid).valueAsNumber;
      if (Number.isFinite(v)) alter((j) => { find(j.items, i.id)[key] = v * 10; }); else renderInspector();
    });
    on('gsMovePage', 'change', () => {
      const d = $('gsMovePage').value; if (d === '-1') return;
      alter((j) => { const t = find(j.items, i.id); t.page = d === 'new' ? (pages.at(-1)?.index ?? -1) + 1 : Number(d); t.x = t.y = j.settings.margin; });
    });
    on('gsAlign', 'change', () => {
      const raw = $('gsAlign').value; if (raw === '' || i.page < 0) return;
      const b = box(a.w, a.h, i.angle), m = G.job.settings.margin, w = G.job.settings.width, h = currentPage().length;
      const opts = [['x', m], ['x', (w - b.w) / 2], ['x', w - b.w - m], ['y', m], ['y', (h - b.h) / 2], ['y', h - b.h - m]];
      alter((j) => { const [key, v] = opts[+raw]; find(j.items, i.id)[key] = v; });
    });
    on('gsTrim', 'change', () => {
      const enabled = $('gsTrim').checked;
      alter((j) => { const t = find(j.arts, a.id), old = cropOf(t); t.trim = enabled; const c = cropOf(t); t.w *= c.w / old.w; t.h *= c.h / old.h; }, true);
    });
  }

  function renderFilm() {
    const el = $('gsTabFilm'), s = G.job.settings;
    const presets = [[575, L('Roll 57,5 cm', 'Roll 57.5 cm')], [600, L('Roll 60 cm', 'Roll 60 cm')], [300, L('Roll 30 cm', 'Roll 30 cm')], [330, L('Roll 33 cm (A3+)', 'Roll 33 cm (A3+)')], [558.8, L('Roll 22 inci', 'Roll 22 inch')], [297, 'A3 · 29,7 × 42 cm']];
    const preset = presets.some(([w]) => w === s.width) ? String(s.width) : 'custom';
    el.innerHTML = `<details class="sec" open><summary>${icon('chev', 'i i-sm chev')}${L('Ukuran film', 'Film size')}</summary><div class="sec-body">
        <div class="row"><span class="lbl">${L('Preset', 'Preset')}</span><select class="sel" id="gsPreset">${presets.map(([w, n]) => `<option value="${w}"${String(w) === preset ? ' selected' : ''}>${n}</option>`).join('')}<option value="custom"${preset === 'custom' ? ' selected' : ''}>${L('Kustom', 'Custom')}</option></select></div>
        <div class="grid2">${field('gsFw', L('Lebar film', 'Film width'), s.width / 10, 'cm', 1, 120)}${field('gsFh', L('Panjang maks.', 'Max length'), s.maxLength / 10, 'cm', 1, 500)}</div>
        <div class="gs-f"><span>${L('Panjang lembar saat ekspor', 'Sheet length on export')}</span><div class="seg" role="radiogroup" id="gsLenMode"><button role="radio" data-v="trim" aria-checked="${s.lengthMode === 'trim'}">${L('Otomatis', 'Automatic')}</button><button role="radio" data-v="fixed" aria-checked="${s.lengthMode === 'fixed'}">${L('Tetap', 'Fixed')}</button></div></div>
        <p class="hint" id="gsLenHint" style="margin:0"></p>
        <div class="grid2">${field('gsMargin', L('Margin tepi', 'Edge margin'), s.margin, 'mm', 0, 500)}${field('gsGap', L('Jarak desain', 'Gap'), s.gap, 'mm', 0, 100)}</div>
      </div></details>
      <details class="sec" open><summary>${icon('chev', 'i i-sm chev')}${L('Cara menyusun', 'Arranging')}</summary><div class="sec-body">
        <div class="seg" role="radiogroup" id="gsPacking"><button role="radio" data-v="rect" aria-checked="${s.packing === 'rect'}">${L('Kotak', 'Boxes')}</button><button role="radio" data-v="shape" aria-checked="${s.packing === 'shape'}">${L('Ikuti bentuk', 'Follow shapes')}</button></div>
        <p class="hint" style="margin:0" id="gsPackHint">${s.packing === 'shape' ? L('Desain disusun mengikuti bentuknya dan boleh mengisi bagian transparan desain lain, jadi film lebih hemat untuk logo bulat, segitiga, atau huruf L.', 'Designs are packed by their shape and may use the transparent parts of other designs, saving film for round, triangular or L-shaped logos.') : L('Setiap desain dihitung sebagai kotak. Paling cepat dan rapi untuk desain persegi.', 'Each design counts as a box. Fastest and tidiest for rectangular designs.')}</p>
        <label class="gs-check-line"><input type="checkbox" id="gsMayRotate"${s.rotate ? ' checked' : ''}> ${L('Boleh diputar saat susun otomatis', 'Allow rotation when auto arranging')}</label>
        <label class="gs-check-line"><input type="checkbox" id="gsSnap"${s.snap ? ' checked' : ''}> ${L('Geser manual per 1 mm', 'Move by whole millimetres')}</label>
        <button class="btn btn-primary" id="gsApplyFilm">${L('Terapkan & susun ulang', 'Apply & rearrange')}</button>
        <p class="hint" style="margin:0">${L('Salinan yang melebihi panjang maksimum otomatis pindah ke lembar berikutnya.', 'Copies beyond the maximum length move to the next sheet automatically.')}</p>
      </div></details>`;
    const lenHint = () => { $('gsLenHint').textContent = $('gsLenMode').querySelector('[aria-checked=true]')?.dataset.v === 'fixed' ? L('Setiap lembar selalu sepanjang "Panjang maks.", walau desainnya lebih pendek.', 'Every sheet is always the full "Max length", even if the designs end earlier.') : L('Lembar berhenti tepat di desain terakhir, jadi film tidak terbuang.', 'Each sheet ends right after the last design, so no film is wasted.'); };
    for (const id of ['gsLenMode', 'gsPacking']) $(id).onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; $(id).querySelectorAll('[data-v]').forEach((x) => x.setAttribute('aria-checked', String(x === b))); lenHint(); };
    lenHint();
    $('gsPacking').addEventListener('click', () => {
      const shape = $('gsPacking').querySelector('[aria-checked=true]')?.dataset.v === 'shape';
      $('gsPackHint').textContent = shape ? L('Desain disusun mengikuti bentuknya dan boleh mengisi bagian transparan desain lain, jadi film lebih hemat untuk logo bulat, segitiga, atau huruf L.', 'Designs are packed by their shape and may use the transparent parts of other designs, saving film for round, triangular or L-shaped logos.') : L('Setiap desain dihitung sebagai kotak. Paling cepat dan rapi untuk desain persegi.', 'Each design counts as a box. Fastest and tidiest for rectangular designs.');
    });
    $('gsPreset').onchange = () => { const v = $('gsPreset').value; if (v === 'custom') return; $('gsFw').value = val(+v / 10); if (+v === 297) { $('gsFh').value = '42'; $('gsLenMode').querySelectorAll('[data-v]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.v === 'fixed'))); lenHint(); } };
    $('gsFw').oninput = () => { $('gsPreset').value = 'custom'; };
    $('gsApplyFilm').onclick = () => {
      const pick = (id) => $(id).querySelector('[aria-checked=true]')?.dataset.v;
      const n = { ...s, width: $('gsFw').valueAsNumber * 10, maxLength: $('gsFh').valueAsNumber * 10, margin: $('gsMargin').valueAsNumber, gap: $('gsGap').valueAsNumber,
        lengthMode: pick('gsLenMode') || 'trim', packing: pick('gsPacking') || 'rect', rotate: $('gsMayRotate').checked, snap: $('gsSnap').checked };
      try { validateSettings(n); } catch { say(errorText('settings'), 'error'); return; }
      say('');
      alter((j) => { j.settings = n; }, true).then(() => { if (G.job.items.length) toast(L('Film diperbarui dan disusun ulang.', 'Film updated and rearranged.')); });
    };
  }

  function ruler(el, size, vertical, scale) {
    const ratio = Math.min(2, window.devicePixelRatio || 1), w = vertical ? 22 : size, h = vertical ? size : 20;
    el.width = Math.max(1, Math.round(w * ratio)); el.height = Math.max(1, Math.round(h * ratio));
    el.style.width = w + 'px'; el.style.height = h + 'px';
    const ctx = el.getContext('2d'), cs = getComputedStyle(document.documentElement);
    ctx.scale(ratio, ratio);
    ctx.font = '9px ui-monospace, monospace'; ctx.fillStyle = cs.getPropertyValue('--color-text-subtle') || '#999'; ctx.strokeStyle = cs.getPropertyValue('--color-border-input') || '#888';
    const marks = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000], major = marks.find((m) => m * scale >= 40) ?? 1000, minor = major / 5;
    for (let k = 0; k * minor * scale < size + 0.05; k++) {
      const pos = Math.round(k * minor * scale) + 0.5, big = k % 5 === 0, len = big ? 6 : 3;
      ctx.beginPath();
      if (vertical) { ctx.moveTo(w - len, pos); ctx.lineTo(w, pos); } else { ctx.moveTo(pos, h - len); ctx.lineTo(pos, h); }
      ctx.stroke();
      if (big) {
        ctx.save();
        if (vertical) { ctx.translate(w - 8, pos + 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(fmt((k * minor) / 10, 1), 0, 0); }
        else ctx.fillText(fmt((k * minor) / 10, 1), pos + 2, 10);
        ctx.restore();
      }
    }
  }
  let scale = 1;
  function positionPiece(node, i, a) {
    const b = box(a.w, a.h, i.angle), c = cropOf(a);
    Object.assign(node.style, { left: i.x * scale + 'px', top: i.y * scale + 'px', width: b.w * scale + 'px', height: b.h * scale + 'px' });
    const wrap = node.firstChild, im = wrap.firstChild;
    Object.assign(wrap.style, { width: a.w * scale + 'px', height: a.h * scale + 'px', transform: `translate(-50%,-50%) rotate(${i.angle}deg) scale(${i.flipX ? -1 : 1},${i.flipY ? -1 : 1})` });
    Object.assign(im.style, { left: (-c.x / c.w) * 100 + '%', top: (-c.y / c.h) * 100 + '%', width: (a.sw / c.w) * 100 + '%', height: (a.sh / c.h) * 100 + '%' });
    const url = previewURL(a); if (im.getAttribute('src') !== url) im.src = url;
    node.classList.toggle('selected', i.id === G.selected);
  }
  function renderPaper() {
    const s = G.job.settings, p = currentPage(), stage = $('gsStage');
    if (!stage) return;
    const narrow = stage.clientWidth < 600, l = Math.max(1, p.length);
    const aw = Math.max(65, stage.clientWidth - (narrow ? 56 : 110)), ah = Math.max(80, stage.clientHeight - (narrow ? 70 : 96));
    scale = Math.min(aw / s.width, ah / l) * G.zoom;
    const w = Math.max(1, s.width * scale), h = Math.max(1, l * scale), paper = $('gsPaper');
    paper.style.width = w + 'px'; paper.style.height = h + 'px';
    paper.className = 'gs-paper bg-' + G.bg;
    $('gsGuide').style.inset = s.margin * scale + 'px'; $('gsGuide').hidden = !G.showGrid;
    $('gsRx').hidden = $('gsRy').hidden = !G.showGrid;
    if (G.showGrid) { ruler($('gsRx'), w, false, scale); ruler($('gsRy'), h, true, scale); }
    const used = new Set(p.items.map((i) => i.id)), arts = new Map(G.job.arts.map((a) => [a.id, a])), bad = new Set(report.errors.flatMap((e) => [e.id, e.otherId]));
    for (const [id, node] of nodes) if (!used.has(id)) { node.remove(); nodes.delete(id); }
    for (const i of p.items) {
      let node = nodes.get(i.id);
      if (!node) {
        node = document.createElement('div'); node.className = 'gs-piece'; node.dataset.id = i.id;
        const wrap = document.createElement('div'); wrap.className = 'gs-imgbox';
        const im = new Image(); im.draggable = false; im.alt = '';
        wrap.append(im); node.append(wrap); nodes.set(i.id, node); $('gsPieces').append(node);
      }
      const a = arts.get(i.artId); node.title = a.name;
      positionPiece(node, i, a); node.classList.toggle('invalid', bad.has(i.id));
    }
    const empty = !p.items.length, has = !!G.job.arts.length;
    $('gsEmpty').hidden = !empty;
    $('gsEmptyTitle').textContent = has ? L('Desain belum muat di film', 'The designs do not fit yet') : L('Tarik desain ke sini', 'Drop designs here');
    $('gsEmptyText').textContent = has ? L('Perkecil desain atau ubah ukuran film di tab Film.', 'Make designs smaller or change the film in the Film tab.') : L('atau klik untuk memilih · bisa banyak file sekaligus · bisa juga tempel (Ctrl+V)', 'or click to choose · several files at once · you can also paste (Ctrl+V)');
    $('gsSample').hidden = has;
    $('gsZoomVal').textContent = Math.round(100 * G.zoom) + '%';
    $('gsZoomOut').disabled = G.zoom <= 0.4; $('gsZoomIn').disabled = G.zoom >= 5;
    document.querySelectorAll('#gsBgs [data-bg]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.bg === G.bg)));
    $('gsGrid').setAttribute('aria-pressed', String(G.showGrid));
    $('gsPointer').setAttribute('aria-pressed', String(!G.hand)); $('gsHand').setAttribute('aria-pressed', String(G.hand));
    stage.classList.toggle('hand', G.hand);
  }

  // ---------- actions ----------
  function rotateTo(n) {
    const i = item(), a = art(); if (!i || !Number.isFinite(n)) return;
    alter((j) => { const t = find(j.items, i.id), b = box(a.w, a.h, i.angle); t.baseAngle = t.angle = normalAngle(n); const c = box(a.w, a.h, t.angle); t.x += (b.w - c.w) / 2; t.y += (b.h - c.h) / 2; });
  }
  function quantity(total) {
    const a = art(), i = item(); if (!a || !i) return;
    const siblings = G.job.items.filter((x) => x.artId === a.id);
    if (!Number.isInteger(total) || total < 1 || G.job.items.length + total - siblings.length > MAX_COPIES) {
      say(L(`Gunakan angka bulat. Maksimal ${num(MAX_COPIES)} salinan per proyek.`, `Use a whole number. At most ${num(MAX_COPIES)} copies per project.`), 'error'); renderInspector(); return;
    }
    alter((j) => {
      if (total < siblings.length) {
        const keep = new Set([i.id, ...siblings.filter((x) => x.id !== i.id).slice(0, total - 1).map((x) => x.id)]);
        j.items = j.items.filter((x) => x.artId !== a.id || keep.has(x.id));
      } else for (let k = siblings.length; k < total; k++) j.items.push({ ...copyFor(a.id), baseAngle: i.baseAngle, flipX: i.flipX, flipY: i.flipY });
    }, true);
  }
  function remove(all = false) {
    const a = art(), i = item(); if (!i) return;
    alter((j) => { j.items = j.items.filter((t) => (all ? t.artId !== a.id : t.id !== i.id)); if (!j.items.some((t) => t.artId === a.id)) j.arts = j.arts.filter((t) => t.id !== a.id); });
  }

  async function upload(files) {
    if (!files.length) return;
    await run(L('Membaca desain…', 'Reading designs…'), async (progress) => {
      const next = clone(G.job), failed = [];
      let added = 0, first = null;
      for (const [k, file] of files.entries()) {
        progress(L('Membaca ', 'Reading ') + file.name, (k + 0.01) / files.length);
        try {
          for await (const a of readArtwork(file)) {
            if (next.items.length >= MAX_COPIES) throw new Error(L('Jumlah salinan melebihi batas proyek.', 'The project has reached its copy limit.'));
            const i = copyFor(a.id); next.arts.push(a); next.items.push(i); first ??= i.id; added++;
          }
        } catch (e) { failed.push(`${file.name} · ${e.message?.length > 24 ? e.message : errorText(e.message)}`); }
      }
      if (added) { progress(L('Menyusun desain…', 'Arranging designs…')); await arrange(next); G.panel = 'design'; commit(next, first); }
      if (failed.length) say(L(`${added} desain ditambahkan. Gagal: `, `${added} designs added. Failed: `) + failed.map(esc).join('; '), added ? 'warn' : 'error');
      else if (report.errors.some((e) => e.type === 'unplaced')) say(L('Ada desain yang belum muat. Pilih desain itu untuk mengubah ukurannya.', 'Some designs do not fit. Select one to change its size.'), 'warn');
      else { say(''); toast(L(`${added} desain ditambahkan.`, `${added} ${added === 1 ? 'design' : 'designs'} added.`)); }
    });
  }
  async function samples() {
    await run(L('Memuat contoh…', 'Loading samples…'), async () => {
      const next = clone(G.job); next.name = L('Contoh gangsheet', 'Sample gangsheet');
      for (const [name, svg, w, n] of sampleSvgs()) {
        const file = new File([svg], name + '.svg', { type: 'image/svg+xml' });
        for await (const a of readArtwork(file)) { a.name = name; a.w = w; a.h = (w * a.sh) / a.sw; next.arts.push(a); for (let c = 0; c < n; c++) next.items.push(copyFor(a.id)); }
      }
      await arrange(next); commit(next, next.items[0].id);
      toast(L('Contoh siap. Coba ubah jumlah atau ukurannya.', 'Sample ready. Try changing quantities or sizes.'));
    });
  }

  function fillDialog(a) {
    const i = item(); if (!i || i.page < 0) return;
    if (report.errors.some((e) => e.page === G.pageIndex)) { say(L('Perbaiki posisi salinan di lembar ini dulu.', 'Fix the copies on this sheet first.'), 'error'); return; }
    const s = G.job.settings, cur = currentPage().length;
    openModal(`<h3>${L('Penuhi lembar', 'Fill the sheet')}</h3>
      <p class="muted">${L(`Tambahkan salinan <b>${esc(a.name)}</b> ke ruang kosong di lembar ${G.pageIndex + 1}, sampai panjang:`, `Add copies of <b>${esc(a.name)}</b> to the empty space on sheet ${G.pageIndex + 1}, up to a length of:`)}</p>
      <div class="stack" style="gap:8px">
        <label class="gs-check-line"><input type="radio" name="gsFillTo" value="current" checked> ${L(`Panjang lembar sekarang (${fmt(cur / 10, 1)} cm)`, `The current sheet length (${fmt(cur / 10, 1)} cm)`)}</label>
        <label class="gs-check-line"><input type="radio" name="gsFillTo" value="max"> ${L(`Panjang maksimum film (${fmt(s.maxLength / 10, 1)} cm)`, `The maximum film length (${fmt(s.maxLength / 10, 1)} cm)`)}</label>
        <label class="gs-check-line"><input type="radio" name="gsFillTo" value="custom"> ${L('Panjang tertentu', 'A set length')}</label>
        <span class="inp" style="max-width:180px"><input type="number" id="gsFillLen" min="1" max="${s.maxLength / 10}" step="any" value="${val(Math.min(s.maxLength, Math.max(cur, 1000)) / 10)}"><span class="u">cm</span></span>
      </div>
      <div class="modal-actions"><button class="btn btn-quiet" data-close>${L('Batal', 'Cancel')}</button><button class="btn btn-primary" id="gsFillGo">${L('Penuhi', 'Fill')}</button></div>`);
    $('gsFillLen').onfocus = () => { document.querySelector('input[name=gsFillTo][value=custom]').checked = true; };
    $('gsFillGo').onclick = () => {
      const mode = document.querySelector('input[name=gsFillTo]:checked').value;
      const length = mode === 'current' ? cur : mode === 'max' ? s.maxLength : $('gsFillLen').valueAsNumber * 10;
      if (!Number.isFinite(length) || length <= 2 * s.margin) { toast(L('Isi panjang yang valid.', 'Enter a valid length.'), 'error'); return; }
      closeModal();
      run(L('Mengisi lembar…', 'Filling the sheet…'), async () => {
        const next = clone(G.job), added = fillPage(next, a.id, G.pageIndex, Math.min(s.maxLength, length));
        if (!added.length) { toast(L('Tidak ada ruang kosong sampai panjang itu. Pilih panjang yang lebih besar.', 'There is no free space up to that length. Choose a longer length.'), 'warn'); return; }
        next.items.push(...added); commit(next);
        toast(L(`${added.length} salinan ditambahkan.`, `${added.length} copies added.`));
      });
    };
  }

  function textDialog(a = null) {
    const c = a?.textConfig ?? { text: '', family: 'sans', color: '#111111', bold: true, italic: false, align: 'center', stroke: false, strokeColor: '#ffffff' };
    const opt = (v, n, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${n}</option>`;
    openModal(`<h3>${a ? L('Edit teks', 'Edit text') : L('Tambah teks', 'Add text')}</h3>
      <div class="stack" style="gap:12px">
        <div class="field"><label for="gsText">${L('Teks', 'Text')}</label><textarea id="gsText" class="plain" rows="3" maxlength="600" placeholder="${L('Nama punggung, nomor, atau slogan', 'A back name, number or slogan')}">${esc(c.text)}</textarea></div>
        <div class="grid2">
          <div class="field"><label for="gsFont">${L('Jenis huruf', 'Typeface')}</label><select id="gsFont">${opt('sans', 'Sans serif', c.family)}${opt('display', L('Tebal (Impact)', 'Heavy (Impact)'), c.family)}${opt('serif', 'Serif', c.family)}${opt('mono', 'Monospace', c.family)}</select></div>
          <div class="field"><label for="gsTAlign">${L('Perataan', 'Alignment')}</label><select id="gsTAlign">${opt('center', L('Tengah', 'Centre'), c.align)}${opt('left', L('Kiri', 'Left'), c.align)}</select></div>
        </div>
        <div class="row" style="gap:16px;flex-wrap:wrap">
          <label class="gs-check-line"><input type="checkbox" id="gsBold"${c.bold ? ' checked' : ''}> ${L('Tebal', 'Bold')}</label>
          <label class="gs-check-line"><input type="checkbox" id="gsItalic"${c.italic ? ' checked' : ''}> ${L('Miring', 'Italic')}</label>
          <label class="gs-check-line"><input type="checkbox" id="gsStroke"${c.stroke ? ' checked' : ''}> ${L('Garis tepi', 'Outline')}</label>
        </div>
        <div class="row color-row" style="gap:16px"><label class="row" style="gap:6px"><input type="color" id="gsColor" value="${esc(c.color)}"> ${L('Warna teks', 'Text colour')}</label><label class="row" style="gap:6px"><input type="color" id="gsStrokeColor" value="${esc(c.strokeColor)}"> ${L('Warna garis tepi', 'Outline colour')}</label></div>
      </div>
      <div class="modal-actions"><button class="btn btn-quiet" data-close>${L('Batal', 'Cancel')}</button><button class="btn btn-primary" id="gsTextGo">${a ? L('Simpan', 'Save') : L('Tambahkan', 'Add')}</button></div>`);
    $('gsText').focus();
    $('gsTextGo').onclick = () => {
      const cfg = { text: $('gsText').value, family: $('gsFont').value, align: $('gsTAlign').value, color: $('gsColor').value, bold: $('gsBold').checked, italic: $('gsItalic').checked, stroke: $('gsStroke').checked, strokeColor: $('gsStrokeColor').value };
      if (!cfg.text.trim()) { $('gsText').focus(); return; }
      if (!a && G.job.items.length >= MAX_COPIES) { toast(L('Jumlah salinan sudah mencapai batas proyek.', 'The project has reached its copy limit.'), 'error'); return; }
      closeModal();
      run(L('Menyiapkan teks…', 'Preparing text…'), async () => {
        const next = clone(G.job), draft = await makeText(cfg); let id = G.selected;
        if (a) { draft.id = a.id; draft.w = a.w; draft.h = (draft.w * draft.sh) / draft.sw; next.arts = next.arts.map((t) => (t.id === a.id ? draft : t)); }
        else { next.arts.push(draft); const i = copyFor(draft.id); next.items.push(i); id = i.id; }
        await arrange(next); G.panel = 'design'; commit(next, id);
      });
    };
  }

  // Remove a colour with an eyedropper: click the colour on the preview, see the result before applying.
  async function bgDialog(a) {
    let im;
    try { im = await imageFor(a); } catch { say(errorText('image'), 'error'); return; }
    const k = Math.min(1, 340 / im.naturalWidth, 240 / im.naturalHeight);
    const w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k));
    const src = document.createElement('canvas'); src.width = w; src.height = h;
    const sctx = src.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingQuality = 'high'; sctx.drawImage(im, 0, 0, w, h);
    const base = sctx.getImageData(0, 0, w, h);
    const B = { hex: edgeColor(base.data, w, h), tol: 8, all: false, picking: true };
    openModal(`<h3>${L('Hapus warna', 'Remove a colour')}</h3>
      <p class="muted small" style="margin:0 0 10px">${L('Klik warna yang mau dihapus pada gambar (pipet). Hasilnya langsung terlihat sebelum diterapkan.', 'Click the colour to remove on the image (eyedropper). You see the result before applying it.')}</p>
      <div class="gs-pick" id="gsPickBox"><canvas id="gsPickCv" width="${w}" height="${h}" style="width:${w}px;height:${h}px"></canvas></div>
      <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm is-on" id="gsPipe" aria-pressed="true">${icon('pipette', 'i i-sm')}${L('Pipet', 'Eyedropper')}</button>
        <span class="gs-swatch" id="gsSwatch"></span><span class="val" id="gsHex"></span>
        <span class="grow"></span>
        <label class="row xs" style="gap:6px">${L('Warna lain', 'Other colour')}<input type="color" id="gsEdge" style="width:30px;height:26px;padding:1px"></label>
      </div>
      <div class="row" style="margin-top:10px"><span class="lbl">${L('Toleransi', 'Tolerance')}</span><input type="range" id="gsTol" min="0" max="50" step="1"><span class="val" id="gsTolVal" style="width:34px;text-align:right"></span></div>
      <div class="seg" role="radiogroup" id="gsBgMode" style="margin-top:10px"><button role="radio" data-v="edge">${L('Latar saja (dari tepi)', 'Background only (from edges)')}</button><button role="radio" data-v="all">${L('Semua bagian warna ini', 'Every area of this colour')}</button></div>
      <p class="hint" id="gsBgHint" style="margin:6px 0 0"></p>
      <div class="modal-actions"><button class="btn btn-quiet" data-close>${L('Batal', 'Cancel')}</button><button class="btn btn-primary" id="gsBgGo">${L('Hapus warna', 'Remove colour')}</button></div>`, { wide: true });
    const cv = $('gsPickCv'), ctx = cv.getContext('2d');
    let timer = 0;
    const paint = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!cv.isConnected) return;
        const d = new ImageData(new Uint8ClampedArray(base.data), w, h);
        const n = knockColor(d.data, w, h, B.hex, B.tol, B.all);
        ctx.putImageData(d, 0, 0);
        $('gsBgGo').disabled = !n;
      }, 40);
    };
    const sync = () => {
      $('gsSwatch').style.background = B.hex; $('gsHex').textContent = B.hex.toUpperCase(); $('gsEdge').value = B.hex;
      $('gsTol').value = String(B.tol); $('gsTolVal').textContent = B.tol + '%';
      $('gsBgMode').querySelectorAll('[data-v]').forEach((x) => x.setAttribute('aria-checked', String((x.dataset.v === 'all') === B.all)));
      $('gsBgHint').textContent = B.all ? L('Warna ini juga dihapus di dalam desain, misalnya putih di dalam huruf.', 'This colour is removed inside the design too, such as white inside letters.') : L('Hanya warna yang tersambung ke tepi gambar. Warna yang sama di dalam desain tetap aman.', 'Only colour connected to the image edge. The same colour inside the design stays.');
      $('gsPipe').classList.toggle('is-on', B.picking); $('gsPipe').setAttribute('aria-pressed', String(B.picking));
      $('gsPickBox').classList.toggle('picking', B.picking);
      paint();
    };
    cv.addEventListener('click', (e) => {
      if (!B.picking) return;
      const r = cv.getBoundingClientRect();
      const x = Math.max(0, Math.min(w - 1, Math.floor(((e.clientX - r.left) / r.width) * w))), y = Math.max(0, Math.min(h - 1, Math.floor(((e.clientY - r.top) / r.height) * h)));
      const p = (y * w + x) * 4, px = base.data;
      if (px[p + 3] < 20) { toast(L('Bagian itu sudah transparan. Klik bagian yang berwarna.', 'That spot is already transparent. Click a coloured spot.'), 'warn'); return; }
      B.hex = '#' + [px[p], px[p + 1], px[p + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      sync();
    });
    $('gsPipe').onclick = () => { B.picking = !B.picking; sync(); };
    $('gsEdge').oninput = () => { B.hex = $('gsEdge').value; sync(); };
    $('gsTol').oninput = () => { B.tol = Number($('gsTol').value); sync(); };
    $('gsBgMode').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) { B.all = b.dataset.v === 'all'; sync(); } };
    sync();
    $('gsBgGo').onclick = () => {
      const { hex, tol, all } = B;
      closeModal();
      run(L('Menghapus warna…', 'Removing the colour…'), async () => {
        const next = clone(G.job), updated = await removeColor(a, hex, tol, all);
        next.arts = next.arts.map((t) => (t.id === a.id ? updated : t));
        await arrange(next); commit(next); toast(L('Warna dihapus dan tepi kosong dipangkas.', 'Colour removed and the empty border trimmed.'));
      });
    };
  }

  function preflight() {
    const rows = [...report.errors.map((x) => ({ x, t: 'error' })), ...report.warnings.map((x) => ({ x, t: 'warn' }))];
    const body = !G.job.items.length ? notice(L('Tambahkan desain untuk memeriksa ukuran, jarak, dan resolusi.', 'Add designs to check size, spacing and resolution.'), 'warn')
      : !rows.length ? notice(L('Lembar siap dicetak.', 'The sheets are ready to print.'))
      : rows.map(({ x, t }) => `<div class="notice ${t}" role="status">${icon(t === 'error' ? 'alert' : 'tri')}<span>${issueText(x)}${x.type === 'opaque' ? ` <button class="linklike" data-bgfix="${esc(x.artId)}">${L('Hapus latar', 'Remove background')}</button>` : ''}</span></div>`).join('');
    openModal(`<h3>${L('Cek cetak', 'Print check')}</h3><div class="check-list">${body}</div>
      <p class="hint" style="margin:8px 0 0">${L('Margin, jarak, resolusi, dan transparansi diperiksa pada ukuran cetak setiap salinan.', 'Margins, spacing, resolution and transparency are checked at the print size of every copy.')}</p>
      <div class="modal-actions">${report.errors.length ? `<button class="btn btn-secondary" id="gsRepair">${icon('sheet', 'i i-sm')}${L('Susun otomatis', 'Auto arrange')}</button>` : ''}<button class="btn btn-primary" data-close>${L('Tutup', 'Close')}</button></div>`, { wide: true });
    document.querySelectorAll('[data-bgfix]').forEach((b) => { b.onclick = () => { const a = find(G.job.arts, b.dataset.bgfix); if (a) bgDialog(a); }; });
    on('gsRepair', 'click', () => { closeModal(); alter(() => {}, true); });
  }

  function projectDialog() {
    openModal(`<h3>${L('Proyek gangsheet', 'Gangsheet project')}</h3>
      <div class="field"><label for="gsName">${L('Nama proyek', 'Project name')}</label><input id="gsName" maxlength="90" value="${esc(G.job.name)}"></div>
      <div class="grid2" style="margin-top:12px">
        <button class="btn btn-secondary" id="gsSaveJob">${icon('download', 'i i-sm')}${L('Unduh file proyek', 'Download project file')}</button>
        <button class="btn btn-secondary" id="gsOpenJob">${icon('folder', 'i i-sm')}${L('Buka file proyek', 'Open project file')}</button>
        <button class="btn btn-secondary" id="gsNewJob">${icon('plus', 'i i-sm')}${L('Proyek kosong', 'Empty project')}</button>
      </div>
      <p class="hint" style="margin:10px 0 0">${L('File proyek (.json) menyimpan desain, ukuran, jumlah, dan posisi setiap salinan, jadi bisa dibuka lagi di perangkat lain. Gratis.', 'The project file (.json) keeps the designs, sizes, quantities and the position of every copy, so it can be opened on another device. Free.')}</p>
      <input type="file" id="gsJobFile" accept=".json,application/json" hidden>
      <div class="modal-actions"><button class="btn btn-quiet" data-close>${L('Tutup', 'Close')}</button><button class="btn btn-primary" id="gsSaveName">${L('Simpan nama', 'Save name')}</button></div>`);
    const named = () => {
      const name = $('gsName').value.trim();
      if (!name) { $('gsName').focus(); return false; }
      if (name !== G.job.name) { const n = clone(G.job); n.name = name; commit(n); }
      return true;
    };
    $('gsSaveName').onclick = () => { if (named()) closeModal(); };
    $('gsName').onkeydown = (e) => { if (e.key === 'Enter' && named()) { e.preventDefault(); closeModal(); } };
    $('gsSaveJob').onclick = () => { if (named()) { exportProject(); closeModal(); } };
    $('gsOpenJob').onclick = () => $('gsJobFile').click();
    $('gsJobFile').onchange = () => { const f = $('gsJobFile').files?.[0]; closeModal(); loadProject(f); };
    $('gsNewJob').onclick = () => { closeModal(); G.zoom = 1; G.pageIndex = 0; G.selected = null; commit(newJob()); toast(L('Proyek kosong dibuat. Pakai Urungkan untuk kembali.', 'Empty project created. Use Undo to go back.')); };
  }
  async function exportProject() {
    const { download, safeName } = await import('./gangsheet/export.js');
    // Edited designs are saved as the original image plus the edit settings, not the edited result.
    const arts = G.job.arts.map(({ orig, ...a }) => (a.edits?.length && orig ? { ...a, src: orig } : a));
    download(new Blob([JSON.stringify({ ...G.job, arts })], { type: 'application/json' }), safeName(G.job.name) + '.gangsheet.json');
  }
  async function loadProject(file) {
    if (!file) return;
    await run(L('Membuka proyek…', 'Opening the project…'), async (progress) => {
      let parsed;
      try { parsed = JSON.parse(await file.text()); } catch { throw new Error('project'); }
      const next = validateJob(parsed);
      for (const [n, a] of next.arts.entries()) {
        progress(L('Memeriksa ', 'Checking ') + a.name, n / next.arts.length);
        const im = await imageFor(a);
        if (im.naturalWidth !== a.sw || im.naturalHeight !== a.sh) throw new Error('project');
        if (a.edits?.length) next.arts[n] = await applyEdits({ ...a, orig: a.src });
      }
      G.pageIndex = 0; G.zoom = 1; commit(next, next.items[0]?.id); toast(L('Proyek dibuka.', 'Project opened.'));
    });
  }

  // ---------- export ----------
  function exportDialog() {
    if (!G.job.items.length) { $('gsFiles').click(); return; }
    if (report.errors.length) { preflight(); return; }
    const p = currentPage();
    openModal(`<h3>${L('Ekspor file cetak', 'Export print files')}</h3>
      <div class="stack" style="gap:12px">
        <div class="field"><label for="gsOut">${L('Format', 'Format')}</label><select id="gsOut">
          <option value="png">${L('PNG transparan (ZIP kalau lebih dari 1 lembar)', 'Transparent PNG (ZIP for more than one sheet)')}</option>
          <option value="pdf">${L('PDF ukuran cetak', 'PDF at print size')}</option>
          <option value="csv">${L('Rekap produksi (CSV) · gratis', 'Production summary (CSV) · free')}</option></select></div>
        <div class="field"><label for="gsRange">${L('Lembar', 'Sheets')}</label><select id="gsRange">
          <option value="all">${L('Semua lembar', 'All sheets')} (${pages.length})</option>
          <option value="active">${L('Lembar aktif saja', 'Active sheet only')} (${p.index + 1})</option></select></div>
        <div id="gsImgOpts" class="stack" style="gap:12px">
          <div class="field"><label for="gsDpi">${L('Resolusi', 'Resolution')}</label><select id="gsDpi">
            <option value="300">${L('300 DPI · siap cetak', '300 DPI · print ready')}</option><option value="150">150 DPI</option><option value="72">${L('72 DPI · pratinjau', '72 DPI · preview')}</option></select></div>
          <label class="gs-check-line"><input type="checkbox" id="gsMirror"> ${L('Cerminkan seluruh lembar (kalau printer/RIP-mu memerlukan)', 'Mirror the whole sheet (if your printer/RIP needs it)')}</label>
        </div>
        <div class="gs-outsize" id="gsOutsize"></div>
        ${report.warnings.length ? notice(L(`${report.warnings.length} peringatan di Cek cetak. Ekspor tetap bisa.`, `${report.warnings.length} ${report.warnings.length === 1 ? 'warning' : 'warnings'} in the print check. You can still export.`), 'warn') : ''}
      </div>
      <div class="modal-actions"><button class="btn btn-quiet" data-close>${L('Batal', 'Cancel')}</button><button class="btn btn-primary" id="gsExportGo"></button></div>`);
    const sync = () => {
      const target = $('gsRange').value === 'all' ? pages : [p], dpi = +$('gsDpi').value, csvOnly = $('gsOut').value === 'csv';
      $('gsImgOpts').hidden = csvOnly;
      const cost = exportCost(target);
      $('gsOutsize').innerHTML = target.slice(0, 4).map((pg) => `<div class="row"><span>${L('Lembar', 'Sheet')} ${pg.index + 1}</span><span class="grow"></span><b class="val">${fmt(G.job.settings.width / 10)} × ${fmt(pg.length / 10, 1)} cm</b>${csvOnly ? '' : `<span class="xs subtle">${num(mmToPx(G.job.settings.width, dpi))} × ${num(mmToPx(pg.length, dpi))} px</span>`}</div>`).join('')
        + (target.length > 4 ? `<div class="xs muted">${L(`dan ${target.length - 4} lembar lainnya`, `and ${target.length - 4} more`)}</div>` : '')
        + (csvOnly ? '' : `<div class="row gs-costline"><span>${L('Biaya', 'Cost')}</span><span class="grow"></span><b>${cost} ${L('kredit', cost === 1 ? 'credit' : 'credits')}</b><span class="xs subtle">${L('1 kredit per meter film', '1 credit per metre of film')}</span></div>`);
      $('gsExportGo').innerHTML = icon('download', 'i i-sm') + (csvOnly ? L('Unduh CSV', 'Download CSV') : L(`Ekspor · ${cost} kredit`, `Export · ${cost} ${cost === 1 ? 'credit' : 'credits'}`));
    };
    ['gsOut', 'gsRange', 'gsDpi'].forEach((k) => { $(k).onchange = sync; });
    sync();
    $('gsExportGo').onclick = () => {
      const opts = { format: $('gsOut').value, dpi: +$('gsDpi').value, mirror: $('gsMirror').checked, pageIndex: $('gsRange').value === 'all' ? null : p.index };
      closeModal();
      doExport(opts);
    };
  }

  async function doExport(opts) {
    const paid = opts.format !== 'csv';
    if (paid && !state.user) {
      say(L('Daftar atau masuk dulu untuk mengekspor. Akun baru dapat 5 kredit gratis.', 'Sign up or sign in to export. New accounts get 5 free credits.'), 'warn');
      authDialog('daftar', '', () => { if (alive) doExport(opts); });
      return;
    }
    const { buildExport, download } = await import('./gangsheet/export.js');
    await run(L('Menyiapkan file…', 'Preparing the file…'), async (update) => {
      const result = await buildExport(G.job, opts, (f, sheet) => update((sheet >= 0 ? L(`Membuat lembar ${sheet + 1}`, `Rendering sheet ${sheet + 1}`) : L('Menyimpan file', 'Saving the file')) + ` · ${Math.round(f * 100)}%`, f));
      if (paid) {
        const length = result.pages.reduce((n, pg) => n + pg.length, 0), cost = exportCost(result.pages);
        update(L('Memotong kredit…', 'Charging credits…'), 1);
        const { data, error } = await db.rpc('consume_gangsheet_export', { p_ref: uuid(), p_length_mm: Math.round(length * 10) / 10 });
        if (error) {
          if (/insufficient_credits/.test(error.message)) topupDialog(L(`Kredit tidak cukup. Ekspor ini memakai ${cost} kredit (1 kredit per meter film).`, `Not enough credits. This export uses ${cost} ${cost === 1 ? 'credit' : 'credits'} (1 credit per metre of film).`));
          else if (/not_authenticated/.test(error.message)) { clearSession(); authDialog('masuk'); }
          else say(L('Gagal memotong kredit: ', 'Could not charge credits: ') + esc(tr(error.message)), 'error');
          return;
        }
        setCredits(data);
        download(result.blob, result.name);
        say('');
        toast(L(`${result.name} diunduh. Sisa ${data} kredit.`, `${result.name} downloaded. ${data} credits left.`));
        const first = result.pages[0];
        db.from('halftone_image_history').insert({
          user_id: state.user.id, username: state.profile?.username || 'Pengguna', wilayah_id: regionId(), file_name: result.name.slice(0, 255), operation: 'gangsheet',
          image_width: mmToPx(G.job.settings.width, opts.dpi), image_height: mmToPx(first?.length || 1, opts.dpi), garment_color: 'white',
        }).then(() => {}, () => {});
      } else { download(result.blob, result.name); toast(L(`${result.name} diunduh.`, `${result.name} downloaded.`)); }
    });
  }

  // ---------- canvas interaction ----------
  const scroller = $('gsScroll');
  scroller.addEventListener('pointerdown', (e) => {
    if (busy || e.button !== 0) return;
    const hit = e.target.closest('.gs-piece');
    if (G.hand) drag = { id: e.pointerId, mode: 'pan', sx: e.clientX, sy: e.clientY, x: scroller.scrollLeft, y: scroller.scrollTop };
    else if (hit) {
      const i = find(G.job.items, hit.dataset.id); if (!i) return;
      G.selected = i.id; renderArts(); renderInspector();
      for (const [id, n] of nodes) n.classList.toggle('selected', id === G.selected);
      if (G.panel !== 'design') { G.panel = 'design'; render(); }
      drag = { id: e.pointerId, mode: 'move', sx: e.clientX, sy: e.clientY, x: i.x, y: i.y, item: i, scale };
    } else return;
    e.preventDefault(); scroller.setPointerCapture(e.pointerId);
  });
  scroller.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (drag.mode === 'pan') { scroller.scrollLeft = drag.x - dx; scroller.scrollTop = drag.y - dy; return; }
    if (Math.abs(dx) + Math.abs(dy) < 2 && !drag.moved) return;
    let x = drag.x + dx / drag.scale, y = drag.y + dy / drag.scale;
    if (G.job.settings.snap) { x = Math.round(x); y = Math.round(y); }
    drag.moved = true; drag.nx = x; drag.ny = y;
    const node = nodes.get(drag.item.id); node.style.left = x * drag.scale + 'px'; node.style.top = y * drag.scale + 'px';
  });
  const finishDrag = (e, cancel = false) => {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag; drag = null;
    if (scroller.hasPointerCapture(e.pointerId)) scroller.releasePointerCapture(e.pointerId);
    if (d.mode === 'move' && d.moved && !cancel) { const next = clone(G.job), t = find(next.items, d.item.id); t.x = d.nx; t.y = d.ny; commit(next, t.id); }
    else if (d.mode === 'move') renderPaper();
  };
  scroller.addEventListener('pointerup', (e) => finishDrag(e));
  scroller.addEventListener('pointercancel', (e) => finishDrag(e, true));
  const ro = new ResizeObserver(() => { if (!alive || !host.isConnected) { ro.disconnect(); return; } if (!drag) renderPaper(); });
  ro.observe($('gsStage'));

  const setZoom = (z) => { G.zoom = Math.max(0.4, Math.min(5, Math.round(z * 100) / 100)); renderPaper(); };
  $('gsZoomIn').onclick = () => setZoom(G.zoom * 1.25);
  $('gsZoomOut').onclick = () => setZoom(G.zoom / 1.25);
  $('gsZoomVal').onclick = () => setZoom(1);
  $('gsPointer').onclick = () => { G.hand = false; renderPaper(); };
  $('gsHand').onclick = () => { G.hand = true; renderPaper(); };
  $('gsGrid').onclick = () => { G.showGrid = !G.showGrid; renderPaper(); };
  $('gsBgs').onclick = (e) => { const b = e.target.closest('[data-bg]'); if (b) { G.bg = b.dataset.bg; renderPaper(); } };
  $('gsSheets').onclick = (e) => { const b = e.target.closest('[data-page]'); if (!b) return; G.pageIndex = Number(b.dataset.page); G.selected = currentPage().items[0]?.id ?? G.selected; render(); };
  document.querySelectorAll('[data-ptab]').forEach((b) => { b.onclick = () => { G.panel = b.dataset.ptab; render(); }; });
  $('gsUndo').onclick = () => history(false);
  $('gsRedo').onclick = () => history(true);
  $('gsArrange').onclick = () => alter(() => {}, true);
  $('gsProject').onclick = projectDialog;
  $('gsCheck').onclick = preflight;
  $('gsExport').onclick = exportDialog;
  $('gsUpload').onclick = () => $('gsFiles').click();
  $('gsAddText').onclick = () => textDialog();
  $('gsSample').onclick = samples;
  $('gsFiles').onchange = () => { const list = Array.from($('gsFiles').files || []); $('gsFiles').value = ''; upload(list); };
  const dropzone = $('gsDropzone');
  dropzone.onclick = (e) => { e.preventDefault(); if (G.job.arts.length) { G.panel = 'film'; render(); } else $('gsFiles').click(); };
  dropzone.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dropzone.click(); } };

  let depth = 0;
  const isFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  host.addEventListener('dragenter', (e) => { if (!isFiles(e)) return; e.preventDefault(); depth++; $('gsDropOver').hidden = false; });
  host.addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
  host.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) $('gsDropOver').hidden = true; });
  host.addEventListener('drop', (e) => { if (!isFiles(e)) return; e.preventDefault(); depth = 0; $('gsDropOver').hidden = true; upload(Array.from(e.dataTransfer.files)); });
  const onPaste = (e) => { const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\/|pdf/.test(f.type)); if (files.length) { e.preventDefault(); upload(files); } };
  document.addEventListener('paste', onPaste);

  const onKey = (e) => {
    if (busy || !$('modal').hidden || e.target.closest('input,select,textarea,[contenteditable="true"]')) return;
    const key = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey, i = item();
    if (mod && key === 'z') { e.preventDefault(); history(e.shiftKey); return; }
    if (mod && key === 'y') { e.preventDefault(); history(true); return; }
    if (mod && key === 's') { e.preventDefault(); exportProject(); return; }
    if (!i) return;
    if (mod && key === 'd') { e.preventDefault(); quantity(G.job.items.filter((t) => t.artId === i.artId).length + 1); return; }
    if (mod || e.altKey) return;
    if (key === 'delete' || key === 'backspace') { e.preventDefault(); remove(); return; }
    if (key === 'r') { e.preventDefault(); rotateTo(i.angle + 90); return; }
    const dir = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[key];
    if (dir && i.page >= 0) { e.preventDefault(); const n = e.shiftKey ? 10 : 1; alter((j) => { const t = find(j.items, i.id); t.x += dir[0] * n; t.y += dir[1] * n; }); }
  };
  window.addEventListener('keydown', onKey);

  pageApi = { render };
  render();
  const handed = takeHandoff();   // a design passed on from another tool (e.g. Gambar ulang AI)
  if (!G.restored) {
    G.restored = true; busy = true;
    restoreDraft().then((entry) => {
      if (entry && !G.job.items.length && !G.past.length) { G.rev = entry.revision || 0; G.job = validateJob(entry.job); refreshSelected(G.job.items[0]?.id); }
      else if (entry) G.rev = entry.revision || 0;
    }).catch(() => {}).finally(() => { busy = false; if (alive) { render(); if (handed) upload([handed]); } });
  } else if (handed) upload([handed]);

  return () => {
    alive = false; pageApi = null; ro.disconnect();
    window.removeEventListener('keydown', onKey); document.removeEventListener('paste', onPaste);
  };
}
