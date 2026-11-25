// Knockout & Raster download history. Users see their own, supervisors their region, admin all
// (admin can delete one row or everything after typing HAPUS).
import { db } from './supa.js';
import { $, esc, icon, notice, fmtDate, num, confirmBox, toast } from './util.js';
import { state, isAdmin, isManager, regionId, regionTz, regionName } from './session.js';
import { OPERATION_LABELS } from './engine.js';

export function mount(host) {
  let alive = true, busy = false;
  host.innerHTML = `
  <div class="page"><div class="page-in">
    <div class="page-head"><div><h1>Riwayat Knockout &amp; Raster</h1><p>Tercatat otomatis saat PNG diunduh. Gambar asli dan hasil tidak disimpan.</p></div>
      <div class="row"><button class="btn btn-secondary" id="hRefresh">${icon('refresh', 'i i-sm')}Muat ulang</button>${isAdmin() ? `<button class="btn btn-danger" id="hDelAll">${icon('trash', 'i i-sm')}Hapus semua</button>` : ''}</div></div>
    <div id="hNotice" aria-live="polite"></div>
    <div id="hList"><div class="empty">Memuat…</div></div>
    <p class="xs subtle" style="margin-top:10px">Riwayat upscale ada di halaman <a href="#upscale">Upscale</a>.</p>
  </div></div>`;
  const say = (m, t = 'ok') => ($('hNotice').innerHTML = m ? notice(m, t) : '');
  const lock = (on) => { busy = on; host.querySelectorAll('button').forEach((b) => (b.disabled = on)); };

  async function load() {
    const box = $('hList'); if (!box) return;
    box.innerHTML = '<div class="empty">Memuat…</div>';
    let q = db.from('halftone_image_history').select('id,user_id,username,wilayah_id,file_name,operation,image_width,image_height,garment_color,created_at').order('created_at', { ascending: false }).limit(100);
    if (!isAdmin()) q = isManager() ? q.eq('wilayah_id', regionId()) : q.eq('user_id', state.user.id);
    const { data, error } = await q;
    if (!alive) return;
    if (error) { box.innerHTML = notice(esc(error.message), 'error'); return; }
    if (!data?.length) { box.innerHTML = '<div class="empty">Belum ada riwayat unduhan. <a href="#editor">Buka editor</a></div>'; return; }
    box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>File</th><th>Pengguna</th><th>Wilayah</th><th>Hasil</th><th class="num">Ukuran</th><th>Pratinjau</th><th>Waktu</th>${isAdmin() ? '<th></th>' : ''}</tr></thead><tbody>
      ${data.map((r) => `<tr><td>${esc(r.file_name || '-')}</td><td>${esc(r.username || '-')}</td><td>${esc(regionName(r.wilayah_id))}</td><td>${esc(OPERATION_LABELS[r.operation] || r.operation || '-')}</td>
        <td class="num">${num(r.image_width)} × ${num(r.image_height)} px</td><td>${r.garment_color === 'black' ? 'Kaos hitam' : 'Kaos putih'}</td><td class="xs">${esc(fmtDate(r.created_at, regionTz()))}</td>
        ${isAdmin() ? `<td><button class="ibtn" data-del="${esc(r.id)}" aria-label="Hapus riwayat ${esc(r.file_name || '')}">${icon('trash')}</button></td>` : ''}</tr>`).join('')}
      </tbody></table></div>`;
    box.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      const row = data.find((x) => String(x.id) === b.dataset.del); if (!row || busy) return;
      if (!(await confirmBox({ title: 'Hapus riwayat?', body: `Riwayat <b>${esc(row.file_name || 'file ini')}</b> akan dihapus permanen.`, okLabel: 'Hapus', danger: true }))) return;
      lock(true);
      const { error: e } = await db.from('halftone_image_history').delete().eq('id', row.id);
      lock(false);
      if (e) say('Riwayat gagal dihapus: ' + esc(e.message), 'error'); else { toast('Riwayat dihapus.'); load(); }
    }));
  }
  $('hRefresh').onclick = load;
  $('hDelAll')?.addEventListener('click', async () => {
    if (busy) return;
    if (!(await confirmBox({ title: 'Hapus seluruh riwayat?', body: 'Semua riwayat Knockout &amp; Raster dari semua pengguna akan dihapus permanen.', okLabel: 'Hapus semua', danger: true, typeToConfirm: 'HAPUS' }))) return;
    lock(true);
    const { error } = await db.from('halftone_image_history').delete().not('id', 'is', null);
    lock(false);
    if (error) say('Seluruh riwayat gagal dihapus: ' + esc(error.message), 'error'); else { toast('Seluruh riwayat dihapus.'); load(); }
  });
  load();
  return () => { alive = false; };
}
