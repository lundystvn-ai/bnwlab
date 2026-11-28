import { esc, rupiah, icon } from './util.js';
import { state, promoTicket, heroPromo, bonusFor } from './session.js';
import { L, pkgName, pkgNote } from './i18n.js';
import { footer } from './legal.js';
import { cfg } from './config.js';

export function renderLanding(view) {
  const perCredit = state.packages.map((x) => x.harga / x.kredit);
  const fromPrice = rupiah(Math.floor(Math.min(...perCredit) / 100) * 100);
  const bestSave = Math.max(0, ...state.packages.map(save));
  const studio = state.packages[state.packages.length - 1];
  const ai = !!cfg.aiEnabled;
  view.innerHTML = `
  <main class="landing" id="landing">
    <div class="wrap hero">
      <div>
        ${ai ? `<a class="ai-announce" href="#redraw" data-route="redraw"><b>${icon('spark', 'i i-sm')}${L('Baru', 'New')}</b><span>${L('Redraw AI: desain pecah &amp; foto kaos jadi file siap cetak', 'Redraw AI: broken designs &amp; shirt photos into print-ready files')}</span>${icon('chev', 'i i-sm')}</a>` : ''}
        <span class="eyebrow">${L('Untuk usaha sablon &amp; percetakan DTF', 'For DTF print shops')}</span>
        <h1>${L('Punya usaha DTF? Wajib cek file dulu sebelum cetak.', 'Run a DTF business? Check every file before you print.')}</h1>
        <p class="lead">${L('File pecah, latar belum bersih, atau tepi berbayang baru ketahuan setelah film tercetak. <b>Cek Gambar</b> memeriksanya dalam hitungan detik, <span class="badge-free">GRATIS</span>', 'Low resolution, a dirty background or haloed edges usually show up only after the film is printed. The <b>Image Checker</b> catches them in seconds, <span class="badge-free">FREE</span>')}</p>
        <ul class="checks">
          <li>${L('Resolusi (DPI) cukup untuk ukuran cetak', 'Enough resolution (DPI) for the print size')}</li>
          <li>${L('Latar transparan, tepi tanpa sisa warna &amp; bintik', 'Transparent background, clean edges, no stray specks')}</li>
          <li>${L('Perbaiki otomatis, lalu unduh PNG siap cetak 300 DPI', 'Fix automatically, then download a print-ready 300 DPI PNG')}</li>
        </ul>
        <div class="cta">
          <a class="btn btn-primary btn-xl" href="#cek" data-route="cek">${icon('check', 'i i-sm')}${L('Cek file gratis', 'Check a file free')}</a>
          <button class="btn btn-secondary btn-xl" data-cta>${L('Coba buat desain halftone', 'Try a halftone design')}</button>
        </div>
        <div id="heroPromo">${heroPromo()}</div>
        <p class="fine small muted">${L('Semua alat bisa dicoba tanpa daftar. Daftar hanya saat mau mengunduh.', 'Try every tool without signing up. Sign up only when you want to download.')}</p>
      </div>
      <div class="compare" id="heroCompare" aria-label="${L('Contoh sebelum dan sesudah raster', 'Before and after raster example')}">
        <img class="before" src="/sample-before.jpg" alt="" draggable="false">
        <img class="after" src="/sample-after.png" alt="${L('Contoh hasil: latar hitam dibuang dan gradasi menjadi titik raster', 'Example result: black background removed and gradients turned into halftone dots')}" draggable="false">
        <span class="ba l">${L('Sebelum', 'Before')}</span><span class="ba r">${L('Sesudah', 'After')} · Raster + Knockout</span>
        <div class="split" id="heroSplit"><button class="knob" id="heroKnob" role="slider" aria-label="${L('Bandingkan sebelum dan sesudah', 'Compare before and after')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="52">${icon('lr')}</button></div>
      </div>
    </div>

    <div class="wrap trust" aria-label="${L('Keunggulan', 'Highlights')}">
      <div><b>${ai ? L('6 alat', '6 tools') : L('5 alat', '5 tools')}</b><span>${ai ? L('Cek, halftone, vektor, gangsheet, upscale, Redraw AI', 'Check, halftone, vector, gangsheet, upscale, Redraw AI') : L('Cek, halftone, vektor, gangsheet, upscale', 'Check, halftone, vector, gangsheet, upscale')}</span></div>
      <div><b>${L('Tanpa langganan', 'No subscription')}</b><span>${L('Bayar per unduhan, kredit tidak hangus', 'Pay per download, credits never expire')}</span></div>
      <div><b>${L('Di browser', 'In your browser')}</b><span>${L('Knockout, raster, vektor, dan gangsheet tanpa unggah', 'Knockout, raster, vector and gangsheet without uploading')}</span></div>
      <div><b>QRIS &amp; VA</b><span>${L('Bayar dari e-wallet atau transfer bank', 'Pay from an e-wallet or by bank transfer')}</span></div>
    </div>

    ${ai ? redrawPromo() : ''}

    <section class="section alt" id="fitur">
      <div class="wrap">
        <h2>${ai ? L('Enam alat, satu alur kerja', 'Six tools, one workflow') : L('Lima alat, satu alur kerja', 'Five tools, one workflow')}</h2>
        <p class="sub">${L('Semua yang dibutuhkan untuk menyiapkan file sebelum masuk RIP.', 'Everything you need to prepare a file before it goes to the RIP.')}</p>
        <div class="cards${ai ? '' : ' c5'}">
          <article class="card feat"><div class="ic">${icon('check')}</div><h3>${L('Cek Gambar', 'Image Checker')}</h3><p>${L('Periksa resolusi, latar, tepi berbayang, dan bintik sebelum cetak, lalu perbaiki otomatis atau dengan pipet.', 'Check resolution, background, haloed edges and specks before printing, then fix them automatically or with the eyedropper.')}</p><div class="meta">${L('Cek gratis · 1 kredit per unduhan', 'Free check · 1 credit per download')}</div></article>
          <article class="card feat"><div class="ic">${icon('halftone')}</div><h3>Halftone</h3><p>${L('Raster bulat atau garis 30–60 LPI dan knockout hitam, putih, atau warna pilihan, supaya gradasi tercetak halus di kain.', 'Round or line rasters at 30–60 LPI plus black, white or custom-colour knockout, so gradients print smoothly on fabric.')}</p><div class="meta">${L('Di browser · 2 kredit per unduhan', 'In your browser · 2 credits per download')}</div></article>
          <article class="card feat"><div class="ic">${icon('pen')}</div><h3>${L('Vektor', 'Vector')}</h3><p>${L('Ubah logo dan desain warna rata jadi SVG berkurva yang tetap tajam di ukuran berapa pun.', 'Turn logos and flat-colour designs into a curve-based SVG that stays sharp at any size.')}</p><div class="meta">${L('Di browser · 1 kredit per unduhan', 'In your browser · 1 credit per download')}</div></article>
          <article class="card feat"><div class="ic">${icon('sheet')}</div><h3>Gangsheet</h3><p>${L('Susun banyak desain di satu roll film otomatis, termasuk mengikuti bentuk logo supaya film lebih hemat, lalu ekspor PNG/PDF ukuran asli.', 'Arrange many designs on one roll of film automatically, even following logo shapes to save film, then export PNG/PDF at real size.')}</p><div class="meta">${L('Di browser · 1 kredit per meter film', 'In your browser · 1 credit per metre of film')}</div></article>
          <article class="card feat"><div class="ic">${icon('expand')}</div><h3>Upscale</h3><p>${L('Perbesar gambar kecil 2×, 4×, 8×, atau 16× dengan AI, lengkap dengan progres dan riwayat.', 'Enlarge small images 2×, 4×, 8× or 16× with AI, with live progress and history.')}</p><div class="meta">${L('Diproses di server · 1 kredit per gambar', 'Processed on our server · 1 credit per image')}</div></article>
          ${ai ? `<article class="card feat"><div class="ic">${icon('spark')}</div><h3>${L('Redraw AI', 'Redraw AI')}</h3><p>${L('Desain pecah, buram, atau hasil foto digambar ulang AI jadi bersih dan tajam, latar langsung dibuang. Kredit kembali kalau AI gagal.', 'Broken, blurry or photographed designs redrawn by AI as clean, sharp art, with the background removed. Credits come back if the AI fails.')}</p><div class="meta">${L(`${cfg.aiPrices.cost['2K']} kredit (2K) · ${cfg.aiPrices.cost['4K']} kredit (4K)`, `${cfg.aiPrices.cost['2K']} credits (2K) · ${cfg.aiPrices.cost['4K']} credits (4K)`)}</div></article>` : ''}
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
        <h2>${L(`Bayar per unduhan, mulai ${fromPrice} per kredit`, `Pay per download, from ${fromPrice} per credit`)}</h2>
        <p class="sub">${L('Atur dan pratinjau sepuasnya, gratis. Kredit baru terpakai saat Anda mengunduh.', 'Adjust and preview as much as you like, for free. Credits are only used when you download.')}</p>
        <ul class="use-row" aria-label="${L('Pemakaian kredit', 'Credit usage')}">
          <li><b>1</b> Cek Gambar</li><li><b>2</b> Raster / Knockout</li><li><b>1</b> Vektor</li><li><b>1</b> Upscale</li><li><b>1</b> ${L('per meter Gangsheet', 'per metre of Gangsheet')}</li>${ai ? `<li><b>${cfg.aiPrices.cost['2K']}</b> ${L('Redraw AI', 'Redraw AI')}</li>` : ''}
        </ul>
        <div class="prices" id="prices">${pricing()}</div>
        <p class="fine small muted price-foot">${L('Kredit tidak pernah hangus. Bayar dengan QRIS atau Virtual Account bank.', 'Credits never expire. Pay with QRIS or a bank Virtual Account.')}</p>
      </div>
    </section>

    <section class="section" id="faq">
      <div class="wrap">
        <h2>${L('Pertanyaan umum', 'FAQ')}</h2>
        <div class="faq">
          ${faq(L('Apakah gambar saya disimpan?', 'Are my images stored?'), L('Untuk Knockout dan Raster, gambar diproses di browser dan tidak disimpan. Yang tercatat hanya riwayat unduhan (nama file, jenis operasi, ukuran). Fitur Upscale dan Redraw AI mengirim gambar ke layanan pemroses agar bisa dikerjakan.', 'For Knockout and Raster, images are processed in your browser and never stored. We only log your download history (file name, operation, size). Upscale and Redraw AI send the image to a processing service so it can be worked on.'))}
          ${ai ? faq(L('Apa bedanya Redraw AI dengan Upscale?', 'How is Redraw AI different from Upscale?'), L('Upscale memperbesar gambar yang sudah bagus. Redraw AI menggambar ulang gambar yang pecah, buram, bergerigi, atau masih berupa foto kaos, lalu membuang latarnya. Hasil AI bisa sedikit berbeda dari aslinya, jadi selalu cek sebelum cetak. Kalau AI gagal, kredit kembali otomatis.', 'Upscale enlarges an image that is already good. Redraw AI redraws images that are broken, blurry, jagged or still a shirt photo, then removes the background. AI results can differ slightly from the original, so always check before printing. If the AI fails, your credits come back automatically.')) : ''}
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

// Homepage promo for Redraw AI (shown only while the feature is open to customers).
function redrawPromo() {
  const p = cfg.aiPrices;
  const minPer = Math.min(...state.packages.map((x) => x.harga / x.kredit));
  const approx = rupiah(Math.ceil((p.cost['2K'] * minPer) / 100) * 100);
  const uses = [
    ['expand', L('Gambar pecah &amp; buram', 'Broken &amp; blurry images'), L('Hasil screenshot, kiriman WA, atau file kecil jadi tajam. Warna dan gradasi tetap.', 'Screenshots, WhatsApp images or tiny files made sharp. Colours and gradients stay.')],
    ['pen', L('Logo &amp; tulisan bergerigi', 'Jagged logos &amp; lettering'), L('Garis dan huruf digambar ulang rapi, ejaan tetap sama.', 'Lines and letters redrawn cleanly, same spelling.')],
    ['halftone', L('Warna rata siap sablon', 'Flat colour, screen-print ready'), L('Gradasi dirapikan jadi blok warna, mudah dijadikan vektor.', 'Gradients turned into clean colour blocks, easy to vectorise.')],
    ['shirt', L('Ambil desain dari foto kaos', 'Pull a design off a shirt photo'), L('Pelanggan cuma punya foto kaosnya? AI ambil desainnya saja, tanpa kain, lipatan, dan orang.', 'Customer only has a photo of the shirt? The AI keeps just the design: no fabric, folds or person.')],
  ];
  return `
    <section class="section redraw" id="redraw" aria-labelledby="redrawTitle">
      <div class="wrap redraw-grid">
        <div class="redraw-copy">
          <span class="redraw-tag">${icon('spark', 'i i-sm')}${L('Baru · Redraw AI', 'New · Redraw AI')}</span>
          <h2 id="redrawTitle">${L('File dari pelanggan jelek? Biar AI yang gambar ulang.', 'Bad file from a customer? Let AI redraw it.')}</h2>
          <p class="sub">${L('Tidak perlu lagi menolak order karena file pecah atau minta pelanggan cari file asli. Unggah gambarnya, pilih gayanya, dan unduh PNG transparan siap cetak DTF.', 'Stop turning down orders because the file is broken or chasing customers for the original. Upload the image, pick a style and download a transparent, DTF-ready PNG.')}</p>
          <ul class="redraw-uses">
            ${uses.map(([ic, t, d]) => `<li><span class="ic">${icon(ic)}</span><div><b>${t}</b><span>${d}</span></div></li>`).join('')}
          </ul>
          <ul class="redraw-perks">
            <li>${icon('check', 'i i-sm')}${L('Latar langsung transparan', 'Background removed automatically')}</li>
            <li>${icon('refresh', 'i i-sm')}${L('Revisi sampai 3×', 'Up to 3 revisions')}</li>
            <li>${icon('shield', 'i i-sm')}${L('AI gagal? Kredit kembali otomatis', 'AI failed? Credits refunded automatically')}</li>
          </ul>
          <div class="redraw-cta">
            <a class="btn btn-primary btn-xl" href="#ai" data-route="ai">${icon('spark', 'i i-sm')}${L('Coba Redraw AI', 'Try Redraw AI')}</a>
            <div class="redraw-price"><b>${L(`${p.cost['2K']} kredit`, `${p.cost['2K']} credits`)}</b><span>${L(`per gambar 2K · mulai ± ${approx}`, `per 2K image · from about ${approx}`)}</span></div>
          </div>
        </div>
        <figure class="redraw-shot">
          <div class="redraw-frame">
            <img src="/redraw-sample.webp" width="722" height="722" loading="lazy" alt="${L('Contoh hasil Redraw AI: desain YES dan SUMMER METHOD diambil dari foto kaos, latar transparan', 'Redraw AI example: the YES / SUMMER METHOD design pulled off a shirt photo, transparent background')}">
            <span class="redraw-badge">${icon('shirt', 'i i-sm')}${L('Dari foto kaos', 'From a shirt photo')}</span>
          </div>
          <figcaption>${L('Hasil asli Redraw AI, gaya "Ambil desain dari foto kaos". Kotak-kotak = bagian transparan.', 'Real Redraw AI output, "pull design from shirt photo" style. Checkerboard = transparent area.')}</figcaption>
        </figure>
      </div>
    </section>`;
}

const faq = (q, a) => `<details><summary>${esc(q)}${icon('chev')}</summary><p>${esc(a)}</p></details>`;

// Discount per credit compared with the smallest package.
const save = (p) => {
  const base = Math.max(...state.packages.map((x) => x.harga / x.kredit));
  const pct = Math.round((1 - p.harga / p.kredit / base) * 100);
  return pct >= 5 ? pct : 0;
};

export function pricing() {
  const pop = state.packages.find((p) => p.populer);
  return promoTicket() + state.packages.map((p) => {
    const b = bonusFor(p.kredit);
    return `
    <div class="card price${p.populer ? ' pop' : ''}${b ? ' has-bonus' : ''}">
      ${p.populer ? `<span class="p-ribbon">${L('Terlaris', 'Most popular')}</span>` : ''}
      <div class="p-head"><b class="p-name">${esc(pkgName(p))}</b><span class="p-note">${esc(pkgNote(p))}</span></div>
      <div class="amt">${rupiah(p.harga)}</div>
      <div class="p-credits">${b ? `<s>${p.kredit}</s><b>${p.kredit + b}</b>` : `<b>${p.kredit}</b>`}<span>${L('kredit', 'credits')}</span></div>
      ${b ? `<div class="p-bonus"><i></i>+${b} ${L('bonus akun baru', 'new-account bonus')}</div>` : ''}
      <div class="p-per">${L(`${rupiah(Math.round(p.harga / p.kredit))} per kredit`, `${rupiah(Math.round(p.harga / p.kredit))} per credit`)}${save(p) ? ` · <b class="save">${L('hemat', 'save')} ${save(p)}%</b>` : ''}</div>
      <div class="p-use">${L(`± ${Math.floor((p.kredit + b) / 2)} desain Raster/Knockout`, `± ${Math.floor((p.kredit + b) / 2)} Raster/Knockout designs`)}</div>
      <button class="btn ${p === pop ? 'btn-primary' : 'btn-secondary'} btn-lg" data-topup>${L('Pilih', 'Choose')} ${esc(pkgName(p))}</button>
    </div>`;
  }).join('');
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
