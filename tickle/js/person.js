// @ts-check
/**
 * The person: turns (stage, who is touching what, laugh rhythm) into a body
 * pose and a face. Restrained early on. Later the mouth keeps laughing while
 * everything else about the face disagrees.
 */
import { PARTS, restPose } from './scene.js';
import { clamp, damp, lerp, mulberry32, noise1, stepNoise } from './util.js';

/** @typedef {import('./scene.js').Face} Face */
/** @typedef {import('./scene.js').Pose} Pose */

/** @param {Partial<Face>} f @returns {Face} */
const face = (f) => ({
  smile: 0, open: 0, browIn: 0, browOut: 0, eyeL: 0.62, eyeR: 0.62, gazeX: 0, gazeY: 0,
  pupil: 0.55, glint: 1, tears: 0, flush: 0, sweat: 0, asym: 0, dark: 0, ...f,
});

/** Between tickles. Stage 3+: no smile, just staring up at you. */
const REST = [
  face({ smile: 0.12, eyeL: 0.62, eyeR: 0.62 }),
  face({ smile: 0.4, open: 0.04, eyeL: 0.58, eyeR: 0.58, pupil: 0.6, flush: 0.15 }),
  face({ smile: 0.32, open: 0.1, browIn: 0.15, eyeL: 0.66, eyeR: 0.66, flush: 0.3, sweat: 0.1 }),
  face({ smile: 0.04, open: 0.2, browIn: 0.6, eyeL: 0.92, eyeR: 0.9, pupil: 0.45, tears: 0.25, flush: 0.35, sweat: 0.25, dark: 0.3 }),
  face({ smile: 0.22, open: 0.35, browIn: 0.9, eyeL: 1.05, eyeR: 1.0, pupil: 0.35, glint: 0.6, tears: 0.6, flush: 0.55, sweat: 0.5, asym: 0.3, dark: 0.55 }),
  face({ smile: 0.6, open: 0.6, browIn: 1, eyeL: 1.18, eyeR: 1.12, pupil: 0.15, glint: 0.1, tears: 1, flush: 0.7, sweat: 0.8, asym: 0.45, dark: 0.8 }),
];
/** While being tickled. */
const LAUGHING = [
  REST[0],
  face({ smile: 0.95, open: 0.35, browOut: 0.15, eyeL: 0.24, eyeR: 0.26, pupil: 0.6, flush: 0.3 }),
  face({ smile: 1, open: 0.55, browIn: 0.25, browOut: 0.1, eyeL: 0.2, eyeR: 0.22, flush: 0.45, sweat: 0.15, dark: 0.1 }),
  face({ smile: 0.95, open: 0.7, browIn: 0.78, eyeL: 0.98, eyeR: 0.94, pupil: 0.42, glint: 0.9, tears: 0.35, flush: 0.5, sweat: 0.3, asym: 0.15, dark: 0.3 }),
  face({ smile: 1, open: 0.85, browIn: 1, eyeL: 1.12, eyeR: 1.04, pupil: 0.28, glint: 0.5, tears: 0.75, flush: 0.65, sweat: 0.6, asym: 0.35, dark: 0.55 }),
  face({ smile: 1.05, open: 0.95, browIn: 1, eyeL: 1.22, eyeR: 1.16, pupil: 0.12, glint: 0.05, tears: 1, flush: 0.75, sweat: 0.85, asym: 0.5, dark: 0.85 }),
];
/** How much they look straight up at the viewer, per stage. */
const STARE = [0, 0, 0.1, 0.85, 0.75, 1];
const BLINK_RATE = [0.28, 0.3, 0.35, 0.15, 0.06, 0];
const K = [0, 0.4, 0.65, 0.85, 1.1, 1.3];
const SQUIRM_FREQ = [0, 1.4, 2.1, 3, 5, 6.5];
const POSE_RATE = [5, 6, 7, 9, 15, 20];
const FACE_RATE = [5, 6, 7, 8, 13, 16];

export class Person {
  /** @param {number} seed */
  constructor(seed) {
    this.reset(seed);
  }

  /** @param {number} seed */
  reset(seed) {
    this.rng = mulberry32(seed);
    /** @type {Pose} */
    this.pose = restPose();
    /** @type {Face} */
    this.face = { ...REST[0] };
    this.laughW = 0;
    this.nextBlink = 2;
    this.blinkUntil = 0;
    this.sacc = { x: 0.3, y: -0.2, next: 0 };
    this.jerk = 0;
  }

  /**
   * @param {number} now @param {number} dt
   * @param {{stage: number, frantic: boolean, contacts: {part: string, level: number, side: number}[],
   *   laughOpen: number, laughIn: number, laughing: boolean, hover: string|null, reduced: boolean, t5: number}} c
   */
  update(now, dt, c) {
    const st = c.stage;
    const k = K[st] * (c.frantic ? 1.15 : 1);
    const red = c.reduced ? 0.15 : 1;
    const T = restPose();
    let L = 0;

    for (const ct of c.contacts) {
      const kk = k * ct.level;
      L += ct.level;
      switch (ct.part) {
        case 'ribsL':
          T.torsoRot += 3.5 * kk; T.bodyX += 9 * kk; T.armL -= 9 * kk; T.headRot += 6 * kk;
          break;
        case 'ribsR':
          T.torsoRot -= 3.5 * kk; T.bodyX -= 9 * kk; T.armR += 9 * kk; T.headRot -= 6 * kk;
          break;
        case 'stomach':
          T.chestY -= 0.04 * kk; T.torsoY += 3 * kk; T.headY += 5 * kk;
          T.legLS -= 0.07 * kk; T.legRS -= 0.07 * kk; T.armL -= 5 * kk; T.armR += 5 * kk;
          break;
        case 'neck':
          T.headY += 6 * kk; T.headRot += (ct.side || 1) * 11 * kk; T.chestX += 0.02 * kk;
          T.armL -= 4 * kk; T.armR += 4 * kk;
          break;
        case 'footL':
          T.legLS -= 0.13 * kk; T.legL += 3 * kk; T.bodyY -= 4 * kk;
          T.footL += 18 * noise1(now * (3 + 4 * k), 5) * kk;
          break;
        case 'footR':
          T.legRS -= 0.13 * kk; T.legR -= 3 * kk; T.bodyY -= 4 * kk;
          T.footR += 18 * noise1(now * (3 + 4 * k), 6) * kk;
          break;
        case 'armL':
          T.armL -= 11 * kk; T.torsoRot += 2 * kk; T.bodyX += 5 * kk; T.headRot += 4 * kk;
          break;
        case 'armR':
          T.armR += 11 * kk; T.torsoRot -= 2 * kk; T.bodyX -= 5 * kk; T.headRot -= 4 * kk;
          break;
        case 'legL':
          T.legLS -= 0.08 * kk; T.legL += 4 * kk; T.bodyX += 4 * kk;
          break;
        case 'legR':
          T.legRS -= 0.08 * kk; T.legR -= 4 * kk; T.bodyX -= 4 * kk;
          break;
        case 'hips':
          T.bodyY -= 5 * kk; T.torsoY += 2 * kk; T.legLS -= 0.05 * kk; T.legRS -= 0.05 * kk;
          T.bodyX += noise1(now * (2 + 3 * k), 9) * 6 * kk;
          break;
        case 'torso':
          T.chestY -= 0.03 * kk; T.chestX -= 0.02 * kk; T.headY += 4 * kk; T.armL -= 6 * kk; T.armR += 6 * kk;
          break;
        case 'head':
          // turning away from it, chin tucked, shoulder up
          T.headRot -= (ct.side || 1) * 16 * kk; T.headY += 3 * kk; T.chestX += 0.015 * kk;
          break;
      }
    }
    const Lc = clamp(L, 0, 1.2);

    // squirming: always in their own rhythm, faster and less human later
    const f = SQUIRM_FREQ[st];
    T.torsoRot += noise1(now * f, 1) * 3 * k * Lc;
    T.bodyX += noise1(now * f * 0.8, 2) * 7 * k * Lc;
    T.headRot += noise1(now * f * 1.2, 3) * 12 * k * Lc;
    T.footL += noise1(now * f * 1.5, 12) * 6 * k * Lc;
    T.footR += noise1(now * f * 1.5, 13) * 6 * k * Lc;

    // stage 5: some seconds the head locks, perfectly still, looking at you
    const lock = st === 5 && Math.sin(c.t5 * 1.1) > 0.55;
    if (st >= 4) {
      // trying to get away: jerky, held, then a sudden shift
      const away = c.contacts.reduce((s, ct) => s - ct.side * ct.level, 0);
      T.bodyX += (stepNoise(now * 3.5, 4) * 10 + away * 6) * Lc;
      if (!lock) T.headRot += Math.sin(now * 2.3) * 16 * Lc;
      T.armL += stepNoise(now * 2.5, 14) * 6 * Lc;
      T.armR += stepNoise(now * 2.5, 15) * 6 * Lc;
    }
    if (lock) T.headRot = 0;
    T.bodyX = clamp(T.bodyX, -30, 30);

    // the laugh shakes the whole body
    T.torsoY -= c.laughOpen * 2.2 * k;
    T.chestY += c.laughOpen * 0.015 * k;
    T.headY -= c.laughOpen * 1.5 * k;

    // reduced motion keeps the face, drops most of the movement
    for (const key of /** @type {(keyof Pose)[]} */ (Object.keys(T))) {
      const restV = key === 'chestX' || key === 'chestY' || key === 'legLS' || key === 'legRS' ? 1 : 0;
      T[key] = restV + (T[key] - restV) * red;
    }

    const rate = POSE_RATE[st];
    const P = this.pose;
    const before = P.bodyX + P.torsoRot;
    for (const key of /** @type {(keyof Pose)[]} */ (Object.keys(T))) P[key] = damp(P[key], T[key], rate, dt);
    this.jerk = Math.abs(P.bodyX + P.torsoRot - before) / Math.max(dt, 0.001);

    // breathing (not damped)
    const br = [0.22, 0.25, 0.32, 0.45, 0.6, 0.75][st];
    this.breath = Math.sin(now * Math.PI * 2 * br) * (0.008 + st * 0.003);
    // stage 5 tremor
    this.tremor = st === 5 && !c.reduced ? [stepNoise(now * 30, 7) * 0.7, stepNoise(now * 28, 8) * 0.8] : [0, 0];

    this.updateFace(now, dt, c, st, lock);
  }

  /** @returns {Pose} the pose to draw this frame */
  drawPose() {
    const p = { ...this.pose };
    p.chestX += this.breath || 0;
    p.chestY += (this.breath || 0) * 0.6;
    const [tx, ty] = this.tremor || [0, 0];
    p.headX += tx;
    p.bodyX += ty;
    return p;
  }

  /**
   * @param {number} now @param {number} dt @param {Parameters<Person['update']>[2]} c
   * @param {number} st @param {boolean} lock
   */
  updateFace(now, dt, c, st, lock) {
    this.laughW = damp(this.laughW, c.laughing ? 1 : 0, c.laughing ? 6 : 2.2, dt);
    const R = REST[st];
    const G = LAUGHING[st];
    const w = this.laughW;
    /** @type {Face} */
    const T = /** @type {any} */ ({});
    for (const key of /** @type {(keyof Face)[]} */ (Object.keys(R))) T[key] = lerp(R[key], G[key], w);

    // the mouth follows the laugh rhythm
    T.open = T.open * (w > 0.2 ? 0.35 + 0.65 * c.laughOpen : 1) + c.laughIn * 0.25;
    if (st <= 2) {
      // a real laugh: cheeks push the eyes shut on each "ha"
      T.eyeL -= c.laughOpen * 0.12 * w;
      T.eyeR -= c.laughOpen * 0.12 * w;
    }
    if (st === 4 && w > 0.5 && noise1(now * 0.7, 11) > 0.45) {
      // squeezed shut, like it hurts
      T.eyeL = 0.06;
      T.eyeR = 0.1;
      T.browIn = 1;
    }
    if (c.frantic) {
      T.open = Math.max(T.open, 0.85);
      T.eyeL += 0.06;
    }

    // gaze
    if (now > this.sacc.next) {
      const r = this.rng;
      const idleBelly = st === 0 && r() < 0.18;
      this.sacc = {
        x: idleBelly ? 0 : (r() * 2 - 1) * 0.6,
        y: idleBelly ? 1 : (r() * 2 - 1) * 0.45,
        next: now + 0.5 + r() * 1.9,
      };
    }
    let gx = this.sacc.x;
    let gy = this.sacc.y;
    const look = c.hover || (c.contacts[0] && c.contacts[0].part) || null;
    if (look && st < 3) {
      gx = PARTS[look].gaze[0];
      gy = PARTS[look].gaze[1];
    }
    const stare = lock ? 1 : STARE[st];
    T.gazeX = lerp(gx, 0, stare);
    T.gazeY = lerp(gy, 0, stare);

    // blinking; at the end, they stop blinking
    const rate = BLINK_RATE[st];
    if (rate > 0 && now > this.nextBlink) {
      this.blinkUntil = now + 0.13;
      this.nextBlink = now + (1 / rate) * (0.5 + this.rng());
    }
    const blinking = now < this.blinkUntil;

    const fr = FACE_RATE[st];
    const F = this.face;
    for (const key of /** @type {(keyof Face)[]} */ (Object.keys(T))) {
      // gaze snaps (saccades); everything else eases
      const r = key === 'gazeX' || key === 'gazeY' ? 22 : key === 'open' ? 24 : fr;
      F[key] = damp(F[key], T[key], r, dt);
    }
    this.drawnFace = blinking ? { ...F, eyeL: 0, eyeR: 0 } : F;
  }
}
