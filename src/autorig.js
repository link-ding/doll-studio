// Turns parsed PSD layers into a rigged model: assigns roles, splits paired features
// (eyes, brows) into screen-left / screen-right parts, reorders irises under the lashes,
// synthesises a mouth interior, measures the face, and builds a deformable mesh per part.

import { ROLES, PHYSICS_DEFAULT, guessRole, guessViseme } from './roles.js';
import { clamp } from './rig.js';

const ALPHA_MIN = 8;

// options.mouthFrames: also draw the open-mouth shapes the PSD lacks (half, open, round o/u, wide i/e). Off by
// default: the character keeps the mouth it was drawn with; mouth layers drawn in the PSD are used either way.
export function autoRig(psd, overrides = {}, options = {}) {
  const W = psd.width, H = psd.height;
  const layers = psd.layers.map((l, i) => {
    const key = `${i}:${l.name}`;
    return { ...l, key, role: overrides[key] ?? guessRole(l.name) };
  });

  const face = layers.find(l => l.role === 'face');
  const faceBox = face && alphaBox(face, ALL);
  const faceMid = faceBox ? (faceBox.x0 + faceBox.x1) / 2 : null;
  const splitRef = layers.find(l => l.role === 'eyelash') ?? layers.find(l => l.role === 'eye_white');
  const splitX = (splitRef && findSplit(splitRef, faceMid)) ?? faceMid;

  const pieces = [];
  for (const l of layers) {
    if (ROLES[l.role]?.split && splitX != null) {
      const sx = findSplit(l, splitX) ?? splitX;
      const left = cut(l, gx => gx < sx), right = cut(l, gx => gx >= sx);
      if (left) pieces.push({ ...left, side: 'L', name: `${l.name} · L` });
      if (right) pieces.push({ ...right, side: 'R', name: `${l.name} · R` });
      continue;
    }
    const p = cut(l, ALL);
    if (p) pieces.push(l.role === 'mouth_frame' ? { ...p, viseme: guessViseme(l.name) } : p);
  }

  // Irises go right above the eye white so lashes cover them when blinking.
  for (const side of ['L', 'R', undefined]) {
    const iris = pieces.find(p => p.role === 'iris' && p.side === side);
    if (!iris) continue;
    pieces.splice(pieces.indexOf(iris), 1);
    const white = pieces.findIndex(p => p.role === 'eye_white' && p.side === side);
    const lash = pieces.findIndex(p => p.role === 'eyelash' && p.side === side);
    pieces.splice(white >= 0 ? white + 1 : lash >= 0 ? lash : pieces.length, 0, iris);
  }

  // A brow often sits in a hole cut out of the bangs: drawn over the hair, or under it and showing through. Moving it
  // would bare the hole (the skin behind), so fill it: in the hair itself when the brow is on top, else in a patch of
  // hair right under the brow, so the brow still shows through the hair at rest.
  for (const brow of pieces.filter(p => p.role === 'eyebrow')) {
    // a brow is a small stroke; a "brow" layer spread over much of the picture is a broken split, and filling round
    // it would take minutes for nothing
    const bb = brow.box;
    if ((bb.x1 - bb.x0) * (bb.y1 - bb.y0) > 0.05 * W * H) continue;
    const i = pieces.indexOf(brow);
    for (let j = i - 1; j >= 0; j--) {
      const under = pieces[j];
      if (!ROLES[under.role]?.head || ROLES[under.role].split) continue;
      const taken = claimBackdrop(under, brow, pieces.slice(j + 1, i));
      paintFill(under, holeFill(under, brow, (gx, gy) => !taken.has((gy - under.y) * under.w + gx - under.x)));
    }
    for (const hair of pieces.slice(i + 1)) {
      if (hair.role !== 'hair_front' || !showsThrough(hair, brow)) continue;
      // only right under the brow, so nothing changes at rest
      const covered = (gx, gy) => gx >= brow.x && gy >= brow.y && gx < brow.x + brow.w && gy < brow.y + brow.h
        && brow.alpha[(gy - brow.y) * brow.w + gx - brow.x] > ALPHA_MIN;
      const fill = holeFill(hair, brow, covered), patch = fillPatch(hair, brow, fill);
      paintFill(hair, fill, true);
      if (patch) pieces.splice(pieces.indexOf(brow), 0, patch);
    }
  }

  const rig = computeRig(pieces, W, H);
  // open-mouth shapes: the PSD's own (layers named like "mouth_open"), the rest drawn here if asked, above the mouth
  const mouthAt = pieces.findIndex(p => p.role === 'mouth');
  if (options.mouthFrames && mouthAt >= 0 && rig.mouth) {
    const have = new Set(pieces.filter(p => p.role === 'mouth_frame').map(p => p.viseme));
    pieces.splice(mouthAt + 1, 0, ...makeMouthFrames(pieces[mouthAt], have));
  }

  const scale = Math.max(1, Math.max(W, H) / 1024);
  const parts = pieces.map((p, i) => {
    return {
      id: 'p' + i,
      name: p.name,
      role: p.role,
      side: p.side ?? null,
      viseme: p.viseme ?? null,
      src: p.key ?? null,
      x: p.x, y: p.y, w: p.w, h: p.h,
      box: p.box,
      canvas: p.canvas,
      mesh: p.mesh ?? buildMesh(p, scale),
      depth: (ROLES[p.role]?.depth ?? [0, 0]).slice(),
      clip: null,
      opacity: p.opacity ?? 1,
      visible: p.visible ?? true,
    };
  });
  for (const p of parts) {
    if (p.role !== 'iris') continue;
    const white = parts.find(q => q.role === 'eye_white' && q.side === p.side);
    if (white) p.clip = white.id;
  }
  return { format: 'doll', version: 1, width: W, height: H, parts, rig, physics: PHYSICS_DEFAULT.map(g => ({ ...g })) };
}

const ALL = () => true;

// Tight alpha bounds in canvas coordinates of the pixels keep(gx, gy) accepts. x1/y1 are exclusive.
function alphaBox(l, keep) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const { width: w, height: h, rgba } = l;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = l.x + x;
      if (rgba[(y * w + x) * 4 + 3] <= ALPHA_MIN || !keep(gx, l.y + y)) continue;
      if (gx < x0) x0 = gx;
      if (gx > x1) x1 = gx;
      if (l.y + y < y0) y0 = l.y + y;
      if (l.y + y > y1) y1 = l.y + y;
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

// Finds an empty column run between two blobs (e.g. the gap between the eyes) and
// returns its centre in canvas x. Picks the run nearest `near`, or the widest one.
function findSplit(l, near) {
  const { width: w, height: h, rgba } = l;
  const cols = new Uint32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] > ALPHA_MIN) cols[x]++;
  let first = -1, last = -1;
  for (let x = 0; x < w; x++) if (cols[x]) { if (first < 0) first = x; last = x; }
  if (first < 0) return null;
  const runs = [];
  let s = -1;
  for (let x = first; x <= last; x++) {
    if (cols[x] === 0) { if (s < 0) s = x; }
    else if (s >= 0) { runs.push([s, x]); s = -1; }
  }
  if (!runs.length) return null;
  const centre = ([a, b]) => l.x + (a + b) / 2;
  const best = near == null
    ? runs.reduce((m, r) => (r[1] - r[0] > m[1] - m[0] ? r : m))
    : runs.reduce((m, r) => (Math.abs(centre(r) - near) < Math.abs(centre(m) - near) ? r : m));
  return centre(best);
}

// A part made of the pixels of layer l that keep(gx, gy) accepts, cropped to them.
function cut(l, keep) {
  const box = alphaBox(l, keep);
  if (!box) return null;
  const pad = 2;
  const x0 = Math.max(l.x, box.x0 - pad), y0 = Math.max(l.y, box.y0 - pad);
  const x1 = Math.min(l.x + l.width, box.x1 + pad), y1 = Math.min(l.y + l.height, box.y1 + pad);
  const w = x1 - x0, h = y1 - y0;
  const img = new ImageData(w, h);
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = x0 + x;
      if (!keep(gx, y0 + y)) continue;
      const si =((y0 + y - l.y) * l.width + (gx - l.x)) * 4, di = (y * w + x) * 4;
      img.data[di] = l.rgba[si];
      img.data[di + 1] = l.rgba[si + 1];
      img.data[di + 2] = l.rgba[si + 2];
      img.data[di + 3] = alpha[y * w + x] = l.rgba[si + 3];
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').putImageData(img, 0, 0);
  return { name: l.name, role: l.role, key: l.key, opacity: l.opacity, visible: l.visible, x: x0, y: y0, w, h, box, canvas, alpha };
}

// A fill for the hole `under` may have where `over` sits (cut a little wider than it): each see-through pixel of
// `under` in `over`'s box, blended from the nearest pixels outside the hole along the run of the strands there, alpha
// too, so strands carry on through the hole, and so does a gap between them (skin) that runs on past the box.
// Only the pixels keep(gx, gy) accepts are filled. A list of x, y, colour (premultiplied rgba).
function holeFill(under, over, keep = () => true) {
  const G = 2, R = 6, SIGMA = 8;
  const x0 = Math.max(under.x, over.box.x0 - G), x1 = Math.min(under.x + under.w, over.box.x1 + G);
  const y0 = Math.max(under.y, over.box.y0 - G), y1 = Math.min(under.y + under.h, over.box.y1 + G);
  if (x0 >= x1 || y0 >= y1) return [];
  // only the pixels it looks at: the edges up to R + 1 round the box (reach stops a pixel past it)
  const sx0 = Math.max(under.x, x0 - R - 1), sy0 = Math.max(under.y, y0 - R - 1);
  const sx1 = Math.min(under.x + under.w, x1 + R + 1), sy1 = Math.min(under.y + under.h, y1 + R + 1), sw = sx1 - sx0;
  const d = under.canvas.getContext('2d').getImageData(sx0 - under.x, sy0 - under.y, sw, sy1 - sy0).data;
  const inside = (gx, gy) => gx >= under.x && gy >= under.y && gx < under.x + under.w && gy < under.y + under.h;
  const at = (gx, gy) => ((gy - sy0) * sw + (gx - sx0)) * 4;
  const w = x1 - x0, hole = new Uint8Array(w * (y1 - y0));
  let n = 0;
  for (let gy = y0; gy < y1; gy++) for (let gx = x0; gx < x1; gx++) if (d[at(gx, gy) + 3] < 250) { hole[(gy - y0) * w + gx - x0] = 1; n++; }
  if (!n) return [];
  const isHole = (gx, gy) => gx >= x0 && gy >= y0 && gx < x1 && gy < y1 && hole[(gy - y0) * w + gx - x0] === 1;
  // premultiplied colour of a pixel outside the hole (outside `under` is see-through)
  const known = (gx, gy) => {
    if (!inside(gx, gy)) return [0, 0, 0, 0];
    const k = at(gx, gy), a = d[k + 3] / 255;
    return [d[k] * a, d[k + 1] * a, d[k + 2] * a, a];
  };
  // the edges around the hole (gradients of colour and alpha), for the strands' direction near each hole pixel
  const lum = (gx, gy) => { const c = known(gx, gy); return c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11 + c[3] * 255; };
  // the edge tensor on the grid round the box (zero where there is no edge)
  const ex0 = x0 - R, ey0 = y0 - R, EW = x1 - x0 + 2 * R, EH = y1 - y0 + 2 * R;
  const J = [new Float64Array(EW * EH), new Float64Array(EW * EH), new Float64Array(EW * EH)];
  for (let gy = ey0; gy < y1 + R; gy++) {
    for (let gx = ex0; gx < x1 + R; gx++) {
      if (isHole(gx, gy) || isHole(gx - 1, gy) || isHole(gx + 1, gy) || isHole(gx, gy - 1) || isHole(gx, gy + 1)) continue;
      const ix = lum(gx + 1, gy) - lum(gx - 1, gy), iy = lum(gx, gy + 1) - lum(gx, gy - 1);
      const k = (gy - ey0) * EW + gx - ex0;
      J[0][k] = ix * ix; J[1][k] = iy * iy; J[2][k] = ix * iy;
    }
  }
  // along the strands: across the edges near each pixel (the tensor summed with Gaussian weights by distance). The
  // weight exp(-(dx² + dy²) / 2σ²) splits into an x and a y factor, so the sum runs along rows, then down columns.
  // beyond 6σ a weight is under 1e-8 of the nearest one's, so the sums stop there
  const K = Math.min(Math.max(EW, EH), 6 * SIGMA + 1), g = new Float64Array(K);
  for (let i = 0; i < K; i++) g[i] = Math.exp(-(i * i) / (2 * SIGMA * SIGMA));
  const HW = x1 - x0, rows = J.map(() => new Float64Array(EH * HW)); // rows[c][ey * HW + hx]: the row sums
  for (let c = 0; c < 3; c++) {
    const F = J[c], out = rows[c];
    for (let ey = 0; ey < EH; ey++) {
      const base = ey * EW;
      for (let hx = 0; hx < HW; hx++) {
        const ex = hx + R;
        let sum = 0;
        for (let e = Math.max(0, ex - K + 1), end = Math.min(EW, ex + K); e < end; e++) { const v = F[base + e]; if (v) sum += v * g[Math.abs(e - ex)]; }
        out[ey * HW + hx] = sum;
      }
    }
  }
  const strand = (gx, gy) => {
    const hx = gx - x0, ey = gy - ey0;
    let jxx = 0, jyy = 0, jxy = 0;
    for (let e = Math.max(0, ey - K + 1), end = Math.min(EH, ey + K); e < end; e++) {
      const w = g[Math.abs(e - ey)], k = e * HW + hx;
      jxx += rows[0][k] * w; jyy += rows[1][k] * w; jxy += rows[2][k] * w;
    }
    const t = 0.5 * Math.atan2(2 * jxy, jxx - jyy) + Math.PI / 2;
    return [Math.cos(t), Math.sin(t)];
  };
  // walk both ways along the strands to the first pixel outside the hole
  const reach = (gx, gy, sx, sy) => {
    for (let s = 0.5; ; s += 0.5) {
      const px = Math.round(gx + sx * s), py = Math.round(gy + sy * s);
      if (!isHole(px, py)) return [s, known(px, py)];
    }
  };
  const fill = [];
  for (let gy = y0; gy < y1; gy++) {
    for (let gx = x0; gx < x1; gx++) {
      if (!isHole(gx, gy) || !keep(gx, gy)) continue;
      const [ux, uy] = strand(gx, gy), [s1, c1] = reach(gx, gy, ux, uy), [s2, c2] = reach(gx, gy, -ux, -uy);
      // blend the two ends, unless one is hair and the other a gap: then the nearer one, for a clean edge
      const v = Math.abs(c1[3] - c2[3]) > 0.5 ? (s1 <= s2 ? c1 : c2) : c1.map((v, c) => (v * s2 + c2[c] * s1) / (s1 + s2));
      if (v[3] > 0.02) fill.push(gx, gy, v);
    }
  }
  return fill;
}

// A brow layer often carries a bit of what is around it (a lock of hair, a patch of skin), which would ride along when
// the brow moves. Its solid pixels that match `under` around them, and not the brow's own ink, move into `under` where
// nothing in `between` covers them, so the look at rest is the same. Returns the pixels of `under` it laid them on.
function claimBackdrop(under, brow, between) {
  const R = 6, NEAR = 30, INK = 80;
  const b = brow.canvas.getContext('2d'), bi = b.getImageData(0, 0, brow.w, brow.h), bd = bi.data;
  const lum = k => bd[k] * 0.3 + bd[k + 1] * 0.59 + bd[k + 2] * 0.11;
  const solid = [];
  for (let k = 0; k < bd.length; k += 4) if (bd[k + 3] >= 250) solid.push(k);
  if (!solid.length) return new Set();
  const ink = [...solid].sort((p, q) => lum(p) - lum(q))[Math.floor(solid.length * 0.1)];
  // only the part of `under` round the brow (its box and R more): all that is read or laid on
  const sx0 = Math.max(under.x, brow.x - R), sy0 = Math.max(under.y, brow.y - R);
  const sx1 = Math.min(under.x + under.w, brow.x + brow.w + R), sy1 = Math.min(under.y + under.h, brow.y + brow.h + R);
  const taken = new Set();
  if (sx0 >= sx1 || sy0 >= sy1) return taken;
  const sw = sx1 - sx0, sub = (gx, gy) => ((gy - sy0) * sw + gx - sx0) * 4;
  const u = under.canvas.getContext('2d'), ui = u.getImageData(sx0 - under.x, sy0 - under.y, sw, sy1 - sy0), ud = ui.data;
  const covered = (gx, gy) => between.some(p => gx >= p.x && gy >= p.y && gx < p.x + p.w && gy < p.y + p.h
    && p.alpha[(gy - p.y) * p.w + gx - p.x] > ALPHA_MIN);
  const dist = (k, d, e) => Math.hypot(bd[k] - d[e], bd[k + 1] - d[e + 1], bd[k + 2] - d[e + 2]);
  // the main colour of `under` around here (not a detail of it, like a stroke the brow is drawn over)
  const matches = (k, gx, gy) => {
    let n = 0, same = 0;
    for (let y = gy - R; y <= gy + R; y++) for (let x = gx - R; x <= gx + R; x++) {
      if (x < under.x || y < under.y || x >= under.x + under.w || y >= under.y + under.h) continue;
      const e = sub(x, y);
      if (ud[e + 3] < 250) continue;
      n++;
      if (dist(k, ud, e) < NEAR) same++;
    }
    return n >= R * R / 2 && same * 2 >= n;
  };
  const pos = k => [brow.x + (k / 4) % brow.w, brow.y + Math.floor(k / 4 / brow.w)];
  const free = (k, gx, gy) => gx >= under.x && gy >= under.y && gx < under.x + under.w && gy < under.y + under.h
    && dist(k, bd, ink) >= INK && !covered(gx, gy);
  // lay the brow's pixel over `under`'s, and take it out of the brow
  const take = (k, gx, gy) => {
    const e = sub(gx, gy), full = (gy - under.y) * under.w + gx - under.x;
    const ba = bd[k + 3] / 255, ua = ud[e + 3] / 255, a = ba + ua * (1 - ba);
    for (let c = 0; c < 3; c++) ud[e + c] = Math.round((bd[k + c] * ba + ud[e + c] * ua * (1 - ba)) / a);
    ud[e + 3] = under.alpha[full] = Math.round(a * 255);
    bd[k + 3] = brow.alpha[k / 4] = 0;
    queue.push(k); taken.add(full);
  };
  const queue = [];
  for (const k of solid) {
    const [gx, gy] = pos(k);
    if (free(k, gx, gy) && matches(k, gx, gy)) take(k, gx, gy);
  }
  // and the pixels of the same colour next to those, the soft rim too
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i], [gx, gy] = pos(k);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = gx + dx - brow.x, y = gy + dy - brow.y, q = (y * brow.w + x) * 4;
      if (x < 0 || y < 0 || x >= brow.w || y >= brow.h || bd[q + 3] <= ALPHA_MIN || dist(q, bd, k) >= NEAR) continue;
      if (free(q, gx + dx, gy + dy)) take(q, gx + dx, gy + dy);
    }
  }
  if (!queue.length) return taken;
  u.putImageData(ui, sx0 - under.x, sy0 - under.y);
  b.putImageData(bi, 0, 0);
  return taken;
}

// Lays a fill into `p`. The hole's soft rim takes the fill's colour too: it was cut against the skin and is pale.
// With keepAlpha the rim only changes colour and the hole stays open (a brow under `p` shows through it).
function paintFill(p, fill, keepAlpha = false) {
  if (!fill.length) return;
  const ctx = p.canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, p.w, p.h), d = img.data;
  for (let f = 0; f < fill.length; f += 3) {
    const k = ((fill[f + 1] - p.y) * p.w + (fill[f] - p.x)) * 4, v = fill[f + 2];
    if (keepAlpha && !d[k + 3]) continue;
    for (let c = 0; c < 3; c++) d[k + c] = Math.round(clamp(v[c] / v[3], 0, 255));
    if (keepAlpha) continue;
    const oa = d[k + 3] / 255;
    d[k + 3] = Math.round((oa + v[3] * (1 - oa)) * 255);
    p.alpha[k / 4] = d[k + 3];
  }
  ctx.putImageData(img, 0, 0);
}

// Whether `brow`, under `hair`, mostly shows through a hole in it (rather than being hidden by it).
function showsThrough(hair, brow) {
  let n = 0, seen = 0;
  for (let y = 0; y < brow.h; y++) {
    for (let x = 0; x < brow.w; x++) {
      if (brow.alpha[y * brow.w + x] < 128) continue;
      const hx = brow.x + x - hair.x, hy = brow.y + y - hair.y;
      n++;
      if (hx < 0 || hy < 0 || hx >= hair.w || hy >= hair.h || hair.alpha[hy * hair.w + hx] < 128) seen++;
    }
  }
  return n > 0 && seen >= n / 2;
}

// A piece of hair holding a fill of `hair`, to go under `brow`, reaching a pixel under the hair round it so no seam
// shows. It sways like the hair (same role, and the same box, which sets where the sway starts).
function fillPatch(hair, brow, fill) {
  if (!fill.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let f = 0; f < fill.length; f += 3) {
    x0 = Math.min(x0, fill[f]); y0 = Math.min(y0, fill[f + 1]); x1 = Math.max(x1, fill[f] + 1); y1 = Math.max(y1, fill[f + 1] + 1);
  }
  x0--; y0--; x1++; y1++;
  const w = x1 - x0, h = y1 - y0, img = new ImageData(w, h), alpha = new Uint8Array(w * h);
  const hd = hair.canvas.getContext('2d').getImageData(0, 0, hair.w, hair.h).data;
  const set = (i, r, g, b, a) => { img.data.set([r, g, b, a], i * 4); alpha[i] = a; };
  for (let f = 0; f < fill.length; f += 3) {
    const gx = fill[f], gy = fill[f + 1], v = fill[f + 2];
    set((gy - y0) * w + gx - x0, ...[0, 1, 2].map(c => Math.round(clamp(v[c] / v[3], 0, 255))), Math.round(v[3] * 255));
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = gx + dx, ny = gy + dy, i = (ny - y0) * w + nx - x0, hx = nx - hair.x, hy = ny - hair.y;
        if (alpha[i] || hx < 0 || hy < 0 || hx >= hair.w || hy >= hair.h) continue;
        const k = (hy * hair.w + hx) * 4;
        if (hd[k + 3] >= 250) set(i, hd[k], hd[k + 1], hd[k + 2], 255);
      }
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').putImageData(img, 0, 0);
  return {
    name: `${hair.name} · fill ${brow.side ?? ''}`.trim(), role: hair.role, key: null, opacity: hair.opacity, visible: hair.visible,
    x: x0, y: y0, w, h, box: { ...hair.box }, canvas, alpha,
  };
}

const union = (a, b) => (!a ? b : !b ? a : {
  x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
});

function computeRig(pieces, W, H) {
  const box = pred => pieces.filter(pred).reduce((b, p) => union(b, p.box), null);
  const face = box(p => p.role === 'face') ?? box(p => ROLES[p.role]?.head)
    ?? { x0: W * 0.3, y0: H * 0.1, x1: W * 0.7, y1: H * 0.5 };
  const cx = (face.x0 + face.x1) / 2, cy = (face.y0 + face.y1) / 2;
  const r = (Math.max(face.x1 - face.x0, face.y1 - face.y0) / 2) * 1.05;
  const rig = { head: { cx, cy, r }, neck: { x: cx, y: face.y1 }, turn: 0.5, eyes: {}, mouth: null, body: null };

  for (const side of ['L', 'R']) {
    const white = box(p => p.role === 'eye_white' && p.side === side);
    const lash = box(p => p.role === 'eyelash' && p.side === side);
    const u = union(white, lash);
    if (!u) continue;
    const lidY = white ? white.y0 + 0.62 * (white.y1 - white.y0) : u.y0 + 0.6 * (u.y1 - u.y0);
    rig.eyes[side] = { cx: (u.x0 + u.x1) / 2, w: u.x1 - u.x0, h: u.y1 - u.y0, top: u.y0, lidY: Math.round(lidY) };
  }
  const m = box(p => p.role === 'mouth');
  if (m) rig.mouth = { cx: (m.x0 + m.x1) / 2, cy: (m.y0 + m.y1) / 2, w: m.x1 - m.x0, h: m.y1 - m.y0, y0: m.y0, innerH: 0 };
  const b = box(p => p.role === 'body') ?? box(p => p.role === 'neck');
  if (b) rig.body = { ...b };
  return rig;
}

// The PSD has only the closed mouth, so draw the open ones, anime style: a dark outline (heavier on the upper lip),
// a dark-red inside, a strip of upper teeth and a tongue. The runtime shows one at a time instead of stretching the
// closed mouth. Shapes are in units of the mouth's width, x along the mouth, y down from the line where the lips meet.
const MOUTH_SHAPES = {
  closed: { label: 'closed', smile: true, hw: 0.28, curve: 0.1 },
  half:  { label: 'half open', hw: 0.5, top: 0.05, bot: 0.24, teeth: 0.07, tongue: 0.35 },
  open:  { label: 'wide open', hw: 0.42, top: 0.1, bot: 0.6, teeth: 0.12, tongue: 0.5, round: true },
  round: { label: 'round o/u', ellipse: true, rx: 0.19, ry: 0.23, dy: 0.08, tongue: 0.45 },
  wide:  { label: 'flat i/e', hw: 0.62, top: 0.03, bot: 0.15, teeth: 0.09, tongue: 0 },
};

function mouthPath(ctx, s, W) {
  ctx.beginPath();
  if (s.ellipse) { ctx.ellipse(0, s.dy * W, s.rx * W, s.ry * W, 0, 0, Math.PI * 2); return; }
  const hw = s.hw * W, top = s.top * W, bot = s.bot * W;
  ctx.moveTo(-hw, 0);
  ctx.quadraticCurveTo(0, -2 * top, hw, 0);
  if (s.round) ctx.bezierCurveTo(hw * 0.9, bot * 1.33, -hw * 0.9, bot * 1.33, -hw, 0);
  else ctx.quadraticCurveTo(0, 2 * bot, -hw, 0);
  ctx.closePath();
}

// Frames for the visemes the PSD did not draw itself (`have`), placed and tilted like the drawn mouth. A mouth drawn
// open (a laughing character) becomes the 'open' frame itself, and a closed smile is drawn for the rest pose.
function makeMouthFrames(mouth, have) {
  const { w, h } = mouth;
  const data = mouth.canvas.getContext('2d').getImageData(0, 0, w, h).data;
  // the line colour: the drawn mouth's darkest opaque pixel
  let line = [70, 30, 40], lum = Infinity;
  // the mouth's axis: principal direction of its pixels, weighted by alpha
  let sw = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, a = data[i + 3] / 255;
      if (a < 0.1) continue;
      sw += a; sx += a * x; sy += a * y; sxx += a * x * x; syy += a * y * y; sxy += a * x * y;
      const L = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
      if (a > 0.5 && L < lum) { lum = L; line = [data[i], data[i + 1], data[i + 2]]; }
    }
  }
  if (!sw) return [];
  const mx = sx / sw, my = sy / sw;
  const cxx = sxx / sw - mx * mx, cyy = syy / sw - my * my, cxy = sxy / sw - mx * my;
  const angle = clamp(0.5 * Math.atan2(2 * cxy, cxx - cyy), -0.6, 0.6);
  // its length along that axis, and its thickness across it
  const ax = Math.cos(angle), ay = Math.sin(angle);
  let lo = Infinity, hi = -Infinity, lo2 = Infinity, hi2 = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 26) continue;
      const t = (x - mx) * ax + (y - my) * ay, u = -(x - mx) * ay + (y - my) * ax;
      lo = Math.min(lo, t); hi = Math.max(hi, t);
      lo2 = Math.min(lo2, u); hi2 = Math.max(hi2, u);
    }
  }
  const W = Math.max(8, hi - lo);
  // drawn open: the frames' lip line sits 30 % down from its top edge, where closed lips would meet
  // (a closed line with soft shading reaches ~0.4 of its length; a drawn open mouth is well over half)
  const drawnOpen = hi2 - lo2 > Math.max(6, 0.5 * W);
  const shift = drawnOpen ? lo2 + 0.3 * (hi2 - lo2) : 0;
  const cx = mouth.x + mx - ay * shift, cy = mouth.y + my + ax * shift;
  if (drawnOpen) {
    mouth.role = 'mouth_frame';
    mouth.viseme = 'open';
    have = new Set([...have, 'open']);
  } else {
    have = new Set([...have, 'closed']); // the drawn mouth is the closed one
  }

  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  // the inside: a drawn open mouth's own colour (its reddish, mid-light pixels), else a dark red from the line
  let fill = null;
  if (drawnOpen) {
    let n = 0, r = 0, g = 0, b = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      const L = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
      if (L < 70 || L > 225 || data[i] < data[i + 2] + 25 || data[i] < data[i + 1] + 15) continue;
      n++; r += data[i]; g += data[i + 1]; b += data[i + 2];
    }
    if (n > 20) fill = [r / n, g / n, b / n].map(Math.round);
  }
  const ink = `rgb(${mix(line, [55, 18, 28], 0.35)})`;
  const inner = `rgb(${fill ? mix(fill, [120, 36, 52], 0.25) : mix(line, [120, 36, 52], 0.7)})`;
  const tongueColor = fill ? `rgb(${mix(fill, [255, 190, 196], 0.45)})` : '#ec8592';
  const S = Math.ceil(W * 1.6);                 // the frame's box on the canvas
  const k = Math.max(4, Math.ceil(180 / S));    // drawn this many times finer, so it stays crisp when zoomed
  const x0 = Math.round(cx - S / 2), y0 = Math.round(cy - S * 0.35);
  const lw = Math.max(0.8, W * 0.055);

  const frames = [];
  for (const [viseme, s] of Object.entries(MOUTH_SHAPES)) {
    if (have.has(viseme)) continue;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S * k;
    const ctx = canvas.getContext('2d');
    ctx.scale(k, k);
    ctx.translate(cx - x0, cy - y0);
    ctx.rotate(angle);
    ctx.lineJoin = ctx.lineCap = 'round';
    if (s.smile) { // a closed smile: one curved line, corners up
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw * 1.4;
      ctx.beginPath();
      ctx.moveTo(-s.hw * W, 0);
      ctx.quadraticCurveTo(0, 2 * s.curve * W, s.hw * W, 0);
      ctx.stroke();
      frames.push(frameOf(viseme, s, canvas));
      continue;
    }
    mouthPath(ctx, s, W);
    ctx.fillStyle = inner;
    ctx.fill();
    ctx.save();
    ctx.clip();
    if (s.teeth) { // the upper lip's curve, shifted down by the teeth's height
      const hw = s.hw * W, top = s.top * W, t = s.teeth * W;
      ctx.beginPath();
      ctx.moveTo(-hw * 1.1, -t);
      ctx.quadraticCurveTo(0, -2 * top - t, hw * 1.1, -t);
      ctx.lineTo(hw * 1.1, t);
      ctx.quadraticCurveTo(0, -2 * top + t, -hw * 1.1, t);
      ctx.closePath();
      ctx.fillStyle = '#fffcf8';
      ctx.fill();
    }
    if (s.tongue) {
      const bottom = s.ellipse ? (s.dy + s.ry) * W : s.bot * W, depth = s.ellipse ? s.ry * 2 * W : s.bot * W;
      const rx = (s.ellipse ? s.rx : s.hw) * W * 0.62;
      ctx.beginPath();
      ctx.ellipse(0, bottom - depth * s.tongue * 0.3, rx, depth * s.tongue * 0.55, 0, 0, Math.PI * 2);
      ctx.fillStyle = tongueColor;
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = ink;
    ctx.lineWidth = lw;
    mouthPath(ctx, s, W);
    ctx.stroke();
    if (!s.ellipse) { // a heavier upper lip
      ctx.lineWidth = lw * 1.7;
      ctx.beginPath();
      ctx.moveTo(-s.hw * W, 0);
      ctx.quadraticCurveTo(0, -2 * s.top * W, s.hw * W, 0);
      ctx.stroke();
    }
    frames.push(frameOf(viseme, s, canvas));
  }
  return frames;

  function frameOf(viseme, s, canvas) {
    return {
      name: `mouth · ${s.label} (generated)`, role: 'mouth_frame', viseme, key: null, opacity: 1, visible: true,
      x: x0, y: y0, w: S, h: S, box: { x0, y0, x1: x0 + S, y1: y0 + S }, canvas, mesh: gridMesh(x0, y0, S, S, 4),
    };
  }
}

// A plain n x n grid over a box (for drawn parts with no alpha mask to follow).
function gridMesh(x, y, w, h, n) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { pos.push(x + (w * i) / n, y + (h * j) / n); uv.push(i / n, j / n); }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      idx.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1);
    }
  }
  return { pos: new Float32Array(pos), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
}

// Grid mesh over the part, keeping only cells that touch visible pixels.
function buildMesh(p, scale) {
  const { w, h, alpha } = p;
  // whole pixels: the occupancy test indexes the alpha mask by these coordinates
  let s = Math.max(3, Math.round(Math.min(24 * scale, Math.min(w, h) / 8)));
  for (;;) {
    const cols = Math.max(1, Math.ceil(w / s)), rows = Math.max(1, Math.ceil(h / s));
    const gx = i => Math.min(w, i * s), gy = j => Math.min(h, j * s);
    const vid = new Int32Array((cols + 1) * (rows + 1)).fill(-1);
    const pos = [], uv = [], idx = [];
    const vert = (i, j) => {
      const k = j * (cols + 1) + i;
      if (vid[k] < 0) {
        vid[k] = pos.length / 2;
        pos.push(p.x + gx(i), p.y + gy(j));
        uv.push(gx(i) / w, gy(j) / h);
      }
      return vid[k];
    };
    const occupied = (i, j) => {
      const xa = Math.max(0, gx(i) - 1), xb = Math.min(w, gx(i + 1) + 1);
      const ya = Math.max(0, gy(j) - 1), yb = Math.min(h, gy(j + 1) + 1);
      for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) if (alpha[y * w + x] > 4) return true;
      return false;
    };
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (!occupied(i, j)) continue;
        const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
        idx.push(a, b, c, b, d, c);
      }
    }
    if (pos.length / 2 <= 65535) {
      return { pos: new Float32Array(pos), uv: new Float32Array(uv), idx: new Uint16Array(idx) };
    }
    s = Math.ceil(s * 1.5);
  }
}
