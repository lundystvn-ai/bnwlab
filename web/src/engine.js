// BNW Design Lab image engine (KTX). Ported 1:1 from the previous bnwlab.com build:
// same formulas, thresholds and limits, so results match the old site.
// Everything here runs in the user's browser; nothing is uploaded.

export const LINE_ANGLES = Object.freeze([15, 22.5, 45, 60]);
export const MAX_PIXELS = 16e6;
export const MAX_DIMENSION = 16384;

export const normalizeLineAngle = (a) => (LINE_ANGLES.includes(Number(a)) ? Number(a) : 45);
export const lineCoordinate = (x, y, angle) => {
  const r = (normalizeLineAngle(angle) * Math.PI) / 180;
  return -x * Math.sin(r) + y * Math.cos(r);
};
export const clampLpi = (v) => Math.max(30, Math.min(60, Number(v) || 45));
export const cellForLpi = (lpi) => Math.max(5, Math.min(10, Math.round(300 / clampLpi(lpi))));

// ---- sizing (large images are scaled down to stay stable) ----
export function fitImageDimensions(w, h, maxPixels = MAX_PIXELS, maxDim = MAX_DIMENSION) {
  const l = Math.max(1, Math.floor(Number(w) || 1));
  const u = Math.max(1, Math.floor(Number(h) || 1));
  const P = Math.max(1, Math.floor(Number(maxPixels) || MAX_PIXELS));
  const q = Math.max(1, Math.floor(Number(maxDim) || MAX_DIMENSION));
  if (l * u <= P) return { sourceWidth: l, sourceHeight: u, width: l, height: u, resized: false };
  const n = Math.min(1, Math.sqrt(P / (l * u)), q / l, q / u);
  let r = Math.max(1, Math.floor(l * n));
  let s = Math.max(1, Math.floor(u * n));
  while (r * s > P) r / l >= s / u ? r-- : s--;
  return { sourceWidth: l, sourceHeight: u, width: r, height: s, resized: true };
}

export function prepareUpload(img, fileName = 'Gambar') {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const plan = fitImageDimensions(w, h);
  let image = img;
  if (plan.resized) {
    const c = document.createElement('canvas');
    c.width = plan.width; c.height = plan.height;
    const ctx = c.getContext('2d');
    if (!ctx) return { error: 'Gambar besar tidak dapat dioptimalkan di perangkat ini. Coba tutup tab lain atau gunakan gambar yang lebih kecil.' };
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, plan.width, plan.height);
    image = c;
  }
  const src = `${plan.sourceWidth}×${plan.sourceHeight}px`;
  const out = `${plan.width}×${plan.height}px`;
  return {
    image, plan,
    fileInfo: plan.resized ? `${fileName} · ${src} → ${out}` : `${fileName} · ${src}`,
    notice: plan.resized
      ? `Gambar besar otomatis dioptimalkan dari ${src} menjadi ${out} agar Raster dan Undo tetap stabil.`
      : 'Gambar siap. Pilih Raster Bulat, Raster Garis, atau Knockout.',
    noticeType: plan.resized ? 'warn' : 'ok',
  };
}

// ---- colours ----
const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
export const rgbToHex = (r, g, b) => `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`;
export function parseHexColor(v) {
  const m = String(v || '').trim().toLowerCase().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return { red: parseInt(h.slice(0, 2), 16), green: parseInt(h.slice(2, 4), 16), blue: parseInt(h.slice(4, 6), 16), hex: `#${h}` };
}

export function createColorKnockoutState(d = {}) {
  const color = parseHexColor(d.color) || parseHexColor('#000000');
  const tol = Number(d.tolerance);
  const sx = Number(d.seed?.x), sy = Number(d.seed?.y);
  return {
    color: color.hex,
    mode: d.mode === 'area' ? 'area' : 'global',
    tolerance: Number.isFinite(tol) ? Math.max(0, Math.min(100, Math.round(tol))) : 24,
    seed: Number.isFinite(sx) && Number.isFinite(sy) ? { x: Math.floor(sx), y: Math.floor(sy) } : null,
    sampling: d.sampling === 'color' || d.sampling === 'area' ? d.sampling : null,
  };
}

export function sampleColor(imageData, pt) {
  const w = imageData?.width, h = imageData?.height, d = imageData?.data;
  const x = Math.floor(Number(pt?.x)), y = Math.floor(Number(pt?.y));
  if (!d || !(w >= 1) || !(h >= 1) || x < 0 || y < 0 || x >= w || y >= h) return null;
  const i = (y * w + x) * 4;
  if (d[i + 3] === 0) return null;
  return { color: { red: d[i], green: d[i + 1], blue: d[i + 2], hex: rgbToHex(d[i], d[i + 1], d[i + 2]) }, seed: { x, y } };
}

// ---- knockout black / white (neutral pixels near black or white become transparent) ----
export function knockoutBW(src, mode) {
  const out = new ImageData(src.width, src.height);
  const b = src.data, C = out.data;
  for (let A = 0; A < b.length; A += 4) {
    const J = b[A], de = b[A + 1], te = b[A + 2], Pe = b[A + 3];
    let ue = 0;
    if (mode === 'black' || mode === 'white') {
      const N = Math.max(J, de, te) - Math.min(J, de, te);
      const Y = mode === 'black' ? 0 : 255;
      const oe = Math.max(Math.abs(J - Y), Math.abs(de - Y), Math.abs(te - Y));
      const I = mode === 'black' ? 38 : 32, ke = 16, Me = 12, me = 34;
      const ie = N <= Me ? 1 : N >= me ? 0 : 1 - (N - Me) / (me - Me);
      const ye = oe <= I ? 1 : oe >= I + ke ? 0 : 1 - (oe - I) / ke;
      ue = Math.max(0, Math.min(1, ie * ye));
    }
    C[A] = J; C[A + 1] = de; C[A + 2] = te; C[A + 3] = Math.round(Pe * (1 - ue));
  }
  return out;
}

// ---- knockout by colour (global, or flood-fill "area" from a seed) ----
export function knockoutColor(src, opts) {
  const d = src.data, l = src.width, u = src.height, P = l * u;
  if (l < 1 || u < 1 || P > MAX_PIXELS || d.length !== P * 4) throw new Error('Buffer pixel Knockout Warna tidak valid.');
  const t = opts.target || {};
  const n = clamp255(t.red), r = clamp255(t.green), s = clamp255(t.blue);
  const m = Math.max(0, Number(opts.tolerance) || 0);
  const h = Math.max(0, Number(opts.feather) || 0);
  const w = d.slice();
  let changed = 0;
  const weight = (i) => {
    const L = i * 4;
    if (d[L + 3] === 0) return 0;
    const dr = d[L] - n, dg = d[L + 1] - r, db = d[L + 2] - s;
    const T = Math.sqrt(dr * dr + dg * dg + db * db);
    return T <= m ? 1 : h > 0 && T < m + h ? 1 - (T - m) / h : 0;
  };
  const apply = (i, k = weight(i)) => {
    if (k <= 0) return false;
    const a = i * 4 + 3, na = Math.round(d[a] * (1 - k));
    if (na === d[a]) return false;
    w[a] = na; changed++; return true;
  };
  const result = () => ({ data: new ImageData(w, l, u), changed });
  if (opts.mode !== 'area') { for (let i = 0; i < P; i++) apply(i); return result(); }
  const E = Math.floor(Number(opts.seed?.x)), O = Math.floor(Number(opts.seed?.y));
  if (!Number.isFinite(E) || !Number.isFinite(O) || E < 0 || O < 0 || E >= l || O >= u) return result();
  const start = O * l + E;
  if (weight(start) <= 0) return result();
  const seen = new Uint8Array(P), queue = new Int32Array(P);
  let head = 0, tail = 0;
  seen[start] = 1; queue[tail++] = start;
  const push = (i) => { if (i < 0 || i >= P || seen[i]) return; seen[i] = 1; if (weight(i) > 0) queue[tail++] = i; };
  while (head < tail) {
    const i = queue[head++], x = i % l;
    apply(i);
    if (x > 0) push(i - 1);
    if (x < l - 1) push(i + 1);
    if (i >= l) push(i - l);
    if (i < P - l) push(i + l);
  }
  return result();
}

// ---- raster (chunked so the page stays responsive). Returns {promise, cancel} ----
// Round: black dots sized by darkness × opacity, masked by the source alpha, drawn over the
// source. (Knockout Black afterwards turns those dots into holes: the classic DTF raster.)
// Line: lines at an angle whose thickness follows darkness (or lightness on a black shirt).
// Round with dots: 'keep': the design stays only INSIDE the dots (dot size follows darkness, or lightness
// on a black shirt); everything between the dots becomes transparent, so solid areas stay solid.
export function raster(src, { kind, lpi, angle, blackGarment, onProgress, dots = 'holes' }) {
  let cancelled = false;
  const o = src.width, S = src.height, b = src.data;
  const C = cellForLpi(lpi);
  const le = normalizeLineAngle(angle);
  const promise = new Promise((resolve, reject) => {
    let dotCanvas, dotCtx, srcCanvas, out;
    const keep = kind === 'round' && dots === 'keep';
    if (keep) {
      out = new ImageData(o, S);
    } else if (kind === 'round') {
      dotCanvas = document.createElement('canvas'); srcCanvas = document.createElement('canvas');
      dotCanvas.width = srcCanvas.width = o; dotCanvas.height = srcCanvas.height = S;
      dotCtx = dotCanvas.getContext('2d'); srcCanvas.getContext('2d').putImageData(src, 0, 0);
      dotCtx.fillStyle = '#000000';
    } else {
      out = new ImageData(o, S);
    }
    const te = out?.data;
    let row = 0;
    const step = () => {
      if (cancelled) return reject(new Error('cancelled'));
      try {
        const chunk = kind === 'round'
          ? Math.max(C, Math.max(1, Math.floor(18e4 / Math.max(1, o * C))) * C)
          : Math.max(8, Math.floor(26e4 / Math.max(1, o)));
        const end = Math.min(S, row + chunk);
        if (keep) {
          const half = 0.70711 * C;
          for (let cy0 = row; cy0 < end; cy0 += C) {
            const cy1 = Math.min(S, cy0 + C);
            for (let cx0 = 0; cx0 < o; cx0 += C) {
              const cx1 = Math.min(o, cx0 + C);
              let wSum = 0, iSum = 0;
              for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) {
                const p = (y * o + x) * 4, wt = b[p + 3] / 255;
                const lum = (0.299 * b[p] + 0.587 * b[p + 1] + 0.114 * b[p + 2]) / 255;
                wSum += wt; iSum += (blackGarment ? lum : 1 - lum) * wt;
              }
              const inten = wSum ? Math.max(0, Math.min(1, iSum / wSum)) : 0;
              const solid = inten >= 0.97;
              const r = Math.sqrt(inten) * half;
              const mx = (cx0 + cx1) / 2, my = (cy0 + cy1) / 2;
              for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) {
                const p = (y * o + x) * 4;
                const dx = x + 0.5 - mx, dy = y + 0.5 - my;
                const cov = solid ? 1 : Math.max(0, Math.min(1, r + 0.5 - Math.sqrt(dx * dx + dy * dy)));
                te[p] = b[p]; te[p + 1] = b[p + 1]; te[p + 2] = b[p + 2]; te[p + 3] = Math.round(b[p + 3] * cov);
              }
            }
          }
        } else if (kind === 'round') {
          const path = new Path2D();
          for (let ie = row; ie < end; ie += C) {
            const ye = Math.min(S, ie + C);
            for (let Z = 0; Z < o; Z += C) {
              const Ne = Math.min(o, Z + C);
              let _e = 0, Ge = 0, We = 0;
              for (let y = ie; y < ye; y++) for (let x = Z; x < Ne; x++) {
                const p = (y * o + x) * 4, wt = b[p + 3] / 255;
                const lum = (0.299 * b[p] + 0.587 * b[p + 1] + 0.114 * b[p + 2]) / 255;
                _e += wt; Ge += lum * wt; We++;
              }
              const aa = We ? _e / We : 0, oa = _e ? Ge / _e : 1;
              const sa = Math.max(0, Math.min(1, (1 - oa) * aa));
              const xa = Ne - Z, Sa = ye - ie;
              const la = Math.sqrt(sa) * Math.min(xa, Sa) * 0.52;
              const cx = Z + xa / 2, cy = ie + Sa / 2;
              if (la > 0.18) { path.moveTo(cx + la, cy); path.arc(cx, cy, la, 0, Math.PI * 2); }
            }
          }
          dotCtx.fill(path);
        } else {
          const me = C / 2;
          for (let ie = row; ie < end; ie++) for (let ye = 0; ye < o; ye++) {
            const Z = (ie * o + ye) * 4;
            const Ne = b[Z + 3] / 255;
            const lum = (0.299 * b[Z] + 0.587 * b[Z + 1] + 0.114 * b[Z + 2]) / 255;
            const Ge = Math.max(0, Math.min(1, (blackGarment ? lum : 1 - lum) * Ne));
            const We = lineCoordinate(ye, ie, le);
            const aa = ((We % C) + C) % C;
            const oa = Math.min(Math.abs(aa - me), C - Math.abs(aa - me));
            const sa = Math.max(0, Math.min(1, Ge * me + 0.5 - oa));
            te[Z] = b[Z]; te[Z + 1] = b[Z + 1]; te[Z + 2] = b[Z + 2]; te[Z + 3] = Math.round(b[Z + 3] * sa);
          }
        }
        row = end;
        onProgress?.(row / S);
        if (row < S) { requestAnimationFrame(step); return; }
        if (kind === 'round' && !keep) {
          dotCtx.globalCompositeOperation = 'destination-in';
          dotCtx.drawImage(srcCanvas, 0, 0);
          dotCtx.globalCompositeOperation = 'source-over';
          const final = document.createElement('canvas'); final.width = o; final.height = S;
          const fctx = final.getContext('2d', { willReadFrequently: true });
          fctx.putImageData(src, 0, 0); fctx.drawImage(dotCanvas, 0, 0);
          resolve(fctx.getImageData(0, 0, o, S));
        } else {
          // same canvas round-trip as the previous site (keeps results byte-identical)
          const final = document.createElement('canvas'); final.width = o; final.height = S;
          const fctx = final.getContext('2d', { willReadFrequently: true });
          fctx.putImageData(out, 0, 0);
          resolve(fctx.getImageData(0, 0, o, S));
        }
      } catch (e) { reject(e); }
    };
    requestAnimationFrame(step);
  });
  return { promise, cancel: () => { cancelled = true; }, cell: C, angle: le };
}

export const OPERATION_LABELS = {
  original: 'Original',
  knockout_black: 'Knockout Black', knockout_white: 'Knockout White', knockout_color: 'Knockout Warna',
  raster_round: 'Raster Bulat', raster_line: 'Raster Garis',
  raster_round_knockout_black: 'Raster Bulat + Knockout Black', raster_round_knockout_white: 'Raster Bulat + Knockout White',
  raster_round_knockout_color: 'Raster Bulat + Knockout Warna', raster_line_knockout_black: 'Raster Garis + Knockout Black',
  raster_line_knockout_white: 'Raster Garis + Knockout White', raster_line_knockout_color: 'Raster Garis + Knockout Warna',
};
export const OPERATION_SLUG = {
  raster_round: 'raster-bulat', raster_line: 'raster-garis', knockout_black: 'knockout-black', knockout_white: 'knockout-white',
  knockout_color: 'knockout-warna', raster_round_knockout_black: 'raster-bulat-knockout-black',
  raster_round_knockout_white: 'raster-bulat-knockout-white', raster_round_knockout_color: 'raster-bulat-knockout-warna',
  raster_line_knockout_black: 'raster-garis-knockout-black', raster_line_knockout_white: 'raster-garis-knockout-white',
  raster_line_knockout_color: 'raster-garis-knockout-warna',
};

// ---------- PNG print resolution ----------
// Canvas PNGs carry no DPI, so RIP software assumes 72/96 DPI. Insert a pHYs chunk (pixels per metre)
// right after IHDR, replacing any existing pHYs, so the file opens at the right print size.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function setPngDpi(buffer, dpi = 300) {
  const src = new Uint8Array(buffer);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (src.length < 33 || sig.some((v, i) => src[i] !== v)) return src;      // not a PNG: leave it alone
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);                                   // "pHYs"
  cv.setUint32(8, ppm); cv.setUint32(12, ppm); chunk[16] = 1;               // unit: metre
  cv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const parts = [src.subarray(0, 8)];
  let off = 8, inserted = false;
  while (off + 12 <= src.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(src[off + 4], src[off + 5], src[off + 6], src[off + 7]);
    const end = off + 12 + len;
    if (type !== 'pHYs') parts.push(src.subarray(off, end));
    if (type === 'IHDR' && !inserted) { parts.push(chunk); inserted = true; }
    off = end;
    if (type === 'IEND') break;
  }
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
