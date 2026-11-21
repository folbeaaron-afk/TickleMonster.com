// Run: node --test tickle/tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { reduce, initialState, createMachine, TIMING, STAGE_CLICKS } from '../js/state.js';

/** Tickle repeatedly with a fixed interval. */
function tickleN(s, n, start, every = 1) {
  let t = start;
  for (let i = 0; i < n; i++) {
    s = reduce(s, { type: 'TICKLE', part: 'stomach', t });
    t += every;
  }
  return { s, t };
}

test('starts idle at stage 0', () => {
  const s = initialState();
  assert.equal(s.phase, 'idle');
  assert.equal(s.stage, 0);
});

test('first tickle enters stage 1', () => {
  const s = reduce(initialState(), { type: 'TICKLE', part: 'neck', t: 1 });
  assert.equal(s.phase, 'play');
  assert.equal(s.stage, 1);
  assert.equal(s.lastPart, 'neck');
});

test('stages advance on click thresholds, one at a time', () => {
  let s = initialState();
  const seen = [];
  let t = 0;
  for (let i = 1; i <= STAGE_CLICKS[4]; i++) {
    t += 1.5;
    s = reduce(s, { type: 'TICKLE', part: 'ribsL', t });
    seen.push(s.stage);
  }
  // clicks 1..9 at 1.5s spacing (dwell always satisfied)
  assert.deepEqual(seen, [1, 1, 2, 2, 2, 3, 3, 3, 4]);
});

test('debounce ignores near-simultaneous taps', () => {
  let s = reduce(initialState(), { type: 'TICKLE', part: 'neck', t: 1 });
  const same = reduce(s, { type: 'TICKLE', part: 'neck', t: 1.05 });
  assert.equal(same, s);
});

test('minimum dwell prevents rushing through stages', () => {
  // Hammer at 4 clicks/sec: stage 2 must wait for 1.2s of stage 1.
  const { s } = tickleN(initialState(), 4, 0, 0.25); // t = 0, .25, .5, .75
  assert.equal(s.stage, 1);
  const s2 = reduce(s, { type: 'TICKLE', part: 'neck', t: 1.25 });
  assert.equal(s2.stage, 2);
});

test('stopping in stage 4 hands control to the hands (stage 5 / auto)', () => {
  let { s, t } = tickleN(initialState(), STAGE_CLICKS[4], 0, 1.5);
  assert.equal(s.stage, 4);
  const last = s.lastTickleAt;
  s = reduce(s, { type: 'TICK', t: last + TIMING.idleToAuto - 0.01 });
  assert.equal(s.stage, 4);
  s = reduce(s, { type: 'TICK', t: last + TIMING.idleToAuto });
  assert.equal(s.stage, 5);
  assert.equal(s.phase, 'auto');
});

test('idle in stages 1-3 never auto-escalates', () => {
  let { s } = tickleN(initialState(), STAGE_CLICKS[3], 0, 1.5);
  assert.equal(s.stage, 3);
  s = reduce(s, { type: 'TICK', t: 1000 });
  assert.equal(s.stage, 3);
  assert.equal(s.phase, 'play');
});

test('clicking all the way also reaches auto, and clicks are then ignored', () => {
  let { s } = tickleN(initialState(), STAGE_CLICKS[5], 0, 1.5);
  assert.equal(s.phase, 'auto');
  const after = reduce(s, { type: 'TICKLE', part: 'neck', t: 999 });
  assert.equal(after, s);
});

test('STOP is unavailable until it appears, then delays, freezes, blacks out, titles', () => {
  let { s } = tickleN(initialState(), STAGE_CLICKS[5], 0, 1.5);
  const t0 = s.phaseAt;
  assert.equal(reduce(s, { type: 'STOP', t: t0 + 1 }), s, 'STOP ignored before visible');
  s = reduce(s, { type: 'TICK', t: t0 + TIMING.stopAppears });
  assert.equal(s.stopVisible, true);
  s = reduce(s, { type: 'STOP', t: t0 + 6 });
  assert.equal(s.phase, 'stopping');
  s = reduce(s, { type: 'TICK', t: t0 + 6 + TIMING.stopGrace - 0.01 });
  assert.equal(s.phase, 'stopping', 'it does not stop immediately');
  s = reduce(s, { type: 'TICK', t: t0 + 6 + TIMING.stopGrace });
  assert.equal(s.phase, 'frozen');
  const tf = s.phaseAt;
  s = reduce(s, { type: 'TICK', t: tf + TIMING.freezeHold });
  assert.equal(s.phase, 'black');
  s = reduce(s, { type: 'TICK', t: s.phaseAt + TIMING.blackHold });
  assert.equal(s.phase, 'title');
  s = reduce(s, { type: 'REPLAY', t: 100 });
  assert.equal(s.phase, 'idle');
  assert.equal(s.stage, 0);
  assert.equal(s.clicks, 0);
});

test('deterministic: identical event logs give identical states', () => {
  const log = [];
  let t = 0;
  for (let i = 0; i < 20; i++) {
    t += 0.3 + (i % 3) * 0.4;
    log.push({ type: 'TICKLE', part: ['neck', 'ribsL', 'stomach'][i % 3], t });
    log.push({ type: 'TICK', t: t + 0.1 });
  }
  const run = () => log.reduce(reduce, initialState());
  assert.deepEqual(run(), run());
});

test('createMachine notifies only on change', () => {
  const m = createMachine();
  let calls = 0;
  m.subscribe(() => calls++);
  m.dispatch({ type: 'TICK', t: 1 });
  assert.equal(calls, 0);
  m.dispatch({ type: 'TICKLE', part: 'neck', t: 2 });
  assert.equal(calls, 1);
});

/* ---------- the hidden ending ---------- */

function toAuto() {
  const { s } = tickleN(initialState(), STAGE_CLICKS[5], 0, 1.5);
  return s;
}

test('holding their hand before stage 3 does nothing', () => {
  let s = reduce(initialState(), { type: 'TICKLE', part: 'neck', t: 1 });
  const same = reduce(s, { type: 'HOLD_START', t: 2 });
  assert.equal(same, s);
});

test('holding their hand long enough in stage 5 lets them cry, then go calm', () => {
  let s = toAuto();
  const t0 = s.phaseAt + 1;
  s = reduce(s, { type: 'HOLD_START', t: t0 });
  assert.equal(s.holdingSince, t0);
  s = reduce(s, { type: 'TICK', t: t0 + TIMING.holdToCure - 0.01 });
  assert.equal(s.phase, 'auto');
  s = reduce(s, { type: 'TICK', t: t0 + TIMING.holdToCure });
  assert.equal(s.phase, 'crying');
  assert.equal(s.stopVisible, false);
  s = reduce(s, { type: 'TICK', t: s.phaseAt + TIMING.cryTime });
  assert.equal(s.phase, 'calm');
  s = reduce(s, { type: 'REPLAY', t: 500 });
  assert.equal(s.phase, 'idle');
});

test('letting go resets the hold', () => {
  let s = toAuto();
  const t0 = s.phaseAt + 1;
  s = reduce(s, { type: 'HOLD_START', t: t0 });
  s = reduce(s, { type: 'HOLD_END', t: t0 + 2 });
  s = reduce(s, { type: 'HOLD_START', t: t0 + 2.5 });
  s = reduce(s, { type: 'TICK', t: t0 + TIMING.holdToCure + 0.1 });
  assert.equal(s.phase, 'auto', 'the earlier hold does not count');
  s = reduce(s, { type: 'TICK', t: t0 + 2.5 + TIMING.holdToCure });
  assert.equal(s.phase, 'crying');
});

test('it still works after STOP is pressed, during the grace period', () => {
  let s = toAuto();
  s = reduce(s, { type: 'TICK', t: s.phaseAt + TIMING.stopAppears });
  const t0 = s.phaseAt + 5;
  s = reduce(s, { type: 'HOLD_START', t: t0 });
  s = reduce(s, { type: 'STOP', t: t0 + 1.5 });
  assert.equal(s.phase, 'stopping');
  s = reduce(s, { type: 'TICK', t: t0 + TIMING.holdToCure });
  assert.equal(s.phase, 'crying');
});

/* ---------- spread = relief ---------- */
import { incomingGeneration, infect, unwell, shareUrl, carrierLabel } from '../js/spread.js';

test('generation comes from the link, safely', () => {
  assert.equal(incomingGeneration(''), 0);
  assert.equal(incomingGeneration('?g=3'), 3);
  assert.equal(incomingGeneration('?g=-4'), 0);
  assert.equal(incomingGeneration('?g=abc'), 0);
  assert.equal(incomingGeneration('?g=99999999'), 99999);
});

test('becoming a carrier, passing it on, finding the other way out', () => {
  const c = infect(null, 3);
  assert.deepEqual(c, { gen: 4, shared: false, cured: false });
  assert.equal(unwell(c), true);
  assert.equal(infect(c, 9), c, 'already a carrier: same link position');
  assert.equal(unwell({ ...c, shared: true }), false);
  assert.equal(unwell({ ...c, cured: true }), false);
  assert.equal(shareUrl({ origin: 'https://ticklemonster.com', pathname: '/tickle/' }, 4), 'https://ticklemonster.com/tickle/?g=4');
  assert.equal(carrierLabel(4), 'carrier no. 0004');
});
