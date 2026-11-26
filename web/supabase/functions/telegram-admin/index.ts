// Edge Function: telegram-admin (admin only)
// Aksi: status | save_token | connect | test | disconnect
// Token bot dan chat id disimpan di app_secrets (hanya service role); tidak pernah dikirim ke browser.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

type Admin = ReturnType<typeof createClient>;
const K = { token: 'telegram_bot_token', chat: 'telegram_chat_id', bot: 'telegram_bot_username', name: 'telegram_chat_name' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: u, error: ue } = await userClient.auth.getUser();
    if (ue || !u?.user) throw new HttpError(401, 'Silakan login terlebih dahulu.');
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: p } = await admin.from('profiles').select('user_role').eq('id', u.user.id).maybeSingle();
    if (p?.user_role !== 'admin') throw new HttpError(403, 'Hanya admin.');

    const body = await req.json().catch(() => ({}));
    switch (body?.action) {
      case 'status': return json(await status(admin));
      case 'save_token': return json(await saveToken(admin, body.token));
      case 'connect': return json(await connect(admin));
      case 'test': return json(await test(admin));
      case 'disconnect': return json(await disconnect(admin));
      default: throw new HttpError(400, 'Aksi tidak dikenal.');
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('telegram-admin', e);
    return json({ error: 'Terjadi kesalahan di server.' }, 500);
  }
});

async function getAll(admin: Admin) {
  const { data } = await admin.from('app_secrets').select('key,value').in('key', Object.values(K));
  const m: Record<string, string> = {};
  for (const r of data ?? []) m[r.key] = r.value;
  return m;
}
async function put(admin: Admin, key: string, value: string | null) {
  if (value === null) { await admin.from('app_secrets').delete().eq('key', key); return; }
  const { error } = await admin.from('app_secrets').upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new HttpError(500, 'Gagal menyimpan pengaturan.');
}
async function tg(token: string, method: string, payload?: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: payload ? 'POST' : 'GET',
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  return await res.json().catch(() => ({ ok: false }));
}

async function status(admin: Admin) {
  const m = await getAll(admin);
  return { has_token: !!m[K.token], bot: m[K.bot] || null, connected: !!m[K.chat], chat_name: m[K.name] || null };
}

async function saveToken(admin: Admin, raw: unknown) {
  const token = String(raw ?? '').trim();
  if (!/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(token)) throw new HttpError(400, 'Format token tidak valid. Salin token lengkap dari @BotFather (contoh 123456789:AAH...).');
  const me = await tg(token, 'getMe');
  if (!me?.ok) throw new HttpError(400, 'Token ditolak Telegram. Periksa lagi token dari @BotFather.');
  await tg(token, 'deleteWebhook');
  await put(admin, K.token, token);
  await put(admin, K.bot, String(me.result?.username ?? ''));
  await put(admin, K.chat, null); await put(admin, K.name, null);
  return { message: `Bot @${me.result?.username} tersimpan. Sekarang kirim pesan apa saja ke bot itu di Telegram, lalu klik "Sambungkan".`, bot: me.result?.username };
}

async function connect(admin: Admin) {
  const m = await getAll(admin);
  if (!m[K.token]) throw new HttpError(400, 'Simpan token bot dulu.');
  const up = await tg(m[K.token], 'getUpdates', { limit: 100, allowed_updates: ['message'] });
  if (!up?.ok) throw new HttpError(502, 'Tidak bisa membaca pesan bot dari Telegram.');
  const msgs = (up.result ?? []).map((x: any) => x.message).filter((x: any) => x?.chat?.type === 'private');
  const last = msgs[msgs.length - 1];
  if (!last) throw new HttpError(404, `Belum ada pesan ke bot @${m[K.bot]}. Buka bot itu di Telegram, tekan Start atau kirim "halo", lalu klik Sambungkan lagi.`);
  const chat = last.chat;
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id);
  await put(admin, K.chat, String(chat.id));
  await put(admin, K.name, name);
  await tg(m[K.token], 'sendMessage', { chat_id: chat.id, text: '✅ Tersambung dengan BNW Lab. Notifikasi pembayaran akan dikirim ke chat ini.' });
  return { message: `Tersambung ke ${name}.`, chat_name: name };
}

async function test(admin: Admin) {
  const m = await getAll(admin);
  if (!m[K.token] || !m[K.chat]) throw new HttpError(400, 'Bot belum tersambung.');
  const r = await tg(m[K.token], 'sendMessage', {
    chat_id: m[K.chat], parse_mode: 'HTML',
    text: '🔔 <b>Tes notifikasi BNW Lab</b>\nKalau pesan ini masuk, notifikasi pembayaran sudah berfungsi.',
    reply_markup: { inline_keyboard: [[{ text: 'Buka menu Pembayaran', url: 'https://bnwlab.com/#admin/pembayaran' }]] },
  });
  if (!r?.ok) throw new HttpError(502, 'Pesan tes gagal dikirim. Pastikan Anda belum memblokir bot.');
  return { message: 'Pesan tes terkirim. Cek Telegram Anda.' };
}

async function disconnect(admin: Admin) {
  for (const k of Object.values(K)) await put(admin, k, null);
  return { message: 'Notifikasi Telegram dimatikan.' };
}
