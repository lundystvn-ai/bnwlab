// Who is signed in, their role, region and credit balance. Sign-in / sign-up / reset dialogs.
import { db, onAfterInvoke, invoke } from './supa.js';
import { cfg, IG_DM } from './config.js';
import { $, esc, rupiah, openModal, closeModal, notice } from './util.js';
import { leakedCount, leakedMessage } from './pwned.js';
import { L, tr, pkgName, pkgNote } from './i18n.js';

export const state = {
  user: null,
  profile: null,
  credits: 0,
  region: { id: 'web', nama: 'Web', timezone: 'Asia/Jakarta' },
  regions: [{ id: 'web', nama: 'Web' }],
  packages: cfg.packages,
};

const listeners = new Set();
export const onSession = (fn) => (listeners.add(fn), fn);
const emit = () => listeners.forEach((fn) => fn(state));

export const isAdmin = () => state.profile?.user_role === 'admin';
export const isManager = () => ['admin', 'supervisor'].includes(state.profile?.user_role);
export const regionId = () => state.profile?.wilayah_id || state.region?.id || 'web';
export const regionTz = () => state.region?.timezone || 'Asia/Jakarta';
export const regionName = (id) => state.regions.find((r) => String(r.id) === String(id))?.nama || id || '-';

export function setCredits(n) { state.credits = Math.max(0, Number(n) || 0); emit(); }
export async function refreshCredits() {
  if (!state.user) return emit();
  const { data, error } = await db.rpc('my_credits');
  if (!error && typeof data === 'number') setCredits(data);
}
onAfterInvoke(refreshCredits);

export async function loadPackages() {
  const { data } = await db.from('credit_packages').select('id,nama,kredit,harga,catatan,populer').eq('aktif', true).order('urutan');
  if (data?.length) state.packages = data;
}

async function loadProfile(session) {
  const u = session.user;
  const [p, w] = await Promise.all([
    db.from('profiles').select('username,user_role,wilayah_id').eq('id', u.id).maybeSingle(),
    db.from('wilayah').select('id,nama,timezone'),
  ]);
  const username = p.data?.username || (u.email || 'pengguna').split('@')[0];
  state.user = { id: u.id, email: u.email };
  state.profile = { username, nama: username, user_role: p.data?.user_role || 'user', wilayah_id: p.data?.wilayah_id || 'web' };
  if (w.data?.length) {
    state.regions = w.data;
    state.region = w.data.find((r) => r.id === state.profile.wilayah_id) || w.data[0];
  }
  await refreshCredits();
  emit();
}

export async function applySession(session) {
  if (!session?.user) { clearSession(); return; }
  if (state.user?.id !== session.user.id) await loadProfile(session);
}
export function clearSession() {
  state.user = null; state.profile = null; state.credits = 0; emit();
}
export async function signOut() { await db.auth.signOut(); clearSession(); }

// ---------- dialogs ----------
const redirectTo = () => location.origin + location.pathname;

export function authDialog(mode = 'masuk', email = '', after) {
  if (mode === 'link') mode = 'masuk';
  const daftar = mode === 'daftar', lupa = mode === 'lupa', noPass = lupa;
  const title = daftar ? L('Daftar akun', 'Create an account') : lupa ? L('Lupa password', 'Forgot password') : L('Masuk', 'Sign in');
  openModal(`
    <div class="modal-logo"><img src="/logo-64.png" alt="BNW Lab" height="28"></div>
    <h3>${title}</h3>
    ${daftar ? `<p class="muted">${L('Akun baru langsung dapat <b>5 kredit gratis</b> untuk mencoba.', 'New accounts get <b>5 free credits</b> to try it out.')}</p>` : ''}
    ${lupa ? `<p class="muted">${L('Masukkan email akun. Kami kirim kode untuk membuat atau mengganti password.', 'Enter your account email. We will send a code to create or change your password.')}</p>` : ''}
    <form id="pwForm" class="form">
      ${daftar ? `<div class="field"><label for="pwName">${L('Nama', 'Name')}</label><input id="pwName" required autocomplete="name" autofocus></div>` : ''}
      <div class="field"><label for="pwEmail">Email</label><input id="pwEmail" type="email" required autocomplete="email" value="${esc(email)}"${daftar ? '' : ' autofocus'}></div>
      ${noPass ? '' : `<div class="field"><label for="pwPass">Password${daftar ? ` <span class="muted">${L('(minimal 8 karakter)', '(at least 8 characters)')}</span>` : ''}</label><input id="pwPass" type="password" required minlength="${daftar ? 8 : 1}" autocomplete="${daftar ? 'new-password' : 'current-password'}"></div>`}
      <div id="pwMsg" aria-live="polite"></div>
      ${daftar ? `<p class="xs muted" style="margin:0">${L('Dengan mendaftar, Anda menyetujui <a href="#ketentuan">Syarat &amp; Ketentuan</a> dan <a href="#privasi">Kebijakan Privasi</a>.', 'By signing up you agree to the <a href="#ketentuan">Terms of Service</a> and <a href="#privasi">Privacy Policy</a>.')}</p>` : ''}
      <button class="btn btn-primary btn-lg btn-block" type="submit" id="pwSubmit">${daftar ? L('Daftar', 'Sign up') : lupa ? L('Kirim kode', 'Send code') : L('Masuk', 'Sign in')}</button>
    </form>
    <div class="auth-links">
      ${lupa ? `<a href="#" data-pw="masuk">${L('← Kembali ke Masuk', '← Back to sign in')}</a>` : `
        ${daftar ? `<a href="#" data-pw="masuk">${L('Sudah punya akun? Masuk', 'Already have an account? Sign in')}</a>` : `<a href="#" data-pw="daftar">${L('Belum punya akun? Daftar', 'No account yet? Sign up')}</a>`}
        ${mode === 'masuk' ? `<a href="#" data-pw="lupa">${L('Lupa password?', 'Forgot password?')}</a>` : ''}`}
    </div>`);
  document.querySelectorAll('[data-pw]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); authDialog(a.dataset.pw, $('pwEmail').value.trim(), after); }));
  $('pwForm').onsubmit = async (e) => {
    e.preventDefault();
    const em = $('pwEmail').value.trim().toLowerCase();
    const btn = $('pwSubmit'), label = btn.textContent;
    btn.disabled = true; btn.textContent = L('Memproses…', 'Working…');
    let error = null, session = null, okMsg = '';
    if (lupa) {
      ({ error } = await db.auth.resetPasswordForEmail(em, { redirectTo: redirectTo() }));
      okMsg = L(`Link untuk membuat/mengganti password dikirim ke <b>${esc(em)}</b>.`, `We sent a link to create or change your password to <b>${esc(em)}</b>.`);
    } else if (daftar) {
      const leaked = await leakedCount($('pwPass').value);
      if (leaked) { btn.disabled = false; btn.textContent = label; $('pwMsg').innerHTML = notice(leakedMessage(leaked), 'error'); return; }
      const r = await db.auth.signUp({ email: em, password: $('pwPass').value, options: { emailRedirectTo: redirectTo(), data: { name: $('pwName').value.trim() } } });
      error = r.error; session = r.data?.session;
      okMsg = L(`Akun dibuat. Cek email <b>${esc(em)}</b> dan klik link konfirmasi, lalu masuk.`, `Account created. Check <b>${esc(em)}</b>, click the confirmation link, then sign in.`);
      if (!error && r.data?.user && r.data.user.identities?.length === 0) error = { message: L('Email ini sudah terdaftar. Silakan masuk, atau pakai "Lupa password".', 'This email is already registered. Sign in, or use "Forgot password".') };
    } else {
      const r = await db.auth.signInWithPassword({ email: em, password: $('pwPass').value });
      error = r.error; session = r.data?.session;
    }
    btn.disabled = false; btn.textContent = label;
    if (!error && lupa) return otpDialog(em, '', after);
    if (error) {
      const m = /invalid login/i.test(error.message)
        ? L('Email atau password salah. Belum punya password? Klik "Lupa password?" untuk membuatnya.', 'Wrong email or password. No password yet? Click "Forgot password?" to create one.')
        : /not confirmed/i.test(error.message) ? L('Email belum dikonfirmasi. Cek email dan klik link konfirmasi.', 'Your email is not confirmed yet. Check your inbox and click the confirmation link.') : esc(error.message);
      $('pwMsg').innerHTML = notice(m, 'error');
    } else if (session) {
      await applySession(session); closeModal(); after?.();
    } else $('pwMsg').innerHTML = notice(okMsg, 'ok');
  };
}

function otpDialog(email, msg = '', after) {
  openModal(`
    <h3>${L('Masukkan kode', 'Enter the code')}</h3>
    <p class="muted">${L(`Kode verifikasi dikirim ke <b>${esc(email)}</b>. Cek folder Spam bila tidak ada.`, `We sent a verification code to <b>${esc(email)}</b>. Check your Spam folder if you don't see it.`)}</p>
    <form id="otpForm" class="form">
      <div class="field"><label for="otpCode">${L('Kode dari email', 'Code from the email')}</label>
        <input id="otpCode" class="otp" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" placeholder="123456" autofocus></div>
      <div id="otpMsg" aria-live="polite">${msg}</div>
      <button class="btn btn-primary btn-lg btn-block" type="submit" id="otpSubmit">${L('Verifikasi', 'Verify')}</button>
    </form>
    <div class="auth-links"><a href="#" id="otpResend">${L('Kirim ulang kode', 'Resend code')}</a><a href="#" id="otpBack">${L('← Ganti email', '← Change email')}</a></div>`);
  $('otpBack').onclick = (e) => { e.preventDefault(); authDialog('lupa', email, after); };
  $('otpResend').onclick = async (e) => {
    e.preventDefault();
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
    $('otpMsg').innerHTML = error ? notice(esc(error.message), 'error') : notice(L('Kode baru dikirim. Pakai kode yang paling baru.', 'A new code was sent. Use the most recent one.'), 'ok');
  };
  $('otpForm').onsubmit = async (e) => {
    e.preventDefault();
    const b = $('otpSubmit'); b.disabled = true; b.textContent = L('Memeriksa…', 'Checking…');
    const { data, error } = await db.auth.verifyOtp({ email, token: $('otpCode').value.trim(), type: 'recovery' });
    b.disabled = false; b.textContent = L('Verifikasi', 'Verify');
    if (error || !data?.session) {
      $('otpMsg').innerHTML = notice(/expired|invalid/i.test(error?.message || '') ? L('Kode salah atau sudah kedaluwarsa. Periksa lagi, atau klik "Kirim ulang kode".', 'The code is wrong or expired. Check it, or click "Resend code".') : esc(error?.message || L('Verifikasi gagal.', 'Verification failed.')), 'error');
      return;
    }
    await applySession(data.session);
    newPasswordDialog(after);
  };
}

export function newPasswordDialog(after) {
  openModal(`
    <h3>${L('Buat password baru', 'Create a new password')}</h3>
    <form id="npForm" class="form">
      <div class="field"><label for="npPass">${L('Password baru', 'New password')} <span class="muted">${L('(minimal 8 karakter)', '(at least 8 characters)')}</span></label><input id="npPass" type="password" required minlength="8" autocomplete="new-password" autofocus></div>
      <div id="npMsg" aria-live="polite"></div>
      <div class="modal-actions"><button type="button" class="btn btn-quiet" data-close>${L('Nanti', 'Later')}</button><button class="btn btn-primary" type="submit">${L('Simpan password', 'Save password')}</button></div>
    </form>`);
  $('npForm').onsubmit = async (e) => {
    e.preventDefault();
    const leaked = await leakedCount($('npPass').value);
    if (leaked) { $('npMsg').innerHTML = notice(leakedMessage(leaked), 'error'); return; }
    const { error } = await db.auth.updateUser({ password: $('npPass').value });
    if (error) { $('npMsg').innerHTML = notice(esc(error.message), 'error'); return; }
    $('npMsg').innerHTML = notice(L('Password disimpan. Mulai sekarang bisa masuk dengan email + password.', 'Password saved. From now on you can sign in with email + password.'), 'ok');
    setTimeout(() => { closeModal(); after?.(); }, 1200);
  };
}

// ---------- top-up: pick a package → QRIS with the amount → "Saya sudah bayar" → admin confirms ----------
export async function loadSettings() {
  const { data } = await db.from('app_settings').select('key,value');
  for (const r of data || []) {
    if (r.key === 'qris_static' && r.value) cfg.qrisStatic = r.value;
    if (r.key === 'kontak_whatsapp') cfg.kontakWhatsApp = r.value;
    if (r.key === 'pay_mode') cfg.payMode = r.value;
  }
}


export async function topupDialog(reason = '') {
  if (!state.user) { authDialog('daftar', '', () => topupDialog(reason)); return; }
  const mine = await db.from('payments').select('id,package_id,kredit,jumlah,status,claimed_at,created_at').eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(5);
  const waiting = (mine.data || []).filter((p) => p.status === 'pending' && p.claimed_at);
  openModal(`
    <h3>${L('Isi kredit', 'Top up credits')}</h3>
    ${reason ? `<p class="muted">${esc(reason)}</p>` : ''}
    <div class="wallet-now">${L(`Saldo sekarang <b class="mono">${state.credits}</b> kredit`, `Current balance <b class="mono">${state.credits}</b> credits`)}</div>
    ${waiting.length ? notice(L(`${waiting.length} pembayaran menunggu konfirmasi admin (${waiting.map((p) => rupiah(p.jumlah)).join(', ')}). Kredit masuk otomatis setelah dicek.`, `${waiting.length} payment(s) waiting for admin confirmation (${waiting.map((p) => rupiah(p.jumlah)).join(', ')}). Credits are added once checked.`), 'warn') : ''}
    <div class="pack-list" role="list">${state.packages.map((p) => `
      <button class="pack pack-btn${p.populer ? ' pop' : ''}" data-pack="${esc(p.id)}" role="listitem">
        <span><span class="pack-name">${esc(pkgName(p))}${p.populer ? ` <span class="badge b-accent">${L('Terlaris', 'Most popular')}</span>` : ''}</span>
        <span class="muted small">${L(`${p.kredit} kredit · ${rupiah(Math.round(p.harga / p.kredit))}/kredit`, `${p.kredit} credits · ${rupiah(Math.round(p.harga / p.kredit))}/credit`)} · ${esc(pkgNote(p))}</span></span>
        <b class="pack-price">${rupiah(p.harga)}</b>
      </button>`).join('')}</div>
    <p class="muted small">${L('Bayar dengan QRIS dari e-wallet atau m-banking apa pun. Kredit tidak hangus.', 'Pay with QRIS from any Indonesian e-wallet or mobile banking app. Credits never expire.')}</p>
    <div id="tpMsg"></div>`);
  document.querySelectorAll('[data-pack]').forEach((b) => (b.onclick = () => startTopup(b.dataset.pack, b)));
}

async function startTopup(packId, btn) {
  if (cfg.payMode === 'midtrans') return midtransTopup(packId, btn);
  btn.disabled = true;
  let { data, error } = await db.rpc('create_topup', { p_package: packId });
  btn.disabled = false;
  let offline = false;   // database not upgraded yet: still show the QRIS, confirm by Instagram DM
  if (error && /function .* does not exist|Could not find the function|schema cache/i.test(error.message)) {
    const p = state.packages.find((x) => x.id === packId);
    if (p) { data = { id: 'manual-' + Date.now().toString(36), package: p.id, nama: p.nama, kredit: p.kredit, harga: p.harga }; error = null; offline = true; }
  }
  if (error) {
    const m = /too_many_pending/.test(error.message) ? L('Terlalu banyak pembayaran yang belum selesai. Selesaikan atau batalkan dulu.', 'Too many unfinished payments. Complete or cancel them first.') : esc(tr(error.message));
    $('tpMsg').innerHTML = notice(m, 'error'); return;
  }
  let payload, svg;
  try {
    const { dynamicQris } = await import('./qris.js');
    const QR = (await import('qrcode')).default;
    payload = dynamicQris(cfg.qrisStatic, data.harga);
    svg = await QR.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } });
  } catch (e) { $('tpMsg').innerHTML = notice(L('QRIS tidak dapat dibuat: ', 'Could not create the QRIS code: ') + esc(e.message), 'error'); return; }
  const { merchantName } = await import('./qris.js');
  const ref = offline ? data.id.slice(-6).toUpperCase() : String(data.id).slice(0, 8).toUpperCase();
  openModal(`
    <h3>${L('Bayar', 'Pay')} ${rupiah(data.harga)}</h3>
    <p class="muted">${L('Paket', 'Pack')} <b>${esc(pkgName(state.packages.find((x) => x.id === packId) || { nama: data.nama }))}</b> · ${data.kredit} ${L('kredit', 'credits')} · ${L('kode', 'code')} <span class="mono">${ref}</span></p>
    <div class="qris-box"><div class="qris">${svg}</div>
      <div class="qris-meta"><b>${esc(merchantName(cfg.qrisStatic))}</b><span class="mono">${rupiah(data.harga)}</span></div></div>
    <ol class="qris-steps small">
      <li>${L('Buka GoPay, OVO, DANA, ShopeePay, atau m-banking, lalu scan QRIS ini.', 'Open GoPay, OVO, DANA, ShopeePay or your mobile banking app and scan this QRIS code.')}</li>
      <li>${L(`Pastikan nominal <b>${rupiah(data.harga)}</b> dan bayar.`, `Check that the amount is <b>${rupiah(data.harga)}</b> and pay.`)}</li>
      <li>${L('Tekan <b>Saya sudah bayar</b>. Kredit masuk setelah admin mengecek pembayaran.', 'Press <b>I have paid</b>. Credits are added once the admin has checked the payment.')}</li>
    </ol>
    <div id="tpMsg"></div>
    <div class="modal-actions"><button class="btn btn-quiet" id="tpCancel">${L('Batal', 'Cancel')}</button><button class="btn btn-primary btn-lg" id="tpPaid">${L('Saya sudah bayar', 'I have paid')}</button></div>`, { wide: false });
  $('tpCancel').onclick = async () => { if (!offline) await db.rpc('cancel_topup', { p_id: data.id }); closeModal(); };
  $('tpPaid').onclick = async () => {
    const b = $('tpPaid'); b.disabled = true;
    if (!offline) {
      const r = await db.rpc('claim_topup', { p_id: data.id });
      if (r.error) { b.disabled = false; $('tpMsg').innerHTML = notice(esc(tr(r.error.message)), 'error'); return; }
    }
    openModal(`
      <h3>${L('Terima kasih!', 'Thank you!')}</h3>
      ${notice(offline
        ? L(`Kirim bukti pembayaran <b>${rupiah(data.harga)}</b> (kode <span class="mono">${ref}</span>) ke admin. <b>${data.kredit} kredit</b> ditambahkan setelah dicek.`, `Send the payment proof for <b>${rupiah(data.harga)}</b> (code <span class="mono">${ref}</span>) to the admin. <b>${data.kredit} credits</b> are added once checked.`)
        : L(`Pembayaran <b>${rupiah(data.harga)}</b> (kode <span class="mono">${ref}</span>) sedang dicek admin. <b>${data.kredit} kredit</b> masuk otomatis setelah dikonfirmasi.`, `Your payment of <b>${rupiah(data.harga)}</b> (code <span class="mono">${ref}</span>) is being checked by the admin. <b>${data.kredit} credits</b> are added as soon as it is confirmed.`), 'ok')}
      <p class="muted small">${L('Biasanya tidak lama. Saldo diperbarui sendiri saat kamu kembali ke halaman ini.', 'This usually doesn\'t take long. Your balance updates by itself when you come back to this page.')}</p>
      <div class="modal-actions"><a class="btn btn-secondary" href="${IG_DM}" target="_blank" rel="noopener">${L('Kirim bukti via Instagram', 'Send proof via Instagram')}</a><button class="btn btn-primary" data-close>${L('Selesai', 'Done')}</button></div>`);
  };
}

// ---------- automatic QRIS through Midtrans: credits arrive by themselves after paying ----------
async function midtransTopup(packId, btn) {
  btn.disabled = true;
  let data;
  try { data = await invoke('midtrans', { action: 'create', package: packId }); }
  catch (e) { btn.disabled = false; $('tpMsg').innerHTML = notice(esc(tr(e.message)), 'error'); return; }
  btn.disabled = false;
  let svg = '', png = '';
  try {
    const QR = (await import('qrcode')).default;
    svg = await QR.toString(data.qr_string, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } });
    png = await QR.toDataURL(data.qr_string, { errorCorrectionLevel: 'M', margin: 3, width: 720 });
  } catch (e) { $('tpMsg').innerHTML = notice(L('QRIS tidak dapat ditampilkan: ', 'Could not show the QRIS code: ') + esc(e.message), 'error'); return; }
  const { merchantName } = await import('./qris.js');
  const ref = String(data.id).slice(0, 8).toUpperCase();
  const until = new Date(data.expires_at);
  const pack = state.packages.find((x) => x.id === packId) || { nama: data.nama };
  openModal(`
    <h3>${L('Bayar', 'Pay')} ${rupiah(data.harga)}</h3>
    <p class="muted">${L('Paket', 'Pack')} <b>${esc(pkgName(pack))}</b> · ${data.kredit} ${L('kredit', 'credits')} · ${L('kode', 'code')} <span class="mono">${ref}</span></p>
    ${data.sandbox ? notice(L('Mode uji coba: QRIS ini tidak bisa dibayar dengan uang sungguhan.', 'Test mode: this QRIS cannot be paid with real money.'), 'warn') : ''}
    <div class="qris-box"><div class="qris">${svg}</div>
      <div class="qris-meta"><b>${esc(merchantName(data.qr_string) || 'BNW Lab')}</b><span class="mono">${rupiah(data.harga)}</span></div></div>
    <ol class="qris-steps small">
      <li>${L('Buka GoPay, OVO, DANA, ShopeePay, atau m-banking, lalu scan QRIS ini. Di HP: simpan gambar QR, lalu pilih dari galeri di aplikasi pembayaran.', 'Open GoPay, OVO, DANA, ShopeePay or your banking app and scan this QRIS. On a phone: save the QR image, then pick it from your gallery in the payment app.')}</li>
      <li>${L(`Nominal <b>${rupiah(data.harga)}</b> sudah terisi. Bayar.`, `The amount <b>${rupiah(data.harga)}</b> is filled in. Pay.`)}</li>
      <li>${L('Selesai. Kredit masuk otomatis beberapa detik setelah pembayaran, tanpa perlu konfirmasi.', 'Done. Credits are added automatically a few seconds after you pay, no confirmation needed.')}</li>
    </ol>
    <div class="mt-live" id="tpLive" aria-live="polite"><span class="spin"></span><span id="tpLiveText">${L('Menunggu pembayaran…', 'Waiting for payment…')}</span></div>
    <div id="tpMsg"></div>
    <div class="modal-actions"><button class="btn btn-quiet" id="tpCancel">${L('Batal', 'Cancel')}</button><a class="btn btn-secondary" id="tpSave" href="${png}" download="qris-bnwlab-${ref}.png">${L('Simpan gambar QR', 'Save QR image')}</a></div>`);
  let stopped = false, busy = false;
  const left = () => {
    const ms = until - Date.now();
    if (ms <= 0) return L('kedaluwarsa', 'expired');
    const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    return `${m}:${String(s).padStart(2, '0')}`;
  };
  const tick = () => { const t = $('tpLiveText'); if (t && !stopped) t.textContent = L(`Menunggu pembayaran… berlaku ${left()}`, `Waiting for payment… valid for ${left()}`); };
  const done = async (paid) => {
    stopped = true; clearInterval(timer); clearInterval(clock);
    if (paid) {
      await refreshCredits();
      openModal(`
        <h3>${L('Pembayaran diterima!', 'Payment received!')}</h3>
        ${notice(L(`<b>${data.kredit} kredit</b> sudah masuk. Saldo sekarang <b>${state.credits}</b> kredit.`, `<b>${data.kredit} credits</b> have been added. Your balance is now <b>${state.credits}</b> credits.`), 'ok')}
        <div class="modal-actions"><button class="btn btn-primary" data-close>${L('Selesai', 'Done')}</button></div>`);
    } else {
      const live = $('tpLive'); if (live) live.innerHTML = notice(L('QRIS ini sudah kedaluwarsa. Buat QRIS baru untuk membayar.', 'This QRIS has expired. Make a new one to pay.'), 'warn');
      const save = $('tpSave'); if (save) { save.outerHTML = `<button class="btn btn-primary" id="tpAgain">${L('Buat QRIS baru', 'Make a new QRIS')}</button>`; $('tpAgain').onclick = () => topupDialog(); }
    }
  };
  const check = async () => {
    if (stopped || busy) return;
    if (!$('tpLive')) { stopped = true; clearInterval(timer); clearInterval(clock); return; }   // dialog closed
    busy = true;
    try {
      const r = await invoke('midtrans', { action: 'status', id: data.id });
      if (r.status === 'paid') await done(true);
      else if (r.status === 'expired' || (Date.now() > until.getTime() + 60000 && r.status !== 'pending')) await done(false);
      else if (Date.now() > until.getTime() + 120000) await done(false);
    } catch { /* try again on the next tick */ } finally { busy = false; }
  };
  const timer = setInterval(check, 4000);
  const clock = setInterval(tick, 1000); tick();
  $('tpCancel').onclick = async () => { stopped = true; clearInterval(timer); clearInterval(clock); await db.rpc('cancel_topup', { p_id: data.id }); closeModal(); };
}

export function renderCreditChip() {
  const chip = $('creditChip');
  if (!chip) return;
  chip.hidden = !state.user;
  chip.classList.toggle('low', !!state.user && state.credits < 6 && state.credits > 0);
  chip.classList.toggle('empty', !!state.user && state.credits === 0);
  $('creditValue').textContent = String(state.credits);
}
onSession(renderCreditChip);
