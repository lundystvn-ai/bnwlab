// Admin settings: Supabase connection for this browser, and the BigJPG API key (stored server-side).
import { invoke, validateConnection, testConnection } from './supa.js';
import { cfg, store, usingBrowserOverride } from './config.js';
import { $, esc, icon, notice, num, toast, openModal, closeModal, confirmBox } from './util.js';
import { isAdmin } from './session.js';

export function mount(host, opts = {}) {
  if (!isAdmin()) { host.innerHTML = '<div class="page"><div class="page-in">' + notice('Halaman ini hanya untuk admin.', 'error') + '</div></div>'; return; }
  const head = opts.embedded ? '' : '<div class="page"><div class="page-in" style="max-width:820px"><div class="page-head"><div><h1>Pengaturan</h1><p>Hanya terlihat oleh admin.</p></div></div>';
  host.innerHTML = head + `
    <div class="stack" style="max-width:820px">
      <section class="card stack">
        <div class="toolbar" style="margin:0"><div><h2>Akun BigJPG (upscale)</h2><p class="xs muted" style="margin:2px 0 0">Beberapa akun berbayar dipakai bergantian. Kalau satu akun kuota bulanannya habis, otomatis pindah ke akun berikutnya. Key disimpan di server, tidak pernah dikirim ke browser.</p></div><span class="badge" id="bjStatus">Memuat…</span></div>
        <div id="bjSummary"></div>
        <div id="bjList"><div class="empty">Memuat…</div></div>
        <form id="bjForm" class="row" style="align-items:flex-end;flex-wrap:wrap">
          <div class="field" style="width:160px"><label for="bjLabel">Nama akun</label><input id="bjLabel" placeholder="Akun 2" maxlength="60"></div>
          <div class="field grow" style="min-width:220px"><label for="bjKey">API key BigJPG</label><input id="bjKey" type="password" autocomplete="new-password" placeholder="Tempel API key"></div>
          <div class="field" style="width:130px"><label for="bjQuota">Kuota / bulan</label><input id="bjQuota" type="number" min="1" step="1" value="2000"></div>
          <button class="btn btn-primary btn-lg" id="bjSave" type="submit">Tambah akun</button>
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

  async function bjLoad() {
    const b = $('bjStatus'), list = $('bjList');
    let r;
    try { r = await invoke('bigjpg-upscale', { action: 'list_keys' }); }
    catch (e) {
      b.textContent = 'Belum terhubung'; b.className = 'badge b-danger';
      list.innerHTML = notice(esc(e.message) + ' Pastikan Edge Function bigjpg-upscale versi terbaru sudah dipasang.', 'warn'); return;
    }
    const usable = r.keys.filter((k) => k.active && !k.exhausted).length;
    b.textContent = usable ? `${usable} akun aktif` : r.keys.length ? 'Kuota habis' : 'Belum diatur';
    b.className = 'badge ' + (usable ? 'b-success' : r.keys.length ? 'b-danger' : 'b-warning');
    const pct = r.total_quota ? Math.round((r.total_used / r.total_quota) * 100) : 0;
    $('bjSummary').innerHTML = r.keys.length ? `<div class="progress ${pct >= 90 ? 'bad' : pct >= 80 ? 'warn' : 'ok'}"><div class="head"><span>Kuota bulan ini (${esc(r.month)})</span><b class="num">${num(r.total_used)} / ${num(r.total_quota)}</b></div><div class="bar"><i style="width:${Math.min(100, pct)}%"></i></div><small>Sisa ${num(r.remaining)} upscale bulan ini${pct >= 80 ? ' · kuota hampir habis, pertimbangkan menambah akun' : ''}</small></div>` : '';
    if (!r.keys.length) { list.innerHTML = '<div class="empty">Belum ada akun BigJPG. Tambahkan API key di bawah.</div>'; return; }
    list.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Akun</th><th>API key</th><th>Pemakaian bulan ini</th><th>Status</th><th></th></tr></thead><tbody>
      ${r.keys.map((k) => {
        const p = Math.min(100, Math.round((k.used / k.monthly_quota) * 100));
        const st = !k.active ? ['Nonaktif', ''] : k.exhausted ? ['Kuota habis', 'b-danger'] : ['Aktif', 'b-success'];
        return `<tr><td><b>${esc(k.label)}</b></td><td class="mono xs">${esc(k.masked)}</td>
          <td><div class="progress ${p >= 90 ? 'bad' : p >= 80 ? 'warn' : 'ok'}" style="min-width:140px"><div class="head"><span class="num">${num(k.used)} / ${num(k.monthly_quota)}</span></div><div class="bar"><i style="width:${p}%"></i></div></div></td>
          <td><span class="badge ${st[1]}">${st[0]}</span></td>
          <td>${k.editable ? `<div class="row">
            <button class="btn btn-secondary" data-kq="${esc(k.id)}" data-q="${k.monthly_quota}">Kuota</button>
            ${k.exhausted && k.active ? `<button class="btn btn-secondary" data-kr="${esc(k.id)}" title="Pakai lagi kalau kuota BigJPG sudah diperbarui">Aktifkan lagi</button>` : ''}
            <button class="btn btn-secondary" data-ka="${esc(k.id)}" data-on="${k.active ? '0' : '1'}">${k.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
            <button class="ibtn" data-kd="${esc(k.id)}" data-l="${esc(k.label)}" aria-label="Hapus ${esc(k.label)}">${icon('trash')}</button></div>` : '<span class="xs subtle">dari pengaturan server</span>'}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    const act = async (body, ok) => { try { const x = await invoke('bigjpg-upscale', body); toast(x.message || ok); bjLoad(); } catch (e) { toast(e.message, 'error'); } };
    list.querySelectorAll('[data-ka]').forEach((x) => (x.onclick = () => act({ action: 'update_key', id: x.dataset.ka, active: x.dataset.on === '1' }, 'Akun diperbarui.')));
    list.querySelectorAll('[data-kr]').forEach((x) => (x.onclick = () => act({ action: 'update_key', id: x.dataset.kr, reset_exhausted: true }, 'Akun dipakai lagi.')));
    list.querySelectorAll('[data-kq]').forEach((x) => (x.onclick = () => {
      openModal(`<h3>Kuota per bulan</h3><div class="field"><label for="kqVal">Jumlah gambar per bulan sesuai paket BigJPG</label><input id="kqVal" type="number" min="1" value="${esc(x.dataset.q)}" autofocus></div><div class="modal-actions"><button class="btn btn-quiet" data-close>Batal</button><button class="btn btn-primary" id="kqOk">Simpan</button></div>`);
      $('kqOk').onclick = () => { closeModal(); act({ action: 'update_key', id: x.dataset.kq, monthly_quota: Number($('kqVal').value) }, 'Kuota diperbarui.'); };
    }));
    list.querySelectorAll('[data-kd]').forEach((x) => (x.onclick = async () => {
      if (!(await confirmBox({ title: 'Hapus akun BigJPG?', body: `${esc(x.dataset.l)} tidak dipakai lagi untuk upscale. Riwayat tetap tersimpan.`, okLabel: 'Hapus', danger: true }))) return;
      act({ action: 'remove_key', id: x.dataset.kd }, 'Akun dihapus.');
    }));
  }
  $('bjForm').onsubmit = async (e) => {
    e.preventDefault();
    const key = $('bjKey').value.trim(), btn = $('bjSave');
    if (!key) { $('bjNotice').innerHTML = notice('API key BigJPG wajib diisi.', 'error'); return; }
    btn.disabled = true; btn.textContent = 'Menyimpan…';
    try {
      const r = await invoke('bigjpg-upscale', { action: 'add_key', api_key: key, label: $('bjLabel').value.trim(), monthly_quota: Number($('bjQuota').value || 2000) });
      $('bjKey').value = ''; $('bjLabel').value = ''; $('bjNotice').innerHTML = notice(esc(r.message), 'ok'); await bjLoad();
    } catch (err) { $('bjNotice').innerHTML = notice(esc(err.message), 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Tambah akun'; }
  };
  bjLoad();

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
