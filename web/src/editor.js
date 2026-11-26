// Knockout & Raster editor. Same operations, limits, file names, credit charge and history
// rows as the previous site, in the new editor layout.
import * as E from './engine.js';
import { db } from './supa.js';
import { $, esc, icon, notice, toast, uuid, fmtDate, num } from './util.js';
import { state, setCredits, topupDialog, authDialog, clearSession, isAdmin, isManager, regionId, regionTz } from './session.js';

export function mount(host) {
  host.innerHTML = `
  <div class="editor" id="ed">
    <div class="tabsbar"><div class="doc empty" id="docTab"><span class="name" id="docName">Belum ada gambar</span><span class="num subtle" id="docZoom"></span></div></div>

    <main class="canvas" id="cv" aria-label="Kanvas">
      <label class="dropzone" id="drop" tabindex="0">
        <input type="file" id="file" accept="image/png,image/jpeg,image/webp" hidden>
        <span class="big">${icon('upload')}</span>
        <strong>Tarik gambar ke sini</strong>
        <span class="muted">atau klik untuk memilih · bisa juga tempel (Ctrl+V)</span>
        <span class="xs subtle">PNG, JPG, atau WebP · gambar di atas 16 MP otomatis dioptimalkan</span>
      </label>
      <div class="viewport" id="vp" hidden>
        <div class="artboard" id="ab">
          <span class="ab-label" id="abLabel"></span>
          <canvas class="orig" id="cOrig"></canvas>
          <canvas class="res" id="cRes"></canvas>
          <span class="ba l">Sebelum</span><span class="ba r">Sesudah</span>
          <div class="split" id="split"><button class="knob" id="knob" role="slider" aria-label="Bandingkan sebelum dan sesudah" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">${icon('lr')}</button></div>
        </div>
      </div>
      <div class="float" id="float" hidden>
        <span role="radiogroup" aria-label="Latar pratinjau" style="display:flex;gap:2px">
          <button role="radio" aria-checked="true" data-bg="checker" aria-label="Latar transparan"><span class="sw" style="background:repeating-conic-gradient(#ccc 0 25%,#fff 0 50%) 0 0/6px 6px"></span><span class="t">Transparan</span></button>
          <button role="radio" aria-checked="false" data-bg="white" aria-label="Kaos putih"><span class="sw" style="background:#fff"></span><span class="t">Kaos putih</span></button>
          <button role="radio" aria-checked="false" data-bg="black" aria-label="Kaos hitam"><span class="sw" style="background:#0b0b0b"></span><span class="t">Kaos hitam</span></button>
        </span>
        <span class="sep"></span>
        <button id="cmpBtn" aria-pressed="false" title="Tampilkan garis pembanding">${icon('lr', 'i i-sm')}Bandingkan</button>
      </div>
      <div class="busy" id="busy" hidden><div class="card"><b id="busyText">Memproses…</b><div class="bar"><i id="busyBar"></i></div><span class="xs muted">Diproses di perangkatmu, tidak diunggah.</span></div></div>
    </main>

    <aside class="panel" aria-label="Properti">
      <div class="ptabs" role="tablist">
        <button role="tab" aria-selected="true" data-ptab="props">Properti</button>
        <button role="tab" aria-selected="false" data-ptab="hist">Riwayat unduhan</button>
      </div>
      <div id="tabProps" style="display:flex;flex-direction:column;flex:1">
        <details class="sec" open><summary>${icon('chev', 'i i-sm chev')}Gambar</summary>
          <div class="sec-body">
            <div class="row"><span class="lbl">File</span><span class="xs" id="fileInfo" style="flex:1;overflow-wrap:anywhere">Belum ada gambar</span></div>
            <div class="row"><span class="lbl">Cetak @300 DPI</span><span class="val" id="printSize">-</span></div>
            <button class="btn btn-secondary" id="pickBtn">${icon('upload', 'i i-sm')}Pilih gambar</button>
          </div>
        </details>
        <details class="sec" open><summary>${icon('chev', 'i i-sm chev')}Raster halftone</summary>
          <div class="sec-body">
            <div class="row"><span class="lbl">Pratinjau</span><div class="seg" role="radiogroup" aria-label="Pratinjau di kaos hitam atau putih" id="garment"><button role="radio" aria-checked="false" data-v="black">Hitam</button><button role="radio" aria-checked="true" data-v="white">Putih</button></div></div>
            <p class="hint">Lihat hasil di kaos hitam atau putih. Raster garis menyesuaikan pilihan ini.</p>
            <div class="row"><span class="lbl">Detail raster</span><input type="range" id="lpi" min="30" max="60" step="1" value="45" aria-label="Detail raster dalam LPI"><span class="val" id="lpiVal" style="width:44px;text-align:right">45 LPI</span></div>
            <p class="hint"><span id="lpiPx">±7 px</span> pada artwork 300 DPI. 30 = titik besar, 60 = halus.</p>
            <div class="row"><span class="lbl">Sudut garis</span><select class="sel" id="angle" aria-label="Sudut raster garis"><option value="15">15°</option><option value="22.5">22,5°</option><option value="45" selected>45°</option><option value="60">60°</option></select></div>
            <div class="grid2"><button class="btn btn-secondary" id="rRound">${icon('halftone', 'i i-sm')}Raster bulat</button><button class="btn btn-secondary" id="rLine">${icon('menu', 'i i-sm')}Raster garis</button></div>
          </div>
        </details>
        <details class="sec" open><summary>${icon('chev', 'i i-sm chev')}Knockout<span class="badge" id="koBadge" hidden></span></summary>
          <div class="sec-body">
            <div class="seg" role="radiogroup" aria-label="Knockout" id="ko"><button role="radio" aria-checked="true" data-v="none">Tidak ada</button><button role="radio" aria-checked="false" data-v="black">Hitam</button><button role="radio" aria-checked="false" data-v="white">Putih</button><button role="radio" aria-checked="false" data-v="color">Warna</button></div>
            <p class="hint" id="koHint">Knockout diterapkan pada hasil raster (atau gambar asli bila belum di-raster).</p>
            <div id="koColor" hidden style="display:flex;flex-direction:column;gap:10px">
              <div class="row color-row"><span class="lbl">Warna</span><input type="color" id="kcPick" value="#000000" aria-label="Pilih warna knockout"><label class="inp"><input id="kcHex" value="#000000" maxlength="7" aria-label="Kode warna HEX"></label><button class="ibtn" id="kcDrop" aria-pressed="false" title="Ambil warna dari gambar" aria-label="Ambil warna dari gambar">${icon('pipette')}</button></div>
              <div class="row"><span class="lbl">Mode</span><div class="seg" role="radiogroup" aria-label="Mode knockout warna" id="kcMode"><button role="radio" aria-checked="true" data-v="global">Seluruh gambar</button><button role="radio" aria-checked="false" data-v="area">Area</button></div></div>
              <div class="row"><span class="lbl">Toleransi</span><input type="range" id="kcTol" min="0" max="100" value="24" aria-label="Toleransi warna"><span class="val" id="kcTolVal" style="width:28px;text-align:right">24</span></div>
              <button class="btn btn-secondary" id="kcArea" hidden>${icon('scan', 'i i-sm')}Pilih area pada gambar</button>
              <p class="hint" id="kcStatus">Mode seluruh gambar menghapus warna serupa di semua bagian.</p>
              <button class="btn btn-secondary" id="kcApply">Terapkan knockout warna</button>
            </div>
          </div>
        </details>
        <div class="pfoot">
          <div class="status-msg" id="msg" role="status" aria-live="polite"></div>
          <div class="row"><button class="btn btn-secondary" id="undo" disabled>${icon('undo', 'i i-sm')}Undo</button><button class="btn btn-secondary" id="reset" disabled>${icon('reset', 'i i-sm')}Reset</button></div>
          <button class="btn btn-primary btn-lg" id="dl" disabled>${icon('download', 'i i-sm')}Unduh PNG <span class="cost">· 3 kredit</span></button>
        </div>
      </div>
      <div id="tabHist" hidden style="padding:12px;display:flex;flex-direction:column;gap:8px">
        <div class="row"><span class="xs muted grow">Tercatat saat PNG diunduh. Gambar tidak disimpan.</span><button class="ibtn" id="histRefresh" aria-label="Muat ulang">${icon('refresh')}</button></div>
        <div id="histList"><div class="empty">Memuat…</div></div>
      </div>
    </aside>

    <footer class="status">
      <span class="zoombox"><button class="ibtn" id="zOut" aria-label="Perkecil">${icon('minus', 'i i-sm')}</button><span class="num" id="zVal" title="Klik untuk menyesuaikan layar" role="button" tabindex="0">100%</span><button class="ibtn" id="zIn" aria-label="Perbesar">${icon('plus', 'i i-sm')}</button><button class="ibtn" id="zFit" aria-label="Sesuaikan layar">${icon('fit', 'i i-sm')}</button></span>
      <span class="num" id="stSize">-</span><span id="stOp">-</span>
      <span class="grow"></span>
      <span><span class="dot"></span>Diproses di perangkatmu</span>
    </footer>
  </div>`;

  // ---------- state ----------
  const S = {
    name: 'image', fileName: 'image', k: null, w: null, B: null, s: 'original', m: 'none', ko: 'none',
    L: E.createColorKnockoutState(), undo: null, garment: 'white', bg: 'checker',
    z: 1, fit: 1, px: 0, py: 0, split: 50, compare: true, busy: false, job: null, blobUrl: '', blobFor: null,
  };
  const els = {
    cv: $('cv'), vp: $('vp'), ab: $('ab'), cOrig: $('cOrig'), cRes: $('cRes'), drop: $('drop'), file: $('file'), float: $('float'),
    busy: $('busy'), busyText: $('busyText'), busyBar: $('busyBar'), msg: $('msg'), dl: $('dl'), undo: $('undo'), reset: $('reset'),
    lpi: $('lpi'), angle: $('angle'), rRound: $('rRound'), rLine: $('rLine'),
  };
  const ctxOrig = els.cOrig.getContext('2d');
  const ctxRes = els.cRes.getContext('2d', { willReadFrequently: true });
  const say = (m, type = 'ok') => { els.msg.innerHTML = m ? notice(m, type) : ''; };
  const radio = (group, v) => group.querySelectorAll('[role=radio]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v)));

  // ---------- view: zoom / pan / split ----------
  function layout() {
    if (!S.k) return;
    const r = els.cv.getBoundingClientRect();
    const pad = 56;
    S.fit = Math.min((r.width - pad) / S.k.width, (r.height - pad - 40) / S.k.height);
    if (!(S.fit > 0)) S.fit = 1;
    applyView();
  }
  function applyView() {
    if (!S.k) return;
    const scale = S.fit * S.z;
    els.ab.style.width = Math.max(1, S.k.width * scale) + 'px';
    els.ab.style.height = Math.max(1, S.k.height * scale) + 'px';
    els.vp.style.transform = `translate(${S.px}px,${S.py}px)`;
    const pct = Math.round(scale * 100) + '%';
    $('zVal').textContent = pct; $('docZoom').textContent = pct;
    const pixel = scale >= 2;
    els.cOrig.classList.toggle('pixel', pixel); els.cRes.classList.toggle('pixel', pixel);
    const comparing = S.compare && S.s !== 'original';
    els.ab.classList.toggle('comparing', comparing);
    els.ab.style.setProperty('--split', comparing ? S.split + '%' : '0%');
    els.cOrig.style.visibility = comparing ? 'visible' : 'hidden';
    $('knob').setAttribute('aria-valuenow', String(Math.round(S.split)));
    $('cmpBtn').setAttribute('aria-pressed', String(S.compare));
    $('cmpBtn').disabled = S.s === 'original';
  }
  const zoomTo = (z) => { S.z = Math.max(0.05 / S.fit, Math.min(8 / S.fit, z)); applyView(); };
  $('zIn').onclick = () => zoomTo(S.z * 1.25);
  $('zOut').onclick = () => zoomTo(S.z / 1.25);
  const fitView = () => { S.z = 1; S.px = 0; S.py = 0; applyView(); };
  $('zFit').onclick = fitView; $('zVal').onclick = fitView;
  $('zVal').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fitView(); } };
  els.cv.addEventListener('wheel', (e) => {
    if (!S.k) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomTo(S.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    else { S.px -= e.deltaX; S.py -= e.deltaY; applyView(); }
  }, { passive: false });
  const ro = new ResizeObserver(layout); ro.observe(els.cv);

  // pan by dragging the canvas; eyedropper / area pick when sampling
  els.cv.addEventListener('pointerdown', (e) => {
    if (!S.k || e.button || e.target.closest('.split,.float,.dropzone')) return;
    if (S.L.sampling) { samplePoint(e); return; }
    e.preventDefault(); els.cv.setPointerCapture(e.pointerId); els.cv.classList.add('panning');
    const s0 = { x: e.clientX, y: e.clientY, px: S.px, py: S.py };
    const move = (ev) => { S.px = s0.px + ev.clientX - s0.x; S.py = s0.py + ev.clientY - s0.y; applyView(); };
    const up = () => { els.cv.classList.remove('panning'); els.cv.removeEventListener('pointermove', move); els.cv.removeEventListener('pointerup', up); els.cv.removeEventListener('pointercancel', up); };
    els.cv.addEventListener('pointermove', move); els.cv.addEventListener('pointerup', up); els.cv.addEventListener('pointercancel', up);
  });
  const split = $('split');
  split.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation(); split.setPointerCapture(e.pointerId);
    const move = (ev) => { const r = els.ab.getBoundingClientRect(); S.split = Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100)); applyView(); };
    const up = () => { split.removeEventListener('pointermove', move); split.removeEventListener('pointerup', up); };
    split.addEventListener('pointermove', move); split.addEventListener('pointerup', up);
  });
  $('knob').addEventListener('keydown', (e) => {
    const k = { ArrowLeft: -5, ArrowRight: 5, Home: -100, End: 100 }[e.key]; if (k === undefined) return;
    e.preventDefault(); S.split = Math.max(0, Math.min(100, S.split + k)); applyView();
  });
  $('cmpBtn').onclick = () => { S.compare = !S.compare; applyView(); };
  els.float.querySelector('[role=radiogroup]').addEventListener('click', (e) => {
    const b = e.target.closest('[role=radio]'); if (!b) return;
    setBg(b.dataset.bg);
  });
  function setBg(bg) {
    S.bg = bg;
    els.float.querySelectorAll('[data-bg]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.bg === bg)));
    els.ab.classList.toggle('black', bg === 'black'); els.ab.classList.toggle('white', bg === 'white');
  }

  // ---------- drawing ----------
  function show() {
    const has = !!S.k;
    els.drop.hidden = has; els.vp.hidden = !has; els.float.hidden = !has;
    $('docTab').classList.toggle('empty', !has);
    $('docName').textContent = has ? S.fileName : 'Belum ada gambar';
    if (!has) { $('docZoom').textContent = ''; $('stSize').textContent = '-'; $('stOp').textContent = '-'; $('printSize').textContent = '-'; }
    if (has) {
      if (els.cRes.width !== S.k.width || els.cRes.height !== S.k.height) {
        els.cOrig.width = els.cRes.width = S.k.width; els.cOrig.height = els.cRes.height = S.k.height;
      }
      ctxOrig.putImageData(S.k, 0, 0);
      ctxRes.putImageData(S.B || S.k, 0, 0);
      const cm = (px) => ((px / 300) * 2.54).toFixed(1).replace('.', ',');
      $('stSize').textContent = `${num(S.k.width)} × ${num(S.k.height)} px`;
      $('printSize').textContent = `${cm(S.k.width)} × ${cm(S.k.height)} cm`;
      $('abLabel').textContent = `${S.fileName} · ${num(S.k.width)} × ${num(S.k.height)} px`;
      $('stOp').textContent = E.OPERATION_LABELS[S.s] || 'Original';
    }
    controls();
    applyView();
  }
  function controls() {
    const has = !!S.k, busy = S.busy;
    [els.rRound, els.rLine, els.lpi, els.angle].forEach((x) => (x.disabled = !has || busy));
    $('garment').querySelectorAll('button').forEach((b) => (b.disabled = !has || busy));
    $('ko').querySelectorAll('button').forEach((b) => (b.disabled = !has || busy));
    els.undo.disabled = !has || busy || !S.undo;
    els.reset.disabled = !has || busy;
    els.dl.disabled = !has || busy || S.s === 'original';
    radio($('ko'), S.ko);
    const kb = $('koBadge'); kb.hidden = S.ko === 'none'; kb.textContent = { black: 'Hitam', white: 'Putih', color: 'Warna' }[S.ko] || '';
    // colour knockout sub-panel
    const L = S.L, colorOn = S.ko === 'color';
    $('koColor').hidden = !colorOn;
    const dis = !has || busy;
    $('kcPick').value = L.color; $('kcHex').value = L.color.toUpperCase();
    radio($('kcMode'), L.mode);
    $('kcTol').value = String(L.tolerance); $('kcTolVal').textContent = String(L.tolerance);
    ['kcPick', 'kcHex', 'kcDrop', 'kcTol'].forEach((id) => ($(id).disabled = dis));
    $('kcMode').querySelectorAll('button').forEach((b) => (b.disabled = dis));
    $('kcArea').hidden = L.mode !== 'area'; $('kcArea').disabled = dis;
    $('kcApply').disabled = dis || (L.mode === 'area' && !L.seed);
    $('kcDrop').setAttribute('aria-pressed', String(L.sampling === 'color'));
    $('kcDrop').classList.toggle('is-on', L.sampling === 'color');
    $('kcArea').textContent = L.sampling === 'area' ? 'Klik area pada gambar…' : 'Pilih area pada gambar';
    $('kcStatus').textContent = L.mode === 'area'
      ? (L.seed ? `Titik area: ${L.seed.x}, ${L.seed.y}` : 'Pilih titik area sebelum menerapkan knockout.')
      : 'Mode seluruh gambar menghapus warna serupa di semua bagian.';
    els.cv.classList.toggle('sampling', !!L.sampling);
  }
  function setBusy(on, text = 'Memproses…', p = 0) {
    S.busy = on; els.busy.hidden = !on; els.busyText.textContent = text; els.busyBar.style.width = Math.round(p * 100) + '%';
    els.cv.setAttribute('aria-busy', String(on)); controls();
  }
  function lpiLabel() {
    const v = E.clampLpi(els.lpi.value); els.lpi.value = String(v);
    $('lpiVal').textContent = `${v} LPI`; $('lpiPx').textContent = `±${E.cellForLpi(v)} px`;
    els.lpi.setAttribute('aria-valuetext', `${v} LPI, sekitar ${E.cellForLpi(v)} piksel`);
  }
  lpiLabel();

  // ---------- result file (prepared ahead so the download starts right after the credit check) ----------
  let blobGen = 0;
  function prepareBlob() {
    if (S.blobUrl) { URL.revokeObjectURL(S.blobUrl); S.blobUrl = ''; }
    if (!S.B || S.s === 'original') return;
    const gen = ++blobGen, data = S.B;
    const c = document.createElement('canvas'); c.width = data.width; c.height = data.height;
    c.getContext('2d').putImageData(data, 0, 0);
    c.toBlob((b) => { if (gen !== blobGen || !b) return; S.blobUrl = URL.createObjectURL(b); S.blobFor = data; }, 'image/png');
  }

  // ---------- undo (one step, like before) ----------
  const snapshot = () => ({ B: S.B, w: S.w, s: S.s, m: S.m, ko: S.ko, L: E.createColorKnockoutState(S.L), lpi: els.lpi.value, angle: els.angle.value });
  const capture = () => { S.undo = snapshot(); };
  els.undo.onclick = () => {
    const u = S.undo; if (!u) return;
    S.job?.cancel(); S.undo = null;
    Object.assign(S, { B: u.B, w: u.w, s: u.s, m: u.m, ko: u.ko, L: u.L });
    els.lpi.value = u.lpi; els.angle.value = u.angle; lpiLabel();
    show(); prepareBlob();
    say(S.s === 'original' ? 'Undo selesai: kembali ke gambar asli.' : 'Undo selesai: langkah sebelumnya dikembalikan.');
  };

  // ---------- upload ----------
  function loadFile(f) {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(f.type)) { say('Format harus PNG, JPG, atau WebP.', 'error'); return; }
    S.job?.cancel();
    setBusy(true, 'Membaca gambar…', 0.1);
    const url = URL.createObjectURL(f), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const r = E.prepareUpload(img, f.name || 'Gambar');
      if (r.error) { setBusy(false); say(r.error, 'error'); return; }
      const c = document.createElement('canvas'); c.width = r.plan.width; c.height = r.plan.height;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(r.image, 0, 0, r.plan.width, r.plan.height);
      const data = cx.getImageData(0, 0, c.width, c.height);
      Object.assign(S, {
        name: (f.name || 'image').replace(/\.[^.]+$/, '') || 'image', fileName: f.name || 'image',
        k: data, w: data, B: data, s: 'original', m: 'none', ko: 'none', undo: null, L: E.createColorKnockoutState(), z: 1, px: 0, py: 0, split: 50,
      });
      els.angle.value = '45';
      $('fileInfo').textContent = r.fileInfo;
      setBusy(false); show(); layout(); prepareBlob();
      say(r.notice, r.noticeType);
    };
    img.onerror = () => { URL.revokeObjectURL(url); setBusy(false); say('Gambar tidak dapat dibaca.', 'error'); };
    img.src = url;
  }
  els.file.onchange = () => { loadFile(els.file.files?.[0]); els.file.value = ''; };
  $('pickBtn').onclick = () => els.file.click();
  els.drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.file.click(); } };
  ['dragenter', 'dragover'].forEach((t) => els.cv.addEventListener(t, (e) => { e.preventDefault(); els.drop.classList.add('over'); }));
  els.cv.addEventListener('dragleave', () => els.drop.classList.remove('over'));
  els.cv.addEventListener('drop', (e) => { e.preventDefault(); els.drop.classList.remove('over'); loadFile(e.dataTransfer?.files?.[0]); });
  const onPaste = (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) loadFile(f); };
  document.addEventListener('paste', onPaste);

  // ---------- raster ----------
  async function runRaster(kind) {
    if (!S.k) { say('Upload gambar terlebih dahulu sebelum membuat raster.', 'warn'); return; }
    capture();
    const lpi = E.clampLpi(els.lpi.value), angle = E.normalizeLineAngle(els.angle.value);
    const label = kind === 'round' ? 'Raster bulat' : `Raster garis ${String(angle).replace('.', ',')}°`;
    setBusy(true, `Membuat ${label} ${lpi} LPI…`, 0);
    S.job = E.raster(S.k, { kind, lpi, angle, blackGarment: S.garment === 'black', onProgress: (p) => { els.busyBar.style.width = Math.round(p * 100) + '%'; els.busyText.textContent = `Membuat ${label} ${lpi} LPI… ${Math.round(p * 100)}%`; } });
    try {
      const out = await S.job.promise;
      Object.assign(S, { B: out, w: out, s: kind === 'round' ? 'raster_round' : 'raster_line', m: kind === 'round' ? 'raster_round' : 'raster_line', ko: 'none' });
      setBusy(false); show(); prepareBlob();
      say(`${label} selesai: ${lpi} LPI (sekitar ${S.job.cell} px). Pilih Knockout Hitam/Putih bila ingin membuang warna dari hasil raster.`);
    } catch (e) {
      setBusy(false);
      if (e?.message !== 'cancelled') say(`Raster gagal: ${e?.message || e}`, 'error');
    }
  }
  els.rRound.onclick = () => runRaster('round');
  els.rLine.onclick = () => runRaster('line');
  els.lpi.oninput = lpiLabel;
  $('garment').addEventListener('click', (e) => {
    const b = e.target.closest('[role=radio]'); if (!b || b.disabled) return;
    S.garment = b.dataset.v; radio($('garment'), S.garment);
    setBg(S.garment === 'black' ? 'black' : 'white');
  });

  // ---------- knockout ----------
  $('ko').addEventListener('click', (e) => {
    const b = e.target.closest('[role=radio]'); if (!b || b.disabled || !S.k) return;
    const v = b.dataset.v;
    S.L.sampling = null;
    if (v === 'color') { S.ko = 'color'; controls(); say('Pilih warna dan mode, lalu tekan Terapkan knockout warna.'); return; }
    capture();
    S.ko = v;
    S.s = v === 'none' ? (S.m !== 'none' ? S.m : 'original') : (S.m !== 'none' ? `${S.m}_knockout_${v}` : `knockout_${v}`);
    S.B = v === 'none' ? S.w : E.knockoutBW(S.w, v);
    show(); prepareBlob();
    const on = S.m !== 'none' ? ' pada hasil raster' : '';
    say(v === 'black' ? `Knockout hitam diterapkan${on}: piksel hitam/netral dibuat transparan; warna lain tetap.`
      : v === 'white' ? `Knockout putih diterapkan${on}: piksel putih/netral dibuat transparan; warna lain tetap.`
      : `Knockout dimatikan: ${S.m !== 'none' ? 'hasil raster dikembalikan tanpa knockout' : 'warna dan transparansi asli dikembalikan'}.`);
  });
  const setColor = (hex, clearSeed = true) => { const c = E.parseHexColor(hex); if (!c) return false; S.L.color = c.hex; if (clearSeed) S.L.seed = null; controls(); return true; };
  $('kcPick').oninput = () => setColor($('kcPick').value);
  $('kcHex').onchange = () => { if (!setColor($('kcHex').value)) { $('kcHex').value = S.L.color.toUpperCase(); say('Kode warna harus format HEX, misalnya #FF0000.', 'warn'); } };
  $('kcMode').addEventListener('click', (e) => { const b = e.target.closest('[role=radio]'); if (!b || b.disabled) return; S.L.mode = b.dataset.v === 'area' ? 'area' : 'global'; S.L.seed = null; S.L.sampling = null; controls(); });
  $('kcTol').oninput = () => { S.L.tolerance = Math.max(0, Math.min(100, Number($('kcTol').value) || 0)); $('kcTolVal').textContent = String(S.L.tolerance); };
  const startSampling = (kind) => { if (!S.k) return; S.L.sampling = S.L.sampling === kind ? null : kind; controls(); if (S.L.sampling) say(kind === 'area' ? 'Klik area target pada gambar.' : 'Klik warna yang ingin dibuat transparan pada gambar.', 'warn'); };
  $('kcDrop').onclick = () => startSampling('color');
  $('kcArea').onclick = () => startSampling('area');
  function samplePoint(e) {
    e.preventDefault();
    const r = els.cRes.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || y < 0 || x >= r.width || y >= r.height) { say('Klik di dalam gambar.', 'warn'); return; }
    const pt = { x: Math.min(S.k.width - 1, Math.floor((x / r.width) * S.k.width)), y: Math.min(S.k.height - 1, Math.floor((y / r.height) * S.k.height)) };
    const hit = E.sampleColor(S.B || S.w, pt);
    if (!hit) { say('Pilih piksel berwarna di dalam gambar; area transparan tidak dapat diambil.', 'warn'); return; }
    if (S.L.sampling === 'color') setColor(hit.color.hex, false);
    if (S.L.mode === 'area' || S.L.sampling === 'area') S.L.seed = { ...hit.seed };
    S.L.sampling = null; controls();
    say(`Warna ${S.L.color.toUpperCase()} dipilih${S.L.mode === 'area' ? ' beserta titik area' : ''}.`);
  }
  $('kcApply').onclick = () => {
    if (!S.w) return;
    const L = E.createColorKnockoutState(S.L), target = E.parseHexColor(L.color);
    if (L.mode === 'area' && !L.seed) { say('Pilih area pada gambar sebelum menerapkan knockout warna.', 'warn'); return; }
    setBusy(true, 'Menerapkan knockout warna…', 0.5);
    requestAnimationFrame(() => {
      try {
        const r = E.knockoutColor(S.w, { target, tolerance: L.tolerance, feather: 12, mode: L.mode, seed: L.seed });
        if (!r.changed) { setBusy(false); say('Tidak ada piksel yang cocok dengan warna dan toleransi tersebut.', 'warn'); return; }
        capture();
        S.B = r.data;
        S.s = S.m === 'raster_round' ? 'raster_round_knockout_color' : S.m === 'raster_line' ? 'raster_line_knockout_color' : 'knockout_color';
        setBusy(false); show(); prepareBlob();
        say(`Knockout warna ${L.color.toUpperCase()} diterapkan (${L.mode === 'area' ? 'area' : 'seluruh gambar'}) pada ${num(r.changed)} piksel.`);
      } catch (err) { setBusy(false); say(`Knockout warna gagal: ${err?.message || err}`, 'error'); }
    });
  };

  // ---------- reset ----------
  els.reset.onclick = () => {
    S.job?.cancel();
    if (S.blobUrl) URL.revokeObjectURL(S.blobUrl);
    Object.assign(S, { name: 'image', fileName: 'image', k: null, w: null, B: null, s: 'original', m: 'none', ko: 'none', undo: null, L: E.createColorKnockoutState(), blobUrl: '', z: 1, px: 0, py: 0 });
    els.lpi.value = '45'; els.angle.value = '45'; lpiLabel();
    S.garment = 'white'; radio($('garment'), 'white'); setBg('checker');
    $('fileInfo').textContent = 'Belum ada gambar';
    show(); say('');
  };

  // ---------- download: 1 credit, then history row ----------
  let downloading = false;
  els.dl.onclick = async () => {
    if (downloading || !S.B || S.s === 'original') return;
    downloading = true; els.dl.disabled = true;
    try {
      const { data, error } = await db.rpc('consume_credit', { p_ref: uuid() });
      if (error) {
        if (/insufficient_credits/.test(error.message)) topupDialog('Kredit tidak cukup. Satu unduhan PNG memakai 3 kredit.');
        else if (/not_authenticated/.test(error.message)) { clearSession(); authDialog('masuk'); }
        else say('Gagal memotong kredit: ' + esc(error.message), 'error');
        return;
      }
      setCredits(data);
      if (!S.blobUrl || S.blobFor !== S.B) {
        await new Promise((res) => {
          const c = document.createElement('canvas'); c.width = S.B.width; c.height = S.B.height;
          c.getContext('2d').putImageData(S.B, 0, 0);
          c.toBlob((b) => { if (b) { S.blobUrl = URL.createObjectURL(b); S.blobFor = S.B; } res(); }, 'image/png');
        });
      }
      const a = document.createElement('a');
      a.href = S.blobUrl; a.download = `${S.name}-${E.OPERATION_SLUG[S.s] || 'hasil'}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      toast(`PNG diunduh. Sisa ${data} kredit.`);
      const { error: hErr } = await db.from('halftone_image_history').insert({
        user_id: state.user.id, username: state.profile?.username || 'Pengguna', wilayah_id: regionId(),
        file_name: String(S.fileName || S.name).slice(0, 255), operation: S.s,
        image_width: S.B.width, image_height: S.B.height, garment_color: S.garment,
      });
      if (hErr) say('PNG berhasil diunduh, tetapi riwayat gagal disimpan: ' + esc(hErr.message), 'warn');
      else say('Unduhan tercatat di riwayat.');
      if (!$('tabHist').hidden) loadHist();
    } finally { downloading = false; controls(); }
  };

  // ---------- panel tabs + compact history ----------
  document.querySelectorAll('[data-ptab]').forEach((t) => (t.onclick = () => {
    document.querySelectorAll('[data-ptab]').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    $('tabProps').hidden = t.dataset.ptab !== 'props'; $('tabHist').hidden = t.dataset.ptab !== 'hist';
    if (t.dataset.ptab === 'hist') loadHist();
  }));
  $('histRefresh').onclick = loadHist;
  async function loadHist() {
    const box = $('histList'); box.innerHTML = '<div class="empty">Memuat…</div>';
    let q = db.from('halftone_image_history').select('id,file_name,operation,image_width,image_height,garment_color,created_at,username').order('created_at', { ascending: false }).limit(20);
    if (!isAdmin()) q = isManager() ? q.eq('wilayah_id', regionId()) : q.eq('user_id', state.user.id);
    const { data, error } = await q;
    if (error) { box.innerHTML = notice(esc(error.message), 'error'); return; }
    box.innerHTML = data?.length ? data.map((r) => `
      <div class="card" style="padding:8px 10px;display:flex;flex-direction:column;gap:2px">
        <b class="xs" style="overflow-wrap:anywhere">${esc(r.file_name || '-')}</b>
        <span class="xs muted">${esc(E.OPERATION_LABELS[r.operation] || r.operation)} · ${num(r.image_width)}×${num(r.image_height)} px</span>
        <span class="xs subtle">${esc(fmtDate(r.created_at, regionTz()))}${isManager() ? ' · ' + esc(r.username || '') : ''}</span>
      </div>`).join('') : '<div class="empty">Belum ada unduhan.</div>';
  }

  // keyboard: Ctrl+Z undo, 0 fit
  const onKey = (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); els.undo.click(); }
    else if (e.key === 'Escape' && S.L.sampling) { S.L.sampling = null; controls(); say(''); }
  };
  document.addEventListener('keydown', onKey);

  show();
  return () => {
    S.job?.cancel(); ro.disconnect();
    document.removeEventListener('paste', onPaste); document.removeEventListener('keydown', onKey);
    if (S.blobUrl) URL.revokeObjectURL(S.blobUrl);
  };
}
