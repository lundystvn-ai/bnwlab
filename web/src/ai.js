// Gambar ulang AI: the AI redraws a blurry or broken design as a clean, sharp image for DTF.
// Credits are taken when the AI runs (and given back automatically if it fails). The AI draws on flat
// green or magenta; that background is removed here in the browser, so the download is a transparent PNG.
import { invoke } from './supa.js';
import { db } from './supa.js';
import { $, esc, icon, notice, toast, uuid, confirmBox } from './util.js';
import { L } from './i18n.js';
import { cfg } from './config.js';
import { state, authDialog, topupDialog, setCredits, refreshCredits, regionId, isAdmin } from './session.js';
import { giveHandoff } from './handoff.js';
import { removeKey, greenShare, opaqueBox } from './ai-key.js';

const PRICE = { cost: { ...cfg.aiPrices.cost }, revise: { ...cfg.aiPrices.revise }, max: 3 };
const REVISE_MINUTES = 60;
const INPUT_MAX = 2048;        // longest side sent to the AI
const MAX_FILE = 25 * 1048576;

// Kept outside the page so the work survives signing in or switching pages.
const A = {
  file: null, name: '', src: null, w: 0, h: 0,
  style: 'tajam', size: '2K', bg: 'transparent', fixes: [], strength: 50,
  versions: [], cur: -1, rootId: null, rootAt: 0, chroma: 'green', revFixes: [],
  busy: false, view: 'result', preview: 'check', mock: false, mockFail: false, downloaded: true,
};
let pageApi = null;

const STYLES = () => [
  ['tajam', L('Ilustrasi tajam', 'Sharp illustration'), L('Digambar ulang bersih, garis dan teks tegas. Cocok untuk logo, kartun, desain kaos.', 'Redrawn clean with crisp lines and text. For logos, cartoons, T-shirt designs.')],
  ['rapikan', L('Rapikan, tetap mirip asli', 'Clean up, stay faithful'), L('Perubahan sekecil mungkin: buang blur dan kotak-kotak JPG, detail asli dipertahankan.', 'Minimal changes: removes blur and JPEG blocks, keeps the original detail.')],
  ['flat', L('Vektor flat', 'Flat vector'), L('Warna rata tanpa gradasi, garis rapi. Paling enak dilanjutkan ke Vektor (SVG).', 'Solid colours, no gradients, tidy outlines. Best before Vector (SVG).')],
];

// Adjustments the customer can tick (the server holds the matching AI instructions).
const FIXES = () => [
  ['teks', L('Perjelas tulisan', 'Sharper text')], ['tebal', L('Garis lebih tebal', 'Thicker lines')], ['tipis', L('Garis lebih tipis', 'Thinner lines')],
  ['cerah', L('Warna lebih cerah', 'Brighter colours')], ['asli', L('Lebih mirip asli', 'Closer to original')], ['detail', L('Tambah detail', 'More detail')],
  ['simpel', L('Lebih sederhana', 'Simpler')], ['bersih', L('Buang bintik/kotoran', 'Remove specks')],
];
const MAX_FIXES = 3;
const chips = (id, picked, disabled = false) => `<div class="ai-chips" id="${id}" role="group">${FIXES().map(([k, name]) => `<button type="button" class="ai-chip" data-fix="${k}" aria-pressed="${picked.includes(k)}"${disabled || (!picked.includes(k) && picked.length >= MAX_FIXES) ? ' disabled' : ''}>${esc(name)}</button>`).join('')}</div>`;

const loadBitmap = async (blob) => { try { return await createImageBitmap(blob); } catch { const u = URL.createObjectURL(blob); try { const im = new Image(); im.src = u; await im.decode(); return im; } finally { setTimeout(() => URL.revokeObjectURL(u), 1000); } } };
const toB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('read')); r.readAsDataURL(blob); });
const fromB64 = async (mime, data) => (await fetch(`data:${mime};base64,${data}`)).blob();
const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const blobOf = (c, type = 'image/png', q) => new Promise((res) => c.toBlob(res, type, q));

// The image sent to the AI: at most 2048 px, transparency filled with the key colour (or white).
async function inputFor(img, w, h, fill) {
  const s = Math.min(1, INPUT_MAX / Math.max(w, h));
  const c = canvasOf(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
  const x = c.getContext('2d');
  x.fillStyle = fill; x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, c.width, c.height);
  const blob = await blobOf(c, 'image/jpeg', 0.92);
  return { mime: 'image/jpeg', data: await toB64(blob), w: c.width, h: c.height };
}

// Raw AI image → canvas with the key background removed.
async function keyed(v, strength) {
  const bmp = await loadBitmap(v.raw);
  const c = canvasOf(bmp.width, bmp.height);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0);
  if (v.chroma !== 'none') {
    const d = x.getImageData(0, 0, c.width, c.height);
    removeKey(d.data, c.width, c.height, v.chroma, { strength });
    x.putImageData(d, 0, 0);
  }
  return c;
}

export function onSignIn() { pageApi?.render(); return true; }

export function mount(host) {
  let alive = true, tick = 0, keyTimer = 0;
  PRICE.cost = { ...cfg.aiPrices.cost }; PRICE.revise = { ...cfg.aiPrices.revise };
  const open = cfg.aiEnabled || isAdmin();
  if (!open) {
    host.innerHTML = `<div class="page"><div class="page-in" style="max-width:760px">
      <div class="page-head"><div><h1>${L('Gambar ulang AI', 'AI redraw')}</h1></div></div>
      ${notice(L('Fitur ini segera hadir. Sementara itu, coba Cek Gambar dan Upscale untuk memperbaiki gambar yang kurang tajam.', 'This feature is coming soon. Meanwhile, try the Image Checker and Upscale to fix soft images.'), 'warn')}
      <p class="row"><a class="btn btn-secondary" href="#cek" data-route="cek">${L('Buka Cek Gambar', 'Open Image Checker')}</a><a class="btn btn-quiet" href="#upscale" data-route="upscale">Upscale</a></p>
    </div></div>`;
    return () => {};
  }

  host.innerHTML = `
  <div class="page"><div class="page-in" style="max-width:1180px">
    <div class="page-head"><div><h1>${L('Gambar ulang AI', 'AI redraw')} <span class="badge b-accent">Beta</span></h1>
      <p>${L('Desain pecah, buram, atau hasil foto digambar ulang oleh AI jadi bersih dan tajam, lalu latarnya dibuang otomatis. Kredit terpakai saat AI bekerja; kalau gagal, kredit kembali.', 'Broken, blurry or photographed designs are redrawn by AI as clean, sharp art, and the background is removed automatically. Credits are used when the AI runs; if it fails, they come back.')}</p></div></div>
    ${!cfg.aiEnabled ? notice(L('Hanya admin yang melihat halaman ini. Pelanggan belum bisa membukanya sampai fitur dibuka di Admin → Gambar AI.', 'Only admins can see this page. Customers cannot open it until the feature is turned on in Admin → AI.'), 'warn') : ''}
    <div class="vec-grid">
      <section class="card vec-view">
        <div class="vec-bar" id="aiBar" hidden>
          <div class="seg vec-views" role="radiogroup" aria-label="${L('Tampilan', 'View')}" id="aiViews">
            <button role="radio" data-v="source">${L('Asli', 'Original')}</button><button role="radio" data-v="result">${L('Hasil AI', 'AI result')}</button>
          </div>
          <span class="grow"></span>
          <div class="seg vec-bgs" role="radiogroup" aria-label="${L('Latar pratinjau', 'Preview background')}" id="aiBgs">
            <button role="radio" data-b="check">${L('Transparan', 'Transparent')}</button><button role="radio" data-b="white">${L('Putih', 'White')}</button><button role="radio" data-b="dark">${L('Gelap', 'Dark')}</button>
          </div>
        </div>
        <label class="dropzone vec-drop" id="aiDrop" tabindex="0">
          <input type="file" id="aiFile" accept="image/png,image/jpeg,image/webp" hidden>
          <span class="big">${icon('spark')}</span>
          <strong>${L('Tarik desain ke sini', 'Drop a design here')}</strong>
          <span class="muted small">${L('atau klik untuk memilih · bisa juga tempel (Ctrl+V)', 'or click to choose · you can also paste (Ctrl+V)')}</span>
          <span class="xs subtle">PNG, JPG, WebP</span>
        </label>
        <div class="vec-stage ai-stage" id="aiStage" hidden>
          <div class="ai-sheet bg-check" id="aiSheet"><canvas id="aiCanvas"></canvas></div>
          <div class="chk-busy" id="aiBusy" hidden><span class="spin"></span><span id="aiBusyText"></span></div>
        </div>
        <div class="ai-versions" id="aiVersions" hidden></div>
        <div class="row chk-meta" id="aiMeta" hidden>
          <span class="xs muted" id="aiName"></span><span class="grow"></span>
          <button class="btn btn-quiet btn-sm" id="aiOther">${L('Gambar lain', 'Another image')}</button>
        </div>
      </section>
      <section class="card stack vec-side" id="aiSide"></section>
    </div>
  </div></div>`;

  // The message survives the side panel being redrawn.
  const say = (m, t = 'ok') => { A.msg = m ? [m, t] : null; const el = $('aiMsg'); if (el) el.innerHTML = m ? notice(m, t) : ''; };
  const busy = (text) => { const b = $('aiBusy'); if (!b) return; b.hidden = !text; $('aiBusyText').textContent = text || ''; };
  const cur = () => A.versions[A.cur] || null;
  const revLeft = () => PRICE.max - A.versions.filter((v) => v.parent && v.parent === A.rootId).length;
  const revOpen = () => A.rootId && Date.now() - A.rootAt < REVISE_MINUTES * 60000 && revLeft() > 0;

  // ---------- side panel ----------
  function side() {
    const v = cur();
    const c = PRICE.cost[A.size], r = PRICE.revise[v?.size || A.size];
    const afterHtml = v ? `      <div class="ai-after stack">
        <div class="vec-field"><div class="row"><label for="aiStrength">${L('Pembersihan latar', 'Background cleanup')}</label><span class="grow"></span><output class="val">${A.strength}%</output></div>
          <input type="range" id="aiStrength" min="0" max="100" step="5" value="${A.strength}"${v.chroma === 'none' ? ' disabled' : ''}>
          <p class="hint">${L('Naikkan kalau masih ada sisa hijau di tepi; turunkan kalau bagian desain ikut hilang.', 'Raise it if green is left on the edges; lower it if parts of the design disappear.')}</p></div>
        <button class="btn btn-primary btn-lg btn-block" id="aiDl">${icon('download', 'i i-sm')}${L('Unduh PNG', 'Download PNG')} <span class="cost">· ${L('gratis', 'free')}</span></button>
        <label class="row xs muted" style="gap:8px"><input type="checkbox" id="aiTrim" checked> ${L('Potong ruang kosong di sekeliling desain', 'Trim empty space around the design')}</label>
        <div class="ai-next"><span class="xs muted">${L('Lanjutkan ke:', 'Continue in:')}</span>
          <button class="btn btn-secondary btn-sm" data-next="upscale">Upscale</button><button class="btn btn-secondary btn-sm" data-next="vektor">${L('Vektor', 'Vector')}</button><button class="btn btn-secondary btn-sm" data-next="gangsheet">Gangsheet</button><button class="btn btn-secondary btn-sm" data-next="editor">Halftone</button></div>
        <div class="ai-rev stack">
          <div class="row"><b class="small">${L('Revisi', 'Revise')}</b><span class="grow"></span><span class="xs muted">${revOpen() ? L(`sisa ${revLeft()}× · ${r} kredit`, `${revLeft()} left · ${r} credits`) : L('tidak tersedia', 'not available')}</span></div>
          <span class="xs muted">${L(`Pilih yang perlu diperbaiki (maks. ${MAX_FIXES}):`, `Pick what to fix (up to ${MAX_FIXES}):`)}</span>
          ${chips('aiRevFix', A.revFixes, !revOpen())}
          <button class="btn btn-secondary btn-block" id="aiRev"${revOpen() && !A.busy && A.revFixes.length ? '' : ' disabled'}>${icon('redo', 'i i-sm')}${L('Revisi hasil ini', 'Revise this result')} <span class="cost">· ${r} ${L('kredit', 'credits')}</span></button>
          <p class="hint" style="margin:0">${L(`Maksimal ${PRICE.max} revisi per gambar, dalam ${REVISE_MINUTES} menit setelah gambar dibuat.`, `Up to ${PRICE.max} revisions per image, within ${REVISE_MINUTES} minutes of creating it.`)}</p>
        </div>
      </div>` : '';
    $('aiSide').innerHTML = `
      <div id="aiMsg" aria-live="polite">${A.msg ? notice(A.msg[0], A.msg[1]) : ''}</div>
      ${afterHtml}
      ${v ? `<h2 class="ai-again">${L('Buat ulang dengan pengaturan lain', 'Redraw with other settings')}</h2>` : ''}
      <h2 style="margin:0;font-size:var(--text-base)">${L('Gaya', 'Style')}</h2>
      <div class="ai-styles" role="radiogroup" aria-label="${L('Gaya', 'Style')}">${STYLES().map(([id, name, hint]) => `
        <button class="ai-style" role="radio" data-style="${id}" aria-checked="${A.style === id}"><b>${esc(name)}</b><span class="xs muted">${esc(hint)}</span></button>`).join('')}</div>
      <div class="vec-field"><label>${L('Resolusi hasil', 'Output size')}</label>
        <div class="seg" role="radiogroup" id="aiSize"><button role="radio" data-size="2K" aria-checked="${A.size === '2K'}">2K · ${PRICE.cost['2K']} ${L('kredit', 'credits')}</button><button role="radio" data-size="4K" aria-checked="${A.size === '4K'}">4K · ${PRICE.cost['4K']} ${L('kredit', 'credits')}</button></div>
        <p class="hint">${A.size === '2K' ? L('±2048 px: cukup untuk logo dan desain dada (±17 cm di 300 dpi).', '±2048 px: enough for logos and chest prints (±17 cm at 300 dpi).') : L('±4096 px: untuk desain punggung atau A3 (±35 cm di 300 dpi). Kalau AI hanya menghasilkan ukuran lebih kecil, selisih kredit dikembalikan.', '±4096 px: for back prints or A3 (±35 cm at 300 dpi). If the AI returns a smaller image, the difference is refunded.')}</p></div>
      <div class="vec-field"><label for="aiBgSel">${L('Latar hasil', 'Result background')}</label>
        <select class="sel vec-sel" id="aiBgSel"><option value="transparent"${A.bg === 'transparent' ? ' selected' : ''}>${L('Buang latar (PNG transparan)', 'Remove background (transparent PNG)')}</option><option value="keep"${A.bg === 'keep' ? ' selected' : ''}>${L('Pertahankan latar asli', 'Keep the original background')}</option></select></div>
      <div class="vec-field"><label>${L('Penyesuaian', 'Adjustments')} <span class="muted xs">(${L(`opsional, maks. ${MAX_FIXES}`, `optional, up to ${MAX_FIXES}`)})</span></label>
        ${chips('aiFix', A.fixes)}</div>
      ${isAdmin() ? `<div class="stack" style="gap:4px"><label class="row xs muted" style="gap:8px"><input type="checkbox" id="aiMock"${A.mock ? ' checked' : ''}> ${L('Uji coba tanpa AI (admin): alur kredit sungguhan, gambar asli dikembalikan.', 'Dry run without AI (admin): real credit flow, the original image comes back.')}</label>
        <label class="row xs muted" style="gap:8px"${A.mock ? '' : ' hidden'}><input type="checkbox" id="aiMockFail"${A.mockFail ? ' checked' : ''}> ${L('Simulasikan AI gagal (cek kredit kembali)', 'Simulate an AI failure (check the refund)')}</label></div>` : ''}
      <button class="btn ${v ? 'btn-secondary' : 'btn-primary btn-lg'} btn-block" id="aiGo"${!A.src || A.busy ? ' disabled' : ''}>${icon('spark', 'i i-sm')}${v ? L('Gambar ulang lagi', 'Redraw again') : L('Gambar ulang', 'Redraw')} <span class="cost">· ${c} ${L('kredit', 'credits')}</span></button>
      <p class="hint" style="margin:0">${L('Hasil AI bisa berbeda sedikit dari aslinya, jadi cek dulu sebelum dicetak. Pakai hanya desain yang Anda berhak cetak. Hasil hanya disimpan selama halaman ini terbuka.', 'AI results can differ slightly from the original, so check before printing. Only use designs you have the right to print. Results are kept only while this page is open.')}</p>`;
    bindSide();
  }

  function bindSide() {
    $('aiSide').querySelectorAll('[data-style]').forEach((b) => (b.onclick = () => { A.style = b.dataset.style; side(); }));
    $('aiSize').onclick = (e) => { const b = e.target.closest('[data-size]'); if (!b) return; A.size = b.dataset.size; side(); };
    $('aiBgSel').onchange = () => { A.bg = $('aiBgSel').value; };
    const pick = (list) => (e) => { const b = e.target.closest('[data-fix]'); if (!b || b.disabled) return; const k = b.dataset.fix; const i = list.indexOf(k); if (i >= 0) list.splice(i, 1); else if (list.length < MAX_FIXES) list.push(k); side(); };
    $('aiFix').onclick = pick(A.fixes);
    if ($('aiMock')) $('aiMock').onchange = () => { A.mock = $('aiMock').checked; side(); };
    if ($('aiMockFail')) $('aiMockFail').onchange = () => { A.mockFail = $('aiMockFail').checked; };
    $('aiGo').onclick = () => run(false);
    if (!cur()) return;
    $('aiStrength').oninput = () => {
      A.strength = Number($('aiStrength').value);
      $('aiStrength').previousElementSibling.querySelector('output').textContent = A.strength + '%';
      clearTimeout(keyTimer); keyTimer = setTimeout(async () => { const v = cur(); if (!v) return; v.canvas = await keyed(v, A.strength); v.strength = A.strength; draw(); }, 180);
    };
    $('aiDl').onclick = download;
    $('aiRevFix').onclick = pick(A.revFixes);
    $('aiRev').onclick = () => run(true);
    $('aiSide').querySelectorAll('[data-next]').forEach((b) => (b.onclick = () => handOff(b.dataset.next)));
  }

  // ---------- preview ----------
  function draw() {
    const has = !!A.src;
    $('aiDrop').hidden = has; $('aiStage').hidden = !has; $('aiMeta').hidden = !has;
    $('aiBar').hidden = !has || !A.versions.length;
    if (!has) { $('aiVersions').hidden = true; return; }
    $('aiName').textContent = `${A.name} · ${A.w}×${A.h} px`;
    const v = cur();
    const showResult = !!(v && v.canvas && A.view === 'result');
    const sheet = $('aiSheet');
    sheet.className = 'ai-sheet bg-' + (showResult ? A.preview : 'white');
    const c = $('aiCanvas');
    const img = showResult ? v.canvas : A.src;
    const iw = showResult ? v.canvas.width : A.w, ih = showResult ? v.canvas.height : A.h;
    const stage = $('aiStage');
    const fit = Math.min((stage.clientWidth - 24) / iw, (stage.clientHeight - 24) / ih, 1);
    const dw = Math.max(1, Math.round(iw * fit)), dh = Math.max(1, Math.round(ih * fit));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(dw * dpr); c.height = Math.round(dh * dpr);
    sheet.style.width = dw + 'px'; sheet.style.height = dh + 'px';
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.clearRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    $('aiViews').querySelectorAll('[data-v]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === (showResult ? 'result' : 'source'))));
    $('aiBgs').querySelectorAll('[data-b]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.b === A.preview)));
    $('aiBgs').hidden = !showResult;
    const vs = $('aiVersions');
    vs.hidden = A.versions.length < 2;
    vs.innerHTML = A.versions.map((t, i) => `<button class="ai-ver" data-i="${i}" aria-pressed="${i === A.cur}" title="${esc(t.label)}"><img src="${t.thumb}" alt=""><span class="xs">${esc(t.label)}</span></button>`).join('');
    vs.querySelectorAll('[data-i]').forEach((b) => (b.onclick = async () => { const i = Number(b.dataset.i); if (i === A.cur) return; const prev = cur(); if (prev) prev.canvas = null; A.cur = i; const t = cur(); const root = t.parent ? A.versions.find((x) => x.id === t.parent) || t : t; A.rootId = root.id; A.rootAt = root.at || 0; A.chroma = root.chroma; if (!t.canvas || t.strength !== A.strength) { t.canvas = await keyed(t, A.strength); t.strength = A.strength; } A.view = 'result'; draw(); side(); }));
  }
  $('aiViews').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; A.view = b.dataset.v; draw(); };
  $('aiBgs').onclick = (e) => { const b = e.target.closest('[data-b]'); if (!b) return; A.preview = b.dataset.b; draw(); };

  // ---------- input ----------
  async function load(f) {
    if (!f || A.busy) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(f.type) && !/\.(png|jpe?g|webp)$/i.test(f.name || '')) { say(L('Format harus PNG, JPG, atau WebP.', 'The format must be PNG, JPG or WebP.'), 'error'); return; }
    if (f.size > MAX_FILE) { say(L('File terlalu besar (maks. 25 MB).', 'The file is too large (max 25 MB).'), 'error'); return; }
    if (A.versions.length && !A.downloaded && !(await confirmBox({ title: L('Ganti gambar?', 'Replace the image?'), body: L('Hasil AI sebelumnya belum diunduh dan akan hilang.', 'The previous AI result has not been downloaded and will be lost.'), okLabel: L('Ganti', 'Replace') }))) return;
    try {
      const img = await loadBitmap(f);
      Object.assign(A, { file: f, name: (f.name || 'desain').replace(/\.[^.]+$/, '') || 'desain', src: img, w: img.width, h: img.height, versions: [], cur: -1, rootId: null, rootAt: 0, view: 'result', downloaded: true });
      say(''); draw(); side();
    } catch { say(L('File ini tidak bisa dibaca. Pilih PNG, JPG, atau WebP yang valid.', 'This file cannot be read. Choose a valid PNG, JPG or WebP.'), 'error'); }
  }
  $('aiFile').onchange = () => { load($('aiFile').files?.[0]); $('aiFile').value = ''; };
  const drop = $('aiDrop');
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('aiFile').click(); } };
  ['dragenter', 'dragover'].forEach((t) => host.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  host.addEventListener('dragleave', () => drop.classList.remove('over'));
  host.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); load(e.dataTransfer?.files?.[0]); });
  const onPaste = (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) load(f); };
  document.addEventListener('paste', onPaste);
  $('aiOther').onclick = () => $('aiFile').click();

  // ---------- the AI call ----------
  async function run(revision) {
    if (A.busy || !A.src) return;
    if (!state.user) { say(L('Daftar atau masuk dulu untuk memakai AI.', 'Sign up or sign in to use the AI.'), 'warn'); authDialog('daftar', '', () => run(revision)); return; }
    const base = revision ? cur() : null;
    if (revision && (!base || !revOpen())) return;
    const fixes = [...(revision ? A.revFixes : A.fixes)];
    if (revision && !fixes.length) { say(L('Pilih dulu apa yang perlu direvisi.', 'Pick what to revise first.'), 'warn'); return; }
    const size = revision ? base.size : A.size;
    const cost = revision ? PRICE.revise[size] : PRICE.cost[size];
    if (state.credits < cost) { topupDialog(L(`Kredit tidak cukup. ${revision ? 'Revisi' : 'Gambar ulang AI'} ${size} memakai ${cost} kredit.`, `Not enough credits. ${revision ? 'A revision' : 'An AI redraw'} at ${size} uses ${cost} credits.`)); return; }

    A.busy = true; say(''); side();
    const started = Date.now();
    const label = () => L(`AI sedang menggambar… ${Math.round((Date.now() - started) / 1000)} dtk (biasanya 15–60 dtk)`, `The AI is drawing… ${Math.round((Date.now() - started) / 1000)} s (usually 15–60 s)`);
    busy(label()); tick = setInterval(() => { if (alive) busy(label()); }, 1000);
    try {
      let chroma = A.chroma, input;
      if (revision) {
        chroma = base.chroma;
        const bmp = await loadBitmap(base.raw);
        input = await inputFor(bmp, bmp.width, bmp.height, chroma === 'magenta' ? '#ff00ff' : chroma === 'green' ? '#00ff00' : '#ffffff');
      } else {
        if (A.bg === 'keep') chroma = 'none';
        else {
          const probe = canvasOf(Math.min(256, A.w), Math.min(256, A.h)), px = probe.getContext('2d', { willReadFrequently: true });
          px.drawImage(A.src, 0, 0, probe.width, probe.height);
          chroma = greenShare(px.getImageData(0, 0, probe.width, probe.height).data) > 0.06 ? 'magenta' : 'green';
        }
        input = await inputFor(A.src, A.w, A.h, chroma === 'magenta' ? '#ff00ff' : chroma === 'green' ? '#00ff00' : '#ffffff');
      }
      const id = uuid();
      const r = await invoke('ai-redraw', {
        action: 'generate', id, parent: revision ? A.rootId : undefined, size, style: A.style, chroma, fixes,
        image: { mime: input.mime, data: input.data }, w: input.w, h: input.h,
        mock: A.mock && isAdmin() ? true : undefined, mock_fail: A.mock && A.mockFail && isAdmin() ? true : undefined,
      });
      setCredits(r.balance);
      const raw = await fromB64(r.mime || 'image/png', r.image);
      const v = { id, parent: revision ? A.rootId : null, raw, chroma, size, w: r.w, h: r.h, cost: r.cost, strength: A.strength };
      v.canvas = await keyed(v, A.strength);
      const t = canvasOf(96, Math.max(1, Math.round(96 * v.canvas.height / v.canvas.width))); t.getContext('2d').drawImage(v.canvas, 0, 0, t.width, t.height);
      v.thumb = t.toDataURL('image/png');
      const roots = A.versions.filter((x) => !x.parent).length;
      if (!revision) { A.revFixes.length = 0; v.at = Date.now(); A.rootId = id; A.rootAt = v.at; A.chroma = chroma; v.label = roots ? L(`Hasil ${roots + 1}`, `Result ${roots + 1}`) : L('Hasil', 'Result'); }
      else { const n = A.versions.filter((x) => x.parent === A.rootId).length + 1; v.label = L(`Revisi ${n}`, `Revision ${n}`); }
      const prev = cur(); if (prev) prev.canvas = null;   // keep memory low: only the shown result stays decoded
      A.versions.push(v);
      A.cur = A.versions.length - 1; A.view = 'result'; A.downloaded = false;
      if (revision) A.revFixes.length = 0;
      toast(L(`Selesai. ${r.cost} kredit terpakai, sisa ${r.balance}.`, `Done. ${r.cost} credits used, ${r.balance} left.`));
      if (size === '4K' && r.w && Math.max(r.w, r.h) < 3000) say(L(`AI hanya menghasilkan ${r.w}×${r.h} px, jadi dihitung harga 2K dan selisih kreditnya sudah dikembalikan.`, `The AI only returned ${r.w}×${r.h} px, so it was charged at the 2K price and the difference was refunded.`), 'warn');
      db.from('halftone_image_history').insert({
        user_id: state.user.id, username: state.profile?.username || 'Pengguna', wilayah_id: regionId(),
        file_name: `${A.name}-ai.png`.slice(0, 255), operation: 'ai_redraw', image_width: v.canvas.width, image_height: v.canvas.height, garment_color: 'white',
      }).then(() => {}, () => {});
    } catch (e) {
      const m = String(e.message || e);
      refreshCredits();
      if (/insufficient_credits/.test(m)) topupDialog(L(`Kredit tidak cukup. ${revision ? 'Revisi' : 'Gambar ulang AI'} ${size} memakai ${cost} kredit.`, `Not enough credits. This uses ${cost} credits.`));
      else say(esc(m), 'error');
    } finally {
      clearInterval(tick); A.busy = false;
      if (alive && host.isConnected) { busy(''); draw(); side(); } else pageApi?.refresh?.();
    }
  }

  // ---------- output ----------
  async function finalCanvas() {
    const v = cur(); if (!v) return null;
    if (!$('aiTrim')?.checked || v.chroma === 'none') return v.canvas;
    const x = v.canvas.getContext('2d', { willReadFrequently: true });
    const box = opaqueBox(x.getImageData(0, 0, v.canvas.width, v.canvas.height).data, v.canvas.width, v.canvas.height);
    if (!box) return v.canvas;
    const pad = Math.round(Math.max(box.w, box.h) * 0.01);
    const bx = Math.max(0, box.x - pad), by = Math.max(0, box.y - pad);
    const c = canvasOf(Math.min(v.canvas.width - bx, box.w + pad * 2), Math.min(v.canvas.height - by, box.h + pad * 2));
    c.getContext('2d').drawImage(v.canvas, bx, by, c.width, c.height, 0, 0, c.width, c.height);
    return c;
  }
  async function pngFile() {
    const c = await finalCanvas(); if (!c) return null;
    let blob = await blobOf(c, 'image/png');
    try { const { setPngDpi } = await import('./engine.js'); blob = new Blob([setPngDpi(await blob.arrayBuffer(), 300)], { type: 'image/png' }); } catch { /* keep without DPI */ }
    const v = cur();
    return new File([blob], `${A.name}-ai${v.parent ? '-revisi' : ''}.png`, { type: 'image/png' });
  }
  async function download() {
    const f = await pngFile(); if (!f) return;
    const url = URL.createObjectURL(f);
    const a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    A.downloaded = true;
    toast(L(`${f.name} diunduh (300 dpi).`, `${f.name} downloaded (300 dpi).`));
  }
  async function handOff(route) {
    const f = await pngFile(); if (!f) return;
    giveHandoff(f); A.downloaded = true; location.hash = route;
  }

  const onUnload = (e) => { if (A.versions.length && !A.downloaded) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onUnload);
  const ro = new ResizeObserver(() => { if (alive && host.isConnected) draw(); });
  ro.observe($('aiStage'));

  // Prices from the server (in case they change).
  if (state.user) invoke('ai-redraw', { action: 'info' }).then((r) => { if (r?.cost) { PRICE.cost = r.cost; PRICE.revise = r.revise; PRICE.max = r.max_revisions || PRICE.max; if (alive) side(); } }).catch(() => {});

  pageApi = { render: () => { if (alive) side(); }, refresh: () => { if (alive) { busy(''); draw(); side(); } } };
  draw(); side();
  if (A.busy) busy(L('AI sedang menggambar…', 'The AI is drawing…'));
  import('./handoff.js').then(({ takeHandoff }) => { const f = takeHandoff(); if (f) load(f); });
  return () => { alive = false; pageApi = null; clearInterval(tick); clearTimeout(keyTimer); ro.disconnect(); document.removeEventListener('paste', onPaste); window.removeEventListener('beforeunload', onUnload); };
}
