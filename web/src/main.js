import './styles.css';
import { db } from './supa.js';
import { $, closeModal, toast } from './util.js';
import { state, onSession, applySession, clearSession, signOut, authDialog, topupDialog, newPasswordDialog, loadPackages, loadSettings, refreshCredits, isAdmin } from './session.js';
import { renderLanding, pricing } from './landing.js';

const APP_ROUTES = ['editor', 'upscale', 'riwayat', 'admin'];
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
  closeModal();
  document.querySelectorAll('.menu a').forEach((a) => (a.dataset.route === route ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));

  if (APP_ROUTES.includes(route)) {
    if (!state.user) { showLanding(); authDialog('masuk', '', () => render()); return; }
    if (route === 'admin' && !isAdmin()) { go('editor'); return; }
    if (current === route) return;
    unmount?.(); unmount = null;
    current = route;
    view.innerHTML = appFrame(route);
    const host = $('appMain');
    const mod = route === 'editor' ? await import('./editor.js')
      : route === 'upscale' ? await import('./upscale.js')
      : route === 'riwayat' ? await import('./history.js')
      : await import('./admin.js');
    unmount = mod.mount(host) || null;
    if (isAdmin()) db.rpc('admin_stats').then(({ data }) => { const c = $('railCount'); if (c && data?.waiting) { c.hidden = false; c.textContent = String(data.waiting); } });
    return;
  }
  showLanding();
  if (LANDING_SECTIONS.includes(route)) requestAnimationFrame(() => $(route)?.scrollIntoView({ behavior: 'smooth' }));
  else window.scrollTo(0, 0);
}

function showLanding() {
  if (current !== 'landing') { unmount?.(); unmount = null; current = 'landing'; renderLanding(view); }
}

function appFrame(route) {
  const t = (r, ic, label, extra = '') => `<a class="tool ${extra}" href="#${r}" ${route === r ? 'aria-current="page"' : ''} aria-label="${label}"><svg class="i"><use href="#i-${ic}"/></svg><span class="tip">${label}</span></a>`;
  return `<div class="app">
    <nav class="rail" aria-label="Alat">
      ${t('editor', 'halftone', 'Knockout & Raster')}
      ${t('upscale', 'expand', 'Upscale')}
      <span class="sep"></span>
      ${t('riwayat', 'history', 'Riwayat')}
      ${isAdmin() ? `<a class="tool" href="#admin" ${route === 'admin' ? 'aria-current="page"' : ''} aria-label="Admin"><svg class="i"><use href="#i-shield"/></svg><span class="count" id="railCount" hidden></span><span class="tip">Admin</span></a>` : ''}
    </nav>
    <div id="appMain" class="app-main" style="min-height:0;display:grid"></div>
  </div>`;
}

// ---------- header + global clicks ----------
function syncHeader() {
  document.body.classList.toggle('is-auth', !!state.user);
  document.body.classList.toggle('is-admin', isAdmin());
  $('userBox').hidden = !state.user; $('logoutBtn').hidden = !state.user;
  $('userName').textContent = state.profile?.username || '';
}
onSession(syncHeader);

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
