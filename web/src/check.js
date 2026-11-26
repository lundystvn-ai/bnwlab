// Cek Gambar / Image Checker: check a DTF file, fix it, upscale it, and download a print-ready PNG.
// Checking and fixing are free and run in the browser. Upscale = 1 credit, download = 1 credit.
import * as E from './engine.js';
import { analyze, dpiFor, thinOverlay, fixHaze, cleanFringe, fixSpecks, removeBackground, removeAt } from './checker.js';
import { issueText, issueTitle, ISSUE_ICON, summary } from './checktext.js';
import { giveHandoff } from './handoff.js';
import { store } from './config.js';
import { db, invoke } from './supa.js';
import { $, esc, icon, notice, num, toast, uuid } from './util.js';
import { L, tr } from './i18n.js';
import { state, authDialog, topupDialog, setCredits, refreshCredits, regionId } from './session.js';

// Kept outside the page so the work survives signing in or switching pages.
const C = { bgMode: '', file: null, name: 'image', img: null, orig: null, undo: null, result: null, upscaled: false, busy: '', job: 0, msg: null };

const toImageData = (image) => {
  const r = E.prepareUpload(image, 'image');
  if (r.error) throw new Error(r.error);
  const c = document.createElement('canvas'); c.width = r.plan.width; c.height = r.plan.height;
  const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(r.image, 0, 0, r.plan.width, r.plan.height);
  return cx.getImageData(0, 0, c.width, c.height);
};
const blobToImage = (blob) => new Promise((res, rej) => {
  const url = URL.createObjectURL(blob), im = new Image();
  im.onload = () => { URL.revokeObjectURL(url); res(im); };
  im.onerror = () => { URL.revokeObjectURL(url); rej(new Error(L('Gambar tidak dapat dibaca.', 'The image could not be read.'))); };
  im.src = url;
});
const pngBlob = (img) => new Promise((res) => {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(img, 0, 0); c.toBlob(res, 'image/png');
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function mount(host) {
  let thinOn = false, timer = 0;
  host.innerHTML = `
  <div class="page"><div class="page-in" style="max-width:1100px">
    <div class="page-head"><div><h1>${L('Cek Gambar', 'Image Checker')}</h1>
      <p>${L('Cek, perbaiki, dan unduh file siap cetak DTF. Cek dan perbaikan gratis tanpa daftar; unduh PNG 1 kredit, upscale 1 kredit.', 'Check, fix and download a print-ready DTF file. Checking and fixing are free with no sign-up; downloading the PNG is 1 credit, upscaling 1 credit.')}</p></div></div>
    <div class="chk-grid">
      <section class="card chk-view">
        <label class="dropzone chk-drop" id="chkDrop" tabindex="0">
          <input type="file" id="chkFile" accept="image/png,image/jpeg,image/webp" hidden>
          <span class="big">${icon('upload')}</span>
          <strong>${L('Tarik gambar ke sini', 'Drop an image here')}</strong>
          <span class="muted small">${L('atau klik untuk memilih · bisa juga tempel (Ctrl+V)', 'or click to choose · you can also paste (Ctrl+V)')}</span>
          <span class="xs subtle">PNG, JPG, WebP</span>
        </label>
        <div class="chk-canvas" id="chkCanvasBox" hidden><canvas id="chkCanvas"></canvas><div class="chk-busy" id="chkBusy" hidden><span class="spin"></span><span id="chkBusyText"></span></div></div>
        <div class="row chk-meta" id="chkMeta" hidden>
          <span class="xs muted" id="chkName"></span><span class="grow"></span>
          <button class="btn btn-quiet btn-sm" id="chkUndo">${icon('undo', 'i i-sm')}Undo</button>
          <button class="btn btn-quiet btn-sm" id="chkOrig">${L('Kembali ke asli', 'Back to original')}</button>
          <button class="btn btn-quiet btn-sm" id="chkOther">${L('Gambar lain', 'Another image')}</button>
        </div>
      </section>
      <section class="card stack chk-side">
        <div class="row"><span class="lbl">${L('Lebar cetak', 'Print width')}</span><input type="number" class="ck-width" id="chkWidth" min="1" max="200" step="0.5" inputmode="decimal" aria-label="${L('Lebar cetak dalam cm', 'Print width in cm')}"><span class="val">cm</span><span class="grow"></span><span class="badge" id="chkBadge" hidden></span></div>
        <p class="hint" style="margin:0">${L('Isi lebar desain saat dicetak di kaos. Resolusi, ketebalan garis, dan ukuran file unduhan mengikuti angka ini.', 'Enter how wide the design will print on the shirt. Resolution, line thickness and the downloaded file size follow this number.')}</p>
        <div id="chkMsg"></div>
        <div id="chkList" class="ck-list" aria-live="polite"><p class="hint">${L('Hasil cek muncul di sini setelah gambar dipilih.', 'Results appear here once you choose an image.')}</p></div>
        <div id="chkActions" hidden class="stack">
          <button class="btn btn-secondary btn-block" id="chkFixAll">${icon('check', 'i i-sm')}${L('Perbaiki semua', 'Fix all')}</button>
          <button class="btn btn-primary btn-lg btn-block" id="chkDl">${icon('download', 'i i-sm')}${L('Unduh PNG siap cetak', 'Download print-ready PNG')} <span class="cost">· ${L('1 kredit', '1 credit')}</span></button>
          <button class="btn btn-quiet btn-block" id="chkEditor">${icon('halftone', 'i i-sm')}${L('Lanjut ke Halftone (raster / knockout)', 'Continue to Halftone (raster / knockout)')}</button>
        </div>
      </section>
    </div>
  </div></div>`;

  const width = () => { const v = Number($('chkWidth').value); return v > 0 ? Math.min(200, v) : 25; };
  const dpi = () => (C.img ? dpiFor(C.img.width, width()) : 300);
  $('chkWidth').value = String(store.get('print_width_cm', 25));
  const say = (m, t = 'ok') => { C.msg = m ? [m, t] : null; const el = $('chkMsg'); if (el) el.innerHTML = m ? notice(m, t) : ''; };
  const needLogin = (then) => { if (state.user) return false; authDialog('daftar', '', then); return true; };
  // Always 8×, unless the result would be too big for the browser to open (> 10,000 px on the long side).
  const MAX_SIDE = 10000;
  const upScale = () => { const side = C.img ? Math.max(C.img.width, C.img.height) : 0; return side * 8 <= MAX_SIDE ? 8 : side * 4 <= MAX_SIDE ? 4 : 2; };

  // ---------- view ----------
  function draw() {
    const c = $('chkCanvas'); if (!c || !C.img) return;
    c.width = C.img.width; c.height = C.img.height; c.style.cursor = C.bgMode && !thinOn ? 'crosshair' : '';
    c.getContext('2d').putImageData(thinOn && C.result ? thinOverlay(C.img, C.result.masks) : C.img, 0, 0);
  }
  function busyUi() {
    const b = $('chkBusy'); if (!b) return;
    b.hidden = !C.busy; $('chkBusyText').textContent = C.busy || '';
    ['chkFixAll', 'chkDl', 'chkEditor', 'chkOther', 'chkWidth'].forEach((id) => { const el = $(id); if (el) el.disabled = !!C.busy; });
    $('chkUndo').disabled = !!C.busy || !C.undo;
    $('chkOrig').disabled = !!C.busy || C.img === C.orig;
    document.querySelectorAll('#chkList [data-fix]').forEach((el) => (el.disabled = !!C.busy));
  }
  function fixLabel(it) {
    if (it.id === 'dpi') return `Upscale ${upScale()}× · ${L('1 kredit', '1 credit')}`;
    return ({
      background: it.data.bg ? L(`Buang latar ${it.data.bg === 'white' ? 'putih' : 'hitam'}`, `Remove ${it.data.bg} background`) : '',
      haze: L('Tegaskan', 'Harden'), fringe: L('Bersihkan tepi', 'Clean edges'), specks: L('Hapus bintik', 'Remove specks'),
      thin: thinOn ? L('Sembunyikan', 'Hide') : L('Tandai', 'Show'),
    })[it.id] || '';
  }
  function render() {
    const list = $('chkList'); if (!list || !C.img) return;
    $('chkDrop').hidden = true; $('chkCanvasBox').hidden = false; $('chkMeta').hidden = false; $('chkActions').hidden = false;
    $('chkName').textContent = `${C.name} · ${num(C.img.width)} × ${num(C.img.height)} px${C.upscaled ? ' · upscale' : ''}`;
    if (C.msg) $('chkMsg').innerHTML = notice(C.msg[0], C.msg[1]);
    if (!C.result) { busyUi(); return; }
    const sum = summary(C.result.issues), badge = $('chkBadge');
    badge.hidden = false; badge.className = 'badge ' + (sum.bad ? 'b-danger' : sum.problems ? 'b-warning' : 'b-success'); badge.textContent = sum.label;
    list.innerHTML = C.result.issues.map((it) => {
      const fx = it.level === 'ok' || it.level === 'info' ? '' : fixLabel(it);
      return `<div class="ck-item ck-${it.level}"><span class="ck-ic">${icon(ISSUE_ICON[it.level] || 'info', 'i i-sm')}</span><div class="ck-body"><b>${esc(issueTitle(it.id))}</b><span>${issueText(it)}</span></div>${fx ? `<button class="btn btn-secondary btn-sm" data-fix="${it.id}">${fx}</button>` : ''}</div>`;
    }).join('');
    list.querySelectorAll('[data-fix]').forEach((b) => (b.onclick = () => runFix(b.dataset.fix)));
    $('chkFixAll').hidden = !C.result.issues.some((i) => (i.level === 'warn' || i.level === 'bad') && (['haze', 'fringe', 'specks'].includes(i.id) || (i.id === 'background' && i.data.bg)));
    busyUi();
  }
  function check() {
    clearTimeout(timer);
    if (!C.img) return;
    timer = setTimeout(() => {
      if (!C.img) return;
      try { C.result = analyze(C.img, { dpi: dpi(), raster: false, jpeg: C.img === C.orig && /jpe?g/i.test(C.file?.type || '') }); }
      catch (e) { say(esc(e.message), 'error'); return; }
      thinOn = false; draw(); render();
    }, 40);
  }
  const setImg = (img) => { C.undo = C.img; C.img = img; C.result = null; draw(); render(); check(); };

  // ---------- load ----------
  async function load(f) {
    if (!f || C.busy) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(f.type)) { say(L('Format harus PNG, JPG, atau WebP.', 'The format must be PNG, JPG or WebP.'), 'error'); return; }
    try {
      const img = toImageData(await blobToImage(f));
      Object.assign(C, { file: f, name: (f.name || 'image').replace(/\.[^.]+$/, '') || 'image', img, orig: img, undo: null, result: null, upscaled: false, bgMode: '' });
      say(''); draw(); render(); check();
    } catch (e) { say(esc(e.message), 'error'); }
  }

  // ---------- fixes (free, in the browser) ----------
  const colorName = (bg) => (bg === 'white' ? L('putih', 'white') : L('hitam', 'black'));
  function bgMsg(bg, pockets, short) {
    const kept = short ? '' : L(`Latar ${colorName(bg)} dibuang; ${colorName(bg)} di dalam desain tetap aman. `, `The ${bg} background was removed; ${bg} inside the design is kept. `);
    return kept + (pockets ? L(`Masih ada ${pockets} area ${colorName(bg)} tertutup (misalnya lubang di huruf O atau A). Klik area itu di gambar kalau ingin dibuang juga.`, `${pockets} enclosed ${bg} area${pockets > 1 ? 's are' : ' is'} left (for example the hole in an O or A). Click it on the image if it should go too.`) : '');
  }
  // Click an enclosed pocket of the background colour to remove it.
  function pickAt(e) {
    if (!C.bgMode || !C.img || C.busy || thinOn) return;
    const c = $('chkCanvas'), r = c.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * C.img.width), y = Math.floor(((e.clientY - r.top) / r.height) * C.img.height);
    if (x < 0 || y < 0 || x >= C.img.width || y >= C.img.height) return;
    const res = removeAt(C.img, C.bgMode, x, y);
    if (!res.changed) { say(L(`Titik itu bukan area ${colorName(C.bgMode)}. Klik tepat di area ${colorName(C.bgMode)} yang ingin dibuang.`, `That spot is not ${C.bgMode}. Click right inside the ${C.bgMode} area you want removed.`), 'warn'); return; }
    setImg(res.img);
    say(L(`Area dibuang. ${res.pockets ? `Sisa ${res.pockets} area tertutup; klik lagi bila perlu, atau Undo kalau salah.` : 'Tekan Undo kalau salah.'}`, `Area removed. ${res.pockets ? `${res.pockets} enclosed area${res.pockets > 1 ? 's' : ''} left; click again if needed, or Undo if it was a mistake.` : 'Press Undo if it was a mistake.'}`));
  }
  function runFix(id) {
    if (!C.result || C.busy) return;
    if (id === 'thin') {
      thinOn = !thinOn; draw(); render();
      if (thinOn) say(L('Bagian merah terlalu tipis untuk tinta putih. Tebalkan di desain asli bila perlu.', 'The red parts are too thin for white ink. Thicken them in the original design if needed.'), 'warn');
      return;
    }
    if (id === 'dpi') { upscale(); return; }
    const cur = C.img;
    if (id === 'background') {
      const bg = C.result.issues.find((i) => i.id === 'background')?.data.bg; if (!bg) return;
      const r = removeBackground(cur, bg); C.bgMode = bg; setImg(r.img); say(bgMsg(bg, r.pockets));
    }
    if (id === 'haze') { setImg(fixHaze(cur)); say(L('Piksel setengah transparan dibuat tegas.', 'Semi-transparent pixels were made solid or fully transparent.')); }
    if (id === 'fringe') { setImg(cleanFringe(cur)); say(L('Garis sisa di pinggir objek dibersihkan.', 'The leftover outline on the edges was cleaned.')); }
    if (id === 'specks') { setImg(fixSpecks(cur, C.result.masks)); say(L('Bintik kecil dihapus.', 'Tiny specks were removed.')); }
  }
  $('chkFixAll').onclick = () => {
    if (!C.result || C.busy) return;
    let d = C.img;
    const bg = C.result.issues.find((i) => i.id === 'background')?.data.bg;
    let pockets = 0;
    if (bg) { const r = removeBackground(d, bg); d = r.img; pockets = r.pockets; C.bgMode = bg; }
    d = fixHaze(d);
    d = cleanFringe(d);
    const a = analyze(d, { dpi: dpi(), raster: false, jpeg: false });
    if (a.masks.specks?.count) d = fixSpecks(d, a.masks);
    setImg(d);
    say(L('Semua yang bisa diperbaiki otomatis sudah diperbaiki. Cek hasilnya, lalu unduh.', 'Everything that can be fixed automatically was fixed. Check the result, then download.') + (bg ? ' ' + bgMsg(bg, pockets, true) : ''));
  };
  $('chkUndo').onclick = () => { if (!C.undo || C.busy) return; C.img = C.undo; C.undo = null; C.result = null; draw(); render(); check(); say(L('Langkah terakhir dibatalkan.', 'The last step was undone.')); };
  $('chkCanvas').addEventListener('click', pickAt);
  $('chkOrig').onclick = () => { if (!C.orig || C.busy) return; C.bgMode = ''; setImg(C.orig); C.upscaled = false; say(L('Kembali ke gambar asli.', 'Back to the original image.')); };

  // ---------- upscale (1 credit, on the server) ----------
  async function upscale() {
    if (C.busy || !C.img) return;
    if (needLogin(() => upscale())) return;
    const scale = upScale(), job = ++C.job;
    const set = (t) => { C.busy = t; busyUi(); };
    set(L('Menyiapkan gambar…', 'Preparing image…'));
    try {
      const blob = await pngBlob(C.img);
      if (blob.size > 52428800) throw new Error(L('Ukuran gambar maksimal 50 MB.', 'Images can be up to 50 MB.'));
      const ins = await db.from('riwayat_bigjpg').insert({
        file_name: `${C.name}.png`, scale, style: 'art', noise: 0, status: 'uploading', user_id: state.user.id, username: state.profile?.username,
        wilayah_id: regionId(), started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).select('id').single();
      if (ins.error) throw new Error(ins.error.message);
      const id = ins.data.id;
      const path = `${state.user.id}/${uuid()}-${String(C.name).replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'gambar'}.png`;
      set(L('Mengunggah…', 'Uploading…'));
      const up = await db.storage.from('bigjpg-inputs').upload(path, blob, { contentType: 'image/png', upsert: false });
      if (up.error) throw new Error(L('Gambar gagal diunggah: ', 'Upload failed: ') + up.error.message);
      set(L(`Upscale ${scale}×…`, `Upscaling ${scale}×…`));
      const r = await invoke('bigjpg-upscale', { action: 'start', storage_path: path, file_name: `${C.name}.png`, file_type: 'image/png', scale, style: 'art', noise: 0, history_id: id });
      if (!r.task_id) throw new Error(L('Server tidak mengembalikan ID proses.', 'The server returned no job ID.'));
      // check every 5 s for up to 10 minutes; a dropped connection just retries
      for (let n = 0; n < 120; n++) {
        if (job !== C.job) return;
        await wait(5000);
        let st;
        try { st = await invoke('bigjpg-upscale', { action: 'status', history_id: id }); } catch { continue; }
        if (st.status === 'failed') throw Object.assign(new Error(tr(st.error_message) || L('Upscale gagal. Kredit dikembalikan.', 'Upscale failed. Credits refunded.')), { refunded: true });
        if (st.status === 'completed') {
          set(L('Mengambil hasil…', 'Fetching the result…'));
          const out = await invoke('bigjpg-upscale', { action: 'download', history_id: id });
          if (!(out instanceof Blob)) throw new Error(L('Hasil upscale tidak bisa dimuat di sini. Unduh dari halaman Upscale.', 'The upscaled result could not be loaded here. Download it from the Upscale page.'));
          const img = toImageData(await blobToImage(out));
          C.busy = ''; C.upscaled = true;
          setImg(img);
          say(L(`Upscale ${scale}× selesai dan gambar sudah dicek ulang. Perbaiki yang tersisa, lalu unduh.`, `Upscale ${scale}× done and the image was checked again. Fix anything left, then download.`));
          return;
        }
        set(L(`Upscale ${scale}×… ${Math.min(95, 10 + n * 6)}%`, `Upscaling ${scale}×… ${Math.min(95, 10 + n * 6)}%`));
      }
      throw new Error(L('Upscale belum selesai. Hasilnya nanti ada di halaman Upscale.', 'The upscale is not finished yet. The result will appear on the Upscale page.'));
    } catch (e) {
      if (job !== C.job) return;
      const m = tr(e.message);
      say(esc(m), e.refunded ? 'warn' : 'error');
      if (/Kredit tidak cukup|Not enough credits/.test(m)) topupDialog(L('Kredit tidak cukup untuk upscale (1 kredit).', 'Not enough credits to upscale (1 credit).'));
    } finally {
      if (job === C.job) { C.busy = ''; busyUi(); }
      refreshCredits();
    }
  }

  // ---------- download (1 credit) ----------
  async function download() {
    if (C.busy || !C.img) return;
    if (needLogin(() => download())) return;
    C.busy = L('Menyiapkan file…', 'Preparing the file…'); busyUi();
    try {
      const { data, error } = await db.rpc('consume_check_download', { p_ref: uuid() });
      if (error) {
        if (/insufficient_credits/.test(error.message)) topupDialog(L('Kredit tidak cukup. Unduh PNG dari Cek Gambar memakai 1 kredit.', 'Not enough credits. Downloading a PNG from the Image Checker uses 1 credit.'));
        else say(L('Gagal memotong kredit: ', 'Could not charge credits: ') + esc(tr(error.message)), 'error');
        return;
      }
      setCredits(data);
      const raw = await pngBlob(C.img);
      const file = new Blob([E.setPngDpi(await raw.arrayBuffer(), Math.max(30, Math.min(1200, dpi())))], { type: 'image/png' });
      const url = URL.createObjectURL(file), a = document.createElement('a');
      a.href = url; a.download = `${C.name}-siap-cetak.png`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast(L(`PNG diunduh (lebar ${width()} cm). Sisa ${data} kredit.`, `PNG downloaded (${width()} cm wide). ${data} credits left.`));
      await db.from('halftone_image_history').insert({
        user_id: state.user.id, username: state.profile?.username || 'Pengguna', wilayah_id: regionId(),
        file_name: `${C.name}.png`.slice(0, 255), operation: 'cleanup', image_width: C.img.width, image_height: C.img.height, garment_color: 'white',
      });
    } catch (e) { say(esc(e.message), 'error'); }
    finally { C.busy = ''; busyUi(); }
  }
  $('chkDl').onclick = download;

  // ---------- to the editor for raster / knockout ----------
  $('chkEditor').onclick = async () => {
    if (!C.img || C.busy) return;
    const b = await pngBlob(C.img);
    giveHandoff(new File([b], `${C.name}.png`, { type: 'image/png' }));
    if (state.user) location.hash = 'editor';
    else authDialog('daftar', '', () => { location.hash = 'editor'; });
  };

  // ---------- input ----------
  $('chkFile').onchange = () => { load($('chkFile').files?.[0]); $('chkFile').value = ''; };
  const drop = $('chkDrop');
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('chkFile').click(); } };
  ['dragenter', 'dragover'].forEach((t) => host.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  host.addEventListener('dragleave', () => drop.classList.remove('over'));
  host.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); load(e.dataTransfer?.files?.[0]); });
  const onPaste = (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) load(f); };
  document.addEventListener('paste', onPaste);
  $('chkOther').onclick = () => $('chkFile').click();
  $('chkWidth').addEventListener('change', () => { const v = width(); $('chkWidth').value = String(v); store.set('print_width_cm', v); C.result = null; check(); });

  // restore work from before signing in / switching pages
  if (C.img) { C.result = null; draw(); render(); check(); }
  return () => { clearTimeout(timer); document.removeEventListener('paste', onPaste); };
}
