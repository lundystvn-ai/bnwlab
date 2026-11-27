// Reading artwork into a gangsheet job: PNG/JPG/WebP/SVG/PDF, print size, transparency mask, text designs.
// Everything happens in the browser; nothing is uploaded.
import { uid, cropOf, MASK_SIZE } from './engine.js';

const images = new Map();
export const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
export const blobOf = (c) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
export const readData = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('read')); r.readAsDataURL(blob); });

export function imageFor(a) {
  if (!images.has(a.src)) images.set(a.src, new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => { images.delete(a.src); rej(new Error('image')); };
    im.src = a.src;
  }));
  return images.get(a.src);
}
export function releaseUnused(keep) { for (const key of images.keys()) if (!keep.has(key)) images.delete(key); }
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------- print resolution stored in the file ----------
// PNG pHYs, JPEG JFIF density or EXIF XResolution. Screen defaults (72/96) say nothing about print size,
// so only 100–1200 DPI is used; otherwise the design is sized at 300 DPI.
export function fileDpi(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let dpi = 0;
  try {
    if (u8.length > 24 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
      for (let p = 8; p + 8 <= u8.length;) {
        const len = dv.getUint32(p), type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
        if (type === 'pHYs' && len >= 9) { if (u8[p + 16] === 1) dpi = dv.getUint32(p + 8) * 0.0254; break; }
        if (type === 'IDAT' || type === 'IEND') break;
        p += 12 + len;
      }
    } else if (u8[0] === 0xff && u8[1] === 0xd8) {
      for (let p = 2; p + 4 < u8.length;) {
        if (u8[p] !== 0xff) break;
        const marker = u8[p + 1], len = dv.getUint16(p + 2);
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 0xe0 && String.fromCharCode(...u8.subarray(p + 4, p + 9)) === 'JFIF\0') {
          const units = u8[p + 11], x = dv.getUint16(p + 12);
          if (units === 1) dpi = x; else if (units === 2) dpi = x * 2.54;
          if (dpi) break;
        }
        if (marker === 0xe1 && String.fromCharCode(...u8.subarray(p + 4, p + 8)) === 'Exif') {
          const t = p + 10, le = u8[t] === 0x49, g16 = (o) => dv.getUint16(t + o, le), g32 = (o) => dv.getUint32(t + o, le);
          const ifd = g32(4), n = g16(ifd);
          let res = 0, unit = 2;
          for (let k = 0; k < n; k++) {
            const e = ifd + 2 + k * 12, tag = g16(e);
            if (tag === 0x011a) { const o = g32(e + 8); res = g32(o) / (g32(o + 4) || 1); }
            if (tag === 0x0128) unit = g16(e + 8);
          }
          if (res) { dpi = unit === 3 ? res * 2.54 : res; break; }
        }
        p += 2 + len;
      }
    }
  } catch { dpi = 0; }
  dpi = Math.round(dpi * 10) / 10;
  return dpi >= 100 && dpi <= 1200 ? dpi : 0;
}

// ---------- transparency ----------
function rowsOf(data, w, h) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    let from = -1; const spans = [];
    for (let x = 0; x <= w; x++) {
      if (x < w && data[y * w + x]) { if (from < 0) from = x; } else if (from >= 0) { spans.push(from, x); from = -1; }
    }
    rows.push(spans);
  }
  return { w, h, rows };
}

// Visible bounds and a coarse ink mask (SVGs too, so shape packing works for vector logos) (at most 64 × 64 cells, marked generously so copies never overlap).
async function scan(im, r) {
  const w = r.w, h = r.h, mw = Math.min(w, MASK_SIZE), mh = Math.min(h, MASK_SIZE), bits = new Uint8Array(mw * mh);
  const c = canvas(Math.min(w, 2048), Math.min(h, 192)), ctx = c.getContext('2d', { willReadFrequently: true });
  let minX = w, minY = h, maxX = -1, maxY = -1, solid = true, t = 0;
  const loX = Uint16Array.from({ length: w }, (_, x) => Math.floor((x * mw) / w)), hiX = Uint16Array.from({ length: w }, (_, x) => Math.ceil(((x + 1) * mw) / w) - 1);
  for (let yy = 0; yy < h; yy += c.height) for (let xx = 0; xx < w; xx += c.width) {
    const dw = Math.min(w - xx, c.width), dh = Math.min(h - yy, c.height);
    ctx.clearRect(0, 0, dw, dh); ctx.drawImage(im, r.x + xx, r.y + yy, dw, dh, 0, 0, dw, dh);
    const pix = ctx.getImageData(0, 0, dw, dh).data;
    for (let y = 0; y < dh; y++) {
      const sy = yy + y, low = Math.floor((sy * mh) / h) * mw, high = (Math.ceil(((sy + 1) * mh) / h) - 1) * mw;
      for (let x = 0, k = y * dw * 4 + 3; x < dw; x++, k += 4) {
        if (pix[k] === 0) { solid = false; continue; }
        const sx = x + xx, left = loX[sx], right = hiX[sx];
        bits[low + left] = bits[low + right] = bits[high + left] = bits[high + right] = 1;
        if (sx < minX) minX = sx; if (sx > maxX) maxX = sx; if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
      }
    }
    if (++t % 16 === 0) await tick();
  }
  c.width = c.height = 1;
  if (maxX < minX) throw new Error('empty');
  return { bounds: { x: r.x + minX, y: r.y + minY, w: maxX - minX + 1, h: maxY - minY + 1 }, mask: solid ? null : rowsOf(bits, mw, mh) };
}

export async function analyse(src, name, { vector = false, physical = null, dpi = 0 } = {}) {
  const im = await imageFor({ src, name }), sw = im.naturalWidth, sh = im.naturalHeight;
  if (!sw || !sh) throw new Error('size');
  const { bounds, mask } = await scan(im, { x: 0, y: 0, w: sw, h: sh });
  const cropped = bounds.x || bounds.y || bounds.w !== sw || bounds.h !== sh;
  const tight = cropped ? (await scan(im, bounds)).mask : mask;
  const usedDpi = dpi || 300;
  const w = physical?.w ?? (vector ? 100 : (sw * 25.4) / usedDpi), h = physical?.h ?? (w * sh) / sw;
  return { id: uid(), src, name, vector, sw, sh, w, h, bounds, trim: false, fileDpi: dpi || 0, fullMask: mask, trimMask: tight };
}

// SVG width/height in physical units, if the file says so.
function svgSize(root) {
  const unit = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };
  const read = (v) => { const m = /^\s*([\d.]+)\s*(mm|cm|in|pt|pc|px)?\s*$/i.exec(v || ''); return m ? Number(m[1]) * unit[(m[2] || '').toLowerCase()] : 0; };
  const w = read(root.getAttribute('width')), h = read(root.getAttribute('height'));
  return w > 0 && h > 0 && /(mm|cm|in|pt|pc)\s*$/i.test(root.getAttribute('width') || '') ? { w, h } : null;
}

async function svgFile(file) {
  const doc = new DOMParser().parseFromString(await file.text(), 'image/svg+xml'), root = doc.documentElement;
  if (root.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('svg');
  root.querySelectorAll('script,foreignObject,animate,animateMotion,animateTransform,set').forEach((n) => n.remove());
  for (const style of root.querySelectorAll('style')) if (/@import|url\(\s*['"]?(?:https?:|\/\/)/i.test(style.textContent)) style.remove();
  for (const n of [root, ...root.querySelectorAll('*')]) for (const a of [...n.attributes]) {
    if (/^on/i.test(a.name)) { n.removeAttributeNode(a); continue; }
    if ((/href$/i.test(a.name) && a.value && !/^(#|data:image\/(png|jpeg|webp);base64,)/i.test(a.value)) || /url\(\s*['"]?(?:https?:|\/\/)/i.test(a.value)) throw new Error('svg_external');
  }
  const physical = svgSize(root);
  const v = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (v.length === 4 && v[2] > 0 && v[3] > 0) {
    // Draw large enough to look sharp when previewed and printed.
    const k = Math.max(1, 2400 / Math.max(v[2], v[3]));
    root.setAttribute('width', v[2] * k); root.setAttribute('height', v[3] * k);
  }
  const b = new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' });
  if (!root.querySelector('image')) return analyse(await readData(b), file.name, { vector: true, physical });
  const im = await imageFor({ src: await readData(b), name: file.name }), c = canvas(im.naturalWidth, im.naturalHeight);
  c.getContext('2d').drawImage(im, 0, 0);
  const res = await analyse(await readData(await blobOf(c)), file.name, { physical });
  c.width = c.height = 1;
  return res;
}

let pdfjsPromise = null;
async function pdfjs() {
  if (!pdfjsPromise) pdfjsPromise = (async () => {
    const lib = await import('pdfjs-dist');
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    lib.GlobalWorkerOptions.workerSrc = worker;
    return lib;
  })().catch((e) => { pdfjsPromise = null; throw e; });
  return pdfjsPromise;
}

// Yields one design per file, or one per page for PDFs.
export async function* readArtwork(file) {
  const name = file.name || 'Desain', ext = name.split('.').pop().toLowerCase();
  if (ext === 'pdf' || file.type === 'application/pdf') {
    const lib = await pdfjs(), base = new URL('/pdfjs/', location.href).href;
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false,
      cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/', wasmUrl: base + 'wasm/', iccUrl: base + 'iccs/' }).promise;
    try {
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n), v1 = page.getViewport({ scale: 1 });
        const scale = Math.min(300 / 72, Math.sqrt(32000000 / (v1.width * v1.height)), 16384 / Math.max(v1.width, v1.height));
        const v = page.getViewport({ scale }), c = canvas(Math.ceil(v.width), Math.ceil(v.height));
        try {
          await page.render({ canvasContext: c.getContext('2d'), canvas: c, viewport: v, background: 'rgba(0,0,0,0)' }).promise;
          yield await analyse(await readData(await blobOf(c)), name.replace(/\.pdf$/i, '') + (doc.numPages > 1 ? ' · ' + n : ''), { physical: { w: (v1.width * 25.4) / 72, h: (v1.height * 25.4) / 72 } });
        } finally { c.width = c.height = 1; page.cleanup(); }
      }
    } finally { await doc.destroy(); }
    return;
  }
  if (ext === 'svg' || file.type === 'image/svg+xml') { yield await svgFile(file); return; }
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext] || file.type;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new Error('format');
  const bytes = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  yield await analyse(await readData(new Blob([file], { type: mime })), name.replace(/\.(png|jpe?g|webp)$/i, ''), { dpi: fileDpi(bytes) });
}

export function drawItem(ctx, im, a, i, scale = 1) {
  const c = cropOf(a);
  const b = { w: Math.abs(Math.cos((i.angle * Math.PI) / 180)) * a.w + Math.abs(Math.sin((i.angle * Math.PI) / 180)) * a.h, h: Math.abs(Math.sin((i.angle * Math.PI) / 180)) * a.w + Math.abs(Math.cos((i.angle * Math.PI) / 180)) * a.h };
  ctx.save();
  ctx.translate((i.x + b.w / 2) * scale, (i.y + b.h / 2) * scale);
  ctx.rotate((i.angle * Math.PI) / 180);
  ctx.scale(i.flipX ? -1 : 1, i.flipY ? -1 : 1);
  ctx.drawImage(im, c.x, c.y, c.w, c.h, (-a.w * scale) / 2, (-a.h * scale) / 2, a.w * scale, a.h * scale);
  ctx.restore();
}

export async function makeText(cfg) {
  const lines = cfg.text.trim().split(/\n/).slice(0, 10);
  if (!lines[0]) throw new Error('text');
  const family = { sans: 'Arial, sans-serif', serif: 'Georgia, serif', mono: 'monospace', display: 'Impact, "Arial Black", sans-serif' }[cfg.family] || 'sans-serif';
  const measure = canvas(1, 1).getContext('2d');
  measure.font = (cfg.italic ? 'italic ' : '') + (cfg.bold ? 'bold ' : '') + '110px ' + family;
  const w = Math.ceil(Math.max(...lines.map((l) => measure.measureText(l).width))) + 32, h = lines.length * 145 + 26;
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  for (const [n, line] of lines.entries()) {
    const text = document.createElementNS(ns, 'text');
    const attrs = { x: cfg.align === 'center' ? w / 2 : 16, y: 120 + n * 145, 'text-anchor': cfg.align === 'center' ? 'middle' : 'start', 'font-size': 110, 'font-family': family,
      'font-weight': cfg.bold ? 'bold' : 'normal', 'font-style': cfg.italic ? 'italic' : 'normal', fill: cfg.color };
    if (cfg.stroke) Object.assign(attrs, { stroke: cfg.strokeColor, 'stroke-width': 6, 'paint-order': 'stroke' });
    for (const [k, v] of Object.entries(attrs)) text.setAttribute(k, v);
    text.textContent = line;
    svg.append(text);
  }
  const a = await analyse(await readData(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })), lines[0].slice(0, 45), { vector: true });
  a.textConfig = cfg;
  return a;
}

// Make a plain background transparent: pixels close to the chosen colour that touch the image edge.
export async function removeEdgeColor(a, hex, tolerance) {
  const im = await imageFor(a), w = im.naturalWidth, h = im.naturalHeight;
  if (w * h > 36000000) throw new Error('too_large');
  const c = canvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(im, 0, 0);
  const data = ctx.getImageData(0, 0, w, h), px = data.data, seen = new Uint8Array(w * h), queue = new Int32Array(w * h);
  const rgb = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)), tol = tolerance * 2.55;
  let head = 0, tail = 0, changed = false;
  const enter = (p) => {
    if (seen[p]) return; seen[p] = 1;
    const k = p * 4;
    if (px[k + 3] && Math.max(Math.abs(px[k] - rgb[0]), Math.abs(px[k + 1] - rgb[1]), Math.abs(px[k + 2] - rgb[2])) > tol) return;
    if (px[k + 3]) changed = true;
    px[k + 3] = 0; queue[tail++] = p;
  };
  for (let x = 0; x < w; x++) { enter(x); enter((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { enter(y * w); enter(y * w + w - 1); }
  while (head < tail) {
    const p = queue[head++], x = p % w;
    if (x) enter(p - 1); if (x < w - 1) enter(p + 1); if (p >= w) enter(p - w); if (p < w * (h - 1)) enter(p + w);
    if (head % 1000000 === 0) await tick();
  }
  if (!changed) throw new Error('no_edge_color');
  ctx.putImageData(data, 0, 0);
  const old = cropOf(a), next = await analyse(await readData(await blobOf(c)), a.name, { dpi: a.fileDpi });
  next.id = a.id; next.trim = a.trim;
  const after = cropOf(next);
  next.w = (a.w * after.w) / old.w; next.h = (a.h * after.h) / old.h;
  c.width = c.height = 1;
  return next;
}
