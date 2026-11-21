// @ts-check
/**
 * Audio. Everything is synthesized with Web Audio (no downloads), and an
 * optional sample manifest lets recorded laughter / ambience replace the
 * synthesis later without touching the rest of the code.
 *
 * Autoplay: no AudioContext exists until `unlock()` is called from a user
 * gesture. Mute state is remembered per browser.
 *
 * Every sound of a run goes through one `run` bus. `cut()` disconnects it,
 * which silences everything, including already-scheduled syllables, in
 * the same instant. That is the freeze.
 */
import { mulberry32 } from './util.js?v=202611211020';

/**
 * Drop real recordings in here to replace synthesis, e.g.
 *   ambience: 'audio/room.mp3',
 *   laughs: { 1: ['audio/giggle-1.mp3'], 4: ['audio/strained-1.mp3'] }
 * Missing / failed files fall back to synthesis.
 * @type {{ambience: string|null, laughs: Record<number, string[]>}}
 */
export const SAMPLE_MANIFEST = { ambience: null, laughs: {} };

const MUTE_KEY = 'tm-ticklish-muted';

/** [frequency, Q, gain] for three formants. */
const FORMANTS = {
  a: [[800, 7, 1], [1250, 9, 0.55], [2650, 11, 0.22]],
  e: [[480, 7, 1], [1900, 11, 0.5], [2700, 11, 0.22]],
  i: [[320, 7, 0.9], [2450, 13, 0.5], [3250, 13, 0.25]],
};

/** Ambient target levels per stage (index 6 = after STOP). */
const AMBIENT = [
  { room: 0.05, drone: 0.0, dis: 0, whine: 0, bend: 1 },
  { room: 0.05, drone: 0.012, dis: 0, whine: 0, bend: 1 },
  { room: 0.05, drone: 0.03, dis: 0, whine: 0.0012, bend: 1 },
  { room: 0.045, drone: 0.055, dis: 0.008, whine: 0.003, bend: 0.985 },
  { room: 0.04, drone: 0.075, dis: 0.018, whine: 0.0055, bend: 0.97 },
  { room: 0.035, drone: 0.09, dis: 0.026, whine: 0.008, bend: 0.94 },
  { room: 0.03, drone: 0.11, dis: 0.034, whine: 0.011, bend: 0.9 },
];

function loadMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export class AudioEngine {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;
    this.muted = loadMuted();
    this.stage = 0;
    /** @type {any} */
    this.run = null;
    /** @type {Record<string, AudioBuffer[]>} */
    this.samples = {};
    this.rng = mulberry32(7);
    this.nextTick = 0;
    this.nextBeat = 0;
    this.lastCreak = 0;
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Call from inside a pointer / key handler. */
  unlock() {
    this.iosUnmute();
    if (!this.ctx) {
      const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.build();
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  /**
   * iPhones silence Web Audio when the ring/silent switch is on silent.
   * Asking for "playback" audio (Safari 16.4+), and playing a silent
   * looping <audio> element (older iOS), moves the page into the same
   * category as a music player, which plays regardless of the switch.
   */
  iosUnmute() {
    try {
      const session = /** @type {any} */ (navigator).audioSession;
      if (session && session.type !== 'playback') session.type = 'playback';
    } catch {
      /* not supported */
    }
    if (this.silentEl) {
      if (this.silentEl.paused) this.silentEl.play().catch(() => {});
      return;
    }
    try {
      // 0.5 s of 8-bit silence, built in memory
      const rate = 8000;
      const n = rate / 2;
      const buf = new ArrayBuffer(44 + n);
      const v = new DataView(buf);
      const str = (o, t) => [...t].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
      str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
      str(36, 'data'); v.setUint32(40, n, true);
      for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
      const el = document.createElement('audio');
      el.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
      el.loop = true;
      el.setAttribute('playsinline', '');
      el.setAttribute('aria-hidden', 'true');
      this.silentEl = el;
      el.play().catch(() => {});
    } catch {
      /* fine: desktop browsers don't need it */
    }
  }

  build() {
    const c = /** @type {AudioContext} */ (this.ctx);
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 8;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(c.destination);

    // white noise
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = this.rng() * 2 - 1;
    // brown noise for the room
    this.brown = c.createBuffer(1, len, c.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (this.rng() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
    // small room impulse response
    const irLen = Math.floor(c.sampleRate * 1.7);
    this.ir = c.createBuffer(2, irLen, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = this.ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) data[i] = (this.rng() * 2 - 1) * Math.pow(1 - i / irLen, 3.2);
    }
    // a soft glottal source
    const H = 40;
    const real = new Float32Array(H);
    const imag = new Float32Array(H);
    for (let n = 1; n < H; n++) imag[n] = 1 / Math.pow(n, 1.25);
    this.glottal = c.createPeriodicWave(real, imag);

    this.newRun();
    this.loadSamples();
  }

  async loadSamples() {
    const c = this.ctx;
    if (!c) return;
    /** @param {string} url */
    const get = async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await c.decodeAudioData(await res.arrayBuffer());
      } catch {
        return null;
      }
    };
    if (SAMPLE_MANIFEST.ambience) {
      const buf = await get(SAMPLE_MANIFEST.ambience);
      if (buf) this.samples.ambience = [buf];
    }
    for (const [stage, urls] of Object.entries(SAMPLE_MANIFEST.laughs)) {
      const bufs = (await Promise.all(urls.map(get))).filter(Boolean);
      if (bufs.length) this.samples['laugh' + stage] = /** @type {AudioBuffer[]} */ (bufs);
    }
  }

  /** A fresh bus for one play-through, with its own reverb and ambience. */
  newRun() {
    const c = this.ctx;
    if (!c) return;
    const out = c.createGain();
    out.connect(/** @type {GainNode} */ (this.master));
    const dry = c.createGain();
    dry.connect(out);
    const verb = c.createConvolver();
    verb.buffer = /** @type {AudioBuffer} */ (this.ir);
    const wet = c.createGain();
    wet.gain.value = 0.22;
    verb.connect(wet).connect(out);
    /** @type {AudioScheduledSourceNode[]} */
    const sources = [];
    this.run = { out, dry, verb, sources, amb: this.startAmbience(c, dry, sources) };
    this.setStage(this.stage, true);
  }

  /**
   * @param {AudioContext} c @param {AudioNode} dest @param {AudioScheduledSourceNode[]} sources
   */
  startAmbience(c, dest, sources) {
    const now = c.currentTime;
    // room tone
    const room = c.createBufferSource();
    room.buffer = this.samples.ambience ? this.samples.ambience[0] : /** @type {AudioBuffer} */ (this.brown);
    room.loop = true;
    const roomLp = c.createBiquadFilter();
    roomLp.type = 'lowpass';
    roomLp.frequency.value = 380;
    const roomG = c.createGain();
    roomG.gain.value = 0;
    room.connect(roomLp).connect(roomG).connect(dest);
    room.start(now);
    // drone: two detuned sines and an octave
    const droneG = c.createGain();
    droneG.gain.value = 0;
    const droneLp = c.createBiquadFilter();
    droneLp.type = 'lowpass';
    droneLp.frequency.value = 240;
    droneLp.connect(droneG).connect(dest);
    /** @type {OscillatorNode[]} */
    const drones = [];
    for (const [f, type, g] of /** @type {[number, OscillatorType, number][]} */ ([[49, 'sine', 1], [49.3, 'sine', 0.8], [98, 'triangle', 0.35]])) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = c.createGain();
      og.gain.value = g;
      o.connect(og).connect(droneLp);
      o.start(now);
      drones.push(o);
      sources.push(o);
    }
    // a minor second rubbing against it
    const dis = c.createOscillator();
    dis.frequency.value = 103.8;
    const disG = c.createGain();
    disG.gain.value = 0;
    dis.connect(disG).connect(dest);
    dis.start(now);
    // a high whine, like a television left on in another room
    const whine = c.createOscillator();
    whine.frequency.value = 5150;
    const wobble = c.createOscillator();
    wobble.frequency.value = 0.23;
    const wobbleG = c.createGain();
    wobbleG.gain.value = 18;
    wobble.connect(wobbleG).connect(whine.frequency);
    const whineG = c.createGain();
    whineG.gain.value = 0;
    whine.connect(whineG).connect(dest);
    whine.start(now);
    wobble.start(now);
    sources.push(room, dis, whine, wobble);
    return { roomG, droneG, disG, whineG, drones };
  }

  /** @param {number} stage 0..6 @param {boolean} [instant] */
  setStage(stage, instant = false) {
    this.stage = stage;
    const c = this.ctx;
    if (!c || !this.run) return;
    const A = AMBIENT[Math.min(stage, 6)];
    const amb = this.run.amb;
    const now = c.currentTime;
    const tc = instant ? 0.01 : 1.4;
    amb.roomG.gain.setTargetAtTime(A.room, now, tc);
    amb.droneG.gain.setTargetAtTime(A.drone, now, tc);
    amb.disG.gain.setTargetAtTime(A.dis, now, tc);
    amb.whineG.gain.setTargetAtTime(A.whine, now, tc);
    const base = [49, 49.3, 98];
    amb.drones.forEach((o, i) => o.frequency.setTargetAtTime(base[i] * A.bend, now, 4));
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* private mode: fine */
    }
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }

  /** @param {number} delay seconds from now */
  at(delay) {
    const c = /** @type {AudioContext} */ (this.ctx);
    return c.currentTime + Math.max(0, delay);
  }

  /** Clock ticks early on; a heartbeat later. Call every frame. @param {number} stage */
  update(stage) {
    const c = this.ctx;
    if (!c || !this.run || c.state !== 'running') return;
    const now = c.currentTime;
    if (stage <= 2) {
      if (this.nextTick < now) this.nextTick = now + 0.05;
      while (this.nextTick < now + 0.2) {
        this.tick(this.nextTick);
        this.nextTick += 1;
      }
    }
    if (stage >= 4) {
      const interval = stage >= 6 ? 0.42 : stage === 5 ? 0.5 : 0.62;
      if (this.nextBeat < now) this.nextBeat = now + 0.05;
      while (this.nextBeat < now + 0.2) {
        this.thump(this.nextBeat, 1);
        this.thump(this.nextBeat + 0.16, 0.6);
        this.nextBeat += interval;
      }
    }
  }

  /** @param {number} when */
  tick(when) {
    const c = /** @type {AudioContext} */ (this.ctx);
    const n = c.createBufferSource();
    n.buffer = /** @type {AudioBuffer} */ (this.noise);
    const hp = c.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 3200;
    hp.Q.value = 3;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.05, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
    n.connect(hp).connect(g).connect(this.run.dry);
    n.start(when, this.rng());
    n.stop(when + 0.05);
  }

  /** @param {number} when @param {number} amp */
  thump(when, amp) {
    const c = /** @type {AudioContext} */ (this.ctx);
    const o = c.createOscillator();
    o.frequency.setValueAtTime(70, when);
    o.frequency.exponentialRampToValueAtTime(38, when + 0.14);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.22 * amp, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
    o.connect(g).connect(this.run.dry);
    o.start(when);
    o.stop(when + 0.2);
  }

  /** Bed springs. @param {number} stage */
  creak(stage) {
    const c = this.ctx;
    if (!c || !this.run || c.state !== 'running') return;
    if (c.currentTime - this.lastCreak < 0.8) return;
    this.lastCreak = c.currentTime;
    const when = c.currentTime + 0.01;
    const dur = 0.25 + this.rng() * 0.25;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let next = 0;
    for (let i = 0; i < len; i++) {
      if (i >= next) {
        d[i] = 1;
        next = i + Math.floor(c.sampleRate * (0.006 + this.rng() * 0.02 * (1 - i / len)));
      }
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 260 + this.rng() * 160;
    bp.Q.value = 9;
    const g = c.createGain();
    g.gain.value = 0.18 + stage * 0.04;
    src.connect(bp).connect(g).connect(this.run.dry);
    g.connect(this.run.verb);
    src.start(when);
  }

  /**
   * Play one laugh syllable.
   * @param {import('./laugh.js').Syllable} s
   * @param {number} delay seconds from now
   */
  syllable(s, delay) {
    const c = this.ctx;
    // a context that is still resuming will play these as soon as it starts
    if (!c || !this.run || c.state === 'closed') return;
    const when = this.at(delay);
    const end = when + s.dur;
    const run = this.run;

    // recorded laughter replaces synthesis at bout level, if provided
    const bank = this.samples['laugh' + Math.min(s.stage, 5)];
    if (bank && s.kind === 'in') {
      const src = c.createBufferSource();
      src.buffer = bank[Math.floor(this.rng() * bank.length)];
      src.connect(run.dry);
      src.start(when);
      return;
    }
    if (bank) return;

    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, when);
    out.gain.exponentialRampToValueAtTime(1, when + 0.02);
    out.gain.setValueAtTime(1, when + s.dur * 0.45);
    out.gain.exponentialRampToValueAtTime(0.0001, end);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    out.connect(lp);
    lp.connect(run.dry);
    lp.connect(run.verb);

    if (s.kind === 'in') {
      // breath in; from stage 3, a voiced, whooping gasp
      const n = c.createBufferSource();
      n.buffer = /** @type {AudioBuffer} */ (this.noise);
      n.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(900, when);
      bp.frequency.linearRampToValueAtTime(2300, end);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(s.amp * 2.2, when + s.dur * 0.7);
      g.gain.linearRampToValueAtTime(0.0001, end);
      n.connect(bp).connect(g).connect(out);
      n.start(when, this.rng());
      n.stop(end + 0.05);
      if (s.stage >= 3) {
        const o = c.createOscillator();
        o.setPeriodicWave(/** @type {PeriodicWave} */ (this.glottal));
        o.frequency.setValueAtTime(s.pitch, when);
        o.frequency.linearRampToValueAtTime(s.pitch * 1.25, end);
        const vg = c.createGain();
        vg.gain.setValueAtTime(0.0001, when);
        vg.gain.linearRampToValueAtTime(s.amp * 0.5, when + s.dur * 0.8);
        vg.gain.linearRampToValueAtTime(0.0001, end);
        this.formants(c, o, vg, 'i');
        vg.connect(out);
        o.start(when);
        o.stop(end + 0.05);
      }
      return;
    }

    if (s.kind !== 'w') {
      const o = c.createOscillator();
      o.setPeriodicWave(/** @type {PeriodicWave} */ (this.glottal));
      const sob = s.kind === 's';
      o.frequency.setValueAtTime(s.pitch * (sob ? 1.15 : 1.06), when);
      o.frequency.exponentialRampToValueAtTime(s.pitch * (sob ? 0.62 : 0.88), end);
      if (s.shake) {
        const lfo = c.createOscillator();
        lfo.frequency.value = 9 + this.rng() * 6;
        const lg = c.createGain();
        lg.gain.value = s.pitch * 0.035;
        lfo.connect(lg).connect(o.frequency);
        lfo.start(when);
        lfo.stop(end + 0.05);
      }
      const vg = c.createGain();
      vg.gain.setValueAtTime(0.0001, when);
      vg.gain.linearRampToValueAtTime(s.amp * 1.05, when + 0.035);
      this.formants(c, o, vg, s.vowel);
      vg.connect(out);
      o.start(when);
      o.stop(end + 0.05);
    }

    // aspiration: the "h" of each "ha", and breathiness throughout
    const n = c.createBufferSource();
    n.buffer = /** @type {AudioBuffer} */ (this.noise);
    n.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = s.kind === 'w' ? 1300 : 1700;
    bp.Q.value = s.kind === 'w' ? 2 : 0.8;
    const ng = c.createGain();
    const h = s.amp * (s.kind === 'w' ? 1.6 : 0.9);
    ng.gain.setValueAtTime(0.0001, when);
    ng.gain.linearRampToValueAtTime(h, when + 0.012);
    ng.gain.exponentialRampToValueAtTime(Math.max(0.0002, h * s.breath * 0.55), when + 0.06);
    ng.gain.exponentialRampToValueAtTime(0.0001, end);
    n.connect(bp).connect(ng).connect(out);
    n.start(when, this.rng());
    n.stop(end + 0.05);
  }

  /**
   * @param {AudioContext} c @param {AudioNode} src @param {AudioNode} dest
   * @param {'a'|'e'|'i'} vowel
   */
  formants(c, src, dest, vowel) {
    for (const [f, q, g] of FORMANTS[vowel]) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const gg = c.createGain();
      gg.gain.value = g * 3;
      src.connect(bp).connect(gg).connect(dest);
    }
  }

  /** The freeze: silence, now. */
  cut() {
    const c = this.ctx;
    if (!c || !this.run) return;
    const run = this.run;
    this.run = null;
    run.out.gain.cancelScheduledValues(c.currentTime);
    run.out.gain.setValueAtTime(run.out.gain.value, c.currentTime);
    run.out.gain.linearRampToValueAtTime(0, c.currentTime + 0.004);
    setTimeout(() => {
      try {
        run.out.disconnect();
      } catch {
        /* already gone */
      }
      for (const s of run.sources) {
        try {
          s.stop();
        } catch {
          /* not started */
        }
      }
    }, 30);
  }

  /**
   * Leaving. The laughing carries on in another room: everything after this
   * goes through a "wall" (low-pass, more reverb, quieter), with only the
   * room tone on this side of it.
   */
  muffle() {
    const c = this.ctx;
    if (!c) return;
    if (this.run) this.cut();
    const now = c.currentTime;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.linearRampToValueAtTime(0.75, now + 6); // it was always there; you just notice it
    const wall = c.createBiquadFilter();
    wall.type = 'lowpass';
    wall.frequency.value = 620;
    wall.Q.value = 0.8;
    out.connect(wall).connect(/** @type {GainNode} */ (this.master));
    const dry = c.createGain();
    dry.gain.value = 0.38;
    dry.connect(out);
    const verb = c.createConvolver();
    verb.buffer = /** @type {AudioBuffer} */ (this.ir);
    const wet = c.createGain();
    wet.gain.value = 0.6;
    verb.connect(wet).connect(out);
    /** @type {AudioScheduledSourceNode[]} */
    const sources = [];
    // this side of the wall: just the room
    const room = c.createBufferSource();
    room.buffer = /** @type {AudioBuffer} */ (this.brown);
    room.loop = true;
    const roomLp = c.createBiquadFilter();
    roomLp.type = 'lowpass';
    roomLp.frequency.value = 300;
    const roomG = c.createGain();
    roomG.gain.value = 0.045;
    room.connect(roomLp).connect(roomG).connect(/** @type {GainNode} */ (this.master));
    room.start(now);
    sources.push(room);
    const quiet = c.createGain();
    quiet.gain.value = 0;
    this.run = { out, dry, verb, sources, amb: { roomG, droneG: quiet, disG: quiet, whineG: quiet, drones: [] } };
    this.wallRoom = roomG;
  }

  /** In the dark, very far away, a giggle. */
  distantGiggle() {
    const c = this.ctx;
    if (!c || this.muted || c.state !== 'running') return;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const verb = c.createConvolver();
    verb.buffer = /** @type {AudioBuffer} */ (this.ir);
    const level = c.createGain();
    level.gain.value = 0.5;
    lp.connect(verb).connect(level).connect(/** @type {GainNode} */ (this.master));
    const tmp = { dry: lp, verb: lp };
    const saved = this.run;
    this.run = tmp;
    const base = c.currentTime;
    [0, 0.17].forEach((t, i) => {
      this.syllable({ t: 0, dur: 0.12, pitch: 290 - i * 14, kind: 'v', vowel: 'e', amp: 0.4, breath: 0.3, shake: false, stage: 1 }, base - c.currentTime + t);
    });
    this.run = saved;
    this.giggleOut = level;
  }

  /** Back to the start. */
  reset() {
    if (!this.ctx) return;
    if (this.giggleOut) {
      try {
        this.giggleOut.disconnect();
      } catch {
        /* fine */
      }
      this.giggleOut = null;
    }
    if (this.run) this.cut();
    this.stage = 0;
    this.newRun();
  }
}
