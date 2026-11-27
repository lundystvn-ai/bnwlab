// Print files for a gangsheet: transparent PNG at real size (one file, or a ZIP for several sheets),
// a PDF at real page size, and a production CSV. Sheets are drawn in horizontal bands so very long
// sheets do not need one huge canvas.
import { box, effectiveDpi, mmToPx, pagesOf } from './engine.js';
import { canvas, drawItem, imageFor } from './media.js';

const MM_PER_INCH = 25.4;
const MAX_BAND_PIXELS = 1024 * 1024;
const MAX_BAND_ROWS = 128;
const MAX_TILE_WIDTH = 8192;
const noop = () => {};
const bandRows = (width) => Math.max(1, Math.min(MAX_BAND_ROWS, Math.floor(MAX_BAND_PIXELS / width)));

export function safeName(name) {
  const clean = String(name ?? '').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, '-').replace(/\s+/gu, ' ').replace(/^[-.\s]+|[-.\s]+$/gu, '');
  const short = Array.from(clean).slice(0, 100).join('').replace(/[.\s]+$/u, '');
  if (!short) return 'gangsheet';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(short) ? `_${short}` : short;
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a);
  try { a.click(); } finally { a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}

function csvText(value) {
  let text = String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
  if (/^[\t\r\n]|^\s*[=+@\-＝＋＠－]/u.test(text)) text = `'${text}`;   // keep spreadsheets from running formulas
  return `"${text.replace(/"/gu, '""')}"`;
}
const decimal = (v) => (Number.isFinite(v) ? String(Number(v.toFixed(4))) : '');

export function csv(job, pages = pagesOf(job), mirror = false) {
  const header = ['Proyek', 'Lembar', 'Lebar lembar (mm)', 'Panjang lembar (mm)', 'Desain', 'ID desain', 'ID salinan', 'X (mm)', 'Y (mm)', 'X cetak (mm)',
    'Lebar desain (mm)', 'Tinggi desain (mm)', 'Lebar bidang (mm)', 'Tinggi bidang (mm)', 'Rotasi (°)', 'Cermin X', 'Cermin Y', 'Lembar dicerminkan', 'DPI efektif'];
  const rows = [header.join(',')], arts = new Map(job.arts.map((a) => [a.id, a]));
  for (const page of pages) for (const item of page.items) {
    const art = arts.get(item.artId); if (!art) throw new Error('missing_art');
    const angle = item.angle || 0, b = box(art.w, art.h, angle), printX = mirror ? job.settings.width - item.x - b.w : item.x;
    rows.push([csvText(job.name), page.index + 1, decimal(job.settings.width), decimal(page.length), csvText(art.name), csvText(art.id), csvText(item.id),
      decimal(item.x), decimal(item.y), decimal(printX), decimal(art.w), decimal(art.h), decimal(b.w), decimal(b.h), decimal(angle),
      item.flipX ? 'Ya' : 'Tidak', item.flipY ? 'Ya' : 'Tidak', mirror ? 'Ya' : 'Tidak', art.vector ? 'Vektor' : decimal(effectiveDpi(art))].join(','));
  }
  return `${rows.join('\r\n')}\r\n`;
}

// ---------- PNG ----------
const crcTable = Uint32Array.from({ length: 256 }, (_, v) => { let c = v; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; return c >>> 0; });
function pngChunk(name, bytes) {
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, bytes.length);
  for (let i = 0; i < 4; i++) head[i + 4] = name.charCodeAt(i);
  let crc = 0xffffffff;
  for (let i = 4; i < 8; i++) crc = crcTable[(crc ^ head[i]) & 255] ^ (crc >>> 8);
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  const foot = new Uint8Array(4);
  new DataView(foot.buffer).setUint32(0, (crc ^ 0xffffffff) >>> 0);
  return new Blob([head, bytes, foot]);
}

async function compress(scanlines, onChunk) {
  if (typeof CompressionStream === 'function') {
    const raw = new ReadableStream({
      async pull(ctrl) { const n = await scanlines.next(); if (n.done) ctrl.close(); else ctrl.enqueue(n.value); },
      cancel() { return scanlines.return(); },
    });
    const reader = raw.pipeThrough(new CompressionStream('deflate')).getReader();
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; onChunk(value); } }
    finally { await reader.cancel().catch(noop); reader.releaseLock(); }
    return;
  }
  const { Deflate } = await import('pako');
  const d = new Deflate(); d.onData = onChunk;
  for await (const data of scanlines) if (!d.push(data, false)) throw new Error(d.msg || 'deflate');
  if (!d.push(new Uint8Array(0), true)) throw new Error(d.msg || 'deflate');
}

// One zlib stream across all IDAT chunks. Rows use the "Sub" filter, which suits flat artwork well.
export async function encodePng(width, height, dpi, readRows, onProgress = noop) {
  if (![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 0x7fffffff)) throw new RangeError('png_size');
  const ppm = Math.round(dpi / 0.0254);
  const ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width); hv.setUint32(4, height); ihdr.set([8, 6, 0, 0, 0], 8);
  const phys = new Uint8Array(9), pv = new DataView(phys.buffer);
  pv.setUint32(0, ppm); pv.setUint32(4, ppm); phys[8] = 1;
  // sRGB chunk: tells printers and RIP software the colours are sRGB (perceptual intent).
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), pngChunk('IHDR', ihdr), pngChunk('sRGB', Uint8Array.of(0)), pngChunk('pHYs', phys)];
  const stride = width * 4, perBand = bandRows(width);
  async function* scanlines() {
    for (let y = 0; y < height; y += perBand) {
      const h = Math.min(perBand, height - y), rgba = await readRows(y, h);
      if (rgba.byteLength !== stride * h) throw new Error('band');
      const out = new Uint8Array((stride + 1) * h);
      for (let row = 0; row < h; row++) {
        const src = row * stride, dst = row * (stride + 1);
        out[dst] = 1;   // Sub filter
        for (let k = 0; k < 4 && k < stride; k++) out[dst + 1 + k] = rgba[src + k];
        for (let k = 4; k < stride; k++) out[dst + 1 + k] = (rgba[src + k] - rgba[src + k - 4]) & 255;
      }
      yield out;
      onProgress((y + h) / height);
    }
  }
  await compress(scanlines(), (data) => parts.push(pngChunk('IDAT', data)));
  parts.push(pngChunk('IEND', new Uint8Array(0)));
  return new Blob(parts, { type: 'image/png' });
}

function pageRaster(job, page, dpi, mirror, arts, images) {
  const scale = dpi / MM_PER_INCH, width = mmToPx(job.settings.width, dpi), height = mmToPx(page.length, dpi);
  const placements = page.items.map((item) => {
    const art = arts.get(item.artId); if (!art) throw new Error('missing_art');
    const b = box(art.w, art.h, item.angle || 0), left = mirror ? width - (item.x + b.w) * scale : item.x * scale;
    return { item, art, left, right: left + b.w * scale, top: item.y * scale, bottom: (item.y + b.h) * scale };
  });
  const tileWidth = Math.min(width, MAX_TILE_WIDTH);
  let surface, ctx;
  async function readRows(y, h) {
    if (!surface) { surface = canvas(tileWidth, h); ctx = surface.getContext('2d', { alpha: true, willReadFrequently: true }); if (!ctx) throw new Error('canvas'); }
    else if (surface.height !== h) surface.height = h;
    const visible = placements.filter((p) => p.top < y + h + 1 && p.bottom > y - 1);
    const pixels = width > tileWidth ? new Uint8Array(width * h * 4) : null;
    for (let x = 0; x < width; x += tileWidth) {
      const w = Math.min(tileWidth, width - x);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, tileWidth, h);
      ctx.setTransform(mirror ? -1 : 1, 0, 0, 1, (mirror ? width : 0) - x, -y);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      for (const p of visible) {
        if (p.right <= x - 1 || p.left >= x + w + 1) continue;
        if (!images.has(p.art.id)) images.set(p.art.id, imageFor(p.art));
        drawItem(ctx, await images.get(p.art.id), p.art, p.item, scale);
      }
      const tile = ctx.getImageData(0, 0, w, h).data;
      if (!pixels) return tile;
      for (let row = 0; row < h; row++) pixels.set(tile.subarray(row * w * 4, (row + 1) * w * 4), (row * width + x) * 4);
    }
    return pixels;
  }
  return { width, height, readRows };
}

// ---------- PDF ----------
function addPdfBand(lib, doc, page, rgba, width, height, pageWidth, bottom, bandHeight) {
  const count = width * height, rgb = new Uint8Array(count * 3), alpha = new Uint8Array(count);
  let visible = false;
  for (let p = 0; p < count; p++) {
    rgb[p * 3] = rgba[p * 4]; rgb[p * 3 + 1] = rgba[p * 4 + 1]; rgb[p * 3 + 2] = rgba[p * 4 + 2];
    alpha[p] = rgba[p * 4 + 3]; if (alpha[p]) visible = true;
  }
  if (!visible) return;
  const common = { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, BitsPerComponent: 8 };
  const mask = doc.context.register(doc.context.flateStream(alpha, { ...common, ColorSpace: 'DeviceGray', Decode: [0, 1] }));
  const image = doc.context.register(doc.context.flateStream(rgb, { ...common, ColorSpace: 'DeviceRGB', SMask: mask }));
  const name = page.node.newXObject('Strip', image);
  page.pushOperators(lib.pushGraphicsState(), lib.concatTransformationMatrix(pageWidth, 0, 0, bandHeight, 0, bottom), lib.drawObject(name), lib.popGraphicsState());
}

async function pdfExport(job, pages, rasterFor, report) {
  const lib = await import('pdf-lib');
  const doc = await lib.PDFDocument.create();
  doc.setTitle(String(job.name || 'Gangsheet')); doc.setCreator('BNW Design Lab · Gangsheet'); doc.setProducer('BNW Design Lab');
  for (const [index, page] of pages.entries()) {
    const wPt = (job.settings.width * 72) / MM_PER_INCH, hPt = (page.length * 72) / MM_PER_INCH;
    const unit = Math.max(1, Math.ceil(Math.max(wPt, hPt) / 14_400));   // PDF pages are limited to 14,400 units per side
    const pageWidth = wPt / unit, pageHeight = hPt / unit, pdfPage = doc.addPage([pageWidth, pageHeight]);
    if (unit > 1) pdfPage.node.set(lib.PDFName.of('UserUnit'), lib.PDFNumber.of(unit));
    const raster = rasterFor(page), rows = bandRows(raster.width);
    let yieldedAt = performance.now();
    for (let y = 0; y < raster.height; y += rows) {
      const h = Math.min(rows, raster.height - y);
      const bottom = (pageHeight * (raster.height - y - h)) / raster.height, bandHeight = (pageHeight * h) / raster.height;
      addPdfBand(lib, doc, pdfPage, await raster.readRows(y, h), raster.width, h, pageWidth, bottom, bandHeight);
      report((0.94 * (index + (y + h) / raster.height)) / pages.length, page.index);
      if (performance.now() - yieldedAt > 40) { await new Promise((r) => setTimeout(r, 0)); yieldedAt = performance.now(); }
    }
  }
  report(0.96, -1);
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

// Builds the file. progress(fraction, sheetIndex) — sheetIndex is -1 while saving/packaging.
export async function buildExport(job, { format = 'png', pageIndex = null, mirror = false, dpi = 300 } = {}, progress = noop) {
  if (!['png', 'pdf', 'csv'].includes(format)) throw new Error('format');
  if (![72, 150, 300].includes(dpi)) throw new Error('dpi');
  const pages = pagesOf(job).filter((p) => pageIndex === null || p.index === pageIndex);
  if (!pages.length) throw new Error('no_sheet');
  const base = safeName(job.name), tag = (p) => `lembar-${String(p.index + 1).padStart(2, '0')}`;
  const scope = pageIndex === null ? base : `${base}-${tag(pages[0])}`, suffix = `${dpi}dpi${mirror ? '-cermin' : ''}`;
  const arts = new Map(job.arts.map((a) => [a.id, a])), images = new Map();
  const rasterFor = (page) => pageRaster(job, page, dpi, mirror, arts, images);
  progress(0, -1);
  let blob, name;
  if (format === 'csv') {
    blob = new Blob(['﻿', csv(job, pages, mirror)], { type: 'text/csv;charset=utf-8' });
    name = `${scope}-rekap.csv`;
  } else if (format === 'pdf') {
    blob = await pdfExport(job, pages, rasterFor, progress);
    name = `${scope}-${suffix}.pdf`;
  } else {
    const zip = pages.length > 1 ? new (await import('jszip')).default() : null;
    for (const [index, page] of pages.entries()) {
      const raster = rasterFor(page);
      const png = await encodePng(raster.width, raster.height, dpi, raster.readRows, (f) => progress(((zip ? 0.92 : 0.98) * (index + f)) / pages.length, page.index));
      name = `${base}-${tag(page)}-${suffix}.png`;
      if (zip) zip.file(name, await png.arrayBuffer()); else blob = png;
    }
    if (zip) {
      zip.file(`${base}-rekap.csv`, `﻿${csv(job, pages, mirror)}`);
      name = `${base}-${suffix}.zip`;
      blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, (info) => progress(0.92 + (0.08 * Math.min(100, info.percent)) / 100, -1));
    }
  }
  progress(1, -1);
  return { blob, name, pages };
}
