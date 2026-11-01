// 29q c36 item 3.1: the ratchet census of raw reads (read-census.mjs). The live tree must match ALLOWLIST exactly, and the census
// itself must be proven able to fail: a planted raw read, a stale allowance and a stale entry are each caught in a temp tree.
// Hermetic: every fixture is a temp directory under os.tmpdir(); the live tree is read, never written. Zero-dep (node:test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { violations, rawReadSites, ALLOWLIST, totalSites } from './read-census.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function tempTree(t, files) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-census-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text, 'utf8');
  }
  return root;
}

test('every raw file read under scripts/ is on the allowlist, at its exact count', () => {
  const v = violations(repo, ALLOWLIST);
  assert.deepEqual(v, [], `the census against the live tree:\n${v.join('\n')}`);
});

test('the census fails on a raw read in a file with no allowlist entry', (t) => {
  const root = tempTree(t, { 'scripts/planted.mjs': "import fs from 'node:fs';\nconst text = fs.readFileSync(process.argv[2], 'utf8');\n" });
  const v = violations(root, {});
  assert.equal(v.length, 1, 'one planted read, one violation');
  assert.match(v[0], /scripts\/planted\.mjs: 1 raw read\(s\) at line 2 and no allowlist entry/);
});

test('the census fails when a file holds more reads than its allowance (no silent growth)', (t) => {
  const root = tempTree(t, { 'scripts/grow.mjs': 'const a = readFile(x);\nconst b = readFileSync(y);\n' });
  const v = violations(root, { 'scripts/grow.mjs': { count: 1, reason: 'test' } });
  assert.equal(v.length, 1);
  assert.match(v[0], /2 raw read\(s\), the allowlist permits 1/);
});

test('the census fails on a stale allowance: a count that dropped must be lowered in the same change', (t) => {
  const root = tempTree(t, { 'scripts/shrink.mjs': 'const a = readFileSync(x);\n' });
  const v = violations(root, { 'scripts/shrink.mjs': { count: 2, reason: 'test' } });
  assert.equal(v.length, 1);
  assert.match(v[0], /allowlist still says 2/);
});

test('the census fails on an entry whose file no longer reads raw: the entry must go (the ratchet)', (t) => {
  const root = tempTree(t, { 'scripts/clean.mjs': 'const a = readRepoFileBounded(x, root, 1);\n' });
  const v = violations(root, { 'scripts/clean.mjs': { count: 1, reason: 'test' } });
  assert.equal(v.length, 1);
  assert.match(v[0], /none remain — remove the entry/);
});

test('a comment line and a test file are not census sites', (t) => {
  const root = tempTree(t, {
    'scripts/commented.mjs': '// fs.readFileSync(x) is the call this file no longer makes\n * readFile(y) in a block comment\n',
    'scripts/thing.test.mjs': 'const a = readFileSync(x);\n',
  });
  assert.deepEqual(rawReadSites(root), {});
  assert.deepEqual(violations(root, {}), []);
});

test('the census reads the live tree and reports a total that matches its own per-file sites', () => {
  const sites = rawReadSites(repo);
  const sum = Object.values(sites).reduce((n, s) => n + s.count, 0);
  assert.equal(totalSites(repo), sum, 'the total is the sum of the per-file counts');
  assert.ok(sum > 0, 'the live tree still holds raw reads that the census accounts for');
});
