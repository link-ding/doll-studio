// Drives parameters automatically: the idle motion (idle.js), the microphone (voice.js), webcam face tracking
// (tracking.js, loaded only when the camera goes on), and short reactions (a poke, a coding agent finishing).

import { clamp, smoothstep } from './rig.js';
import { LivelyIdle } from './idle.js';
import { VoiceMeter } from './voice.js';

// what face tracking drives; it is blended over the idle while a face is seen
const TRACKED = ['angleX', 'angleY', 'angleZ', 'bodyX', 'eyeLOpen', 'eyeROpen', 'eyeX', 'eyeY', 'browY', 'mouthOpen', 'mouthForm'];

export class Driver {
  constructor() {
    this.t = 0;
    this.idle = new LivelyIdle();
    this.followOn = true;
    this.mic = null;        // VoiceMeter while the microphone is on
    this.voice = null;      // or a 0..1 loudness pushed in from outside
    this.voiceVowel = 0;
    this.mouth = 0;
    this.tracker = null;    // FaceTracker while the camera is on
    this.trackW = 0;        // how much tracking shows, eased 0..1
    this.trackP = null;
    this.reactUntil = 0;
    this.attentionUntil = 0;
  }

  get follow() { return this.followOn; }
  set follow(on) {
    this.followOn = on;
    if (!on) this.idle.pointer = { ...this.idle.pointer, on: false };
  }

  // the pointer round the face: x, y in -1..1 (y up), d its distance from the face in face radii; on = false when it
  // leaves the stage
  pointer(x, y, d = 99, on = true) {
    if (!this.followOn) return;
    this.idle.pointer = { x: clamp(x, -1, 1), y: clamp(y, -1, 1), d, on };
  }

  // A short happy reaction: eyes closed into a smile, head tilt.
  react() { this.reactUntil = this.t + 1.4; }

  // Calls for the user: 'done' smiles, 'attention' looks up wide-eyed and nods.
  alert(kind) {
    if (kind === 'done') { this.react(); return; }
    this.attentionUntil = this.t + 2.4;
  }

  async enableMic() {
    const m = new VoiceMeter();
    await m.start();
    this.mic = m;
  }

  disableMic() {
    this.mic?.stop();
    this.mic = null;
  }

  async enableCamera() {
    const { FaceTracker } = await import('./tracking.js');
    const tr = (this.tracker = new FaceTracker());
    try {
      await tr.start();
    } catch (e) {
      if (this.tracker === tr) this.tracker = null;
      throw e;
    }
  }

  disableCamera() {
    this.tracker?.stop();
    this.tracker = null;
  }

  update(P, dt, auto) {
    this.t += dt;
    const t = this.t;
    if (auto) {
      this.idle.busy = this.mouth > 0.12 || t < this.reactUntil || t < this.attentionUntil;
      this.idle.faceFree = t >= this.reactUntil;
      this.idle.apply(P, t, dt);
    }

    // face tracking fades in over the idle when a face is seen, and back out when it is lost
    const seen = !!this.tracker?.ok && this.tracker.poll();
    this.trackW += ((seen ? 1 : 0) - this.trackW) * Math.min(1, dt / 0.25);
    if (this.tracker?.ok && this.trackW > 0.001) {
      const T = (this.trackP ??= { ...P });
      if (seen) this.tracker.apply(T, dt);
      for (const k of TRACKED) P[k] += (T[k] - P[k]) * this.trackW;
    } else {
      this.trackP = null;
    }

    // the voice drives the mouth (over the camera's); once it stops, the mouth closes instead of staying open
    const level = this.mic ? this.mic.read() : this.voice;
    if (level != null) {
      this.mouth += (level - this.mouth) * (1 - Math.exp(-dt * 20));
      P.mouthOpen = this.mouth;
      P.vowel = (this.mic ? this.mic.vowel : this.voiceVowel) * smoothstep(0.05, 0.25, this.mouth);
    } else if (this.mouth > 0) {
      this.mouth = this.mouth < 0.01 ? 0 : this.mouth * Math.exp(-dt * 12);
      P.mouthOpen = this.mouth;
      P.vowel *= Math.exp(-dt * 12);
    }

    if (t < this.reactUntil) {
      const k = Math.sin(Math.PI * clamp((this.reactUntil - t) / 1.4, 0, 1));
      P.eyeLOpen = P.eyeROpen = Math.min(P.eyeLOpen, 1 - k);
      P.mouthForm = Math.max(P.mouthForm, k);
      P.mouthOpen = Math.max(P.mouthOpen, k * 0.7); // a laugh: the open mouth at its peak
      if (auto) P.angleZ += k * 8; // angleZ is rewritten every auto frame, so this doesn't accumulate
      P.browY = k * 0.6;
    }
    if (auto && t < this.attentionUntil) {
      const k = Math.sin(Math.PI * clamp((this.attentionUntil - t) / 2.4, 0, 1));
      P.eyeLOpen = P.eyeROpen = 1;
      P.browY = Math.max(P.browY, k);
      P.mouthOpen = Math.max(P.mouthOpen, k * 0.45);
      P.angleY += Math.sin(t * 11) * 9 * k;
      P.eyeX *= 1 - k;
      P.eyeY = P.eyeY * (1 - k) + 0.3 * k;
    }
  }
}
