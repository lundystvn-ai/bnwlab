// Image checker for DTF prints. Everything runs in the browser on the current result (ImageData).
// analyze() reports problems; the fix functions return new ImageData and never touch the input.
import { knockoutBW } from './engine.js';

const LO = 13, HI = 242;          // alpha between these = semi-transparent ("white haze" risk)
const SOLID = 128;                // alpha from here counts as printed ink

const lum = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
const sat = (r, g, b) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
const isWhiteish = (r, g, b) => lum(r, g, b) > 0.88 && sat(r, g, b) < 0.12;
const isBlackish = (r, g, b) => lum(r, g, b) < 0.1 && sat(r, g, b) < 0.15;

export const pxPerMm = (dpi) => dpi / 25.4;
export const dpiFor = (widthPx, cm) => (cm > 0 ? widthPx / (cm / 2.54) : 300);

// Opaque mask: 1 where alpha >= SOLID.
function solidMask(d, n) {
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (d[i * 4 + 3] >= SOLID) m[i] = 1;
  return m;
}

// Connected components (4-neighbour) of the mask. Returns labels and sizes.
function components(mask, w, h) {
  const n = w * h, label = new Int32Array(n), sizes = [0], queue = new Int32Array(n);
  let next = 0;
  for (let s = 0; s < n; s++) {
    if (!mask[s] || label[s]) continue;
    next++; let head = 0, tail = 0, size = 0;
    label[s] = next; queue[tail++] = s;
    while (head < tail) {
      const i = queue[head++], x = i % w; size++;
      if (x > 0 && mask[i - 1] && !label[i - 1]) { label[i - 1] = next; queue[tail++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !label[i + 1]) { label[i + 1] = next; queue[tail++] = i + 1; }
      if (i >= w && mask[i - w] && !label[i - w]) { label[i - w] = next; queue[tail++] = i - w; }
      if (i < n - w && mask[i + w] && !label[i + w]) { label[i + w] = next; queue[tail++] = i + w; }
    }
    sizes.push(size);
  }
  return { label, sizes, count: next };
}

// Binary erosion / dilation with a (2r+1) square, done as two 1-D passes with running counts.
function morph(mask, w, h, r, erode) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h), k = 2 * r + 1;
  const pass = (src, dst, len, count, idx) => {
    for (let line = 0; line < count; line++) {
      let sum = 0;
      for (let j = -r; j <= r; j++) { const q = Math.min(len - 1, Math.max(0, j)); sum += src[idx(line, q)]; }
      for (let j = 0; j < len; j++) {
        dst[idx(line, j)] = erode ? (sum === k ? 1 : 0) : (sum > 0 ? 1 : 0);
        const add = Math.min(len - 1, j + r + 1), rem = Math.max(0, j - r);
        sum += src[idx(line, add)] - src[idx(line, rem)];
      }
    }
  };
  pass(mask, tmp, w, h, (line, j) => line * w + j);
  pass(tmp, out, h, w, (line, j) => j * w + line);
  return out;
}

// Pixels of strokes thinner than minPx (mask minus its morphological opening).
function thinMask(mask, w, h, minPx) {
  const r = Math.max(1, Math.floor(minPx / 2));
  const open = morph(morph(mask, w, h, r, true), w, h, r, false);
  const thin = new Uint8Array(w * h);
  let count = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] && !open[i]) { thin[i] = 1; count++; }
  return { thin, count };
}

// Edge pixels whose colour is a white/black leftover that differs from the colour just inside them.
function fringeMask(d, mask, w, h) {
  const n = w * h, fr = new Uint8Array(n);
  let edges = 0, count = 0;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (!mask[i]) continue;
    let out = null;
    for (const [dx, dy] of dirs) if (!mask[i + dy * w + dx]) { out = [dx, dy]; break; }
    if (!out) continue;
    edges++;
    const p = i * 4, r = d[p], g = d[p + 1], b = d[p + 2];
    if (!isWhiteish(r, g, b) && !isBlackish(r, g, b)) continue;
    const ix = x - out[0] * 3, iy = y - out[1] * 3;
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
    const j = iy * w + ix; if (!mask[j]) continue;
    const q = j * 4, dr = d[q] - r, dg = d[q + 1] - g, db = d[q + 2] - b;
    if (Math.sqrt(dr * dr + dg * dg + db * db) > 90) { fr[i] = 1; count++; }
  }
  return { fr, count, edges };
}

// Which neutral colour fills the border of an image that has no transparency (leftover background).
function borderBackground(d, w, h) {
  let white = 0, black = 0, total = 0;
  const look = (x, y) => { const p = (y * w + x) * 4; total++; if (isWhiteish(d[p], d[p + 1], d[p + 2])) white++; else if (isBlackish(d[p], d[p + 1], d[p + 2])) black++; };
  const sx = Math.max(1, Math.floor(w / 200)), sy = Math.max(1, Math.floor(h / 200));
  for (let x = 0; x < w; x += sx) { look(x, 0); look(x, h - 1); }
  for (let y = 0; y < h; y += sy) { look(0, y); look(w - 1, y); }
  if (white / total > 0.6) return 'white';
  if (black / total > 0.6) return 'black';
  return null;
}

/**
 * @param img ImageData   current result
 * @param o   { dpi, raster: boolean, jpeg: boolean }
 * @returns  { stats, issues: [{ id, level: 'ok'|'warn'|'bad'|'info', data }], masks }
 */
export function analyze(img, o) {
  const { width: w, height: h, data: d } = img, n = w * h;
  let transparent = 0, semi = 0, visible = 0;
  for (let i = 3; i < d.length; i += 4) {
    const a = d[i];
    if (a === 0) transparent++; else { visible++; if (a >= LO && a <= HI) semi++; }
  }
  const mask = solidMask(d, n);
  const issues = [];
  const dpi = o.dpi;

  // 1. resolution at the chosen print width
  issues.push({ id: 'dpi', level: dpi >= 250 ? 'ok' : dpi >= 150 ? 'warn' : 'bad', data: { dpi: Math.round(dpi) } });

  // 2. leftover background
  const transPct = transparent / n;
  if (transPct < 0.01) {
    const bg = borderBackground(d, w, h);
    issues.push({ id: 'background', level: bg ? 'bad' : 'warn', data: { bg } });
  } else issues.push({ id: 'background', level: 'ok', data: {} });

  // 3. semi-transparent pixels (white haze)
  const semiPct = visible ? semi / visible : 0;
  issues.push({ id: 'haze', level: semiPct > 0.08 ? 'bad' : semiPct > 0.02 ? 'warn' : 'ok', data: { pct: semiPct, count: semi } });

  // Raster results are made of tiny dots on purpose: skip the shape checks there.
  let fr = null, specks = null, thin = null;
  if (!o.raster && transPct >= 0.01) {
    // 4. fringe / halo
    fr = fringeMask(d, mask, w, h);
    const frPct = fr.edges ? fr.count / fr.edges : 0;
    issues.push({ id: 'fringe', level: fr.count > 40 && frPct > 0.04 ? (frPct > 0.15 ? 'bad' : 'warn') : 'ok', data: { count: fr.count, pct: frPct } });

    // 5. specks: islands smaller than ~0.3 mm²
    const minArea = Math.max(6, Math.round(0.3 * pxPerMm(dpi) ** 2));
    const cc = components(mask, w, h);
    let speckCount = 0, speckPx = 0;
    const small = new Uint8Array(cc.count + 1);
    for (let k = 1; k <= cc.count; k++) if (cc.sizes[k] < minArea) { small[k] = 1; speckCount++; speckPx += cc.sizes[k]; }
    specks = { label: cc.label, small, count: speckCount };
    issues.push({ id: 'specks', level: speckCount === 0 ? 'ok' : speckCount > 20 ? 'bad' : 'warn', data: { count: speckCount, minArea } });

    // 7. thin details for white ink (< 0.5 mm at print size)
    const minPx = 0.5 * pxPerMm(dpi);
    if (minPx >= 2) {
      thin = thinMask(mask, w, h, minPx);
      const solid = mask.reduce((a, v) => a + v, 0) || 1;
      const thinPct = thin.count / solid;
      issues.push({ id: 'thin', level: thin.count > 150 && thinPct > 0.004 ? (thinPct > 0.03 ? 'bad' : 'warn') : 'ok', data: { pct: thinPct, mm: 0.5 } });
    }
  } else if (o.raster) {
    issues.push({ id: 'shapes', level: 'info', data: {} });
  }

  // 6. JPEG source
  if (o.jpeg) issues.push({ id: 'jpeg', level: 'warn', data: {} });

  return { issues, masks: { fr, specks, thin }, stats: { w, h, transparentPct: transPct, semiPct } };
}

// ---------- fixes ----------
const copy = (img) => new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);

// Make every pixel either fully printed or fully transparent (no haze).
export function fixHaze(img) {
  const out = copy(img), d = out.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= SOLID ? 255 : 0;
  return out;
}

export function fixFringe(img, masks) {
  const out = copy(img), d = out.data, fr = masks?.fr?.fr;
  if (!fr) return out;
  for (let i = 0; i < fr.length; i++) if (fr[i]) d[i * 4 + 3] = 0;
  return out;
}

export function fixSpecks(img, masks) {
  const out = copy(img), d = out.data, sp = masks?.specks;
  if (!sp) return out;
  const { label, small } = sp, w = img.width, h = img.height;
  for (let i = 0; i < label.length; i++) {
    if (!small[label[i]]) continue;
    d[i * 4 + 3] = 0;
    // also clear the faint pixels around the speck
    const x = i % w;
    for (const j of [i - 1, i + 1, i - w, i + w]) {
      if (j < 0 || j >= label.length || (j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue;
      if (!label[j] && d[j * 4 + 3] < SOLID) d[j * 4 + 3] = 0;
    }
  }
  return out;
}

// Red overlay of thin parts on top of the image (for the "show me" button).
export function thinOverlay(img, masks) {
  const out = copy(img), d = out.data, t = masks?.thin?.thin;
  if (!t) return out;
  for (let i = 0; i < t.length; i++) if (t[i]) { const p = i * 4; d[p] = 255; d[p + 1] = 40; d[p + 2] = 60; d[p + 3] = 255; }
  return out;
}

// Peel leftover rims layer by layer (up to 4 px) until none is left.
export function cleanFringe(img) {
  let out = copy(img);
  const { width: w, height: h } = img, n = w * h;
  for (let pass = 0; pass < 4; pass++) {
    const d = out.data, fr = fringeMask(d, solidMask(d, n), w, h);
    if (fr.count < 20) break;
    for (let i = 0; i < n; i++) if (fr.fr[i]) d[i * 4 + 3] = 0;
  }
  // sweep up rim debris: tiny white/black islands left behind by the peeling
  const d = out.data, cc = components(solidMask(d, n), w, h);
  const debris = new Uint8Array(cc.count + 1);
  for (let k = 1; k <= cc.count; k++) if (cc.sizes[k] <= 8) debris[k] = 1;
  for (let i = 0; i < n; i++) {
    const k = cc.label[i]; if (!debris[k]) continue;
    const p = i * 4;
    if (isWhiteish(d[p], d[p + 1], d[p + 2]) || isBlackish(d[p], d[p + 1], d[p + 2])) d[p + 3] = 0;
  }
  return out;
}

// ---- background removal that keeps the design ----
// Only background-coloured pixels connected to the image border are removed (flood fill), so white
// or black INSIDE the design stays. Enclosed pockets (the hole in an "O") can be removed one by one
// with removeAt().
function bgFill(img, bg, seeds, throughClear) {
  const w = img.width, h = img.height, n = w * h, s = img.data, k = knockoutBW(img, bg).data;
  const pass = new Uint8Array(n);   // 1 = looks like background, 2 = already transparent
  for (let i = 0; i < n; i++) { const a = s[i * 4 + 3]; if (a === 0) { if (throughClear) pass[i] = 2; } else if (k[i * 4 + 3] < a) pass[i] = 1; }
  const seen = new Uint8Array(n), q = new Int32Array(n); let t = 0;
  for (const i of seeds(pass, w, h)) if (pass[i] && !seen[i]) { seen[i] = 1; q[t++] = i; }
  for (let hd = 0; hd < t; hd++) {
    const i = q[hd], x = i % w;
    if (x > 0 && pass[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; q[t++] = i - 1; }
    if (x < w - 1 && pass[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; q[t++] = i + 1; }
    if (i >= w && pass[i - w] && !seen[i - w]) { seen[i - w] = 1; q[t++] = i - w; }
    if (i + w < n && pass[i + w] && !seen[i + w]) { seen[i + w] = 1; q[t++] = i + w; }
  }
  const out = copy(img), d = out.data; let changed = 0;
  for (let i = 0; i < n; i++) if (seen[i] && pass[i] === 1) { d[i * 4 + 3] = k[i * 4 + 3]; changed++; }
  // enclosed pockets of the background colour that are left (big enough to matter)
  const rest = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (pass[i] === 1 && !seen[i] && s[i * 4 + 3] >= SOLID) rest[i] = 1;
  const { sizes } = components(rest, w, h), min = Math.max(64, Math.round(n / 4000));
  let pockets = 0; for (let j = 1; j < sizes.length; j++) if (sizes[j] >= min) pockets++;
  return { img: out, changed, pockets };
}
export function removeBackground(img, bg) {
  return bgFill(img, bg, function* (pass, w, h) {
    for (let x = 0; x < w; x++) { yield x; yield (h - 1) * w + x; }
    for (let y = 0; y < h; y++) { yield y * w; yield y * w + w - 1; }
  }, true);
}
export function removeAt(img, bg, x, y) {
  const i = y * img.width + x;
  return bgFill(img, bg, function* (pass) { if (pass[i] === 1) yield i; }, false);
}
