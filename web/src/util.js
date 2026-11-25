export const $ = (id) => document.getElementById(id);
export const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
export const rupiah = (n) => 'Rp' + Number(n).toLocaleString('id-ID');
export const num = (n) => Number(n || 0).toLocaleString('id-ID');
export const uuid = () => (crypto?.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2));
export const notice = (msg, type = 'ok') => (msg ? `<div class="notice ${type}" role="status">${icon(type === 'ok' ? 'ok' : type === 'error' ? 'alert' : 'tri')}<span>${msg}</span></div>` : '');
export const icon = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export const fmtDate = (d, tz = 'Asia/Jakarta') => new Date(d).toLocaleString('id-ID', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' });

let toastTimer;
export function toast(msg, type = 'ok') {
  const t = $('toast');
  t.className = 'toast ' + type;
  t.innerHTML = icon(type === 'ok' ? 'ok' : type === 'error' ? 'alert' : 'tri') + `<span>${msg}</span>`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4500);
}

// modal
let lastFocus = null;
export function openModal(html, { wide = false } = {}) {
  const m = $('modal');
  lastFocus = document.activeElement;
  m.querySelector('.modal-box').className = 'modal-box' + (wide ? ' wide' : '');
  m.querySelector('.modal-body').innerHTML = html;
  m.hidden = false;
  document.body.classList.add('modal-open');
  (m.querySelector('[autofocus]') || m.querySelector('input, select, button:not([data-close])') || m.querySelector('button'))?.focus();
}
export function closeModal() {
  const m = $('modal');
  if (m.hidden) return;
  m.hidden = true;
  document.body.classList.remove('modal-open');
  lastFocus?.focus?.();
}

// confirm dialog built into the page (no window.confirm)
export function confirmBox({ title, body, okLabel = 'Lanjut', danger = false, typeToConfirm = '' }) {
  return new Promise((resolve) => {
    openModal(`<h3>${esc(title)}</h3><p class="muted">${body}</p>
      ${typeToConfirm ? `<div class="field"><label for="cfType">Ketik <b>${esc(typeToConfirm)}</b> untuk melanjutkan</label><input id="cfType" autocomplete="off"></div>` : ''}
      <div class="modal-actions"><button class="btn btn-quiet" data-close>Batal</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="cfOk"${typeToConfirm ? ' disabled' : ''}>${esc(okLabel)}</button></div>`);
    const ok = $('cfOk'), inp = $('cfType');
    if (inp) inp.oninput = () => (ok.disabled = inp.value !== typeToConfirm);
    let done = false;
    const finish = (v) => { if (done) return; done = true; obs.disconnect(); closeModal(); resolve(v); };
    ok.onclick = () => finish(true);
    const obs = new MutationObserver(() => { if ($('modal').hidden) finish(false); });
    obs.observe($('modal'), { attributes: true, attributeFilter: ['hidden'] });
  });
}
