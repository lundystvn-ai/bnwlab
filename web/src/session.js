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

export function topupDialog(reason = '') {
  const wa = String(cfg.kontakWhatsApp || '').replace(/\D/g, '');
  const contact = wa
    ? `<a class="btn btn-primary btn-block" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent('Halo, saya mau isi kredit ' + cfg.brand)}">Hubungi via WhatsApp</a><p class="muted small center">WhatsApp: +${esc(wa)}</p>`
    : cfg.kontakEmail ? `<p>Email: <b>${esc(cfg.kontakEmail)}</b></p>` : '<p class="muted">Hubungi admin untuk isi kredit.</p>';
  openModal(`
    <h3>Isi kredit</h3>
    ${reason ? `<p class="muted">${esc(reason)}</p>` : ''}
    <div class="wallet-now">Saldo sekarang <b class="mono">${state.credits}</b> kredit</div>
    <div class="pack-list">${state.packages.map((p) => `
      <div class="pack${p.populer ? ' pop' : ''}">
        <div><div class="pack-name">${esc(p.nama)}${p.populer ? ' <span class="badge b-accent">Populer</span>' : ''}</div>
        <div class="muted small">${p.kredit} kredit · ${rupiah(Math.round(p.harga / p.kredit))}/kredit · ${esc(p.catatan || '')}</div></div>
        <b class="pack-price">${rupiah(p.harga)}</b>
      </div>`).join('')}</div>
    <p class="muted small">Pembayaran online segera hadir. Untuk saat ini pilih paket lalu konfirmasi ke admin; kredit ditambahkan setelah pembayaran diterima. Kredit tidak hangus.</p>
    ${contact}
    <div class="modal-actions"><button class="btn btn-quiet" data-close>Tutup</button></div>`);
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
