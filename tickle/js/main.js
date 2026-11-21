// @ts-check
/**
 * "They're Ticklish" — interactive piece for TICKLE MONSTER.
 * Wires input -> state machine -> hands / person / laugh / audio -> SVG.
 */
import { createMachine } from './state.js?v=202611210941';
import { Scene, PARTS } from './scene.js?v=202611210941';
import { HandDirector } from './hands.js?v=202611210941';
import { Person } from './person.js?v=202611210941';
import { LaughDriver } from './laugh.js?v=202611210941';
import { AudioEngine } from './audio.js?v=202611210941';
import { stepNoise } from './util.js?v=202611210941';
import {
  incomingGeneration, loadCarrier, saveCarrier, infect, unwell, shareUrl, counter,
  markStopped, yourLine, totalLine, loadNumber, saveNumber, loadTotal, saveTotal,
} from './spread.js?v=202611210941';

const SEED = 0x71c4;

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const root = $('tm');
const svg = /** @type {SVGSVGElement} */ (/** @type {unknown} */ ($('tm-scene')));
const headline = $('tm-headline');
const caption = $('tm-caption');
const stopBtn = /** @type {HTMLButtonElement} */ ($('tm-stop'));
const soundBtn = $('tm-sound');
const black = $('tm-black');
const end = $('tm-end');
const replayBtn = $('tm-replay');
const shareBtn = /** @type {HTMLButtonElement} */ ($('tm-share'));
const copyBtn = $('tm-copy');
const linkField = /** @type {HTMLInputElement} */ ($('tm-link'));
const yourEl = $('tm-yours');
const countEl = $('tm-count');
const sub = $('tm-sub');
const spreadLine = $('tm-spread-line');
const spreadSub = $('tm-spread-sub');

/** What the page says to you, stage by stage. It eggs you on. Then it doesn't need you. */
const HEADLINES = [
  'GO AHEAD. THEY’RE TICKLISH.',
  'SEE? KEEP GOING.',
  'KEEP GOING.',
  'A LITTLE MORE.',
  'DON’T STOP.',
  'YOU CAN STOP NOW.',
];

const clock = () => performance.now() / 1000;

/* Always full motion (the calmer mode still exists in the code, switched off). */
const reduced = false;

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
function syncSound() {
  soundBtn.textContent = audio.muted ? 'sound: off' : 'sound: on';
  soundBtn.setAttribute('aria-pressed', String(!audio.muted));
}

let lowPower = false;
scene.setBoil(true);
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
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' && !e.metaKey && !e.ctrlKey && !e.altKey) soundBtn.click();
});
// Sound may only start inside a real user gesture. iPhones count a finger
// *lifting* (touchend / click), not touching down, so listen to all of them
// until the sound is actually running.
for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
  window.addEventListener(type, () => {
    if (!audio.ready) audio.unlock();
  }, { capture: true, passive: true });
}

replayBtn.addEventListener('click', () => {
  audio.unlock();
  const now = clock();
  const prev = machine.state;
  if (machine.dispatch({ type: 'REPLAY', t: now })) onTransition(machine.state, prev, now);
});

/* ---------- pass it on ---------- */
const incoming = incomingGeneration(location.search);
let carrier = loadCarrier();
const TITLE = document.title;
const SHARE_TEXT = 'Go ahead. They’re ticklish.';
let hiddenCount = 0;
let nextGiggle = 0;

function myLink() {
  if (!carrier) carrier = infect(null, incoming);
  return shareUrl(location);
}

function renderSpread() {
  if (!carrier) return;
  linkField.value = myLink();
  if (carrier.shared) {
    spreadLine.textContent = 'better.';
    spreadSub.textContent = 'for now.';
  } else {
    spreadLine.textContent = 'it’s in you now.';
    spreadSub.textContent = 'passing it on helps.';
  }
}

/**
 * "you're the 1,208th person to pass it on." and, once more people have
 * it than that, "1,540 people have it now."
 * If the counter service can't be reached, these lines just don't appear.
 */
let knownTotal = loadTotal();
/** @param {number|null} n */
function noteTotal(n) {
  if (n === null) return;
  knownTotal = Math.max(knownTotal || 0, n);
  saveTotal(knownTotal);
}
// the counter service can be slow: start asking as soon as the page opens
counter('get').then(noteTotal);

async function showNumbers() {
  let mine = loadNumber();
  const render = () => {
    if (mine) {
      yourEl.textContent = yourLine(mine);
      yourEl.hidden = false;
    }
    if (knownTotal !== null && (!mine || knownTotal > mine)) {
      countEl.textContent = totalLine(knownTotal);
      countEl.hidden = false;
    } else {
      countEl.hidden = true; // never show a total smaller than your own number
    }
  };
  if (stopCount && !mine) {
    yourEl.textContent = 'counting…';
    yourEl.hidden = false;
  }
  render();
  if (stopCount) {
    const n = await stopCount;
    if (n) {
      mine = n;
      noteTotal(n);
    } else if (!mine) {
      yourEl.hidden = true; // couldn't get a number this time; try again next STOP
    }
    render();
  }
  noteTotal(await counter('get'));
  render();
}

function passedOn() {
  if (!carrier) return;
  carrier = { ...carrier, shared: true };
  saveCarrier(carrier);
  renderSpread();
  document.title = TITLE;
}

/** Pressing STOP adds you to the worldwide count (once per browser). */
let stopCount = /** @type {Promise<number|null>|null} */ (null);
function countStop() {
  // one number per browser; browsers that pressed STOP before numbers
  // existed get theirs now
  if (loadNumber()) return;
  markStopped();
  stopCount = counter('hit').then((n) => {
    if (n) saveNumber(n);
    return n;
  });
}

copyBtn.addEventListener('click', async () => {
  const url = myLink();
  let ok = false;
  try {
    await navigator.clipboard.writeText(url);
    ok = true;
  } catch {
    // older browsers: select the field so a long-press / Ctrl+C works
    linkField.focus();
    linkField.select();
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
  }
  copyBtn.textContent = ok ? 'copied ✓' : 'press and hold to copy';
  setTimeout(() => (copyBtn.textContent = 'copy link'), 2600);
  if (ok) passedOn();
});
linkField.addEventListener('focus', () => linkField.select());

if (navigator.share) shareBtn.hidden = false;
shareBtn.addEventListener('click', async () => {
  try {
    await navigator.share({ text: SHARE_TEXT, url: myLink() });
    passedOn();
  } catch {
    /* cancelled: still in you */
  }
});

// while it's in you: when you look away, the tab laughs
document.addEventListener('visibilitychange', () => {
  if (document.hidden && unwell(carrier)) {
    hiddenCount = Math.min(hiddenCount + 1, 6);
    document.title = 'ha'.repeat(hiddenCount);
  } else {
    document.title = TITLE;
  }
});
if (unwell(carrier)) sub.textContent = '(you never passed it on.)';

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
    setHeadline(HEADLINES[s.stage]);
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
        carrier = infect(carrier, incoming);
        saveCarrier(carrier);
        renderSpread();
        end.hidden = false;
        nextGiggle = now + 25;
        showNumbers();
        copyBtn.focus({ preventScroll: true });
        break;
      case 'stopping':
        countStop();
        stopBtn.classList.add('is-pressed');
        stopBtn.setAttribute('aria-disabled', 'true');
        setHeadline('');
        break;
    }
  }
  if (s.stopVisible && !prev.stopVisible) stopBtn.hidden = false;
  audio.setStage(s.phase === 'stopping' ? 6 : s.stage);
}

/** Type the new line in, replacing the old one. @param {string} text */
function setHeadline(text) {
  if (headline.textContent === text) return;
  headline.textContent = text;
  headline.classList.remove('is-new');
  void headline.offsetWidth; // restart the animation
  headline.classList.add('is-new');
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
  countEl.hidden = true;
  yourEl.hidden = true;
  stopCount = null;
  setHeadline(HEADLINES[0]);
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
  } else if (s.phase === 'title' && unwell(carrier) && now > nextGiggle) {
    // still in you: every so often, somewhere, a giggle
    nextGiggle = now + 28 + ((boilFrame * 7919) % 25);
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
