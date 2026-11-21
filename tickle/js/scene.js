// @ts-check
/**
 * Scene: owns the inline SVG. Applies body poses, draws the face, and maps
 * hotspot-local coordinates to scene coordinates so the hands land on the
 * exact spot that was touched, at any screen size, even while the body moves.
 */
import { r1, clamp } from './util.js?v=202611210856';

const NS = 'http://www.w3.org/2000/svg';

/**
 * @param {string} tag
 * @param {Record<string, string|number>} [attrs]
 * @param {Element} [parent]
 * @returns {SVGElement}
 */
export function svgEl(tag, attrs = {}, parent) {
  const e = /** @type {SVGElement} */ (document.createElementNS(NS, tag));
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}

/**
 * Body parts. `roots` are where a hand enters from (outside the frame).
 * `mirror` is where a second hand goes when one is already busy here.
 * `gaze` is where the eyes look when glancing at the part.
 * @type {Record<string, {roots: [number, number][], mirror: string, gaze: [number, number], label: string}>}
 */
export const PARTS = {
  neck: { roots: [[-120, 250], [720, 250]], mirror: 'stomach', gaze: [0, 1], label: 'neck' },
  ribsL: { roots: [[-110, 300], [-100, 560]], mirror: 'ribsR', gaze: [-0.7, 1], label: 'ribs' },
  ribsR: { roots: [[710, 300], [700, 560]], mirror: 'ribsL', gaze: [0.7, 1], label: 'ribs' },
  stomach: { roots: [[710, 600], [-110, 620]], mirror: 'neck', gaze: [0, 1], label: 'stomach' },
  footL: { roots: [[150, 1010], [-110, 940]], mirror: 'footR', gaze: [-0.15, 1], label: 'feet' },
  footR: { roots: [[450, 1010], [710, 940]], mirror: 'footL', gaze: [0.15, 1], label: 'feet' },
  // the rest of them: anywhere you touch, something reaches for it
  armL: { roots: [[-110, 440], [-110, 260]], mirror: 'armR', gaze: [-0.8, 1], label: 'arm' },
  armR: { roots: [[710, 440], [710, 260]], mirror: 'armL', gaze: [0.8, 1], label: 'arm' },
  legL: { roots: [[-110, 700], [150, 1010]], mirror: 'legR', gaze: [-0.3, 1], label: 'leg' },
  legR: { roots: [[710, 700], [450, 1010]], mirror: 'legL', gaze: [0.3, 1], label: 'leg' },
  hips: { roots: [[-110, 540], [710, 540]], mirror: 'neck', gaze: [0, 1], label: 'hips' },
  torso: { roots: [[710, 250], [-110, 250]], mirror: 'stomach', gaze: [0, 1], label: 'chest' },
  head: { roots: [[-120, 130], [720, 130]], mirror: 'stomach', gaze: [0, 0], label: 'face' },
};
export const PART_NAMES = Object.keys(PARTS);

/**
 * @typedef {Object} Pose
 * @property {number} bodyX @property {number} bodyY
 * @property {number} torsoRot @property {number} torsoY
 * @property {number} chestX @property {number} chestY
 * @property {number} headRot @property {number} headX @property {number} headY
 * @property {number} armL @property {number} armR
 * @property {number} legL @property {number} legR
 * @property {number} legLS @property {number} legRS
 * @property {number} footL @property {number} footR
 */

/** @returns {Pose} */
export function restPose() {
  return {
    bodyX: 0, bodyY: 0, torsoRot: 0, torsoY: 0, chestX: 1, chestY: 1,
    headRot: 0, headX: 0, headY: 0, armL: 0, armR: 0,
    legL: 0, legR: 0, legLS: 1, legRS: 1, footL: 0, footR: 0,
  };
}

/**
 * @typedef {Object} Face
 * @property {number} smile   0..1.1 corner lift
 * @property {number} open    0..1 jaw
 * @property {number} browIn  0..1 inner brow raise (distress)
 * @property {number} browOut 0..1 outer brow raise
 * @property {number} eyeL    lid openness, 0 closed .6 relaxed 1.2 too wide
 * @property {number} eyeR
 * @property {number} gazeX   -1..1
 * @property {number} gazeY   -1..1 (+ = toward their own body)
 * @property {number} pupil   0..1
 * @property {number} glint   0..1 catchlight
 * @property {number} tears   0..1
 * @property {number} flush   0..1
 * @property {number} sweat   0..1
 * @property {number} asym    0..1 mouth asymmetry
 * @property {number} dark    0..1 under-eye darkness
 */

const EYES = { L: { cx: 281, cy: 150, side: -1 }, R: { cx: 319, cy: 150, side: 1 } };

export class Scene {
  /** @param {SVGSVGElement} svg */
  constructor(svg) {
    this.svg = svg;
    /** @param {string} id */
    const $ = (id) => /** @type {SVGElement} */ (svg.querySelector('#' + id));
    this.g = {
      person: $('tm-person'), body: $('tm-body'), torso: $('tm-torso'), chest: $('tm-chest'),
      head: $('tm-head'), armL: $('tm-armL'), armR: $('tm-armR'),
      legL: $('tm-legL'), legR: $('tm-legR'), footL: $('tm-footL'), footR: $('tm-footR'),
      hands: $('tm-hands'),
    };
    /** @type {Record<string, {el: SVGGraphicsElement, cx: number, cy: number, rx: number, ry: number, ellipse: boolean}>} */
    this.hot = {};
    svg.querySelectorAll('.tm-hot').forEach((node) => {
      const h = /** @type {SVGGraphicsElement} */ (node);
      const part = h.getAttribute('data-part') || '';
      if (h.tagName.toLowerCase() === 'ellipse') {
        this.hot[part] = {
          el: h, ellipse: true,
          cx: Number(h.getAttribute('cx')), cy: Number(h.getAttribute('cy')),
          rx: Number(h.getAttribute('rx')), ry: Number(h.getAttribute('ry')),
        };
      } else {
        // a body-shaped area: use its bounding box, but stay near the middle
        const b = h.getBBox();
        this.hot[part] = {
          el: h, ellipse: false,
          cx: b.x + b.width / 2, cy: b.y + b.height / 2, rx: b.width * 0.25, ry: b.height * 0.3,
        };
      }
    });
    this.filters = {
      boilNoise: $('tm-boil-noise'), boilMap: $('tm-boil-map'),
      handNoise: $('tm-hand-noise'), handMap: $('tm-hand-map'),
    };
    this.boilEnabled = true;
    this.buildFace($('tm-face'), $);
  }

  /* ---------------- coordinates ---------------- */

  /** Hotspot-local point -> scene (viewBox) point, tracking all body transforms. */
  toWorld(part, lx, ly) {
    const h = this.hot[part];
    const a = h.el.getScreenCTM();
    const b = this.svg.getScreenCTM();
    if (!a || !b) return /** @type {[number, number]} */ ([lx, ly]);
    const m = b.inverse().multiply(a);
    return /** @type {[number, number]} */ ([m.a * lx + m.c * ly + m.e, m.b * lx + m.d * ly + m.f]);
  }

  /** Client (pointer) point -> hotspot-local point, clamped inside the hotspot. */
  toLocal(part, clientX, clientY) {
    const h = this.hot[part];
    const ctm = h.el.getScreenCTM();
    if (!ctm) return /** @type {[number, number]} */ ([h.cx, h.cy]);
    const m = ctm.inverse();
    let x = m.a * clientX + m.c * clientY + m.e;
    let y = m.b * clientX + m.d * clientY + m.f;
    // a click inside a body-shaped area is already exactly where it should be
    if (!h.ellipse) return /** @type {[number, number]} */ ([x, y]);
    const nx = (x - h.cx) / h.rx;
    const ny = (y - h.cy) / h.ry;
    const d = Math.hypot(nx, ny);
    if (d > 0.85) {
      x = h.cx + (nx / d) * 0.85 * h.rx;
      y = h.cy + (ny / d) * 0.85 * h.ry;
    }
    return /** @type {[number, number]} */ ([x, y]);
  }

  /** A deterministic point inside a hotspot. u, v in [-1, 1]. */
  localPoint(part, u = 0, v = 0) {
    const h = this.hot[part];
    const k = h.ellipse ? 0.55 : 0.4;
    return /** @type {[number, number]} */ ([h.cx + u * h.rx * k, h.cy + v * h.ry * k]);
  }

  /* ---------------- line boil ---------------- */

  setBoil(on) {
    this.boilEnabled = on;
    if (on) {
      this.g.person.setAttribute('filter', 'url(#tm-boil)');
    } else {
      this.g.person.removeAttribute('filter');
    }
  }

  setHandFx(on) {
    if (on) this.g.hands.setAttribute('filter', 'url(#tm-handfx)');
    else this.g.hands.removeAttribute('filter');
  }

  /** @param {number} frame @param {number} amount */
  boil(frame, amount) {
    if (!this.boilEnabled) return;
    const seed = String(1 + (frame % 4));
    this.filters.boilNoise.setAttribute('seed', seed);
    this.filters.boilMap.setAttribute('scale', r1(amount).toString());
    this.filters.handNoise.setAttribute('seed', seed);
    this.filters.handMap.setAttribute('scale', r1(amount * 1.25).toString());
  }

  /* ---------------- body ---------------- */

  /** @param {Pose} p */
  setPose(p) {
    const g = this.g;
    g.body.setAttribute('transform', `translate(${r1(p.bodyX)} ${r1(p.bodyY)})`);
    g.torso.setAttribute('transform', `rotate(${r1(p.torsoRot)} 300 480) translate(0 ${r1(p.torsoY)})`);
    g.chest.setAttribute(
      'transform',
      `translate(300 340) scale(${p.chestX.toFixed(3)} ${p.chestY.toFixed(3)}) translate(-300 -340)`,
    );
    g.head.setAttribute('transform', `rotate(${r1(p.headRot)} 300 214) translate(${r1(p.headX)} ${r1(p.headY)})`);
    g.armL.setAttribute('transform', `rotate(${r1(p.armL)} 214 244)`);
    g.armR.setAttribute('transform', `rotate(${r1(p.armR)} 386 244)`);
    g.legL.setAttribute(
      'transform',
      `rotate(${r1(p.legL)} 256 540) translate(256 540) scale(1 ${p.legLS.toFixed(3)}) translate(-256 -540)`,
    );
    g.legR.setAttribute(
      'transform',
      `rotate(${r1(p.legR)} 344 540) translate(344 540) scale(1 ${p.legRS.toFixed(3)}) translate(-344 -540)`,
    );
    g.footL.setAttribute('transform', `rotate(${r1(p.footL)} 262 796)`);
    g.footR.setAttribute('transform', `rotate(${r1(p.footR)} 338 796)`);
  }

  /* ---------------- face ---------------- */

  /** @param {SVGElement} root @param {(id: string) => SVGElement} $ */
  buildFace(root, $) {
    /** @type {Record<string, SVGElement>} */
    const f = {};
    f.under = svgEl('path', { class: 'tm-under', opacity: 0 }, root);
    for (const k of /** @type {const} */ (['L', 'R'])) {
      const clip = `url(#tm-clip-eye${k})`;
      f['white' + k] = svgEl('path', { class: 'tm-eye-white' }, root);
      const inner = svgEl('g', { 'clip-path': clip }, root);
      f['iris' + k] = svgEl('circle', { class: 'tm-iris', r: 4.7 }, inner);
      f['pupil' + k] = svgEl('circle', { class: 'tm-pupil', r: 2 }, inner);
      f['glint' + k] = svgEl('circle', { class: 'tm-glint', r: 1 }, inner);
      f['lid' + k] = svgEl('path', { class: 'tm-lid' }, root);
      f['low' + k] = svgEl('path', { class: 'tm-lid-low' }, root);
      f['brow' + k] = svgEl('path', { class: 'tm-brow' }, root);
      f['clip' + k] = $(`tm-clip-eye${k}-path`);
    }
    f.worry = svgEl('path', { class: 'tm-crease', opacity: 0, 'stroke-width': 1.3 }, root);
    svgEl('path', { class: 'tm-nose', d: 'M297 156 Q295 166 292 172 M294 177 Q300 180 306 177' }, root);
    svgEl('ellipse', { class: 'tm-nostril', cx: 295.5, cy: 175, rx: 2.3, ry: 1.4 }, root);
    svgEl('ellipse', { class: 'tm-nostril', cx: 304.5, cy: 175, rx: 2.3, ry: 1.4 }, root);
    f.flushL = svgEl('ellipse', { cx: 270, cy: 178, rx: 15, ry: 9, fill: 'url(#tm-flush)', opacity: 0 }, root);
    f.flushR = svgEl('ellipse', { cx: 330, cy: 178, rx: 15, ry: 9, fill: 'url(#tm-flush)', opacity: 0 }, root);
    f.smileLines = svgEl('path', { class: 'tm-crease', opacity: 0 }, root);
    f.mouth = svgEl('path', { class: 'tm-mouth' }, root);
    const mouthInner = svgEl('g', { 'clip-path': 'url(#tm-clip-mouth)' }, root);
    f.tongue = svgEl('ellipse', { class: 'tm-tongue', cx: 300, cy: 206, rx: 9, ry: 5 }, mouthInner);
    f.teeth = svgEl('path', { class: 'tm-teeth' }, mouthInner);
    f.lowTeeth = svgEl('path', { class: 'tm-teeth', opacity: 0 }, mouthInner);
    f.mouthLine = svgEl('path', { class: 'tm-mouth is-closed' }, root);
    f.mouthClip = $('tm-clip-mouth-path');
    f.tearL = svgEl('path', { class: 'tm-tear', opacity: 0, d: 'M270 153 Q262 160 255 174 Q252 182 250 188' }, root);
    f.tearR = svgEl('path', { class: 'tm-tear', opacity: 0, d: 'M330 153 Q338 160 345 174 Q348 182 350 188' }, root);
    f.sweat = svgEl('g', { opacity: 0 }, root);
    for (const [x, y, s] of [[284, 138, 1], [318, 134, 0.8], [334, 146, 1.1], [266, 146, 0.7]]) {
      svgEl('path', {
        class: 'tm-sweat',
        d: `M${x} ${y - 3.5 * s} Q${x + 2.4 * s} ${y} ${x} ${y + 2 * s} Q${x - 2.4 * s} ${y} ${x} ${y - 3.5 * s}Z`,
      }, f.sweat);
    }
    /** @type {Record<string, SVGElement>} */
    this.f = f;
  }

  /** @param {Face} F */
  setFace(F) {
    const f = this.f;
    for (const k of /** @type {const} */ (['L', 'R'])) {
      const E = EYES[k];
      const o = clamp(k === 'L' ? F.eyeL : F.eyeR, 0, 1.35);
      const hw = 11 + Math.max(0, o - 1) * 2;
      const h = 5.4;
      const x0 = E.cx - hw;
      const x1 = E.cx + hw;
      const y0 = E.cy + 0.5;
      const topY = E.cy - h * 2.1 * o;
      const botY = E.cy + h * 1.2 * (0.35 + 0.65 * Math.min(o, 1.2)) + Math.max(0, o - 1) * 3;
      const white = `M${r1(x0)} ${y0} Q${E.cx} ${r1(topY)} ${r1(x1)} ${y0} Q${E.cx} ${r1(botY)} ${r1(x0)} ${y0}Z`;
      f['white' + k].setAttribute('d', white);
      f['white' + k].setAttribute('opacity', o < 0.08 ? '0' : '1');
      f['clip' + k].setAttribute('d', white);
      const ix = E.cx + clamp(F.gazeX, -1, 1) * 5;
      const iy = E.cy + clamp(F.gazeY, -1, 1) * 2.6 - (1 - Math.min(o, 1)) * 1.2;
      f['iris' + k].setAttribute('cx', r1(ix).toString());
      f['iris' + k].setAttribute('cy', r1(iy).toString());
      f['pupil' + k].setAttribute('cx', r1(ix).toString());
      f['pupil' + k].setAttribute('cy', r1(iy).toString());
      f['pupil' + k].setAttribute('r', (0.9 + clamp(F.pupil, 0, 1) * 2.5).toFixed(2));
      f['glint' + k].setAttribute('cx', r1(ix - 1.6).toString());
      f['glint' + k].setAttribute('cy', r1(iy - 1.7).toString());
      f['glint' + k].setAttribute('opacity', clamp(F.glint, 0, 1).toFixed(2));
      // lid line: closed eyes become a single curve (a squint arches up)
      const lidY = o < 0.08 ? E.cy + 1.5 : topY;
      f['lid' + k].setAttribute('d', `M${r1(x0 - 1)} ${y0 + 0.5} Q${E.cx} ${r1(lidY)} ${r1(x1 + 1)} ${y0 + 0.5}`);
      f['low' + k].setAttribute('d', `M${r1(x0 + 2)} ${y0 + 1} Q${E.cx} ${r1(botY + 1.5)} ${r1(x1 - 2)} ${y0 + 1}`);
      f['low' + k].setAttribute('opacity', o < 0.08 ? '0' : '0.7');
      // brows: inner end rises with distress, outer end drops
      const s = E.side;
      const xi = E.cx - s * 7;
      const xo = E.cx + s * 13;
      const yi = E.cy - 14 - F.browIn * 7 + F.smile * 0.6;
      const yo = E.cy - 13 + F.browIn * 2.5 - F.browOut * 3.5;
      const ym = Math.min(yi, yo) - 3 - F.browOut * 1.5;
      f['brow' + k].setAttribute('d', `M${r1(xi)} ${r1(yi)} Q${r1((xi + xo) / 2)} ${r1(ym)} ${r1(xo)} ${r1(yo)}`);
    }
    f.under.setAttribute('d', 'M272 160 Q281 165 290 161 M310 161 Q319 165 328 160');
    f.under.setAttribute('opacity', (clamp(F.dark, 0, 1) * 0.6).toFixed(2));
    f.worry.setAttribute('d', 'M297 133 Q296 138 297 143 M303 133 Q304 138 303 143');
    f.worry.setAttribute('opacity', (clamp(F.browIn - 0.35, 0, 1) * 1.1).toFixed(2));

    // mouth
    const smile = F.smile;
    const open = clamp(F.open, 0, 1.1);
    const w = 12 + smile * 7 + open * 3;
    const cy = 193;
    const lx = 300 - w;
    const rx = 300 + w;
    const ly = cy - smile * 5.5 + F.asym * 3;
    const ry = cy - smile * 5.5 - F.asym * 1.6;
    const ux = 300 + F.asym * 2;
    const uy = cy - 1 - open * 3.2 - smile * 0.6;
    const dy = cy + 1.5 + open * 21 + smile * 4.5;
    const outline = `M${r1(lx)} ${r1(ly)} Q${r1(ux)} ${r1(uy)} ${r1(rx)} ${r1(ry)} Q300 ${r1(dy)} ${r1(lx)} ${r1(ly)}Z`;
    const isOpen = open > 0.06 || smile > 0.75;
    f.mouth.setAttribute('d', outline);
    f.mouth.setAttribute('opacity', isOpen ? '1' : '0');
    f.mouthClip.setAttribute('d', outline);
    f.mouthLine.setAttribute('d', `M${r1(lx)} ${r1(ly)} Q${r1(ux)} ${r1(cy + smile * 4)} ${r1(rx)} ${r1(ry)}`);
    f.mouthLine.setAttribute('opacity', isOpen ? '0' : '1');
    const teethDepth = 4.5 + open * 2.5;
    f.teeth.setAttribute(
      'd',
      `M${r1(lx)} ${r1(ly)} Q${r1(ux)} ${r1(uy)} ${r1(rx)} ${r1(ry)} L${r1(rx)} ${r1(ry + teethDepth)} Q${r1(ux)} ${r1(uy + teethDepth * 2)} ${r1(lx)} ${r1(ly + teethDepth)}Z`,
    );
    f.lowTeeth.setAttribute('d', `M${r1(lx + 6)} ${r1(dy - 4)} Q300 ${r1(dy - 12)} ${r1(rx - 6)} ${r1(dy - 4)} L${r1(rx)} ${r1(dy + 4)} L${r1(lx)} ${r1(dy + 4)}Z`);
    f.lowTeeth.setAttribute('opacity', clamp((open - 0.6) * 2.5, 0, 0.9).toFixed(2));
    f.tongue.setAttribute('cy', r1(dy - 3).toString());
    f.smileLines.setAttribute(
      'd',
      `M288 179 Q${r1(lx - 2)} ${r1(ly - 4)} ${r1(lx - 3)} ${r1(ly + 4)} M312 179 Q${r1(rx + 2)} ${r1(ry - 4)} ${r1(rx + 3)} ${r1(ry + 4)}`,
    );
    f.smileLines.setAttribute('opacity', (clamp(smile, 0, 1) * 0.55).toFixed(2));

    f.flushL.setAttribute('opacity', clamp(F.flush, 0, 1).toFixed(2));
    f.flushR.setAttribute('opacity', clamp(F.flush, 0, 1).toFixed(2));
    f.tearL.setAttribute('opacity', (clamp(F.tears, 0, 1) * 0.9).toFixed(2));
    f.tearR.setAttribute('opacity', (clamp(F.tears - 0.15, 0, 1) * 0.9).toFixed(2));
    f.sweat.setAttribute('opacity', clamp(F.sweat, 0, 1).toFixed(2));
  }
}
