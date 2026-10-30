// Link extraction stays linear on unclosed brackets (28c round 2, fix 2). The label part of
// LINK_RE used to run across further `[` openers, so each unclosed `[` scanned to the end of the
// input: about 1.2e9 steps on a 48 KB run of openers. The label now stops at the next `[`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLinks } from './link-check.mjs';

const SIZE = 48 * 1024;
const BUDGET_MS = 50;

test('extractLinks is linear: 48 KB of unclosed brackets scans in under 50 ms (best of 3 runs)', () => {
  const input = '['.repeat(SIZE);
  const times = [];
  for (let i = 0; i < 3; i++) {
    const t0 = process.hrtime.bigint();
    extractLinks(input);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  assert.ok(Math.min(...times) < BUDGET_MS, `best of 3 = ${Math.min(...times).toFixed(1)} ms, budget ${BUDGET_MS} ms`);
});

// 29b: an empty label and an open target repeated with no closing parenthesis. The target class ran across the
// next brackets, so each `[` scanned to the end of the input.
test('extractLinks is linear: 48 KB of repeated empty links with no closing parenthesis scans in under 50 ms (best of 3 runs)', () => {
  const input = '[]('.repeat(SIZE / 3);
  const times = [];
  for (let i = 0; i < 3; i++) {
    const t0 = process.hrtime.bigint();
    extractLinks(input);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  assert.ok(Math.min(...times) < BUDGET_MS, `best of 3 = ${Math.min(...times).toFixed(1)} ms, budget ${BUDGET_MS} ms`);
});

test('extractLinks still finds an ordinary link and one after an unclosed bracket', () => {
  const links = extractLinks('see [docs](./a.md) and [x\n\nlater [y](./b.md)');
  assert.deepEqual(links.map((l) => l.target), ['./a.md', './b.md']);
});
