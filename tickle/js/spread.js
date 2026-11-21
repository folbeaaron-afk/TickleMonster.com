// @ts-check
/**
 * "Pass it on."
 *
 * Every link a visitor passes on carries a generation number (?g=N): how
 * many people the laugh has passed through to get here. Whoever opens it
 * becomes carrier N+1. Reaching the end makes this browser a carrier; it
 * stays "unwell" (a faint giggle now and then, the tab title laughing when
 * you look away) until the visitor passes it on.
 *
 * The total number of people who have passed it on is kept by a free,
 * public counter service (no accounts, no personal data: just one number).
 * If that service is unreachable the count simply isn't shown.
 */

const KEY = 'tm-ticklish-carrier';

/** The shared counter. Swap for your own endpoint any time. */
export const COUNTER = Object.freeze({
  base: 'https://abacus.jasoncameron.dev',
  namespace: 'ticklemonster-com',
  key: 'passed-on',
});

/**
 * @typedef {Object} Carrier
 * @property {number} gen      their place in the chain (1 = nobody sent it to them)
 * @property {boolean} shared  passed it on at least once
 * @property {boolean} counted already added to the worldwide count
 */

/** The generation in an incoming link, or 0. @param {string} search */
export function incomingGeneration(search) {
  const raw = new URLSearchParams(search).get('g');
  const g = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(g) && g > 0 ? Math.min(g, 99999) : 0;
}

/** @returns {Carrier|null} */
export function loadCarrier() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && typeof v.gen === 'number') return { gen: v.gen, shared: !!v.shared, counted: !!v.counted };
  } catch {
    /* private mode or junk: treat as new */
  }
  return null;
}

/** @param {Carrier} c */
export function saveCarrier(c) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* fine: it just won't be remembered */
  }
}

/**
 * Become a carrier (or stay one).
 * @param {Carrier|null} existing @param {number} incoming
 * @returns {Carrier}
 */
export function infect(existing, incoming) {
  return existing || { gen: incoming + 1, shared: false, counted: false };
}

/** Is it still in them? @param {Carrier|null} c */
export const unwell = (c) => !!c && !c.shared;

/** The link to pass on. @param {{origin: string, pathname: string}} loc @param {number} gen */
export const shareUrl = (loc, gen) => `${loc.origin}${loc.pathname}?g=${gen}`;

/** @param {number} n */
export const carrierLabel = (n) => `carrier no. ${String(n).padStart(4, '0')}`;

/** How the worldwide count reads. @param {number} n */
export function countLine(n) {
  if (n <= 0) return 'nobody has passed it on yet.';
  if (n === 1) return '1 person has passed it on.';
  return `${n.toLocaleString('en-US')} people have passed it on.`;
}

/**
 * @param {'get'|'hit'} op  read the count, or add one
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<number|null>} null if unavailable
 */
export async function counter(op, fetchFn = fetch) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null;
  try {
    const res = await fetchFn(`${COUNTER.base}/${op}/${COUNTER.namespace}/${COUNTER.key}`, {
      signal: ctrl ? ctrl.signal : undefined,
      cache: 'no-store',
    });
    if (op === 'get' && res.status === 404) return 0; // nobody yet
    if (!res.ok) return null;
    const body = await res.json();
    const v = Number(body && body.value);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
