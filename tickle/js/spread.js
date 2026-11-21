// @ts-check
/**
 * "Spread = relief."
 *
 * Every link a visitor passes on carries a generation number (?g=N): how
 * many people the laugh has passed through to get here. Whoever opens it
 * becomes carrier N+1. Reaching the end makes this browser a carrier; it
 * stays "unwell" (a faint giggle now and then, the tab title laughing when
 * you look away) until the visitor passes it on. Then: "better. for now."
 *
 * Static on purpose: works on any host with no server. A shared counter
 * can be added later by pointing SPREAD_ENDPOINT at a tiny API.
 */

const KEY = 'tm-ticklish-carrier';

/** Future: a URL that counts carriers. null = off. */
export const SPREAD_ENDPOINT = null;

/**
 * @typedef {Object} Carrier
 * @property {number} gen     their place in the chain (1 = nobody sent it to them)
 * @property {boolean} shared passed it on at least once
 * @property {boolean} cured  found the other way out
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
    if (v && typeof v.gen === 'number') return { gen: v.gen, shared: !!v.shared, cured: !!v.cured };
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
  if (existing && !existing.cured) return existing;
  return { gen: incoming + 1, shared: existing ? existing.shared : false, cured: false };
}

/** Is it still in them? @param {Carrier|null} c */
export const unwell = (c) => !!c && !c.shared && !c.cured;

/** The link to pass on. @param {{origin: string, pathname: string}} loc @param {number} gen */
export const shareUrl = (loc, gen) => `${loc.origin}${loc.pathname}?g=${gen}`;

/** @param {number} n */
export const carrierLabel = (n) => `carrier no. ${String(n).padStart(4, '0')}`;
