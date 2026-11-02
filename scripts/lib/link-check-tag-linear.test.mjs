// 29am bounce F2 (T-29al-2, the HTML tag pattern the ticket names): the tag strip in link-check.mjs is one pass with a step counter. The
// pattern it replaces, kept below as OLD_HTML_TAG, scanned to the end of the text from every unclosed opening bracket, so a text of
// many opening brackets and no closing one cost quadratic work. The witness counts STEPS, never a clock. The differential checks the
// scanner against OLD_HTML_TAG on random inputs (fixed seed). Zero-dep (node:test + built-ins); testing.md Determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripHtmlTags } from './link-check.mjs';

const OLD_HTML_TAG = /<\/?[a-z][^>]*>/gi;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

test('29am: a text of many unclosed opening brackets is scanned in a number of steps proportional to the text', () => {
  const counter = { steps: 0 };
  const text = '<a'.repeat(50000);
  assert.equal(stripHtmlTags(text, counter), text, 'no closed tag, so nothing is removed');
  assert.ok(counter.steps <= 4 * text.length, `steps ${counter.steps} must stay within 4 per character (n = ${text.length})`);
});

test('29am: the tag strip at most doubles its steps when the text doubles', () => {
  const measure = (n) => { const c = { steps: 0 }; stripHtmlTags('<a'.repeat(n), c); return c.steps; };
  const a = measure(20000);
  const b = measure(40000);
  assert.ok(b <= 2.2 * a, `steps ${a} -> ${b} must not more than double with the text`);
});

test('29am: ordinary text loses exactly its tags, the way the replaced pattern removed them', () => {
  assert.equal(stripHtmlTags('<b>bold</b> x'), 'bold x');
  assert.equal(stripHtmlTags('a <BR/> b'), 'a  b');
  assert.equal(stripHtmlTags('1 < 2 and 3 > 2'), '1 < 2 and 3 > 2', 'a bracket followed by a blank is not a tag');
  assert.equal(stripHtmlTags('<a href="x>y">z</a>'), 'y">z', 'a tag ends at the first closing bracket, as the pattern ends it');
});

test('29am: the tag strip agrees with the replaced pattern on random inputs (fixed seed)', () => {
  const r = rng(43);
  const alphabet = ['<', '<', '>', '/', 'a', 'B', ' ', '\n', 'x', '1'];
  for (let k = 0; k < 20000; k++) {
    let s = '';
    const len = 1 + Math.floor(r() * 24);
    for (let i = 0; i < len; i++) s += alphabet[Math.floor(r() * alphabet.length)];
    assert.equal(stripHtmlTags(s), s.replace(OLD_HTML_TAG, ''), `input ${JSON.stringify(s)}`);
  }
});
