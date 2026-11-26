// Admin settings: Supabase connection for this browser, and the BigJPG API key (stored server-side).
import { invoke, validateConnection, testConnection } from './supa.js';
import { cfg, store, usingBrowserOverride } from './config.js';
import { $, esc, icon, notice } from './util.js';
import { isAdmin } from './session.js';

export function mount(host, opts = {}) {
  if (!isAdmin()) { host.innerHTML = '<div class="page"><div class="page-in">' + notice('Halaman ini hanya untuk admin.', 'error') + '</div></div>'; return; }
  const head = opts.embedded ? '' : '<div class="page"><div class="page-in" style="max-width:820px"><div class="page-head"><div><h1>Pengaturan</h1><p>Hanya terlihat oleh admin.</p></div></div>';
  host.innerHTML = head + `
    <div class="stack" style="max-width:820px">
      <section class="card stack">
        <div class="toolbar" style="margin:0"><div><h2>API BigJPG</h2><p class="xs muted" style="margin:2px 0 0">Key disimpan di server lewat Edge Function, tidak pernah dikirim ke browser.</p></div><span class="badge" id="bjStatus">Memuat…</span></div>
        <form id="bjForm" class="row" style="align-items:flex-end;flex-wrap:wrap">
          <div class="field grow" style="min-width:240px"><label for="bjKey">API key BigJPG</label><input id="bjKey" type="password" autocomplete="new-password" placeholder="Tempel API key BigJPG"></div>
          <button class="btn btn-primary btn-lg" id="bjSave" type="submit">Simpan API key</button>
        </form>
        <div id="bjNotice"></div>
      </section>

      <section class="card stack">
        <div class="toolbar" style="margin:0"><div><h2>Koneksi Supabase</h2><p class="xs muted" style="margin:2px 0 0">Dari Supabase Dashboard → Settings → API.</p></div><span class="badge b-success">Terhubung</span></div>
        ${notice(`Memakai proyek <b>${esc(cfg.supabaseUrl)}</b>${usingBrowserOverride ? ' (pengaturan browser ini)' : ' (bawaan situs)'}`, 'ok')}
        <form id="sbForm" class="form">
          <div class="field"><label for="sbUrl">Project URL</label><input id="sbUrl" placeholder="https://xxxx.supabase.co" value="${esc(store.get('cfg')?.supabaseUrl || '')}" autocomplete="off"></div>
          <div class="field"><label for="sbKey">Anon / publishable key</label><input id="sbKey" placeholder="sb_publishable_… atau eyJ…" value="${esc(store.get('cfg')?.supabaseAnonKey || '')}" autocomplete="off"></div>
          <p class="xs muted" style="margin:0">Jangan tempel kunci <b>service_role</b> / <b>secret</b>; kunci itu ditolak.</p>
          <div class="row" style="flex-wrap:wrap"><button class="btn btn-secondary btn-lg" type="submit" id="sbTest">Uji koneksi</button><button class="btn btn-secondary btn-lg" type="button" id="sbUse" disabled>Pakai di browser ini</button>${usingBrowserOverride ? '<button class="btn btn-danger btn-lg" type="button" id="sbClear">Hapus pengaturan browser</button>' : ''}</div>
        </form>
        <div id="sbResult" class="check-list" aria-live="polite"></div>
      </section>
    </div>` + (opts.embedded ? '' : '</div></div>');

  async function bjStatus() {
    const b = $('bjStatus');
    try {
      const r = await invoke('bigjpg-upscale', { action: 'config_status' });
      b.textContent = r.configured ? 'Aktif' + (r.masked_key ? ' · ' + r.masked_key : '') : 'Belum diatur';
      b.className = 'badge ' + (r.configured ? 'b-success' : 'b-warning');
    } catch (e) {
      b.textContent = 'Belum terhubung'; b.className = 'badge b-danger';
      $('bjNotice').innerHTML = notice(esc(e.message) + ' Pastikan Edge Function bigjpg-upscale sudah dipasang.', 'warn');
    }
  }
  $('bjForm').onsubmit = async (e) => {
    e.preventDefault();
    const key = $('bjKey').value.trim(), btn = $('bjSave');
    if (!key) { $('bjNotice').innerHTML = notice('API key BigJPG wajib diisi.', 'error'); return; }
    btn.disabled = true; btn.textContent = 'Menyimpan…';
    try { const r = await invoke('bigjpg-upscale', { action: 'save_config', api_key: key }); $('bjKey').value = ''; $('bjNotice').innerHTML = notice(esc(r.message || 'API key BigJPG berhasil disimpan.'), 'ok'); await bjStatus(); }
    catch (err) { $('bjNotice').innerHTML = notice(esc(err.message), 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Simpan API key'; }
  };
  bjStatus();

  let tested = null;
  $('sbForm').onsubmit = async (e) => {
    e.preventDefault(); tested = null; $('sbUse').disabled = true;
    const v = validateConnection($('sbUrl').value, $('sbKey').value);
    if (v.error) { $('sbResult').innerHTML = notice(esc(v.error), 'error'); return; }
    const b = $('sbTest'); b.disabled = true; b.textContent = 'Menguji…';
    let res;
    try { res = await testConnection(v.url, v.key); } catch (err) { res = [{ ok: false, label: 'Gagal memuat pustaka Supabase', hint: err.message }]; }
    b.disabled = false; b.textContent = 'Uji koneksi';
    $('sbResult').innerHTML = res.map((x) => notice(`<b>${esc(x.label)}</b>${x.hint ? '<br>' + esc(x.hint) : ''}`, x.ok ? 'ok' : 'warn')).join('');
    if (res[0]?.ok) { tested = v; $('sbUse').disabled = false; }
  };
  $('sbUse').onclick = () => { if (!tested) return; store.set('cfg', { supabaseUrl: tested.url, supabaseAnonKey: tested.key }); location.reload(); };
  $('sbClear')?.addEventListener('click', () => { store.set('cfg', null); location.reload(); });
}
