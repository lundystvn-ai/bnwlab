import { esc, rupiah, icon } from './util.js';
import { state } from './session.js';

export function renderLanding(view) {
  view.innerHTML = `
  <main class="landing" id="landing">
    <div class="wrap hero">
      <div>
        <span class="eyebrow">Untuk percetakan &amp; kreator DTF</span>
        <h1>File DTF siap cetak, tanpa ribet.</h1>
        <p class="lead">Knockout latar, raster halftone, dan upscale dalam satu editor. Knockout dan raster diproses langsung di browser, jadi gambar tidak diunggah.</p>
        <div class="cta">
          <button class="btn btn-primary btn-xl" data-cta>Buka editor</button>
          <a class="btn btn-secondary btn-xl" href="#harga" data-route="harga">Lihat harga</a>
        </div>
        <p class="fine small muted">Daftar dan langsung dapat <b>5 kredit gratis</b> untuk mencoba. Pratinjau gratis, unduhan memakai kredit.</p>
      </div>
      <div class="compare" id="heroCompare" aria-label="Contoh sebelum dan sesudah raster">
        <img class="before" src="/sample-before.jpg" alt="" draggable="false">
        <img class="after" src="/sample-after.png" alt="Contoh hasil: latar hitam dibuang dan gradasi menjadi titik raster" draggable="false">
        <span class="ba l">Sebelum</span><span class="ba r">Sesudah · Raster + Knockout</span>
        <div class="split" id="heroSplit"><button class="knob" id="heroKnob" role="slider" aria-label="Bandingkan sebelum dan sesudah" aria-valuemin="0" aria-valuemax="100" aria-valuenow="52">${icon('lr')}</button></div>
      </div>
    </div>

    <section class="section alt" id="fitur">
      <div class="wrap">
        <h2>Tiga alat, satu alur kerja</h2>
        <p class="sub">Semua yang dibutuhkan untuk menyiapkan file sebelum masuk RIP.</p>
        <div class="cards">
          <article class="card feat"><div class="ic">${icon('scan')}</div><h3>Knockout</h3><p>Hapus hitam, putih, atau warna pilihan jadi transparan. Ada pengambil warna, mode area, toleransi, dan pembanding sebelum/sesudah.</p><div class="meta">Di browser · 3 kredit per unduhan</div></article>
          <article class="card feat"><div class="ic">${icon('halftone')}</div><h3>Raster Halftone</h3><p>Ubah gradasi jadi raster bulat atau garis, 30–60 LPI, dengan sudut garis 15°–60°, supaya tercetak halus di kain.</p><div class="meta">Di browser · 3 kredit per unduhan</div></article>
          <article class="card feat"><div class="ic">${icon('expand')}</div><h3>Upscale</h3><p>Perbesar gambar kecil 2×, 4×, 8×, atau 16× dengan AI, lengkap dengan progres dan riwayat.</p><div class="meta">Diproses di server · 1 kredit per gambar</div></article>
        </div>
      </div>
    </section>

    <section class="section" id="cara">
      <div class="wrap">
        <h2>Cara kerja</h2>
        <p class="sub">Tiga langkah dari desain ke file transparan.</p>
        <ol class="steps">
          <li><b>Unggah</b><span class="muted">Tarik gambar PNG, JPG, atau WebP ke editor.</span></li>
          <li><b>Atur</b><span class="muted">Pilih raster bulat atau garis, lalu knockout. Geser garis biru untuk membandingkan.</span></li>
          <li><b>Unduh</b><span class="muted">PNG transparan siap dikirim ke RIP atau printer DTF.</span></li>
        </ol>
      </div>
    </section>

    <section class="section alt" id="harga">
      <div class="wrap">
        <h2>Desain siap cetak mulai Rp1.500</h2>
        <p class="sub">Atur dan pratinjau sepuasnya, gratis. Kredit baru terpakai saat Anda mengunduh: Raster/Knockout 3 kredit, Upscale 1 kredit. Kredit tidak pernah hangus, dan paket Studio hemat sampai 38% per kredit.</p>
        <div class="prices" id="prices">${pricing()}</div>
      </div>
    </section>

    <section class="section" id="faq">
      <div class="wrap">
        <h2>Pertanyaan umum</h2>
        <div class="faq">
          ${faq('Apakah gambar saya disimpan?', 'Untuk Knockout dan Raster, gambar diproses di browser dan tidak disimpan. Yang tercatat hanya riwayat unduhan (nama file, jenis operasi, ukuran). Fitur Upscale mengunggah gambar ke layanan upscale agar bisa diproses.')}
          ${faq('Format apa yang dihasilkan?', 'PNG dengan latar transparan, siap dipakai di software RIP untuk DTF.')}
          ${faq('Apa yang terjadi kalau kredit habis?', 'Isi kredit kapan saja. Pratinjau di layar tetap bisa dipakai; unduhan membutuhkan kredit.')}
          ${faq('Bolehkah memakai desain milik orang lain?', 'Anda bertanggung jawab atas hak cipta gambar yang diunggah. Pastikan Anda berhak memakainya.')}
        </div>
      </div>
    </section>

    <footer class="footer"><div class="wrap"><img src="/logo-64.png" alt="BNW Lab"><span>© ${new Date().getFullYear()} BNW Design Lab · Instagram @bnwlab</span></div></footer>
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
      <div class="row"><b>${esc(p.nama)}</b>${p.populer ? '<span class="badge b-accent" style="margin-left:auto">Terlaris</span>' : ''}</div>
      <div class="amt">${rupiah(p.harga)}</div>
      <div class="muted small">${p.kredit} kredit · ${rupiah(Math.round(p.harga / p.kredit))}/kredit${save(p) ? ` · <b class="save">hemat ${save(p)}%</b>` : ''}</div>
      <ul><li>${icon('check')}<span><b>± ${Math.floor(p.kredit / 3)} desain</b> Raster/Knockout <span class="muted">atau ${p.kredit} upscale</span></span></li><li>${icon('check')}${esc(p.catatan || 'Untuk semua alat')}</li><li>${icon('check')}Kredit tidak hangus</li></ul>
      <button class="btn ${p.populer ? 'btn-primary' : 'btn-secondary'} btn-lg" data-topup>Pilih ${esc(p.nama)}</button>
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
