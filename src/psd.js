// PSD / PSB reader with no dependencies. Parses the layer records and channel data
// (raw, RLE, ZIP, ZIP with prediction), applies layer masks, and returns one RGBA
// image per pixel layer, bottom to top. Group folders are flattened into `group`. Each layer is cropped to its
// pixels (with a small clear margin): splitters often save every layer at full canvas size, mostly empty.

import { tr } from './i18n.js';

class Reader {
  constructor(buf) {
    this.v = new DataView(buf);
    this.b = new Uint8Array(buf);
    this.pos = 0;
  }
  u8() { return this.v.getUint8(this.pos++); }
  u16() { const x = this.v.getUint16(this.pos); this.pos += 2; return x; }
  i16() { const x = this.v.getInt16(this.pos); this.pos += 2; return x; }
  u32() { const x = this.v.getUint32(this.pos); this.pos += 4; return x; }
  i32() { const x = this.v.getInt32(this.pos); this.pos += 4; return x; }
  u64() { const hi = this.u32(), lo = this.u32(); return hi * 2 ** 32 + lo; }
  len(big) { return big ? this.u64() : this.u32(); }
  str(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.b[this.pos + i]);
    this.pos += n;
    return s;
  }
  bytes(n) { const out = this.b.subarray(this.pos, this.pos + n); this.pos += n; return out; }
  skip(n) { this.pos += n; }
}

// Tagged blocks whose length is 8 bytes in PSB files.
const LONG_KEYS = new Set(['LMsk', 'Lr16', 'Lr32', 'Layr', 'Mt16', 'Mt32', 'Mtrn', 'Alph', 'FMsk', 'lnk2', 'FEid', 'FXid', 'PxSD']);

export async function readPSD(buffer) {
  const r = new Reader(buffer);
  if (r.str(4) !== '8BPS') throw new Error(tr('This is not a PSD file', '这不是 PSD 文件'));
  const big = r.u16() === 2;
  r.skip(6);
  r.u16(); // channels of the merged image
  const height = r.u32(), width = r.u32(), depth = r.u16(), mode = r.u16();
  if (depth !== 8 && depth !== 16) throw new Error(tr(`${depth}-bit PSDs are not supported yet. Save it as 8 or 16-bit.`, `暂不支持 ${depth} 位的 PSD，请另存为 8 位或 16 位。`));
  if (mode !== 3 && mode !== 1) throw new Error(tr('Only RGB and grayscale PSDs are supported', '只支持 RGB 和灰度模式的 PSD'));
  r.skip(r.u32()); // color mode data
  r.skip(r.u32()); // image resources

  const lmLen = r.len(big), lmEnd = r.pos + lmLen;
  let records = [];
  if (lmLen > 0) {
    const liLen = r.len(big), liEnd = r.pos + liLen;
    if (liLen > 0) records = await readLayerInfo(r, big, depth);
    r.pos = liEnd;
    // 16-bit files keep their layers in a global 'Lr16' block instead.
    if (records.length === 0 && r.pos + 4 <= lmEnd) {
      r.skip(r.u32()); // global layer mask
      while (r.pos + 12 <= lmEnd) {
        const sig = r.str(4);
        if (sig !== '8BIM' && sig !== '8B64') break;
        const key = r.str(4);
        const len = big && LONG_KEYS.has(key) ? r.u64() : r.u32();
        const end = r.pos + len;
        if (key === 'Lr16' || key === 'Layr') { records = await readLayerInfo(r, big, depth); break; }
        r.pos = end;
      }
    }
  }

  const layers = [];
  const stack = [];
  for (let i = records.length - 1; i >= 0; i--) { // top to bottom, so folders open before their children
    const rec = records[i];
    if (rec.divider === 1 || rec.divider === 2) { stack.push(rec); continue; }
    if (rec.divider === 3) { stack.pop(); continue; }
    const w = rec.right - rec.left, h = rec.bottom - rec.top;
    if (w <= 0 || h <= 0) continue;
    layers.unshift({
      name: rec.name,
      group: stack.map(g => g.name).join('/'),
      visible: !rec.hidden && !stack.some(g => g.hidden),
      opacity: rec.opacity / 255,
      blend: rec.blend,
      ...crop(rec.left, rec.top, w, h, composeRGBA(rec, w, h, mode)),
    });
  }
  if (!layers.length) throw new Error(tr('No pixel layers found in this PSD', '这个 PSD 里没有像素图层'));
  return { width, height, depth, layers };
}

async function readLayerInfo(r, big, depth) {
  const count = Math.abs(r.i16());
  const recs = [];
  for (let i = 0; i < count; i++) recs.push(readRecord(r, big));
  for (const rec of recs) {
    for (const ch of rec.channels) {
      const start = r.pos;
      const rect = ch.id === -2 ? rec.mask : ch.id >= -1 ? rec : null;
      if (rect) ch.pixels = await readChannel(r, ch.length, rect.right - rect.left, rect.bottom - rect.top, depth, big);
      r.pos = start + ch.length;
    }
  }
  return recs;
}

function readRecord(r, big) {
  const top = r.i32(), left = r.i32(), bottom = r.i32(), right = r.i32();
  const n = r.u16();
  const channels = [];
  for (let i = 0; i < n; i++) channels.push({ id: r.i16(), length: r.len(big), pixels: null });
  r.skip(4); // '8BIM'
  const blend = r.str(4);
  const opacity = r.u8();
  const clipping = r.u8();
  const flags = r.u8();
  r.skip(1);
  const extraLen = r.u32(), extraEnd = r.pos + extraLen;

  const maskLen = r.u32(), maskEnd = r.pos + maskLen;
  let mask = null;
  if (maskLen >= 18) {
    const t = r.i32(), l = r.i32(), b = r.i32(), rr = r.i32();
    const defaultColor = r.u8(), mflags = r.u8();
    mask = { top: t, left: l, bottom: b, right: rr, defaultColor, disabled: !!(mflags & 2) };
  }
  r.pos = maskEnd;
  r.skip(r.u32()); // blending ranges

  const nameLen = r.u8();
  let name = new TextDecoder().decode(r.bytes(nameLen));
  r.skip((4 - ((nameLen + 1) % 4)) % 4);

  let divider = 0;
  while (r.pos + 12 <= extraEnd) {
    const sig = r.str(4);
    if (sig !== '8BIM' && sig !== '8B64') break;
    const key = r.str(4);
    const len = big && LONG_KEYS.has(key) ? r.u64() : r.u32();
    const start = r.pos;
    if (key === 'luni') {
      const c = r.u32();
      let s = '';
      for (let i = 0; i < c; i++) s += String.fromCharCode(r.u16());
      name = s.replace(/\0+$/, '');
    } else if (key === 'lsct' || key === 'lsdk') {
      divider = r.u32();
    }
    r.pos = start + len;
  }
  r.pos = extraEnd;
  return { top, left, bottom, right, channels, blend, opacity, clipping, hidden: !!(flags & 2), mask, name, divider };
}

async function readChannel(r, length, w, h, depth, big) {
  const comp = r.u16();
  if (w <= 0 || h <= 0) return null;
  const bpc = depth / 8, rowBytes = w * bpc;
  let raw;
  if (comp === 0) {
    raw = r.bytes(rowBytes * h);
  } else if (comp === 1) {
    const counts = [];
    for (let y = 0; y < h; y++) counts.push(big ? r.u32() : r.u16());
    raw = new Uint8Array(rowBytes * h);
    for (let y = 0; y < h; y++) {
      const end = r.pos + counts[y];
      unpackBits(r.b, r.pos, end, raw, y * rowBytes, rowBytes);
      r.pos = end;
    }
  } else if (comp === 2 || comp === 3) {
    raw = await inflate(r.bytes(length - 2));
    if (comp === 3) unpredict(raw, w, h, bpc);
  } else {
    throw new Error(tr(`Unknown PSD compression ${comp}`, `未知的 PSD 压缩方式 ${comp}`));
  }
  if (bpc === 1) return raw;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = raw[i * 2];
  return out;
}

function unpackBits(src, i, end, dst, o, n) {
  const stop = o + n;
  while (i < end && o < stop) {
    let c = src[i++];
    if (c > 127) c -= 256;
    if (c >= 0) {
      for (let k = 0; k <= c; k++) { const v = src[i++]; if (o < stop) dst[o++] = v; }
    } else if (c !== -128) {
      const v = src[i++];
      for (let k = 0; k < 1 - c && o < stop; k++) dst[o++] = v;
    }
  }
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function unpredict(d, w, h, bpc) {
  if (bpc === 1) {
    for (let y = 0; y < h; y++) for (let x = 1, i = y * w + 1; x < w; x++, i++) d[i] = (d[i] + d[i - 1]) & 255;
    return;
  }
  for (let y = 0; y < h; y++) {
    let prev = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 2;
      const v = (((d[i] << 8) | d[i + 1]) + prev) & 0xffff;
      d[i] = v >> 8; d[i + 1] = v & 255; prev = v;
    }
  }
}

// A layer's pixels cropped to what is not fully transparent, plus MARGIN clear pixels on each side (inside the
// layer) so a part cut from it keeps its usual padding. An empty layer becomes one clear pixel at its corner.
const MARGIN = 4;
function crop(x, y, w, h, rgba) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let j = 0; j < h; j++) {
    const row = j * w * 4;
    for (let i = 0; i < w; i++) {
      if (!rgba[row + i * 4 + 3]) continue;
      if (i < x0) x0 = i;
      if (i > x1) x1 = i;
      if (j < y0) y0 = j;
      y1 = j;
    }
  }
  if (x1 < 0) return { x, y, width: 1, height: 1, rgba: new Uint8ClampedArray(4) };
  x0 = Math.max(0, x0 - MARGIN); y0 = Math.max(0, y0 - MARGIN);
  x1 = Math.min(w - 1, x1 + MARGIN); y1 = Math.min(h - 1, y1 + MARGIN);
  if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return { x, y, width: w, height: h, rgba };
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, out = new Uint8ClampedArray(cw * ch * 4);
  for (let j = 0; j < ch; j++) out.set(rgba.subarray(((j + y0) * w + x0) * 4, ((j + y0) * w + x1 + 1) * 4), j * cw * 4);
  return { x: x + x0, y: y + y0, width: cw, height: ch, rgba: out };
}

function composeRGBA(rec, w, h, mode) {
  const ch = id => rec.channels.find(c => c.id === id)?.pixels;
  const R = ch(0), G = mode === 3 ? ch(1) : R, B = mode === 3 ? ch(2) : R, A = ch(-1);
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = R ? R[i] : 0;
    out[i * 4 + 1] = G ? G[i] : 0;
    out[i * 4 + 2] = B ? B[i] : 0;
    out[i * 4 + 3] = A ? A[i] : 255;
  }
  const m = rec.mask, M = ch(-2);
  if (m && !m.disabled) {
    const mw = m.right - m.left, mh = m.bottom - m.top;
    for (let y = 0; y < h; y++) {
      const py = y + rec.top - m.top;
      for (let x = 0; x < w; x++) {
        const px = x + rec.left - m.left;
        const v = M && px >= 0 && py >= 0 && px < mw && py < mh ? M[py * mw + px] : m.defaultColor;
        const k = (y * w + x) * 4 + 3;
        out[k] = (out[k] * v) / 255;
      }
    }
  }
  return out;
}
