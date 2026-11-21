// Run: node --test 'tickle/tests/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  incomingGeneration, infect, unwell, shareUrl, carrierLabel, countLine, counter, COUNTER,
} from '../js/spread.js';

test('generation comes from the link, safely', () => {
  assert.equal(incomingGeneration(''), 0);
  assert.equal(incomingGeneration('?g=3'), 3);
  assert.equal(incomingGeneration('?g=-4'), 0);
  assert.equal(incomingGeneration('?g=abc'), 0);
  assert.equal(incomingGeneration('?g=99999999'), 99999);
});

test('becoming a carrier and passing it on', () => {
  const c = infect(null, 3);
  assert.deepEqual(c, { gen: 4, shared: false, counted: false });
  assert.equal(unwell(c), true);
  assert.equal(infect(c, 9), c, 'already a carrier keeps their place in the chain');
  assert.equal(unwell({ ...c, shared: true }), false);
  assert.equal(shareUrl({ origin: 'https://ticklemonster.com', pathname: '/tickle/' }, 4), 'https://ticklemonster.com/tickle/?g=4');
  assert.equal(carrierLabel(4), 'carrier no. 0004');
});

test('count wording', () => {
  assert.equal(countLine(0), 'nobody has passed it on yet.');
  assert.equal(countLine(1), '1 person has passed it on.');
  assert.equal(countLine(12345), '12,345 people have passed it on.');
});

test('counter: reads, adds, and fails quietly', async () => {
  const calls = [];
  const ok = (value) => async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ value }) };
  };
  assert.equal(await counter('get', ok(41)), 41);
  assert.equal(await counter('hit', ok(42)), 42);
  assert.deepEqual(calls, [
    `${COUNTER.base}/get/${COUNTER.namespace}/${COUNTER.key}`,
    `${COUNTER.base}/hit/${COUNTER.namespace}/${COUNTER.key}`,
  ]);
  const notFound = async () => ({ ok: false, status: 404, json: async () => ({}) });
  assert.equal(await counter('get', notFound), 0, 'no key yet means nobody yet');
  const broken = async () => { throw new Error('offline'); };
  assert.equal(await counter('get', broken), null);
  const junk = async () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) });
  assert.equal(await counter('hit', junk), null);
});
