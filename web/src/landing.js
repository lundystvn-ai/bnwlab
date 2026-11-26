import { esc, rupiah, icon } from './util.js';
import { state } from './session.js';
import { L, pkgName, pkgNote } from './i18n.js';
import { footer } from './legal.js';

export function renderLanding(view) {
  const perCredit = state.packages.map((x) => x.harga / x.kredit);
  const fromPrice = rupiah(Math.floor((Math.min(...perCredit) * 2) / 100) * 100);
  const bestSave = Math.max(0, ...state.packages.map(save));
  const studio = state.packages[state.packages.length - 1];
  view.innerHTML = `
  <main class="landing" id="landing">
    <div class="wrap hero">
      <div>
        <span class="eyebrow">${L('Untuk percetakan &amp; kreator DTF', 'For DTF print shops &amp; creators')}</span>
        <h1>${L('File DTF siap cetak, tanpa ribet.', 'Print-ready DTF files, without the hassle.')}</h1>
        <p class="lead">${L('Knockout latar, raster halftone, dan upscale dalam satu editor. Knockout dan raster diproses langsung di browser, jadi gambar tidak diunggah.', 'Background knockout, halftone raster and upscaling in one editor. Knockout and raster run right in your browser, so your images are never uploaded.')}</p>
        <div class="cta">
          <button class="btn btn-primary btn-xl" data-cta>${L('Buka editor', 'Open the editor')}</button>
          <a class="btn btn-secondary btn-xl" href="#harga" data-route="harga">${L('Lihat harga', 'See pricing')}</a>
        </div>
        <p class="fine small muted">${L('Daftar dan langsung dapat <b>5 kredit gratis</b> untuk mencoba. Pratinjau gratis, unduhan memakai kredit.', 'Sign up and get <b>5 free credits</b> to try it. Previews are free; downloads use credits.')}</p>
      </div>
      <div class="compare" id="heroCompare" aria-label="${L('Contoh sebelum dan sesudah raster', 'Before and after raster example')}">
        <img class="before" src="/sample-before.jpg" alt="" draggable="false">
        <img class="after" src="/sample-after.png" alt="${L('Contoh hasil: latar hitam dibuang dan gradasi menjadi titik raster', 'Example result: black background removed and gradients turned into halftone dots')}" draggable="false">
        <span class="ba l">${L('Sebelum', 'Before')}</span><span class="ba r">${L('Sesudah', 'After')} · Raster + Knockout</span>
        <div class="split" id="heroSplit"><button class="knob" id="heroKnob" role="slider" aria-label="${L('Bandingkan sebelum dan sesudah', 'Compare before and after')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="52">${icon('lr')}</button></div>
      </div>
    </div>

    <section class="section alt" id="fitur">
      <div class="wrap">
        <h2>${L('Tiga alat, satu alur kerja', 'Three tools, one workflow')}</h2>
        <p class="sub">${L('Semua yang dibutuhkan untuk menyiapkan file sebelum masuk RIP.', 'Everything you need to prepare a file before it goes to the RIP.')}</p>
        <div class="cards">
          <article class="card feat"><div class="ic">${icon('scan')}</div><h3>Knockout</h3><p>${L('Hapus hitam, putih, atau warna pilihan jadi transparan. Ada pengambil warna, mode area, toleransi, dan pembanding sebelum/sesudah.', 'Turn black, white or any colour you pick transparent. Includes a colour picker, area mode, tolerance and a before/after slider.')}</p><div class="meta">${L('Di browser · 2 kredit per unduhan', 'In your browser · 2 credits per download')}</div></article>
          <article class="card feat"><div class="ic">${icon('halftone')}</div><h3>${L('Raster Halftone', 'Halftone Raster')}</h3><p>${L('Ubah gradasi jadi raster bulat atau garis, 30–60 LPI, dengan sudut garis 15°–60°, supaya tercetak halus di kain.', 'Turn gradients into round or line halftones, 30–60 LPI, with line angles from 15° to 60°, so they print smoothly on fabric.')}</p><div class="meta">${L('Di browser · 2 kredit per unduhan', 'In your browser · 2 credits per download')}</div></article>
          <article class="card feat"><div class="ic">${icon('expand')}</div><h3>Upscale</h3><p>${L('Perbesar gambar kecil 2×, 4×, 8×, atau 16× dengan AI, lengkap dengan progres dan riwayat.', 'Enlarge small images 2×, 4×, 8× or 16× with AI, with live progress and history.')}</p><div class="meta">${L('Diproses di server · 1 kredit per gambar', 'Processed on our server · 1 credit per image')}</div></article>
        </div>
      </div>
    </section>

    <section class="section" id="cara">
      <div class="wrap">
        <h2>${L('Cara kerja', 'How it works')}</h2>
        <p class="sub">${L('Tiga langkah dari desain ke file transparan.', 'Three steps from design to a transparent file.')}</p>
        <ol class="steps">
          <li><b>${L('Unggah', 'Upload')}</b><span class="muted">${L('Tarik gambar PNG, JPG, atau WebP ke editor.', 'Drop a PNG, JPG or WebP image into the editor.')}</span></li>
          <li><b>${L('Atur', 'Adjust')}</b><span class="muted">${L('Pilih raster bulat atau garis, lalu knockout. Geser garis biru untuk membandingkan.', 'Choose a round or line raster, then knock out. Drag the blue line to compare.')}</span></li>
          <li><b>${L('Unduh', 'Download')}</b><span class="muted">${L('PNG transparan siap dikirim ke RIP atau printer DTF.', 'A transparent PNG, ready for your RIP or DTF printer.')}</span></li>
        </ol>
      </div>
    </section>

    <section class="section alt" id="harga">
      <div class="wrap">
        <h2>${L(`Desain siap cetak mulai ${fromPrice}`, `Print-ready designs from ${fromPrice}`)}</h2>
        <p class="sub">${L(`Atur dan pratinjau sepuasnya, gratis. Kredit baru terpakai saat Anda mengunduh: Raster/Knockout 2 kredit, Upscale 1 kredit. Kredit tidak pernah hangus${bestSave ? `, dan paket ${esc(pkgName(studio))} hemat sampai ${bestSave}% per kredit` : ''}.`,
          `Adjust and preview as much as you like, for free. Credits are only used when you download: Raster/Knockout 2 credits, Upscale 1 credit. Credits never expire${bestSave ? `, and the ${esc(pkgName(studio))} pack saves up to ${bestSave}% per credit` : ''}.`)}</p>
        <div class="prices" id="prices">${pricing()}</div>
      </div>
    </section>

    <section class="section" id="faq">
      <div class="wrap">
        <h2>${L('Pertanyaan umum', 'FAQ')}</h2>
        <div class="faq">
          ${faq(L('Apakah gambar saya disimpan?', 'Are my images stored?'), L('Untuk Knockout dan Raster, gambar diproses di browser dan tidak disimpan. Yang tercatat hanya riwayat unduhan (nama file, jenis operasi, ukuran). Fitur Upscale mengunggah gambar ke layanan upscale agar bisa diproses.', 'For Knockout and Raster, images are processed in your browser and never stored. We only log your download history (file name, operation, size). Upscale uploads the image to our upscaling service so it can be processed.'))}
          ${faq(L('Format apa yang dihasilkan?', 'What format do I get?'), L('PNG dengan latar transparan, siap dipakai di software RIP untuk DTF.', 'A PNG with a transparent background, ready for DTF RIP software.'))}
          ${faq(L('Apa yang terjadi kalau kredit habis?', 'What happens when I run out of credits?'), L('Isi kredit kapan saja. Pratinjau di layar tetap bisa dipakai; unduhan membutuhkan kredit.', 'Top up any time. On-screen previews keep working; downloads need credits.'))}
          ${faq(L('Bolehkah memakai desain milik orang lain?', 'Can I use other people\'s designs?'), L('Anda bertanggung jawab atas hak cipta gambar yang diunggah. Pastikan Anda berhak memakainya.', 'You are responsible for the copyright of the images you upload. Make sure you have the right to use them.'))}
        </div>
      </div>
    </section>

    ${footer()}
  </main>`;
  wireCompare(view.querySelector('#heroCompare'), view.querySelector('#heroSplit'), view.querySelector('#heroKnob'));
}

const faq = (q, a) => `<details><summary>${esc(q)}${icon('chev')}</summary><p>${esc(a)}</p></details>`;

// Discount per credit compared with the smallest package.
const save = (p) => {
  const base = Math.max(...state.packages.map((x) => x.harga / x.kredit));
  const pct = Math.round((1 - p.harga / p.kredit / base) * 100);
  return pct >= 5 ? pct : 0;
};

export function pricing() {
  return state.packages.map((p) => `
    <div class="card price${p.populer ? ' pop' : ''}">
      <div class="row"><b>${esc(pkgName(p))}</b>${p.populer ? `<span class="badge b-accent" style="margin-left:auto">${L('Terlaris', 'Most popular')}</span>` : ''}</div>
      <div class="amt">${rupiah(p.harga)}</div>
      <div class="muted small">${L(`${p.kredit} kredit · ${rupiah(Math.round(p.harga / p.kredit))}/kredit`, `${p.kredit} credits · ${rupiah(Math.round(p.harga / p.kredit))}/credit`)}${save(p) ? ` · <b class="save">${L('hemat', 'save')} ${save(p)}%</b>` : ''}</div>
      <ul><li>${icon('check')}<span>${L(`<b>± ${Math.floor(p.kredit / 2)} desain</b> Raster/Knockout <span class="muted">atau ${p.kredit} upscale</span>`, `<b>± ${Math.floor(p.kredit / 2)} designs</b> Raster/Knockout <span class="muted">or ${p.kredit} upscales</span>`)}</span></li><li>${icon('check')}${esc(pkgNote(p) || L('Untuk semua alat', 'For every tool'))}</li><li>${icon('check')}${L('Kredit tidak hangus', 'Credits never expire')}</li></ul>
      <button class="btn ${p.populer ? 'btn-primary' : 'btn-secondary'} btn-lg" data-topup>${L('Pilih', 'Choose')} ${esc(pkgName(p))}</button>
    </div>`).join('');
}

export function wireCompare(box, split, knob) {
  if (!box) return;
  const set = (v) => { v = Math.max(0, Math.min(100, v)); box.style.setProperty('--split', v + '%'); knob.setAttribute('aria-valuenow', Math.round(v)); };
  split.addEventListener('pointerdown', (e) => {
    e.preventDefault(); split.setPointerCapture(e.pointerId);
    const move = (ev) => { const r = box.getBoundingClientRect(); set(((ev.clientX - r.left) / r.width) * 100); };
    const up = () => { split.removeEventListener('pointermove', move); split.removeEventListener('pointerup', up); };
    split.addEventListener('pointermove', move); split.addEventListener('pointerup', up);
  });
  knob.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: -5, ArrowRight: 5 }[e.key]; if (k === undefined) return;
    e.preventDefault(); set(Number(knob.getAttribute('aria-valuenow')) + k);
  });
}
