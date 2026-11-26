// Edge Function: bigjpg-upscale
// Aksi: costs | config_status | save_config | start | status
// API key BigJPG TIDAK pernah dikirim ke browser. Prioritas: secret env BIGJPG_API_KEY, lalu tabel app_secrets.
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
  valid_api_key_required: 'API key BigJPG tidak valid. Periksa pengaturan API key.',
  requires_vip: 'Akun BigJPG belum berlangganan (API BigJPG khusus member berbayar, 8x/16x khusus VIP).',
  month_limit: 'Kuota panggilan API BigJPG bulan ini habis.',
  param_error: 'Parameter ditolak BigJPG (periksa scale/style/noise).',
  input_url_error: 'BigJPG tidak dapat mengakses gambar. Coba unggah ulang.',
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

async function getApiKey(admin: Admin): Promise<{ key: string; source: 'env' | 'db' } | null> {
  const env = Deno.env.get('BIGJPG_API_KEY');
  if (env) return { key: env, source: 'env' };
  const { data } = await admin.from('app_secrets').select('value').eq('key', 'bigjpg_api_key').maybeSingle();
  return data?.value ? { key: data.value, source: 'db' } : null;
}

const mask = (k: string) => (k.length <= 8 ? '••••' : k.slice(0, 4) + '••••' + k.slice(-4));

async function configStatus(admin: Admin, userId: string) {
  const found = await getApiKey(admin);
  const out: Record<string, unknown> = { configured: !!found };
  if (found && (await isAdmin(admin, userId))) out.masked_key = mask(found.key) + (found.source === 'env' ? ' (secret server)' : '');
  return out;
}

async function saveConfig(admin: Admin, userId: string, body: { api_key?: string }) {
  if (!(await isAdmin(admin, userId))) throw new HttpError(403, 'Hanya admin yang dapat mengubah API key.');
  const key = String(body.api_key ?? '').trim();
  if (key.length < 8 || key.length > 200 || /\s/.test(key)) throw new HttpError(400, 'Format API key tidak valid.');
  const { error } = await admin.from('app_secrets').upsert({ key: 'bigjpg_api_key', value: key, updated_at: new Date().toISOString() });
  if (error) throw new HttpError(500, 'Gagal menyimpan API key.');
  const envNote = Deno.env.get('BIGJPG_API_KEY') ? ' Catatan: secret server BIGJPG_API_KEY tetap diprioritaskan.' : '';
  return { message: 'API key BigJPG berhasil disimpan.' + envNote };
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

  const apiKey = await getApiKey(admin);
  if (!apiKey) throw new HttpError(503, 'Layanan Upscale belum dikonfigurasi (API key BigJPG belum diisi).');

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
  try {
    const res = await fetch(`${BIGJPG}/api/task/`, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        style, noise: String(noise), x2: X2[scale], input: signed.signedUrl,
        file_name: fileName.replace(/\.[^.]+$/, '') + '.png',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data?.tid) {
      const code = String(data?.status ?? '');
      throw new HttpError(502, BIGJPG_ERRORS[code] ?? `BigJPG menolak permintaan${code ? ` (${code})` : ''}.`);
    }
    tid = String(data.tid);
  } catch (e) {
    await refund(admin, userId, historyId, scale);
    await removeInput(admin, storagePath);
    if (e instanceof HttpError) throw e;
    console.error('bigjpg create', e);
    throw new HttpError(502, 'Tidak dapat menghubungi BigJPG. Kredit dikembalikan, coba lagi.');
  }

  await admin.from('riwayat_bigjpg').update({
    bigjpg_tid: tid, storage_path: storagePath, task_id: tid, status: 'processing',
    updated_at: new Date().toISOString(),
  }).eq('id', historyId);

  return { task_id: tid, balance: spend.data };
}

// ---------- status ----------
async function status(admin: Admin, userId: string, b: Record<string, unknown>) {
  const historyId = String(b.history_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(historyId)) throw new HttpError(400, 'ID riwayat tidak valid.');
  const { data: row } = await admin.from('riwayat_bigjpg')
    .select('id,user_id,scale,bigjpg_tid,storage_path,status,result_url').eq('id', historyId).maybeSingle();
  if (!row || row.user_id !== userId) throw new HttpError(404, 'Riwayat tidak ditemukan.');
  if (!row.bigjpg_tid) throw new HttpError(400, 'Tugas belum dimulai.');
  if (row.status === 'completed' && row.result_url) return { status: 'completed', result_url: row.result_url };

  const apiKey = await getApiKey(admin);
  if (!apiKey) throw new HttpError(503, 'API key BigJPG belum dikonfigurasi.');

  const res = await fetch(`${BIGJPG}/api/task/${encodeURIComponent(row.bigjpg_tid)}`, { headers: { 'X-API-KEY': apiKey.key } });
  const data = await res.json().catch(() => null);
  const task = data?.[row.bigjpg_tid] ?? data;
  const st = String(task?.status ?? '');

  if (st === 'success') {
    const resultUrl = String(task?.url ?? '');
    if (!/^https:\/\//i.test(resultUrl)) throw new HttpError(502, 'BigJPG tidak mengembalikan URL hasil.');
    await admin.from('riwayat_bigjpg').update({
      status: 'completed', result_url: resultUrl, error_message: null,
      completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', historyId);
    await removeInput(admin, row.storage_path);
    return { status: 'completed', result_url: resultUrl };
  }
  if (st === 'error') {
    const message = 'BigJPG gagal memproses gambar. Kredit dikembalikan.';
    await refund(admin, userId, historyId, Number(row.scale));
    await admin.from('riwayat_bigjpg').update({ status: 'failed', error_message: message, updated_at: new Date().toISOString() }).eq('id', historyId);
    await removeInput(admin, row.storage_path);
    return { status: 'failed', error_message: message };
  }
  if (st === 'new' || st === 'process') return { status: 'processing' };
  const known = BIGJPG_ERRORS[String(data?.status ?? '')];
  if (known) throw new HttpError(502, known);
  return { status: 'processing' };
}
