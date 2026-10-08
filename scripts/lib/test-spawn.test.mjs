// The test runner's child spawn plan (CWK-199's class): `node --test` spawns one child per test file, so the heap cap
// rides NODE_OPTIONS in the ENV (every descendant inherits it; a flag on the argv would cap the runner alone) and the
// files run one at a time (--test-concurrency=1). Zone rule: dispatch-transport.md, ninth amendment. Same shape as
// CoalTipple's scripts/lib/test-spawn.test.mjs (f1c9bf1).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testSpawnPlan, HEAP_FLAG, TEST_TIMEOUT_MS } from './test-spawn.mjs';

const ROOM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('test-spawn: the argv runs the files serially under a finite per-test clock, before the file list, after --test', () => {
  const { args } = testSpawnPlan(['a.test.mjs', 'b.test.mjs'], {});
  assert.deepEqual(args, ['--test', '--test-concurrency=1', `--test-timeout=${TEST_TIMEOUT_MS}`, 'a.test.mjs', 'b.test.mjs']);
});

test('test-spawn: the per-test deadline is a named, finite value above the slowest measured file (47.7 s, 2026-10-08) and not past two minutes', () => {
  assert.ok(Number.isInteger(TEST_TIMEOUT_MS) && TEST_TIMEOUT_MS > 47700 && TEST_TIMEOUT_MS <= 120000, String(TEST_TIMEOUT_MS));
});

test('test-spawn: the env carries the heap cap for every per-file child, and the argv does not', () => {
  const { env, args } = testSpawnPlan(['a.test.mjs'], { PATH: '/bin' });
  assert.equal(env.NODE_OPTIONS, HEAP_FLAG);
  assert.equal(HEAP_FLAG, '--max-old-space-size=2048');
  assert.equal(env.PATH, '/bin', 'the rest of the env passes through');
  assert.ok(!args.some((a) => a.includes('max-old-space-size')), 'a heap flag on the argv would cap the runner and none of its file children');
});

test('test-spawn: a caller NODE_OPTIONS without a heap flag is kept and the cap is appended', () => {
  const { env } = testSpawnPlan(['a.test.mjs'], { NODE_OPTIONS: '--no-warnings' });
  assert.equal(env.NODE_OPTIONS, '--no-warnings ' + HEAP_FLAG);
});

test('test-spawn: a caller heap flag stays as the caller set it (their cap, never clobbered, never doubled)', () => {
  const { env } = testSpawnPlan(['a.test.mjs'], { NODE_OPTIONS: '--max-old-space-size=1024 --no-warnings' });
  assert.equal(env.NODE_OPTIONS, '--max-old-space-size=1024 --no-warnings');
});

test('test-spawn: the base env is not mutated', () => {
  const base = { NODE_OPTIONS: '--no-warnings' };
  testSpawnPlan(['a.test.mjs'], base);
  assert.deepEqual(base, { NODE_OPTIONS: '--no-warnings' });
});

test('test-spawn: scripts/test.mjs spawns its child with the plan argv and env (the wiring, not just the builder)', () => {
  const src = fs.readFileSync(path.join(ROOM, 'scripts', 'test.mjs'), 'utf8');
  assert.match(src, /testSpawnPlan\(TESTS, process\.env\)/);
  assert.match(src, /spawnSync\(process\.execPath, plan\.args, \{[^}]*env: plan\.env/);
});
