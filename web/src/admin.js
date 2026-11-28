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
    <div class="page-head"><div><h1>Admin</h1><p>Konfirmasi pembayaran, kelola pengguna &amp; kredit, riwayat unduhan, QRIS, dan akun BigJPG.</p></div></div>
    <nav class="tabs" role="tablist">
      <button role="tab" data-tab="ringkasan">Ringkasan</button>
      <button role="tab" data-tab="pengunjung">Pengunjung</button>
      <button role="tab" data-tab="pembayaran">Pembayaran <span class="count" id="tabCount" hidden></span></button>
      <button role="tab" data-tab="pengguna">Pengguna</button>
      <button role="tab" data-tab="support">Support <span class="count" id="tabSupport" hidden></span></button>
      <button role="tab" data-tab="unduhan">Riwayat unduhan</button>
      <button role="tab" data-tab="qris">QRIS &amp; notifikasi</button>
      <button role="tab" data-tab="ai">Redraw AI</button>
      <button role="tab" data-tab="koneksi">Akun BigJPG</button>
    </nav>
    <div id="admBody"></div>
  </div></div>`;
  const body = () => $('admBody');

  async function show(tab) {
    settingsUnmount?.(); settingsUnmount = null;
    host.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    if (tab === 'ringkasan') return overview();
    if (tab === 'pengunjung') { const m = await import('./visits.js'); return m.renderVisits(body(), () => alive); }
    if (tab === 'pembayaran') return payments();
    if (tab === 'pengguna') return users();
    if (tab === 'qris') return qris();
    if (tab === 'support') return support();
    if (tab === 'ai') return aiTab();
    if (tab === 'unduhan') { const m = await import('./history.js'); const box = document.createElement('div'); body().replaceChildren(box); settingsUnmount = m.mount(box, { embedded: true }) || null; return; }
    if (tab === 'koneksi') { const m = await import('./settings.js'); const box = document.createElement('div'); body().replaceChildren(box); settingsUnmount = m.mount(box, { embedded: true }) || null; }
  }
  host.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { history.replaceState(null, '', '#admin/' + b.dataset.tab); show(b.dataset.tab); }));

  async function badge() {
    const { data } = await db.rpc('admin_stats');
    const n = data?.waiting || 0, c = $('tabCount');
    if (c) { c.hidden = !n; c.textContent = String(n); }
    const { count: open } = await db.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'baru');
    const sc = $('tabSupport'); if (sc) { sc.hidden = !open; sc.textContent = String(open || 0); }
    const r = document.getElementById('menuCount'); if (r) { const t = n + (open || 0); r.hidden = !t; r.textContent = String(t); }
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
      <div id="ovQuota" style="margin-top:12px"></div>
      <div class="toolbar" style="margin-top:20px"><h2>Perlu dicek</h2><button class="btn btn-secondary" data-goto="pembayaran">Semua pembayaran</button></div>
      <div id="ovList"></div>`;
    body().querySelector('[data-goto]').onclick = () => host.querySelector('[data-tab=pembayaran]').click();
    quotaBox($('ovQuota'));
    await paymentTable($('ovList'), 'waiting');
    badge();
  }

  async function quotaBox(box) {
    try {
      const { invoke } = await import('./supa.js');
      const r = await invoke('bigjpg-upscale', { action: 'list_keys' });
      if (!alive || !box.isConnected || !r.keys?.length) return;
      const pct = r.total_quota ? Math.round((r.total_used / r.total_quota) * 100) : 0;
      box.innerHTML = `<div class="card"><div class="progress ${pct >= 90 ? 'bad' : pct >= 80 ? 'warn' : 'ok'}"><div class="head"><span>Kuota upscale BigJPG bulan ini · ${r.keys.filter((k) => k.active).length} akun</span><b class="num">${num(r.total_used)} / ${num(r.total_quota)}</b></div><div class="bar"><i style="width:${Math.min(100, pct)}%"></i></div><small>Sisa ${num(r.remaining)}${pct >= 80 ? ' · hampir habis: tambah akun di tab Akun BigJPG' : ''}</small></div></div>`;
    } catch {}
  }

  // ---------- Midtrans: automatic QRIS ----------
  async function midtransBox() {
    const box = $('mtBox'); if (!box) return;
    const { invoke } = await import('./supa.js');
    let st;
    try { st = await invoke('midtrans', { action: 'config_status' }); }
    catch (e) { box.innerHTML = notice(esc(e.message), 'error'); return; }
    if (!alive || !box.isConnected) return;
    const auto = cfg.payMode === 'midtrans';
    const modeName = st.mode === 'production' ? 'Production' : 'Sandbox (uji coba)';
    box.innerHTML = `
      <div class="toolbar" style="margin:0"><div><h2 style="margin:0;font-size:var(--text-lg)">Pembayaran otomatis (Midtrans)</h2>
        <p class="small muted" style="margin:2px 0 0">Pembeli scan QRIS khusus pesanannya; kredit masuk sendiri begitu Midtrans mengabarkan pembayaran lunas. Tidak perlu konfirmasi manual.</p></div>
        <span class="grow"></span>${auto ? '<span class="badge b-success">Aktif untuk pembeli</span>' : '<span class="badge">Belum dipakai</span>'}</div>
      <div class="two">
        <div class="stack">
          <div class="row"><span class="lbl" style="width:110px">Status</span>${st.configured ? `<span class="badge b-success">Server Key tersimpan</span> <span class="xs mono muted">${esc(st.masked)}</span>` : '<span class="badge b-danger">Belum diisi</span>'}</div>
          <div class="row"><span class="lbl" style="width:110px">Signature</span>${st.sig ? '<span class="badge b-success">Signature Secret Key tersimpan</span>' : '<span class="badge">Belum diisi</span>'}</div>
          <div class="row"><span class="lbl" style="width:110px">Mode</span><b>${esc(modeName)}</b></div>
          <form class="stack" id="mtForm">
            <div class="field"><label for="mtMode">Mode</label><select id="mtMode"><option value="sandbox"${st.mode !== 'production' ? ' selected' : ''}>Sandbox (uji coba, tanpa uang sungguhan)</option><option value="production"${st.mode === 'production' ? ' selected' : ''}>Production (pembayaran sungguhan)</option></select></div>
            <div class="field"><label for="mtKey">Server Key ${st.configured ? '<span class="muted">(kosongkan kalau tidak diganti)</span>' : ''}</label><input id="mtKey" type="password" autocomplete="off" spellcheck="false" placeholder="${st.mode === 'production' ? 'Mid-server-…' : 'SB-Mid-server-…'}"></div>
            <div class="field"><label for="mtSig">Signature Secret Key ${st.sig ? '<span class="muted">(kosongkan kalau tidak diganti)</span>' : ''}</label><input id="mtSig" type="password" autocomplete="off" spellcheck="false" placeholder="Dari Access Keys → General Credentials"><span class="xs muted">Dipakai untuk memastikan kabar pembayaran benar dari Midtrans.</span></div>
            <div class="row" style="flex-wrap:wrap"><button class="btn btn-primary" type="submit">Simpan</button><button class="btn btn-secondary" type="button" id="mtTest"${st.configured ? '' : ' disabled'}>Tes koneksi</button><button class="btn btn-secondary" type="button" id="mtTry"${st.configured ? '' : ' disabled'}>Coba bayar (admin)</button></div>
            <p class="xs muted" style="margin:0">"Coba bayar" membuat QRIS sungguhan dari Midtrans untuk akun admin ini saja, walaupun pembeli masih memakai QRIS manual. Kredit dari uji coba masuk ke akun admin.</p>
          </form>
          <div id="mtMsg"></div>
        </div>
        <div class="stack">
          <div class="field"><label for="mtHook">Payment Notification URL</label>
            <div class="row"><input id="mtHook" readonly value="${esc(st.webhook)}" class="mono" style="flex:1;min-width:0"><button class="btn btn-secondary" type="button" id="mtCopy">${icon('link', 'i i-sm')}Salin</button></div></div>
          <ol class="qris-steps small" style="margin:0">
            <li>Masuk ke dashboard Midtrans, pilih lingkungan yang sama dengan mode di kiri (Sandbox atau Production).</li>
            <li><b>Settings → Access Keys → General Credentials → Generate server key</b>, dengan izin <b>Core API = Write</b>. Tempel key di kolom kiri.</li>
            <li>Di halaman yang sama salin <b>Signature Secret Key</b>, tempel di kolom kiri, lalu Simpan dan Tes koneksi.</li>
            <li><b>Settings → Payment → Payment Notification URL</b>: tempel URL di atas, lalu simpan.</li>
            <li>Setelah tes berhasil, nyalakan pembayaran otomatis di bawah.</li>
          </ol>
        </div>
      </div>
      <div class="row" style="flex-wrap:wrap;border-top:1px solid var(--color-border);padding-top:12px">
        <span class="small">Cara bayar yang dilihat pembeli:</span>
        <div class="seg" role="radiogroup" id="mtPay" style="min-width:300px"><button role="radio" data-m="manual" aria-checked="${!auto}">QRIS manual (konfirmasi admin)</button><button role="radio" data-m="midtrans" aria-checked="${auto}"${st.configured && st.mode === 'production' ? '' : ' disabled'}>Otomatis (Midtrans)</button></div>
      </div>
      ${st.mode !== 'production' ? `<p class="xs muted" style="margin:0">Mode Sandbox hanya untuk uji coba admin (QRIS Sandbox bisa "dibayar" lewat simulator tanpa uang). Pilihan <b>Otomatis</b> untuk pembeli bisa dinyalakan setelah mode Production.</p>` : ''}
      ${auto && st.mode !== 'production' ? notice('Pembeli sedang diarahkan ke pembayaran otomatis, tetapi mode masih Sandbox, jadi pembayaran mereka akan ditolak. Kembalikan ke QRIS manual sampai mode Production siap.', 'error') : ''}`;
    $('mtCopy').onclick = async () => { try { await navigator.clipboard.writeText(st.webhook); toast('URL disalin.'); } catch { $('mtHook').select(); } };
    $('mtForm').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.submitter; if (btn) btn.disabled = true;
      try { const r = await invoke('midtrans', { action: 'save_config', mode: $('mtMode').value, server_key: $('mtKey').value.trim(), signature_key: $('mtSig').value.trim() }); toast(r.message); await midtransBox(); }
      catch (err) { $('mtMsg').innerHTML = notice(esc(err.message), 'error'); if (btn) btn.disabled = false; }
    };
    $('mtTest').onclick = async () => {
      const b = $('mtTest'); b.disabled = true;
      try { const r = await invoke('midtrans', { action: 'test' }); $('mtMsg').innerHTML = notice(esc(r.message), 'ok'); }
      catch (err) { $('mtMsg').innerHTML = notice(esc(err.message), 'error'); }
      finally { b.disabled = false; }
    };
    $('mtTry').onclick = async () => { const { topupDialog } = await import('./session.js'); topupDialog('Uji coba pembayaran otomatis (khusus admin).', { midtrans: true }); };
    $('mtPay').onclick = async (e) => {
      const b = e.target.closest('[data-m]'); if (!b || b.disabled || b.getAttribute('aria-checked') === 'true') return;
      const m = b.dataset.m;
      if (m === 'midtrans' && !(await confirmBox({ title: 'Pakai pembayaran otomatis?', body: st.mode === 'production' ? 'Pembeli akan membayar lewat QRIS Midtrans dan kredit masuk otomatis.' : 'Mode Sandbox: QRIS tidak bisa dibayar dengan uang sungguhan. Pakai ini hanya untuk uji coba.', okLabel: 'Aktifkan' }))) return;
      const { error } = await db.rpc('admin_set_setting', { p_key: 'pay_mode', p_value: m });
      if (error) { $('mtMsg').innerHTML = notice(esc(error.message), 'error'); return; }
      cfg.payMode = m; toast(m === 'midtrans' ? 'Pembayaran otomatis aktif.' : 'Kembali ke QRIS manual.'); midtransBox();
    };
  }

  // ---------- Telegram notifications ----------
  async function telegramBox() {
    const box = $('tgBox'); if (!box) return;
    const { invoke } = await import('./supa.js');
    let st;
    try { st = await invoke('telegram-admin', { action: 'status' }); }
    catch (e) { box.innerHTML = notice(esc(e.message), 'error'); return; }
    if (!alive || !box.isConnected) return;
    const head = `<div class="toolbar" style="margin:0"><div><h2 style="margin:0;font-size:var(--text-lg)">Notifikasi Telegram</h2>
      <p class="small muted" style="margin:2px 0 0">Bot mengirim pesan ke HP Anda setiap kali pembeli menekan "Saya sudah bayar", walaupun website tidak dibuka.</p></div>
      ${st.connected ? '<span class="badge b-success">Aktif</span>' : st.has_token ? '<span class="badge b-warning">Belum tersambung</span>' : '<span class="badge">Belum diatur</span>'}</div>`;
    const steps = `<ol class="qris-steps small">
      <li>Di Telegram, buka <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a>, kirim <span class="mono">/newbot</span>, beri nama (misalnya BNW Lab Admin).</li>
      <li>Salin <b>token</b> yang diberikan BotFather, tempel di bawah, lalu klik Simpan token.</li>
      <li>Buka bot baru Anda, tekan <b>Start</b>, lalu klik <b>Sambungkan</b> di sini.</li></ol>`;
    const tokenForm = `<form id="tgForm" class="row" style="flex-wrap:wrap;align-items:flex-end"><div class="field grow" style="min-width:260px"><label for="tgToken">Token bot</label><input id="tgToken" type="password" autocomplete="off" placeholder="123456789:AAH…"></div><button class="btn btn-primary btn-lg" type="submit">Simpan token</button></form>`;
    if (st.connected) {
      box.innerHTML = `${head}${notice(`Terkirim ke <b>${esc(st.chat_name || '-')}</b> lewat bot <b>@${esc(st.bot || '')}</b>.`, 'ok')}
        <div class="row" style="flex-wrap:wrap"><button class="btn btn-primary" id="tgTest">Kirim pesan tes</button><button class="btn btn-secondary" id="tgReconnect">Ganti chat penerima</button><button class="btn btn-quiet" id="tgOff">Matikan</button></div><div id="tgMsg"></div>`;
    } else if (st.has_token) {
      box.innerHTML = `${head}${notice(`Bot <b>@${esc(st.bot || '')}</b> tersimpan. Buka <a href="https://t.me/${esc(st.bot || '')}" target="_blank" rel="noopener">t.me/${esc(st.bot || '')}</a>, tekan <b>Start</b>, lalu klik Sambungkan.`, 'warn')}
        <div class="row" style="flex-wrap:wrap"><a class="btn btn-secondary" href="https://t.me/${esc(st.bot || '')}?start=bnwlab" target="_blank" rel="noopener">${icon('chat', 'i i-sm')}1. Buka bot &amp; tekan Start</a><button class="btn btn-primary" id="tgConnect">2. Sambungkan</button><button class="btn btn-quiet" id="tgOff">Hapus bot</button></div>
        <details><summary class="xs muted" style="cursor:pointer">Ganti token bot</summary><div style="margin-top:8px">${tokenForm}</div></details><div id="tgMsg"></div>`;
    } else {
      box.innerHTML = `${head}${steps}${tokenForm}<div id="tgMsg"></div>`;
    }
    const run = async (btn, body) => {
      if (btn) btn.disabled = true;
      try { const r = await invoke('telegram-admin', body); toast(r.message); await telegramBox(); }
      catch (e) { const m = $('tgMsg'); if (m) m.innerHTML = notice(esc(e.message), 'error'); }
      finally { if (btn && btn.isConnected) btn.disabled = false; }
    };
    const f = $('tgForm'); if (f) f.onsubmit = (e) => { e.preventDefault(); run(f.querySelector('button'), { action: 'save_token', token: $('tgToken').value.trim() }); };
    // Wait up to ~60 s for the admin's "Start" message to reach the bot.
    $('tgConnect')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      for (let i = 0; i < 20 && alive && btn.isConnected; i++) {
        try { const r = await invoke('telegram-admin', { action: 'connect' }); toast(r.message); await telegramBox(); return; }
        catch (err) {
          const m = $('tgMsg'); if (!m) return;
          if (!/Belum ada pesan/.test(err.message)) { m.innerHTML = notice(esc(err.message), 'error'); btn.disabled = false; return; }
          m.innerHTML = notice(`Menunggu pesan Start dari Anda di bot <b>@${esc(st.bot || '')}</b>… (${20 - i})`, 'warn');
          btn.textContent = 'Menunggu…';
          await new Promise((res) => setTimeout(res, 3000));
        }
      }
      const m = $('tgMsg'); if (m) m.innerHTML = notice(`Belum ada pesan masuk ke <b>@${esc(st.bot || '')}</b>. Pastikan Anda membuka bot yang sama dan menekan Start, lalu klik Sambungkan lagi.`, 'error');
      if (btn.isConnected) { btn.disabled = false; btn.textContent = '2. Sambungkan'; }
    });
    $('tgReconnect')?.addEventListener('click', (e) => run(e.currentTarget, { action: 'connect' }));
    $('tgTest')?.addEventListener('click', (e) => run(e.currentTarget, { action: 'test' }));
    $('tgOff')?.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (await confirmBox({ title: 'Matikan notifikasi Telegram?', body: 'Token bot dihapus dari website. Bot di Telegram tetap ada.', okLabel: 'Matikan', danger: true })) run(b, { action: 'disconnect' });
    });
  }

  // ---------- support tickets ----------
  async function support(filter = 'aktif') {
    const { TOPICS, TICKET_STATUS } = await import('./support.js');
    body().innerHTML = `<div class="filters"><select id="spFilter" aria-label="Filter status">
        <option value="aktif">Belum selesai</option><option value="baru">Baru</option><option value="diproses">Sedang dicek</option><option value="selesai">Selesai</option><option value="semua">Semua</option></select>
        <button class="btn btn-secondary" id="spReload">${icon('refresh', 'i i-sm')}Muat ulang</button></div>
      <div id="spList" class="stack"><div class="empty">Memuat…</div></div>`;
    $('spFilter').value = filter;
    $('spFilter').onchange = () => support($('spFilter').value);
    $('spReload').onclick = () => support($('spFilter').value);
    let q = db.from('support_tickets').select('*').order('created_at', { ascending: false }).limit(200);
    if (filter === 'aktif') q = q.neq('status', 'selesai'); else if (filter !== 'semua') q = q.eq('status', filter);
    const { data, error } = await q;
    if (!alive) return;
    const list = $('spList'); if (!list) return;
    if (error) { list.innerHTML = notice(/does not exist|schema cache/i.test(error.message) ? 'Tabel support belum ada. Jalankan migrasi <b>005_support.sql</b>.' : esc(error.message), 'error'); return; }
    if (!data?.length) { list.innerHTML = '<div class="empty">Tidak ada pesan.</div>'; return; }
    list.innerHTML = data.map((t) => {
      const st = TICKET_STATUS[t.status] || [t.status, ''];
      const ig = String(t.instagram || '').replace(/[^A-Za-z0-9._]/g, '');
      return `<article class="ticket" data-t="${esc(t.id)}">
        <div class="row" style="flex-wrap:wrap"><b>${esc(t.username || '-')}</b><span class="xs muted">${esc(t.email || '')}</span><span class="badge">${esc(TOPICS[t.topik] || t.topik)}</span><span class="badge ${st[1]}">${st[0]}</span><span class="grow"></span><span class="xs subtle">${esc(fmtDate(t.created_at))}</span></div>
        <div class="msg">${esc(t.pesan)}</div>
        <div class="field"><label for="rp-${esc(t.id)}">Balasan (terlihat oleh pengguna)</label><textarea id="rp-${esc(t.id)}" class="plain" rows="3" maxlength="2000">${esc(t.balasan || '')}</textarea></div>
        <div class="row" style="flex-wrap:wrap">
          <select data-st aria-label="Status">${Object.entries(TICKET_STATUS).map(([k, v]) => `<option value="${k}"${k === t.status ? ' selected' : ''}>${v[0]}</option>`).join('')}</select>
          <button class="btn btn-primary" data-save>Simpan</button>
          ${ig ? `<a class="btn btn-secondary" href="https://ig.me/m/${esc(ig)}" target="_blank" rel="noopener">${icon('chat', 'i i-sm')}Instagram @${esc(ig)}</a>` : ''}
          ${t.email ? `<a class="btn btn-quiet" href="mailto:${esc(t.email)}">Email</a>` : ''}
        </div>
      </article>`;
    }).join('');
    list.querySelectorAll('[data-save]').forEach((b) => (b.onclick = async () => {
      const art = b.closest('[data-t]'), id = art.dataset.t;
      const balasan = $('rp-' + id).value.trim();
      let status = art.querySelector('[data-st]').value;
      if (balasan && status === 'baru') status = 'diproses';
      b.disabled = true;
      const { error: e } = await db.from('support_tickets').update({ balasan: balasan || null, status }).eq('id', id);
      b.disabled = false;
      if (e) toast(e.message, 'error'); else { toast('Tersimpan.'); badge(); support($('spFilter').value); }
    }));
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
          <td style="white-space:nowrap"><button class="btn btn-secondary" data-adj="${esc(u.id)}">${icon('coins', 'i i-sm')}Ubah kredit</button>${u.id === state.user.id || u.user_role === 'admin' ? '' : ` <button class="btn btn-quiet" data-del="${esc(u.id)}" aria-label="Hapus akun ${esc(u.email || '')}">Hapus</button>`}</td></tr>`).join('')}</tbody></table></div>`;
      box.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => removeUser(data.find((x) => x.id === b.dataset.del), load)));
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
  async function removeUser(u, reload) {
    if (!(await confirmBox({ title: 'Hapus akun ini?', body: `<b>${esc(u.email || u.username || '-')}</b> beserta kredit (${num(u.credits)}), riwayat, dan tiketnya akan dihapus permanen. Email yang sama bisa mendaftar lagi sebagai akun baru.`, okLabel: 'Hapus akun', danger: true }))) return;
    let { error } = await db.rpc('admin_delete_user', { p_user: u.id, p_force: false });
    if (error && /has_paid_payments:(\d+)/.test(error.message)) {
      const total = Number(/has_paid_payments:(\d+)/.exec(error.message)[1]);
      if (!(await confirmBox({ title: 'Akun ini pernah membayar', body: `Total pembayaran lunas <b>${rupiah(total)}</b>. Catatan pembayarannya diarsipkan dulu, lalu akun dihapus. Lanjutkan?`, okLabel: 'Tetap hapus', danger: true }))) return;
      ({ error } = await db.rpc('admin_delete_user', { p_user: u.id, p_force: true }));
    }
    if (error) {
      const m = /cannot_delete_self/.test(error.message) ? 'Tidak bisa menghapus akun sendiri.' : /cannot_delete_admin/.test(error.message) ? 'Akun admin tidak bisa dihapus dari sini. Ubah perannya dulu.' : /user_not_found/.test(error.message) ? 'Akun tidak ditemukan.' : missingFn(error) ? MIGRATION_NOTE : error.message;
      toast(m, 'error'); return;
    }
    toast('Akun dihapus.'); reload();
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

  // ---------- Redraw AI: API key, provider, on/off ----------
  async function aiTab() {
    const { invoke } = await import('./supa.js');
    body().innerHTML = '<div class="empty">Memuat…</div>';
    let st;
    try { st = await invoke('ai-redraw', { action: 'config_status' }); }
    catch (e) { body().innerHTML = notice(esc(e.message), 'error'); return; }
    if (!alive) return;
    const g = st.provider === 'google';
    const lastErr = st.last_error ? notice(`<b>Error AI terakhir:</b> <span class="xs mono" style="word-break:break-word">${esc(st.last_error)}</span><br><span class="xs">Kalau isinya soal saldo, billing, credits, atau quota: isi ulang saldo di Google AI Studio (Billing) atau OpenRouter (Credits). Kredit pelanggan sudah dikembalikan otomatis.</span>`, 'warn') : '';
    body().innerHTML = `
      <div class="two">
        <section class="card stack">
          <div class="toolbar" style="margin:0"><div><h2 style="margin:0;font-size:var(--text-lg)">Redraw AI</h2>
            <p class="small muted" style="margin:2px 0 0">Pelanggan unggah desain pecah/buram, AI menggambar ulang. ${st.cost['2K']} kredit (2K) / ${st.cost['4K']} kredit (4K), revisi ${st.revise['2K']}/${st.revise['4K']} kredit. Kredit kembali otomatis kalau AI gagal.</p></div>
            <span class="grow"></span>${st.enabled ? '<span class="badge b-success">Terbuka untuk pelanggan</span>' : '<span class="badge">Hanya admin</span>'}</div>
          ${lastErr}
          <form class="stack" id="aiForm">
            <div class="field"><label>Penyedia</label>
              <div class="seg" role="radiogroup" id="aiProv"><button type="button" role="radio" data-p="google" aria-checked="${g}">Google Gemini (langsung)</button><button type="button" role="radio" data-p="openrouter" aria-checked="${!g}">OpenRouter</button></div></div>
            <div class="stack" id="aiG"${g ? '' : ' hidden'}>
              <div class="row"><span class="lbl" style="width:110px">Status</span>${st.google.set ? `<span class="badge b-success">API key tersimpan</span> <span class="xs mono muted">${esc(st.google.masked)}</span>` : '<span class="badge b-danger">Belum diisi</span>'}</div>
              <div class="field"><label for="aiGKey">API key Google AI Studio ${st.google.set ? '<span class="muted">(kosongkan kalau tidak diganti)</span>' : ''}</label><input id="aiGKey" type="password" autocomplete="off" spellcheck="false" placeholder="AIza…"></div>
              <div class="field"><label for="aiGModel">Model</label><input id="aiGModel" class="mono" spellcheck="false" value="${esc(st.google.model)}"><span class="xs muted">Default gemini-3.1-flash-image (Nano Banana 2). Ganti hanya kalau Google mengganti nama model.</span></div>
            </div>
            <div class="stack" id="aiO"${g ? ' hidden' : ''}>
              <div class="row"><span class="lbl" style="width:110px">Status</span>${st.openrouter.set ? `<span class="badge b-success">API key tersimpan</span> <span class="xs mono muted">${esc(st.openrouter.masked)}</span>` : '<span class="badge b-danger">Belum diisi</span>'}</div>
              <div class="field"><label for="aiOKey">API key OpenRouter ${st.openrouter.set ? '<span class="muted">(kosongkan kalau tidak diganti)</span>' : ''}</label><input id="aiOKey" type="password" autocomplete="off" spellcheck="false" placeholder="sk-or-…"></div>
              <div class="field"><label for="aiOModel">Model</label><input id="aiOModel" class="mono" spellcheck="false" value="${esc(st.openrouter.model)}"><span class="xs muted">Nama model gambar Gemini di OpenRouter, misalnya google/gemini-3.1-flash-image-preview.</span></div>
            </div>
            <div class="field"><label>Harga (kredit)</label>
              <div class="ai-price-grid">
                <label><span class="xs muted">Gambar 2K</span><input id="aiP2" type="number" min="1" max="100" step="1" value="${st.cost['2K']}"></label>
                <label><span class="xs muted">Gambar 4K</span><input id="aiP4" type="number" min="1" max="100" step="1" value="${st.cost['4K']}"></label>
                <label><span class="xs muted">Revisi 2K</span><input id="aiR2" type="number" min="1" max="100" step="1" value="${st.revise['2K']}"></label>
                <label><span class="xs muted">Revisi 4K</span><input id="aiR4" type="number" min="1" max="100" step="1" value="${st.revise['4K']}"></label>
              </div>
              <span class="xs muted" id="aiMargin"></span></div>
            <div class="field"><label for="aiCap">Batas gambar per hari (seluruh situs)</label><input id="aiCap" type="number" min="0" max="100000" step="1" value="${esc(st.daily_cap)}"><span class="xs muted">Melindungi saldo AI dari pemakaian tak terduga. 0 = tanpa batas.</span></div>
            <div class="row" style="flex-wrap:wrap"><button class="btn btn-primary" type="submit">Simpan</button><button class="btn btn-secondary" type="button" id="aiTest">Tes koneksi</button><a class="btn btn-secondary" href="#ai" data-route="ai">Buka halaman AI</a></div>
          </form>
          <div id="aiMsgA"></div>
          <div class="row" style="flex-wrap:wrap;border-top:1px solid var(--color-border);padding-top:12px">
            <span class="small">Untuk pelanggan:</span>
            <div class="seg" role="radiogroup" id="aiOn" style="min-width:260px"><button role="radio" data-on="0" aria-checked="${!st.enabled}">Sembunyikan</button><button role="radio" data-on="1" aria-checked="${st.enabled}">Buka</button></div>
          </div>
        </section>
        <section class="card stack">
          <h2 style="margin:0;font-size:var(--text-lg)">Pemakaian 30 hari</h2>
          <div class="metrics"><div class="metric"><div class="label">Hari ini</div><div class="value">${num(st.stat.today)}</div></div><div class="metric"><div class="label">30 hari</div><div class="value">${num(st.stat.month)}</div></div><div class="metric"><div class="label">Dikembalikan</div><div class="value">${num(st.stat.refunds)}</div></div><div class="metric success"><div class="label">Kredit terpakai</div><div class="value">${num(st.stat.credits)}</div></div></div>
          <p class="xs muted" style="margin:0">Termasuk uji coba admin. Modal ke Google kira-kira $0,10 per gambar 2K dan $0,15 per gambar 4K (+PPN). Cek pemakaian sebenarnya di AI Studio → Usage / Spend.</p>
          <h3 style="margin:8px 0 0;font-size:var(--text-base)">Cara menyiapkan (Google)</h3>
          <ol class="qris-steps small" style="margin:0">
            <li>Login <b>aistudio.google.com</b> dengan akun BNW Lab → <b>Get API key</b>.</li>
            <li>Di baris project, klik <b>Set up billing</b>, pilih Prepay, isi saldo. Matikan auto reload kalau ingin pengeluaran tetap.</li>
            <li>Salin API key (ikon salin), tempel di kolom kiri, <b>Simpan</b>, lalu <b>Tes koneksi</b>.</li>
            <li>Buka halaman AI, coba 1–2 desain dengan akun admin. Kalau hasilnya oke, pilih <b>Buka</b> untuk pelanggan.</li>
          </ol>
          <p class="xs muted" style="margin:0">API key hanya disimpan di server dan tidak pernah dikirim ke browser pelanggan. Jangan kirim key lewat chat atau WhatsApp.</p>
        </section>
      </div>`;
    // Worst-case margin: the cheapest credit (largest pack, plus the welcome bonus) against the AI cost.
    const margin = () => {
      const packs = (state.packages || []).filter((p) => p.kredit > 0);
      if (!packs.length) { $('aiMargin').textContent = ''; return; }
      const bonus = 1 + (Number(cfg.promoPct) || 0) / 100;
      const low = Math.min(...packs.map((p) => p.harga / (p.kredit * bonus)));
      const cost = { '2K': 2100, '4K': 3100 };
      const f = (credits, k) => { const r = Math.round(credits * low); const u = r - cost[k]; return `${num(credits)} kr = Rp${num(r)} → ${u >= 0 ? 'untung' : 'rugi'} Rp${num(Math.abs(u))}`; };
      $('aiMargin').innerHTML = `Terburuk (kredit termurah Rp${num(Math.round(low))}${bonus > 1 ? ', sudah termasuk bonus ' + cfg.promoPct + '%' : ''}; modal ±Rp2.100 per 2K, ±Rp3.100 per 4K): 2K ${f(Number($('aiP2').value) || 0, '2K')} · 4K ${f(Number($('aiP4').value) || 0, '4K')} · revisi 2K ${f(Number($('aiR2').value) || 0, '2K')} · revisi 4K ${f(Number($('aiR4').value) || 0, '4K')}`;
    };
    ['aiP2', 'aiP4', 'aiR2', 'aiR4'].forEach((id) => ($(id).oninput = margin)); margin();
    let prov = st.provider;
    $('aiProv').onclick = (e) => { const b = e.target.closest('[data-p]'); if (!b) return; prov = b.dataset.p; $('aiProv').querySelectorAll('[data-p]').forEach((x) => x.setAttribute('aria-checked', String(x === b))); $('aiG').hidden = prov !== 'google'; $('aiO').hidden = prov !== 'openrouter'; };
    $('aiForm').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.submitter; if (btn) btn.disabled = true;
      try {
        const r = await invoke('ai-redraw', { action: 'save_config', provider: prov, google_key: $('aiGKey').value.trim(), google_model: $('aiGModel').value.trim(), openrouter_key: $('aiOKey').value.trim(), openrouter_model: $('aiOModel').value.trim(), daily_cap: $('aiCap').value.trim(), prices: { '2K': Number($('aiP2').value), '4K': Number($('aiP4').value), r2K: Number($('aiR2').value), r4K: Number($('aiR4').value) } });
        cfg.aiPrices = { cost: { '2K': Number($('aiP2').value), '4K': Number($('aiP4').value) }, revise: { '2K': Number($('aiR2').value), '4K': Number($('aiR4').value) } };
        toast(r.message); await aiTab();
      } catch (err) { $('aiMsgA').innerHTML = notice(esc(err.message), 'error'); if (btn) btn.disabled = false; }
    };
    $('aiTest').onclick = async () => {
      const b = $('aiTest'); b.disabled = true;
      try { const r = await invoke('ai-redraw', { action: 'test' }); $('aiMsgA').innerHTML = notice(esc(r.message), 'ok'); }
      catch (err) { $('aiMsgA').innerHTML = notice(esc(err.message), 'error'); }
      finally { b.disabled = false; }
    };
    $('aiOn').onclick = async (e) => {
      const b = e.target.closest('[data-on]'); if (!b || b.getAttribute('aria-checked') === 'true') return;
      const on = b.dataset.on === '1';
      if (on && !(await confirmBox({ title: 'Buka Redraw AI untuk pelanggan?', body: 'Menu "Redraw AI" akan muncul untuk semua pengunjung. Pastikan saldo AI sudah terisi dan hasil uji coba sudah oke.', okLabel: 'Buka' }))) return;
      try { const r = await invoke('ai-redraw', { action: 'set_enabled', enabled: on }); cfg.aiEnabled = on; toast(r.message); aiTab(); }
      catch (err) { $('aiMsgA').innerHTML = notice(esc(err.message), 'error'); }
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
      <section class="card stack" style="margin-top:16px" id="mtBox"><div class="empty">Memuat…</div></section>
      <section class="card stack" style="margin-top:16px" id="tgBox"><div class="empty">Memuat…</div></section>`;
    midtransBox();
    telegramBox();
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
  }

  const first = ['ringkasan', 'pengunjung', 'pembayaran', 'pengguna', 'support', 'unduhan', 'qris', 'ai', 'koneksi'].includes(tabFromHash()) ? tabFromHash() : 'ringkasan';
  show(first);
  badge();
  return () => { alive = false; settingsUnmount?.(); };
}
