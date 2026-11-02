// 29am (T-29al-9): the JS single-quoted string scan in config-keys.mjs is one pass with a step counter. The pattern it
// replaces, kept below as OLD_JS_STRING, restarted at every apostrophe of an unterminated string of escaped apostrophes, so the work was
// quadratic. The witness counts STEPS, never a clock. The differential checks the scanner against OLD_JS_STRING on random inputs (fixed seed).
// Zero-dep (node:test + built-ins); testing.md Determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsStringBodies } from './config-keys.mjs';

const BS = String.fromCharCode(92);
const OLD_JS_STRING = new RegExp("'((?:" + BS + BS + ".|[^'" + BS + BS + "])*)'", 'g');

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

test('29am: an unterminated string of escaped apostrophes is scanned in a number of steps proportional to the text', () => {
  const counter = { steps: 0 };
  const region = "'" + (BS + "'").repeat(50000);
  assert.deepEqual(jsStringBodies(region, counter), [], 'no closed literal in the text');
  assert.ok(counter.steps <= 4 * region.length, `steps ${counter.steps} must stay within 4 per character (n = ${region.length})`);
});

test('29am: the escaped-string scan at most doubles its steps when the text doubles', () => {
  const measure = (n) => { const c = { steps: 0 }; jsStringBodies("'" + (BS + "'").repeat(n), c); return c.steps; };
  const a = measure(20000);
  const b = measure(40000);
  assert.ok(b <= 2.2 * a, `steps ${a} -> ${b} must not more than double with the text`);
});

test('29am: ordinary literals give the bodies the replaced pattern gave', () => {
  assert.deepEqual(jsStringBodies("x = 'alpha' + 'beta'"), ['alpha', 'beta']);
  assert.deepEqual(jsStringBodies("y = 'it" + BS + "'s' + 'z'"), ["it" + BS + "'s", 'z']);
  assert.deepEqual(jsStringBodies("'a" + BS + BS + "'"), ['a' + BS + BS], 'an escaped backslash does not escape the closing apostrophe');
  assert.deepEqual(jsStringBodies("'unclosed"), []);
});

test('29am: the escaped-string bodies agree with the replaced pattern on random inputs (fixed seed)', () => {
  const r = rng(41);
  const alphabet = ["'", "'", BS, BS, 'a', ' ', '\n', '\r', String.fromCharCode(0x2028), String.fromCharCode(0x2029)];
  for (let k = 0; k < 20000; k++) {
    let s = '';
    const len = 1 + Math.floor(r() * 24);
    for (let i = 0; i < len; i++) s += alphabet[Math.floor(r() * alphabet.length)];
    const old = [...s.matchAll(OLD_JS_STRING)].map((m) => m[1]);
    assert.deepEqual(jsStringBodies(s), old, `input ${JSON.stringify(s)}`);
  }
});
