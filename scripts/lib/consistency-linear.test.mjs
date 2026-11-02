// 29am (T-29al-1, Deep Scan rows 1 and 22): the two count scans in consistency.mjs are single passes with a step counter, so no input
// shape costs more than a constant per character. The witness counts STEPS, never a clock. Its differential checks the scanners
// against the patterns they replace (kept below as OLD_*) on ordinary inputs, over the blank class the scanners use.
// Zero-dep (node:test + built-ins); testing.md Determinism: a fixed seed, no clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualityCanaryCount, countAgentTargetLines } from './consistency.mjs';

const OLD_CANARY = /(\d+)[ \t]+quality-canary/;
const OLD_TARGET = /^[ \t]+[a-zA-Z]+:[ \t]+path\./gm;

// A tiny deterministic generator (a fixed seed), so the differential is the same on every run.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = (r, alphabet) => alphabet[Math.floor(r() * alphabet.length)];

test('29am: the canary count is found in a number of steps proportional to the text, on a crafted 100,000-character input', () => {
  const counter = { steps: 0 };
  const n = 100000;
  const desc = '1'.repeat(n) + ' x';
  assert.equal(qualityCanaryCount(desc, counter), null, 'no count in the text');
  assert.ok(counter.steps <= 4 * n, `steps ${counter.steps} must stay within 4 per character (n = ${n})`);
});

test('29am: the agent-target count is found in a number of steps proportional to the text, on a crafted 100,000-character input', () => {
  const counter = { steps: 0 };
  const n = 100000;
  const src = (' '.repeat(n) + 'x\n').repeat(2);
  assert.equal(countAgentTargetLines(src, counter), 0, 'no target line in the text');
  assert.ok(counter.steps <= 4 * src.length, `steps ${counter.steps} must stay within 4 per character (n = ${src.length})`);
});

test('29am: the canary count scan at most doubles its steps when the text doubles', () => {
  const measure = (n) => { const c = { steps: 0 }; qualityCanaryCount('1'.repeat(n) + ' x', c); return c.steps; };
  const a = measure(20000);
  const b = measure(40000);
  assert.ok(b <= 2.2 * a, `steps ${a} -> ${b} must not more than double with the text`);
});

test('29am: ordinary inputs give the answers the replaced patterns gave', () => {
  assert.equal(qualityCanaryCount('9 quality-canary skills'), '9');
  assert.equal(qualityCanaryCount('a quality-canary skills and v12 quality-canary'), '12');
  assert.equal(qualityCanaryCount('12\tquality-canary'), '12');
  assert.equal(qualityCanaryCount('no count here'), null);
  assert.equal(qualityCanaryCount('12quality-canary'), null, 'at least one blank is required');
  assert.equal(countAgentTargetLines('  claude: path.join(x)\n  codex: path.join(y)\nx: path.z\n'), 2);
  assert.equal(countAgentTargetLines('\tfoo:\tpath.a\n'), 1);
});

test('29am: the canary count agrees with the replaced pattern on random inputs (fixed seed)', () => {
  const r = rng(29);
  const alphabet = ['1', '2', '9', '0', ' ', '\t', 'q', 'u', 'a', '-', 'x', 'quality-canary'];
  for (let k = 0; k < 20000; k++) {
    let s = '';
    const len = 1 + Math.floor(r() * 24);
    for (let i = 0; i < len; i++) s += pick(r, alphabet);
    const old = s.match(OLD_CANARY);
    assert.equal(qualityCanaryCount(s), old ? old[1] : null, `input ${JSON.stringify(s)}`);
  }
});

test('29am: the agent-target count agrees with the replaced pattern on random inputs (fixed seed)', () => {
  const r = rng(31);
  const alphabet = ['a', 'b', ':', ' ', '\t', '\n', 'p', 'path.', 'x', '1'];
  for (let k = 0; k < 20000; k++) {
    let s = '';
    const len = 1 + Math.floor(r() * 30);
    for (let i = 0; i < len; i++) s += pick(r, alphabet);
    const old = (s.match(OLD_TARGET) || []).length;
    assert.equal(countAgentTargetLines(s), old, `input ${JSON.stringify(s)}`);
  }
});
