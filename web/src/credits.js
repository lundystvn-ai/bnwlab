// Riwayat pembelian kredit: semua top-up milik pengguna (QRIS), dengan statusnya.
import { db } from './supa.js';
import { $, esc, icon, notice, fmtDate, rupiah, num, toast, confirmBox } from './util.js';
import { state, topupDialog, refreshCredits, onSession } from './session.js';

const STATUS = {
  paid: ['Berhasil', 'b-success'],
  failed: ['Ditolak', 'b-danger'],
  expired: ['Dibatalkan', ''],
};

export function mount(host) {
  let alive = true;
  host.innerHTML = `
  <div class="page"><div class="page-in" style="max-width:880px">
    <div class="page-head"><div><h1>Riwayat pembelian kredit</h1><p>Semua pembelian kredit lewat QRIS dan statusnya.</p></div>
      <div class="row"><button class="btn btn-secondary" id="cRefresh">${icon('refresh', 'i i-sm')}Muat ulang</button><button class="btn btn-primary" id="cTopup">${icon('plus', 'i i-sm')}Isi kredit</button></div></div>
    <div class="metrics m3" style="margin-bottom:16px">
      <div class="metric"><div class="label">Saldo sekarang</div><div class="value" id="cBal">${num(state.credits)}</div></div>
      <div class="metric"><div class="label">Total kredit dibeli</div><div class="value" id="cBought">-</div></div>
      <div class="metric"><div class="label">Total dibayar</div><div class="value" id="cPaid">-</div></div>
    </div>
    <div id="cList"><div class="empty">Memuat…</div></div>
  </div></div>`;

  async function load() {
    const box = $('cList'); if (!box) return;
    const { data, error } = await db.from('payments').select('id,package_id,kredit,jumlah,status,claimed_at,paid_at,note,created_at')
      .eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(200);
    if (!alive) return;
    if (error) { box.innerHTML = notice(esc(error.message), 'error'); return; }
    const paid = (data || []).filter((p) => p.status === 'paid');
    $('cBought').textContent = num(paid.reduce((a, p) => a + Number(p.kredit || 0), 0));
    $('cPaid').textContent = rupiah(paid.reduce((a, p) => a + Number(p.jumlah || 0), 0));
    $('cBal').textContent = num(state.credits);
    if (!data?.length) { box.innerHTML = '<div class="empty">Belum ada pembelian kredit.</div>'; return; }
    const pack = (id) => state.packages.find((p) => p.id === id)?.nama || id || '-';
    box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Paket</th><th class="num">Kredit</th><th class="num">Harga</th><th>Kode</th><th>Status</th><th></th></tr></thead><tbody>
      ${data.map((p) => {
        const st = p.status === 'pending' ? (p.claimed_at ? ['Menunggu konfirmasi', 'b-warning'] : ['Belum dibayar', '']) : STATUS[p.status] || [p.status, ''];
        const cancel = p.status === 'pending' && !p.claimed_at;
        return `<tr><td class="xs">${esc(fmtDate(p.created_at))}</td><td>${esc(pack(p.package_id))}</td><td class="num">${num(p.kredit)}</td><td class="num">${rupiah(p.jumlah)}</td>
          <td class="mono xs">${esc(String(p.id).slice(0, 8).toUpperCase())}</td>
          <td><span class="badge ${st[1]}">${st[0]}</span>${p.status === 'failed' && p.note ? `<div class="xs subtle">${esc(p.note)}</div>` : ''}</td>
          <td>${cancel ? `<button class="btn btn-quiet" data-cancel="${esc(p.id)}">Batalkan</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    box.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = async () => {
      if (!(await confirmBox({ title: 'Batalkan pembelian?', body: 'Tagihan yang belum dibayar ini akan dibatalkan.', okLabel: 'Batalkan', danger: true }))) return;
      const { error: e } = await db.rpc('cancel_topup', { p_id: b.dataset.cancel });
      if (e) toast(e.message, 'error'); else { toast('Tagihan dibatalkan.'); load(); }
    }));
  }

  $('cRefresh').onclick = () => { refreshCredits(); load(); };
  $('cTopup').onclick = () => topupDialog();
  onSession(() => { if (alive && $('cBal')) $('cBal').textContent = num(state.credits); });
  load();
  return () => { alive = false; };
}
