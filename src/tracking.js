// Webcam face tracking -> rig parameters, with MediaPipe Face Landmarker running locally (vendor/mediapipe).
//
// Adapted from LivLiv Player (src/runtime/tracking.ts and src/runtime/filters.ts, https://github.com/livliv-dev/player),
// Copyright 2026 LivLiv, Apache License 2.0 (see THIRD_PARTY_NOTICES.md). Changes: ported to JavaScript; the model
// files load from Doll Studio's own copy (no download progress, recorded traces or light check); parameters renamed to
// Doll Studio's (eyeBallX/Y -> eyeX/Y, browLY/RY -> browY, smile -> mouthForm).

import { clamp } from './rig.js';
import { tr } from './i18n.js';

const MP = new URL('../vendor/mediapipe/', import.meta.url);

// One Euro filter (Casiez, Roussel, Vogel, CHI 2012): smooths hard while the signal holds still and less as it moves
export class OneEuro {
  constructor(minCutoff, beta) { this.minCutoff = minCutoff; this.beta = beta; this.x = null; this.dx = 0; }
  reset() { this.x = null; this.dx = 0; }
  filter(v, dt) {
    if (this.x === null || !(dt > 0)) { this.x = v; return v; }
    const alpha = cutoff => { const r = 2 * Math.PI * cutoff * dt; return r / (r + 1); };
    this.dx += ((v - this.x) / dt - this.dx) * alpha(1);
    this.x += (v - this.x) * alpha(this.minCutoff + this.beta * Math.abs(this.dx));
    return this.x;
  }
}

let shared = null;
// The face model, loaded once per page and kept for every later camera start.
export function loadFaceModel() {
  shared ??= (async () => {
    const vision = await import(new URL('vision_bundle.mjs', MP).href);
    if (!(await vision.FilesetResolver.isSimdSupported())) throw new Error(tr('This browser lacks WebAssembly SIMD, so face tracking cannot run', '这个浏览器不支持 WebAssembly SIMD，无法运行面部捕捉'));
    const wasm = { wasmLoaderPath: new URL('wasm/vision_wasm_internal.js', MP).href, wasmBinaryPath: new URL('wasm/vision_wasm_internal.wasm', MP).href };
    const model = new Uint8Array(await (await fetch(new URL('face_landmarker.task', MP))).arrayBuffer());
    const options = delegate => ({
      baseOptions: { modelAssetBuffer: model, delegate },
      runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
    });
    try {
      return await vision.FaceLandmarker.createFromOptions(wasm, options('GPU'));
    } catch {
      return await vision.FaceLandmarker.createFromOptions(wasm, options('CPU'));
    }
  })();
  shared.catch(() => { shared = null; }); // a failed load is tried again next time
  return shared;
}

// a face unseen this long (s) is lost: the character goes back to its idle motion
export const LOST_AFTER = 0.4;

const BS = ['eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'eyeLookOutLeft', 'eyeLookInRight', 'eyeLookInLeft', 'eyeLookOutRight',
  'eyeLookUpLeft', 'eyeLookUpRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'browInnerUp', 'browOuterUpLeft',
  'browOuterUpRight', 'browDownLeft', 'browDownRight', 'mouthSmileLeft', 'mouthSmileRight'];
// landmarks: forehead top, upper and lower inner lip, chin (the lip gap over the face height)
const LM = [10, 13, 14, 152];

const deg = r => (r * 180) / Math.PI;
const sdev = xs => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const CALIB_KEY = 'doll_face_calibration';

export class FaceTracker {
  constructor() {
    this.video = document.createElement('video');
    this.target = {};
    this.mouthGain = 1;
    this.exprGain = 1;
    // like a mirror: turn to your left and the character turns toward the screen's left
    this.mirror = true;
    // the user's natural pose is 'front': its angles are subtracted, its blink scores count as 'eyes open'
    this.zero = { x: 0, y: 0, z: 0, bl: 0, br: 0 };
    this.raw = { x: 0, y: 0, z: 0 };
    this.calibrated = false;
    // the eye turned away from the camera reads half closed: link the eyes once the head turns past ~12 degrees
    this.blinkSync = 'turn';
    // at most this share of the main thread goes to detection ('auto'), so an always-on pet stays light
    this.maxFps = 'auto';
    this.ok = false;
    this.last = -1;
    this.lostFor = Infinity;
    this.recent = [];
    this.seenAt = -1;
    this.detectMs = 0;
    this.detectAt = 0;
    this.f = { x: new OneEuro(0.5, 0.05), y: new OneEuro(0.5, 0.05), z: new OneEuro(0.5, 0.05),
      gx: new OneEuro(1.5, 0.5), gy: new OneEuro(1.5, 0.5), brow: new OneEuro(1, 0.5) };
  }

  // the current pose becomes 'front' (the last few frames, so one noisy frame doesn't decide it)
  calibrate() {
    const r = this.recent.slice(-10);
    if (!r.length) return false;
    this.setZero(r);
    this.save();
    return true;
  }

  async start() {
    this.restore();
    // the camera is asked for at once, so it warms up (and the user answers its prompt) while the model loads
    const camera = navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
    let stream;
    try {
      [this.lm, stream] = await Promise.all([loadFaceModel(), camera]);
    } catch (e) {
      camera.then(s => s.getTracks().forEach(t => t.stop()), () => {});
      throw e;
    }
    if (this.stopped) { stream.getTracks().forEach(t => t.stop()); return; }
    this.stream = stream;
    this.video.srcObject = stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    this.ok = true;
  }

  // the camera goes off; the face model stays loaded for next time
  stop() {
    this.stopped = true;
    this.stream?.getTracks().forEach(t => t.stop());
    this.ok = false;
  }

  // once per frame; true while a face is seen
  poll() {
    const now = performance.now();
    if (this.lm && this.video.readyState >= 2 && this.video.currentTime !== this.last && now >= this.detectAt) {
      this.last = this.video.currentTime;
      const r = this.lm.detectForVideo(this.video, now);
      const took = Math.min(200, performance.now() - now);
      this.detectMs = this.detectMs ? this.detectMs + (took - this.detectMs) * 0.15 : took / 8;
      this.detectAt = now + (this.maxFps === 'auto' ? Math.min(200, 2 * this.detectMs) : this.maxFps ? 1000 / this.maxFps : 0);
      this.read(r, now);
    }
    this.lostFor = this.seenAt < 0 ? Infinity : (now - this.seenAt) / 1000;
    return this.lostFor < LOST_AFTER;
  }

  read(r, now) {
    if (!r.faceLandmarks?.length) return;
    const scores = new Map((r.faceBlendshapes?.[0]?.categories || []).map(c => [c.categoryName, c.score]));
    const g = n => scores.get(n) ?? 0;
    const L = r.faceLandmarks[0], m = r.facialTransformationMatrixes?.[0]?.data;
    // back after a lost stretch: the filters start from where the face is now
    const dt = this.seenAt < 0 ? 0 : (now - this.seenAt) / 1000;
    if (!dt || dt > LOST_AFTER) for (const k of Object.values(this.f)) k.reset();
    this.seenAt = now;
    if (m) {
      // column-major 4x4. MediaPipe's space is Y up with the face looking down +Z at the camera, so pitch > 0 is the
      // chin going down: negate it (+angleY is up). Roll flips for the mirror view; yaw comes out the other way round
      // from the rig's (+angleX turns the face toward the screen's right), so it is negated in the mirror view instead
      const r00 = m[0], r10 = m[1], r20 = m[2], r21 = m[6], r22 = m[10];
      const yaw = Math.atan2(-r20, Math.hypot(r21, r22)), pitch = Math.atan2(r21, r22), roll = Math.atan2(r10, r00);
      const s = this.mirror ? -1 : 1;
      this.raw = { x: -s * deg(yaw) * 1.3, y: -deg(pitch) * 1.3 - 4, z: s * deg(roll) };
      this.recent.push({ ...this.raw, bl: g('eyeBlinkLeft'), br: g('eyeBlinkRight') });
      if (this.recent.length > 30) this.recent.shift();
      // calibrates itself on the first second the head holds still, when none is remembered
      if (!this.calibrated && this.recent.length >= 20) {
        const rr = this.recent.slice(-20);
        if (sdev(rr.map(p => p.x)) < 1.5 && sdev(rr.map(p => p.y)) < 1.5) { this.setZero(rr); this.save(); }
      }
      const x = this.f.x.filter(this.raw.x, dt) - this.zero.x;
      this.target.angleX = clamp(x, -30, 30);
      this.target.angleY = clamp(this.f.y.filter(this.raw.y, dt) - this.zero.y, -30, 30);
      this.target.angleZ = clamp(this.f.z.filter(this.raw.z, dt) - this.zero.z, -30, 30);
      this.target.bodyX = clamp(x * 0.2, -10, 10);
    }
    if (scores.size) {
      // eyes fully open up to a little above this user's resting score, fully shut from about 0.65 (a webcam blink
      // peaks at 0.5-0.7 for a frame or two); mirrored, the user's left eye drives the screen-right eye
      const eye = (blink, rest) => {
        const open = clamp(rest + 0.06, 0.15, 0.5), shut = Math.min(0.95, Math.max(0.65, open + 0.4));
        return clamp(1 - (blink - open) / (shut - open), 0, 1);
      };
      const uL = eye(g('eyeBlinkLeft'), this.zero.bl), uR = eye(g('eyeBlinkRight'), this.zero.br);
      let l = this.mirror ? uR : uL, rt = this.mirror ? uL : uR;
      const turned = smooth(9, 15, Math.abs(this.raw.x - this.zero.x));
      const k = this.blinkSync === 'always' ? 1 : this.blinkSync === 'turn' ? turned : 0;
      if (k > 0) { // turned away, the more open eye is the one the camera sees well
        const avg = (l + rt) / 2, both = avg + (Math.max(l, rt) - avg) * (this.blinkSync === 'always' ? turned : 1);
        l += (both - l) * k; rt += (both - rt) * k;
      }
      this.target.eyeLOpen = l; this.target.eyeROpen = rt;
      // mouth: the jaw, or the lips' own gap when they part without much jaw (quick syllables, "e" / "i")
      const P = LM.map(i => L[i]);
      const d = (i, j) => (P[i] && P[j] ? Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y) : 0);
      const lips = clamp((d(1, 2) / Math.max(1e-3, d(0, 3)) - 0.015) * 7, 0, 1);
      this.target.mouthOpen = clamp(Math.max((g('jawOpen') - 0.04) * 2.2, lips) * this.mouthGain, 0, 1);
      const lookLeft = (g('eyeLookOutLeft') + g('eyeLookInRight')) / 2;
      const lookRight = (g('eyeLookInLeft') + g('eyeLookOutRight')) / 2;
      const up = (g('eyeLookUpLeft') + g('eyeLookUpRight')) / 2, down = (g('eyeLookDownLeft') + g('eyeLookDownRight')) / 2;
      this.target.eyeX = clamp(this.f.gx.filter((lookRight - lookLeft) * 2.2 * (this.mirror ? 1 : -1), dt), -1, 1);
      this.target.eyeY = clamp(this.f.gy.filter((up - down) * 2.2, dt), -1, 1);
      const browUp = g('browInnerUp') * 0.6 + (g('browOuterUpLeft') + g('browOuterUpRight')) * 0.2;
      const browDown = (g('browDownLeft') + g('browDownRight')) / 2;
      this.target.browY = clamp(this.f.brow.filter((browUp - browDown * 0.8) * 2.4, dt), -1, 1);
      this.target.mouthForm = clamp(((g('mouthSmileLeft') + g('mouthSmileRight')) / 2 - 0.35 / this.exprGain) * 2.5 * this.exprGain, 0, 1);
    }
  }

  setZero(r) {
    const med = k => median(r.map(p => p[k]));
    this.zero = { x: med('x'), y: med('y'), z: med('z'), bl: clamp(med('bl'), 0, 0.5), br: clamp(med('br'), 0, 0.5) };
    this.calibrated = true;
  }

  save() {
    const s = this.mirror ? 1 : -1, z = this.zero;
    try { localStorage.setItem(CALIB_KEY, JSON.stringify({ ...z, x: -s * z.x, z: s * z.z })); } catch { /* storage unavailable */ }
  }

  restore() {
    try {
      const c = JSON.parse(localStorage.getItem(CALIB_KEY) || 'null');
      if (!c || ![c.x, c.y, c.z, c.bl, c.br].every(Number.isFinite)) return;
      const s = this.mirror ? 1 : -1;
      this.zero = { x: -s * c.x, y: c.y, z: s * c.z, bl: clamp(c.bl, 0, 0.5), br: clamp(c.br, 0, 0.5) };
      this.calibrated = true;
    } catch { /* storage unavailable, or something else stored there */ }
  }

  // eases P toward what the face shows: closing eyes follow at once (a blink seen for a frame or two would be over
  // before an eased value got there), eyes and mouth fast, the rest a little slower
  apply(P, dt) {
    const a = Math.min(1, dt * 30), fast = Math.min(1, dt * 25);
    for (const [k, v] of Object.entries(this.target)) {
      const closing = (k === 'eyeLOpen' || k === 'eyeROpen') && v < P[k];
      const rate = closing ? 1 : k.startsWith('eye') || k === 'mouthOpen' ? fast : k === 'mouthForm' ? Math.min(1, dt * 8.4) : a;
      P[k] += (v - P[k]) * rate;
    }
  }
}
