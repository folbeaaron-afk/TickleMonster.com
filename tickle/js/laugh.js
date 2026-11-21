// @ts-check
/**
 * Laugh driver: a seeded schedule of syllables shared by the audio and the
 * mouth, so the face laughs in time with the sound, and still laughs when
 * the sound is off.
 */
import { mulberry32, clamp } from './util.js?v=202611210902';

/**
 * @typedef {Object} Syllable
 * @property {number} t      start (seconds, performance clock)
 * @property {number} dur
 * @property {number} pitch  Hz
 * @property {'v'|'w'|'s'|'in'} kind  voiced · wheeze (silent laugh) · sob · inhale
 * @property {'a'|'e'|'i'} vowel
 * @property {number} amp
 * @property {number} breath 0..1 breathiness
 * @property {boolean} shake voice tremor
 * @property {number} stage
 */

/** Index = stage (6 = after STOP). */
const LAUGH = [
  null,
  { min: 2, max: 4, syl: 0.11, gap: 0.06, pitch: 300, pv: 0.08, rise: 0.05, amp: 0.6, inhale: 0.26, inAmp: 0.06, pause: 0.6, vowels: ['e', 'e', 'a'], breath: 0.25, crack: 0, wheeze: 0, sob: 0 },
  { min: 4, max: 7, syl: 0.12, gap: 0.045, pitch: 325, pv: 0.1, rise: 0.08, amp: 0.64, inhale: 0.3, inAmp: 0.12, pause: 0.38, vowels: ['a', 'a', 'e'], breath: 0.3, crack: 0, wheeze: 0, sob: 0 },
  { min: 5, max: 9, syl: 0.115, gap: 0.035, pitch: 370, pv: 0.16, rise: 0.15, amp: 0.68, inhale: 0.36, inAmp: 0.2, pause: 0.22, vowels: ['a', 'e', 'i'], breath: 0.42, crack: 0.12, wheeze: 0.06, sob: 0 },
  { min: 6, max: 11, syl: 0.1, gap: 0.025, pitch: 415, pv: 0.22, rise: 0.2, amp: 0.72, inhale: 0.42, inAmp: 0.3, pause: 0.12, vowels: ['a', 'i', 'i', 'e'], breath: 0.52, crack: 0.2, wheeze: 0.2, sob: 0.04 },
  { min: 7, max: 13, syl: 0.1, gap: 0.02, pitch: 435, pv: 0.3, rise: 0.25, amp: 0.75, inhale: 0.5, inAmp: 0.38, pause: 0.06, vowels: ['a', 'i', 'e'], breath: 0.6, crack: 0.28, wheeze: 0.24, sob: 0.18 },
  { min: 9, max: 15, syl: 0.085, gap: 0.015, pitch: 470, pv: 0.34, rise: 0.3, amp: 0.8, inhale: 0.4, inAmp: 0.42, pause: 0.03, vowels: ['i', 'a', 'i'], breath: 0.65, crack: 0.35, wheeze: 0.22, sob: 0.22 },
];

export class LaughDriver {
  /** @param {number} seed */
  constructor(seed) {
    /** @type {(s: Syllable) => void} */
    this.onSyllable = () => {};
    /** @type {(stage: number, start: number, end: number) => void} */
    this.onBout = () => {};
    this.reset(seed);
  }

  /** @param {number} seed */
  reset(seed) {
    this.rng = mulberry32(seed);
    /** @type {Syllable[]} */
    this.queue = [];
    this.cursor = 0;
  }

  /**
   * @param {number} now
   * @param {boolean} active someone is being tickled
   * @param {number} stage 1..6
   */
  update(now, active, stage) {
    if (active && stage > 0) {
      while (this.cursor < now + 0.3) this.bout(Math.max(this.cursor, now), stage);
    }
    // drop finished syllables
    if (this.queue.length && this.queue[0].t + this.queue[0].dur < now - 0.2) {
      this.queue = this.queue.filter((s) => s.t + s.dur >= now - 0.2);
    }
  }

  /** @param {number} start @param {number} stage */
  bout(start, stage) {
    const S = /** @type {NonNullable<typeof LAUGH[number]>} */ (LAUGH[clamp(stage, 1, 6)]);
    const r = this.rng;
    const n = S.min + Math.floor(r() * (S.max - S.min + 1));
    let t = start;
    for (let i = 0; i < n; i++) {
      const dur = S.syl * (0.8 + r() * 0.4);
      let pitch = S.pitch * (1 + (r() - 0.5) * S.pv) * (1 + (i / n) * S.rise);
      const roll = r();
      /** @type {Syllable['kind']} */
      let kind = 'v';
      if (roll < S.wheeze) kind = 'w';
      else if (roll < S.wheeze + S.sob) kind = 's';
      if (r() < S.crack) pitch *= 1.45; // the voice breaks
      this.push({
        t, dur: kind === 's' ? dur * 1.8 : dur, pitch, kind,
        vowel: /** @type {Syllable['vowel']} */ (S.vowels[Math.floor(r() * S.vowels.length)]),
        amp: S.amp * (1 - (i / n) * 0.3), breath: S.breath, shake: stage >= 3, stage,
      });
      t += (kind === 's' ? dur * 1.8 : dur) + S.gap * (0.6 + r() * 0.8);
    }
    this.push({ t, dur: S.inhale, pitch: S.pitch * 1.4, kind: 'in', vowel: 'i', amp: S.inAmp, breath: 1, shake: false, stage });
    t += S.inhale + S.pause * (0.5 + r());
    this.onBout(stage, start, t);
    this.cursor = t;
  }

  /** @param {Syllable} s */
  push(s) {
    this.queue.push(s);
    this.onSyllable(s);
  }

  /** Mouth drive at time `now`: {open 0..1, inhale 0..1}. @param {number} now */
  sample(now) {
    let open = 0;
    let inhale = 0;
    for (const s of this.queue) {
      if (now < s.t || now > s.t + s.dur) continue;
      const x = (now - s.t) / s.dur;
      const v = Math.pow(Math.sin(Math.PI * x), 0.7);
      if (s.kind === 'in') inhale = Math.max(inhale, v);
      else open = Math.max(open, v * (s.kind === 'w' ? 0.8 : 1));
    }
    return { open, inhale };
  }

  /** Still mid-bout? @param {number} now */
  sounding(now) {
    return this.queue.some((s) => s.t <= now + 0.05 && s.t + s.dur >= now - 0.15);
  }
}
