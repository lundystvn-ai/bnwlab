import { createClient } from '@supabase/supabase-js';
import { cfg } from './config.js';

export const db = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const afterInvoke = new Set();
export const onAfterInvoke = (fn) => afterInvoke.add(fn);

// Edge function call with the error body unwrapped (same behaviour as before).
export async function invoke(name, body) {
  try {
    const r = await db.functions.invoke(name, { body });
    if (r.error) {
      let msg = r.error.message || 'Edge Function gagal.';
      try { const j = await r.error.context?.json?.(); if (j?.error) msg = String(j.error); } catch {}
      throw new Error(msg);
    }
    const data = r.data || {};
    if (data.error) throw new Error(String(data.error));
    return data;
  } finally {
    afterInvoke.forEach((fn) => fn());
  }
}

// Connection check used by the admin settings page.
export function validateConnection(url, key) {
  const u = String(url || '').trim().replace(/\/+$/, ''), k = String(key || '').trim();
  const role = (() => { try { const p = k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(p.padEnd(Math.ceil(p.length / 4) * 4, '='))).role || ''; } catch { return ''; } })();
  if (!/^https:\/\/[^\s/]+$/i.test(u) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(u)) return { error: 'Project URL harus berbentuk https://xxxx.supabase.co' };
  if (!k || /\s/.test(k)) return { error: 'Anon key kosong atau mengandung spasi.' };
  if (k.startsWith('sb_secret_') || role === 'service_role') return { error: 'Itu kunci RAHASIA (service_role). Jangan dipakai di website. Gunakan "anon public" / "publishable" key.' };
  return { url: u, key: k };
}
export async function testConnection(url, key) {
  const out = [];
  const c = createClient(url, key, { auth: { persistSession: false } });
  const r = await c.from('credit_packages').select('id').limit(1);
  if (r.error) {
    const m = String(r.error.message || '');
    if (/relation|does not exist|schema cache|Could not find the table/i.test(m)) out.push({ ok: true, label: 'Terhubung ke Supabase' }, { ok: false, label: 'Skema database belum dipasang', hint: 'Jalankan file SQL migrasi di SQL Editor.' });
    else if (/Invalid API key|JWT|apikey/i.test(m)) out.push({ ok: false, label: 'Anon key ditolak', hint: 'Salin ulang "anon public" key dari Settings → API.' });
    else out.push({ ok: false, label: 'Gagal terhubung', hint: m });
  } else out.push({ ok: true, label: 'Terhubung ke Supabase' }, { ok: true, label: 'Skema database terpasang' });
  try {
    const f = await fetch(url + '/functions/v1/bigjpg-upscale', { method: 'OPTIONS' });
    out.push(f.ok ? { ok: true, label: 'Edge Function bigjpg-upscale terpasang' } : { ok: false, label: 'Edge Function bigjpg-upscale belum terpasang', hint: 'Jalankan: supabase functions deploy bigjpg-upscale' });
  } catch { out.push({ ok: false, label: 'Edge Function bigjpg-upscale tidak terjangkau', hint: 'Jalankan: supabase functions deploy bigjpg-upscale' }); }
  return out;
}
