// Idle motion: what the character does when nothing else drives it.
//
// Adapted from LivLiv Player (src/runtime/idle.ts, https://github.com/livliv-dev/player), Copyright 2026 LivLiv,
// Apache License 2.0 (see THIRD_PARTY_NOTICES.md). Changes: ported to JavaScript; parameters renamed to Doll Studio's
// (eyeBallX/Y -> eyeX/Y, browLY/RY -> browY, smile -> mouthForm); the body lean (bodyZ) and the body's follow of the
// head dropped, as Doll Studio's rig has no lean.
//
// What it does:
//  - the head and body wander on smooth value noise and follow their targets through damped springs, so the motion
//    never repeats and a turn has a follow-through
//  - breaths are uneven (in 40 % of the cycle, out 48 %, a pause; 3.2-4.6 s); one blink in six is a double blink and
//    the brows dip a little with each
//  - every 10-20 s while nothing else is going on, a small idle move: a glance aside, looking around, a sway, thinking,
//    a look down
//  - following the pointer ('attend'): the head turns at most ~13 degrees (a 2D puppet shows it is flat on big turns)
//    and the eyes lead; the brows lift when the pointer moves fast or comes near, a soft squint and now and then a
//    smile while it rests on the face, a look back at the viewer once it rests elsewhere

import { clamp, smoothstep } from './rig.js';

// v as it is up to k, then easing toward cap (never past it): a soft limit on everything that adds up to an angle
const knee = (v, k, cap) => { const a = Math.abs(v); return a <= k ? v : Math.sign(v) * (k + (cap - k) * Math.tanh((a - k) / (cap - k))); };
// an envelope s seconds after an event: up over a, held h, down over d; 0 before and after
const env = (s, a, h, d) => (s < 0 || s > a + h + d ? 0 : s < a ? smoothstep(0, a, s) : 1 - smoothstep(a + h, a + h + d, s));

// smooth 1D value noise in -1..1: random values at whole numbers, eased between
function noise(t, seed) {
  const h = n => { const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453; return x - Math.floor(x); };
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1;
}
const fbm = (t, seed) => noise(t, seed) * 0.7 + noise(t * 2.3, seed + 17) * 0.3;

// a keyframed track [[seconds, value], ...]: cubic through the keys, flat at the first and last
function sample(k, t) {
  if (t <= k[0][0]) return k[0][1];
  const n = k.length - 1;
  if (t >= k[n][0]) return k[n][1];
  let i = 0;
  while (t > k[i + 1][0]) i++;
  const slope = j => (j <= 0 || j >= n ? 0 : (k[j + 1][1] - k[j - 1][1]) / (k[j + 1][0] - k[j - 1][0]));
  const h = k[i + 1][0] - k[i][0], u = (t - k[i][0]) / h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * k[i][1] + (u3 - 2 * u2 + u) * slope(i) * h + (-2 * u3 + 3 * u2) * k[i + 1][1] + (u3 - u2) * slope(i + 1) * h;
}

// Idle moves. Head / body tracks are degrees added to the wander's targets; eyeX/Y add to the gaze; eye multiplies the
// eye opening; brow adds to the brows; breath replaces the breathing. A move mirrors at random (the sign of X and Z).
export const IDLE_MOVES = {
  glance: { dur: 4.0, tracks: {
    eyeX: [[0, 0], [0.15, 0.8], [2.5, 0.75], [2.8, 0]], eyeY: [[0, 0], [0.15, 0.25], [2.5, 0.2], [2.8, 0]],
    angleX: [[0, 0], [0.6, 11], [2.5, 10], [3.4, 0]], angleY: [[0, 0], [0.6, 4], [2.5, 3], [3.4, 0]], angleZ: [[0, 0], [0.7, -4], [2.5, -3], [3.4, 0]],
    bodyX: [[0, 0], [1.0, 2], [2.6, 1.5], [3.8, 0]], brow: [[0, 0], [0.4, 0.25], [2.5, 0.2], [3.2, 0]],
    breath: [[0, 0.1], [0.6, 0.7], [2.6, 0.6], [3.6, 0], [4.0, 0.15]] } },
  lookAround: { dur: 5.0, tracks: {
    eyeX: [[0, 0], [0.2, -0.8], [1.4, -0.75], [1.7, 0.1], [2.0, 0.8], [3.2, 0.75], [3.5, 0]],
    angleX: [[0, 0], [0.7, -15], [1.5, -14], [2.4, 15], [3.3, 14], [4.2, 0]], angleY: [[0, 0], [0.8, 3], [2.4, 3], [4.2, 0]],
    angleZ: [[0, 0], [0.8, 3], [1.7, 0], [2.5, -3], [4.2, 0]], bodyX: [[0, 0], [1.0, -3], [2.7, 3], [4.4, 0]],
    brow: [[0, 0], [0.5, 0.3], [3.4, 0.25], [4.2, 0]], breath: [[0, 0.2], [0.6, 0.8], [3.4, 0.7], [4.4, 0], [5.0, 0.1]] } },
  sway: { dur: 6.0, tracks: {
    bodyX: [[0, 0], [1.5, 2], [3.0, -2], [4.5, 1.5], [6.0, 0]],
    angleZ: [[0, 0], [1.6, -7], [3.1, 7], [4.6, -6], [6.0, 0]], angleX: [[0, 0], [1.6, 4], [3.1, -4], [4.6, 3], [6.0, 0]],
    eyeX: [[0, 0], [1.6, -0.25], [3.1, 0.25], [4.6, -0.2], [6.0, 0]], eye: [[0, 1], [0.8, 0.88], [5.2, 0.88], [6.0, 1]],
    breath: [[0, 0], [0.75, 1], [1.5, 0], [2.25, 1], [3.0, 0], [3.75, 1], [4.5, 0], [5.25, 0.8], [6.0, 0]] } },
  think: { dur: 4.4, tracks: {
    eyeX: [[0, 0], [0.3, -0.6], [3.4, -0.55], [3.8, 0]], eyeY: [[0, 0], [0.3, 0.6], [3.4, 0.55], [3.8, 0]],
    angleX: [[0, 0], [0.8, -9], [3.4, -8], [4.2, 0]], angleY: [[0, 0], [0.8, 6], [3.4, 5], [4.2, 0]], angleZ: [[0, 0], [0.9, 6], [3.4, 5], [4.2, 0]],
    brow: [[0, 0], [0.6, 0.35], [3.4, 0.3], [4.2, 0]], eye: [[0, 1], [0.6, 0.92], [3.4, 0.92], [4.0, 1]] } },
  lookDown: { dur: 2.4, tracks: {
    eyeY: [[0, 0], [0.2, -0.85], [1.4, -0.8], [1.65, 0]], eyeX: [[0, 0], [0.2, -0.1], [1.4, -0.1], [1.65, 0]],
    angleY: [[0, 0], [0.45, -8], [1.4, -7], [1.9, 1], [2.4, 0]], angleZ: [[0, 0], [0.5, 2], [1.5, 2], [2.4, 0]],
    eye: [[0, 1], [0.3, 0.8], [1.4, 0.8], [1.65, 1]] } },
};
const MIRRORED = new Set(['angleX', 'angleZ', 'bodyX', 'eyeX']);

// [stiffness, damping ratio]: the eyes lead, the head follows with a slight overshoot, the body trails
const SPRING = { angleX: [55, 0.72], angleY: [55, 0.72], angleZ: [45, 0.75], bodyX: [14, 0.9] };

// how far the idle moves things: the head's and body's own wander, how far the head turns toward the pointer, how far
// idle moves turn the head and body, how it follows the pointer ('attend' or 'turn'), and the chance of a smile when
// the pointer rests on the face
export const IDLE_STYLE = { wander: 1, look: 1, moves: 1, pointer: 'attend', smile: 0.4 };

// 'attend' amounts: degrees at the pointer's full reach, before `look`, with soft limits; the gaze's share of the
// pointer's place and its limit, an ellipse through 0.78 sideways and 0.55 up / down; how long a still pointer off the
// face keeps the attention
const ATTEND = {
  yaw: 9, yawKnee: 10, yawCap: 13,
  pitch: 5, pitchKnee: 6, pitchCap: 10,
  roll: 2, rollKnee: 8, rollCap: 12, bodyTurn: 1.5,
  eyeX: 1, eyeY: 0.8, eyeXCap: 0.78, eyeYCap: 0.55, eyeKnee: 0.7,
  hold: 2.2,
};

export class LivelyIdle {
  constructor() {
    this.nextBlink = 2; this.blinkT = -1; this.blinkAt = -99;
    this.blinkRate = 1;
    this.nextSaccade = 1; this.gaze = { x: 0, y: 0 };
    // set while the character talks or reacts: no idle move starts then, and one playing fades
    this.busy = false;
    // false while something else owns the face (a reaction): no smile then
    this.faceFree = true;
    this.moves = 1;
    this.style = { ...IDLE_STYLE };
    // the 'turn' style's input: where to look, -1..1
    this.look = { x: 0, y: 0 };
    // the pointer for 'attend': x, y in -1..1 round the face (y up), d its distance from the face in face radii, on
    // whether it is on the stage
    this.pointer = { x: 0, y: 0, d: 99, on: false };
    this.att = { px: 0, py: 0, on: false, moved: -99, speed: 0, engaged: false, since: 0, x: 0, y: 0, slow: { x: 0, y: 0 },
      soft: 0, side: 1, notice: -99, back: -99, smile: -99, smiled: -99, jitter: { x: 0, y: 0 } };
    this.move = null;
    this.nextMove = 6;
    this.last = '';
    this.s = Object.fromEntries(Object.keys(SPRING).map(k => [k, { x: 0, v: 0 }]));
    this.aim = null;
    this.breathPhase = 0;
    this.breathPeriod = 3.8;
    this.double = false;
    this.seed = Math.random() * 100;
  }

  breathe(dt) {
    this.breathPhase += dt / this.breathPeriod;
    if (this.breathPhase >= 1) { this.breathPhase -= 1; this.breathPeriod = 3.2 + Math.random() * 1.4; }
    const x = this.breathPhase;
    return x < 0.4 ? smoothstep(0, 0.4, x) : x < 0.88 ? 1 - smoothstep(0.4, 0.88, x) : 0;
  }

  apply(P, t, dt) {
    dt = dt > 0 ? Math.min(dt, 0.1) : 0; // a spring stepped backwards runs away
    const st = this.style;
    const A = st.pointer === 'attend';
    if (A) this.attend(t, dt);
    // an idle move now and then; it fades out (0.4 s) when the character gets busy or the pointer holds its attention
    const quiet = this.busy || (A && this.att.engaged);
    if (this.move) {
      this.move.t += dt;
      if (quiet) this.move.fade = Math.max(0, this.move.fade - dt / 0.4);
      if (this.move.t >= IDLE_MOVES[this.move.id].dur || this.move.fade <= 0) this.move = null;
    } else if (quiet) this.nextMove = Math.max(this.nextMove, t + 3);
    else if (this.moves > 0 && t > this.nextMove) {
      const ids = Object.keys(IDLE_MOVES).filter(k => k !== this.last);
      const id = ids[Math.floor(Math.random() * ids.length)];
      this.move = { id, t: 0, side: Math.random() < 0.5 ? -1 : 1, fade: 1 };
      this.last = id;
      this.nextMove = t + IDLE_MOVES[id].dur + 10 + Math.random() * 10;
    }
    const m = this.move, M = m ? IDLE_MOVES[m.id] : null;
    const w = m ? m.fade * smoothstep(0, 0.15, m.t) * (1 - smoothstep(M.dur - 0.25, M.dur, m.t)) : 0;
    const mv = (k, rest = 0) => {
      const tr = M?.tracks[k];
      if (!tr) return rest;
      const v = sample(tr, m.t) * (MIRRORED.has(k) ? m.side : 1);
      return rest + (v - rest) * w * this.moves * (k.startsWith('angle') || k.startsWith('body') ? st.moves : 1);
    };

    // blinks: fast close (75 ms), slower open (120 ms), one in six followed by a second
    let open = 1;
    if (this.blinkT < 0 && t > this.nextBlink) { this.blinkT = 0; this.blinkAt = t; }
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const b = this.blinkT / 0.075;
      open = clamp(b < 1 ? 1 - b : b < 2.6 ? (b - 1) / 1.6 : 1, 0, 1);
      if (b >= 2.6) {
        this.blinkT = -1;
        if (!this.double && Math.random() < 0.18) { this.double = true; this.nextBlink = t + 0.08; }
        else { this.double = false; this.nextBlink = t + (1.8 + Math.random() * 3.8) / Math.max(0.2, this.blinkRate); }
      }
    }
    const eye = clamp(mv('eye', 1), 0, 1) * open;
    P.eyeLOpen = P.eyeROpen = A ? eye * (1 - 0.16 * this.att.soft) : eye;

    const sd = this.seed, L = this.look, lk = st.look, wd = st.wander;
    let gx, gy, target;
    if (A) {
      // the eyes lead: straight to the attention, a small drift of their own at saccades; the head follows, only so far
      const a = this.att, K = ATTEND;
      if (t > this.nextSaccade) {
        a.jitter = { x: (Math.random() - 0.5) * 0.2, y: (Math.random() - 0.5) * 0.16 };
        this.nextSaccade = t + 0.6 + Math.random() * 1.6;
      }
      this.gaze = { x: K.eyeX * a.x + a.jitter.x, y: K.eyeY * a.y + a.jitter.y };
      const ex = this.gaze.x + mv('eyeX'), ey = this.gaze.y + mv('eyeY'), e = Math.hypot(ex / K.eyeXCap, ey / K.eyeYCap);
      const k = e > K.eyeKnee ? knee(e, K.eyeKnee, 1) / e : 1;
      gx = ex * k; gy = ey * k;
      // a big, quick shift of the gaze comes with a blink
      const s = a.slow;
      if (Math.hypot(gx - s.x, gy - s.y) > 0.5) {
        if (this.blinkT < 0 && t - this.blinkAt > 1.2) this.nextBlink = Math.min(this.nextBlink, t);
        s.x = gx; s.y = gy;
      }
      s.x += (gx - s.x) * Math.min(1, dt / 0.35); s.y += (gy - s.y) * Math.min(1, dt / 0.35);
      // a small lift of the chin as it notices the pointer, a small nod as it looks back
      const nod = this.moves > 0 ? 3 * env(t - a.notice, 0.12, 0.15, 0.5) - 2.5 * env(t - a.back, 0.15, 0.1, 0.45) : 0;
      target = {
        angleX: knee(a.x * K.yaw * lk + fbm(t * 0.17, sd) * 4 * wd + this.gaze.x * 2 + mv('angleX'), K.yawKnee, K.yawCap),
        angleY: knee(a.y * K.pitch * lk + fbm(t * 0.13, sd + 1) * 3 * wd + this.gaze.y * 2 + nod + mv('angleY'), K.pitchKnee, K.pitchCap),
        angleZ: knee(a.x * K.roll * lk + a.side * 3 * a.soft + fbm(t * 0.11, sd + 2) * 5 * wd + mv('angleZ'), K.rollKnee, K.rollCap),
        bodyX: a.x * K.bodyTurn * lk + fbm(t * 0.09, sd + 3) * 3 * wd + mv('bodyX'),
      };
    } else {
      if (t > this.nextSaccade) {
        this.gaze = { x: L.x + (Math.random() - 0.5) * 0.25, y: L.y * 0.8 + (Math.random() - 0.5) * 0.2 };
        this.nextSaccade = t + 0.6 + Math.random() * 1.6;
      }
      gx = clamp(this.gaze.x * 1.2 + mv('eyeX'), -1, 1); gy = clamp(this.gaze.y + mv('eyeY'), -1, 1);
      target = {
        angleX: L.x * 20 * lk + fbm(t * 0.17, sd) * 7 * wd + this.gaze.x * 5 + mv('angleX'),
        angleY: L.y * 13 * lk + fbm(t * 0.13, sd + 1) * 4 * wd + this.gaze.y * 3 + mv('angleY'),
        angleZ: -L.x * 4 * lk + fbm(t * 0.11, sd + 2) * 6 * wd + mv('angleZ'),
        bodyX: L.x * 4 * lk + fbm(t * 0.09, sd + 3) * 3 * wd + mv('bodyX'),
      };
    }
    P.eyeX += (gx - P.eyeX) * Math.min(1, dt * 18);
    P.eyeY += (gy - P.eyeY) * Math.min(1, dt * 18);

    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const aim = (this.aim ??= { ...target });
    for (const k of Object.keys(SPRING)) {
      const [K, z] = SPRING[k], c = 2 * Math.sqrt(K) * z, s = this.s[k];
      for (let i = 0; i < n; i++) {
        aim[k] += (target[k] - aim[k]) * Math.min(1, dt / n / 0.12);
        s.v += (K * (aim[k] - s.x) - c * s.v) * (dt / n);
        s.x += s.v * (dt / n);
      }
      P[k] = s.x;
    }
    P.breath = clamp(mv('breath', this.breathe(dt)), 0, 1);
    // brows: up when looking up, a little down with each blink, plus the move's and (attend) the pointer's
    const bt = (A ? this.attendBrow(t) : L.y > 0.4 ? 0.5 : 0) - (1 - open) * 0.15 + mv('brow');
    P.browY += (bt - P.browY) * Math.min(1, dt * 10);
    P.mouthForm = A && t >= this.att.smile && t < this.att.smile + 1.6 ? 1 : 0;
  }

  // 'attend': this frame's pointer (onto the stage, moving, resting, gone) and where the attention goes
  attend(t, dt) {
    const a = this.att, q = this.pointer;
    if (q.on && !a.on) { a.notice = t; a.moved = t; a.px = q.x; a.py = q.y; a.side = Math.random() < 0.5 ? -1 : 1; }
    if (q.on) {
      const step = Math.hypot(q.x - a.px, q.y - a.py);
      a.speed += (step / Math.max(dt, 1e-3) - a.speed) * Math.min(1, dt / 0.15);
      if (step > 0.003) a.moved = t;
      a.px = q.x; a.py = q.y;
    } else a.speed *= Math.max(0, 1 - dt / 0.15);
    a.on = q.on;
    // it holds the attention while it moves, for `hold` seconds after, and while it is on the face
    const onFace = q.on && q.d < 1;
    const engaged = q.on && (onFace || t - a.moved < ATTEND.hold);
    if (engaged !== a.engaged) {
      if (!engaged && t - a.since > 0.8) {
        a.back = t;
        this.nextMove = Math.max(this.nextMove, t + 6); // stays with the viewer a while before an idle move looks away
      }
      a.since = t; a.engaged = engaged;
    }
    // resting on the face 1.2 s: a smile the first time, then now and then, at most every 25 s
    const sm = this.style.smile ?? 0;
    if (onFace && t - a.moved > 1.2 && sm > 0 && this.faceFree && !this.busy && t - a.smiled > 25 && t > a.smile + 1.6) {
      if (a.smiled < 0 || Math.random() < sm) a.smile = t;
      a.smiled = t;
    }
    const smiling = t >= a.smile && t < a.smile + 1.6;
    const soft = smiling ? 0 : Math.max(onFace && t - a.moved > 0.5 ? 1 : 0, env(t - a.back, 0.2, 0.6, 0.6));
    a.soft += (soft - a.soft) * Math.min(1, dt / 0.25);
    a.x = engaged ? q.x : 0; a.y = engaged ? q.y : 0;
  }

  // 'attend': the brows' lift (before the blink's dip and the idle move's)
  attendBrow(t) {
    const a = this.att, q = this.pointer;
    const near = q.on && t - a.moved < 0.3 ? 1 - smoothstep(1, 2.2, q.d) : 0;
    return Math.min(0.7, 0.4 * smoothstep(0.35, 0.9, a.y) + 0.3 * smoothstep(1.5, 5, a.speed) + 0.15 * near
      + 0.45 * env(t - a.notice, 0.08, 0.25, 0.35) + 0.2 * env(t - a.back, 0.15, 0.3, 0.5) + 0.12 * a.soft);
  }
}
