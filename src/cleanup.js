// Touch-ups to a PSD's layers before rigging. Layer splitters (See-through and the like) leave bits of one part in
// another: loose ink strokes around the back hair, hair strands and hair colour inside the face. At rest the parts
// above hide them, but once the hair swings or the eyes close they show. Two passes fix that:
//
//   autoClean  a conservative automatic pass: drops small loose fragments that are mostly ink, and in the face
//              covers stray hair colour and strokes that sit under the front hair with the skin colour
//   applyEdit  the user's brush strokes from the editor: erase, cover with a colour, move to another layer, restore
//
// Both work on the layers as readPSD returns them ({ name, x, y, width, height, rgba, ... }, bottom to top) and
// never change the input: a layer that changes is copied first. Layers are keyed like autoRig keys them, `i:name`.

import { guessRole } from './roles.js';

const A_MIN = 8;
// roles whose layer is one big shape, where a small loose fragment of ink is debris (not eyes, brows, nose, mouth:
// those are made of small dark strokes)
const DEBRIS_ROLES = new Set(['hair_back', 'hair_front', 'face', 'neck', 'body', 'arm', 'legs', 'ear', 'head_acc', 'tail', 'wings']);

export const layerKey = (l, i) => `${i}:${l.name}`;
const luma = (d, i) => d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
const copyLayer = l => ({ ...l, rgba: new Uint8ClampedArray(l.rgba) });

// The PSD with its layers prepared for autoRig: auto-cleaned when `cleanup` is on, then the user's strokes `edits`
// applied in order. Returns { psd, report } (report: what autoClean did, per layer key).
export function prepareLayers(raw, { cleanup = true, edits = [], overrides = {} } = {}) {
  let psd = raw, report = {};
  if (cleanup) ({ psd, report } = autoClean(raw, overrides));
  if (edits.length) {
    psd = { ...psd, layers: psd.layers.slice() };
    const owned = new Set();
    for (const e of edits) applyEdit(psd, raw, e, owned);
  }
  return { psd, report };
}

// ---------- automatic pass ----------

export function autoClean(raw, overrides = {}) {
  const layers = raw.layers.slice(), report = {};
  const roleOf = i => overrides[layerKey(raw.layers[i], i)] ?? guessRole(raw.layers[i].name);
  for (let i = 0; i < layers.length; i++) {
    if (!DEBRIS_ROLES.has(roleOf(i))) continue;
    const l = layers[i], drop = debris(l);
    if (!drop.length) continue;
    const c = layers[i] = copyLayer(l);
    let px = 0;
    for (const comp of drop) for (const k of comp) { c.rgba[k * 4 + 3] = 0; px++; }
    report[layerKey(l, i)] = { fragments: drop.length, pixels: px, covered: 0 };
  }
  // the face under the front hair: whatever is not skin there is hair that was cut into the face
  const faceI = layers.findIndex((l, i) => roleOf(i) === 'face');
  const hairs = layers.map((l, i) => i).filter(i => i > faceI && roleOf(i) === 'hair_front');
  if (faceI >= 0 && hairs.length) {
    const res = coverUnderHair(layers[faceI], hairs.map(i => layers[i]), raw.width, raw.height);
    if (res) {
      const key = layerKey(raw.layers[faceI], faceI);
      layers[faceI] = res.layer;
      report[key] = { fragments: 0, pixels: 0, ...report[key], covered: res.covered };
    }
  }
  return { psd: { ...raw, layers }, report };
}

// The connected pieces of a layer (8-neighbour, alpha > A_MIN) that are small next to the whole and mostly ink:
// arrays of pixel indices into the layer.
function debris(l) {
  const { width: w, height: h, rgba: d } = l;
  const n = w * h, lab = new Int32Array(n), stack = new Int32Array(n);
  let total = 0;
  const comps = [];
  for (let s = 0; s < n; s++) {
    if (lab[s] || d[s * 4 + 3] <= A_MIN) continue;
    const id = comps.length + 1, px = [];
    let top = 0, ink = 0;
    stack[top++] = s; lab[s] = id;
    while (top) {
      const k = stack[--top];
      px.push(k);
      if (luma(d, k * 4) < 80) ink++;
      const x = k % w, y = (k - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (lab[q] || d[q * 4 + 3] <= A_MIN) continue;
          lab[q] = id; stack[top++] = q;
        }
      }
    }
    total += px.length;
    comps.push({ px, ink });
  }
  if (comps.length < 2) return [];
  const big = Math.max(...comps.map(c => c.px.length));
  const limit = Math.max(24, 0.012 * total);
  return comps.filter(c => c.px.length < big && c.px.length < limit && c.ink > 0.5 * c.px.length).map(c => c.px);
}

// The most common colour of a layer's solid, not-dark pixels (its fill: the skin of a face), as [r, g, b].
export function fillColor(l) {
  const d = l.rgba, hist = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200 || luma(d, i) < 90) continue;
    const q = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | d[i + 2] >> 3;
    const e = hist.get(q);
    if (e) { e[0]++; e[1] += d[i]; e[2] += d[i + 1]; e[3] += d[i + 2]; } else hist.set(q, [1, d[i], d[i + 1], d[i + 2]]);
  }
  let best = null;
  for (const e of hist.values()) if (!best || e[0] > best[0]) best = e;
  return best ? [best[1], best[2], best[3]].map(v => Math.round(v / best[0])) : [255, 255, 255];
}

// Distance (chamfer, in pixels) from each pixel of a layer to its nearest transparent pixel, capped at `cap`.
function edgeDistance(l, cap) {
  const { width: w, height: h, rgba: d } = l, D = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) D[k] = d[k * 4 + 3] > A_MIN ? cap : 0;
  const S = Math.SQRT2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (!D[k]) continue;
    let v = D[k];
    if (x > 0) v = Math.min(v, D[k - 1] + 1); else v = Math.min(v, 1);
    if (y > 0) {
      v = Math.min(v, D[k - w] + 1);
      if (x > 0) v = Math.min(v, D[k - w - 1] + S);
      if (x < w - 1) v = Math.min(v, D[k - w + 1] + S);
    } else v = Math.min(v, 1);
    D[k] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const k = y * w + x;
    if (!D[k]) continue;
    let v = D[k];
    if (x < w - 1) v = Math.min(v, D[k + 1] + 1); else v = Math.min(v, 1);
    if (y < h - 1) {
      v = Math.min(v, D[k + w] + 1);
      if (x < w - 1) v = Math.min(v, D[k + w + 1] + S);
      if (x > 0) v = Math.min(v, D[k + w - 1] + S);
    } else v = Math.min(v, 1);
    D[k] = v;
  }
  return D;
}

// Covers, in the face, pixels well under the front hair that are not skin with the skin colour. The face's own
// outline (a band along its edge as wide as a thick line) keeps its ink; only colour is covered there.
function coverUnderHair(face, hairs, W, H) {
  const skin = fillColor(face);
  const band = Math.max(3, Math.round(0.009 * Math.max(W, H)));
  const dist = edgeDistance(face, band + 1);
  const solidHair = (gx, gy) => hairs.some(h => {
    const x = gx - h.x, y = gy - h.y;
    return x >= 0 && y >= 0 && x < h.width && y < h.height && h.rgba[(y * h.width + x) * 4 + 3] > 200;
  });
  const m = 2; // well under: the hair also covers 2 px around it, so nothing changes at rest
  const under = (gx, gy) => solidHair(gx, gy) && solidHair(gx - m, gy) && solidHair(gx + m, gy) && solidHair(gx, gy - m) && solidHair(gx, gy + m);
  const d = face.rgba, out = new Uint8ClampedArray(d);
  let covered = 0;
  for (let y = 0; y < face.height; y++) {
    for (let x = 0; x < face.width; x++) {
      const k = y * face.width + x, i = k * 4;
      if (d[i + 3] <= A_MIN) continue;
      const diff = Math.abs(d[i] - skin[0]) + Math.abs(d[i + 1] - skin[1]) + Math.abs(d[i + 2] - skin[2]);
      if (diff < 90) continue;
      const inkEdge = dist[k] <= band && luma(d, i) < 90;
      if (inkEdge || !under(face.x + x, face.y + y)) continue;
      out[i] = skin[0]; out[i + 1] = skin[1]; out[i + 2] = skin[2];
      covered++;
    }
  }
  return covered ? { layer: { ...face, rgba: out }, covered } : null;
}

// ---------- the user's strokes ----------

// edit: { layer: key, tool: 'erase' | 'cover' | 'move' | 'restore', r: brush radius, pts: [x0, y0, x1, y1, ...]
// (canvas pixels), color: [r, g, b] (cover), to: key (move) }. psd.layers is changed in place (a layer is copied
// the first time unless its key is in `owned`); raw is the PSD as read, for restore. Returns false when the stroke
// does not apply, else { moved, patched }: for a move, how many pixels went over and how many holes were filled.
//
// A move takes only what is not the layer's own fill colour (a hair line out of the skin, not the skin around it),
// so the brush can be painted loosely over a stray line.
export function applyEdit(psd, raw, e, owned = new Set()) {
  const idx = psd.layers.findIndex((l, i) => layerKey(l, i) === e.layer);
  if (idx < 0) return false;
  const box = strokeBox(e);
  const own = i => {
    const key = layerKey(psd.layers[i], i);
    if (!owned.has(key)) { psd.layers[i] = copyLayer(psd.layers[i]); owned.add(key); }
    return psd.layers[i];
  };
  let to = -1;
  if (e.tool === 'move') {
    to = psd.layers.findIndex((l, i) => layerKey(l, i) === e.to);
    if (to < 0 || to === idx) return false;
    grow(psd, to, box, owned);
  }
  if (e.tool === 'restore') grow(psd, idx, box, owned);
  const L = own(idx), T = to >= 0 ? own(to) : null;
  const cov = coverage(e, box);
  const bw = box.x1 - box.x0;
  const src = e.tool === 'restore' ? raw.layers[idx] : null;
  const patch = e.tool === 'move' ? fillColor(L) : null;
  const before = e.tool === 'move' ? new Uint8ClampedArray(L.rgba) : null;
  let moved = 0, patched = 0;
  for (let gy = box.y0; gy < box.y1; gy++) {
    for (let gx = box.x0; gx < box.x1; gx++) {
      const c = cov[(gy - box.y0) * bw + gx - box.x0];
      if (!c) continue;
      const x = gx - L.x, y = gy - L.y;
      if (x < 0 || y < 0 || x >= L.width || y >= L.height) continue;
      const i = (y * L.width + x) * 4, d = L.rgba;
      if (e.tool === 'erase') d[i + 3] *= 1 - c;
      else if (e.tool === 'cover') {
        if (d[i + 3] <= A_MIN) continue;
        for (let k = 0; k < 3; k++) d[i + k] += (e.color[k] - d[i + k]) * c;
      } else if (e.tool === 'restore') {
        const sx = gx - src.x, sy = gy - src.y;
        const s = sx >= 0 && sy >= 0 && sx < src.width && sy < src.height ? (sy * src.width + sx) * 4 : -1;
        for (let k = 0; k < 4; k++) d[i + k] += ((s < 0 ? 0 : src.rgba[s + k]) - d[i + k]) * c;
      } else if (e.tool === 'move') {
        // how foreign the pixel is: none of the fill colour moves, a line in another colour moves whole
        const diff = Math.abs(d[i] - patch[0]) + Math.abs(d[i + 1] - patch[1]) + Math.abs(d[i + 2] - patch[2]);
        const m = c * Math.max(0, Math.min(1, (diff - 40) / 80));
        const a = d[i + 3] / 255 * m;
        if (a <= 0.003) continue;
        if (a > 0.5) moved++;
        // onto the target, over what it has there
        const t = ((gy - T.y) * T.width + gx - T.x) * 4, td = T.rgba, ta = td[t + 3] / 255, oa = a + ta * (1 - a);
        for (let k = 0; k < 3; k++) td[t + k] = (d[i + k] * a + td[t + k] * ta * (1 - a)) / oa;
        td[t + 3] = oa * 255;
        // out of the source: a hole inside the part is patched with its fill colour, at its edge it is cleared
        if (inside(before, L, x, y, cov, box, e.r)) {
          for (let k = 0; k < 3; k++) d[i + k] += (patch[k] - d[i + k]) * m;
          if (a > 0.5) patched++;
        } else d[i + 3] *= 1 - m;
      }
    }
  }
  return { moved, patched };
}

function strokeBox(e) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < e.pts.length; i += 2) {
    x0 = Math.min(x0, e.pts[i]); x1 = Math.max(x1, e.pts[i]);
    y0 = Math.min(y0, e.pts[i + 1]); y1 = Math.max(y1, e.pts[i + 1]);
  }
  const r = Math.ceil(e.r) + 1;
  return { x0: Math.floor(x0 - r), y0: Math.floor(y0 - r), x1: Math.ceil(x1 + r), y1: Math.ceil(y1 + r) };
}

// How much of each pixel in box the stroke covers (0..1, soft by one pixel at the rim).
function coverage(e, box) {
  const w = box.x1 - box.x0, h = box.y1 - box.y0, cov = new Float32Array(w * h), p = e.pts, r = e.r;
  const seg = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const xa = Math.max(box.x0, Math.floor(Math.min(ax, bx) - r - 1)), xb = Math.min(box.x1, Math.ceil(Math.max(ax, bx) + r + 1));
    const ya = Math.max(box.y0, Math.floor(Math.min(ay, by) - r - 1)), yb = Math.min(box.y1, Math.ceil(Math.max(ay, by) + r + 1));
    for (let y = ya; y < yb; y++) {
      for (let x = xa; x < xb; x++) {
        const px = x + 0.5, py = y + 0.5;
        const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
        const dist = Math.hypot(px - ax - t * dx, py - ay - t * dy);
        const c = Math.max(0, Math.min(1, r + 0.5 - dist));
        const k = (y - box.y0) * w + x - box.x0;
        if (c > cov[k]) cov[k] = c;
      }
    }
  };
  if (p.length === 2) seg(p[0], p[1], p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) seg(p[i - 2], p[i - 1], p[i], p[i + 1]);
  return cov;
}

// Whether a pixel of the layer lies inside the part: the part's pixels (outside the stroke) are found in at least
// 6 of 8 directions within a few brush widths. (Two may miss: those running along a long stroke never leave it.)
function inside(d, L, x, y, cov, box, r) {
  const R = Math.max(16, 4 * r), bw = box.x1 - box.x0;
  let hits = 0;
  for (let a = 0; a < 8; a++) {
    const dx = Math.round(Math.cos(a * Math.PI / 4) * 1e6) / 1e6, dy = Math.round(Math.sin(a * Math.PI / 4) * 1e6) / 1e6;
    for (let s = 1; s <= R; s++) {
      const xx = Math.round(x + dx * s), yy = Math.round(y + dy * s);
      if (xx < 0 || yy < 0 || xx >= L.width || yy >= L.height) break;
      const gx = xx + L.x - box.x0, gy = yy + L.y - box.y0;
      if (gx >= 0 && gy >= 0 && gx < bw && gy < box.y1 - box.y0 && cov[gy * bw + gx] > 0) continue;
      if (d[(yy * L.width + xx) * 4 + 3] > 128) { hits++; break; }
    }
    if (hits + (7 - a) < 6) return false;
  }
  return hits >= 6;
}

// Makes layer i cover box too (a layer is stored cropped to its pixels; a move or a restore may reach past it).
function grow(psd, i, box, owned) {
  const l = psd.layers[i];
  const x0 = Math.max(0, Math.min(l.x, box.x0)), y0 = Math.max(0, Math.min(l.y, box.y0));
  const x1 = Math.min(psd.width, Math.max(l.x + l.width, box.x1)), y1 = Math.min(psd.height, Math.max(l.y + l.height, box.y1));
  if (x0 === l.x && y0 === l.y && x1 === l.x + l.width && y1 === l.y + l.height) return;
  const w = x1 - x0, h = y1 - y0, rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < l.height; y++) rgba.set(l.rgba.subarray(y * l.width * 4, (y + 1) * l.width * 4), ((y + l.y - y0) * w + l.x - x0) * 4);
  psd.layers[i] = { ...l, x: x0, y: y0, width: w, height: h, rgba };
  owned.add(layerKey(l, i));
}
