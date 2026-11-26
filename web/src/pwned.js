// Leaked-password check (HaveIBeenPwned "Pwned Passwords", k-anonymity): only the first
// 5 characters of the password's SHA-1 hash leave the browser; the password never does.
export async function leakedCount(password) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  const prefix = hex.slice(0, 5), suffix = hex.slice(5);
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'Add-Padding': 'true' }, signal: ctl.signal });
    if (!r.ok) return 0;                       // service down: don't block sign-up
    for (const line of (await r.text()).split('\n')) {
      const [s, n] = line.trim().split(':');
      if (s === suffix) return Number(n) || 0;
    }
    return 0;
  } catch { return 0; } finally { clearTimeout(t); }
}
import { L } from './i18n.js';
export const leakedMessage = (n) => L(
  `Password ini pernah bocor di internet (${Number(n).toLocaleString('id-ID')}× ditemukan di data kebocoran). Pakai password lain yang belum pernah dipakai di tempat lain.`,
  `This password has appeared in data breaches (${Number(n).toLocaleString('en-GB')} times). Please choose a password you have not used anywhere else.`);
