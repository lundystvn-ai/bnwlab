// Edge Function: ai-redraw — "Gambar ulang AI".
// Customer: info (prices, on/off), generate (new image or revision).
// Admin: config_status, save_config, test, set_enabled.
// Credits are taken before the AI runs and given back automatically when it fails.
// API keys live in app_secrets and never leave the server.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

type Size = '2K' | '4K';
type Prices = { cost: Record<Size, number>; revise: Record<Size, number> };
// Default prices in credits; the admin can change them (stored in app_settings 'ai_prices', public so pages can show them).
const DEFAULT_PRICES: Prices = { cost: { '2K': 20, '4K': 30 }, revise: { '2K': 6, '4K': 8 } };
const MAX_REVISIONS = 3;
const HOURLY_LIMIT = 40;            // per account
const DEFAULT_DAILY_CAP = 300;      // whole site, protects the prepaid AI balance
const TIMEOUT_MS = 115_000;         // stays under the 150 s edge limit so a refund always happens
const MAX_INPUT_CHARS = 9_000_000;  // ~6.7 MB image as base64
const DEFAULT_MODEL = { google: 'gemini-3.1-flash-image', openrouter: 'google/gemini-3.1-flash-image-preview' };
const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const STYLES = ['tajam', 'rapikan', 'flat'] as const;
// Customers pick adjustments from a fixed list (no free text), so every prompt stays predictable.
const FIXES: Record<string, string> = {
  teks: 'Make every piece of text sharp and clearly readable, with exactly the same words and spelling.',
  tebal: 'Make the outlines and lines noticeably thicker and bolder.',
  tipis: 'Make the outlines and lines thinner and finer.',
  cerah: 'Make the colours brighter and more saturated, while keeping the same hues.',
  asli: 'Stay closer to the original: keep the shapes, proportions and details exactly as in the source image.',
  detail: 'Bring back more fine detail inside the design.',
  simpel: 'Simplify the design: fewer tiny details, cleaner and smoother shapes.',
  bersih: 'Remove stray specks, dust, noise and leftover fragments around the design.',
};
const MAX_FIXES = 3;
type Style = typeof STYLES[number];
type Provider = 'google' | 'openrouter';
type Admin = ReturnType<typeof createClient>;
type Conf = { provider: Provider; key: string; model: string; googleKey: string; orKey: string; googleModel: string; orModel: string; dailyCap: number };

const mask = (k: string) => (k.length <= 10 ? '••••' : k.slice(0, 6) + '••••' + k.slice(-4));

async function conf(admin: Admin): Promise<Conf> {
  const { data } = await admin.from('app_secrets').select('key,value').like('key', 'ai_%');
  const m = new Map<string, string>((data ?? []).map((r: { key: string; value: string }) => [r.key, String(r.value ?? '')] as [string, string]));
  const provider: Provider = m.get('ai_provider') === 'openrouter' ? 'openrouter' : 'google';
  const googleKey = m.get('ai_google_key') || '', orKey = m.get('ai_openrouter_key') || '';
  const googleModel = m.get('ai_google_model') || DEFAULT_MODEL.google, orModel = m.get('ai_openrouter_model') || DEFAULT_MODEL.openrouter;
  const cap = Number(m.get('ai_daily_cap'));
  return {
    provider, googleKey, orKey, googleModel, orModel,
    key: provider === 'google' ? googleKey : orKey,
    model: provider === 'google' ? googleModel : orModel,
    dailyCap: Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_DAILY_CAP,
  };
}
async function enabled(admin: Admin) {
  const { data } = await admin.from('app_settings').select('value').eq('key', 'ai_enabled').maybeSingle();
  return data?.value === '1';
}
async function prices(admin: Admin): Promise<Prices> {
  const { data } = await admin.from('app_settings').select('value').eq('key', 'ai_prices').maybeSingle();
  try {
    const p = JSON.parse(data?.value ?? '');
    const ok = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 100;
    if (ok(p.cost['2K']) && ok(p.cost['4K']) && ok(p.revise['2K']) && ok(p.revise['4K'])) return p;
  } catch { /* defaults */ }
  return DEFAULT_PRICES;
}
async function noteError(admin: Admin, msg: string) {
  await admin.from('app_secrets').upsert({ key: 'ai_last_error', value: new Date().toISOString() + ' ' + msg.slice(0, 400), updated_at: new Date().toISOString() });
}

function ratioFor(w: number, h: number) {
  if (!(w > 0 && h > 0)) return '1:1';
  const r = Math.log(w / h);
  let best = '1:1', d = Infinity;
  for (const s of RATIOS) { const [a, b] = s.split(':').map(Number); const x = Math.abs(Math.log(a / b) - r); if (x < d) { d = x; best = s; } }
  return best;
}

function prompt(style: Style, chroma: 'green' | 'magenta' | 'none', note: string, revision: boolean) {
  const bg = chroma === 'none'
    ? 'Keep the original background.'
    : `Put the design on a perfectly flat, uniform pure ${chroma} background (${chroma === 'green' ? '#00FF00' : '#FF00FF'}) that fills the whole canvas: no shadows, gradients, texture, border or frame. Do not use that ${chroma} colour anywhere inside the design itself.`;
  if (revision) {
    return [
      'Edit this artwork. Change only what the request below asks for and keep everything else exactly the same: composition, subject, text, colours and line style.',
      chroma === 'none' ? 'Keep the background as it is.' : `Keep the background flat pure ${chroma} (${chroma === 'green' ? '#00FF00' : '#FF00FF'}).`,
      `Requested changes: ${note || 'make the lines cleaner and sharper'}`,
      'Return only the edited image.',
    ].join('\n');
  }
  const base = {
    tajam: 'Redraw this artwork as a clean, sharp, high-resolution illustration ready for DTF garment printing. Keep the exact same composition, subject, pose, text and colours. Remove blur, noise, JPEG artifacts and pixelation; make edges and lines crisp.',
    rapikan: 'Restore this image with minimal changes so it is ready for DTF garment printing. Remove compression artifacts, noise and blur, and sharpen soft edges, but keep the original style, shading, details and colours faithful to the source.',
    flat: 'Redraw this artwork as flat, vector-style art for DTF garment printing: solid colour areas, clean even outlines, a limited colour palette, no gradients, noise or photographic texture. Keep the same composition, subject and text.',
  }[style];
  return [
    base,
    'Any text must keep exactly the same words and spelling, rendered sharply in the same lettering style. Do not add, remove or move any element. Do not add a watermark, signature, mockup or t-shirt.',
    bg,
    note ? `Also: ${note}` : '',
    'Return only the image.',
  ].filter(Boolean).join('\n');
}

// Width/height from the start of a base64 PNG or JPEG.
function imageSize(b64: string): { w: number; h: number } {
  try {
    const bin = atob(b64.slice(0, 180_000).replace(/[^A-Za-z0-9+/]/g, '').slice(0, 179_996));
    const u = (i: number) => bin.charCodeAt(i);
    if (u(0) === 0x89 && bin.slice(1, 4) === 'PNG') return { w: (u(16) << 24 | u(17) << 16 | u(18) << 8 | u(19)) >>> 0, h: (u(20) << 24 | u(21) << 16 | u(22) << 8 | u(23)) >>> 0 };
    if (u(0) === 0xff && u(1) === 0xd8) {
      let i = 2;
      while (i + 9 < bin.length) {
        if (u(i) !== 0xff) { i++; continue; }
        const m = u(i + 1), len = u(i + 2) << 8 | u(i + 3);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u(i + 7) << 8 | u(i + 8), h: u(i + 5) << 8 | u(i + 6) };
        i += 2 + len;
      }
    }
  } catch { /* unknown */ }
  return { w: 0, h: 0 };
}

type Out = { data: string; mime: string } | { refused: string } | { fail: string; admin?: string };

async function callGoogle(c: Conf, text: string, img: { mime: string; data: string }, ratio: string, size: Size, signal: AbortSignal): Promise<Out> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text }, { inlineData: { mimeType: img.mime, data: img.data } }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: ratio, imageSize: size } },
    }),
  });
  const d = await res.json().catch(() => ({})) as Record<string, any>;
  if (!res.ok) {
    const msg = String(d?.error?.message ?? res.status);
    return { fail: res.status === 429 ? 'busy' : 'provider', admin: `Google ${res.status}: ${msg}` };
  }
  const block = d?.promptFeedback?.blockReason;
  if (block) return { refused: String(block) };
  const cand = d?.candidates?.[0];
  const part = (cand?.content?.parts ?? []).find((p: any) => p?.inlineData?.data || p?.inline_data?.data);
  const inline = part?.inlineData ?? part?.inline_data;
  if (inline?.data) return { data: String(inline.data), mime: String(inline.mimeType ?? inline.mime_type ?? 'image/png') };
  const reason = String(cand?.finishReason ?? '');
  if (/SAFETY|PROHIBITED|BLOCK|RECITATION|IMAGE_/.test(reason)) return { refused: reason };
  return { fail: 'empty', admin: `Google: tidak ada gambar (finishReason ${reason || '-'})` };
}

async function callOpenRouter(c: Conf, text: string, img: { mime: string; data: string }, ratio: string, size: Size, signal: AbortSignal): Promise<Out> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key, 'HTTP-Referer': 'https://bnwlab.com', 'X-Title': 'BNW Design Lab' },
    body: JSON.stringify({
      model: c.model,
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: ratio, image_size: size },
      messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } }] }],
    }),
  });
  const d = await res.json().catch(() => ({})) as Record<string, any>;
  if (!res.ok || d?.error) {
    const msg = String(d?.error?.message ?? res.status);
    return { fail: res.status === 429 ? 'busy' : res.status === 402 ? 'balance' : 'provider', admin: `OpenRouter ${res.status}: ${msg}` };
  }
  const msg = d?.choices?.[0]?.message;
  const url = String(msg?.images?.[0]?.image_url?.url ?? msg?.images?.[0]?.url ?? '');
  const m = /^data:([^;]+);base64,(.+)$/s.exec(url);
  if (m) return { data: m[2], mime: m[1] };
  const reason = String(d?.choices?.[0]?.finish_reason ?? d?.choices?.[0]?.native_finish_reason ?? '');
  if (/SAFETY|PROHIBITED|content_filter|IMAGE_/i.test(reason)) return { refused: reason };
  return { fail: 'empty', admin: `OpenRouter: tidak ada gambar (${reason || '-'})` };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    if (body.action === 'info') { const pr = await prices(admin); return json({ enabled: await enabled(admin), cost: pr.cost, revise: pr.revise, max_revisions: MAX_REVISIONS }); }

    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: u } = await userClient.auth.getUser();
    const user = u?.user;
    if (!user) throw new HttpError(401, 'Silakan login terlebih dahulu.');
    const isAdmin = async () => { const { data } = await admin.from('profiles').select('user_role').eq('id', user.id).maybeSingle(); return data?.user_role === 'admin'; };

    switch (body.action) {
      case 'generate': {
        const id = String(body.id ?? ''), parent = body.parent ? String(body.parent) : null;
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
        if (!uuidRe.test(id) || (parent && !uuidRe.test(parent))) throw new HttpError(400, 'Permintaan tidak valid.');
        const size: Size = body.size === '4K' ? '4K' : '2K';
        const style: Style = STYLES.includes(body.style as Style) ? body.style as Style : 'tajam';
        const chroma = body.chroma === 'magenta' ? 'magenta' : body.chroma === 'none' ? 'none' : 'green';
        const fixes = [...new Set(Array.isArray(body.fixes) ? body.fixes.map(String) : [])].filter((f) => Object.hasOwn(FIXES, f)).slice(0, MAX_FIXES);
        if (parent && !fixes.length) throw new HttpError(400, 'Pilih dulu apa yang perlu direvisi.');
        const note = fixes.map((f) => FIXES[f]).join(' ');
        const img = body.image as { mime?: string; data?: string } | undefined;
        const mime = String(img?.mime ?? '');
        const data = String(img?.data ?? '');
        if (!/^image\/(png|jpeg|webp)$/.test(mime) || data.length < 100 || data.length > MAX_INPUT_CHARS || /[^A-Za-z0-9+/=]/.test(data.slice(0, 2000))) throw new HttpError(400, 'Gambar tidak valid atau terlalu besar (maks. ±6 MB).');

        const adminUser = await isAdmin();
        if (!(await enabled(admin)) && !adminUser) throw new HttpError(403, 'Fitur Gambar ulang AI belum dibuka.');
        // Admin-only dry run: the full credit flow with the uploaded image echoed back instead of an AI call.
        const mock = body.mock === true && adminUser;
        const c = await conf(admin);
        if (!c.key && !mock) throw new HttpError(503, 'Fitur AI belum diatur. Hubungi admin.');
        if (c.dailyCap > 0) {
          const start = new Date(); start.setUTCHours(start.getUTCHours() + 7); start.setUTCHours(0, 0, 0, 0); start.setUTCHours(start.getUTCHours() - 7);
          const { count } = await admin.from('credit_ledger').select('id', { count: 'exact', head: true }).in('reason', ['ai_redraw', 'ai_revise']).gte('created_at', start.toISOString());
          if ((count ?? 0) >= c.dailyCap) throw new HttpError(503, 'Kuota AI hari ini sudah habis. Coba lagi besok.');
        }

        const pr = await prices(admin);
        const cost = parent ? pr.revise[size] : pr.cost[size];
        const ref = parent ? `air:${parent}:${id}` : `ai:${id}`;
        const { count: dup } = await admin.from('credit_ledger').select('id', { count: 'exact', head: true }).eq('ref', ref);
        if (dup) throw new HttpError(409, 'Permintaan ini sudah diproses.');
        const { data: bal, error: ce } = await admin.rpc('ai_charge', { p_user: user.id, p_id: id, p_cost: cost, p_parent: parent, p_hourly_limit: HOURLY_LIMIT });
        if (ce) {
          const m = ce.message;
          if (/insufficient_credits/.test(m)) throw new HttpError(402, 'insufficient_credits');
          if (/rate_limited/.test(m)) throw new HttpError(429, 'Terlalu banyak permintaan dalam 1 jam. Coba lagi nanti.');
          if (/revision_limit/.test(m)) throw new HttpError(409, `Revisi untuk gambar ini sudah ${MAX_REVISIONS} kali. Buat gambar baru untuk lanjut.`);
          if (/revision_expired/.test(m)) throw new HttpError(409, 'Waktu revisi (60 menit) sudah lewat. Buat gambar baru untuk lanjut.');
          console.error('charge', m); throw new HttpError(500, 'Gagal memotong kredit.');
        }

        const refund = async (why: string, adminMsg?: string) => {
          const { data: after } = await admin.rpc('ai_refund', { p_user: user.id, p_ref: ref });
          if (adminMsg) { console.error('ai', adminMsg); await noteError(admin, adminMsg); }
          return json({ error: why, refunded: true, balance: after }, 502);
        };

        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
        let out: Out;
        try {
          const text = prompt(style, chroma, note, !!parent);
          const ratio = ratioFor(Number(body.w), Number(body.h));
          out = mock ? (body.mock_fail === true ? { fail: 'provider', admin: 'uji coba gagal (mock)' } : { data, mime })
            : c.provider === 'google' ? await callGoogle(c, text, { mime, data }, ratio, size, ctl.signal) : await callOpenRouter(c, text, { mime, data }, ratio, size, ctl.signal);
        } catch (e) {
          clearTimeout(timer);
          const timeout = (e as Error)?.name === 'AbortError';
          return await refund(timeout ? 'AI terlalu lama merespons. Kredit sudah dikembalikan, silakan coba lagi.' : 'AI sedang tidak bisa dihubungi. Kredit sudah dikembalikan.', timeout ? undefined : `fetch: ${(e as Error)?.message}`);
        }
        clearTimeout(timer);
        if ('refused' in out) return await refund('AI menolak gambar ini (aturan konten). Kredit sudah dikembalikan. Coba gambar lain.');
        if ('fail' in out) {
          const why = out.fail === 'busy' ? 'Server AI sedang penuh. Kredit sudah dikembalikan, coba lagi sebentar.' : 'Gambar gagal dibuat. Kredit sudah dikembalikan, coba lagi.';
          return await refund(why, out.admin);
        }

        // Charge only what was delivered: a "4K" request that came back smaller pays the 2K price.
        const dim = imageSize(out.data);
        let balance = Number(bal), charged = cost;
        if (size === '4K' && dim.w && Math.max(dim.w, dim.h) < 3000) {
          const diff = Math.max(0, parent ? pr.revise['4K'] - pr.revise['2K'] : pr.cost['4K'] - pr.cost['2K']);
          const { data: b2 } = diff === 0 ? { data: null } : await admin.rpc('grant_credits', { p_user: user.id, p_amount: diff, p_reason: 'ai_refund', p_ref: 'aip:' + ref });
          if (b2 != null) { balance = Number(b2); charged = cost - diff; }
        }
        return json({ id, parent, image: out.data, mime: out.mime, w: dim.w, h: dim.h, cost: charged, balance, model: c.model });
      }

      case 'config_status': {
        if (!(await isAdmin())) throw new HttpError(403, 'Hanya admin.');
        const c = await conf(admin);
        const { data: le } = await admin.from('app_secrets').select('value').eq('key', 'ai_last_error').maybeSingle();
        const start = new Date(Date.now() - 30 * 86400000).toISOString();
        const { data: rows } = await admin.from('credit_ledger').select('reason,delta,created_at').in('reason', ['ai_redraw', 'ai_revise', 'ai_refund']).gte('created_at', start).limit(5000);
        const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
        const stat = { today: 0, month: 0, refunds: 0, credits: 0 };
        for (const r of rows ?? []) {
          if (r.reason === 'ai_refund') { stat.refunds++; stat.credits -= r.delta; continue; }
          stat.month++; stat.credits -= r.delta;
          if (new Date(new Date(r.created_at).getTime() + 7 * 3600000).toISOString().slice(0, 10) === today) stat.today++;
        }
        return json({
          provider: c.provider, enabled: await enabled(admin),
          google: { set: !!c.googleKey, masked: c.googleKey ? mask(c.googleKey) : '', model: c.googleModel },
          openrouter: { set: !!c.orKey, masked: c.orKey ? mask(c.orKey) : '', model: c.orModel },
          daily_cap: c.dailyCap, last_error: le?.value || '', stat, ...(await prices(admin)),
        });
      }
      case 'save_config': {
        if (!(await isAdmin())) throw new HttpError(403, 'Hanya admin.');
        const now = new Date().toISOString();
        const rows: { key: string; value: string; updated_at: string }[] = [];
        const provider = body.provider === 'openrouter' ? 'openrouter' : 'google';
        rows.push({ key: 'ai_provider', value: provider, updated_at: now });
        const gk = String(body.google_key ?? '').trim(), ok = String(body.openrouter_key ?? '').trim();
        if (gk) { if (gk.length < 20 || gk.length > 200 || /\s/.test(gk)) throw new HttpError(400, 'Format API key Google tidak valid.'); rows.push({ key: 'ai_google_key', value: gk, updated_at: now }); }
        if (ok) { if (!/^sk-or-/.test(ok) || ok.length > 200 || /\s/.test(ok)) throw new HttpError(400, 'API key OpenRouter harus diawali "sk-or-".'); rows.push({ key: 'ai_openrouter_key', value: ok, updated_at: now }); }
        const gm = String(body.google_model ?? '').trim(), om = String(body.openrouter_model ?? '').trim();
        if (gm) { if (!/^[a-z0-9.\-]{3,80}$/i.test(gm)) throw new HttpError(400, 'Nama model Google tidak valid.'); rows.push({ key: 'ai_google_model', value: gm, updated_at: now }); }
        if (om) { if (!/^[a-z0-9._\-]+\/[a-z0-9.:_\-]{2,80}$/i.test(om)) throw new HttpError(400, 'Nama model OpenRouter tidak valid (contoh: google/gemini-3.1-flash-image-preview).'); rows.push({ key: 'ai_openrouter_model', value: om, updated_at: now }); }
        if (body.daily_cap !== undefined && body.daily_cap !== '') {
          const cap = Number(body.daily_cap);
          if (!Number.isInteger(cap) || cap < 0 || cap > 100000) throw new HttpError(400, 'Batas harian harus angka 0–100000.');
          rows.push({ key: 'ai_daily_cap', value: String(cap), updated_at: now });
        }
        if (body.prices) {
          const p = body.prices as Record<string, unknown>;
          const n = (k: string) => Number(p[k]);
          const pr: Prices = { cost: { '2K': n('2K'), '4K': n('4K') }, revise: { '2K': n('r2K'), '4K': n('r4K') } };
          const all = [pr.cost['2K'], pr.cost['4K'], pr.revise['2K'], pr.revise['4K']];
          if (!all.every((x) => Number.isInteger(x) && x >= 1 && x <= 100)) throw new HttpError(400, 'Harga harus angka bulat 1–100 kredit.');
          if (pr.cost['4K'] < pr.cost['2K'] || pr.revise['4K'] < pr.revise['2K']) throw new HttpError(400, 'Harga 4K tidak boleh lebih murah dari 2K.');
          if (pr.revise['2K'] > pr.cost['2K'] || pr.revise['4K'] > pr.cost['4K']) throw new HttpError(400, 'Harga revisi tidak boleh lebih mahal dari gambar baru.');
          const { error: pe } = await admin.from('app_settings').upsert({ key: 'ai_prices', value: JSON.stringify(pr), updated_at: now });
          if (pe) throw new HttpError(500, 'Gagal menyimpan harga.');
        }
        const { error } = await admin.from('app_secrets').upsert(rows);
        if (error) throw new HttpError(500, 'Gagal menyimpan pengaturan.');
        return json({ message: 'Pengaturan AI disimpan.' });
      }
      case 'test': {
        if (!(await isAdmin())) throw new HttpError(403, 'Hanya admin.');
        const c = await conf(admin);
        if (!c.key) throw new HttpError(400, 'API key untuk penyedia ini belum diisi.');
        if (c.provider === 'google') {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}`, { headers: { 'x-goog-api-key': c.key } });
          const d = await r.json().catch(() => ({})) as Record<string, any>;
          if (r.status === 400 || r.status === 401 || r.status === 403) throw new HttpError(400, 'API key ditolak Google: ' + String(d?.error?.message ?? r.status));
          if (r.status === 404) throw new HttpError(400, `Model "${c.model}" tidak ditemukan. Cek nama model.`);
          if (!r.ok) throw new HttpError(502, 'Google: ' + String(d?.error?.message ?? r.status));
          return json({ message: `Key dan model ${c.model} dikenali Google. Billing baru terlihat saat membuat gambar pertama.` });
        }
        const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: 'Bearer ' + c.key } });
        const d = await r.json().catch(() => ({})) as Record<string, any>;
        if (!r.ok) throw new HttpError(400, 'API key ditolak OpenRouter: ' + String(d?.error?.message ?? r.status));
        const left = d?.data?.limit_remaining;
        return json({ message: `Terhubung ke OpenRouter${left != null ? ` (sisa batas key $${Number(left).toFixed(2)})` : ''}. Model: ${c.model}.` });
      }
      case 'set_enabled': {
        if (!(await isAdmin())) throw new HttpError(403, 'Hanya admin.');
        const on = body.enabled === true;
        if (on && !(await conf(admin)).key) throw new HttpError(400, 'Isi API key dulu sebelum membuka fitur untuk pelanggan.');
        const { error } = await admin.from('app_settings').upsert({ key: 'ai_enabled', value: on ? '1' : '0', updated_at: new Date().toISOString() });
        if (error) throw new HttpError(500, 'Gagal menyimpan.');
        return json({ message: on ? 'Gambar ulang AI dibuka untuk pelanggan.' : 'Gambar ulang AI disembunyikan dari pelanggan.' });
      }
      default:
        throw new HttpError(400, 'Aksi tidak dikenal.');
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('ai-redraw error', e);
    return json({ error: 'Terjadi kesalahan di server.' }, 500);
  }
});
