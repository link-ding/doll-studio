// Runtime rig: maps parameters to deformed vertex positions for every part.
// Pipeline per vertex: local feature deform (blink, gaze, mouth) -> physics sway ->
// 2.5D head turn (rotating a relief of the face) -> head roll -> breathing / body sway.

import { ROLES } from './roles.js';

export const PARAMS = [
  { id: 'angleX',    label: 'Turn left / right', zh: '左右转头', min: -30, max: 30, def: 0 },
  { id: 'angleY',    label: 'Look up / down', zh: '抬头 / 低头',    min: -30, max: 30, def: 0 },
  { id: 'angleZ',    label: 'Tilt', zh: '歪头',              min: -30, max: 30, def: 0 },
  { id: 'bodyX',     label: 'Sway', zh: '身体摆动',              min: -10, max: 10, def: 0 },
  { id: 'breath',    label: 'Breath', zh: '呼吸',            min: 0,   max: 1,  def: 0 },
  { id: 'eyeLOpen',  label: 'Left eye open', zh: '左眼睁开',     min: 0,   max: 1,  def: 1 },
  { id: 'eyeROpen',  label: 'Right eye open', zh: '右眼睁开',    min: 0,   max: 1,  def: 1 },
  { id: 'eyeX',      label: 'Gaze left / right', zh: '视线左右', min: -1,  max: 1,  def: 0 },
  { id: 'eyeY',      label: 'Gaze up / down', zh: '视线上下',    min: -1,  max: 1,  def: 0 },
  { id: 'browY',     label: 'Brows up / down', zh: '眉毛上下',   min: -1,  max: 1,  def: 0 },
  { id: 'mouthOpen', label: 'Mouth open', zh: '张嘴',        min: 0,   max: 1,  def: 0 },
  { id: 'mouthForm', label: 'Smile / frown', zh: '笑 / 撇嘴',     min: -1,  max: 1,  def: 0 },
  { id: 'vowel',     label: 'Round (o, u) ↔ flat (i, e)', zh: '圆口 (o, u) ↔ 扁口 (i, e)', min: -1, max: 1, def: 0 },
];

export const defaultParams = () => Object.fromEntries(PARAMS.map(p => [p.id, p.def]));

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;

// Caches per-vertex weights. Call again whenever the rig or part roles change.
export function prepare(model) {
  const { head, neck, body } = model.rig;
  const R = head.r;
  model._byId = new Map(model.parts.map(p => [p.id, p]));
  model._visemes = new Set(model.parts.filter(p => p.role === 'mouth_frame').map(p => p.viseme ?? 'open'));
  model._mouthLevel = 'closed';
  model._mouthVowel = null;
  for (const p of model.parts) {
    const role = ROLES[p.role] ?? ROLES.other;
    const pos = p.mesh.pos, n = pos.length / 2;
    p._out = new Float32Array(pos.length);
    p._op = p.opacity;
    p._head = role.head ? new Float32Array(n) : null;
    p._phys = role.physics ? new Float32Array(n) : null;
    p._body = new Float32Array(n);
    const root = role.physics?.startsWith('hair') ? Math.max(p.box.y0, head.cy - R * 0.9) : p.box.y0;
    const len = Math.max(1, p.box.y1 - root);
    for (let i = 0; i < n; i++) {
      const y = pos[i * 2 + 1];
      if (p._head) p._head[i] = y <= neck.y ? 1 : Math.max(0.15, 1 - (y - neck.y) / (R * 1.6));
      if (p._phys) p._phys[i] = Math.pow(clamp((y - root) / len, 0, 1), 1.5);
      p._body[i] = role.static ? 0 : body ? clamp((body.y1 - y) / (body.y1 - body.y0), 0, 1) : 1;
    }
  }
}

// Damped pendulum per physics group, driven by the head's lateral acceleration.
export class Physics {
  constructor() { this.reset(); }
  reset() { this.state = {}; this.t = 0; this.last = null; this.acc = 0; }
  step(model, P, dt) {
    dt = clamp(dt, 1 / 240, 0.05);
    const px = (P.angleX / 30) * 0.6 + (P.angleZ / 30) * 0.5 + (P.bodyX / 10) * 0.6;
    if (!this.last) this.last = { px, v: 0 };
    const v = (px - this.last.px) / dt;
    this.acc += ((v - this.last.v) / dt - this.acc) * 0.5;
    this.last = { px, v };
    const n = Math.ceil(dt * 120), h = dt / n;
    const eq = (-P.angleZ / 30) * 0.35; // hair keeps hanging down when the head tilts
    for (const g of model.physics) {
      const s = (this.state[g.id] ??= { a: 0, v: 0 });
      for (let k = 0; k < n; k++) {
        const t = this.t + k * h;
        const wind = 0.05 * Math.sin(t * 1.7 + g.k) * Math.sin(t * 0.63);
        const f = -g.k * (s.a - eq - wind) - g.c * s.v - this.acc * g.gain * 0.8;
        s.v += f * h;
        s.a = clamp(s.a + s.v * h, -1.3, 1.3);
      }
    }
    this.t += dt;
  }
}

// Closes an eye toward the lid line. The top band (the lash line, thickness T) slides
// down rigidly so the closed eye keeps a solid line; the rest squashes away under it.
// Works in the eye's own frame (u along the lid line, v down across it) so a tilted lid
// (eye.angle, radians) closes along its tilt.
function closeLid(x, y, eye, open, lower) {
  const c = Math.cos(eye.angle ?? 0), s = Math.sin(eye.angle ?? 0);
  const dx = x - eye.cx, dy = y - eye.lidY;
  const u = dx * c + dy * s, d = dx * s - dy * c;
  const D = Math.max(1, eye.lidY - eye.top), T = D * 0.32;
  const nx = clamp(u / (eye.w / 2), -1, 1);
  const arc = (1 - open) * eye.h * 0.08 * (1 - nx * nx);
  const v = (d > 0 ? -(d < D - T ? d * open : d - (1 - open) * (D - T)) : -d * lower) + arc;
  return [eye.cx + u * c - v * s, eye.lidY + u * s + v * c];
}

// Which mouth to show: 'closed' (the drawn mouth) or a mouth_frame's viseme. The opening picks closed / half / open
// and the vowel replaces it with round or wide, each with hysteresis so the mouth doesn't flicker between two shapes.
// A viseme the model lacks falls back to the nearest one it has.
const MOUTH_FALLBACK = {
  half: ['half', 'open', 'wide', 'round'], open: ['open', 'half', 'round', 'wide'],
  round: ['round', 'half', 'open', 'wide'], wide: ['wide', 'half', 'open', 'round'],
};
function mouthFrame(model, P) {
  const o = P.mouthOpen, v = P.vowel ?? 0;
  let L = model._mouthLevel;
  if (L === 'closed') { if (o > 0.15) L = o > 0.55 ? 'open' : 'half'; }
  else if (o < 0.08) L = 'closed';
  else if (L === 'half' && o > 0.55) L = 'open';
  else if (L === 'open' && o < 0.42) L = 'half';
  model._mouthLevel = L;
  let V = model._mouthVowel;
  if (V === 'round' ? v > -0.25 : V === 'wide' ? v < 0.25 : true) V = v < -0.4 ? 'round' : v > 0.4 ? 'wide' : null;
  model._mouthVowel = V;
  if (L === 'closed') return 'closed';
  return MOUTH_FALLBACK[V ?? L].find(f => model._visemes.has(f)) ?? 'closed';
}

export function evaluate(model, P, physics) {
  const { head, neck, eyes, mouth, body } = model.rig;
  const R = head.r;
  const k = (model.rig.turn ?? 0.5) * DEG;
  const yaw = P.angleX * k, pitch = P.angleY * k, roll = P.angleZ * DEG * 0.8;
  const breathPx = (body ? body.y1 - body.y0 : R * 3) * 0.01 * P.breath;
  const sway = (P.bodyX / 10) * R * 0.15;
  // a model with mouth frames swaps them; an older one (mouth_inner) stretches its mouth, wider for i / e and
  // narrower for o / u
  const frame = model._visemes?.size ? mouthFrame(model, P) : null;
  const wide = Math.max(0, P.vowel ?? 0), round = Math.max(0, -(P.vowel ?? 0));
  const mouthW = 1 + 0.2 * wide - 0.25 * round;
  const innerW = 1 + 0.3 * wide - 0.35 * round, innerH = 1 - 0.35 * wide + 0.15 * round;
  const groups = new Map(model.physics.map(g => [g.id, g]));

  for (const p of model.parts) {
    const role = p.role, src = p.mesh.pos, out = p._out;
    const eye = p.side && ROLES[role]?.split ? eyes[p.side] : null;
    const open = p.side === 'L' ? P.eyeLOpen : p.side === 'R' ? P.eyeROpen : Math.min(P.eyeLOpen, P.eyeROpen);
    const g = groups.get(ROLES[role]?.physics);
    const swing = g ? (physics?.state[g.id]?.a ?? 0) * g.amp * R : 0;
    const [base, bump] = p.depth;
    let op = p.opacity;
    if (role === 'eye_white' || role === 'iris') op *= smoothstep(0.02, 0.22, open);
    if (role === 'mouth_inner') op *= smoothstep(0, 0.08, P.mouthOpen);
    if (role === 'mouth_frame') op *= p.viseme === frame ? 1 : 0;
    if (role === 'mouth' && frame && frame !== 'closed') op = 0;

    for (let i = 0, vi = 0; i < src.length; i += 2, vi++) {
      let x = src[i], y = src[i + 1];

      if (eye) {
        // offsets along (u) and across (v) the lid line, turned by its tilt
        const c = Math.cos(eye.angle ?? 0), s = Math.sin(eye.angle ?? 0);
        let u = 0, v = 0;
        if (role === 'eyelash') [x, y] = closeLid(x, y, eye, open, lerp(0.8, 1, open));
        else if (role === 'eye_white') [x, y] = closeLid(x, y, eye, open, open);
        else if (role === 'iris') { u = P.eyeX * eye.w * 0.15; v = -P.eyeY * eye.h * 0.12; }
        else if (role === 'eyebrow') v = -P.browY * eye.h * 0.3 + (1 - open) * eye.h * 0.08;
        x += u * c - v * s;
        y += u * s + v * c;
      }
      if (mouth && role === 'mouth') {
        const nx = clamp((x - mouth.cx) / (mouth.w / 2), -1, 1);
        if (!frame) {
          x = mouth.cx + (x - mouth.cx) * lerp(1, mouthW, P.mouthOpen);
          y += P.mouthOpen * innerH * mouth.innerH * clamp((y - mouth.y0) / mouth.h, 0, 1);
        }
        y -= P.mouthForm * mouth.w * 0.12 * nx * nx;
      } else if (role === 'mouth_inner') {
        x = mouth.cx + (x - mouth.cx) * lerp(0.6, 1, P.mouthOpen) * innerW;
        y = p.box.y0 + (y - p.box.y0) * P.mouthOpen * innerH;
      }

      if (p._phys) x += swing * p._phys[vi];

      if (p._head) {
        const w = p._head[vi];
        const X = x - head.cx, Y = y - head.cy;
        const d2 = (X * X + Y * Y) / (R * R);
        const Z = R * (base + bump * (d2 < 1 ? Math.sqrt(1 - d2) : 0));
        const cy = Math.cos(yaw * w), sy = Math.sin(yaw * w);
        const cx = Math.cos(pitch * w), sx = Math.sin(pitch * w);
        const X1 = X * cy + Z * sy;
        const Z1 = -X * sy + Z * cy;
        const Y1 = Y * cx - Z1 * sx;
        x = head.cx + X1;
        y = head.cy + Y1;
        const a = roll * w, ca = Math.cos(a), sa = Math.sin(a);
        const dx = x - neck.x, dy = y - neck.y;
        x = neck.x + dx * ca - dy * sa + sway;
        y = neck.y + dx * sa + dy * ca - breathPx;
      } else {
        const t = p._body[vi];
        x += sway * t;
        y -= breathPx * t;
      }
      out[i] = x;
      out[i + 1] = y;
    }
    p._op = op;
  }
}
