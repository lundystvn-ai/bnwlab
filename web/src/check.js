// Cek Gambar / Image Checker: free DTF file check without an account. Nothing is uploaded.
import * as E from './engine.js';
import { analyze, dpiFor, thinOverlay } from './checker.js';
import { issueText, issueTitle, ISSUE_ICON, summary } from './checktext.js';
import { giveHandoff } from './handoff.js';
import { store } from './config.js';
import { $, esc, icon, notice, num } from './util.js';
import { L } from './i18n.js';
import { state, authDialog } from './session.js';

export function mount(host) {
  let alive = true, file = null, img = null, result = null, thinOn = false, timer = 0;
  host.innerHTML = `
  <div class="page"><div class="page-in" style="max-width:1100px">
    <div class="page-head"><div><h1>${L('Cek Gambar', 'Image Checker')}</h1>
      <p>${L('Cek apakah file Anda aman dicetak DTF: resolusi, latar, kabut putih, tepi, bintik, dan detail tipis. Gratis, tanpa daftar, dan gambar tidak diunggah ke server.', 'Check whether your file is safe to print on DTF: resolution, background, white haze, edges, specks and thin details. Free, no sign-up, and your image is never uploaded.')}</p></div></div>
    <div class="chk-grid">
      <section class="card chk-view">
        <label class="dropzone chk-drop" id="chkDrop" tabindex="0">
          <input type="file" id="chkFile" accept="image/png,image/jpeg,image/webp" hidden>
          <span class="big">${icon('upload')}</span>
          <strong>${L('Tarik gambar ke sini', 'Drop an image here')}</strong>
          <span class="muted small">${L('atau klik untuk memilih · bisa juga tempel (Ctrl+V)', 'or click to choose · you can also paste (Ctrl+V)')}</span>
          <span class="xs subtle">PNG, JPG, WebP</span>
        </label>
        <div class="chk-canvas" id="chkCanvasBox" hidden><canvas id="chkCanvas"></canvas></div>
        <div class="row chk-meta" id="chkMeta" hidden><span class="xs muted" id="chkName"></span><span class="grow"></span><button class="btn btn-quiet btn-sm" id="chkOther">${L('Cek gambar lain', 'Check another image')}</button></div>
      </section>
      <section class="card stack chk-side">
        <div class="row"><span class="lbl">${L('Lebar cetak', 'Print width')}</span><input type="number" class="ck-width" id="chkWidth" min="1" max="200" step="0.5" inputmode="decimal" aria-label="${L('Lebar cetak dalam cm', 'Print width in cm')}"><span class="val">cm</span><span class="grow"></span><span class="badge" id="chkBadge" hidden></span></div>
        <p class="hint" style="margin:0">${L('Isi lebar desain saat dicetak di kaos. Resolusi dan ketebalan garis dihitung dari ukuran ini.', 'Enter how wide the design will print on the shirt. Resolution and line thickness are judged at this size.')}</p>
        <div id="chkList" class="ck-list" aria-live="polite"><p class="hint">${L('Hasil cek muncul di sini setelah gambar dipilih.', 'Results appear here once you choose an image.')}</p></div>
        <div id="chkCta" hidden class="stack">
          <button class="btn btn-primary btn-lg btn-block" id="chkFix">${icon('check', 'i i-sm')}${L('Perbaiki & lanjut di Editor', 'Fix & continue in the Editor')}</button>
          <p class="xs muted" style="margin:0" id="chkCtaNote"></p>
        </div>
      </section>
    </div>
  </div></div>`;

  const width = () => { const v = Number($('chkWidth').value); return v > 0 ? Math.min(200, v) : 25; };
  $('chkWidth').value = String(store.get('print_width_cm', 25));

  function draw() {
    const c = $('chkCanvas'); if (!c || !img) return;
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(thinOn && result ? thinOverlay(img, result.masks) : img, 0, 0);
  }
  function render() {
    const list = $('chkList'); if (!list || !result) return;
    const sum = summary(result.issues), badge = $('chkBadge');
    badge.hidden = false; badge.className = 'badge ' + (sum.bad ? 'b-danger' : sum.problems ? 'b-warning' : 'b-success'); badge.textContent = sum.label;
    list.innerHTML = result.issues.map((it) => {
      const thinBtn = it.id === 'thin' && it.level !== 'ok' ? `<button class="btn btn-secondary btn-sm" id="chkThin">${thinOn ? L('Sembunyikan', 'Hide') : L('Tandai', 'Show')}</button>` : '';
      return `<div class="ck-item ck-${it.level}"><span class="ck-ic">${icon(ISSUE_ICON[it.level] || 'info', 'i i-sm')}</span><div class="ck-body"><b>${esc(issueTitle(it.id))}</b><span>${issueText(it)}</span></div>${thinBtn}</div>`;
    }).join('');
    $('chkThin')?.addEventListener('click', () => { thinOn = !thinOn; draw(); render(); });
    $('chkCta').hidden = false;
    $('chkCtaNote').innerHTML = sum.problems
      ? L('Di Editor, klik <b>Perbaiki semua</b> untuk membereskan yang bisa diperbaiki otomatis, lalu raster dan unduh PNG siap cetak.', 'In the Editor, click <b>Fix all</b> to clear what can be fixed automatically, then raster and download a print-ready PNG.')
      : L('File sudah siap. Lanjut ke Editor untuk raster atau knockout, lalu unduh PNG.', 'Your file is ready. Continue in the Editor to raster or knock out, then download the PNG.');
    if (!state.user) $('chkCtaNote').innerHTML += ' ' + L('Daftar gratis dan dapat 5 kredit untuk mencoba.', 'Sign up free and get 5 credits to try it.');
  }
  function run() {
    clearTimeout(timer);
    if (!img) return;
    $('chkList').innerHTML = `<p class="hint">${L('Memeriksa…', 'Checking…')}</p>`;
    timer = setTimeout(() => {
      if (!alive || !img) return;
      try { result = analyze(img, { dpi: dpiFor(img.width, width()), raster: false, jpeg: /jpe?g/i.test(file?.type || '') }); }
      catch (e) { $('chkList').innerHTML = notice(esc(e.message), 'error'); return; }
      thinOn = false; draw(); render();
    }, 60);
  }
  function load(f) {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(f.type)) { $('chkList').innerHTML = notice(L('Format harus PNG, JPG, atau WebP.', 'The format must be PNG, JPG or WebP.'), 'error'); return; }
    const url = URL.createObjectURL(f), im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      if (!alive) return;
      const r = E.prepareUpload(im, f.name || 'image');
      if (r.error) { $('chkList').innerHTML = notice(esc(r.error), 'error'); return; }
      const c = document.createElement('canvas'); c.width = r.plan.width; c.height = r.plan.height;
      const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(r.image, 0, 0, r.plan.width, r.plan.height);
      file = f; img = cx.getImageData(0, 0, c.width, c.height);
      $('chkDrop').hidden = true; $('chkCanvasBox').hidden = false; $('chkMeta').hidden = false;
      $('chkName').textContent = `${f.name || 'image'} · ${num(img.width)} × ${num(img.height)} px`;
      run();
    };
    im.onerror = () => { URL.revokeObjectURL(url); $('chkList').innerHTML = notice(L('Gambar tidak dapat dibaca.', 'The image could not be read.'), 'error'); };
    im.src = url;
  }

  $('chkFile').onchange = () => { load($('chkFile').files?.[0]); $('chkFile').value = ''; };
  const drop = $('chkDrop');
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('chkFile').click(); } };
  ['dragenter', 'dragover'].forEach((t) => host.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  host.addEventListener('dragleave', () => drop.classList.remove('over'));
  host.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); load(e.dataTransfer?.files?.[0]); });
  const onPaste = (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) load(f); };
  document.addEventListener('paste', onPaste);
  $('chkOther').onclick = () => $('chkFile').click();
  $('chkWidth').addEventListener('change', () => { const v = width(); $('chkWidth').value = String(v); store.set('print_width_cm', v); run(); });
  $('chkFix').onclick = () => {
    if (!file) return;
    giveHandoff(file);
    if (state.user) location.hash = 'editor';
    else authDialog('daftar', '', () => { location.hash = 'editor'; });
  };

  return () => { alive = false; clearTimeout(timer); document.removeEventListener('paste', onPaste); };
}
