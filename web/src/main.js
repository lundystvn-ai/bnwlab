import './styles.css';
import { db } from './supa.js';
import { $, closeModal, toast } from './util.js';
import { state, onSession, applySession, clearSession, signOut, authDialog, topupDialog, newPasswordDialog, loadPackages, loadSettings, refreshCredits, isAdmin } from './session.js';
import { renderLanding, pricing } from './landing.js';

const APP_ROUTES = ['editor', 'upscale', 'kredit', 'admin', 'support'];
const OPEN_ROUTES = ['support'];   // app pages that guests may open too
const LANDING_SECTIONS = ['harga', 'faq', 'fitur', 'cara'];
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
  closeModal();
  document.querySelectorAll('.menu a').forEach((a) => (a.dataset.route === route ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));

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
      : await import('./admin.js');
    unmount = mod.mount(host) || null;
    if (isAdmin()) Promise.all([db.rpc('admin_stats'), db.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'baru')])
      .then(([{ data }, { count }]) => { const c = $('menuCount'), t = (data?.waiting || 0) + (count || 0); if (c) { c.hidden = !t; c.textContent = String(t); } });
    return;
  }
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
  $('userBox').hidden = !state.user; $('logoutBtn').hidden = !state.user;
  $('userName').textContent = state.profile?.username || '';
}
onSession(syncHeader);
// Re-draw the app (and its admin menu) whenever the signed-in account or its role changes,
// so the Admin menu never lingers for a non-admin account.
let lastAccess = '';
onSession(() => {
  const access = state.user ? state.user.id + ':' + (state.profile?.user_role || '') : '';
  if (access === lastAccess) return;
  lastAccess = access;
  if (current && current !== 'landing') { unmount?.(); unmount = null; current = null; render(); }
});

function syncTheme() {
  const light = document.documentElement.dataset.theme === 'light';
  $('themeIcon').querySelector('use').setAttribute('href', light ? '#i-moon' : '#i-sun');
  $('themeBtn').setAttribute('aria-label', light ? 'Mode gelap' : 'Mode terang');
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
$('logoutBtn').onclick = async () => { await signOut(); current = null; go(''); toast('Anda sudah keluar.'); };
$('creditChip').onclick = () => topupDialog();

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) closeModal();
  if (e.target.closest('[data-topup]')) { if (state.user) topupDialog(); else authDialog('daftar', '', () => topupDialog()); }
  if (e.target.closest('[data-cta]')) { if (state.user) go('editor'); else authDialog('daftar', '', () => go('editor')); }
  const r = e.target.closest('[data-route]');
  if (r && r.tagName === 'A') { e.preventDefault(); go(r.dataset.route); }
});
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
window.addEventListener('focus', () => refreshCredits());
window.addEventListener('hashchange', render);

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
  view.innerHTML = `<div class="page-in"><div class="notice error">Gagal memulai: ${String(e.message || e)}</div></div>`;
});
