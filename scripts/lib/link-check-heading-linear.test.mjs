// 29am (T-29al-2, Deep Scan rows 4 and 20): the heading scan in link-check.mjs is one pass per line with a step counter. The pattern it
// replaces, kept below as OLD_HEADING, had a lazy body that overlapped its tail, so a long run of blanks inside a heading cost quadratic
// work. The witness counts STEPS, never a clock; the differential checks the scanner against OLD_HEADING on random lines (fixed seed).
// Zero-dep (node:test + built-ins); testing.md Determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headingTexts } from './link-check.mjs';

const OLD_HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

test('29am: a heading holding a long run of blanks is scanned in a number of steps proportional to the text', () => {
  const counter = { steps: 0 };
  const n = 100000;
  const text = '# a' + ' '.repeat(n) + 'b\n' + '## ' + '#'.repeat(n) + 'x\n';
  headingTexts(text, counter);
  assert.ok(counter.steps <= 4 * text.length, `steps ${counter.steps} must stay within 4 per character (n = ${text.length})`);
});

test('29am: the heading scan at most doubles its steps when the text doubles', () => {
  const measure = (n) => { const c = { steps: 0 }; headingTexts('# a' + ' '.repeat(n) + 'b', c); return c.steps; };
  const a = measure(20000);
  const b = measure(40000);
  assert.ok(b <= 2.2 * a, `steps ${a} -> ${b} must not more than double with the text`);
});

test('29am: ordinary headings give the bodies the replaced pattern gave', () => {
  assert.deepEqual(headingTexts('# Title\n'), ['Title']);
  assert.deepEqual(headingTexts('## Two words ##\n'), ['Two words']);
  assert.deepEqual(headingTexts('### a # b #  \n'), ['a # b']);
  assert.deepEqual(headingTexts('####### seven\n'), [], 'seven hashes is not a heading');
  assert.deepEqual(headingTexts('#nospace\n'), [], 'a blank is required after the hashes');
  assert.deepEqual(headingTexts('plain\n# one\ntext\n## two\n'), ['one', 'two']);
});

test('29am: the heading bodies agree with the replaced pattern on random lines (fixed seed)', () => {
  const r = rng(37);
  const alphabet = ['#', '#', ' ', ' ', '\t', 'a', 'b', '\n', '\r', ' ', ' '];
  for (let k = 0; k < 20000; k++) {
    let s = '';
    const len = 1 + Math.floor(r() * 24);
    for (let i = 0; i < len; i++) s += alphabet[Math.floor(r() * alphabet.length)];
    const old = [...s.matchAll(OLD_HEADING)].map((m) => m[2]);
    assert.deepEqual(headingTexts(s), old, `input ${JSON.stringify(s)}`);
  }
});
