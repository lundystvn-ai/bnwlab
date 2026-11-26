// Who is signed in, their role, region and credit balance. Sign-in / sign-up / reset dialogs.
import { db, onAfterInvoke } from './supa.js';
import { cfg } from './config.js';
import { $, esc, rupiah, openModal, closeModal, notice } from './util.js';

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
  const daftar = mode === 'daftar', link = mode === 'link', lupa = mode === 'lupa', noPass = link || lupa;
  const title = daftar ? 'Daftar akun' : link ? 'Masuk dengan link email' : lupa ? 'Lupa password' : 'Masuk';
  openModal(`
    <div class="modal-logo"><img src="/logo-64.png" alt="BNW Lab" height="28"></div>
    <h3>${title}</h3>
    ${daftar ? '<p class="muted">Akun baru dapat <b>kredit gratis</b> untuk mencoba.</p>' : ''}
    ${lupa ? '<p class="muted">Masukkan email akun. Kami kirim kode untuk membuat atau mengganti password.</p>' : ''}
    <form id="pwForm" class="form">
      ${daftar ? '<div class="field"><label for="pwName">Nama</label><input id="pwName" required autocomplete="name" autofocus></div>' : ''}
      <div class="field"><label for="pwEmail">Email</label><input id="pwEmail" type="email" required autocomplete="email" value="${esc(email)}"${daftar ? '' : ' autofocus'}></div>
      ${noPass ? '' : `<div class="field"><label for="pwPass">Password${daftar ? ' <span class="muted">(minimal 8 karakter)</span>' : ''}</label><input id="pwPass" type="password" required minlength="${daftar ? 8 : 1}" autocomplete="${daftar ? 'new-password' : 'current-password'}"></div>`}
      <div id="pwMsg" aria-live="polite"></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit" id="pwSubmit">${daftar ? 'Daftar' : lupa ? 'Kirim kode' : link ? 'Kirim link masuk' : 'Masuk'}</button>
    </form>
    <div class="auth-links">
      ${lupa ? '<a href="#" data-pw="masuk">← Kembali ke Masuk</a>' : `
        ${daftar ? '<a href="#" data-pw="masuk">Sudah punya akun? Masuk</a>' : '<a href="#" data-pw="daftar">Belum punya akun? Daftar</a>'}
        ${mode === 'masuk' ? '<a href="#" data-pw="lupa">Lupa password?</a>' : ''}
        ${link ? '<a href="#" data-pw="masuk">Masuk dengan password</a>' : '<a href="#" data-pw="link">Masuk lewat link email</a>'}`}
    </div>`);
  document.querySelectorAll('[data-pw]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); authDialog(a.dataset.pw, $('pwEmail').value.trim(), after); }));
  $('pwForm').onsubmit = async (e) => {
    e.preventDefault();
    const em = $('pwEmail').value.trim().toLowerCase();
    const btn = $('pwSubmit'), label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Memproses…';
    let error = null, session = null, okMsg = '';
    if (lupa) {
      ({ error } = await db.auth.resetPasswordForEmail(em, { redirectTo: redirectTo() }));
      okMsg = `Link untuk membuat/mengganti password dikirim ke <b>${esc(em)}</b>.`;
    } else if (link) {
      ({ error } = await db.auth.signInWithOtp({ email: em, options: { emailRedirectTo: redirectTo() } }));
      okMsg = `Link masuk dikirim ke <b>${esc(em)}</b>. Buka email lalu klik link-nya.`;
    } else if (daftar) {
      const r = await db.auth.signUp({ email: em, password: $('pwPass').value, options: { emailRedirectTo: redirectTo(), data: { name: $('pwName').value.trim() } } });
      error = r.error; session = r.data?.session;
      okMsg = `Akun dibuat. Cek email <b>${esc(em)}</b> dan klik link konfirmasi, lalu masuk.`;
      if (!error && r.data?.user && r.data.user.identities?.length === 0) error = { message: 'Email ini sudah terdaftar. Silakan masuk, atau pakai "Lupa password".' };
    } else {
      const r = await db.auth.signInWithPassword({ email: em, password: $('pwPass').value });
      error = r.error; session = r.data?.session;
    }
    btn.disabled = false; btn.textContent = label;
    if (!error && lupa) return otpDialog(em, '', after);
    if (error) {
      const m = /invalid login/i.test(error.message)
        ? 'Email atau password salah. Kalau akun dibuat lewat link email, klik "Lupa password?" untuk membuat password.'
        : /not confirmed/i.test(error.message) ? 'Email belum dikonfirmasi. Cek email dan klik link konfirmasi.' : esc(error.message);
      $('pwMsg').innerHTML = notice(m, 'error');
    } else if (session) {
      await applySession(session); closeModal(); after?.();
    } else $('pwMsg').innerHTML = notice(okMsg, 'ok');
  };
}

function otpDialog(email, msg = '', after) {
  openModal(`
    <h3>Masukkan kode</h3>
    <p class="muted">Kode verifikasi dikirim ke <b>${esc(email)}</b>. Cek folder Spam bila tidak ada.</p>
    <form id="otpForm" class="form">
      <div class="field"><label for="otpCode">Kode dari email</label>
        <input id="otpCode" class="otp" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" placeholder="123456" autofocus></div>
      <div id="otpMsg" aria-live="polite">${msg}</div>
      <button class="btn btn-primary btn-lg btn-block" type="submit" id="otpSubmit">Verifikasi</button>
    </form>
    <div class="auth-links"><a href="#" id="otpResend">Kirim ulang kode</a><a href="#" id="otpBack">← Ganti email</a></div>`);
  $('otpBack').onclick = (e) => { e.preventDefault(); authDialog('lupa', email, after); };
  $('otpResend').onclick = async (e) => {
    e.preventDefault();
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
    $('otpMsg').innerHTML = error ? notice(esc(error.message), 'error') : notice('Kode baru dikirim. Pakai kode yang paling baru.', 'ok');
  };
  $('otpForm').onsubmit = async (e) => {
    e.preventDefault();
    const b = $('otpSubmit'); b.disabled = true; b.textContent = 'Memeriksa…';
    const { data, error } = await db.auth.verifyOtp({ email, token: $('otpCode').value.trim(), type: 'recovery' });
    b.disabled = false; b.textContent = 'Verifikasi';
    if (error || !data?.session) {
      $('otpMsg').innerHTML = notice(/expired|invalid/i.test(error?.message || '') ? 'Kode salah atau sudah kedaluwarsa. Periksa lagi, atau klik "Kirim ulang kode".' : esc(error?.message || 'Verifikasi gagal.'), 'error');
      return;
    }
    await applySession(data.session);
    newPasswordDialog(after);
  };
}

export function newPasswordDialog(after) {
  openModal(`
    <h3>Buat password baru</h3>
    <form id="npForm" class="form">
      <div class="field"><label for="npPass">Password baru <span class="muted">(minimal 8 karakter)</span></label><input id="npPass" type="password" required minlength="8" autocomplete="new-password" autofocus></div>
      <div id="npMsg" aria-live="polite"></div>
      <div class="modal-actions"><button type="button" class="btn btn-quiet" data-close>Nanti</button><button class="btn btn-primary" type="submit">Simpan password</button></div>
    </form>`);
  $('npForm').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await db.auth.updateUser({ password: $('npPass').value });
    if (error) { $('npMsg').innerHTML = notice(esc(error.message), 'error'); return; }
    $('npMsg').innerHTML = notice('Password disimpan. Mulai sekarang bisa masuk dengan email + password.', 'ok');
    setTimeout(() => { closeModal(); after?.(); }, 1200);
  };
}

// ---------- top-up: pick a package → QRIS with the amount → "Saya sudah bayar" → admin confirms ----------
export async function loadSettings() {
  const { data } = await db.from('app_settings').select('key,value');
  for (const r of data || []) {
    if (r.key === 'qris_static' && r.value) cfg.qrisStatic = r.value;
    if (r.key === 'kontak_whatsapp') cfg.kontakWhatsApp = r.value;
  }
}

const waLink = (text) => {
  const wa = String(cfg.kontakWhatsApp || '').replace(/\D/g, '');
  return wa ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}` : '';
};

export async function topupDialog(reason = '') {
  if (!state.user) { authDialog('daftar', '', () => topupDialog(reason)); return; }
  const mine = await db.from('payments').select('id,package_id,kredit,jumlah,status,claimed_at,created_at').eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(5);
  const waiting = (mine.data || []).filter((p) => p.status === 'pending' && p.claimed_at);
  openModal(`
    <h3>Isi kredit</h3>
    ${reason ? `<p class="muted">${esc(reason)}</p>` : ''}
    <div class="wallet-now">Saldo sekarang <b class="mono">${state.credits}</b> kredit</div>
    ${waiting.length ? notice(`${waiting.length} pembayaran menunggu konfirmasi admin (${waiting.map((p) => rupiah(p.jumlah)).join(', ')}). Kredit masuk otomatis setelah dicek.`, 'warn') : ''}
    <div class="pack-list" role="list">${state.packages.map((p) => `
      <button class="pack pack-btn${p.populer ? ' pop' : ''}" data-pack="${esc(p.id)}" role="listitem">
        <span><span class="pack-name">${esc(p.nama)}${p.populer ? ' <span class="badge b-accent">Terlaris</span>' : ''}</span>
        <span class="muted small">${p.kredit} kredit · ${rupiah(Math.round(p.harga / p.kredit))}/kredit · ${esc(p.catatan || '')}</span></span>
        <b class="pack-price">${rupiah(p.harga)}</b>
      </button>`).join('')}</div>
    <p class="muted small">Bayar dengan QRIS dari e-wallet atau m-banking apa pun. Kredit tidak hangus.</p>
    <div id="tpMsg"></div>`);
  document.querySelectorAll('[data-pack]').forEach((b) => (b.onclick = () => startTopup(b.dataset.pack, b)));
}

async function startTopup(packId, btn) {
  btn.disabled = true;
  let { data, error } = await db.rpc('create_topup', { p_package: packId });
  btn.disabled = false;
  let offline = false;   // database not upgraded yet: still show the QRIS, confirm by WhatsApp
  if (error && /function .* does not exist|Could not find the function|schema cache/i.test(error.message)) {
    const p = state.packages.find((x) => x.id === packId);
    if (p) { data = { id: 'manual-' + Date.now().toString(36), package: p.id, nama: p.nama, kredit: p.kredit, harga: p.harga }; error = null; offline = true; }
  }
  if (error) {
    const m = /too_many_pending/.test(error.message) ? 'Terlalu banyak pembayaran yang belum selesai. Selesaikan atau batalkan dulu.' : esc(error.message);
    $('tpMsg').innerHTML = notice(m, 'error'); return;
  }
  let payload, svg;
  try {
    const { dynamicQris } = await import('./qris.js');
    const QR = (await import('qrcode')).default;
    payload = dynamicQris(cfg.qrisStatic, data.harga);
    svg = await QR.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } });
  } catch (e) { $('tpMsg').innerHTML = notice('QRIS tidak dapat dibuat: ' + esc(e.message), 'error'); return; }
  const { merchantName } = await import('./qris.js');
  const ref = offline ? data.id.slice(-6).toUpperCase() : String(data.id).slice(0, 8).toUpperCase();
  openModal(`
    <h3>Bayar ${rupiah(data.harga)}</h3>
    <p class="muted">Paket <b>${esc(data.nama)}</b> · ${data.kredit} kredit · kode <span class="mono">${ref}</span></p>
    <div class="qris-box"><div class="qris">${svg}</div>
      <div class="qris-meta"><b>${esc(merchantName(cfg.qrisStatic))}</b><span class="mono">${rupiah(data.harga)}</span></div></div>
    <ol class="qris-steps small">
      <li>Buka GoPay, OVO, DANA, ShopeePay, atau m-banking, lalu scan QRIS ini.</li>
      <li>Pastikan nominal <b>${rupiah(data.harga)}</b> dan bayar.</li>
      <li>Tekan <b>Saya sudah bayar</b>. Kredit masuk setelah admin mengecek pembayaran.</li>
    </ol>
    <div id="tpMsg"></div>
    <div class="modal-actions"><button class="btn btn-quiet" id="tpCancel">Batal</button><button class="btn btn-primary btn-lg" id="tpPaid">Saya sudah bayar</button></div>`, { wide: false });
  $('tpCancel').onclick = async () => { if (!offline) await db.rpc('cancel_topup', { p_id: data.id }); closeModal(); };
  $('tpPaid').onclick = async () => {
    const b = $('tpPaid'); b.disabled = true;
    if (!offline) {
      const r = await db.rpc('claim_topup', { p_id: data.id });
      if (r.error) { b.disabled = false; $('tpMsg').innerHTML = notice(esc(r.error.message), 'error'); return; }
    }
    const wa = waLink(`Halo, saya sudah bayar QRIS ${rupiah(data.harga)} untuk paket ${data.nama} (kode ${ref}). Email: ${state.user.email}`);
    openModal(`
      <h3>Terima kasih!</h3>
      ${notice(offline
        ? `Kirim bukti pembayaran <b>${rupiah(data.harga)}</b> (kode <span class="mono">${ref}</span>) ke admin. <b>${data.kredit} kredit</b> ditambahkan setelah dicek.`
        : `Pembayaran <b>${rupiah(data.harga)}</b> (kode <span class="mono">${ref}</span>) sedang dicek admin. <b>${data.kredit} kredit</b> masuk otomatis setelah dikonfirmasi.`, 'ok')}
      <p class="muted small">Biasanya tidak lama. Saldo diperbarui sendiri saat kamu kembali ke halaman ini.</p>
      <div class="modal-actions">${wa ? `<a class="btn btn-secondary" href="${esc(wa)}" target="_blank" rel="noopener">Kirim bukti via WhatsApp</a>` : ''}<button class="btn btn-primary" data-close>Selesai</button></div>`);
  };
}

export function renderCreditChip() {
  const chip = $('creditChip');
  if (!chip) return;
  chip.hidden = !state.user;
  chip.classList.toggle('low', !!state.user && state.credits <= 3 && state.credits > 0);
  chip.classList.toggle('empty', !!state.user && state.credits === 0);
  $('creditValue').textContent = String(state.credits);
}
onSession(renderCreditChip);
