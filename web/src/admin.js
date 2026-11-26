// Admin menu: overview, QRIS payments (confirm/reject), users & credits, QRIS + contact, connections.
import { db } from './supa.js';
import { cfg } from './config.js';
import { $, esc, icon, notice, toast, rupiah, num, fmtDate, confirmBox, openModal, closeModal } from './util.js';
import { state, isAdmin, refreshCredits, loadSettings } from './session.js';

const ST = { pending: ['Belum dibayar', 'b-warning'], paid: ['Lunas', 'b-success'], failed: ['Ditolak', 'b-danger'], expired: ['Dibatalkan', ''] };
const missingFn = (e) => /does not exist|Could not find the function/i.test(e?.message || '');
const MIGRATION_NOTE = 'Fitur admin belum aktif di database. Jalankan migrasi <b>003_qris_admin.sql</b> di Supabase (SQL Editor) lalu muat ulang halaman.';

export function mount(host) {
  if (!isAdmin()) { host.innerHTML = '<div class="page"><div class="page-in">' + notice('Halaman ini hanya untuk admin.', 'error') + '</div></div>'; return; }
  let alive = true, settingsUnmount = null;
  const tabFromHash = () => (location.hash.split('/')[1] || 'ringkasan');
  host.innerHTML = `
  <div class="page"><div class="page-in">
    <div class="page-head"><div><h1>Admin</h1><p>Konfirmasi pembayaran, kelola pengguna &amp; kredit, QRIS, dan koneksi.</p></div></div>
    <nav class="tabs" role="tablist">
      <button role="tab" data-tab="ringkasan">Ringkasan</button>
      <button role="tab" data-tab="pembayaran">Pembayaran <span class="count" id="tabCount" hidden></span></button>
      <button role="tab" data-tab="pengguna">Pengguna</button>
      <button role="tab" data-tab="qris">QRIS &amp; kontak</button>
      <button role="tab" data-tab="koneksi">API &amp; koneksi</button>
    </nav>
    <div id="admBody"></div>
  </div></div>`;
  const body = () => $('admBody');

  async function show(tab) {
    settingsUnmount?.(); settingsUnmount = null;
    host.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    if (tab === 'ringkasan') return overview();
    if (tab === 'pembayaran') return payments();
    if (tab === 'pengguna') return users();
    if (tab === 'qris') return qris();
    if (tab === 'koneksi') { const m = await import('./settings.js'); const box = document.createElement('div'); body().replaceChildren(box); settingsUnmount = m.mount(box, { embedded: true }) || null; }
  }
  host.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { history.replaceState(null, '', '#admin/' + b.dataset.tab); show(b.dataset.tab); }));

  async function badge() {
    const { data } = await db.rpc('admin_stats');
    const n = data?.waiting || 0, c = $('tabCount');
    if (c) { c.hidden = !n; c.textContent = String(n); }
    const r = document.getElementById('railCount'); if (r) { r.hidden = !n; r.textContent = String(n); }
    return data;
  }

  // ---------- overview ----------
  async function overview() {
    body().innerHTML = '<div class="empty">Memuat…</div>';
    const { data, error } = await db.rpc('admin_stats');
    if (!alive) return;
    if (error) { body().innerHTML = notice(missingFn(error) ? MIGRATION_NOTE : esc(error.message), 'error'); return; }
    body().innerHTML = `
      <div class="metrics">
        <div class="metric pending"><div class="label">Menunggu konfirmasi</div><div class="value">${num(data.waiting)}</div></div>
        <div class="metric success"><div class="label">Pendapatan bulan ini</div><div class="value">${rupiah(data.revenue_month)}</div></div>
        <div class="metric"><div class="label">Pengguna (baru 7 hari)</div><div class="value">${num(data.users)} <span class="small muted">+${num(data.users_7d)}</span></div></div>
        <div class="metric"><div class="label">Unduhan bulan ini</div><div class="value">${num(data.downloads_month)}</div></div>
      </div>
      <p class="xs subtle">Total pendapatan: ${rupiah(data.revenue_total)} · ${num(data.pending)} tagihan belum dibayar</p>
      <div class="toolbar" style="margin-top:20px"><h2>Perlu dicek</h2><button class="btn btn-secondary" data-goto="pembayaran">Semua pembayaran</button></div>
      <div id="ovList"></div>`;
    body().querySelector('[data-goto]').onclick = () => host.querySelector('[data-tab=pembayaran]').click();
    await paymentTable($('ovList'), 'waiting');
    badge();
  }

  // ---------- payments ----------
  async function payments() {
    body().innerHTML = `<div class="filters"><select id="pFilter" aria-label="Filter status">
      <option value="">Semua</option><option value="waiting" selected>Menunggu konfirmasi</option><option value="pending">Belum dibayar</option><option value="paid">Lunas</option><option value="failed">Ditolak</option><option value="expired">Dibatalkan</option></select>
      <button class="btn btn-secondary" id="pRefresh">${icon('refresh', 'i i-sm')}Muat ulang</button></div>
      <p class="xs subtle" style="margin:0 0 10px">Cek dulu uang masuk di aplikasi GoPay Merchant / QRIS-mu (nominal &amp; waktu), baru tekan Konfirmasi. Kredit masuk otomatis, sekali saja.</p>
      <div id="pList"></div>`;
    const load = () => paymentTable($('pList'), $('pFilter').value);
    $('pFilter').onchange = load; $('pRefresh').onclick = load; load();
  }
  async function paymentTable(box, filter) {
    box.innerHTML = '<div class="empty">Memuat…</div>';
    const status = filter === 'waiting' ? 'pending' : filter || null;
    const { data, error } = await db.rpc('admin_list_payments', { p_status: status, p_limit: 300 });
    if (!alive) return;
    if (error) { box.innerHTML = notice(missingFn(error) ? MIGRATION_NOTE : esc(error.message), 'error'); return; }
    const rows = (data || []).filter((r) => filter !== 'waiting' || (r.status === 'pending' && r.claimed_at));
    if (!rows.length) { box.innerHTML = `<div class="empty">${filter === 'waiting' ? 'Tidak ada pembayaran yang menunggu konfirmasi.' : 'Belum ada pembayaran.'}</div>`; return; }
    box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Kode</th><th>Pembeli</th><th>Paket</th><th style="text-align:right">Nominal</th><th>Status</th><th>Waktu</th><th></th></tr></thead><tbody>
      ${rows.map((r) => {
        const [lbl, cls] = r.status === 'pending' && r.claimed_at ? ['Sudah bayar · cek', 'b-accent'] : ST[r.status] || [r.status, ''];
        return `<tr><td class="mono xs">${esc(String(r.id).slice(0, 8).toUpperCase())}</td>
          <td><b>${esc(r.username || '-')}</b><div class="xs subtle">${esc(r.email || '')}</div></td>
          <td>${esc(r.package_id)} · ${num(r.kredit)} kredit</td><td class="num mono">${rupiah(r.jumlah)}</td>
          <td><span class="badge ${cls}">${esc(lbl)}</span>${r.note ? `<div class="xs subtle">${esc(r.note)}</div>` : ''}</td>
          <td class="xs">${esc(fmtDate(r.created_at))}${r.claimed_at ? `<div class="subtle">bayar: ${esc(fmtDate(r.claimed_at))}</div>` : ''}${r.paid_at ? `<div class="subtle">lunas: ${esc(fmtDate(r.paid_at))}</div>` : ''}</td>
          <td>${r.status === 'pending' ? `<div class="row"><button class="btn btn-primary" data-ok="${esc(r.id)}">Konfirmasi</button><button class="btn btn-secondary" data-no="${esc(r.id)}">Tolak</button></div>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    box.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = async () => {
      const r = rows.find((x) => x.id === b.dataset.ok);
      if (!(await confirmBox({ title: 'Konfirmasi pembayaran?', body: `Pastikan <b>${rupiah(r.jumlah)}</b> sudah masuk. <b>${num(r.kredit)} kredit</b> akan ditambahkan ke ${esc(r.username || r.email || 'pembeli')}.`, okLabel: 'Ya, sudah masuk' }))) return;
      b.disabled = true;
      const { data: res, error: e } = await db.rpc('admin_confirm_payment', { p_id: r.id });
      if (e) { toast(/already_paid/.test(e.message) ? 'Pembayaran ini sudah dikonfirmasi.' : e.message, 'error'); b.disabled = false; return; }
      toast(`Lunas. Saldo ${r.username || 'pembeli'} sekarang ${res.user_balance} kredit.`);
      if (r.user_id === state.user.id) refreshCredits();
      paymentTable(box, filter); badge();
    }));
    box.querySelectorAll('[data-no]').forEach((b) => (b.onclick = () => {
      const r = rows.find((x) => x.id === b.dataset.no);
      openModal(`<h3>Tolak pembayaran?</h3><p class="muted">${rupiah(r.jumlah)} dari ${esc(r.username || r.email || '-')}. Tidak ada kredit yang ditambahkan.</p>
        <div class="field"><label for="rjNote">Alasan (opsional, terlihat di catatan)</label><input id="rjNote" maxlength="300" placeholder="Misal: dana belum masuk"></div>
        <div class="modal-actions"><button class="btn btn-quiet" data-close>Batal</button><button class="btn btn-danger" id="rjOk">Tolak</button></div>`);
      $('rjOk').onclick = async () => {
        const { error: e } = await db.rpc('admin_reject_payment', { p_id: r.id, p_note: $('rjNote').value.trim() || null });
        closeModal();
        if (e) toast(e.message, 'error'); else { toast('Pembayaran ditolak.'); paymentTable(box, filter); badge(); }
      };
    }));
  }

  // ---------- users ----------
  async function users() {
    body().innerHTML = `<div class="filters"><input id="uSearch" type="search" placeholder="Cari nama atau email" aria-label="Cari pengguna"><button class="btn btn-secondary" id="uGo">Cari</button></div><div id="uList"></div>`;
    const load = async () => {
      const box = $('uList'); box.innerHTML = '<div class="empty">Memuat…</div>';
      const { data, error } = await db.rpc('admin_list_users', { p_search: $('uSearch').value.trim() || null, p_limit: 300 });
      if (!alive) return;
      if (error) { box.innerHTML = notice(missingFn(error) ? MIGRATION_NOTE : esc(error.message), 'error'); return; }
      if (!data?.length) { box.innerHTML = '<div class="empty">Tidak ada pengguna.</div>'; return; }
      box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Pengguna</th><th>Peran</th><th style="text-align:right">Kredit</th><th>Daftar</th><th>Terakhir masuk</th><th></th></tr></thead><tbody>
        ${data.map((u) => `<tr><td><b>${esc(u.username || '-')}</b><div class="xs subtle">${esc(u.email || '')}</div></td>
          <td><select class="sel" data-role="${esc(u.id)}" aria-label="Peran ${esc(u.username || '')}" ${u.id === state.user.id ? 'disabled' : ''}>${['user', 'supervisor', 'admin'].map((r) => `<option value="${r}"${u.user_role === r ? ' selected' : ''}>${r}</option>`).join('')}</select></td>
          <td class="num mono">${num(u.credits)}</td><td class="xs">${esc(fmtDate(u.created_at))}</td><td class="xs">${u.last_sign_in_at ? esc(fmtDate(u.last_sign_in_at)) : '-'}</td>
          <td><button class="btn btn-secondary" data-adj="${esc(u.id)}">${icon('coins', 'i i-sm')}Ubah kredit</button></td></tr>`).join('')}</tbody></table></div>`;
      box.querySelectorAll('[data-adj]').forEach((b) => (b.onclick = () => adjust(data.find((x) => x.id === b.dataset.adj), load)));
      box.querySelectorAll('[data-role]').forEach((s) => (s.onchange = async () => {
        const u = data.find((x) => x.id === s.dataset.role);
        if (!(await confirmBox({ title: 'Ubah peran?', body: `${esc(u.username || u.email)} menjadi <b>${esc(s.value)}</b>.`, okLabel: 'Ubah' }))) { s.value = u.user_role; return; }
        const { error: e } = await db.rpc('admin_set_role', { p_user: u.id, p_role: s.value });
        if (e) { toast(e.message, 'error'); s.value = u.user_role; } else { toast('Peran diubah.'); u.user_role = s.value; }
      }));
    };
    $('uGo').onclick = load; $('uSearch').onkeydown = (e) => { if (e.key === 'Enter') load(); };
    load();
  }
  function adjust(u, reload) {
    openModal(`<h3>Ubah kredit</h3><p class="muted">${esc(u.username || '-')} · ${esc(u.email || '')} · saldo <b class="mono">${num(u.credits)}</b></p>
      <form id="adjForm" class="form">
        <div class="field"><label for="adjAmt">Jumlah (pakai minus untuk mengurangi)</label><input id="adjAmt" type="number" step="1" required placeholder="Misal 30 atau -5" autofocus></div>
        <div class="field"><label for="adjNote">Catatan</label><input id="adjNote" maxlength="60" placeholder="Misal: transfer BCA, bonus"></div>
        <div id="adjMsg"></div>
        <div class="modal-actions"><button type="button" class="btn btn-quiet" data-close>Batal</button><button class="btn btn-primary" type="submit">Simpan</button></div>
      </form>`);
    $('adjForm').onsubmit = async (e) => {
      e.preventDefault();
      const amt = parseInt($('adjAmt').value, 10);
      if (!amt) { $('adjMsg').innerHTML = notice('Isi jumlah selain 0.', 'error'); return; }
      const { data, error } = await db.rpc('admin_adjust_credits', { p_user: u.id, p_amount: amt, p_note: $('adjNote').value.trim() || null });
      if (error) { $('adjMsg').innerHTML = notice(/insufficient/.test(error.message) ? 'Saldo tidak cukup untuk dikurangi sebanyak itu.' : esc(error.message), 'error'); return; }
      closeModal(); toast(`Saldo ${u.username || 'pengguna'} sekarang ${data} kredit.`);
      if (u.id === state.user.id) refreshCredits();
      reload();
    };
  }

  // ---------- QRIS + contact ----------
  async function qris() {
    await loadSettings().catch(() => {});
    const Q = await import('./qris.js');
    const QR = (await import('qrcode')).default;
    const preview = async (p) => (Q.isValidQris(p) ? await QR.toString(Q.dynamicQris(p, 25000), { type: 'svg', margin: 1 }) : '');
    body().innerHTML = `
      <div class="two">
        <section class="card stack">
          <h2 style="margin:0;font-size:var(--text-lg)">QRIS pembayaran</h2>
          <p class="small muted" style="margin:0">Website membuat QR dengan nominal paket dari QRIS statis ini. Untuk mengganti, unggah foto/screenshot QRIS baru.</p>
          <div class="row"><b>${esc(Q.merchantName(cfg.qrisStatic) || '-')}</b>${Q.isValidQris(cfg.qrisStatic) ? '<span class="badge b-success">Valid</span>' : '<span class="badge b-danger">Tidak valid</span>'}</div>
          <label class="btn btn-secondary" style="align-self:flex-start">${icon('upload', 'i i-sm')}Unggah gambar QRIS baru<input type="file" id="qrFile" accept="image/*" hidden></label>
          <details><summary class="xs muted" style="cursor:pointer">Atau tempel teks QRIS</summary><div class="field" style="margin-top:8px"><textarea id="qrText" rows="4" spellcheck="false">${esc(cfg.qrisStatic)}</textarea></div></details>
          <div id="qrMsg"></div>
          <button class="btn btn-primary btn-lg" id="qrSave" style="align-self:flex-start">Simpan QRIS</button>
        </section>
        <section class="card stack">
          <h2 style="margin:0;font-size:var(--text-lg)">Contoh yang dilihat pembeli</h2>
          <p class="small muted" style="margin:0">Paket Rp25.000: saat discan, nominal Rp25.000 langsung terisi.</p>
          <div class="qr-preview" id="qrPrev">${await preview(cfg.qrisStatic)}</div>
        </section>
      </div>
      <section class="card stack" style="margin-top:16px">
        <h2 style="margin:0;font-size:var(--text-lg)">WhatsApp admin</h2>
        <p class="small muted" style="margin:0">Dipakai untuk tombol "Kirim bukti via WhatsApp" setelah pembeli membayar. Kosongkan untuk menyembunyikan.</p>
        <form id="waForm" class="row" style="flex-wrap:wrap;align-items:flex-end"><div class="field grow" style="min-width:220px"><label for="waNum">Nomor WhatsApp</label><input id="waNum" inputmode="tel" placeholder="62812xxxxxxx" value="${esc(cfg.kontakWhatsApp || '')}"></div><button class="btn btn-primary btn-lg" type="submit">Simpan</button></form>
        <div id="waMsg"></div>
      </section>`;
    let pending = null;
    const setCandidate = async (p, src) => {
      p = String(p || '').trim();
      if (!Q.isValidQris(p)) { $('qrMsg').innerHTML = notice('Itu bukan QRIS yang valid. Pakai QR dari aplikasi merchant (bukan QR transfer biasa).', 'error'); pending = null; return; }
      pending = p; $('qrText').value = p; $('qrPrev').innerHTML = await preview(p);
      $('qrMsg').innerHTML = notice(`QRIS terbaca${src ? ' dari gambar' : ''}: <b>${esc(Q.merchantName(p))}</b>. Tekan Simpan QRIS.`, 'ok');
    };
    $('qrText').onchange = () => setCandidate($('qrText').value);
    $('qrFile').onchange = async () => {
      const f = $('qrFile').files?.[0]; if (!f) return;
      const jsQR = (await import('jsqr')).default;
      const img = await createImageBitmap(f);
      const c = document.createElement('canvas'); const s = Math.min(1, 1600 / Math.max(img.width, img.height));
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, c.width, c.height);
      const hit = jsQR(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
      if (!hit) { $('qrMsg').innerHTML = notice('QR tidak terbaca. Coba gambar yang lebih jelas/terang.', 'error'); return; }
      setCandidate(hit.data, true);
    };
    $('qrSave').onclick = async () => {
      const p = pending || $('qrText').value.trim();
      if (!Q.isValidQris(p)) { $('qrMsg').innerHTML = notice('QRIS tidak valid.', 'error'); return; }
      const { error } = await db.rpc('admin_set_setting', { p_key: 'qris_static', p_value: p });
      if (error) { $('qrMsg').innerHTML = notice(missingFn(error) ? MIGRATION_NOTE : esc(error.message), 'error'); return; }
      cfg.qrisStatic = p; pending = null; $('qrMsg').innerHTML = notice('QRIS disimpan. Pembayaran berikutnya memakai QRIS ini.', 'ok');
    };
    $('waForm').onsubmit = async (e) => {
      e.preventDefault();
      const v = $('waNum').value.replace(/\D/g, '').replace(/^0/, '62');
      if (v && !/^62\d{8,13}$/.test(v)) { $('waMsg').innerHTML = notice('Nomor harus seperti 62812xxxxxxx.', 'error'); return; }
      const { error } = await db.rpc('admin_set_setting', { p_key: 'kontak_whatsapp', p_value: v });
      if (error) { $('waMsg').innerHTML = notice(missingFn(error) ? MIGRATION_NOTE : esc(error.message), 'error'); return; }
      cfg.kontakWhatsApp = v; $('waNum').value = v; $('waMsg').innerHTML = notice(v ? 'Nomor WhatsApp disimpan.' : 'Tombol WhatsApp disembunyikan.', 'ok');
    };
  }

  const first = ['ringkasan', 'pembayaran', 'pengguna', 'qris', 'koneksi'].includes(tabFromHash()) ? tabFromHash() : 'ringkasan';
  show(first);
  badge();
  return () => { alive = false; settingsUnmount?.(); };
}
