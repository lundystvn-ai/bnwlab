// Site settings. An admin can override the Supabase connection for their own browser
// from Pengaturan (stored as dtfe_cfg, same key as the previous site).
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem('dtfe_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('dtfe_' + k, JSON.stringify(v)); } catch {} },
};

const defaults = {
  brand: 'BNW Design Lab',
  tagline: 'Siapkan file DTF lebih rapi: knockout, raster halftone, dan upscale dalam satu tempat.',
  supabaseUrl: 'https://pxpdiazurjyqdcqginso.supabase.co',
  supabaseAnonKey: 'sb_publishable_vNppxiR4bcWIzIJhUWqN2w_1rScY6ex',
  freeCredits: 3,
  packages: [
    { id: 'starter', nama: 'Starter', kredit: 30, harga: 25000, catatan: 'Coba dulu untuk pesanan kecil' },
    { id: 'pro', nama: 'Pro', kredit: 125, harga: 100000, catatan: 'Pas untuk produksi rutin', populer: true },
    { id: 'studio', nama: 'Studio', kredit: 420, harga: 300000, catatan: 'Untuk studio / banyak desain' },
  ],
  kontakWhatsApp: '',
  kontakEmail: '',
};

export const cfg = { ...defaults, ...(store.get('cfg') || {}) };
export const usingBrowserOverride = !!store.get('cfg');
