import './styles.css';
import { db } from './supa.js';
import { $, closeModal, toast } from './util.js';
import { state, onSession, applySession, clearSession, signOut, authDialog, topupDialog, newPasswordDialog, loadPackages, loadSettings, refreshCredits, isAdmin } from './session.js';
import { renderLanding, pricing } from './landing.js';
import { lang, L, setLang } from './i18n.js';
import { track, excludeThisDevice } from './track.js';

const APP_ROUTES = ['editor', 'vektor', 'gangsheet', 'upscale', 'kredit', 'admin', 'support', 'cek'];
const OPEN_ROUTES = ['support', 'cek', 'vektor', 'gangsheet', 'editor', 'upscale'];   // app pages that guests may open too
const LANDING_SECTIONS = ['harga', 'faq', 'fitur', 'cara'];
const LEGAL_ROUTES = ['privasi', 'ketentuan'];
const BASE_TITLE = document.title;
const view = $('view');
let current = null;       // current route name
let unmount = null;       // cleanup for the mounted app view

const authInUrl = /access_token|refresh_token|[?&]code=|type=recovery/.test(location.hash + location.search);

function routeFromHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (!h || /access_token|error_description|type=/.test(h)) return '';
  return h.split(/[?&]/)[0].split('/')[0];
}

export function go(route) {
  if (location.hash.replace(/^#/, '') === route) render();
  else location.hash = route;
}

async function render() {
  let route = routeFromHash();
  if (route === 'pengaturan') { history.replaceState(null, '', '#admin/koneksi'); route = 'admin'; }
  if (route === 'riwayat') { history.replaceState(null, '', '#kredit'); route = 'kredit'; }
  track(route);
  closeModal();
  document.querySelectorAll('.menu a, .admin-link').forEach((a) => (a.dataset.route === route ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));

  if (APP_ROUTES.includes(route)) {
    if (!state.user && !OPEN_ROUTES.includes(route)) { showLanding(); authDialog('masuk', '', () => render()); return; }
    if (route === 'admin' && !isAdmin()) { go('editor'); return; }
    if (current === route && !OPEN_ROUTES.includes(route)) return;
    unmount?.(); unmount = null;
    current = route;
    view.innerHTML = appFrame();
    const host = $('appMain');
    const mod = route === 'editor' ? await import('./editor.js')
      : route === 'upscale' ? await import('./upscale.js')
      : route === 'kredit' ? await import('./credits.js')
      : route === 'support' ? await import('./support.js')
      : route === 'cek' ? await import('./check.js')
      : route === 'vektor' ? await import('./vector.js')
      : route === 'gangsheet' ? await import('./gangsheet.js')
      : await import('./admin.js');
    unmount = mod.mount(host) || null; currentMod = mod;
    if (isAdmin()) Promise.all([db.rpc('admin_stats'), db.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'baru')])
      .then(([{ data }, { count }]) => { const c = $('menuCount'), t = (data?.waiting || 0) + (count || 0); if (c) { c.hidden = !t; c.textContent = String(t); } });
    return;
  }
  if (LEGAL_ROUTES.includes(route)) {
    unmount?.(); unmount = null; current = route;
    const { renderLegal } = await import('./legal.js');
    renderLegal(view, route); window.scrollTo(0, 0);
    return;
  }
  document.title = BASE_TITLE;
  showLanding();
  if (LANDING_SECTIONS.includes(route)) requestAnimationFrame(() => $(route)?.scrollIntoView({ behavior: 'smooth' }));
  else window.scrollTo(0, 0);
}

function showLanding() {
  if (current !== 'landing') { unmount?.(); unmount = null; current = 'landing'; renderLanding(view); }
}

function appFrame() {
  return `<div class="app"><div id="appMain" class="app-main" style="min-height:0;display:grid"></div></div>`;
}

// ---------- header + global clicks ----------
function syncHeader() {
  document.body.classList.toggle('is-auth', !!state.user);
  document.body.classList.toggle('is-admin', isAdmin());
  if (isAdmin()) excludeThisDevice();
  $('userBox').hidden = !state.user; $('logoutBtn').hidden = !state.user;
  $('userName').textContent = state.profile?.username || '';
}
onSession(syncHeader);
// Re-draw the app (and its admin menu) whenever the signed-in account or its role changes,
// so the Admin menu never lingers for a non-admin account.
// A guest who signs in on Halftone or Upscale keeps the work on screen: those pages refresh their
// account parts themselves (onSignIn) instead of being rebuilt.
let lastAccess = '', currentMod = null;
onSession(() => {
  const access = state.user ? state.user.id + ':' + (state.profile?.user_role || '') : '';
  if (access === lastAccess) return;
  const wasGuest = !lastAccess;
  lastAccess = access;
  if (!current || current === 'landing') return;
  if (wasGuest && state.user && !isAdmin() && currentMod?.onSignIn?.()) return;
  unmount?.(); unmount = null; current = null; render();
});

function syncTheme() {
  const light = document.documentElement.dataset.theme === 'light';
  $('themeIcon').querySelector('use').setAttribute('href', light ? '#i-moon' : '#i-sun');
  $('themeBtn').setAttribute('aria-label', light ? L('Mode gelap', 'Dark mode') : L('Mode terang', 'Light mode'));
  document.querySelector('meta[name=theme-color]').content = light ? '#f4f4f4' : '#1d1d1d';
}
$('themeBtn').onclick = () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('bnw-theme', next); } catch {}
  syncTheme();
};
$('loginBtn').onclick = () => authDialog('masuk', '', () => go('editor'));
$('signupBtn').onclick = () => authDialog('daftar', '', () => go('editor'));
$('logoutBtn').onclick = async () => { await signOut(); current = null; go(''); toast(L('Anda sudah keluar.', 'You are signed out.')); };
$('creditChip').onclick = () => topupDialog();

// Previews show the full result before it is paid for: no "Save image as" / "Copy image" on them.
document.addEventListener('contextmenu', (e) => { if (e.target.closest('canvas')) e.preventDefault(); });
document.addEventListener('dragstart', (e) => { if (e.target.closest('canvas')) e.preventDefault(); });

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) closeModal();
  if (e.target.closest('[data-topup]')) { if (state.user) topupDialog(); else authDialog('daftar', '', () => topupDialog()); }
  if (e.target.closest('[data-cta]')) go('editor');
  const r = e.target.closest('[data-route]');
  if (r && r.tagName === 'A') { e.preventDefault(); go(r.dataset.route); }
});
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
window.addEventListener('focus', () => refreshCredits());
window.addEventListener('hashchange', render);

// ---------- language ----------
function applyStaticText() {
  const pick = (v) => { const [id, en] = v.split('|'); return L(id, en ?? id); };
  document.querySelectorAll('[data-l]').forEach((el) => (el.textContent = pick(el.dataset.l)));
  document.querySelectorAll('[data-la]').forEach((el) => el.setAttribute('aria-label', pick(el.dataset.la)));
  document.querySelectorAll('[data-lt]').forEach((el) => el.setAttribute('title', pick(el.dataset.lt)));
  const b = $('langBtn');
  b.innerHTML = `<span${lang === 'id' ? ' class="on"' : ''}>ID</span><span${lang === 'en' ? ' class="on"' : ''}>EN</span>`;
  b.setAttribute('aria-label', L('Ganti bahasa ke English', 'Switch language to Bahasa Indonesia'));
  b.title = b.getAttribute('aria-label');
  b.onclick = () => setLang(lang === 'id' ? 'en' : 'id');
}
applyStaticText();

// ---------- boot ----------
(async function boot() {
  syncTheme();
  try { await Promise.all([loadPackages(), loadSettings()]); } catch {}
  const { data } = await db.auth.getSession();
  if (data?.session) await applySession(data.session);
  db.auth.onAuthStateChange((event, session) => {
    setTimeout(async () => {
      if (session) await applySession(session); else clearSession();
      if (event === 'PASSWORD_RECOVERY') newPasswordDialog(() => go('editor'));
      if (event === 'SIGNED_IN' && authInUrl && !APP_ROUTES.includes(routeFromHash())) go('editor');
    }, 0);
  });
  syncHeader();
  if (authInUrl && state.user && !APP_ROUTES.includes(routeFromHash())) { history.replaceState(null, '', location.pathname + '#editor'); }
  await render();
  const p = $('prices'); if (p) p.innerHTML = pricing();
})().catch((e) => {
  console.error(e);
  view.innerHTML = `<div class="page-in"><div class="notice error">${L('Gagal memulai', 'Failed to start')}: ${String(e.message || e)}</div></div>`;
});
