// Chroma key for "Redraw AI": the AI draws the design on flat green (or magenta) because it cannot
// return transparency. This removes that background in the browser, softens the edge and cleans colour spill.
// Pure function on RGBA pixels, so it can run in tests and in a worker.

export const KEYS = { green: [0, 255, 0], magenta: [255, 0, 255] };

const dist = (px, k, c) => Math.max(Math.abs(px[k] - c[0]), Math.abs(px[k + 1] - c[1]), Math.abs(px[k + 2] - c[2]));

// The most common opaque colour on the image border.
export function borderColor(px, w, h) {
  const counts = new Map();
  const add = (p) => { const k = p * 4; const key = ((px[k] >> 3) << 10) | ((px[k + 1] >> 3) << 5) | (px[k + 2] >> 3); counts.set(key, (counts.get(key) || 0) + 1); };
  const step = Math.max(1, Math.floor((w + h) / 600));
  for (let x = 0; x < w; x += step) { add(x); add((h - 1) * w + x); }
  for (let y = 0; y < h; y += step) { add(y * w); add(y * w + w - 1); }
  let best = 0, n = -1;
  for (const [key, c] of counts) if (c > n) { best = key; n = c; }
  const ch = (v) => Math.min(255, (v << 3) + 4);
  return [ch((best >> 10) & 31), ch((best >> 5) & 31), ch(best & 31)];
}

// Is a colour close enough to the key we asked for to be trusted as the background?
export function looksLikeKey(c, mode) {
  return mode === 'green' ? c[1] > 150 && c[1] - Math.max(c[0], c[2]) > 90 : c[0] > 150 && c[2] > 150 && Math.min(c[0], c[2]) - c[1] > 90;
}

// Share of pixels that read as strong green: such designs should use the magenta key instead.
export function greenShare(px) {
  let g = 0, n = 0;
  for (let k = 0; k < px.length; k += 16) {
    if (px[k + 3] < 128) continue;
    n++;
    if (px[k + 1] > 120 && px[k + 1] - Math.max(px[k], px[k + 2]) > 50) g++;
  }
  return n ? g / n : 0;
}

/**
 * Removes the key background in place.
 * @param {Uint8ClampedArray} px RGBA
 * @param {'green'|'magenta'} mode
 * @param {{inner?: boolean, strength?: number}} opts inner: also clear enclosed areas (inside letters); strength 0..100
 * @returns {{cleared:number, key:number[]}}
 */
export function removeKey(px, w, h, mode, opts = {}) {
  const found = borderColor(px, w, h);
  const key = looksLikeKey(found, mode) ? found : KEYS[mode];
  const s = Math.max(0, Math.min(100, opts.strength ?? 50)) / 100;
  const t0 = Math.round(30 + 40 * s);          // fully transparent at or below this distance
  const t1 = t0 + 70;                           // partly transparent up to this distance (edge band only)
  const inner = opts.inner !== false;
  const n = w * h, bg = new Uint8Array(n), queue = new Int32Array(n);
  let head = 0, tail = 0, cleared = 0;
  const near = (p) => dist(px, p * 4, key) <= t0;
  const enter = (p) => { if (bg[p] || !near(p)) return; bg[p] = 1; queue[tail++] = p; };
  for (let x = 0; x < w; x++) { enter(x); enter((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { enter(y * w); enter(y * w + w - 1); }
  while (head < tail) {
    const p = queue[head++], x = p % w;
    if (x) enter(p - 1); if (x < w - 1) enter(p + 1); if (p >= w) enter(p - w); if (p < n - w) enter(p + w);
  }
  // Enclosed background (inside an "O", between arms): a stricter match, since it is not connected to the edge.
  if (inner) { const tIn = Math.round(t0 * 0.7); for (let p = 0; p < n; p++) if (!bg[p] && dist(px, p * 4, key) <= tIn) bg[p] = 1; }
  for (let p = 0; p < n; p++) if (bg[p]) { const k = p * 4; if (px[k + 3]) cleared++; px[k + 3] = 0; }

  // Soft key: the AI often paints a green glow or gradient (around hair, where green meets a shirt) that is not
  // close enough to the flat key to be cut above. Measure how "key-coloured" each remaining pixel is, make it that
  // much transparent, and take the key colour back out of what is left. The key is chosen so the design itself has
  // almost none of it (green designs use magenta), so this only touches leftovers.
  const keyAmt = mode === 'green' ? key[1] - Math.max(key[0], key[2]) : Math.min(key[0], key[2]) - key[1];
  const lo = Math.round(70 - 40 * s);              // below this much key colour a pixel is left alone
  if (keyAmt > lo + 20) {
    // Only key-coloured pixels connected to the removed background (glows, gradients): a green leaf drawn
    // inside the design, surrounded by other colours, is left alone.
    const amtOf = (p) => { const k = p * 4; return mode === 'green' ? px[k + 1] - Math.max(px[k], px[k + 2]) : Math.min(px[k], px[k + 2]) - px[k + 1]; };
    const near = new Uint8Array(n); let qh = 0, qt = 0;
    const reach = (p) => { if (near[p] || !px[p * 4 + 3] || amtOf(p) <= lo) return; near[p] = 1; queue[qt++] = p; };
    for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
      if (px[p * 4 + 3]) continue;
      if (x) reach(p - 1); if (x < w - 1) reach(p + 1); if (y) reach(p - w); if (y < h - 1) reach(p + w);
    }
    while (qh < qt) { const p = queue[qh++], x = p % w; if (x) reach(p - 1); if (x < w - 1) reach(p + 1); if (p >= w) reach(p - w); if (p < n - w) reach(p + w); }
    for (let p = 0; p < n; p++) {
      const k = p * 4; if (!px[k + 3] || !near[p]) continue;
      const r = px[k], g = px[k + 1], b = px[k + 2];
      const amt = mode === 'green' ? g - Math.max(r, b) : Math.min(r, b) - g;
      if (amt <= lo) continue;
      const a = Math.min(1, (amt - lo) / (keyAmt - lo));
      if (a >= 0.97) { px[k + 3] = 0; cleared++; continue; }
      // un-mix: colour = (seen − a·key) / (1 − a)
      const un = (v, kv) => Math.max(0, Math.min(255, Math.round((v - a * kv) / (1 - a))));
      px[k] = un(r, key[0]); px[k + 1] = un(g, key[1]); px[k + 2] = un(b, key[2]);
      px[k + 3] = Math.round(px[k + 3] * (1 - a));
      if (mode === 'green') { const m = Math.max(px[k], px[k + 2]); if (px[k + 1] > m) px[k + 1] = m; }
      else { const m = Math.min(px[k], px[k + 2]); if (m > px[k + 1]) { px[k] -= m - px[k + 1]; px[k + 2] -= m - px[k + 1]; } }
    }
  }

  // Edge band: pixels touching the background get alpha from their distance to the key, and lose colour spill.
  // band 1 = touches the background, band 2 = touches band 1 (4-neighbourhood, two cheap passes).
  const band = new Uint8Array(n);
  const ring = (src, srcVal, mark) => {
    for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
      if (bg[p] || band[p]) continue;
      if ((x && src[p - 1] === srcVal) || (x < w - 1 && src[p + 1] === srcVal) || (y && src[p - w] === srcVal) || (y < h - 1 && src[p + w] === srcVal)) band[p] = mark;
    }
  };
  ring(bg, 1, 1);
  ring(band, 1, 2);
  for (let p = 0; p < n; p++) {
    if (!band[p]) continue;
    const k = p * 4;
    if (band[p] === 1) {
      const d = dist(px, k, key);
      if (d < t1) px[k + 3] = Math.min(px[k + 3], Math.round(255 * Math.max(0, d - t0) / (t1 - t0)));
    }
    if (mode === 'green') { const m = Math.max(px[k], px[k + 2]); if (px[k + 1] > m) px[k + 1] = m; }
    else { const g = px[k + 1], m = Math.min(px[k], px[k + 2]); if (m > g) { px[k] -= m - g; px[k + 2] -= m - g; } }
  }

  return { cleared, key };
}

// Crops fully transparent margins; returns the box or null when nothing is left.
export function opaqueBox(px, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
