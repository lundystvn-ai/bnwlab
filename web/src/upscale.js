// Upscale through BigJPG (edge function bigjpg-upscale). Same flow as before:
// history row → upload to bigjpg-inputs → start → poll every 5 s (max 30 min) → result link.
import { db, invoke } from './supa.js';
import { $, esc, icon, notice, uuid, fmtDate, num } from './util.js';
import { state, isAdmin, regionId, regionTz, regionName, refreshCredits, authDialog } from './session.js';
import { L, tr } from './i18n.js';
import { takeHandoff } from './handoff.js';

const BUCKET = 'bigjpg-inputs';
const FN = 'bigjpg-upscale';
const MAX_POLLS = 360;
const NOISE = [['-1', L('Tidak ada', 'None')], ['0', L('Rendah', 'Low')], ['1', L('Sedang', 'Medium')], ['2', L('Tinggi', 'High')], ['3', L('Tertinggi', 'Highest')]];

// Set while the page is open: refreshes the account parts after a guest signs in (see main.js).
let signInHook = null;
export function onSignIn() { if (!signInHook) return false; signInHook(); return true; }

export function mount(host) {
  let costs = { 2: 1, 4: 1, 8: 1, 16: 1 };
  let pollTimer = null, alive = true, file = null, metricsGen = 0;
  host.innerHTML = `
  <div class="page"><div class="page-in">
    <div class="page-head"><div><h1>${L('Upscale gambar', 'Upscale images')}</h1><p>${L('Perbesar gambar kecil, 1 kredit per gambar. Gambar diunggah ke server untuk diproses; kredit dikembalikan otomatis kalau gagal.', 'Enlarge small images for 1 credit each. Images are uploaded to our server for processing; credits are refunded automatically if it fails.')}</p></div></div>
    <div class="two">
      <form class="card stack" id="upForm" novalidate>
        <label class="dropzone" id="upDrop" style="width:100%;padding:24px" tabindex="0">
          <input type="file" id="upFile" accept="image/png,image/jpeg,image/webp" hidden>
          <span class="big">${icon('upload')}</span><strong id="upFileName">${L('Pilih gambar', 'Choose image')}</strong>
          <span class="xs subtle" id="upFileMeta">${L('PNG, JPG, atau WebP · maksimal 50 MB', 'PNG, JPG or WebP · up to 50 MB')}</span>
        </label>
        <div class="field"><label>${L('Perbesar', 'Enlarge')}</label><div class="seg" role="radiogroup" aria-label="${L('Skala', 'Scale')}" id="upScale" style="height:32px">
          ${[2, 4, 8, 16].map((s) => `<button type="button" role="radio" aria-checked="${s === 4}" data-v="${s}" style="height:28px">${s}× <span class="subtle" data-cost="${s}"></span></button>`).join('')}
        </div><span class="xs subtle">${L('8× dan 16× butuh waktu proses lebih lama.', '8× and 16× take longer to process.')}</span></div>
        <div class="field"><label>${L('Jenis gambar', 'Image type')}</label><div class="seg" role="radiogroup" aria-label="${L('Jenis gambar', 'Image type')}" id="upStyle" style="height:32px">
          <button type="button" role="radio" aria-checked="true" data-v="art" style="height:28px">${L('Ilustrasi / artwork', 'Illustration / artwork')}</button><button type="button" role="radio" aria-checked="false" data-v="photo" style="height:28px">${L('Foto', 'Photo')}</button>
        </div></div>
        <div class="field"><label for="upNoise">${L('Kurangi noise', 'Noise reduction')}</label><select id="upNoise">${NOISE.map(([v, l]) => `<option value="${v}"${v === '0' ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <div id="upNotice" aria-live="polite"></div>
        <div id="upProgress" hidden></div>
        <button class="btn btn-primary btn-lg" type="submit" id="upSubmit">${icon('expand', 'i i-sm')}Upscale <span class="cost" id="upCost">· ${L('1 kredit', '1 credit')}</span></button>
      </form>
      <div class="card" id="upResult"><div class="empty">${icon('expand')}<br>${L('Hasil upscale akan tampil di sini.', 'Your upscaled image will appear here.')}</div></div>
    </div>

    <section style="margin-top:24px">
      <div class="toolbar"><h2>${L('Riwayat upscale', 'Upscale history')}</h2><button class="btn btn-secondary" id="upRefresh">${icon('refresh', 'i i-sm')}${L('Muat ulang', 'Reload')}</button></div>
      ${isAdmin() ? '<div id="upMetrics" class="metrics"></div><p class="xs subtle" id="upMetricsMeta"></p>' : ''}
      <div id="upList"><div class="empty">${L('Memuat…', 'Loading…')}</div></div>
    </section>
  </div></div>`;

  const say = (m, t = 'ok') => { const el = $('upNotice'); if (el) el.innerHTML = m ? notice(m, t) : ''; };
  const sel = (g) => g.querySelector('[aria-checked=true]')?.dataset.v;
  ['upScale', 'upStyle'].forEach((id) => $(id).addEventListener('click', (e) => {
    const b = e.target.closest('[role=radio]'); if (!b) return;
    $(id).querySelectorAll('[role=radio]').forEach((x) => x.setAttribute('aria-checked', String(x === b))); updateCost();
  }));
  const updateCost = () => {
    const s = Number(sel($('upScale')) || 4);
    $('upCost').textContent = `· ${costs[s] ?? '?'} ${L('kredit', costs[s] === 1 ? 'credit' : 'credits')}`;
    document.querySelectorAll('[data-cost]').forEach((el) => (el.textContent = `· ${costs[el.dataset.cost] ?? '?'}`));
  };
  if (state.user) invoke(FN, { action: 'costs' }).then((r) => { if (r?.costs) { costs = r.costs; updateCost(); } }).catch(() => {});
  updateCost();

  // file picking
  const drop = $('upDrop'), input = $('upFile');
  const pick = (f) => {
    if (!f) return;
    file = f;
    $('upFileName').textContent = f.name;
    $('upFileMeta').textContent = `${(f.size / 1048576).toFixed(1).replace('.', L(',', '.'))} MB · ${L('klik untuk ganti', 'click to change')}`;
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
  const LABEL = { uploading: L('Mengunggah gambar', 'Uploading image'), starting: L('Memulai upscale', 'Starting upscale'), pending: L('Menunggu antrean', 'Waiting in queue'), queued: L('Menunggu antrean', 'Waiting in queue'), processing: L('Memproses gambar', 'Processing image'), running: L('Memproses gambar', 'Processing image'), completed: L('Selesai', 'Done'), failed: L('Gagal', 'Failed'), timeout: L('Belum selesai', 'Not finished') };
  function progressHtml(row, polls = 0, note = '') {
    const st = String(row?.status || 'processing').toLowerCase(), p = pct(row, st, polls);
    const cls = st === 'completed' ? 'ok' : st === 'failed' ? 'bad' : st === 'timeout' ? 'warn' : '';
    const def = st === 'completed' ? L('Hasil siap dibuka atau diunduh.', 'Your result is ready to open or download.') : st === 'failed' ? L('Lihat pesan error di riwayat.', 'See the error message in the history.') : st === 'timeout' ? L('Tekan Cek lagi untuk melanjutkan.', 'Press Check again to continue.') : L('Status dicek setiap 5 detik.', 'Status is checked every 5 seconds.');
    return `<div class="progress ${cls}"><div class="head"><span>${LABEL[st] || L('Memproses gambar', 'Processing image')}</span><b class="num">${p}%</b></div><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><i style="width:${p}%"></i></div><small>${esc(note || def)}</small></div>`;
  }
  const live = (id, status, polls, note) => { const el = $('upProgress'); if (!el || el.dataset.id !== String(id)) return; el.hidden = false; el.innerHTML = progressHtml({ status }, polls, note); };
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '');
  function showResult(url) {
    const u = safeUrl(url); if (!u) return;
    const box = $('upResult'); if (!box) return;
    box.innerHTML = `<div class="stack"><img class="result-img" src="${esc(u)}" alt="${L('Hasil upscale', 'Upscale result')}"><div class="row"><a class="btn btn-primary btn-lg" href="${esc(u)}" target="_blank" rel="noopener">${icon('download', 'i i-sm')}${L('Buka / unduh hasil', 'Open / download result')}</a></div><p class="xs subtle">${L('Link hasil berlaku terbatas. Simpan file segera.', 'The result link expires. Save the file soon.')}</p></div>`;
  }

  // submit
  $('upForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!file) { say(L('Pilih gambar terlebih dahulu.', 'Choose an image first.'), 'error'); return; }
    if (!state.user) {
      say(L('Masuk atau daftar dulu untuk mulai upscale. Gambar dan pengaturanmu tetap di sini. Akun baru dapat 5 kredit gratis.', 'Sign in or sign up to start the upscale. Your image and settings stay here. New accounts get 5 free credits.'), 'warn');
      authDialog('daftar', '', () => $('upForm')?.requestSubmit());
      return;
    }
    if (!String(file.type || '').startsWith('image/')) { say(L('File harus berupa gambar.', 'The file must be an image.'), 'error'); return; }
    if (file.size > 52428800) { say(L('Ukuran gambar maksimal 50 MB.', 'Images can be up to 50 MB.'), 'error'); return; }
    const scale = Number(sel($('upScale')) || 4), style = sel($('upStyle')) || 'art', noise = Number($('upNoise').value || 0);
    const btn = $('upSubmit'); btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${L('Mengunggah…', 'Uploading…')}`;
    say(L('Menyiapkan gambar…', 'Preparing image…'), 'warn');
    const prog = $('upProgress'); prog.hidden = true; prog.dataset.id = ''; prog.innerHTML = '';
    let id = null, path = '', started = false;
    try {
      const ins = await db.from('riwayat_bigjpg').insert({
        file_name: file.name, scale, style, noise, status: 'uploading', user_id: state.user.id, username: state.profile.username,
        wilayah_id: regionId(), started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).select('id').single();
      if (ins.error) throw new Error(ins.error.message);
      id = ins.data.id; prog.dataset.id = String(id);
      live(id, 'uploading', 0, L('Menyiapkan file…', 'Preparing file…'));
      const safe = String(file.name || 'gambar').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-100) || 'gambar';
      path = `${state.user.id}/${uuid()}-${safe}`;
      const up = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false });
      if (up.error) throw new Error(L('Gambar gagal diunggah: ', 'Upload failed: ') + up.error.message);
      btn.innerHTML = `<span class="spin"></span>${L('Memproses…', 'Processing…')}`;
      const r = await invoke(FN, { action: 'start', storage_path: path, file_name: file.name, file_type: file.type, scale, style, noise, history_id: id });
      started = !!r.task_id;
      if (!r.task_id) throw new Error(L('Server tidak mengembalikan ID proses.', 'The server returned no job ID.'));
      // the server already saved the task id and status; nothing else to write here
      live(id, 'processing', 0, L('Gambar diterima server.', 'Image received by the server.'));
      say(L('Gambar sedang diproses. Hasil muncul otomatis di sini.', 'Your image is being processed. The result appears here automatically.'), 'warn');
      clearTimeout(pollTimer); loadList(); poll(id, String(r.task_id), 0);
    } catch (err) {
      if (started) {
        // The job is already running on the server: a problem on this page must not mark it failed.
        console.error('upscale page', err);
        if (alive) { clearTimeout(pollTimer); poll(id, '', 0); }
      } else {
        // Not started: no credit was charged (or the server refunded it). Mark only our own draft row.
        if (id) await db.rpc('mark_upscale', { p_id: id, p_status: 'failed', p_msg: err.message });
        if (path) await db.storage.from(BUCKET).remove([path]).catch(() => {});
        if (id) live(id, 'failed', 0, tr(err.message) || L('Upscale gagal.', 'Upscale failed.'));
        say(esc(tr(err.message) || L('Upscale gagal.', 'Upscale failed.')), 'error');
      }
      if (alive) loadList();
    } finally {
      if (btn.isConnected) { btn.disabled = false; btn.innerHTML = `${icon('expand', 'i i-sm')}Upscale <span class="cost" id="upCost"></span>`; updateCost(); }
    }
  };

  async function poll(id, task, n = 0) {
    if (!alive) return;
    if (n >= MAX_POLLS) {
      await db.rpc('mark_upscale', { p_id: id, p_status: 'timeout', p_msg: 'Belum selesai setelah 30 menit. Gunakan tombol Cek lagi dari riwayat.' });
      live(id, 'timeout', n, L('Belum selesai setelah 30 menit.', 'Not finished after 30 minutes.')); say(L('Proses belum selesai setelah 30 menit. Gunakan Cek lagi dari riwayat.', 'Not finished after 30 minutes. Use Check again in the history.'), 'warn'); loadList();
      return;
    }
    let r;
    try {
      live(id, 'processing', n, L('Mengecek status…', 'Checking status…'));
      r = await invoke(FN, { action: 'status', task_id: task, history_id: id });
    } catch (err) {
      // Network or server hiccup: try again later instead of calling the job failed.
      if (!alive) return;
      live(id, 'processing', n, L('Koneksi terputus, mencoba lagi…', 'Connection problem, trying again…'));
      pollTimer = setTimeout(() => poll(id, task, n + 1), 8000);
      return;
    }
    if (!alive) return;
    try {
      const st = String(r.status || 'processing').toLowerCase(), url = safeUrl(r.result_url);
      if (st === 'completed' && url) {
        live(id, 'completed', n, L('Upscale selesai.', 'Upscale done.')); say(L('Upscale selesai. Hasil siap dibuka atau diunduh.', 'Upscale done. Your result is ready to open or download.')); showResult(url); loadList();
        return;
      }
      if (st === 'failed') {
        // the server has already marked it failed and refunded the credits
        const m = tr(r.error_message) || L('Gambar gagal diproses.', 'The image could not be processed.');
        refreshCredits();
        live(id, 'failed', n, m); say(esc(m), 'error'); loadList();
        return;
      }
      live(id, st, n, L('Pengecekan berikutnya dalam 5 detik…', 'Next check in 5 seconds…'));
      pollTimer = setTimeout(() => poll(id, task, n + 1), 5000);
    } catch (err) {
      console.error('upscale page', err);
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
      <div class="metric failed"><div class="label">${L('Gagal', 'Failed')}</div><div class="value">${num(f)}</div></div>
      <div class="metric pending"><div class="label">${L('Belum selesai', 'Not finished')}</div><div class="value">${num(p)}</div></div>`;
    $('upMetricsMeta').textContent = `Tingkat berhasil ${t ? Math.round((c / t) * 100) : 0}% · diperbarui ${fmtDate(new Date(), regionTz())}`;
  }
  async function loadList() {
    if (!alive) return;
    loadMetrics();
    const box = $('upList'); if (!box) return;
    if (!state.user) { box.innerHTML = `<div class="empty">${L('Masuk untuk melihat riwayat upscale-mu.', 'Sign in to see your upscale history.')}</div>`; return; }
    let q = db.from('riwayat_bigjpg').select('*').order('created_at', { ascending: false }).limit(isAdmin() ? 500 : 100);
    if (!isAdmin()) q = q.eq('user_id', state.user.id);
    const { data, error } = await q;
    if (error) { box.innerHTML = notice(esc(error.message), 'error'); return; }
    if (!data?.length) { box.innerHTML = `<div class="empty">${L('Belum ada riwayat upscale.', 'No upscale history yet.')}</div>`; return; }
    box.innerHTML = `<div class="table-wrap"><table><thead><tr>${isAdmin() ? `<th>${L('Wilayah', 'Region')}</th>` : ''}<th>${L('File', 'File')}</th>${isAdmin() ? `<th>${L('Pengguna', 'User')}</th>` : ''}<th>${L('Skala', 'Scale')}</th><th>${L('Jenis', 'Type')}</th><th>${L('Status', 'Status')}</th><th>${L('Proses', 'Progress')}</th><th>${L('Hasil', 'Result')}</th><th>${L('Waktu', 'Time')}</th></tr></thead><tbody>
      ${data.map((r) => {
        const st = String(r.status || '').toLowerCase();
        const recent = Date.now() - new Date(r.created_at).getTime() < 3 * 864e5;
        const recheck = r.task_id && (st === 'processing' || st === 'timeout' || (st === 'failed' && recent)) ? `<button class="btn btn-secondary" data-recheck="${esc(r.id)}" data-task="${esc(r.task_id)}">${L('Cek lagi', 'Check again')}</button>` : '';
        const link = safeUrl(r.result_url) ? `<a class="btn btn-secondary" href="${esc(safeUrl(r.result_url))}" target="_blank" rel="noopener">${icon('link', 'i i-sm')}${L('Buka', 'Open')}</a>` : '';
        return `<tr>${isAdmin() ? `<td>${esc(regionName(r.wilayah_id))}</td>` : ''}<td>${esc(r.file_name || '-')}</td>${isAdmin() ? `<td>${esc(r.username || '-')}</td>` : ''}<td class="num">${esc(r.scale || '-')}×</td><td>${r.style === 'photo' ? L('Foto', 'Photo') : L('Artwork', 'Artwork')}</td><td>${badge(st)}${r.error_message && st !== 'completed' ? `<div class="xs subtle" style="max-width:220px">${esc(tr(r.error_message))}</div>` : ''}</td><td>${progressHtml(r, 0)}</td><td><div class="row">${link}${recheck}${!link && !recheck ? '-' : ''}</div></td><td class="xs">${esc(fmtDate(r.created_at, regionTz()))}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    box.querySelectorAll('[data-recheck]').forEach((b) => (b.onclick = async () => {
      b.disabled = true; b.textContent = L('Mengecek…', 'Checking…'); clearTimeout(pollTimer);
      const pr = $('upProgress'); if (pr) pr.dataset.id = b.dataset.recheck;
      await poll(b.dataset.recheck, b.dataset.task, 0);
    }));
  }
  $('upRefresh').onclick = loadList;
  loadList();
  // Coming back to this page: keep following the newest job that is still running.
  async function resume() {
    if (!state.user) return;
    const { data } = await db.from('riwayat_bigjpg').select('id,task_id,status,created_at').eq('user_id', state.user.id)
      .in('status', ['processing', 'uploading']).not('bigjpg_tid', 'is', null).gte('created_at', new Date(Date.now() - 864e5).toISOString())
      .order('created_at', { ascending: false }).limit(1);
    const row = data?.[0];
    if (!row || !alive) return;
    const pr = $('upProgress'); if (pr) pr.dataset.id = String(row.id);
    say(L('Upscale sebelumnya masih diproses. Hasil muncul otomatis di sini.', 'Your previous upscale is still processing. The result will appear here.'), 'warn');
    poll(row.id, String(row.task_id || ''), 0);
  }
  resume();
  const handed = takeHandoff(); if (handed) pick(handed);

  // A guest just signed in: show their history and costs without losing the chosen image.
  signInHook = () => {
    loadList(); resume();
    invoke(FN, { action: 'costs' }).then((r) => { if (r?.costs) { costs = r.costs; updateCost(); } }).catch(() => {});
  };
  return () => { signInHook = null; alive = false; clearTimeout(pollTimer); };
}
