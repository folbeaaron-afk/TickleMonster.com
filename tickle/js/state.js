// @ts-check
/**
 * Deterministic escalation state machine.
 *
 * Pure: (state, event) -> state. No timers, no DOM, no randomness.
 * Time is passed in on every event (seconds), so the same sequence of
 * events always produces the same sequence of states. The render loop
 * dispatches TICK every frame; user input dispatches TICKLE / STOP / REPLAY.
 *
 * Phases:
 *   idle     - nothing has happened yet. "GO AHEAD. THEY'RE TICKLISH."
 *   play     - stages 1-4, driven by the visitor's clicks
 *   auto     - stage 5. The visitor's clicks are ignored. The hands continue.
 *   stopping - STOP was pressed. It doesn't stop. Not yet.
 *   frozen   - everything holds, mid-laugh
 *   black    - cut to black
 *   title    - TICKLE MONSTER + replay
 */

/** Total tickles needed to *reach* stage i. */
export const STAGE_CLICKS = [0, 1, 3, 6, 9, 14];

/** Minimum seconds that stage i must last before stage i+1 may begin. */
export const STAGE_MIN_DWELL = [0, 1.2, 1.8, 2.4, 2.8];

export const TIMING = Object.freeze({
  /** Ignore taps closer together than this (double-fire, touch+mouse). */
  tickleDebounce: 0.12,
  /** In stage 4, if the visitor stops for this long, the hands take over. */
  idleToAuto: 2.2,
  /** Seconds into stage 5 before the STOP button appears. */
  stopAppears: 4.5,
  /** STOP is ignored for this long. */
  stopGrace: 2.6,
  /** Hold the frozen frame. */
  freezeHold: 1.3,
  /** Hold black before the title. */
  blackHold: 2.4,
});

/** Float tolerance for timer comparisons. */
const EPS = 1e-9;
/** @param {number} elapsed @param {number} limit */
const reached = (elapsed, limit) => elapsed >= limit - EPS;

/** @typedef {'idle'|'play'|'auto'|'stopping'|'frozen'|'black'|'title'} Phase */

/**
 * @typedef {Object} TickleState
 * @property {Phase} phase
 * @property {number} stage       0..5
 * @property {number} clicks      counted tickles
 * @property {number} lastTickleAt
 * @property {number} stageAt     time the current stage began
 * @property {number} phaseAt     time the current phase began
 * @property {boolean} stopVisible
 * @property {string|null} lastPart
 */

/**
 * @typedef {{type:'TICKLE', part:string, t:number}
 *   | {type:'TICK', t:number}
 *   | {type:'STOP', t:number}
 *   | {type:'REPLAY', t:number}} TickleEvent
 */

/** @param {number} [t] @returns {TickleState} */
export function initialState(t = 0) {
  return {
    phase: 'idle',
    stage: 0,
    clicks: 0,
    lastTickleAt: -Infinity,
    stageAt: t,
    phaseAt: t,
    stopVisible: false,
    lastPart: null,
  };
}

/**
 * @param {TickleState} s
 * @param {TickleEvent} ev
 * @returns {TickleState} the same object if nothing changed
 */
export function reduce(s, ev) {
  switch (ev.type) {
    case 'TICKLE': {
      if (s.phase !== 'idle' && s.phase !== 'play') return s;
      if (!reached(ev.t - s.lastTickleAt, TIMING.tickleDebounce)) return s;
      const clicks = s.clicks + 1;
      let stage = s.stage;
      let stageAt = s.stageAt;
      const next = stage + 1;
      const dwellOk = stage === 0 || reached(ev.t - s.stageAt, STAGE_MIN_DWELL[stage]);
      if (next <= 5 && clicks >= STAGE_CLICKS[next] && dwellOk) {
        stage = next;
        stageAt = ev.t;
      }
      if (stage === 5) {
        return { ...s, clicks, stage, stageAt, phase: 'auto', phaseAt: ev.t, lastTickleAt: ev.t, lastPart: ev.part };
      }
      return {
        ...s,
        phase: 'play',
        phaseAt: s.phase === 'idle' ? ev.t : s.phaseAt,
        clicks,
        stage,
        stageAt,
        lastTickleAt: ev.t,
        lastPart: ev.part,
      };
    }

    case 'TICK': {
      const t = ev.t;
      switch (s.phase) {
        case 'play':
          // The moment: the visitor stops. The hands don't.
          if (s.stage === 4 && reached(t - s.lastTickleAt, TIMING.idleToAuto)) {
            return { ...s, stage: 5, stageAt: t, phase: 'auto', phaseAt: t };
          }
          return s;
        case 'auto':
          if (!s.stopVisible && reached(t - s.phaseAt, TIMING.stopAppears)) return { ...s, stopVisible: true };
          return s;
        case 'stopping':
          if (reached(t - s.phaseAt, TIMING.stopGrace)) return { ...s, phase: 'frozen', phaseAt: t };
          return s;
        case 'frozen':
          if (reached(t - s.phaseAt, TIMING.freezeHold)) return { ...s, phase: 'black', phaseAt: t };
          return s;
        case 'black':
          if (reached(t - s.phaseAt, TIMING.blackHold)) return { ...s, phase: 'title', phaseAt: t };
          return s;
        default:
          return s;
      }
    }

    case 'STOP':
      if (s.phase === 'auto' && s.stopVisible) return { ...s, phase: 'stopping', phaseAt: ev.t };
      return s;

    case 'REPLAY':
      if (s.phase === 'title') return initialState(ev.t);
      return s;

    default:
      return s;
  }
}

/**
 * Tiny observable wrapper.
 * @param {number} [t]
 */
export function createMachine(t = 0) {
  let state = initialState(t);
  /** @type {Set<(next: TickleState, prev: TickleState) => void>} */
  const listeners = new Set();
  return {
    get state() {
      return state;
    },
    /** @param {TickleEvent} ev */
    dispatch(ev) {
      const prev = state;
      const next = reduce(prev, ev);
      if (next !== prev) {
        state = next;
        listeners.forEach((fn) => fn(next, prev));
      }
      return next !== prev;
    },
    /** @param {(next: TickleState, prev: TickleState) => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
