// Gangsheet layout engine. Pure functions: no DOM, no network, so it also runs in a Web Worker.
// Units are millimetres. A job has settings, arts (designs) and items (placed copies of a design).
// Issues are returned as codes with data; the page turns them into text in the user's language.

export const DEFAULTS = { width: 575, maxLength: 2000, margin: 4, gap: 4, rotate: true, lengthMode: 'trim', packing: 'rect', snap: false };
export const MAX_COPIES = 1500;
export const MASK_SIZE = 64;          // a design's ink is recorded on a grid of at most 64 × 64 cells
const ep = 1e-6;

export const uid = () => crypto.randomUUID?.() || 'gs-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
export const newJob = () => ({ version: 1, name: 'Gangsheet baru', settings: { ...DEFAULTS }, arts: [], items: [] });
export const normalAngle = (a) => ((a % 360) + 360) % 360;
export function box(w, h, a = 0) {
  const c = Math.abs(Math.cos((a * Math.PI) / 180)), s = Math.abs(Math.sin((a * Math.PI) / 180));
  return { w: w * c + h * s, h: w * s + h * c };
}
export const cropOf = (a) => (a.trim ? a.bounds : { x: 0, y: 0, w: a.sw, h: a.sh });
export function effectiveDpi(a) { const c = cropOf(a); return a.vector ? Infinity : Math.min((c.w * 25.4) / a.w, (c.h * 25.4) / a.h); }
export const mmToPx = (v, dpi = 300) => Math.max(1, Math.round((v * dpi) / 25.4));

export function validateSettings(s) {
  const ok = [s.width, s.maxLength, s.margin, s.gap].every(Number.isFinite) && s.width >= 10 && s.width <= 1200 && s.maxLength >= 10 && s.maxLength <= 5000
    && s.margin >= 0 && 2 * s.margin < Math.min(s.width, s.maxLength) && s.gap >= 0 && s.gap <= 100;
  if (!ok) throw new Error('settings');
  if (!['fixed', 'trim'].includes(s.lengthMode) || !['rect', 'shape'].includes(s.packing)) throw new Error('settings');
}

function less(a, b) {
  if (!b) return true;
  for (let n = 0; n < a.length; n++) { if (a[n] < b[n] - ep) return true; if (a[n] > b[n] + ep) return false; }
  return false;
}
const contain = (a, b) => a.x >= b.x - ep && a.y >= b.y - ep && a.x + a.w <= b.x + b.w + ep && a.y + a.h <= b.y + b.h + ep;
const conflict = (a, b, g = 0) => a.x < b.x + b.w + g - ep && a.x + a.w + g > b.x + ep && a.y < b.y + b.h + g - ep && a.y + a.h + g > b.y + ep;

// Maximal-rectangles free list: remove a used rectangle and keep only the free areas not inside another.
function cut(free, u) {
  const next = [];
  for (const f of free) {
    if (!conflict(f, u)) { next.push(f); continue; }
    const fx = f.x + f.w, fy = f.y + f.h, ux = u.x + u.w, uy = u.y + u.h;
    if (u.x > f.x + ep) next.push({ ...f, w: u.x - f.x });
    if (ux < fx - ep) next.push({ ...f, x: ux, w: fx - ux });
    if (u.y > f.y + ep) next.push({ ...f, h: u.y - f.y });
    if (uy < fy - ep) next.push({ ...f, y: uy, h: fy - uy });
  }
  return next.filter((a, i) => !next.some((b, j) => i !== j && contain(a, b) && (!contain(b, a) || j < i)));
}

// Orientations to try. Shape packing also tries 180° and 270°, so L shapes and triangles can nest.
function modes(a, i, s) {
  const base = normalAngle(i.baseAngle || 0);
  let angles = [base];
  if (s.rotate && s.packing === 'shape') angles = [0, 90, 180, 270].map((d) => normalAngle(base + d));
  else if (s.rotate && Math.abs(a.w - a.h) > ep) angles = [base, normalAngle(base + 90)];
  return angles.map((angle) => ({ ...box(a.w, a.h, angle), angle }));
}
const inner = (s, length = s.maxLength) => ({ x: s.margin, y: s.margin, w: s.width - 2 * s.margin + s.gap, h: length - 2 * s.margin + s.gap });

function placement(free, choices, s, bottom, strategy) {
  let best = null;
  for (const f of free) for (const o of choices) {
    const w = o.w + s.gap, h = o.h + s.gap, dx = f.w - w, dy = f.h - h;
    if (dx < -ep || dy < -ep) continue;
    const used = Math.max(bottom, f.y + o.h), short = Math.min(dx, dy);
    const score = strategy === 'short' ? [short, used, f.y, f.x] : [used, f.y, short, f.x];
    if (less(score, best?.score)) best = { x: f.x, y: f.y, w, h, angle: o.angle, used, score };
  }
  return best;
}

function rectanglePass(entries, s, strategy) {
  const sheets = [], placed = new Map();
  for (const e of entries) {
    for (let p = 0; p <= sheets.length; p++) {
      const sheet = sheets[p] ?? { free: [inner(s)], bottom: s.margin };
      const b = placement(sheet.free, e.rectChoices, s, sheet.bottom, strategy);
      if (!b) continue;
      sheet.free = cut(sheet.free, b); sheet.bottom = b.used; sheets[p] = sheet;
      placed.set(e.i.id, { x: b.x, y: b.y, angle: b.angle, page: p });
      break;
    }
  }
  return { placed, score: [entries.length - placed.size, sheets.length, sheets.reduce((n, p) => n + p.bottom + s.margin, 0)] };
}

const maskOf = (a) => (a.trim ? a.trimMask : a.fullMask);
export function fraction(a) {
  const m = maskOf(a); if (!m) return 1;
  let sum = 0; for (const r of m.rows) for (let i = 0; i < r.length; i += 2) sum += r[i + 1] - r[i];
  return sum / (m.w * m.h);
}

// Rectangles covering a copy's ink, in sheet-local coordinates of the copy's frame.
export function maskRects(a, i) {
  const m = maskOf(a), angle = normalAngle(i.angle || 0), b = box(a.w, a.h, angle);
  if (!m || angle % 90 !== 0) return [{ x: 0, y: 0, ...b }];
  const rects = [];
  for (let row = 0; row < m.h; row++) for (let k = 0; k < m.rows[row].length; k += 2) {
    const r = m.rows[row], w = ((r[k + 1] - r[k]) * a.w) / m.w, h = a.h / m.h;
    let x = (r[k] * a.w) / m.w, y = (row * a.h) / m.h;
    if (i.flipX) x = a.w - x - w;
    if (i.flipY) y = a.h - y - h;
    if (angle === 90) rects.push({ x: a.h - y - h, y: x, w: h, h: w });
    else if (angle === 180) rects.push({ x: a.w - x - w, y: a.h - y - h, w, h });
    else if (angle === 270) rects.push({ x: y, y: a.w - x - w, w: h, h: w });
    else rects.push({ x, y, w, h });
  }
  return rects;
}

function rasterRuns(rects, step, pad) {
  const map = new Map();
  for (const r of rects) {
    const x1 = Math.floor((r.x - pad + ep) / step), x2 = Math.ceil((r.x + r.w + pad - ep) / step);
    for (let y = Math.floor((r.y - pad + ep) / step); y < Math.ceil((r.y + r.h + pad - ep) / step); y++) {
      if (!map.has(y)) map.set(y, []);
      map.get(y).push([x1, x2]);
    }
  }
  const result = [];
  for (const [y, row] of map) {
    let last;
    for (const [l, r] of row.sort((a, b) => a[0] - b[0])) {
      if (last && l <= last[2]) last[2] = Math.max(last[2], r); else { last = [y, l, r]; result.push(last); }
    }
  }
  return result;
}

// Shape packing on an occupancy grid. The grid follows the smallest design, between 1.5 and 4 mm per cell,
// so spacing stays close to the chosen gap without making large sheets slow.
export function gridStep(s, entries) {
  const smallest = entries.reduce((m, e) => Math.min(m, e.a.w, e.a.h), Infinity);
  const byDesign = Number.isFinite(smallest) ? smallest / 16 : 4;
  const bySheet = Math.sqrt(((s.width - 2 * s.margin) * (s.maxLength - 2 * s.margin)) / 400000);
  return Math.min(4, Math.max(1.5, byDesign, bySheet));
}

// Occupancy rows are bitsets (32 cells per word), so checking and skipping runs of cells is fast.
function firstSet(words, base, a, b) {
  // First occupied cell in [a, b) of one row, or -1.
  while (a < b) {
    const w = base + (a >>> 5), off = a & 31, bits = words[w] >>> off;
    if (bits) { const k = a + (31 - Math.clz32(bits & -bits)); return k < b ? k : -1; }
    a = (a | 31) + 1;
  }
  return -1;
}
function setRange(words, base, a, b) {
  for (let k = a; k < b;) {
    const off = k & 31, n = Math.min(32 - off, b - k);
    words[base + (k >>> 5)] |= (n === 32 ? 0xffffffff : ((1 << n) - 1) << off);
    k += n;
  }
}

function shapePass(entries, s) {
  if (!entries.some((e) => fraction(e.a) < 0.98)) return null;
  const step = gridStep(s, entries);
  const cols = Math.ceil((s.width - 2 * s.margin) / step) + 1, rows = Math.ceil((s.maxLength - 2 * s.margin) / step) + 1;
  const stride = (cols + 31) >>> 5;
  const sheets = [], placed = new Map(), cache = new Map();
  for (const e of entries) {
    let best = null;
    for (let p = 0; p <= sheets.length && !best; p++) {
      const sh = sheets[p] ?? { words: new Uint32Array(stride * rows), bottom: 0, start: new Map() };
      for (const o of e.choices) {
        const maxX = Math.floor((s.width - 2 * s.margin - o.w + ep) / step), maxY = Math.floor((s.maxLength - 2 * s.margin - o.h + ep) / step);
        if (maxX < 0 || maxY < 0) continue;
        const key = [e.a.id, o.angle, !!e.i.flipX, !!e.i.flipY].join('/');
        if (!cache.has(key)) {
          const r = maskRects(e.a, { ...e.i, angle: o.angle });
          cache.set(key, { ink: rasterRuns(r, step, 0), clearance: rasterRuns(r, step, s.gap) });
        }
        const r = cache.get(key);
        // Smallest x >= x0 where the copy fits on row y, or -1.
        const fitFrom = (x0, y) => {
          let x = x0;
          for (let guard = 0; x <= maxX && guard < cols * 4; guard++) {
            let moved = false;
            for (const [ry, l, rt] of r.ink) {
              const hit = firstSet(sh.words, (y + ry) * stride, x + l, x + rt);
              if (hit >= 0) { x = hit - l + 1; moved = true; break; }
            }
            if (!moved) return x;
          }
          return -1;
        };
        // Cells only ever fill up, so rows that had no room for this shape before still have none.
        const lastY = Math.min(maxY, Math.ceil((sh.bottom + s.gap) / step) + 1);
        let y = sh.start.get(key) ?? 0;
        for (; y <= lastY; y++) {
          if (best && Math.max(sh.bottom, y * step + o.h) > best.score[0] + ep) break;
          const x = fitFrom(0, y);
          if (x >= 0 && x <= maxX) {
            const score = [Math.max(sh.bottom, y * step + o.h), y, x];
            if (less(score, best?.score)) best = { p, sh, o, r, x, y, score };
            break;
          }
          sh.start.set(key, y + 1);
        }
      }
    }
    if (!best) continue;
    const { p, sh, o, r, x, y } = best;
    for (const [dy, l, rt] of r.clearance) {
      const yy = y + dy;
      if (yy >= 0 && yy < rows) setRange(sh.words, yy * stride, Math.max(0, l + x), Math.min(cols, rt + x));
    }
    sh.bottom = Math.max(sh.bottom, y * step + o.h); sheets[p] = sh;
    placed.set(e.i.id, { x: s.margin + x * step, y: s.margin + y * step, angle: o.angle, page: p });
  }
  return { placed, score: [entries.length - placed.size, sheets.length, sheets.reduce((n, x) => n + x.bottom + 2 * s.margin, 0)] };
}

export function pack(j) {
  const s = j.settings; validateSettings(s);
  const arts = new Map(j.arts.map((a) => [a.id, a]));
  const entries = j.items.map((i) => {
    const a = arts.get(i.artId); if (!a) throw new Error('missing_art');
    const choices = modes(a, i, s);
    // The rectangle passes only need two orientations; 180° and 270° give the same bounding box.
    return { i, a, choices, rectChoices: choices.filter((o, n) => n < 2 || s.packing !== 'shape').slice(0, 2) };
  });
  const orders = [(a, b) => b.a.w * b.a.h - a.a.w * a.a.h, (a, b) => Math.max(b.a.w, b.a.h) - Math.max(a.a.w, a.a.h), (a, b) => b.a.h - a.a.h];
  let best;
  for (const [k, cmp] of orders.entries()) {
    const r = rectanglePass(entries.slice().sort(cmp), s, k === 1 ? 'short' : 'bottom');
    if (less(r.score, best?.score)) best = r;
  }
  if (s.packing === 'shape') {
    for (const cmp of orders.slice(0, 2)) {
      const sh = shapePass(entries.slice().sort(cmp), s);
      if (sh && less(sh.score, best.score)) best = sh;
    }
  }
  return j.items.map((i) => ({ ...i, ...(best.placed.get(i.id) || { x: 0, y: 0, page: -1, angle: i.baseAngle || 0 }) }));
}

export function pagesOf(j) {
  const arts = new Map(j.arts.map((a) => [a.id, a])), map = new Map();
  for (const i of j.items) {
    const a = arts.get(i.artId); if (i.page < 0 || !a) continue;
    if (!map.has(i.page)) map.set(i.page, { index: i.page, length: 0, items: [], area: 0 });
    const p = map.get(i.page);
    p.items.push(i);
    p.length = Math.max(p.length, i.y + box(a.w, a.h, i.angle).h + j.settings.margin);
    p.area += a.w * a.h * (j.settings.packing === 'shape' ? fraction(a) : 1);
  }
  return [...map.values()].sort((a, b) => a.index - b.index)
    .map((p) => ({ ...p, length: j.settings.lengthMode === 'fixed' ? j.settings.maxLength : Math.max(1, Math.ceil((p.length - ep) * 10) / 10) }));
}

// Print check. Errors block export; warnings do not.
// Codes: bounds, spacing, unplaced, missing (errors) · dpi, opaque (warnings).
export function inspect(j) {
  const s = j.settings, arts = new Map(j.arts.map((a) => [a.id, a])), errors = [], warnings = [], unplaced = new Map(), byPage = new Map(), cache = new Map();
  for (const a of j.arts) {
    const dpi = effectiveDpi(a);
    if (dpi < 299.5) warnings.push({ type: 'dpi', artId: a.id, name: a.name, dpi: Math.floor(dpi) });
    if (!a.vector && !a.fullMask && !a.textConfig) warnings.push({ type: 'opaque', artId: a.id, name: a.name });
  }
  for (const i of j.items) {
    const a = arts.get(i.artId);
    if (!a) { errors.push({ type: 'missing', id: i.id }); continue; }
    if (i.page < 0) { unplaced.set(a.id, (unplaced.get(a.id) || 0) + 1); continue; }
    const frame = { x: i.x, y: i.y, ...box(a.w, a.h, i.angle) };
    if (frame.x < s.margin - ep || frame.y < s.margin - ep || frame.x + frame.w > s.width - s.margin + ep || frame.y + frame.h > s.maxLength - s.margin + ep)
      errors.push({ type: 'bounds', id: i.id, page: i.page, name: a.name });
    if (!byPage.has(i.page)) byPage.set(i.page, []);
    byPage.get(i.page).push({ i, a, frame });
  }
  for (const [k, n] of unplaced) errors.push({ type: 'unplaced', artId: k, name: arts.get(k).name, count: n });
  const shapes = (v) => {
    if (!cache.has(v.i.id)) cache.set(v.i.id, maskRects(v.a, v.i).map((r) => ({ ...r, x: r.x + v.i.x, y: r.y + v.i.y })));
    return cache.get(v.i.id);
  };
  for (const [p, list] of byPage) {
    list.sort((a, b) => a.frame.x - b.frame.x);
    for (let n = 0; n < list.length; n++) {
      const a = list[n];
      for (let k = n + 1; k < list.length; k++) {
        const b = list[k];
        if (b.frame.x >= a.frame.x + a.frame.w + s.gap - ep) break;
        if (!conflict(a.frame, b.frame, s.gap)) continue;
        if (s.packing === 'shape' && !shapes(a).some((ra) => shapes(b).some((rb) => conflict(ra, rb, s.gap)))) continue;
        errors.push({ type: 'spacing', id: a.i.id, otherId: b.i.id, page: p, name: a.a.name, otherName: b.a.name });
        if (errors.length >= 70) return { errors, warnings };
      }
    }
  }
  return { errors, warnings };
}

// Add copies of one design into the free space of a sheet, up to the given sheet length.
export function fillPage(j, aid, p, length = j.settings.maxLength) {
  const s = j.settings, a = j.arts.find((x) => x.id === aid), first = j.items.find((i) => i.artId === aid);
  if (!a || !first) return [];
  const arts = new Map(j.arts.map((x) => [x.id, x]));
  let free = [inner(s, Math.min(s.maxLength, Math.max(length, 2 * s.margin + 1)))];
  const added = [];
  for (const i of j.items.filter((x) => x.page === p)) {
    const av = arts.get(i.artId), b = box(av.w, av.h, i.angle);
    free = cut(free, { x: i.x, y: i.y, w: b.w + s.gap, h: b.h + s.gap });
  }
  const choices = modes(a, first, { ...s, packing: 'rect' });
  while (added.length + j.items.length < MAX_COPIES) {
    const b = placement(free, choices, s, s.margin, 'bottom');
    if (!b) break;
    added.push({ ...first, id: uid(), page: p, x: b.x, y: b.y, angle: b.angle });
    free = cut(free, b);
  }
  return added;
}

const isMask = (m) => Number.isInteger(m.w) && m.w >= 1 && m.w <= MASK_SIZE && Number.isInteger(m.h) && m.h >= 1 && m.h <= MASK_SIZE
  && Array.isArray(m.rows) && m.rows.length === m.h
  && m.rows.every((r) => Array.isArray(r) && r.length % 2 === 0 && r.length <= m.w * 2 && r.every((v, k) => Number.isInteger(v) && v >= 0 && v <= m.w && (k === 0 || v >= r[k - 1])));

// Check a project file before opening it.
export function validateJob(raw) {
  if (raw?.version !== 1 || !Array.isArray(raw.arts) || !Array.isArray(raw.items) || raw.items.length > MAX_COPIES) throw new Error('project');
  const j = { version: 1, name: String(raw.name || 'Gangsheet').slice(0, 90), settings: { ...DEFAULTS, ...raw.settings }, arts: [], items: [] };
  validateSettings(j.settings);
  const ids = new Set(), copies = new Set();
  for (const a of raw.arts) {
    const ok = typeof a.id === 'string' && !ids.has(a.id) && /^data:image\/(png|jpeg|webp|svg\+xml);base64,/i.test(a.src)
      && [a.sw, a.sh, a.w, a.h].every((v) => Number.isFinite(v) && v > 0) && a.bounds && [a.bounds.x, a.bounds.y, a.bounds.w, a.bounds.h].every(Number.isFinite)
      && a.bounds.x >= 0 && a.bounds.y >= 0 && a.bounds.w >= 1 && a.bounds.h >= 1 && a.bounds.x + a.bounds.w <= a.sw + ep && a.bounds.y + a.bounds.h <= a.sh + ep;
    if (!ok) throw new Error('project');
    for (const m of [a.fullMask, a.trimMask]) if (m && !isMask(m)) throw new Error('project');
    ids.add(a.id);
    j.arts.push({ ...a, name: String(a.name || 'Desain').slice(0, 140) });
  }
  for (const i of raw.items) {
    if (!ids.has(i.artId) || typeof i.id !== 'string' || copies.has(i.id) || ![i.x, i.y, i.angle, i.baseAngle ?? 0].every(Number.isFinite)
      || !Number.isInteger(i.page) || i.page < -1 || i.page > MAX_COPIES) throw new Error('project');
    copies.add(i.id);
    j.items.push({ ...i });
  }
  return j;
}

// Credits for one export: 1 per started metre of film, at least 1.
export const exportCost = (pages) => Math.max(1, Math.ceil(pages.reduce((n, p) => n + p.length, 0) / 1000 - 1e-9));
