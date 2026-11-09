// Microphone -> mouth: how open (with automatic gain) and which vowel shape (round o / u, wide i / e).
//
// Adapted from LivLiv Player (src/runtime/voice.ts and src/runtime/vowel.ts, https://github.com/livliv-dev/player),
// Copyright 2026 LivLiv, Apache License 2.0 (see THIRD_PARTY_NOTICES.md). Changes: ported to JavaScript; microphone
// input only (no audio files or elements); level and vowel exposed for a host that measures audio itself.
//
//  - the level listens to the speech band only (band-pass around 200-2000 Hz), so breaths, fans and hiss barely move
//    the mouth; the room's noise floor and the speaker's loudness are tracked, so a quiet laptop mic and a loud
//    headset both open the mouth the full range
//  - the vowel comes from where the voice's energy sits in the spectrum:
//      back  = dB(300-900 Hz / 1800-3500 Hz)   high for o / u, low for i / e
//      close = dB(250-650 Hz / 650-1300 Hz)    keeps a (open, not that far back) off "wide"
//    back is measured against the voice's own balance, so a deep voice or a dull mic does not turn everything round

const BACK = [300, 900, 1800, 3500], CLOSE = [250, 650, 650, 1300];
const PRIOR = 15;    // dB: a typical voice's `back` over voiced frames
const ROUND_AT = 10; // dB above the voice's balance: o / u
const WIDE_AT = 3;   // dB below it, with `close` over CLOSE_AT: i / e
const CLOSE_AT = 8;

export class VowelCue {
  constructor() { this.center = PRIOR; this.value = 0; this.seen = 0; }

  // one frame: power is the linear power spectrum (bin k at k * hz), level its loudness 0..1, dt seconds since the
  // last frame. Returns the smoothed cue -1 (round) .. +1 (wide), 0 for a and anything unsure
  push(power, hz, level, dt) {
    const sum = (a, b) => {
      let s = 1e-12;
      for (let k = Math.ceil(a / hz); k * hz < b && k < power.length; k++) s += power[k];
      return s;
    };
    const back = 10 * Math.log10(sum(BACK[0], BACK[1]) / sum(BACK[2], BACK[3]));
    const close = 10 * Math.log10(sum(CLOSE[0], CLOSE[1]) / sum(CLOSE[2], CLOSE[3]));
    let target = 0;
    if (level > 0.15) {
      if (level > 0.3) { // the voice's balance settles within a couple of seconds of speech, then drifts slowly
        this.seen += dt;
        const k = Math.min(1, dt / Math.min(3, 0.3 + this.seen));
        this.center += (Math.min(24, Math.max(8, back)) - this.center) * k;
      }
      const round = (back - this.center) / ROUND_AT;
      const wide = ((this.center - back) / WIDE_AT) * Math.min(1, Math.max(0, (close - CLOSE_AT + 4) / 4));
      target = Math.max(-1, Math.min(1, wide > 0 ? wide : -Math.max(0, round)));
    }
    // ~35 ms smoothing: a vowel is held for 80-250 ms, its edges (glides, consonants) are not
    this.value += (target - this.value) * Math.min(1, dt / 0.035);
    return this.value;
  }
}

export class VoiceMeter {
  constructor() {
    this.level = 0;  // 0..1 mouth openness, smoothed
    this.vowel = 0;  // -1 round .. +1 wide
    this.gain = 1;
    this.buf = new Float32Array(1024);
    this.db = new Float32Array(512);
    this.pw = new Float32Array(512);
    this.cue = new VowelCue();
    this.floor = 0.004; // noise floor (RMS): follows quiet moments quickly, rises slowly
    this.peak = 0.05;   // recent speaking loudness, decays over a few seconds
    this.last = 0;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const ctx = (this.ctx = new AudioContext());
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass'; band.frequency.value = 650; band.Q.value = 0.55;
    this.an = ctx.createAnalyser(); this.an.fftSize = 1024;
    this.spec = ctx.createAnalyser(); this.spec.fftSize = 1024; this.spec.smoothingTimeConstant = 0; // ~21 ms at 48 kHz
    const src = ctx.createMediaStreamSource(this.stream);
    src.connect(band); src.connect(this.spec);
    band.connect(this.an);
  }

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.ctx?.close();
    this.an = this.spec = undefined;
  }

  // call once per frame; returns the level 0..1 and updates `vowel`
  read() {
    if (!this.an) return 0;
    const now = performance.now(), dt = Math.min(0.1, this.last ? (now - this.last) / 1000 : 1 / 60);
    this.last = now;
    this.an.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(s / this.buf.length);
    this.floor = rms < this.floor ? this.floor + (rms - this.floor) * Math.min(1, dt * 4) : this.floor + (rms - this.floor) * dt * 0.05;
    this.floor = Math.max(0.0005, this.floor);
    const gate = this.floor * 2.2;
    this.peak = Math.max(rms, gate * 3, 0.012, this.peak * Math.exp(-dt / 3));
    const x = Math.min(1, Math.max(0, (rms - gate) / (this.peak - gate)));
    const target = Math.min(1, Math.pow(x, 0.8) * 1.1 * this.gain);
    this.level += (target - this.level) * Math.min(1, dt * (target > this.level ? 30 : 14));
    this.spec.getFloatFrequencyData(this.db);
    for (let k = 0; k < this.db.length; k++) this.pw[k] = Math.pow(10, this.db[k] / 10);
    this.vowel = this.cue.push(this.pw, this.ctx.sampleRate / this.spec.fftSize, this.level, dt);
    return this.level;
  }
}
