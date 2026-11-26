// Vectorizer: turns a raster image into an SVG of flat ink shapes.
// 1. build a small ink palette, 2. label every pixel with its ink, 3. trace the shared borders
// between inks, 4. fit closed cubic Bezier curves to them. Runs in a Web Worker (vector-worker.js).
// Throws Error("TOO_COMPLEX") when the image has too many borders for the browser to trace.
/* eslint-disable */
const inkMetric = [0.30, 0.51, 0.19];
function colorError(a, b) {
  return inkMetric[0] * (a[0] - b[0]) ** 2 + inkMetric[1] * (a[1] - b[1]) ** 2 + inkMetric[2] * (a[2] - b[2]) ** 2;
}
function paper(r, g, b) {
  return Math.min(r, g, b) >= 246 && Math.max(r, g, b) - Math.min(r, g, b) <= 9;
}
function binKey(r, g, b) {
  return (r >> 3) * 1024 + (g >> 3) * 32 + (b >> 3);
}
function makePalette(data, w, h, limit, omitWhite) {
  const size = 32768,
    count = new Uint32Array(size),
    flat = new Uint32Array(size);
  const rs = new Float64Array(size),
    gs = new Float64Array(size),
    bs = new Float64Array(size);
  const coreR = new Float64Array(size),
    coreG = new Float64Array(size),
    coreB = new Float64Array(size);
  let total = 0,
    interior = 0,
    sawPaper = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (data[p + 3] < 128) continue;
      const r = data[p],
        g = data[p + 1],
        b = data[p + 2];
      if (omitWhite && paper(r, g, b)) {
        sawPaper = true;
        continue;
      }
      const key = binKey(r, g, b);
      count[key]++;
      rs[key] += r;
      gs[key] += g;
      bs[key] += b;
      total++;
      if (data[p + 3] >= 210 && x && y && x + 1 < w && y + 1 < h) {
        let near = 0;
        const stride = w * 4;
        for (let n = 0; n < 4; n++) {
          const q = p + (n === 0 ? -4 : n === 1 ? 4 : n === 2 ? -stride : stride);
          if (data[q + 3] >= 200 && Math.abs(r - data[q]) <= 7 && Math.abs(g - data[q + 1]) <= 7 && Math.abs(b - data[q + 2]) <= 7) near++;
        }
        if (near >= 3) {
          flat[key]++;
          interior++;
          coreR[key] += r;
          coreG[key] += g;
          coreB[key] += b;
        }
      }
    }
  }
  if (!total) return {
    inks: [],
    sawPaper
  };
  const flatArt = interior >= total * 0.48;
  const bins = [];
  for (let k = 0; k < size; k++) {
    if (!count[k]) continue;
    const n = count[k];
    const core = flat[k];
    const rgb = flatArt && core ? [coreR[k] / core, coreG[k] / core, coreB[k] / core] : [rs[k] / n, gs[k] / n, bs[k] / n];
    bins.push({
      rgb,
      n,
      core
    });
  }
  // Interior pixels represent ink. A one-pixel band of anti-aliasing should not consume another ink.
  const isInteriorInk = p => p.core >= Math.max(1, Math.min(12, total * 0.00001)) && p.core >= p.n * .24;
  let points = flatArt ? bins.filter(isInteriorInk) : bins;
  if (flatArt && points.length) {
    const missingHairlines = bins.filter(p => !isInteriorInk(p) && p.n >= Math.max(4, Math.min(40, total * 0.00015)));
    const bases = points.slice().sort((a, b) => b.core - a.core).slice(0, 20).map(p => p.rgb);
    if (sawPaper) bases.push([255, 255, 255]);
    for (const p of missingHairlines) {
      if (bases.some(c => colorError(p.rgb, c) < 24 ** 2)) continue;
      let mixture = false;
      for (let i = 0; !mixture && i < bases.length; i++) for (let j = i + 1; !mixture && j < bases.length; j++) {
        const a = bases[i],
          b = bases[j],
          d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const denom = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
        if (!denom) continue;
        const t = Math.max(0, Math.min(1, ((p.rgb[0] - a[0]) * d[0] + (p.rgb[1] - a[1]) * d[1] + (p.rgb[2] - a[2]) * d[2]) / denom));
        mixture = colorError(p.rgb, [a[0] + t * d[0], a[1] + t * d[1], a[2] + t * d[2]]) < 15 ** 2;
      }
      if (!mixture) points.push(p);
    }
  }
  if (!points.length) points = bins;
  const weights = points.map(p => flatArt ? p.core || Math.min(p.n, 24) * 0.4 : p.n);
  let first = 0;
  for (let i = 1; i < points.length; i++) if (weights[i] > weights[first]) first = i;
  let centers = [points[first].rgb.slice()];
  const closest = new Float64Array(points.length).fill(Infinity);
  let fixedWhite = -1;
  if (flatArt && !omitWhite && limit > 1) {
    const white = points.find(p => Math.min(...p.rgb) >= 252 && p.core >= 1);
    if (white) {
      if (colorError(centers[0], white.rgb) < 7 ** 2) fixedWhite = 0;else {
        for (let i = 0; i < points.length; i++) closest[i] = colorError(points[i].rgb, centers[0]);
        centers.push(white.rgb.slice());
        fixedWhite = 1;
      }
    }
  }
  while (centers.length < limit) {
    let best = -1,
      bestScore = -1;
    const last = centers[centers.length - 1];
    for (let i = 0; i < points.length; i++) {
      closest[i] = Math.min(closest[i], colorError(points[i].rgb, last));
      if (closest[i] < (flatArt ? 14 ** 2 : 7 ** 2)) continue;
      const score = Math.sqrt(weights[i]) * closest[i];
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    centers.push(points[best].rgb.slice());
  }
  // Refine clusters. For a flat logo use its most frequent real ink, keeping exact solid colors.
  for (let iteration = 0; iteration < 5; iteration++) {
    const sums = centers.map(() => [0, 0, 0, 0, -1, -1]);
    for (let i = 0; i < points.length; i++) {
      let ix = 0,
        min = Infinity;
      for (let j = 0; j < centers.length; j++) {
        const d = colorError(points[i].rgb, centers[j]);
        if (d < min) {
          min = d;
          ix = j;
        }
      }
      const s = sums[ix],
        wt = weights[i],
        rgb = points[i].rgb;
      s[0] += rgb[0] * wt;
      s[1] += rgb[1] * wt;
      s[2] += rgb[2] * wt;
      s[3] += wt;
      if (wt > s[4]) {
        s[4] = wt;
        s[5] = i;
      }
    }
    centers = centers.map((c, j) => {
      const s = sums[j];
      if (j === fixedWhite) return c;
      if (!s[3]) return c;
      if (flatArt && iteration === 4) return points[s[5]].rgb;
      return [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
  }
  const inks = [];
  for (const c of centers) {
    const rgb = c.map(Math.round);
    if (!inks.some(other => colorError(rgb, other) < 5 ** 2) && !(omitWhite && paper(...rgb))) inks.push(rgb);
  }
  return {
    inks,
    sawPaper,
    flatArt
  };
}
function labelImage(data, w, h, inks, opaquePaper) {
  const stride = w + 2;
  const labels = new Uint8Array(stride * (h + 2));
  const table = new Int16Array(32768).fill(-1);
  const colors = opaquePaper ? [[255, 255, 255], ...inks] : inks;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4;
    if (data[p + 3] < 128 || opaquePaper && paper(data[p], data[p + 1], data[p + 2])) continue;
    const k = binKey(data[p], data[p + 1], data[p + 2]);
    let ink = table[k];
    if (ink < 0) {
      const c = [(k >> 10 & 31) * 8 + 3.5, (k >> 5 & 31) * 8 + 3.5, (k & 31) * 8 + 3.5];
      let best = 0,
        min = Infinity;
      for (let j = 0; j < colors.length; j++) {
        const d = colorError(c, colors[j]);
        if (d < min) {
          min = d;
          best = j;
        }
      }
      ink = opaquePaper ? best : best + 1;
      table[k] = ink;
    }
    labels[(y + 1) * stride + x + 1] = ink;
  }
  return labels;
}

// A grey antialiased pixel between black and white can be nearer to a third ink in RGB.
// Prefer the mixture of the actual neighboring inks when it explains that pixel better.
function resolveMixedEdges(data, w, h, labels, inks, opaquePaper) {
  const stride = w + 2,
    palette = [[255, 255, 255], ...inks];
  const known = new Uint8Array(w * h).fill(255),
    ambiguous = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x,
      p = i * 4;
    if (data[p + 3] < 128) continue;
    const ink = labels[(y + 1) * stride + x + 1];
    if (!ink && !opaquePaper) continue;
    const rgb = palette[ink],
      r = data[p] - rgb[0],
      g = data[p + 1] - rgb[1],
      b = data[p + 2] - rgb[2];
    if (r * r * inkMetric[0] + g * g * inkMetric[1] + b * b * inkMetric[2] < 12 ** 2) known[i] = ink;else ambiguous.push(i);
  }
  const seen = new Int32Array(palette.length).fill(-1),
    nearby = [];
  for (const i of ambiguous) {
    const x = i % w,
      y = Math.floor(i / w),
      p = i * 4,
      li = (y + 1) * stride + x + 1;
    nearby.length = 0;
    for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++) for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) {
      const ink = known[yy * w + xx];
      if (ink !== 255 && seen[ink] !== i) {
        seen[ink] = i;
        nearby.push(ink);
      }
    }
    if (nearby.length < 2) continue;
    const rgb = [data[p], data[p + 1], data[p + 2]];
    let best = Math.min(24 ** 2, colorError(rgb, palette[labels[li]]) * .6),
      choice = labels[li];
    for (let a = 0; a < nearby.length; a++) for (let b = a + 1; b < nearby.length; b++) {
      const A = palette[nearby[a]],
        B = palette[nearby[b]];
      const dr = B[0] - A[0],
        dg = B[1] - A[1],
        db = B[2] - A[2];
      const den = dr * dr * inkMetric[0] + dg * dg * inkMetric[1] + db * db * inkMetric[2];
      if (den < 1) continue;
      const f = clamp(((rgb[0] - A[0]) * dr * inkMetric[0] + (rgb[1] - A[1]) * dg * inkMetric[1] + (rgb[2] - A[2]) * db * inkMetric[2]) / den, 0, 1);
      const e = colorError(rgb, [A[0] + f * dr, A[1] + f * dg, A[2] + f * db]);
      if (e < best) {
        best = e;
        choice = f <= .5 ? nearby[a] : nearby[b];
      }
    }
    labels[li] = choice;
  }
}
function cleanSpecks(labels, w, h, limit, inkCount) {
  if (limit <= 1) return labels;
  const stride = w + 2,
    result = labels.slice(),
    visited = new Uint8Array(labels.length);
  const queue = new Int32Array(w * h),
    votes = new Uint16Array(inkCount + 1);
  const offsets = [-1, 1, -stride, stride];
  for (let y = 1; y <= h; y++) for (let x = 1; x <= w; x++) {
    const start = y * stride + x,
      ink = labels[start];
    if (!ink || visited[start]) continue;
    let head = 0,
      tail = 1;
    queue[0] = start;
    visited[start] = 1;
    while (head < tail) {
      const p = queue[head++];
      for (let j = 0; j < 4; j++) {
        const n = p + offsets[j];
        if (labels[n] === ink && !visited[n]) {
          visited[n] = 1;
          queue[tail++] = n;
        }
      }
    }
    if (tail >= limit) continue;
    votes.fill(0);
    for (let i = 0; i < tail; i++) for (let j = 0; j < 4; j++) {
      const adjacent = labels[queue[i] + offsets[j]];
      if (adjacent !== ink) votes[adjacent]++;
    }
    let replacement = 0;
    for (let i = 1; i < votes.length; i++) if (votes[i] > votes[replacement]) replacement = i;
    for (let i = 0; i < tail; i++) result[queue[i]] = replacement;
  }
  return result;
}
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (x, y) => {
  const d = Math.hypot(x, y);
  return d ? [x / d, y / d] : [0, 0];
};
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function lineDistanceSq(p, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    den = dx * dx + dy * dy;
  const t = den ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den, 0, 1) : 0;
  return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
}
function fitSpan(points, first, last, leftTangent, rightTangent, tolerance, out, depth = 0) {
  const a = points[first],
    b = points[last],
    span = last - first;
  if (span < 1) return;
  let maxLine = 0;
  for (let i = first + 1; i < last; i++) maxLine = Math.max(maxLine, lineDistanceSq(points[i], a, b));
  if (span === 1 || maxLine <= Math.min(0.31, tolerance * 0.56) ** 2) {
    out.push([a, b]);
    return;
  }
  if (depth >= 18) {
    for (let i = first + 1; i <= last; i++) out.push([points[i - 1], points[i]]);
    return;
  }
  const u = new Float64Array(span + 1);
  for (let i = 1; i <= span; i++) u[i] = u[i - 1] + distance(points[first + i], points[first + i - 1]);
  const length = u[span];
  if (length < 1e-7) return;
  let aa = 0,
    ab = 0,
    bb = 0,
    ra = 0,
    rb = 0;
  const dot = leftTangent[0] * rightTangent[0] + leftTangent[1] * rightTangent[1];
  for (let i = 1; i < span; i++) {
    const t = u[i] / length,
      v = 1 - t,
      f = 3 * v * v * t,
      g = 3 * v * t * t;
    const x = points[first + i][0] - (v * v * v + f) * a[0] - (g + t * t * t) * b[0];
    const y = points[first + i][1] - (v * v * v + f) * a[1] - (g + t * t * t) * b[1];
    aa += f * f;
    ab += f * g * dot;
    bb += g * g;
    ra += f * (leftTangent[0] * x + leftTangent[1] * y);
    rb += g * (rightTangent[0] * x + rightTangent[1] * y);
  }
  const det = aa * bb - ab * ab,
    third = distance(a, b) / 3;
  let da = det > 1e-9 ? (ra * bb - rb * ab) / det : third,
    db = det > 1e-9 ? (aa * rb - ab * ra) / det : third;
  if (da <= 0.0001 || db <= 0.0001 || da > length || db > length) {
    da = third;
    db = third;
  }
  const c = [a[0] + da * leftTangent[0], a[1] + da * leftTangent[1]];
  const d = [b[0] + db * rightTangent[0], b[1] + db * rightTangent[1]];
  let largest = -1,
    split = first + Math.floor(span / 2);
  for (let i = 1; i < span; i++) {
    const t = u[i] / length,
      v = 1 - t,
      f = 3 * v * v * t,
      g = 3 * v * t * t;
    const dx = a[0] * v * v * v + c[0] * f + d[0] * g + b[0] * t * t * t - points[first + i][0];
    const dy = a[1] * v * v * v + c[1] * f + d[1] * g + b[1] * t * t * t - points[first + i][1];
    const err = dx * dx + dy * dy;
    if (err > largest) {
      largest = err;
      split = first + i;
    }
  }
  if (largest <= tolerance * tolerance) {
    out.push([a, c, d, b]);
    return;
  }
  const spread = Math.min(2, split - first, last - split);
  const t = unit(points[split + spread][0] - points[split - spread][0], points[split + spread][1] - points[split - spread][1]);
  fitSpan(points, first, split, leftTangent, [-t[0], -t[1]], tolerance, out, depth + 1);
  fitSpan(points, split, last, t, rightTangent, tolerance, out, depth + 1);
}
function fitBoundary(raw, closed, smooth, corners) {
  const m = raw.length;
  if (m < 2) return [];
  const lengths = [0],
    segments = closed ? m : m - 1;
  for (let j = 0; j < segments; j++) lengths.push(lengths[j] + distance(raw[j], raw[(j + 1) % m]));
  const length = lengths[segments];
  if (length < 0.00001) return [];
  if (length < 7.5) {
    const out = [];
    for (let i = 0; i < segments; i++) if (distance(raw[i], raw[(i + 1) % m]) > 0.003) out.push([raw[i], raw[(i + 1) % m]]);
    return out;
  }
  const intervals = Math.max(closed ? 6 : 2, Math.ceil(length / .83)),
    n = closed ? intervals : intervals + 1;
  const points = [];
  let edge = 0;
  for (let i = 0; i < n; i++) {
    const s = length * i / intervals;
    while (edge + 1 < segments && lengths[edge + 1] < s) edge++;
    const a = raw[edge],
      b = raw[(edge + 1) % m],
      t = (s - lengths[edge]) / (lengths[edge + 1] - lengths[edge] || 1);
    points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  if (!closed) {
    points[0] = raw[0];
    points[n - 1] = raw[m - 1];
  }
  const radius = Math.min(3, Math.max(1, Math.floor((n - 1) / 8))),
    wide = Math.min(7, Math.max(radius + 1, Math.floor((n - 1) / 4)));
  const ix = i => closed ? (i % n + n) % n : clamp(i, 0, n - 1);
  function angle(i, k) {
    const a = points[ix(i - k)],
      b = points[i],
      c = points[ix(i + k)];
    const ax = b[0] - a[0],
      ay = b[1] - a[1],
      bx = c[0] - b[0],
      by = c[1] - b[1];
    return Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by);
  }
  const ranked = [],
    pinned = new Uint8Array(n),
    blocked = new Uint8Array(n);
  const threshold = (91 - 0.66 * corners) * Math.PI / 180;
  for (let i = closed ? 0 : radius; i < (closed ? n : n - radius); i++) {
    const near = angle(i, radius),
      far = angle(i, wide);
    if (near >= threshold && near >= .64 * far) ranked.push([i, near + .22 * far]);
  }
  ranked.sort((a, b) => b[1] - a[1]);
  for (const [i] of ranked) {
    if (blocked[i]) continue;
    pinned[i] = 1;
    for (let j = -radius; j <= radius; j++) blocked[ix(i + j)] = 1;
  }
  if (!closed) {
    pinned[0] = 1;
    pinned[n - 1] = 1;
  }
  const refined = points.map(p => p.slice());
  for (let i = 0; i < n; i++) {
    if (pinned[i]) {
      if (!closed && (i < wide || i + wide >= n)) continue;
      const p = points[ix(i - radius)],
        q = points[ix(i + radius)];
      const u = unit(p[0] - points[ix(i - wide)][0], p[1] - points[ix(i - wide)][1]);
      const v = unit(points[ix(i + wide)][0] - q[0], points[ix(i + wide)][1] - q[1]);
      const det = cross(u, v);
      if (Math.abs(det) > .23) {
        const t = cross([q[0] - p[0], q[1] - p[1]], v) / det,
          hit = [p[0] + t * u[0], p[1] + t * u[1]];
        if (distance(hit, points[i]) < 1.05) refined[i] = hit;
      }
    } else {
      const a = points[ix(i - 1)],
        b = points[i],
        c = points[ix(i + 1)];
      const d = points[ix(i - 2)],
        e = points[ix(i + 2)];
      const besideCorner = pinned[ix(i - 1)] || pinned[ix(i + 1)];
      const mix = (.12 + .72 * smooth / 100) * (besideCorner ? .35 : 1);
      for (let k = 0; k < 2; k++) refined[i][k] = b[k] + mix * ((d[k] + 4 * a[k] + 6 * b[k] + 4 * c[k] + e[k]) / 16 - b[k]);
    }
  }
  const anchors = [];
  for (let i = 0; i < n; i++) if (pinned[i]) anchors.push(i);
  if (closed && !anchors.length) {
    for (let j = 0; j < 4; j++) anchors.push(Math.floor(j * n / 4));
  } else if (closed && anchors.length === 1) {
    anchors.push((anchors[0] + Math.floor(n / 2)) % n);
    anchors.sort((a, b) => a - b);
  }
  const spanPoints = closed ? refined.concat(refined) : refined;
  const tolerance = Math.min(.19 + 1.54 * (smooth / 100) ** 1.4, Math.max(.16, length * .015));
  const out = [],
    spans = closed ? anchors.length : anchors.length - 1;
  for (let j = 0; j < spans; j++) {
    const a = anchors[j],
      b = j + 1 < anchors.length ? anchors[j + 1] : anchors[0] + n;
    if (b <= a) continue;
    const spread = Math.max(1, Math.min(3, Math.floor((b - a) / 3))),
      end = b % n;
    const startT = pinned[a] ? unit(spanPoints[a + spread][0] - spanPoints[a][0], spanPoints[a + spread][1] - spanPoints[a][1]) : unit(refined[ix(a + spread)][0] - refined[ix(a - spread)][0], refined[ix(a + spread)][1] - refined[ix(a - spread)][1]);
    const endT = pinned[end] ? unit(spanPoints[b - spread][0] - spanPoints[b][0], spanPoints[b - spread][1] - spanPoints[b][1]) : unit(refined[ix(end - spread)][0] - refined[ix(end + spread)][0], refined[ix(end - spread)][1] - refined[ix(end + spread)][1]);
    fitSpan(spanPoints, a, b, startT, endT, tolerance, out);
  }
  return out;
}
function traceContours(data, w, h, labels, inks, settings) {
  const stride = w + 2,
    vertices = w + 1,
    size = vertices * (h + 1);
  const masks = new Uint8Array(size),
    mapping = new Int32Array(size * 2);
  // Lattice directions are clockwise in image space: east, south, west, north.
  const delta = [1, vertices, -1, -vertices];
  let edges = 0;
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) {
    const v = y * vertices + x,
      p = (y + 1) * stride + x + 1;
    if (x < w && labels[p] !== labels[p - stride]) {
      masks[v] |= 1;
      masks[v + 1] |= 4;
      edges++;
    }
    if (y < h && labels[p] !== labels[p - 1]) {
      masks[v] |= 2;
      masks[v + vertices] |= 8;
      edges++;
    }
  }
  if (edges > 410000) throw new Error("TOO_COMPLEX");
  const counts = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
  const firstDir = [-1, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0];
  const scalarColors = [[255, 255, 255], ...inks];
  function key(v, d) {
    if (d === 0) return 2 * v;
    if (d === 1) return 2 * v + 1;
    return d === 2 ? 2 * (v - 1) : 2 * (v - vertices) + 1;
  }
  function offset(x, y) {
    return x < 0 || y < 0 || x >= w || y >= h ? -1 : (y * w + x) * 4;
  }
  function crossing(i, j, ca, cb) {
    const a = i < 0 ? 0 : data[i + 3],
      b = j < 0 ? 0 : data[j + 3];
    if (a < 128 !== b < 128) return clamp((127.5 - a) / (b - a), .015, .985);
    if (i < 0 || j < 0) return .5;
    const A = scalarColors[ca],
      B = scalarColors[cb];
    const dr = (B[0] - A[0]) * inkMetric[0],
      dg = (B[1] - A[1]) * inkMetric[1],
      db = (B[2] - A[2]) * inkMetric[2];
    const mid = (dr * (A[0] + B[0]) + dg * (A[1] + B[1]) + db * (A[2] + B[2])) / 2;
    const f = dr * data[i] + dg * data[i + 1] + db * data[i + 2] - mid;
    const g = dr * data[j] + dg * data[j + 1] + db * data[j + 2] - mid;
    return f < 0 && g > 0 ? clamp(-f / (g - f), .015, .985) : .5;
  }
  function edgeSample(id) {
    const v = id >> 1,
      x = v % vertices,
      y = v / vertices | 0,
      p = (y + 1) * stride + x + 1;
    if (id & 1) {
      const t = crossing(offset(x - 1, y), offset(x, y), labels[p - 1], labels[p]);
      return [x - .5 + t, y + .5];
    }
    const t = crossing(offset(x, y - 1), offset(x, y), labels[p - stride], labels[p]);
    return [x + .5, y - .5 + t];
  }
  function rightColor(v, d) {
    const x = v % vertices,
      y = v / vertices | 0,
      p = (y + 1) * stride + x + 1;
    return labels[d === 0 ? p : d === 1 ? p - 1 : d === 2 ? p - stride - 1 : p - stride];
  }
  function point(v) {
    return [v % vertices, Math.floor(v / vertices)];
  }
  const chains = [null];
  function follow(start, first, closed) {
    const id = chains.length,
      mids = [],
      dirs = [];
    let v = start,
      d = first,
      last = first;
    do {
      const k = key(v, d);
      mapping[k] = d < 2 ? id : -id;
      mids.push(edgeSample(k));
      dirs.push(d);
      v += delta[d];
      last = d;
      if (v === start || counts[masks[v]] !== 2) break;
      d = firstDir[masks[v] & ~(1 << (d + 2) % 4)];
    } while (true);
    const raw = [];
    if (!closed) raw.push(point(start));
    const n = dirs.length;
    for (let i = 0; i < n; i++) {
      raw.push(mids[i]);
      if (!closed && (i < 1 || i + 2 >= n) || n < 4) continue;
      const prev = (i + n - 1) % n,
        next = (i + 1) % n,
        next2 = (i + 2) % n;
      if (dirs[prev] === dirs[i] && dirs[next2] === dirs[next] && (dirs[i] ^ dirs[next]) & 1) {
        raw.push(dirs[i] & 1 ? [mids[i][0], mids[next][1]] : [mids[next][0], mids[i][1]]);
      }
    }
    if (!closed) raw.push(point(v));
    const segments = fitBoundary(raw, closed, settings.smooth, settings.corners);
    chains.push({
      start,
      end: v,
      first,
      last,
      closed,
      segments,
      right: rightColor(start, first),
      left: rightColor(start + delta[first], (first + 2) % 4)
    });
  }
  for (let v = 0; v < size; v++) {
    const mask = masks[v];
    if (!mask || counts[mask] === 2) continue;
    for (let d = 0; d < 4; d++) if (mask & 1 << d && !mapping[key(v, d)]) follow(v, d, false);
  }
  for (let v = 0; v < size; v++) {
    const mask = masks[v];
    if (!mask) continue;
    for (let d = 0; d < 2; d++) if (mask & 1 << d && !mapping[key(v, d)]) follow(v, d, true);
  }
  const pathParts = inks.map(() => []),
    ringCounts = inks.map(() => 0);
  const seen = new Uint8Array(chains.length * 2);
  const fmt = n => String(Math.round(n * 100) / 100);
  const xy = p => fmt(p[0]) + " " + fmt(p[1]);
  let segmentCount = 0;
  function mark(s) {
    return 2 * Math.abs(s) + (s < 0 ? 1 : 0);
  }
  function successor(s, ink) {
    const c = chains[Math.abs(s)],
      v = s > 0 ? c.end : c.start,
      dir = s > 0 ? c.last : (c.first + 2) % 4;
    for (const turn of [1, 0, 3, 2]) {
      const d = (dir + turn) % 4;
      if (!(masks[v] & 1 << d) || rightColor(v, d) !== ink) continue;
      return mapping[key(v, d)] * (d < 2 ? 1 : -1);
    }
    throw new Error("BROKEN_CONTOUR");
  }
  for (let id = 1; id < chains.length; id++) for (const sign of [1, -1]) {
    const start = sign * id,
      ink = sign === 1 ? chains[id].right : chains[id].left;
    if (!ink || seen[mark(start)]) continue;
    const parts = [];
    let current = start;
    do {
      if (seen[mark(current)]) throw new Error("OVERLAPPING_CONTOUR");
      seen[mark(current)] = 1;
      const c = chains[Math.abs(current)],
        s = c.segments;
      for (let i = 0; i < s.length; i++) {
        const forward = current > 0,
          seg = s[forward ? i : s.length - i - 1],
          end = seg.length - 1;
        if (!parts.length) parts.push("M" + xy(seg[forward ? 0 : end]));
        if (end === 1) parts.push("L" + xy(seg[forward ? 1 : 0]));else parts.push("C" + xy(seg[forward ? 1 : 2]) + " " + xy(seg[forward ? 2 : 1]) + " " + xy(seg[forward ? 3 : 0]));
        segmentCount++;
      }
      if (c.closed) break;
      current = successor(current, ink);
    } while (current !== start);
    if (parts.length) {
      parts.push("Z");
      pathParts[ink - 1].push(parts.join(""));
      ringCounts[ink - 1]++;
    }
  }
  return {
    pathParts,
    ringCounts,
    segmentCount
  };
}
export function vectorizeRaster(data, w, h, originalWidth, originalHeight, settings, progress) {
  progress("palette", 12);
  const {
    inks,
    sawPaper,
    flatArt
  } = makePalette(data, w, h, settings.colors, settings.omitWhite);
  if (!inks.length) return {
    svg: "",
    colors: [],
    rings: 0,
    nodes: 0
  };
  progress("regions", 35);
  const opaquePaper = settings.omitWhite && sawPaper;
  let labels = labelImage(data, w, h, inks, opaquePaper);
  if (flatArt && inks.length + (opaquePaper ? 1 : 0) >= 3) resolveMixedEdges(data, w, h, labels, inks, opaquePaper);
  labels = cleanSpecks(labels, w, h, settings.noise, inks.length);
  progress("curves", 60);
  const {
    pathParts,
    ringCounts,
    segmentCount
  } = traceContours(data, w, h, labels, inks, settings);
  const scaleX = Number((originalWidth / w).toFixed(9)),
    scaleY = Number((originalHeight / h).toFixed(9));
  const pieces = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + originalWidth + '" height="' + originalHeight + '" viewBox="0 0 ' + originalWidth + ' ' + originalHeight + '">'];
  if (scaleX !== 1 || scaleY !== 1) pieces.push('<g transform="scale(' + scaleX + ' ' + scaleY + ')">');
  const colors = [];
  for (let i = 0; i < inks.length; i++) {
    if (!pathParts[i].length) continue;
    const hex = inks[i].map(x => Math.round(x).toString(16).padStart(2, "0")).join("").toUpperCase();
    colors.push("#" + hex);
    pieces.push('<path id="ink-' + hex + '" fill="#' + hex + '" fill-rule="evenodd" d="' + pathParts[i].join("") + '"/>');
  }
  if (scaleX !== 1 || scaleY !== 1) pieces.push('</g>');
  pieces.push('</svg>');
  return {
    svg: colors.length ? pieces.join("\n") : "",
    colors,
    rings: ringCounts.reduce((a, b) => a + b, 0),
    nodes: segmentCount
  };
}
