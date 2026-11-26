// Support: quick contact (Instagram DM), common problems, and tickets that the admin answers on this page.
import { db } from './supa.js';
import { IG_DM, IG_USER } from './config.js';
import { $, esc, icon, notice, fmtDate } from './util.js';
import { state, authDialog } from './session.js';
import { L, lang } from './i18n.js';

// Indonesian labels are used by the admin page; customers see them in their language.
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

const TOPICS_EN = { pembayaran: 'Payments & credits', upscale: 'Upscale', editor: 'Knockout & Raster', akun: 'Account & sign-in', lainnya: 'Other' };
const STATUS_EN = { baru: 'Sent', diproses: 'In progress', selesai: 'Resolved' };
const topicLabel = (k) => (lang === 'en' ? TOPICS_EN[k] : TOPICS[k]) || k;
const statusLabel = (k) => { const s = TICKET_STATUS[k] || [k, '']; return lang === 'en' ? [STATUS_EN[k] || k, s[1]] : s; };

export function mount(host) {
  let alive = true;

  host.innerHTML = `
  <div class="page"><div class="page-in" style="max-width:1040px">
    <div class="page-head"><div><h1>Support</h1><p>${L('Ada kendala? Kirim pesan ke admin. Balasan muncul di halaman ini.', 'Need help? Send the admin a message. Replies appear on this page.')}</p></div></div>
    <div class="support">
      <div class="stack">
        <section class="card stack">
          <h2 style="margin:0">${L('Hubungi cepat', 'Quick contact')}</h2>
          <a class="btn btn-primary btn-lg btn-block" href="${IG_DM}" target="_blank" rel="noopener">${icon('chat', 'i i-sm')}${L('Chat admin via Instagram', 'Chat with the admin on Instagram')}</a>
          <p class="xs muted" style="margin:0;text-align:center">${L(`DM ke @${IG_USER}. Sebutkan email akunmu supaya cepat dibantu.`, `DM @${IG_USER}. Include your account email so we can help faster.`)}</p>
          <a class="btn btn-secondary btn-lg btn-block" href="#faq" data-route="faq">${L('Lihat pertanyaan umum (FAQ)', 'Read the FAQ')}</a>
        </section>
        <section class="card stack">
          <h2 style="margin:0">${L('Masalah yang sering terjadi', 'Common problems')}</h2>
          <ul class="help-list">
            ${L(`<li><b>Sudah bayar, kredit belum masuk.</b> Pastikan sudah menekan "Saya sudah bayar". Kredit masuk setelah admin mengecek pembayaran. Statusnya bisa dilihat di <a href="#kredit">Riwayat kredit</a>.</li>
            <li><b>Upscale gagal.</b> Kredit dikembalikan otomatis. Coba lagi, atau pilih skala yang lebih kecil.</li>
            <li><b>Lupa password.</b> Di jendela Masuk, klik "Lupa password?" lalu masukkan kode dari email.</li>
            <li><b>Hasil raster kurang pas.</b> Coba ubah Detail raster (LPI) dan pratinjau kaos hitam/putih sebelum mengunduh.</li>`,
            `<li><b>I paid but got no credits.</b> Make sure you pressed "I have paid". Credits are added once the admin has checked the payment. See the status in <a href="#kredit">Credit history</a>.</li>
            <li><b>Upscale failed.</b> Credits are refunded automatically. Try again, or choose a smaller scale.</li>
            <li><b>Forgot password.</b> In the sign-in window, click "Forgot password?" and enter the code from the email.</li>
            <li><b>The raster doesn't look right.</b> Try another Raster detail (LPI) and preview on a black/white shirt before downloading.</li>`)}
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
    box.innerHTML = `<h2 style="margin:0">${L('Kirim pesan ke admin', 'Message the admin')}</h2><p class="small muted" style="margin:0">${L('Masuk dulu supaya admin bisa melihat akun, kredit, dan pembayaranmu.', 'Sign in first so the admin can see your account, credits and payments.')}</p>
      <div class="row"><button class="btn btn-primary btn-lg" id="spLogin">${L('Masuk', 'Sign in')}</button><button class="btn btn-secondary btn-lg" id="spSignup">${L('Daftar', 'Sign up')}</button></div>`;
    $('spLogin').onclick = () => authDialog('masuk', '', () => { location.hash = 'support'; });
    $('spSignup').onclick = () => authDialog('daftar', '', () => { location.hash = 'support'; });
    return () => { alive = false; };
  }

  box.innerHTML = `
    <h2 style="margin:0">${L('Kirim pesan ke admin', 'Message the admin')}</h2>
    <form id="spForm" class="form">
      <div class="field"><label for="spTopic">${L('Topik', 'Topic')}</label><select id="spTopic">${Object.keys(TOPICS).map((k) => `<option value="${k}">${esc(topicLabel(k))}</option>`).join('')}</select></div>
      <div class="field"><label for="spMsg">${L('Pesan', 'Message')}</label><textarea id="spMsg" class="plain" rows="5" minlength="5" maxlength="2000" required placeholder="${L('Ceritakan kendalanya. Untuk pembayaran, sebutkan nominal dan kodenya.', 'Describe the problem. For payments, include the amount and code.')}"></textarea></div>
      <div class="field"><label for="spIg">${L('Username Instagram', 'Instagram username')} <span class="muted">${L('(opsional, kalau ingin dihubungi lewat DM)', '(optional, if you want us to DM you)')}</span></label><input id="spIg" maxlength="31" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="@username"></div>
      <div id="spNotice" aria-live="polite"></div>
      <button class="btn btn-primary btn-lg" type="submit" id="spSend">${icon('chat', 'i i-sm')}${L('Kirim pesan', 'Send message')}</button>
    </form>`;

  $('spForm').onsubmit = async (e) => {
    e.preventDefault();
    const pesan = $('spMsg').value.trim();
    const ig = $('spIg').value.trim().replace(/^@/, '');
    if (pesan.length < 5) { $('spNotice').innerHTML = notice(L('Pesan terlalu pendek.', 'The message is too short.'), 'error'); return; }
    if (ig && !/^[A-Za-z0-9._]{1,30}$/.test(ig)) { $('spNotice').innerHTML = notice(L('Username Instagram tidak valid.', 'Invalid Instagram username.'), 'error'); return; }
    const btn = $('spSend'); btn.disabled = true;
    const { error } = await db.from('support_tickets').insert({ user_id: state.user.id, topik: $('spTopic').value, pesan, instagram: ig || null });
    btn.disabled = false;
    if (error) {
      $('spNotice').innerHTML = notice(/too_many_tickets/.test(error.message) ? L('Kamu sudah mengirim 5 pesan dalam 24 jam. Tunggu balasan admin dulu, atau DM kami di Instagram.', 'You have sent 5 messages in 24 hours. Please wait for a reply, or DM us on Instagram.') : L('Pesan gagal dikirim: ', 'Could not send the message: ') + esc(error.message), 'error');
      return;
    }
    $('spMsg').value = '';
    $('spNotice').innerHTML = notice(L('Pesan terkirim. Admin akan membalas di halaman ini.', 'Message sent. The admin will reply on this page.'), 'ok');
    load();
  };

  async function load() {
    const list = $('spMine'); if (!list) return;
    const { data, error } = await db.from('support_tickets').select('id,topik,pesan,status,balasan,dibalas_at,created_at')
      .eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(50);
    if (!alive) return;
    if (error) { list.innerHTML = notice(esc(error.message), 'error'); return; }
    if (!data?.length) { list.innerHTML = ''; return; }
    list.innerHTML = `<h2 style="margin:4px 0 0">${L('Pesan saya', 'My messages')}</h2>` + data.map((t) => {
      const st = statusLabel(t.status);
      return `<article class="ticket">
        <div class="row"><b class="small">${esc(topicLabel(t.topik))}</b><span class="badge ${st[1]}">${st[0]}</span><span class="grow"></span><span class="xs subtle">${esc(fmtDate(t.created_at))}</span></div>
        <div class="msg">${esc(t.pesan)}</div>
        ${t.balasan ? `<div class="reply"><div class="xs subtle" style="margin-bottom:4px">${L('Balasan admin', 'Admin reply')} · ${esc(fmtDate(t.dibalas_at || t.created_at))}</div>${esc(t.balasan)}</div>` : ''}
      </article>`;
    }).join('');
  }
  load();
  return () => { alive = false; };
}
