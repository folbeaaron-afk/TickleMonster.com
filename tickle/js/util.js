// @ts-check
/** Small math / geometry helpers shared by the experience. No DOM access here. */

/** @param {number} v @param {number} lo @param {number} hi */
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** @param {number} a @param {number} b @param {number} t */
export const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent exponential approach. @param {number} cur @param {number} target @param {number} rate @param {number} dt */
export const damp = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));
/** @param {number} t */
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Overshoots a little, then settles: used once the hands stop behaving. @param {number} t */
export const easeOutBack = (t) => {
  const c1 = 2.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Deterministic PRNG. Same seed, same experience. @param {number} seed */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {number} n */
function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Smooth 1D value noise in [-1, 1]. @param {number} x @param {number} [seed] */
export function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash1(i + seed * 57.31);
  const b = hash1(i + 1 + seed * 57.31);
  const u = f * f * (3 - 2 * f);
  return (a + (b - a) * u) * 2 - 1;
}

/** Stepped (held) noise in [-1, 1]: jumps, never glides. @param {number} x @param {number} [seed] */
export function stepNoise(x, seed = 0) {
  return hash1(Math.floor(x) + seed * 91.7) * 2 - 1;
}

/** @param {number} n */
export const r1 = (n) => Math.round(n * 10) / 10;

/**
 * @typedef {[number, number]} Pt
 */

/**
 * Continue a path through points using the midpoint-quadratic technique.
 * Assumes the current point is pts[0].
 * @param {Pt[]} pts
 */
function curveThrough(pts) {
  let d = '';
  const n = pts.length;
  if (n === 2) return ` L${r1(pts[1][0])} ${r1(pts[1][1])}`;
  for (let i = 1; i < n - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${r1(pts[i][0])} ${r1(pts[i][1])} ${r1(mx)} ${r1(my)}`;
  }
  d += ` L${r1(pts[n - 1][0])} ${r1(pts[n - 1][1])}`;
  return d;
}

/** Open smooth polyline. @param {Pt[]} pts */
export function smoothPath(pts) {
  if (pts.length < 2) return '';
  return `M${r1(pts[0][0])} ${r1(pts[0][1])}` + curveThrough(pts);
}

/**
 * Closed outline of a "limb" running through pts with the given widths,
 * with rounded caps at both ends.
 * @param {Pt[]} pts
 * @param {number[]} widths
 */
export function taperedPath(pts, widths) {
  const n = pts.length;
  /** @type {Pt[]} */ const L = [];
  /** @type {Pt[]} */ const R = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const hw = widths[i] / 2;
    L.push([pts[i][0] - ty * hw, pts[i][1] + tx * hw]);
    R.push([pts[i][0] + ty * hw, pts[i][1] - tx * hw]);
  }
  const last = pts[n - 1];
  const prev = pts[n - 2];
  let dx = last[0] - prev[0];
  let dy = last[1] - prev[1];
  const dl = Math.hypot(dx, dy) || 1;
  dx /= dl;
  dy /= dl;
  const hwl = widths[n - 1] / 2;
  const tip = [last[0] + dx * hwl * 1.6, last[1] + dy * hwl * 1.6];

  const first = pts[0];
  const second = pts[1];
  let sx = first[0] - second[0];
  let sy = first[1] - second[1];
  const sl = Math.hypot(sx, sy) || 1;
  sx /= sl;
  sy /= sl;
  const hw0 = widths[0] / 2;
  const back = [first[0] + sx * hw0 * 1.6, first[1] + sy * hw0 * 1.6];

  let d = `M${r1(L[0][0])} ${r1(L[0][1])}`;
  d += curveThrough(L);
  d += ` Q${r1(tip[0])} ${r1(tip[1])} ${r1(R[n - 1][0])} ${r1(R[n - 1][1])}`;
  d += curveThrough(R.slice().reverse());
  d += ` Q${r1(back[0])} ${r1(back[1])} ${r1(L[0][0])} ${r1(L[0][1])}Z`;
  return d;
}
