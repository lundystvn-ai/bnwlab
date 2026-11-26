// Vektor: turn a logo or flat design into an SVG of curves. Tracing runs in the browser (Web Worker);
// previewing is free, downloading the SVG costs 1 credit.
import { db } from './supa.js';
import { $, esc, icon, notice, num, toast, uuid, previewMark } from './util.js';
import { L, tr } from './i18n.js';
import { state, authDialog, topupDialog, setCredits, regionId, clearSession } from './session.js';

const DEFAULTS = { colors: 6, smooth: 60, corners: 60, noise: 2, omitWhite: false };
const ZOOMS = [1, 1.5, 2, 3, 4, 6];
const MAX_CANVAS = 3600;            // longest side of a preview canvas, in device pixels

// Kept outside the page so the work survives signing in or switching pages.
const V = {
  name: '', file: null, img: null, w: 0, h: 0,
  opts: { ...DEFAULTS }, result: null, svgImg: null, traced: null,
  view: 'vector', bg: 'check', zoom: 0, panX: 0, panY: 0, split: 50,
};

const loadImage = (src) => new Promise((res, rej) => {
  const im = new Image();
  im.onload = () => (im.naturalWidth && im.naturalHeight ? res(im) : rej(new Error('bad')));
  im.onerror = () => rej(new Error('bad'));
  im.src = src;
});

const STEP = () => ({
  palette: L('Membaca warna', 'Reading colours'),
  regions: L('Memisahkan bidang warna', 'Separating colour areas'),
  curves: L('Membentuk kurva', 'Fitting curves'),
});
const errorText = (code) => ({
  TOO_COMPLEX: L('Gambar terlalu rumit untuk dijadikan vektor. Kurangi jumlah warna atau naikkan "Buang bintik kecil".', 'The image is too complex to vectorise. Use fewer colours or raise "Remove small specks".'),
  BROKEN_CONTOUR: L('Garis tepi gambar tidak tersambung. Coba ubah jumlah warna sedikit.', 'An outline in the image does not connect. Try a slightly different number of colours.'),
  OVERLAPPING_CONTOUR: L('Garis tepi gambar bertumpuk. Coba ubah jumlah warna sedikit.', 'Outlines in the image overlap. Try a slightly different number of colours.'),
})[code] || L('Gambar gagal diproses. Coba gambar lain.', 'The image could not be processed. Try another image.');

// A small flat sample design, drawn here, so first-time visitors can try the tool straight away.
function sampleImage() {
  const c = document.createElement('canvas'); c.width = 760; c.height = 460;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 760, 460);
  x.fillStyle = '#f2b51d'; x.beginPath(); x.arc(380, 205, 150, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#e8432f'; x.beginPath(); x.arc(380, 205, 150, Math.PI * 0.05, Math.PI * 0.95); x.fill();
  x.fillStyle = '#1b1d22';
  x.beginPath(); x.moveTo(170, 300);
  x.bezierCurveTo(260, 240, 320, 330, 400, 280); x.bezierCurveTo(470, 236, 540, 300, 600, 268);
  x.lineTo(600, 330); x.lineTo(170, 330); x.closePath(); x.fill();
  for (let i = 0; i < 5; i++) { x.fillRect(250 + i * 58, 112 + i * 6, 34, 8); }
  x.font = '800 64px system-ui, sans-serif'; x.textAlign = 'center';
  x.fillText('BNW LAB', 380, 410);
  x.fillStyle = '#ffffff'; x.beginPath(); x.arc(470, 150, 18, 0, Math.PI * 2); x.fill();
  return new Promise((res) => c.toBlob((b) => res(new File([b], 'contoh-bnw.png', { type: 'image/png' })), 'image/png'));
}

export function mount(host) {
  let alive = true, worker = null, timer = 0, run = 0, drag = null, renderTimer = 0;
  host.innerHTML = `
  <div class="page"><div class="page-in" style="max-width:1180px">
    <div class="page-head"><div><h1>${L('Vektor', 'Vector')}</h1>
      <p>${L('Ubah logo dan desain warna rata jadi SVG (kurva) yang tetap tajam di ukuran berapa pun. Pratinjau gratis; unduh SVG 1 kredit.', 'Turn logos and flat-colour designs into an SVG of curves that stays sharp at any size. Previews are free; downloading the SVG is 1 credit.')}</p></div></div>
    <div class="vec-grid">
      <section class="card vec-view">
        <div class="vec-bar" id="vecBar" hidden>
          <div class="seg vec-views" role="radiogroup" aria-label="${L('Tampilan', 'View')}" id="vecViews">
            <button role="radio" data-v="source">${L('Asli', 'Original')}</button><button role="radio" data-v="vector">${L('Vektor', 'Vector')}</button><button role="radio" data-v="compare">${L('Bandingkan', 'Compare')}</button>
          </div>
          <span class="grow"></span>
          <div class="seg vec-bgs" role="radiogroup" aria-label="${L('Latar pratinjau', 'Preview background')}" id="vecBgs">
            <button role="radio" data-b="check">${L('Transparan', 'Transparent')}</button><button role="radio" data-b="white">${L('Putih', 'White')}</button><button role="radio" data-b="dark">${L('Gelap', 'Dark')}</button>
          </div>
          <div class="vec-zoom" role="group" aria-label="${L('Perbesaran', 'Zoom')}">
            <button class="ibtn" id="vecZoomOut" aria-label="${L('Perkecil', 'Zoom out')}">${icon('minus', 'i i-sm')}</button>
            <button class="ibtn vec-zoomval" id="vecZoomVal" title="${L('Pas ke layar', 'Fit to view')}">100%</button>
            <button class="ibtn" id="vecZoomIn" aria-label="${L('Perbesar', 'Zoom in')}">${icon('plus', 'i i-sm')}</button>
          </div>
        </div>
        <label class="dropzone vec-drop" id="vecDrop" tabindex="0">
          <input type="file" id="vecFile" accept="image/png,image/jpeg,image/webp" hidden>
          <span class="big">${icon('pen')}</span>
          <strong>${L('Tarik logo atau desain ke sini', 'Drop a logo or design here')}</strong>
          <span class="muted small">${L('atau klik untuk memilih · bisa juga tempel (Ctrl+V)', 'or click to choose · you can also paste (Ctrl+V)')}</span>
          <span class="xs subtle">PNG, JPG, WebP</span>
        </label>
        <p class="vec-sample" id="vecSampleRow"><button class="btn btn-quiet btn-sm" id="vecSample" type="button">${L('Coba pakai contoh', 'Try a sample')}</button></p>
        <div class="vec-stage" id="vecStage" hidden>
          <div class="vec-sheet bg-check" id="vecSheet">
            <canvas id="vecOrig"></canvas><canvas id="vecRes"></canvas>
            <div class="vec-divider" id="vecDivider" hidden><button class="vec-knob" id="vecKnob" role="slider" aria-label="${L('Batas perbandingan', 'Compare divider')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">${icon('lr', 'i i-sm')}</button></div>
          </div>
          <div class="vec-legend" id="vecLegend" hidden><span>${L('Asli', 'Original')}</span><span>${L('Vektor', 'Vector')}</span></div>
          <div class="chk-busy" id="vecBusy" hidden><span class="spin"></span><span id="vecBusyText"></span></div>
        </div>
        <div class="row chk-meta" id="vecMeta" hidden>
          <span class="xs muted" id="vecName"></span><span class="grow"></span>
          <button class="btn btn-quiet btn-sm" id="vecOther">${L('Gambar lain', 'Another image')}</button>
        </div>
      </section>
      <section class="card stack vec-side">
        <div class="row"><h2 style="margin:0;font-size:var(--text-base)">${L('Pengaturan', 'Settings')}</h2><span class="grow"></span><button class="btn btn-quiet btn-sm" id="vecReset">${L('Atur ulang', 'Reset')}</button></div>
        <div class="vec-field"><div class="row"><label for="vecColors">${L('Jumlah warna maksimal', 'Maximum colours')}</label><span class="grow"></span><output class="val" id="vecColorsVal"></output></div>
          <input type="range" id="vecColors" min="1" max="12" step="1"></div>
        <div class="vec-field"><div class="row"><label for="vecSmooth">${L('Kehalusan kurva', 'Curve smoothness')}</label><span class="grow"></span><output class="val" id="vecSmoothVal"></output></div>
          <input type="range" id="vecSmooth" min="0" max="100" step="1"></div>
        <div class="vec-field"><div class="row"><label for="vecCorners">${L('Ketajaman sudut', 'Corner sharpness')}</label><span class="grow"></span><output class="val" id="vecCornersVal"></output></div>
          <input type="range" id="vecCorners" min="0" max="100" step="1"></div>
        <div class="vec-field"><div class="row"><label for="vecNoise">${L('Buang bintik kecil', 'Remove small specks')}</label><span class="grow"></span><output class="val" id="vecNoiseVal"></output></div>
          <input type="range" id="vecNoise" min="0" max="32" step="1">
          <p class="hint">${L('Turunkan kalau titik huruf (i, j) atau garis tipis ikut hilang.', 'Lower it if the dots on i and j or thin lines disappear.')}</p></div>
        <div class="vec-field"><label for="vecWhite">${L('Warna putih', 'White areas')}</label>
          <select class="sel vec-sel" id="vecWhite"><option value="keep">${L('Tetap jadi warna putih', 'Keep as white ink')}</option><option value="omit">${L('Jadikan transparan', 'Make transparent')}</option></select>
          <p class="hint" id="vecWhiteHint"></p></div>
        <div id="vecMsg" aria-live="polite"></div>
        <div class="vec-inks" id="vecInks" hidden></div>
        <button class="btn btn-primary btn-lg btn-block" id="vecDl" disabled>${icon('download', 'i i-sm')}${L('Unduh SVG', 'Download SVG')} <span class="cost">· ${L('1 kredit', '1 credit')}</span></button>
        <p class="hint" style="margin:0">${L('Paling bagus untuk logo, teks, dan desain warna rata. Foto dan gradasi akan disederhanakan jadi beberapa warna.', 'Works best for logos, lettering and flat-colour designs. Photos and gradients are simplified to a few colours.')}</p>
      </section>
    </div>
  </div></div>`;

  const say = (m, t = 'ok') => { const el = $('vecMsg'); if (el) el.innerHTML = m ? notice(m, t) : ''; };
  const busy = (text) => { const b = $('vecBusy'); if (!b) return; b.hidden = !text; $('vecBusyText').textContent = text || ''; };

  // ---------- settings ----------
  const ids = { colors: 'vecColors', smooth: 'vecSmooth', corners: 'vecCorners', noise: 'vecNoise' };
  function syncSettings() {
    for (const [k, id] of Object.entries(ids)) {
      $(id).value = String(V.opts[k]);
      $(id + 'Val').textContent = k === 'noise' ? `${V.opts[k]} px²` : k === 'colors' ? String(V.opts[k]) : `${V.opts[k]}%`;
    }
    $('vecWhite').value = V.opts.omitWhite ? 'omit' : 'keep';
    $('vecWhiteHint').textContent = V.opts.omitWhite
      ? L('Semua putih dan hampir putih jadi transparan, termasuk detail putih di dalam desain.', 'All white and near-white becomes transparent, including white details inside the design.')
      : L('Bagian putih tetap jadi warna di SVG.', 'White areas stay as a colour in the SVG.');
  }
  for (const [k, id] of Object.entries(ids)) $(id).addEventListener('input', () => { V.opts[k] = Number($(id).value); syncSettings(); schedule(); });
  $('vecWhite').onchange = () => { V.opts.omitWhite = $('vecWhite').value === 'omit'; syncSettings(); schedule(30); };
  $('vecReset').onclick = () => { V.opts = { ...DEFAULTS }; syncSettings(); schedule(30); };

  // ---------- tracing ----------
  function stop() { run++; clearTimeout(timer); if (worker) { worker.terminate(); worker = null; } }
  function schedule(delay = 180) {
    stop();
    if (!V.img) return;
    $('vecDl').disabled = true;
    busy(L('Memproses…', 'Processing…'));
    const token = run;
    timer = setTimeout(() => trace(token, 1800), delay);
  }
  function trace(token, cap) {
    if (token !== run || !V.img || !alive) return;
    const ow = V.w, oh = V.h;
    const f = Math.min(1, cap / Math.max(ow, oh), Math.sqrt(2400000 / (ow * oh)));
    const w = Math.max(1, Math.round(ow * f)), h = Math.max(1, Math.round(oh * f));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(V.img, 0, 0, w, h);
    const bytes = cx.getImageData(0, 0, w, h).data.buffer;
    const opts = { ...V.opts };
    const fail = (code) => {
      if (token !== run) return;
      if (code === 'TOO_COMPLEX' && Math.max(w, h) > 360) { busy(L('Menyesuaikan resolusi…', 'Adjusting resolution…')); timer = setTimeout(() => trace(token, Math.max(320, Math.floor(Math.max(w, h) * 0.7))), 30); return; }
      busy(''); V.result = null; V.svgImg = null; showInks(); render(); say(errorText(code), 'error');
    };
    const done = (result) => { if (token === run) finish(result, w, h, token); };
    const inline = async () => {
      try { const m = await import('./vector-engine.js'); done(m.vectorizeRaster(new Uint8ClampedArray(bytes), w, h, ow, oh, opts, () => {})); }
      catch (e) { fail(e.message); }
    };
    try {
      const wk = new Worker(new URL('./vector-worker.js', import.meta.url), { type: 'module' });
      worker = wk;
      const close = () => { wk.terminate(); if (worker === wk) worker = null; };
      wk.onmessage = (e) => {
        if (token !== run) { close(); return; }
        const d = e.data;
        if (d.result) { close(); done(d.result); }
        else if (d.error) { close(); fail(d.error); }
        else if (d.label) busy((STEP()[d.label] || L('Memproses', 'Processing')) + '…');
      };
      wk.onerror = (e) => { e.preventDefault?.(); close(); inline(); };
      wk.postMessage({ bytes, w, h, ow, oh, settings: opts }, [bytes]);
    } catch { inline(); }
  }
  async function finish(result, w, h, token) {
    V.result = result; V.traced = { w, h };
    V.svgImg = null;
    if (result.svg) {
      const url = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
      try { V.svgImg = await loadImage(url); } catch { V.svgImg = null; }
      URL.revokeObjectURL(url);
    }
    if (token !== run || !alive) return;
    busy('');
    showInks(); render();
    if (!result.svg) say(V.opts.omitWhite ? L('Tidak ada warna yang tersisa. Pilih "Tetap jadi warna putih" atau turunkan "Buang bintik kecil".', 'No colour is left. Choose "Keep as white ink" or lower "Remove small specks".') : L('Tidak ada bidang warna yang terbaca. Turunkan "Buang bintik kecil" atau coba gambar lain.', 'No colour areas were found. Lower "Remove small specks" or try another image.'), 'warn');
    else say(w !== V.w || h !== V.h ? L(`Siap. Ditelusuri pada ${num(w)} × ${num(h)} px supaya cepat; SVG tetap berukuran ${num(V.w)} × ${num(V.h)}.`, `Ready. Traced at ${num(w)} × ${num(h)} px for speed; the SVG keeps the ${num(V.w)} × ${num(V.h)} size.`) : L('Siap. Cek hasilnya, lalu unduh SVG.', 'Ready. Check the result, then download the SVG.'));
    $('vecDl').disabled = !result.svg;
  }
  function showInks() {
    const box = $('vecInks'); if (!box) return;
    const r = V.result;
    if (!r || !r.colors?.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `<div class="row" style="gap:6px;flex-wrap:wrap">${r.colors.map((c) => `<span class="vec-chip" style="background:${esc(c)}" title="${esc(c)}"></span>`).join('')}</div>
      <span class="xs muted">${num(r.colors.length)} ${L('warna', r.colors.length === 1 ? 'colour' : 'colours')} · ${num(r.rings)} ${L('bentuk', 'shapes')}</span>`;
  }

  // ---------- view ----------
  function layout() {
    const stage = $('vecStage'), sheet = $('vecSheet'); if (!stage || !V.img) return null;
    const vw = stage.clientWidth, vh = stage.clientHeight, pad = vw < 430 ? 24 : 48;
    const fit = Math.min(Math.max(1, vw - pad) / V.w, Math.max(1, vh - pad) / V.h);
    const z = ZOOMS[V.zoom], w = V.w * fit * z, h = V.h * fit * z;
    const mx = Math.max(0, (w - vw + pad) / 2), my = Math.max(0, (h - vh + pad) / 2);
    V.panX = Math.max(-mx, Math.min(mx, V.panX)); V.panY = Math.max(-my, Math.min(my, V.panY));
    sheet.style.width = w + 'px'; sheet.style.height = h + 'px';
    sheet.style.left = `calc(50% + ${V.panX}px)`; sheet.style.top = `calc(50% + ${V.panY}px)`;
    $('vecZoomVal').textContent = Math.round(z * 100) + '%';
    $('vecZoomOut').disabled = V.zoom === 0; $('vecZoomIn').disabled = V.zoom === ZOOMS.length - 1;
    stage.classList.toggle('zoomed', V.zoom > 0);
    return { w, h };
  }
  function paintCanvases(size) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const k = Math.min(1, MAX_CANVAS / (Math.max(size.w, size.h) * dpr));
    const cw = Math.max(1, Math.round(size.w * dpr * k)), ch = Math.max(1, Math.round(size.h * dpr * k));
    for (const [id, src, mark] of [['vecOrig', V.img, false], ['vecRes', V.svgImg, true]]) {
      const c = $(id); c.width = cw; c.height = ch;
      const cx = c.getContext('2d'); cx.clearRect(0, 0, cw, ch);
      if (!src) continue;
      cx.imageSmoothingQuality = 'high'; cx.drawImage(src, 0, 0, cw, ch);
      if (mark) previewMark(cx, cw, ch);
    }
  }
  function render() {
    const has = !!V.img;
    $('vecDrop').hidden = has; $('vecSampleRow').hidden = has; $('vecStage').hidden = !has; $('vecMeta').hidden = !has; $('vecBar').hidden = !has;
    if (!has) return;
    $('vecName').textContent = `${V.name} · ${num(V.w)} × ${num(V.h)} px`;
    const compare = V.view === 'compare';
    document.querySelectorAll('#vecViews [data-v]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === V.view)));
    document.querySelectorAll('#vecBgs [data-b]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.b === V.bg)));
    $('vecSheet').className = 'vec-sheet bg-' + V.bg;
    const showVec = !!V.svgImg && V.view !== 'source';
    $('vecRes').hidden = !showVec;
    $('vecOrig').hidden = V.view === 'vector' && !!V.svgImg;
    $('vecOrig').style.clipPath = compare && V.svgImg ? `inset(0 ${100 - V.split}% 0 0)` : 'none';
    $('vecRes').style.clipPath = compare ? `inset(0 0 0 ${V.split}%)` : 'none';
    $('vecDivider').hidden = !(compare && V.svgImg); $('vecDivider').style.left = V.split + '%';
    $('vecKnob').setAttribute('aria-valuenow', String(Math.round(V.split)));
    $('vecLegend').hidden = !(compare && V.svgImg);
    const size = layout();
    if (size) { clearTimeout(renderTimer); renderTimer = setTimeout(() => alive && paintCanvases(size), 16); }
  }
  const setZoom = (d) => { V.zoom = Math.max(0, Math.min(ZOOMS.length - 1, V.zoom + d)); if (!V.zoom) { V.panX = 0; V.panY = 0; } render(); };
  $('vecZoomIn').onclick = () => setZoom(1);
  $('vecZoomOut').onclick = () => setZoom(-1);
  $('vecZoomVal').onclick = () => { V.zoom = 0; V.panX = 0; V.panY = 0; render(); };
  $('vecViews').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b) { V.view = b.dataset.v; render(); } };
  $('vecBgs').onclick = (e) => { const b = e.target.closest('[data-b]'); if (b) { V.bg = b.dataset.b; render(); } };
  $('vecKnob').onkeydown = (e) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); V.split = Math.max(0, Math.min(100, V.split + (e.key === 'ArrowLeft' ? -step : step))); render(); }
  };
  const stage = $('vecStage');
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !V.img) return;
    const wipe = !!e.target.closest('#vecKnob');
    if (!wipe && !V.zoom) return;
    e.preventDefault();
    drag = { id: e.pointerId, wipe, x: e.clientX, y: e.clientY, panX: V.panX, panY: V.panY };
    stage.setPointerCapture(e.pointerId); stage.classList.toggle('grabbing', !wipe);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (drag.wipe) {
      const b = $('vecSheet').getBoundingClientRect();
      V.split = Math.max(0, Math.min(100, ((e.clientX - b.left) * 100) / b.width));
      render();
    } else { V.panX = drag.panX + e.clientX - drag.x; V.panY = drag.panY + e.clientY - drag.y; layout(); }
  });
  const release = () => { if (drag && !drag.wipe) render(); drag = null; stage.classList.remove('grabbing'); };
  stage.addEventListener('pointerup', release); stage.addEventListener('pointercancel', release);
  const ro = new ResizeObserver(() => { if (!alive || !host.isConnected) { ro.disconnect(); return; } render(); });
  ro.observe(stage);

  // ---------- input ----------
  async function load(f) {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(f.type) && !/\.(png|jpe?g|webp)$/i.test(f.name || '')) { say(L('Format harus PNG, JPG, atau WebP.', 'The format must be PNG, JPG or WebP.'), 'error'); return; }
    const url = URL.createObjectURL(f);
    try {
      const img = await loadImage(url);
      stop();
      Object.assign(V, { file: f, name: (f.name || 'gambar').replace(/\.[^.]+$/, '') || 'gambar', img, w: img.naturalWidth, h: img.naturalHeight, result: null, svgImg: null, zoom: 0, panX: 0, panY: 0, view: 'vector' });
      say(''); showInks(); render(); schedule(10);
    } catch { say(L('File ini tidak bisa dibaca. Pilih PNG, JPG, atau WebP yang valid.', 'This file cannot be read. Choose a valid PNG, JPG or WebP.'), 'error'); }
    finally { URL.revokeObjectURL(url); }
  }
  $('vecFile').onchange = () => { load($('vecFile').files?.[0]); $('vecFile').value = ''; };
  const drop = $('vecDrop');
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('vecFile').click(); } };
  ['dragenter', 'dragover'].forEach((t) => host.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  host.addEventListener('dragleave', () => drop.classList.remove('over'));
  host.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); load(e.dataTransfer?.files?.[0]); });
  const onPaste = (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) load(f); };
  document.addEventListener('paste', onPaste);
  $('vecOther').onclick = () => $('vecFile').click();
  $('vecSample').onclick = async () => load(await sampleImage());

  // ---------- download: 1 credit ----------
  let downloading = false;
  $('vecDl').onclick = async () => {
    if (downloading || !V.result?.svg) return;
    if (!state.user) { say(L('Daftar dulu untuk mengunduh SVG. Akun baru dapat 5 kredit gratis.', 'Sign up to download the SVG. New accounts get 5 free credits.'), 'warn'); authDialog('daftar'); return; }
    downloading = true; $('vecDl').disabled = true;
    try {
      const { data, error } = await db.rpc('consume_vector_download', { p_ref: uuid() });
      if (error) {
        if (/insufficient_credits/.test(error.message)) topupDialog(L('Kredit tidak cukup. Satu unduhan SVG memakai 1 kredit.', 'Not enough credits. One SVG download uses 1 credit.'));
        else if (/not_authenticated/.test(error.message)) { clearSession(); authDialog('masuk'); }
        else say(L('Gagal memotong kredit: ', 'Could not charge credits: ') + esc(tr(error.message)), 'error');
        return;
      }
      setCredits(data);
      const url = URL.createObjectURL(new Blob([V.result.svg], { type: 'image/svg+xml;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = `${V.name}-vektor.svg`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast(L(`SVG diunduh. Sisa ${data} kredit.`, `SVG downloaded. ${data} credits left.`));
      await db.from('halftone_image_history').insert({
        user_id: state.user.id, username: state.profile?.username || 'Pengguna', wilayah_id: regionId(),
        file_name: `${V.name}.svg`.slice(0, 255), operation: 'vector', image_width: V.w, image_height: V.h, garment_color: 'white',
      });
    } catch (e) { say(esc(e.message), 'error'); }
    finally { downloading = false; $('vecDl').disabled = !V.result?.svg; }
  };

  // ---------- start ----------
  syncSettings();
  render();
  if (V.img) { if (V.svgImg) { showInks(); $('vecDl').disabled = !V.result?.svg; } else schedule(10); }
  return () => { alive = false; stop(); clearTimeout(renderTimer); ro.disconnect(); document.removeEventListener('paste', onPaste); };
}
