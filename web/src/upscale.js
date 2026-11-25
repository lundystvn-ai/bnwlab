// Upscale through BigJPG (edge function bigjpg-upscale). Same flow as before:
// history row → upload to bigjpg-inputs → start → poll every 5 s (max 30 min) → result link.
import { db, invoke } from './supa.js';
import { $, esc, icon, notice, uuid, fmtDate, num } from './util.js';
import { state, isAdmin, regionId, regionTz, regionName } from './session.js';

const BUCKET = 'bigjpg-inputs';
const FN = 'bigjpg-upscale';
const MAX_POLLS = 360;
const NOISE = [['-1', 'Tidak ada'], ['0', 'Rendah'], ['1', 'Sedang'], ['2', 'Tinggi'], ['3', 'Tertinggi']];

export function mount(host) {
  let costs = { 2: 2, 4: 3, 8: 5, 16: 8 };
  let pollTimer = null, alive = true, file = null, metricsGen = 0;
  host.innerHTML = `
  <div class="page"><div class="page-in">
    <div class="page-head"><div><h1>Upscale gambar</h1><p>Perbesar gambar kecil lewat BigJPG. Gambar diunggah ke server untuk diproses; kredit dikembalikan otomatis kalau gagal.</p></div></div>
    <div class="two">
      <form class="card stack" id="upForm" novalidate>
        <label class="dropzone" id="upDrop" style="width:100%;padding:24px" tabindex="0">
          <input type="file" id="upFile" accept="image/png,image/jpeg,image/webp" hidden>
          <span class="big">${icon('upload')}</span><strong id="upFileName">Pilih gambar</strong>
          <span class="xs subtle" id="upFileMeta">PNG, JPG, atau WebP · maksimal 50 MB</span>
        </label>
        <div class="field"><label>Perbesar</label><div class="seg" role="radiogroup" aria-label="Skala" id="upScale" style="height:32px">
          ${[2, 4, 8, 16].map((s) => `<button type="button" role="radio" aria-checked="${s === 4}" data-v="${s}" style="height:28px">${s}× <span class="subtle" data-cost="${s}"></span></button>`).join('')}
        </div><span class="xs subtle">8× dan 16× membutuhkan akun BigJPG VIP.</span></div>
        <div class="field"><label>Jenis gambar</label><div class="seg" role="radiogroup" aria-label="Jenis gambar" id="upStyle" style="height:32px">
          <button type="button" role="radio" aria-checked="true" data-v="art" style="height:28px">Ilustrasi / artwork</button><button type="button" role="radio" aria-checked="false" data-v="photo" style="height:28px">Foto</button>
        </div></div>
        <div class="field"><label for="upNoise">Kurangi noise</label><select id="upNoise">${NOISE.map(([v, l]) => `<option value="${v}"${v === '0' ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <div id="upNotice" aria-live="polite"></div>
        <div id="upProgress" hidden></div>
        <button class="btn btn-primary btn-lg" type="submit" id="upSubmit">${icon('expand', 'i i-sm')}Upscale <span class="cost" id="upCost">· 3 kredit</span></button>
      </form>
      <div class="card" id="upResult"><div class="empty">${icon('expand')}<br>Hasil upscale akan tampil di sini.</div></div>
    </div>

    <section style="margin-top:24px">
      <div class="toolbar"><h2>Riwayat upscale</h2><button class="btn btn-secondary" id="upRefresh">${icon('refresh', 'i i-sm')}Muat ulang</button></div>
      ${isAdmin() ? '<div id="upMetrics" class="metrics"></div><p class="xs subtle" id="upMetricsMeta"></p>' : ''}
      <div id="upList"><div class="empty">Memuat…</div></div>
    </section>
  </div></div>`;

  const say = (m, t = 'ok') => ($('upNotice').innerHTML = m ? notice(m, t) : '');
  const sel = (g) => g.querySelector('[aria-checked=true]')?.dataset.v;
  ['upScale', 'upStyle'].forEach((id) => $(id).addEventListener('click', (e) => {
    const b = e.target.closest('[role=radio]'); if (!b) return;
    $(id).querySelectorAll('[role=radio]').forEach((x) => x.setAttribute('aria-checked', String(x === b))); updateCost();
  }));
  const updateCost = () => {
    const s = Number(sel($('upScale')) || 4);
    $('upCost').textContent = `· ${costs[s] ?? '?'} kredit`;
    document.querySelectorAll('[data-cost]').forEach((el) => (el.textContent = `· ${costs[el.dataset.cost] ?? '?'}`));
  };
  invoke(FN, { action: 'costs' }).then((r) => { if (r?.costs) { costs = r.costs; updateCost(); } }).catch(() => {});
  updateCost();

  // file picking
  const drop = $('upDrop'), input = $('upFile');
  const pick = (f) => {
    if (!f) return;
    file = f;
    $('upFileName').textContent = f.name;
    $('upFileMeta').textContent = `${(f.size / 1048576).toFixed(1).replace('.', ',')} MB · klik untuk ganti`;
  };
  input.onchange = () => pick(input.files?.[0]);
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer?.files?.[0]); });

  // progress rendering
  function pct(row, status, polls) {
    const p = [row?.progress, row?.percentage, row?.percent, row?.progress_percent].map(Number).find((v) => Number.isFinite(v));
    if (Number.isFinite(p)) return Math.min(99, Math.max(0, Math.round(p >= 0 && p <= 1 ? p * 100 : p)));
    if (status === 'completed') return 100;
    if (status === 'failed') return 0;
    if (status === 'timeout') return 99;
    if (status === 'uploading') return 5;
    if (status === 'pending') return 3;
    return Math.min(95, Math.max(8, Math.round(8 + (Math.min(359, Math.max(0, polls)) / 359) * 87)));
  }
  const LABEL = { uploading: 'Mengunggah gambar', pending: 'Menunggu antrean', queued: 'Menunggu antrean', processing: 'Memproses gambar', running: 'Memproses gambar', completed: 'Selesai', failed: 'Gagal', timeout: 'Belum selesai' };
  function progressHtml(row, polls = 0, note = '') {
    const st = String(row?.status || 'processing').toLowerCase(), p = pct(row, st, polls);
    const cls = st === 'completed' ? 'ok' : st === 'failed' ? 'bad' : st === 'timeout' ? 'warn' : '';
    const def = st === 'completed' ? 'Hasil siap dibuka atau diunduh.' : st === 'failed' ? 'Lihat pesan error di riwayat.' : st === 'timeout' ? 'Tekan Cek lagi untuk melanjutkan.' : 'Status dicek setiap 5 detik.';
    return `<div class="progress ${cls}"><div class="head"><span>${LABEL[st] || 'Memproses gambar'}</span><b class="num">${p}%</b></div><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><i style="width:${p}%"></i></div><small>${esc(note || def)}</small></div>`;
  }
  const live = (id, status, polls, note) => { const el = $('upProgress'); if (!el || el.dataset.id !== String(id)) return; el.hidden = false; el.innerHTML = progressHtml({ status }, polls, note); };
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');
  function showResult(url) {
    const u = safeUrl(url); if (!u) return;
    $('upResult').innerHTML = `<div class="stack"><img class="result-img" src="${esc(u)}" alt="Hasil upscale"><div class="row"><a class="btn btn-primary btn-lg" href="${esc(u)}" target="_blank" rel="noopener">${icon('download', 'i i-sm')}Buka / unduh hasil</a></div><p class="xs subtle">Link hasil dari BigJPG berlaku terbatas. Simpan file segera.</p></div>`;
  }

  // submit
  $('upForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!file) { say('Pilih gambar terlebih dahulu.', 'error'); return; }
    if (!String(file.type || '').startsWith('image/')) { say('File harus berupa gambar.', 'error'); return; }
    if (file.size > 52428800) { say('Ukuran gambar maksimal 50 MB.', 'error'); return; }
    const scale = Number(sel($('upScale')) || 4), style = sel($('upStyle')) || 'art', noise = Number($('upNoise').value || 0);
    const btn = $('upSubmit'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Mengunggah…';
    say('Menyiapkan gambar…', 'warn');
    const prog = $('upProgress'); prog.hidden = true; prog.dataset.id = ''; prog.innerHTML = '';
    let id = null, path = '';
    try {
      const ins = await db.from('riwayat_bigjpg').insert({
        file_name: file.name, scale, style, noise, status: 'uploading', user_id: state.user.id, username: state.profile.username,
        wilayah_id: regionId(), started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).select('id').single();
      if (ins.error) throw new Error(ins.error.message);
      id = ins.data.id; prog.dataset.id = String(id);
      live(id, 'uploading', 0, 'Menyiapkan file untuk BigJPG…');
      const safe = String(file.name || 'gambar').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-100) || 'gambar';
      path = `${state.user.id}/${uuid()}-${safe}`;
      const up = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false });
      if (up.error) throw new Error('Gambar gagal diunggah: ' + up.error.message);
      btn.innerHTML = '<span class="spin"></span>Memproses di BigJPG…';
      const r = await invoke(FN, { action: 'start', storage_path: path, file_name: file.name, file_type: file.type, scale, style, noise, history_id: id });
      if (!r.task_id) throw new Error('BigJPG tidak mengembalikan task ID.');
      const u = await db.from('riwayat_bigjpg').update({ task_id: String(r.task_id), status: 'processing', updated_at: new Date().toISOString(), error_message: null }).eq('id', id);
      if (u.error) throw u.error;
      live(id, 'processing', 0, 'BigJPG menerima gambar.');
      say('Gambar sedang diproses BigJPG. Hasil muncul otomatis di sini.', 'warn');
      clearTimeout(pollTimer); loadList(); poll(id, String(r.task_id), 0);
    } catch (err) {
      if (id) await db.from('riwayat_bigjpg').update({ status: 'failed', error_message: err.message, updated_at: new Date().toISOString() }).eq('id', id);
      if (path) await db.storage.from(BUCKET).remove([path]).catch(() => {});
      if (id) live(id, 'failed', 0, err.message || 'Upscale gagal.');
      say(esc(err.message || 'Upscale gagal.'), 'error'); loadList();
    } finally {
      btn.disabled = false; btn.innerHTML = `${icon('expand', 'i i-sm')}Upscale <span class="cost" id="upCost"></span>`; updateCost();
    }
  };

  async function poll(id, task, n = 0) {
    if (!alive) return;
    if (n >= MAX_POLLS) {
      await db.from('riwayat_bigjpg').update({ status: 'timeout', error_message: 'Belum selesai setelah 30 menit. Gunakan tombol Cek lagi dari riwayat.', updated_at: new Date().toISOString() }).eq('id', id);
      live(id, 'timeout', n, 'Belum selesai setelah 30 menit.'); say('BigJPG belum selesai setelah 30 menit. Gunakan Cek lagi dari riwayat.', 'warn'); loadList();
      return;
    }
    try {
      live(id, 'processing', n, 'Mengecek status BigJPG…');
      const r = await invoke(FN, { action: 'status', task_id: task, history_id: id });
      const st = String(r.status || 'processing').toLowerCase(), url = safeUrl(r.result_url);
      if (st === 'completed' && url) {
        const u = await db.from('riwayat_bigjpg').update({ status: 'completed', result_url: url, error_message: null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id);
        if (u.error) throw u.error;
        live(id, 'completed', n, 'Upscale selesai.'); say('Upscale selesai. Hasil siap dibuka atau diunduh.'); showResult(url); loadList();
        return;
      }
      if (st === 'failed') {
        const m = r.error_message || 'BigJPG gagal memproses gambar.';
        await db.from('riwayat_bigjpg').update({ status: 'failed', error_message: m, updated_at: new Date().toISOString() }).eq('id', id);
        live(id, 'failed', n, m); say(esc(m), 'error'); loadList();
        return;
      }
      live(id, st, n, 'Pengecekan berikutnya dalam 5 detik…');
      pollTimer = setTimeout(() => poll(id, task, n + 1), 5000);
    } catch (err) {
      await db.from('riwayat_bigjpg').update({ status: 'failed', error_message: err.message, updated_at: new Date().toISOString() }).eq('id', id);
      live(id, 'failed', n, err.message || 'Upscale gagal.'); say(esc(err.message), 'error'); loadList();
    }
  }

  // history + admin recap
  const badge = (s) => {
    const v = String(s || 'pending');
    const cls = v === 'completed' ? 'b-success' : v === 'failed' || v === 'cancelled' ? 'b-danger' : 'b-warning';
    return `<span class="badge ${cls}">${esc(LABEL[v] || v)}</span>`;
  };
  async function loadMetrics() {
    if (!isAdmin()) return;
    const box = $('upMetrics'); if (!box) return;
    const gen = ++metricsGen;
    const count = (st) => { let q = db.from('riwayat_bigjpg').select('id', { count: 'exact', head: true }); return st ? q.eq('status', st) : q; };
    const [all, ok, bad] = await Promise.all([count(), count('completed'), count('failed')]);
    if (gen !== metricsGen || !$('upMetrics')) return;
    const err = all.error || ok.error || bad.error;
    if (err) { box.innerHTML = notice(esc(err.message), 'error'); return; }
    const t = all.count || 0, c = ok.count || 0, f = bad.count || 0, p = Math.max(0, t - c - f);
    box.innerHTML = `<div class="metric"><div class="label">Total foto</div><div class="value">${num(t)}</div></div>
      <div class="metric success"><div class="label">Berhasil</div><div class="value">${num(c)}</div></div>
      <div class="metric failed"><div class="label">Gagal</div><div class="value">${num(f)}</div></div>
      <div class="metric pending"><div class="label">Belum selesai</div><div class="value">${num(p)}</div></div>`;
    $('upMetricsMeta').textContent = `Tingkat berhasil ${t ? Math.round((c / t) * 100) : 0}% · diperbarui ${fmtDate(new Date(), regionTz())}`;
  }
  async function loadList() {
    if (!alive) return;
    loadMetrics();
    const box = $('upList'); if (!box) return;
    let q = db.from('riwayat_bigjpg').select('*').order('created_at', { ascending: false }).limit(isAdmin() ? 500 : 100);
    if (!isAdmin()) q = q.eq('wilayah_id', regionId());
    const { data, error } = await q;
    if (error) { box.innerHTML = notice(esc(error.message), 'error'); return; }
    if (!data?.length) { box.innerHTML = '<div class="empty">Belum ada riwayat upscale.</div>'; return; }
    box.innerHTML = `<div class="table-wrap"><table><thead><tr>${isAdmin() ? '<th>Wilayah</th>' : ''}<th>File</th><th>Pengguna</th><th>Skala</th><th>Jenis</th><th>Status</th><th>Proses</th><th>Hasil</th><th>Waktu</th></tr></thead><tbody>
      ${data.map((r) => {
        const st = String(r.status || '').toLowerCase();
        const recheck = r.task_id && (st === 'processing' || st === 'timeout') ? `<button class="btn btn-secondary" data-recheck="${esc(r.id)}" data-task="${esc(r.task_id)}">Cek lagi</button>` : '';
        const link = safeUrl(r.result_url) ? `<a class="btn btn-secondary" href="${esc(safeUrl(r.result_url))}" target="_blank" rel="noopener">${icon('link', 'i i-sm')}Buka</a>` : '';
        return `<tr>${isAdmin() ? `<td>${esc(regionName(r.wilayah_id))}</td>` : ''}<td>${esc(r.file_name || '-')}</td><td>${esc(r.username || '-')}</td><td class="num">${esc(r.scale || '-')}×</td><td>${r.style === 'photo' ? 'Foto' : 'Artwork'}</td><td>${badge(st)}${r.error_message && st !== 'completed' ? `<div class="xs subtle" style="max-width:220px">${esc(r.error_message)}</div>` : ''}</td><td>${progressHtml(r, 0)}</td><td><div class="row">${link}${recheck}${!link && !recheck ? '-' : ''}</div></td><td class="xs">${esc(fmtDate(r.created_at, regionTz()))}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    box.querySelectorAll('[data-recheck]').forEach((b) => (b.onclick = async () => {
      b.disabled = true; b.textContent = 'Mengecek…'; clearTimeout(pollTimer);
      $('upProgress').dataset.id = b.dataset.recheck;
      await poll(b.dataset.recheck, b.dataset.task, 0);
    }));
  }
  $('upRefresh').onclick = loadList;
  loadList();

  return () => { alive = false; clearTimeout(pollTimer); };
}
