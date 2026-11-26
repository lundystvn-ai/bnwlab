// Edge Function: bigjpg-upscale
// Aksi: costs | config_status | save_config | start | status | download | list_keys | add_key | update_key | remove_key
// API key BigJPG TIDAK pernah dikirim ke browser. Beberapa akun BigJPG berbayar dipakai bergantian (tabel bigjpg_keys);
// kalau satu akun kena kuota bulanan (month_limit), otomatis pindah ke akun berikutnya.
import { createClient } from 'npm:@supabase/supabase-js@2';

const BIGJPG = 'https://bigjpg.com';
const BUCKET = 'bigjpg-inputs';
// Biaya kredit per upscale (semua skala 1 kredit). SESUAIKAN dengan biaya BigJPG Anda agar harga jual tidak rugi.
const COST: Record<number, number> = { 2: 1, 4: 1, 8: 1, 16: 1 };
const X2: Record<number, string> = { 2: '1', 4: '2', 8: '3', 16: '4' };
const STYLES = ['art', 'photo'];
const FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const BIGJPG_ERRORS: Record<string, string> = {
  valid_api_key_required: 'Layanan upscale sedang bermasalah. Kredit dikembalikan, hubungi admin.',
  requires_vip: 'Skala ini belum tersedia. Kredit dikembalikan, coba 2× atau 4×.',
  month_limit: 'Kuota upscale bulan ini sudah habis. Kredit dikembalikan, hubungi admin.',
  param_error: 'Pengaturan upscale tidak valid. Kredit dikembalikan, coba lagi.',
  input_url_error: 'Gambar tidak dapat dibaca server. Kredit dikembalikan, coba unggah ulang.',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) throw new HttpError(401, 'Silakan login terlebih dahulu.');
    const user = userData.user;
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({}));
    switch (body?.action) {
      case 'costs':
        return json({ costs: COST });
      case 'config_status':
        return json(await configStatus(admin, user.id));
      case 'save_config':
        return json(await saveConfig(admin, user.id, body));
      case 'start':
        return json(await start(admin, user.id, body));
      case 'status':
        return json(await status(admin, user.id, body));
      case 'download':
        return await downloadResult(admin, user.id, body);
      case 'list_keys':
        await requireAdmin(admin, user.id); return json(await listKeysForAdmin(admin));
      case 'add_key':
        await requireAdmin(admin, user.id); return json(await addKey(admin, body));
      case 'update_key':
        await requireAdmin(admin, user.id); return json(await updateKey(admin, body));
      case 'remove_key':
        await requireAdmin(admin, user.id); return json(await removeKey(admin, body));
      default:
        throw new HttpError(400, 'Aksi tidak dikenal.');
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('bigjpg-upscale error', e);
    return json({ error: 'Terjadi kesalahan di server.' }, 500);
  }
});

// ---------- helper ----------
type Admin = ReturnType<typeof createClient>;

async function isAdmin(admin: Admin, userId: string) {
  const { data } = await admin.from('profiles').select('user_role').eq('id', userId).maybeSingle();
  return data?.user_role === 'admin';
}

type PoolKey = { id: string | null; label: string; key: string; quota: number; active: boolean; exhausted_month: string | null; sort: number };

const monthKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const monthStart = () => `${monthKey()}-01T00:00:00+07:00`;

async function requireAdmin(admin: Admin, userId: string) {
  if (!(await isAdmin(admin, userId))) throw new HttpError(403, 'Hanya admin.');
}

// All accounts: the pool table, plus the server secret / legacy single key as a fallback.
async function allKeys(admin: Admin): Promise<PoolKey[]> {
  const out: PoolKey[] = [];
  const { data } = await admin.from('bigjpg_keys').select('id,label,api_key,monthly_quota,active,exhausted_month,sort').order('sort').order('created_at');
  for (const r of data ?? []) out.push({ id: r.id, label: r.label, key: r.api_key, quota: r.monthly_quota, active: r.active, exhausted_month: r.exhausted_month, sort: r.sort });
  const env = Deno.env.get('BIGJPG_API_KEY');
  if (env && !out.some((k) => k.key === env)) out.push({ id: null, label: 'Secret server', key: env, quota: 2000, active: true, exhausted_month: null, sort: 999 });
  if (!out.length) {
    const { data: s } = await admin.from('app_secrets').select('value').eq('key', 'bigjpg_api_key').maybeSingle();
    if (s?.value) out.push({ id: null, label: 'Akun utama', key: s.value, quota: 2000, active: true, exhausted_month: null, sort: 0 });
  }
  return out;
}

// Upscales started this month per account (rows that reached BigJPG).
async function usageThisMonth(admin: Admin): Promise<Map<string, number>> {
  const used = new Map<string, number>();
  const { data } = await admin.from('riwayat_bigjpg').select('key_id').not('bigjpg_tid', 'is', null).gte('created_at', monthStart()).limit(100000);
  for (const r of data ?? []) { const k = r.key_id ?? 'null'; used.set(k, (used.get(k) ?? 0) + 1); }
  return used;
}

async function usableKeys(admin: Admin): Promise<PoolKey[]> {
  const [keys, used] = await Promise.all([allKeys(admin), usageThisMonth(admin)]);
  const m = monthKey();
  return keys.filter((k) => k.active && k.exhausted_month !== m && (used.get(k.id ?? 'null') ?? 0) < k.quota);
}

async function getApiKey(admin: Admin): Promise<{ key: string; source: 'env' | 'db' } | null> {
  const k = (await usableKeys(admin))[0] ?? (await allKeys(admin))[0];
  return k ? { key: k.key, source: k.label === 'Secret server' ? 'env' : 'db' } : null;
}

async function markExhausted(admin: Admin, k: PoolKey) {
  if (k.id) await admin.from('bigjpg_keys').update({ exhausted_month: monthKey(), updated_at: new Date().toISOString() }).eq('id', k.id);
}

async function listKeysForAdmin(admin: Admin) {
  const [keys, used] = await Promise.all([allKeys(admin), usageThisMonth(admin)]);
  const m = monthKey();
  const rows = keys.map((k) => {
    const u = used.get(k.id ?? 'null') ?? 0;
    return { id: k.id, label: k.label, masked: mask(k.key), monthly_quota: k.quota, active: k.active, used: u,
      exhausted: k.exhausted_month === m || u >= k.quota, editable: !!k.id };
  });
  const usable = rows.filter((r) => r.active && !r.exhausted);
  return { month: m, keys: rows,
    total_quota: usable.reduce((a, r) => a + r.monthly_quota, 0) + rows.filter((r) => r.active && r.exhausted).reduce((a, r) => a + r.monthly_quota, 0),
    total_used: rows.filter((r) => r.active).reduce((a, r) => a + Math.min(r.used, r.monthly_quota), 0),
    remaining: usable.reduce((a, r) => a + Math.max(0, r.monthly_quota - r.used), 0) };
}

const cleanKey = (v: unknown) => {
  const key = String(v ?? '').trim();
  if (key.length < 8 || key.length > 200 || /\s/.test(key)) throw new HttpError(400, 'Format API key tidak valid.');
  return key;
};
const cleanQuota = (v: unknown) => {
  const q = Math.round(Number(v ?? 2000));
  if (!Number.isFinite(q) || q < 1 || q > 1000000) throw new HttpError(400, 'Kuota per bulan tidak valid.');
  return q;
};

async function addKey(admin: Admin, b: Record<string, unknown>) {
  const key = cleanKey(b.api_key);
  const label = String(b.label ?? '').trim().slice(0, 60) || 'Akun BigJPG';
  const { count } = await admin.from('bigjpg_keys').select('id', { count: 'exact', head: true });
  const { error } = await admin.from('bigjpg_keys').insert({ label, api_key: key, monthly_quota: cleanQuota(b.monthly_quota), sort: count ?? 0 });
  if (error) throw new HttpError(400, /duplicate/i.test(error.message) ? 'API key ini sudah ada di daftar.' : 'Gagal menyimpan API key.');
  return { message: `${label} ditambahkan.` };
}

async function updateKey(admin: Admin, b: Record<string, unknown>) {
  const id = String(b.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'ID akun tidak valid.');
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (b.label !== undefined) patch.label = String(b.label).trim().slice(0, 60) || 'Akun BigJPG';
  if (b.monthly_quota !== undefined) patch.monthly_quota = cleanQuota(b.monthly_quota);
  if (b.active !== undefined) patch.active = !!b.active;
  if (b.reset_exhausted) patch.exhausted_month = null;
  const { error } = await admin.from('bigjpg_keys').update(patch).eq('id', id);
  if (error) throw new HttpError(400, 'Gagal mengubah akun.');
  return { message: 'Akun diperbarui.' };
}

async function removeKey(admin: Admin, b: Record<string, unknown>) {
  const id = String(b.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'ID akun tidak valid.');
  const { error } = await admin.from('bigjpg_keys').delete().eq('id', id);
  if (error) throw new HttpError(400, 'Gagal menghapus akun.');
  return { message: 'Akun dihapus.' };
}

const mask = (k: string) => (k.length <= 8 ? '••••' : k.slice(0, 4) + '••••' + k.slice(-4));

async function configStatus(admin: Admin, userId: string) {
  const usable = await usableKeys(admin);
  const out: Record<string, unknown> = { configured: usable.length > 0 };
  if (await isAdmin(admin, userId)) {
    const all = await allKeys(admin);
    out.accounts = all.length; out.usable = usable.length;
    if (usable[0]) out.masked_key = mask(usable[0].key);
  }
  return out;
}

async function saveConfig(admin: Admin, userId: string, body: { api_key?: string }) {
  if (!(await isAdmin(admin, userId))) throw new HttpError(403, 'Hanya admin yang dapat mengubah API key.');
  const key = String(body.api_key ?? '').trim();
  if (key.length < 8 || key.length > 200 || /\s/.test(key)) throw new HttpError(400, 'Format API key tidak valid.');
  const { error } = await admin.from('app_secrets').upsert({ key: 'bigjpg_api_key', value: key, updated_at: new Date().toISOString() });
  if (error) throw new HttpError(500, 'Gagal menyimpan API key.');
  await admin.from('bigjpg_keys').insert({ label: 'Akun BigJPG', api_key: key }).then(() => {}, () => {});
  return { message: 'API key BigJPG berhasil disimpan.' };
}

// Refund exactly what was charged for this job (also correct for jobs started before a price change).
async function refund(admin: Admin, userId: string, historyId: string, scale: number) {
  const { data: spent } = await admin.from('credit_ledger').select('delta').eq('ref', `upscale:${historyId}`).maybeSingle();
  const amount = spent?.delta ? Math.abs(Number(spent.delta)) : (COST[scale] ?? 0);
  if (!amount) return;
  await admin.rpc('grant_credits', {
    p_user: userId, p_amount: amount, p_reason: 'upscale_refund', p_ref: `upscale-refund:${historyId}`,
  });
}

async function removeInput(admin: Admin, path?: string | null) {
  if (path) await admin.storage.from(BUCKET).remove([path]).catch(() => {});
}

// ---------- start ----------
async function start(admin: Admin, userId: string, b: Record<string, unknown>) {
  const scale = Number(b.scale);
  const style = String(b.style ?? 'art');
  const noise = Number(b.noise ?? 0);
  const historyId = String(b.history_id ?? '');
  const storagePath = String(b.storage_path ?? '');
  const fileType = String(b.file_type ?? '');
  const fileName = String(b.file_name ?? 'gambar.png').slice(0, 120);

  if (!(scale in COST)) throw new HttpError(400, 'Scale tidak valid (2x, 4x, 8x, atau 16x).');
  if (!STYLES.includes(style)) throw new HttpError(400, 'Style tidak valid.');
  if (![-1, 0, 1, 2, 3].includes(noise)) throw new HttpError(400, 'Noise tidak valid.');
  if (!FILE_TYPES.includes(fileType)) throw new HttpError(400, 'Format gambar harus PNG, JPG, atau WebP.');
  if (!storagePath.startsWith(userId + '/') || storagePath.includes('..')) throw new HttpError(400, 'Lokasi file tidak valid.');
  if (!/^[0-9a-f-]{36}$/i.test(historyId)) throw new HttpError(400, 'ID riwayat tidak valid.');

  const { data: row } = await admin.from('riwayat_bigjpg').select('id,user_id,bigjpg_tid').eq('id', historyId).maybeSingle();
  if (!row || row.user_id !== userId) throw new HttpError(404, 'Riwayat tidak ditemukan.');
  if (row.bigjpg_tid) throw new HttpError(409, 'Riwayat ini sudah diproses.');

  const candidates = await usableKeys(admin);
  if (!candidates.length) {
    const any = (await allKeys(admin)).length;
    throw new HttpError(503, any ? 'Kuota upscale bulan ini sudah habis. Coba lagi bulan depan atau hubungi admin.' : 'Layanan upscale belum aktif. Hubungi admin.');
  }

  const { data: signed, error: signErr } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
  if (signErr || !signed?.signedUrl) throw new HttpError(400, 'Gambar tidak ditemukan di penyimpanan. Coba unggah ulang.');

  const spend = await admin.rpc('spend_credits', {
    p_user: userId, p_amount: COST[scale], p_reason: `upscale_${scale}x`, p_ref: `upscale:${historyId}`,
  });
  if (spend.error) {
    if (String(spend.error.message).includes('insufficient_credits')) {
      throw new HttpError(402, `Kredit tidak cukup. Upscale ${scale}x membutuhkan ${COST[scale]} kredit.`);
    }
    console.error('spend_credits', spend.error);
    throw new HttpError(500, 'Gagal memotong kredit.');
  }

  let tid = '';
  let usedKey: PoolKey | null = null;
  try {
    for (const k of candidates) {
      const res = await fetch(`${BIGJPG}/api/task/`, {
        method: 'POST',
        headers: { 'X-API-KEY': k.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          style, noise: String(noise), x2: X2[scale], input: signed.signedUrl,
          file_name: fileName.replace(/\.[^.]+$/, '') + '.png',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.tid) { tid = String(data.tid); usedKey = k; break; }
      const code = String(data?.status ?? '');
      if (code === 'month_limit') { await markExhausted(admin, k); continue; }   // this account is used up: try the next one
      throw new HttpError(502, BIGJPG_ERRORS[code] ?? `Upscale ditolak server${code ? ` (${code})` : ''}. Kredit dikembalikan.`);
    }
    if (!tid) throw new HttpError(503, 'Kuota upscale bulan ini sudah habis di semua akun. Kredit dikembalikan.');
  } catch (e) {
    await refund(admin, userId, historyId, scale);
    await removeInput(admin, storagePath);
    if (e instanceof HttpError) throw e;
    console.error('bigjpg create', e);
    throw new HttpError(502, 'Server upscale tidak dapat dihubungi. Kredit dikembalikan, coba lagi.');
  }

  await admin.from('riwayat_bigjpg').update({
    bigjpg_tid: tid, storage_path: storagePath, task_id: tid, status: 'processing', key_id: usedKey?.id ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', historyId);

  return { task_id: tid, balance: spend.data };
}

// ---------- download: stream a finished result back to the page (used by Cek Gambar) ----------
async function downloadResult(admin: Admin, userId: string, b: Record<string, unknown>) {
  const historyId = String(b.history_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(historyId)) throw new HttpError(400, 'ID riwayat tidak valid.');
  const { data: row } = await admin.from('riwayat_bigjpg').select('user_id,status,result_url').eq('id', historyId).maybeSingle();
  if (!row || row.user_id !== userId) throw new HttpError(404, 'Riwayat tidak ditemukan.');
  if (row.status !== 'completed' || !/^https:\/\//i.test(String(row.result_url ?? ''))) throw new HttpError(409, 'Hasil upscale belum siap.');
  const res = await fetch(String(row.result_url));
  if (!res.ok || !res.body) throw new HttpError(502, 'Hasil upscale tidak bisa diambil. Coba lagi sebentar.');
  return new Response(res.body, { headers: { ...CORS, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } });
}

// ---------- status ----------
async function status(admin: Admin, userId: string, b: Record<string, unknown>) {
  const historyId = String(b.history_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(historyId)) throw new HttpError(400, 'ID riwayat tidak valid.');
  const { data: row } = await admin.from('riwayat_bigjpg')
    .select('id,user_id,scale,bigjpg_tid,storage_path,status,result_url,key_id').eq('id', historyId).maybeSingle();
  if (!row || row.user_id !== userId) throw new HttpError(404, 'Riwayat tidak ditemukan.');
  if (!row.bigjpg_tid) throw new HttpError(400, 'Tugas belum dimulai.');
  if (row.status === 'completed' && row.result_url) return { status: 'completed', result_url: row.result_url };

  const keys = await allKeys(admin);
  const apiKey = (row.key_id && keys.find((k) => k.id === row.key_id)) || keys.find((k) => k.id === null) || keys[0];
  if (!apiKey) throw new HttpError(503, 'Layanan upscale belum aktif. Hubungi admin.');

  const res = await fetch(`${BIGJPG}/api/task/${encodeURIComponent(row.bigjpg_tid)}`, { headers: { 'X-API-KEY': apiKey.key } });
  const data = await res.json().catch(() => null);
  const task = data?.[row.bigjpg_tid] ?? data;
  const st = String(task?.status ?? '');

  if (st === 'success') {
    const resultUrl = String(task?.url ?? '');
    if (!/^https:\/\//i.test(resultUrl)) throw new HttpError(502, 'Server tidak mengembalikan hasil. Coba cek lagi sebentar.');
    await admin.from('riwayat_bigjpg').update({
      status: 'completed', result_url: resultUrl, error_message: null,
      completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', historyId);
    await removeInput(admin, row.storage_path);
    return { status: 'completed', result_url: resultUrl };
  }
  if (st === 'error') {
    const message = 'Gambar gagal diproses. Kredit dikembalikan.';
    await refund(admin, userId, historyId, Number(row.scale));
    await admin.from('riwayat_bigjpg').update({ status: 'failed', error_message: message, updated_at: new Date().toISOString() }).eq('id', historyId);
    await removeInput(admin, row.storage_path);
    return { status: 'failed', error_message: message };
  }
  if (st === 'new' || st === 'process') return { status: 'processing' };
  if (BIGJPG_ERRORS[String(data?.status ?? '')]) throw new HttpError(502, 'Status belum bisa dicek. Coba lagi sebentar.');
  return { status: 'processing' };
}
