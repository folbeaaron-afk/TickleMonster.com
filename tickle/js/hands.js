// @ts-check
/**
 * Procedural hands. Each hand is regenerated every drawn frame from a
 * handful of joint angles, so it can reach any point on the body and
 * its fingers can behave "naturally" early on and wrongly later.
 */
import { svgEl, PARTS, PART_NAMES } from './scene.js?v=202611210941';
import {
  clamp, lerp, damp, easeInOut, easeOutBack, mulberry32, noise1, stepNoise, smoothPath, taperedPath,
} from './util.js?v=202611210941';

/** @typedef {[number, number]} Pt */

/**
 * Behaviour per stage. Index 6 is "stopping" (STOP was pressed; it gets worse).
 * freq: finger cycles per second · amp: finger travel · jitter: stepped,
 * non-human twitch · curl/splay: finger posture · bend/sway: arm shape ·
 * enter: seconds to reach the body · follow: how tightly it tracks the
 * body as it squirms · linger: seconds it hovers before leaving ·
 * dur: seconds of tickling per click · elong: limb length multiplier.
 */
export const HAND_STAGE = [
  { freq: 2.4, amp: 0.55, jitter: 0, curl: 0.1, splay: 0, bend: 22, sway: 4, enter: 1.25, follow: 6, linger: 0.25, dur: 1.7, elong: 1.0, scrub: 5 },
  { freq: 2.4, amp: 0.55, jitter: 0, curl: 0.1, splay: 0, bend: 22, sway: 4, enter: 1.25, follow: 6, linger: 0.25, dur: 1.7, elong: 1.0, scrub: 5 },
  { freq: 3.4, amp: 0.75, jitter: 0.03, curl: 0.14, splay: 0.1, bend: 26, sway: 6, enter: 0.95, follow: 7, linger: 0.5, dur: 2.0, elong: 1.04, scrub: 7 },
  { freq: 5.2, amp: 0.95, jitter: 0.14, curl: 0.2, splay: 0.28, bend: 34, sway: 9, enter: 0.75, follow: 9, linger: 1.5, dur: 2.3, elong: 1.12, scrub: 9 },
  { freq: 10.5, amp: 1.15, jitter: 0.42, curl: 0.27, splay: 0.45, bend: 44, sway: 14, enter: 0.32, follow: 15, linger: 99, dur: 2.6, elong: 1.22, scrub: 12 },
  { freq: 13.5, amp: 1.25, jitter: 0.65, curl: 0.3, splay: 0.6, bend: 52, sway: 18, enter: 0.3, follow: 18, linger: 99, dur: 99, elong: 1.32, scrub: 14 },
  { freq: 19, amp: 1.35, jitter: 0.9, curl: 0.34, splay: 0.7, bend: 58, sway: 22, enter: 0.22, follow: 24, linger: 99, dur: 99, elong: 1.4, scrub: 17 },
];

/** Gentle, fade-in version for reduced motion. */
const REDUCED = { freq: 1.1, amp: 0.3, jitter: 0, curl: 0.12, splay: 0.1, bend: 20, sway: 0, follow: 4, scrub: 0 };

/** The four hands. Later ones are longer, and have one knuckle too many. */
const HAND_DEFS = [
  { factor: 1.0, extra: false, mirror: 1, seed: 11 },
  { factor: 1.5, extra: true, mirror: -1, seed: 23 },
  { factor: 1.75, extra: true, mirror: 1, seed: 37 },
  { factor: 1.05, extra: false, mirror: -1, seed: 51 },
];

/** Over the headboard. */
const ROOT_ABOVE = /** @type {Pt} */ ([480, -150]);

class Hand {
  /** @param {SVGElement} layer @param {typeof HAND_DEFS[number]} def */
  constructor(layer, def) {
    this.def = def;
    this.g = svgEl('g', { class: 'tm-hand' }, layer);
    this.arm = svgEl('path', { class: 'tm-hand-skin' }, this.g);
    this.fingers = [0, 1, 2, 3, 4].map(() => svgEl('path', { class: 'tm-hand-skin' }, this.g));
    this.palm = svgEl('path', { class: 'tm-hand-skin' }, this.g);
    this.veins = svgEl('path', { class: 'tm-hand-vein' }, this.g);
    this.nails = [0, 1, 2, 3, 4].map(() => svgEl('ellipse', { class: 'tm-hand-nail' }, this.g));
    this.creases = svgEl('path', { class: 'tm-hand-crease' }, this.g);
    this.hide();
  }

  hide() {
    this.g.style.display = 'none';
  }

  /**
   * @param {Pt} S shoulder (far outside the frame)
   * @param {Pt} C where the fingertips are
   * @param {number} t seconds
   * @param {typeof HAND_STAGE[number]} P
   * @param {number} act finger activity 0..1
   * @param {number} opacity
   */
  render(S, C, t, P, act, opacity) {
    const { mirror: m, extra, seed, factor } = this.def;
    this.g.style.display = '';
    this.g.style.opacity = opacity >= 0.999 ? '' : opacity.toFixed(3);

    const dx = C[0] - S[0];
    const dy = C[1] - S[1];
    const D = Math.hypot(dx, dy) || 1;
    const ux = dx / D;
    const uy = dy / D;
    const px = -uy;
    const py = ux;
    const sc = 1.55;
    const el = P.elong * factor;
    const fingerLen = 44 * sc * el;
    const palmLen = 36 * sc * Math.sqrt(el);
    /** @type {Pt} */ const K = [C[0] - ux * fingerLen * 0.82, C[1] - uy * fingerLen * 0.82];
    /** @type {Pt} */ const W = [K[0] - ux * palmLen, K[1] - uy * palmLen];

    // ---- arm: long, thin, a little too many bends when `extra`
    const N = extra ? 10 : 7;
    /** @type {Pt[]} */ const armPts = [];
    /** @type {number[]} */ const armW = [];
    const ax = W[0] - S[0];
    const ay = W[1] - S[1];
    for (let i = 0; i <= N; i++) {
      const k = i / N;
      const env = Math.sin(k * Math.PI);
      let off = P.bend * m * env;
      if (extra) off += P.bend * 0.9 * m * Math.sin(k * Math.PI * 2 + 0.4) * env;
      off += noise1(t * 0.6 + i * 0.35, seed) * P.sway * env;
      armPts.push([S[0] + ax * k + px * off, S[1] + ay * k + py * off]);
      let w = lerp(24, 12, k) * sc;
      if (extra) {
        w *= 1 + 0.24 * Math.exp(-(((k - 0.4) / 0.045) ** 2)) + 0.24 * Math.exp(-(((k - 0.7) / 0.045) ** 2));
      } else {
        w *= 1 + 0.16 * Math.exp(-(((k - 0.55) / 0.06) ** 2));
      }
      armW.push(w);
    }
    this.arm.setAttribute('d', taperedPath(armPts, armW));

    // ---- palm
    this.palm.setAttribute(
      'd',
      taperedPath(
        [W, [W[0] + ux * palmLen * 0.45, W[1] + uy * palmLen * 0.45], [K[0] + ux * 4, K[1] + uy * 4]],
        [15 * sc, 26 * sc, 28 * sc],
      ),
    );

    // ---- fingers
    let creases = '';
    const baseAng = Math.atan2(uy, ux);
    const segFr = extra ? [0.32, 0.27, 0.23, 0.18] : [0.42, 0.33, 0.25];
    const widths = [7.4, 6.6, 5.8, 5.0, 4.4];
    for (let j = 0; j < 5; j++) {
      const thumb = j === 4;
      /** @type {Pt} */ let B;
      let ang;
      let lens;
      let fac;
      const ph = t * Math.PI * 2 * P.freq + j * 1.35 + seed;
      const wig = Math.sin(ph);
      if (!thumb) {
        const off = m * (-10.5 + 7 * j) * sc;
        B = [K[0] + px * off - ux * 2, K[1] + py * off - uy * 2];
        ang = baseAng + m * (-0.16 + 0.11 * j) * (1 + P.splay);
        fac = [0.9, 1, 0.94, 0.74][j];
        lens = segFr.map((s) => s * fingerLen * fac);
      } else {
        B = [W[0] + ux * palmLen * 0.38 - px * m * 12 * sc, W[1] + uy * palmLen * 0.38 - py * m * 12 * sc];
        ang = baseAng - m * 0.85;
        fac = 0.62;
        lens = [0.55, 0.45].map((s) => s * fingerLen * fac);
      }
      /** @type {Pt[]} */ const pts = [B];
      let prev = B;
      for (let k = 0; k < lens.length; k++) {
        const jit = P.jitter * stepNoise(t * 18 + j * 7 + k * 3, seed) * 0.6;
        const curl = thumb ? 0.35 + act * 0.2 * wig : P.curl * (k ? 1 : 0.3) + act * P.amp * 0.32 * wig * (0.6 + k * 0.4);
        ang += (thumb ? -m : m) * curl + jit * act;
        const len = lens[k] * (1 - 0.28 * act * P.amp * Math.max(0, Math.sin(ph + k * 0.5)));
        /** @type {Pt} */ const nx = [prev[0] + Math.cos(ang) * len, prev[1] + Math.sin(ang) * len];
        pts.push(nx);
        // knuckle creases
        if (k < lens.length - 1) {
          const cw = widths[k + 1] * sc * 0.32;
          const cx = -Math.sin(ang);
          const cy = Math.cos(ang);
          creases += `M${(nx[0] - cx * cw).toFixed(1)} ${(nx[1] - cy * cw).toFixed(1)}L${(nx[0] + cx * cw).toFixed(1)} ${(nx[1] + cy * cw).toFixed(1)}`;
        }
        prev = nx;
      }
      const fw = pts.map(
        (_, i) =>
          widths[Math.min(i, widths.length - 1)] * sc * (thumb ? 1.15 : Math.sqrt(fac)) *
          // knobbly knuckles at the interior joints
          (i > 0 && i < pts.length - 1 ? 1.14 : 1),
      );
      this.fingers[j].setAttribute('d', taperedPath(pts, fw));
      // nail
      const tip = pts[pts.length - 1];
      const deg = (ang * 180) / Math.PI;
      const nxp = tip[0] - Math.cos(ang) * 3;
      const nyp = tip[1] - Math.sin(ang) * 3;
      const nail = this.nails[j];
      nail.setAttribute('cx', nxp.toFixed(1));
      nail.setAttribute('cy', nyp.toFixed(1));
      nail.setAttribute('rx', (3.3 * sc).toFixed(1));
      nail.setAttribute('ry', (2.2 * sc).toFixed(1));
      nail.setAttribute('transform', `rotate(${deg.toFixed(1)} ${nxp.toFixed(1)} ${nyp.toFixed(1)})`);
    }
    this.creases.setAttribute('d', creases);

    // ---- veins: along the forearm, over the back of the hand to the knuckles
    const from = Math.floor(N * 0.35);
    /** @type {Pt[]} */ const v1 = [];
    /** @type {Pt[]} */ const v2 = [];
    for (let i = from; i <= N; i++) {
      const a = armPts[i];
      const w = armW[i];
      const o1 = w * 0.16 * Math.sin(i * 1.7 + seed);
      const o2 = -w * 0.22 + w * 0.08 * Math.sin(i * 2.3 + seed * 2);
      v1.push([a[0] + px * o1, a[1] + py * o1]);
      if (i > from + 2) v2.push([a[0] + px * o2, a[1] + py * o2]);
    }
    const mid = /** @type {Pt} */ ([W[0] + ux * palmLen * 0.5 + px * m * 3, W[1] + uy * palmLen * 0.5 + py * m * 3]);
    v1.push(mid, [K[0] + px * m * -3.5 * sc, K[1] + py * m * -3.5 * sc]);
    let vd = smoothPath(v1);
    vd += smoothPath([mid, [K[0] + px * m * -10.5 * sc - ux * 3, K[1] + py * m * -10.5 * sc - uy * 3]]);
    vd += smoothPath([mid, [K[0] + px * m * 7 * sc - ux * 4, K[1] + py * m * 7 * sc - uy * 4]]);
    if (v2.length > 1) vd += smoothPath(v2);
    this.veins.setAttribute('d', vd);
  }
}

/** One hand plus its intent. */
class Actor {
  /** @param {SVGElement} layer @param {typeof HAND_DEFS[number]} def */
  constructor(layer, def) {
    this.hand = new Hand(layer, def);
    this.def = def;
    this.reset();
  }

  reset() {
    /** @type {'off'|'reach'|'tickle'|'linger'|'retreat'} */
    this.mode = 'off';
    this.p = 0;
    /** @type {string|null} */
    this.part = null;
    /** @type {Pt} */ this.local = [0, 0];
    /** @type {Pt} */ this.root = [0, 0];
    /** @type {Pt} */ this.shoulder = [0, 0];
    /** @type {Pt} */ this.tgt = [0, 0];
    this.until = 0;
    this.lingerUntil = 0;
    this.nextMove = 0;
    this.P = { ...HAND_STAGE[1] };
    this.level = 0;
    this.act = 0;
    this.hand.hide();
  }

  get busy() {
    return this.mode === 'reach' || this.mode === 'tickle' || this.mode === 'linger';
  }

  /**
   * @param {import('./scene.js').Scene} scene
   * @param {string} part @param {Pt} local @param {Pt} root
   * @param {number} now @param {number} dur
   */
  engage(scene, part, local, root, now, dur) {
    const fresh = this.mode === 'off' || (this.mode === 'retreat' && this.p < 0.3);
    this.part = part;
    this.local = local;
    this.until = now + dur;
    if (fresh) {
      this.root = root;
      this.tgt = scene.toWorld(part, local[0], local[1]);
      const dx = this.root[0] - this.tgt[0];
      const dy = this.root[1] - this.tgt[1];
      const d = Math.hypot(dx, dy) || 1;
      this.shoulder = [this.root[0] + (dx / d) * 280, this.root[1] + (dy / d) * 280];
      if (this.mode === 'off') this.p = 0;
    }
    this.mode = 'reach';
  }

  release() {
    if (this.mode !== 'off') this.mode = 'retreat';
  }

  /**
   * @param {number} now @param {number} dt
   * @param {import('./scene.js').Scene} scene
   * @param {typeof HAND_STAGE[number]} target
   * @param {boolean} hold never let go
   */
  update(now, dt, scene, target, hold) {
    if (this.mode === 'off') return;
    for (const k in target) this.P[k] = damp(this.P[k], target[k], 2.5, dt);
    // never let `enter` lag behind: it controls how sudden the hands are
    this.P.enter = target.enter;
    if (this.part) {
      const w = scene.toWorld(this.part, this.local[0], this.local[1]);
      const r = this.P.follow;
      this.tgt = [damp(this.tgt[0], w[0], r, dt), damp(this.tgt[1], w[1], r, dt)];
    }
    switch (this.mode) {
      case 'reach':
        this.p = Math.min(1, this.p + dt / this.P.enter);
        if (this.p >= 1) this.mode = 'tickle';
        break;
      case 'tickle':
        if (!hold && now > this.until) {
          this.mode = 'linger';
          this.lingerUntil = now + this.P.linger;
        }
        break;
      case 'linger':
        if (hold) this.mode = 'tickle';
        else if (now > this.lingerUntil) this.mode = 'retreat';
        break;
      case 'retreat':
        this.p = Math.max(0, this.p - dt / (this.P.enter * 1.3));
        if (this.p <= 0) {
          this.mode = 'off';
          this.part = null;
          this.hand.hide();
        }
        break;
    }
    const contact = this.mode === 'tickle' ? 1 : this.mode === 'reach' ? clamp((this.p - 0.85) / 0.15, 0, 1) : 0;
    this.level = damp(this.level, contact, 10, dt);
    const actT = this.mode === 'tickle' ? 1 : this.mode === 'linger' ? 0.35 : this.mode === 'reach' ? 0.4 : 0.15;
    this.act = damp(this.act, actT, 6, dt);
  }

  /** @param {number} now @param {boolean} reduced @param {number} stage */
  draw(now, reduced, stage) {
    if (this.mode === 'off') return;
    const P = reduced ? { ...this.P, ...REDUCED } : this.P;
    const ease = stage >= 4 ? easeOutBack : easeInOut;
    const e = reduced ? 1 : ease(this.p);
    const T = this.tgt;
    const R = this.root;
    let cx = lerp(R[0], T[0], e);
    let cy = lerp(R[1], T[1], e);
    const dx = T[0] - R[0];
    const dy = T[1] - R[1];
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    // hovering, not touching
    if (this.mode === 'linger') {
      cx -= ux * 9;
      cy -= uy * 9;
    }
    // scrubbing over the spot
    const s = P.scrub * this.act;
    const ph = now * Math.PI * 2 * P.freq;
    const side = Math.sin(ph * 0.5 + this.def.seed) * s;
    const push = Math.sin(ph + this.def.seed) * s * 0.45;
    const jx = P.jitter * stepNoise(now * 22, this.def.seed + 3) * 4;
    const jy = P.jitter * stepNoise(now * 22, this.def.seed + 4) * 4;
    cx += -uy * side + ux * push + jx;
    cy += ux * side + uy * push + jy;
    const shoulder = /** @type {Pt} */ ([this.shoulder[0], this.shoulder[1]]);
    this.hand.render(shoulder, [cx, cy], now, P, this.act, reduced ? clamp(this.p * 1.2, 0, 1) : 1);
  }
}

/**
 * Decides which hand goes where. Deterministic for a given seed and
 * sequence of tickles.
 */
export class HandDirector {
  /** @param {SVGElement} layer @param {import('./scene.js').Scene} scene @param {number} seed */
  constructor(layer, scene, seed) {
    this.scene = scene;
    this.actors = HAND_DEFS.map((d) => new Actor(layer, d));
    this.reset(seed);
  }

  /** @param {number} seed */
  reset(seed) {
    this.rng = mulberry32(seed);
    this.actors.forEach((a) => a.reset());
    /** @type {number|null} */
    this.autoStart = null;
    this.extraHands = 0;
  }

  /** A random point inside a part, from the seeded rng. @param {string} part */
  randomLocal(part) {
    return this.scene.localPoint(part, this.rng() * 2 - 1, this.rng() * 2 - 1);
  }

  /** @param {string} part @param {Pt} local @param {number} stage @param {number} now */
  tickle(part, local, stage, now) {
    if (stage >= 5) return; // the hands are not taking requests any more
    const P = HAND_STAGE[stage];
    const [a0, a1, a2, a3] = this.actors;
    const pair = [a0, a3];
    const root = PARTS[part].roots[0];

    if (stage >= 4) {
      // Don't leave. Crawl across the body to the new spot.
      const prim = pair.find((a) => a.busy) || a0;
      prim.engage(this.scene, part, local, prim.mode === 'off' ? root : prim.root, now, P.dur);
    } else {
      let prim = pair.find((a) => a.busy && a.part === part);
      if (!prim) {
        pair.forEach((a) => a.release());
        prim = pair.find((a) => a.mode === 'off') || pair.reduce((lo, a) => (a.p < lo.p ? a : lo));
      }
      prim.engage(this.scene, part, local, root, now, P.dur);
    }

    if (stage >= 3) {
      // A second, longer hand takes the other side.
      const other = PARTS[part].mirror;
      a1.engage(this.scene, other, this.randomLocal(other), PARTS[other].roots[0], now, P.dur + 0.6);
    } else {
      a1.release();
    }
    a2.release();
  }

  /**
   * @param {number} now @param {number} dt
   * @param {{stage: number, profile: number, auto: boolean, lastPart: string|null}} ctx
   */
  update(now, dt, ctx) {
    const target = HAND_STAGE[ctx.profile];
    const hold = ctx.stage >= 4;
    if (ctx.auto) this.autopilot(now, ctx);
    for (const a of this.actors) a.update(now, dt, this.scene, target, hold);
  }

  /** Stage 5: nobody is clicking. The hands carry on. */
  autopilot(now, ctx) {
    const [a0, a1, a2, a3] = this.actors;
    const frantic = ctx.profile === 6;
    if (this.autoStart === null) {
      this.autoStart = now;
      const p0 = ctx.lastPart || 'stomach';
      if (!a0.busy && !a3.busy) a0.engage(this.scene, p0, this.randomLocal(p0), PARTS[p0].roots[0], now, 99);
      const p1 = PARTS[p0].mirror;
      if (!a1.busy) a1.engage(this.scene, p1, this.randomLocal(p1), PARTS[p1].roots[0], now, 99);
      for (const a of [a0, a1, a3]) a.nextMove = now + 1.2 + this.rng() * 1.2;
    }
    const t = now - this.autoStart;
    if (t > 2.2 && !a2.busy) {
      a2.engage(this.scene, 'neck', this.randomLocal('neck'), ROOT_ABOVE, now, 99);
      a2.nextMove = now + 2.5;
    }
    if (t > 5.5 && !a3.busy && !a0.busy) {
      a0.engage(this.scene, 'footL', this.randomLocal('footL'), PARTS.footL.roots[0], now, 99);
    } else if (t > 5.5 && !a3.busy) {
      const foot = a0.part === 'footR' ? 'footL' : 'footR';
      a3.engage(this.scene, foot, this.randomLocal(foot), PARTS[foot].roots[0], now, 99);
      a3.nextMove = now + 1.5;
    }
    for (const a of this.actors) {
      if (!a.busy || now < a.nextMove) continue;
      const taken = new Set(this.actors.filter((b) => b !== a && b.busy).map((b) => b.part));
      const choices = PART_NAMES.filter((p) => p !== a.part && !taken.has(p));
      if (!choices.length) continue;
      const next = choices[Math.floor(this.rng() * choices.length)];
      a.engage(this.scene, next, this.randomLocal(next), a.root, now, 99);
      a.nextMove = now + (frantic ? 0.5 + this.rng() * 0.6 : 1.4 + this.rng() * 1.8);
    }
  }

  /** @param {number} now @param {boolean} reduced @param {number} stage */
  draw(now, reduced, stage) {
    for (const a of this.actors) a.draw(now, reduced, stage);
  }

  /** Who is touching what, for the body to react to. */
  contacts() {
    return this.actors
      .filter((a) => a.part && a.level > 0.02)
      .map((a) => ({ part: /** @type {string} */ (a.part), level: a.level, side: Math.sign(a.root[0] - 300) || 0 }));
  }

  anyVisible() {
    return this.actors.some((a) => a.mode !== 'off');
  }
}
