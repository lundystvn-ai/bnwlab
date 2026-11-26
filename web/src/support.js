// Support: quick contact (WhatsApp), common problems, and tickets that the admin answers on this page.
import { db } from './supa.js';
import { cfg } from './config.js';
import { $, esc, icon, notice, fmtDate } from './util.js';
import { state, authDialog } from './session.js';

export const TOPICS = {
  pembayaran: 'Pembayaran & kredit',
  upscale: 'Upscale',
  editor: 'Knockout & Raster',
  akun: 'Akun & login',
  lainnya: 'Lainnya',
};
export const TICKET_STATUS = {
  baru: ['Terkirim', 'b-warning'],
  diproses: ['Sedang dicek', 'b-accent'],
  selesai: ['Selesai', 'b-success'],
};

export function mount(host) {
  let alive = true;
  const wa = String(cfg.kontakWhatsApp || '').replace(/\D/g, '');
  const waHref = wa ? `https://wa.me/${wa}?text=${encodeURIComponent('Halo admin BNW Lab, saya butuh bantuan' + (state.user ? ` (akun ${state.user.email})` : '') + '.')}` : '';

  host.innerHTML = `
  <div class="page"><div class="page-in" style="max-width:1040px">
    <div class="page-head"><div><h1>Support</h1><p>Ada kendala? Kirim pesan ke admin. Balasan muncul di halaman ini.</p></div></div>
    <div class="support">
      <div class="stack">
        <section class="card stack">
          <h2 style="margin:0">Hubungi cepat</h2>
          ${waHref ? `<a class="btn btn-primary btn-lg btn-block" href="${esc(waHref)}" target="_blank" rel="noopener">${icon('chat', 'i i-sm')}Chat admin via WhatsApp</a>` : '<p class="small muted" style="margin:0">Kirim pesan lewat form di halaman ini.</p>'}
          <a class="btn btn-secondary btn-lg btn-block" href="#faq" data-route="faq">Lihat pertanyaan umum (FAQ)</a>
        </section>
        <section class="card stack">
          <h2 style="margin:0">Masalah yang sering terjadi</h2>
          <ul class="help-list">
            <li><b>Sudah bayar, kredit belum masuk.</b> Pastikan sudah menekan "Saya sudah bayar". Kredit masuk setelah admin mengecek pembayaran. Statusnya bisa dilihat di <a href="#kredit">Riwayat kredit</a>.</li>
            <li><b>Upscale gagal.</b> Kredit dikembalikan otomatis. Coba lagi, atau pilih skala yang lebih kecil.</li>
            <li><b>Lupa password.</b> Di jendela Masuk, klik "Lupa password?" lalu masukkan kode dari email.</li>
            <li><b>Hasil raster kurang pas.</b> Coba ubah Detail raster (LPI) dan pratinjau kaos hitam/putih sebelum mengunduh.</li>
          </ul>
        </section>
      </div>
      <div class="stack">
        <section class="card stack" id="spFormBox"></section>
        <section class="stack" id="spMine"></section>
      </div>
    </div>
  </div></div>`;

  const box = $('spFormBox');
  if (!state.user) {
    box.innerHTML = `<h2 style="margin:0">Kirim pesan ke admin</h2><p class="small muted" style="margin:0">Masuk dulu supaya admin bisa melihat akun, kredit, dan pembayaranmu.</p>
      <div class="row"><button class="btn btn-primary btn-lg" id="spLogin">Masuk</button><button class="btn btn-secondary btn-lg" id="spSignup">Daftar</button></div>`;
    $('spLogin').onclick = () => authDialog('masuk', '', () => { location.hash = 'support'; });
    $('spSignup').onclick = () => authDialog('daftar', '', () => { location.hash = 'support'; });
    return () => { alive = false; };
  }

  box.innerHTML = `
    <h2 style="margin:0">Kirim pesan ke admin</h2>
    <form id="spForm" class="form">
      <div class="field"><label for="spTopic">Topik</label><select id="spTopic">${Object.entries(TOPICS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
      <div class="field"><label for="spMsg">Pesan</label><textarea id="spMsg" class="plain" rows="5" minlength="5" maxlength="2000" required placeholder="Ceritakan kendalanya. Untuk pembayaran, sebutkan nominal dan kodenya."></textarea></div>
      <div class="field"><label for="spWa">Nomor WhatsApp <span class="muted">(opsional, kalau ingin dihubungi)</span></label><input id="spWa" inputmode="tel" maxlength="20" placeholder="08xxxxxxxxxx"></div>
      <div id="spNotice" aria-live="polite"></div>
      <button class="btn btn-primary btn-lg" type="submit" id="spSend">${icon('chat', 'i i-sm')}Kirim pesan</button>
    </form>`;

  $('spForm').onsubmit = async (e) => {
    e.preventDefault();
    const pesan = $('spMsg').value.trim();
    const waNum = $('spWa').value.replace(/[^\d+ -]/g, '').trim();
    if (pesan.length < 5) { $('spNotice').innerHTML = notice('Pesan terlalu pendek.', 'error'); return; }
    if (waNum && !/^[0-9+ -]{8,20}$/.test(waNum)) { $('spNotice').innerHTML = notice('Nomor WhatsApp tidak valid.', 'error'); return; }
    const btn = $('spSend'); btn.disabled = true;
    const { error } = await db.from('support_tickets').insert({ user_id: state.user.id, topik: $('spTopic').value, pesan, whatsapp: waNum || null });
    btn.disabled = false;
    if (error) {
      $('spNotice').innerHTML = notice(/too_many_tickets/.test(error.message) ? 'Kamu sudah mengirim 5 pesan dalam 24 jam. Tunggu balasan admin dulu, atau chat lewat WhatsApp.' : 'Pesan gagal dikirim: ' + esc(error.message), 'error');
      return;
    }
    $('spMsg').value = '';
    $('spNotice').innerHTML = notice('Pesan terkirim. Admin akan membalas di halaman ini.', 'ok');
    load();
  };

  async function load() {
    const list = $('spMine'); if (!list) return;
    const { data, error } = await db.from('support_tickets').select('id,topik,pesan,status,balasan,dibalas_at,created_at')
      .eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(50);
    if (!alive) return;
    if (error) { list.innerHTML = notice(esc(error.message), 'error'); return; }
    if (!data?.length) { list.innerHTML = ''; return; }
    list.innerHTML = `<h2 style="margin:4px 0 0">Pesan saya</h2>` + data.map((t) => {
      const st = TICKET_STATUS[t.status] || [t.status, ''];
      return `<article class="ticket">
        <div class="row"><b class="small">${esc(TOPICS[t.topik] || t.topik)}</b><span class="badge ${st[1]}">${st[0]}</span><span class="grow"></span><span class="xs subtle">${esc(fmtDate(t.created_at))}</span></div>
        <div class="msg">${esc(t.pesan)}</div>
        ${t.balasan ? `<div class="reply"><div class="xs subtle" style="margin-bottom:4px">Balasan admin · ${esc(fmtDate(t.dibalas_at || t.created_at))}</div>${esc(t.balasan)}</div>` : ''}
      </article>`;
    }).join('');
  }
  load();
  return () => { alive = false; };
}
