// .doll model files: a single JSON document with PNG textures embedded as data URLs.
// See FORMAT.md for the schema.

import { tr } from './i18n.js';

const r2 = v => Math.round(v * 100) / 100;
const r5 = v => Math.round(v * 1e5) / 1e5;

export function serializeDoll(model) {
  return {
    format: 'doll',
    version: 1,
    generator: 'Doll Studio',
    width: model.width,
    height: model.height,
    rig: structuredClone(model.rig),
    physics: model.physics.map(g => ({ ...g })),
    parts: model.parts.map(p => ({
      id: p.id, name: p.name, role: p.role, side: p.side, viseme: p.viseme ?? null, src: p.src,
      x: p.x, y: p.y, w: p.w, h: p.h, box: p.box,
      depth: p.depth, clip: p.clip, opacity: p.opacity, visible: p.visible,
      texture: p.canvas.toDataURL('image/png'),
      mesh: { pos: Array.from(p.mesh.pos, r2), uv: Array.from(p.mesh.uv, r5), idx: Array.from(p.mesh.idx) },
    })),
  };
}

export async function loadDoll(obj) {
  if (obj?.format !== 'doll') throw new Error(tr('This is not a .doll model file', '这不是 .doll 模型文件'));
  if (obj.version > 1) throw new Error(tr('This model was made with a newer Doll Studio. Please update.', '这个模型是用更新版本的 Doll Studio 做的，请先更新。'));
  const parts = await Promise.all(obj.parts.map(async ({ texture, ...p }) => {
    const img = new Image();
    img.src = texture;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return {
      ...p,
      canvas,
      mesh: { pos: new Float32Array(p.mesh.pos), uv: new Float32Array(p.mesh.uv), idx: new Uint16Array(p.mesh.idx) },
    };
  }));
  return { ...obj, parts };
}

// The user's tuning of a model (part roles, control points, physics, which parts show). The app keeps it per model
// file and hands it back when that file is opened again, in the editor or as the pet. A PSD is auto-rigged with
// tuning.overrides and tuning.mouthFrames first; applyTuning then puts back the rest.
export function tuningOf(model, overrides = {}, mouthFrames = false, file = null) {
  return {
    overrides: { ...overrides },
    mouthFrames,
    file, // the file it was made for, to say where it came from when it is used for another file of the same character
    size: [model.width, model.height],
    rig: structuredClone(model.rig),
    physics: model.physics.map(g => ({ ...g })),
    visible: Object.fromEntries(model.parts.map(p => [p.src ?? p.id, p.visible])),
  };
}

// Puts back what the user set: the control points (head, neck, eyelid lines), the turn, physics and which parts
// show. What the auto rig measures from the pixels (the eyes' boxes, mouth, body) is kept from the model, so a
// tuning still fits when the PSD was re-exported or touched up.
export function applyTuning(model, tuning) {
  if (!tuning) return model;
  const rig = model.rig, t = tuning.rig ?? {};
  if (t.head) rig.head = { ...t.head };
  if (t.neck) rig.neck = { ...t.neck };
  if (t.turn != null) rig.turn = t.turn;
  for (const side of ['L', 'R']) {
    const e = rig.eyes?.[side], s = t.eyes?.[side];
    if (!e || !s) continue;
    for (const k of ['cx', 'w', 'angle']) if (s[k] != null) e[k] = s[k];
    if (s.lidY != null) e.lidY = Math.min(Math.max(s.lidY, e.top + 2), e.top + e.h);
  }
  for (const g of model.physics) Object.assign(g, tuning.physics?.find(t => t.id === g.id));
  for (const p of model.parts) p.visible = tuning.visible?.[p.src ?? p.id] ?? p.visible;
  return model;
}

// How far apart two rigs' auto-measured face features are, in pixels (the largest difference): the eyes' boxes and
// the mouth. The user never moves these, so the same character in another file (a re-export or a re-download of
// the PSD) comes out within a few pixels, and a different character far apart.
function faceDistance(model, tuning) {
  const a = model.rig, b = tuning.rig ?? {};
  if (tuning.size && (tuning.size[0] !== model.width || tuning.size[1] !== model.height)) return Infinity;
  const f = [];
  for (const side of ['L', 'R']) {
    const x = a.eyes?.[side], y = b.eyes?.[side];
    if (!x !== !y) return Infinity;
    if (x) f.push(x.top - y.top, x.h - y.h);
  }
  if (!a.mouth !== !b.mouth) return Infinity;
  if (a.mouth) f.push(a.mouth.cx - b.mouth.cx, a.mouth.cy - b.mouth.cy, a.mouth.w - b.mouth.w, a.mouth.h - b.mouth.h);
  if (!f.length) return Infinity; // nothing to tell faces apart by
  return Math.max(...f.map(Math.abs));
}
const faceTolerance = model => Math.max(3, 0.006 * Math.max(model.width, model.height));

// Chooses the tuning for a model that was just opened. saved is what the app kept: { own, others }, where own is
// the tuning of this very file and others those of other files, newest first (a plain tuning counts as own).
// rigWith(tuning) builds the model a tuning goes on (a PSD is auto-rigged with the tuning's overrides; a .doll is
// itself). own is used unless the file now holds a different character; otherwise the tuning of the same
// character in another file is used. Returns { model, tuning, own }, tuning null when none fits.
export function restoreTuning(rigWith, saved) {
  const { own = null, others = [] } = saved && ('own' in saved || 'others' in saved) ? saved : { own: saved };
  if (own) {
    const m = rigWith(own);
    // own is allowed more slack: the user may have redrawn the eyes a little in the same file
    if (faceDistance(m, own) <= 3 * faceTolerance(m)) return { model: applyTuning(m, own), tuning: own, own: true };
  }
  const base = rigWith(null);
  let best = null, bestD = Infinity;
  for (const t of others) {
    const d = faceDistance(base, t);
    if (d < bestD) { best = t; bestD = d; }
  }
  if (!best || bestD > faceTolerance(base)) return { model: base, tuning: null, own: false };
  const custom = Object.keys(best.overrides ?? {}).length || best.mouthFrames;
  return { model: applyTuning(custom ? rigWith(best) : base, best), tuning: best, own: false };
}
