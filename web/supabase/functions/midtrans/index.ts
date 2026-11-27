// Edge Function: midtrans — automatic QRIS top-ups.
// Customer: create (make a QRIS for a credit pack), status (check a payment).
// Admin: config_status, save_config, test.
// Midtrans: POST notification (webhook) with a SHA512 signature; every notification is checked again
// with Midtrans' status API before credits are added. The server key never leaves the server.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

const EXPIRY_MIN = 30;           // QRIS
const VA_EXPIRY_HOURS = 24;     // bank transfer
const VA_FEE = 5500;            // bank-transfer fee the customer pays on top of the pack price
const QRIS_FEE_PER_MILLE = 7;     // 0.7% QRIS fee the customer pays on top of the pack price (rounded up to whole rupiah)
const BANKS = ['bca', 'bni', 'bri', 'mandiri', 'permata', 'cimb'];
type Admin = ReturnType<typeof createClient>;
type Conf = { key: string; sig: string; mode: 'sandbox' | 'production' };

const base = (c: Conf) => (c.mode === 'production' ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com');
const auth = (c: Conf) => 'Basic ' + btoa(c.key + ':');
const mask = (k: string) => (k.length <= 10 ? '••••' : k.slice(0, 9) + '••••' + k.slice(-4));

async function sha512(s: string) {
  const buf = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

async function conf(admin: Admin): Promise<Conf | null> {
  const { data } = await admin.from('app_secrets').select('key,value').in('key', ['midtrans_server_key', 'midtrans_mode', 'midtrans_signature_key']);
  const m = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const key = String(m.get('midtrans_server_key') ?? '');
  if (!key) return null;
  // New Midtrans dashboards (keys made after Oct 2026) sign notifications with a separate Signature Secret Key.
  return { key, sig: String(m.get('midtrans_signature_key') ?? '') || key, mode: m.get('midtrans_mode') === 'production' ? 'production' : 'sandbox' };
}

async function mt(c: Conf, path: string, init: RequestInit = {}) {
  const res = await fetch(base(c) + path, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: auth(c), ...(init.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { http: res.status, data: data as Record<string, unknown> };
}

const orderIdFor = (id: string) => 'BNW-' + id;
const idFromOrder = (o: string) => (/^BNW-[0-9a-f-]{36}$/i.test(o) ? o.slice(4) : '');

// Apply a Midtrans transaction (from the status API) to our payment row.
async function apply(admin: Admin, tx: Record<string, unknown>) {
  const id = idFromOrder(String(tx.order_id ?? ''));
  if (!id) return 'ignored';
  const st = String(tx.transaction_status ?? '');
  const fraud = String(tx.fraud_status ?? 'accept');
  if (st === 'settlement' || (st === 'capture' && fraud === 'accept')) {
    const { error } = await admin.rpc('midtrans_settle', { p_id: id, p_gross: Number(tx.gross_amount), p_txid: String(tx.transaction_id ?? '') || null });
    if (error) { console.error('settle', id, error.message); return /amount_mismatch/.test(error.message) ? 'mismatch' : 'error'; }
    return 'paid';
  }
  if (st === 'expire' || st === 'cancel' || st === 'deny' || st === 'failure') { await admin.rpc('midtrans_expire', { p_id: id }); return 'expired'; }
  return 'pending';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const admin = createClient(url, service, { auth: { persistSession: false } });
    if (req.method === 'GET') return json({ ok: true, service: 'midtrans' });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    // ---------- notification from Midtrans ----------
    if (!body.action && body.order_id && body.signature_key) {
      const c = await conf(admin);
      if (!c) return json({ error: 'not configured' }, 503);
      const expected = await sha512(String(body.order_id) + String(body.status_code) + String(body.gross_amount) + c.sig);
      if (!safeEqual(expected, String(body.signature_key).toLowerCase())) { console.error('notification signature mismatch', String(body.order_id)); return json({ error: 'invalid signature' }, 401); }
      if (!idFromOrder(String(body.order_id))) return json({ ok: true, ignored: true });   // e.g. Midtrans' own test notification
      // Do not trust the body alone: ask Midtrans for the current state of this transaction.
      const s = await mt(c, `/v2/${encodeURIComponent(String(body.order_id))}/status`);
      if (s.http >= 500) return json({ error: 'status check failed' }, 502);   // Midtrans retries later
      const result = await apply(admin, s.data);
      return json({ ok: true, result });
    }

    // ---------- signed-in user ----------
    const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: u } = await userClient.auth.getUser();
    const user = u?.user;
    if (!user) throw new HttpError(401, 'Silakan login terlebih dahulu.');
    const isAdmin = async () => { const { data } = await admin.from('profiles').select('user_role').eq('id', user.id).maybeSingle(); return data?.user_role === 'admin'; };

    switch (body.action) {
      case 'create': {
        const c = await conf(admin);
        if (!c) throw new HttpError(503, 'Pembayaran otomatis belum aktif. Hubungi admin.');
        // Sandbox QRIS can be "paid" with Midtrans' simulator for free, so only the admin may use it.
        if (c.mode !== 'production' && !(await isAdmin())) throw new HttpError(403, 'Pembayaran otomatis sedang diuji coba. Untuk sementara pakai QRIS manual.');
        const method = body.method === 'va' ? 'va' : 'qris';
        const bank = String(body.bank ?? '').toLowerCase();
        if (method === 'va') {
          if (!BANKS.includes(bank)) throw new HttpError(400, 'Pilih bank untuk Virtual Account.');
        }
        const { data: t, error } = await userClient.rpc('create_topup', { p_package: String(body.package ?? '') });
        if (error) throw new HttpError(400, /too_many_pending/.test(error.message) ? 'Terlalu banyak pembayaran yang belum selesai. Selesaikan atau batalkan dulu.' : /package_not_found/.test(error.message) ? 'Paket tidak ditemukan.' : 'Pembayaran gagal dibuat.');
        const pay = t as { id: string; package: string; nama: string; kredit: number; harga: number };
        const orderId = orderIdFor(pay.id);
        // The fee is decided here on the server and stored before Midtrans can report the payment.
        const fee = method === 'va' ? VA_FEE : Math.ceil((pay.harga * QRIS_FEE_PER_MILLE) / 1000);
        const total = pay.harga + fee;
        if (fee) await admin.from('payments').update({ biaya: fee }).eq('id', pay.id);
        const items = [{ id: pay.package, price: pay.harga, quantity: 1, name: `Kredit BNW Lab ${pay.nama} (${pay.kredit})`.slice(0, 50) }];
        if (fee) items.push({ id: method === 'va' ? 'biaya-transfer' : 'biaya-qris', price: fee, quantity: 1, name: method === 'va' ? 'Biaya transfer bank' : 'Biaya layanan QRIS 0,7%' });
        const common = {
          transaction_details: { order_id: orderId, gross_amount: total },
          item_details: items,
          customer_details: { email: user.email },
        };
        const charge = method === 'qris'
          ? { ...common, payment_type: 'qris', qris: { acquirer: 'gopay' }, custom_expiry: { expiry_duration: EXPIRY_MIN, unit: 'minute' } }
          : bank === 'mandiri'
            ? { ...common, payment_type: 'echannel', echannel: { bill_info1: 'Pembayaran:', bill_info2: 'Kredit BNW Lab' }, custom_expiry: { expiry_duration: VA_EXPIRY_HOURS, unit: 'hour' } }
            : { ...common, payment_type: 'bank_transfer', bank_transfer: { bank }, custom_expiry: { expiry_duration: VA_EXPIRY_HOURS, unit: 'hour' } };
        const r = await mt(c, '/v2/charge', { method: 'POST', body: JSON.stringify(charge) });
        const d = r.data;
        const qr = String(d.qr_string ?? '');
        const vaList = Array.isArray(d.va_numbers) ? d.va_numbers as { bank?: string; va_number?: string }[] : [];
        const vaNumber = String(d.permata_va_number ?? vaList[0]?.va_number ?? d.bill_key ?? '');
        const billerCode = String(d.biller_code ?? '');
        if (method === 'qris' ? !qr : !vaNumber) {
          console.error('charge', method, bank, r.http, d);
          await admin.from('payments').update({ status: 'expired', provider: 'midtrans', pay_method: method, note: left('Gagal membuat pembayaran: ' + String(d.status_message ?? r.http), 300) }).eq('id', pay.id);
          if (r.http === 403 && (await isAdmin())) throw new HttpError(502, 'Midtrans menolak (403): Server Key belum punya izin Core API = Write. Buat key baru dengan izin itu.');
          throw new HttpError(502, method === 'qris' ? 'QRIS gagal dibuat. Coba lagi sebentar atau hubungi admin.' : 'Nomor Virtual Account gagal dibuat. Coba bank lain atau pakai QRIS.');
        }
        const expires = new Date(Date.now() + (method === 'qris' ? EXPIRY_MIN * 60000 : VA_EXPIRY_HOURS * 3600000)).toISOString();
        await admin.from('payments').update({
          provider: 'midtrans', provider_ref: orderId, pay_method: method, expires_at: expires,
          qr_string: method === 'qris' ? qr : null, va_bank: method === 'va' ? bank : null, va_number: method === 'va' ? vaNumber : null, biller_code: billerCode || null,
        }).eq('id', pay.id);
        // Sandbox only: the QR image link that Midtrans' payment simulator asks for.
        const acts = Array.isArray(d.actions) ? d.actions as { name?: string; url?: string }[] : [];
        const qrUrl = c.mode !== 'production' ? String(acts.find((x) => x.name === 'generate-qr-code')?.url ?? acts.find((x) => String(x.name).startsWith('generate-qr-code'))?.url ?? '') : '';
        return json({ id: pay.id, nama: pay.nama, kredit: pay.kredit, harga: pay.harga, biaya: fee, total, method, qr_string: qr, qr_url: qrUrl, bank, va_number: vaNumber, biller_code: billerCode, expires_at: expires, sandbox: c.mode !== 'production' });
      }
      case 'status': {
        const id = String(body.id ?? '');
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'ID pembayaran tidak valid.');
        const { data: p } = await admin.from('payments').select('id,user_id,status,provider,provider_ref').eq('id', id).maybeSingle();
        if (!p || p.user_id !== user.id) throw new HttpError(404, 'Pembayaran tidak ditemukan.');
        if (p.status !== 'pending' || p.provider !== 'midtrans') return json({ status: p.status });
        const c = await conf(admin);
        if (!c) return json({ status: p.status });
        const s = await mt(c, `/v2/${encodeURIComponent(p.provider_ref)}/status`);
        if (s.http === 200 || String(s.data.status_code ?? '').startsWith('2')) {
          const result = await apply(admin, s.data);
          if (result === 'paid' || result === 'expired') return json({ status: result });
        }
        return json({ status: 'pending' });
      }
      case 'config_status': {
        if (!(await isAdmin())) throw new HttpError(403, 'Hanya admin.');
        const c = await conf(admin);
        const { data: sg } = await admin.from('app_secrets').select('value').eq('key', 'midtrans_signature_key').maybeSingle();
        return json({ configured: !!c, mode: c?.mode ?? 'sandbox', masked: c ? mask(c.key) : '', sig: !!sg?.value, webhook: `${url}/functions/v1/midtrans` });
      }
      case 'save_config': {
        if (!(await isAdmin())) throw new HttpError(403, 'Hanya admin.');
        const mode = body.mode === 'production' ? 'production' : 'sandbox';
        const key = String(body.server_key ?? '').trim();
        const rows: { key: string; value: string; updated_at: string }[] = [{ key: 'midtrans_mode', value: mode, updated_at: new Date().toISOString() }];
        if (key) {
          if (key.length < 20 || key.length > 200 || /\s/.test(key)) throw new HttpError(400, 'Format Server Key tidak valid.');
          if (mode === 'production' && key.startsWith('SB-')) throw new HttpError(400, 'Ini Server Key Sandbox. Untuk mode Production pakai Server Key Production.');
          rows.push({ key: 'midtrans_server_key', value: key, updated_at: new Date().toISOString() });
        }
        const sig = String(body.signature_key ?? '').trim();
        if (sig) {
          if (sig.length < 16 || sig.length > 300 || /\s/.test(sig)) throw new HttpError(400, 'Format Signature Secret Key tidak valid.');
          rows.push({ key: 'midtrans_signature_key', value: sig, updated_at: new Date().toISOString() });
        }
        const { error } = await admin.from('app_secrets').upsert(rows);
        if (error) throw new HttpError(500, 'Gagal menyimpan pengaturan.');
        return json({ message: 'Pengaturan Midtrans disimpan.' });
      }
      case 'test': {
        if (!(await isAdmin())) throw new HttpError(403, 'Hanya admin.');
        const c = await conf(admin);
        if (!c) throw new HttpError(400, 'Server Key belum diisi.');
        const s = await mt(c, '/v2/BNW-cek-koneksi/status');
        const code = String(s.data.status_code ?? s.http);
        if (code === '401' || s.http === 401) throw new HttpError(400, 'Server Key ditolak Midtrans. Pastikan key dan mode (Sandbox/Production) sesuai.');
        // An empty charge is rejected by validation (400) when the key may create transactions, or 403 when it may not.
        const w = await mt(c, '/v2/charge', { method: 'POST', body: '{}' });
        if (w.http === 403) throw new HttpError(400, 'Key dikenali, tapi belum boleh membuat transaksi (403). Di Midtrans buat Server Key baru dengan izin Core API = Write.');
        return json({ message: `Terhubung ke Midtrans ${c.mode === 'production' ? 'Production' : 'Sandbox'}.` });
      }
      default:
        throw new HttpError(400, 'Aksi tidak dikenal.');
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('midtrans error', e);
    return json({ error: 'Terjadi kesalahan di server.' }, 500);
  }
});

function left(s: string, n: number) { return s.length > n ? s.slice(0, n) : s; }
