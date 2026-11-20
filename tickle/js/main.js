// @ts-check
/**
 * "They're Ticklish" — interactive piece for TICKLE MONSTER.
 * Wires input -> state machine -> hands / person / laugh / audio -> SVG.
 */
import { createMachine } from './state.js';
import { Scene, PARTS } from './scene.js';
import { HandDirector } from './hands.js';
import { Person } from './person.js';
import { LaughDriver } from './laugh.js';
import { AudioEngine } from './audio.js';
import { stepNoise } from './util.js';

const SEED = 0x71c4;
const MOTION_KEY = 'tm-ticklish-motion';

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const root = $('tm');
const svg = /** @type {SVGSVGElement} */ (/** @type {unknown} */ ($('tm-scene')));
const headline = $('tm-headline');
const caption = $('tm-caption');
const stopBtn = /** @type {HTMLButtonElement} */ ($('tm-stop'));
const soundBtn = $('tm-sound');
const motionBtn = $('tm-motion');
const black = $('tm-black');
const end = $('tm-end');
const replayBtn = $('tm-replay');
const shareBtn = $('tm-share');

const clock = () => performance.now() / 1000;

/* ---------- motion preference ---------- */
function initialReduced() {
  try {
    const saved = localStorage.getItem(MOTION_KEY);
    if (saved === 'reduced') return true;
    if (saved === 'full') return false;
  } catch {
    /* ignore */
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
let reduced = initialReduced();

/* ---------- systems ---------- */
const machine = createMachine(clock());
const scene = new Scene(svg);
const director = new HandDirector(/** @type {SVGElement} */ (scene.g.hands), scene, SEED);
const person = new Person(SEED + 1);
const laugh = new LaughDriver(SEED + 2);
const audio = new AudioEngine();

laugh.onSyllable = (s) => audio.syllable(s, s.t - clock());
laugh.onBout = (stage, start) => {
  showCaption(stage, start);
  if (stage >= 2 && !reduced) audio.creak(stage);
};

/* ---------- captions: the sound, described ---------- */
const LINES = {
  1: ['(a small giggle)', '(giggling)', '(giggles, embarrassed)'],
  2: ['(laughing)', '“okay— okay—”', '(squirming, laughing)', '“ha— that tickles”'],
  3: ['(laughing. it sounds wrong.)', '“wait—”', '(laughing harder than they want to)', '“wait, wait—”'],
  4: ['“stop— ha— stop—”', '(trying to pull away)', '(laughing. eyes wet.)', '“please— ha—”'],
  5: ['(laughing. they can’t stop.)', '“please”', '(laughing. not breathing right.)', '“make it stop”', '(still laughing)'],
  6: ['(laughing)', '(laughing)', '(laughing)'],
};
const lineIdx = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
let captionUntil = 0;
/** @param {number} stage @param {number} start */
function showCaption(stage, start) {
  const list = LINES[stage];
  if (!list) return;
  const text = list[lineIdx[stage] % list.length];
  lineIdx[stage]++;
  // keep the text up a little longer than a bout; don't flicker it
  setTimeout(() => {
    caption.textContent = text;
    caption.classList.add('is-on');
  }, Math.max(0, (start - clock()) * 1000));
  captionUntil = start + 2.4;
}

/* ---------- UI state ---------- */
function syncMotion() {
  root.dataset.motion = reduced ? 'reduced' : 'full';
  motionBtn.textContent = reduced ? 'motion: reduced' : 'motion: full';
  motionBtn.setAttribute('aria-pressed', String(reduced));
  scene.setBoil(!reduced && !lowPower);
}
function syncSound() {
  soundBtn.textContent = audio.muted ? 'sound: off' : 'sound: on';
  soundBtn.setAttribute('aria-pressed', String(!audio.muted));
}

let lowPower = false;
syncMotion();
syncSound();

/* ---------- input ---------- */
/** @type {string|null} */
let hover = null;

/** @param {string} part @param {[number, number]} local */
function tickle(part, local) {
  audio.unlock();
  const now = clock();
  const prev = machine.state;
  if (!machine.dispatch({ type: 'TICKLE', part, t: now })) return;
  const s = machine.state;
  onTransition(s, prev, now);
  director.tickle(part, local, s.stage, now);
}

for (const part of Object.keys(PARTS)) {
  const el = scene.hot[part].el;
  el.addEventListener('pointerdown', (e) => {
    const pe = /** @type {PointerEvent} */ (e);
    if (pe.button !== 0) return;
    pe.preventDefault();
    tickle(part, scene.toLocal(part, pe.clientX, pe.clientY));
  });
  el.addEventListener('keydown', (e) => {
    const ke = /** @type {KeyboardEvent} */ (e);
    if (ke.key === 'Enter' || ke.key === ' ') {
      ke.preventDefault();
      tickle(part, scene.localPoint(part, 0, 0));
    }
  });
  el.addEventListener('pointerenter', (e) => {
    if (/** @type {PointerEvent} */ (e).pointerType === 'mouse') hover = part;
  });
  el.addEventListener('pointerleave', () => {
    if (hover === part) hover = null;
  });
}

stopBtn.addEventListener('click', () => {
  audio.unlock();
  const now = clock();
  const prev = machine.state;
  if (machine.dispatch({ type: 'STOP', t: now })) onTransition(machine.state, prev, now);
});

soundBtn.addEventListener('click', () => {
  audio.unlock();
  audio.setMuted(!audio.muted);
  syncSound();
});
motionBtn.addEventListener('click', () => {
  reduced = !reduced;
  try {
    localStorage.setItem(MOTION_KEY, reduced ? 'reduced' : 'full');
  } catch {
    /* ignore */
  }
  syncMotion();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' && !e.metaKey && !e.ctrlKey && !e.altKey) soundBtn.click();
});
// Any first gesture may unlock audio (e.g. a tap on the bed, not the body).
window.addEventListener('pointerdown', () => audio.unlock(), { once: true, capture: true });

replayBtn.addEventListener('click', () => {
  audio.unlock();
  const now = clock();
  const prev = machine.state;
  if (machine.dispatch({ type: 'REPLAY', t: now })) onTransition(machine.state, prev, now);
});

shareBtn.addEventListener('click', async () => {
  const url = location.href.split('#')[0];
  const text = 'Click on this person’s stomach.';
  try {
    if (navigator.share) {
      await navigator.share({ text, url });
      return;
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    shareBtn.textContent = 'link copied';
  } catch {
    shareBtn.textContent = url;
  }
});

/* ---------- transitions ---------- */
let gigglePlayed = false;

/**
 * @param {import('./state.js').TickleState} s
 * @param {import('./state.js').TickleState} prev
 * @param {number} now
 */
function onTransition(s, prev, now) {
  if (s.stage !== prev.stage) {
    root.dataset.stage = String(s.stage);
    if (s.stage === 3) headline.textContent = 'GO AHEAD.';
    if (s.stage === 0) headline.textContent = 'GO AHEAD. THEY’RE TICKLISH.';
  }
  if (s.phase !== prev.phase) {
    root.dataset.phase = s.phase;
    switch (s.phase) {
      case 'idle':
        resetAll(now);
        break;
      case 'frozen':
        // abrupt: no fade, no last syllable
        audio.cut();
        caption.classList.remove('is-on');
        stopBtn.disabled = true;
        break;
      case 'black':
        black.hidden = false;
        stopBtn.hidden = true;
        break;
      case 'title':
        end.hidden = false;
        replayBtn.focus({ preventScroll: true });
        break;
      case 'stopping':
        stopBtn.classList.add('is-pressed');
        stopBtn.setAttribute('aria-disabled', 'true');
        break;
    }
  }
  if (s.stopVisible && !prev.stopVisible) stopBtn.hidden = false;
  audio.setStage(s.phase === 'stopping' ? 6 : s.stage);
}

/** @param {number} now */
function resetAll(now) {
  director.reset(SEED);
  person.reset(SEED + 1);
  laugh.reset(SEED + 2);
  audio.reset();
  for (const k in lineIdx) lineIdx[k] = 0;
  gigglePlayed = false;
  black.hidden = true;
  end.hidden = true;
  stopBtn.hidden = true;
  stopBtn.disabled = false;
  stopBtn.classList.remove('is-pressed');
  stopBtn.removeAttribute('aria-disabled');
  caption.classList.remove('is-on');
  caption.textContent = '';
  shareBtn.textContent = 'send it to someone';
  headline.textContent = 'GO AHEAD. THEY’RE TICKLISH.';
  root.dataset.stage = '0';
  scene.setPose(person.drawPose());
  scene.setFace(/** @type {any} */ (person.drawnFace || person.face));
  director.draw(now, reduced, 0);
}

/* ---------- loop ---------- */
let last = clock();
let lastPersonDraw = 0;
let lastHandDraw = 0;
let boilFrame = 0;
let slowFrames = 0;
const PERSON_FPS = [15, 15, 15, 15, 24, 24];
const HAND_FPS = [15, 15, 15, 18, 30, 60];

function frame() {
  const now = clock();
  const dt = Math.min(0.05, now - last);
  last = now;

  const prev = machine.state;
  if (machine.dispatch({ type: 'TICK', t: now })) onTransition(machine.state, prev, now);
  const s = machine.state;

  const live = s.phase === 'idle' || s.phase === 'play' || s.phase === 'auto' || s.phase === 'stopping';
  if (live) {
    const frantic = s.phase === 'stopping';
    const profile = frantic ? 6 : s.stage;
    director.update(now, dt, { stage: s.stage, profile, auto: s.phase === 'auto' || frantic, lastPart: s.lastPart });
    const contacts = director.contacts();
    const touching = contacts.some((c) => c.level > 0.5);
    laugh.update(now, touching || s.stage >= 5, profile);
    const env = laugh.sample(now);
    person.update(now, dt, {
      stage: s.stage, frantic, contacts, laughOpen: env.open, laughIn: env.inhale,
      laughing: touching || laugh.sounding(now), hover, reduced, t5: s.stage === 5 ? now - s.stageAt : 0,
    });
    audio.update(profile);

    const pFps = reduced ? 30 : PERSON_FPS[s.stage];
    if (now - lastPersonDraw >= 1 / pFps - 0.002) {
      lastPersonDraw = now;
      scene.setPose(person.drawPose());
      // in the late stages the face sometimes "sticks" for a beat
      const stick = s.stage >= 4 && !reduced && stepNoise(now * 3.3, 21) > 0.72;
      if (!stick) scene.setFace(/** @type {any} */ (person.drawnFace));
      if (!reduced) scene.boil(boilFrame++, 1.8 + s.stage * 0.45 + (frantic ? 1 : 0));
    }
    const hFps = reduced ? 30 : frantic ? 60 : HAND_FPS[s.stage];
    if (now - lastHandDraw >= 1 / hFps - 0.002) {
      lastHandDraw = now;
      director.draw(now, reduced, s.stage);
    }
    if (now > captionUntil && caption.classList.contains('is-on') && !laugh.sounding(now)) {
      caption.classList.remove('is-on');
    }

    // adaptive quality: drop the line-boil filter on slow devices
    if (!lowPower && !reduced) {
      slowFrames = dt > 1 / 28 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
      if (slowFrames > 45) {
        lowPower = true;
        scene.setBoil(false);
        scene.setHandFx(false);
      }
    }
  } else if (s.phase === 'black' && !gigglePlayed && now - s.phaseAt > 1.1) {
    gigglePlayed = true;
    audio.distantGiggle();
  }

  requestAnimationFrame(frame);
}

// first paint
scene.setPose(person.drawPose());
person.update(clock(), 0.016, {
  stage: 0, frantic: false, contacts: [], laughOpen: 0, laughIn: 0, laughing: false, hover: null, reduced, t5: 0,
});
scene.setFace(/** @type {any} */ (person.drawnFace));
requestAnimationFrame(frame);

// for automated checks / debugging
/** @type {any} */ (window).__tickle = { machine, director, person, audio, scene };
