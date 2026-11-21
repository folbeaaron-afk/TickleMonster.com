// Run: node --test 'tickle/tests/*.test.mjs'
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  incomingGeneration, infect, unwell, shareUrl, ordinal, yourLine, totalLine, counter, COUNTER,
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
  assert.deepEqual(c, { gen: 4, shared: false });
  assert.equal(unwell(c), true);
  assert.equal(infect(c, 9), c, 'already a carrier keeps their place in the chain');
  assert.equal(unwell({ ...c, shared: true }), false);
  assert.equal(shareUrl({ origin: 'https://ticklemonster.com' }), 'https://ticklemonster.com/');
});

test('your number and the live total', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 1208].map(ordinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '1,208th']);
  assert.equal(yourLine(1208), 'you’re the 1,208th person to pass it on.');
  assert.equal(totalLine(1), '1 person has it now.');
  assert.equal(totalLine(1540), '1,540 people have it now.');
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
