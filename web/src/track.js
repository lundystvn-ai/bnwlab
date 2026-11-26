// Anonymous visit counter for the admin "Pengunjung" dashboard.
// Stores only random ids made here (no IP, no personal data). Admin devices are never counted.
import { db } from './supa.js';
import { state } from './session.js';
import { lang } from './i18n.js';
import { uuid } from './util.js';

const NO_TRACK = 'bnw-notrack';
const keep = (store, key) => {
  try { let v = store.getItem(key); if (!v) { v = uuid(); store.setItem(key, v); } return v; } catch { return uuid(); }
};
let last = '', lastAt = 0, first = true;

// Call once the device is known to belong to an admin: it stays uncounted even when signed out.
export function excludeThisDevice() { try { localStorage.setItem(NO_TRACK, '1'); } catch {} }

export function track(route) {
  try { if (localStorage.getItem(NO_TRACK)) return; } catch {}
  if (state.profile?.user_role === 'admin') { excludeThisDevice(); return; }
  const path = route || 'home';
  if (!/^[a-z]{2,20}$/.test(path) || path === 'admin') return;
  const now = Date.now();
  if (path === last && now - lastAt < 5000) return;
  last = path; lastAt = now;

  let ref = null, utm = null;
  if (first) {
    first = false;
    try { const h = new URL(document.referrer).hostname.replace(/^www\./, ''); if (h && h !== location.hostname) ref = h; } catch {}
    const q = new URLSearchParams(location.search);
    utm = q.get('utm_source') || q.get('ref') || null;
  }
  const ua = navigator.userAgent || '';
  const device = /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone|iPod/i.test(ua) ? 'mobile' : 'desktop';
  db.rpc('track_visit', {
    p_visitor: keep(localStorage, 'bnw-vid'), p_session: keep(sessionStorage, 'bnw-sid'),
    p_path: path, p_ref: ref, p_device: device, p_lang: lang, p_utm: utm,
  }).then(() => {}, () => {});
}
