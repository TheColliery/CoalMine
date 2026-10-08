// The test runner's child spawn plan (CWK-199's class): `node --test` spawns one child per test file; the heap cap
// rides NODE_OPTIONS in the ENV (every per-file child and every process a test itself spawns inherits it) and the
// files run one at a time (--test-concurrency=1). Zone rule: dispatch-transport.md, ninth amendment. Shape of
// CoalTipple's scripts/lib/test-spawn.test.mjs (f1c9bf1) plus the 08b INSPECT M-1 tests: a hung test or a leaked
// handle must END the run (force-exit), and a thread-blocking test must hit a whole-run deadline that fails loudly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testSpawnPlan, HEAP_FLAG, TEST_TIMEOUT_MS, RUN_TIMEOUT_MS, RUN_KILL_SIGNAL } from './test-spawn.mjs';

const ROOM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('test-spawn: the argv runs the files serially, force-exits a finished run, under a finite per-test clock, before the file list, after --test', () => {
  const { args } = testSpawnPlan(['a.test.mjs', 'b.test.mjs'], {});
  assert.deepEqual(args, ['--test', '--test-concurrency=1', '--test-force-exit', `--test-timeout=${TEST_TIMEOUT_MS}`, 'a.test.mjs', 'b.test.mjs']);
});

test('test-spawn: the per-test deadline is a named, finite value above the slowest measured file (47.7 s, 2026-10-08) and not past two minutes', () => {
  assert.ok(Number.isInteger(TEST_TIMEOUT_MS) && TEST_TIMEOUT_MS > 47700 && TEST_TIMEOUT_MS <= 120000, String(TEST_TIMEOUT_MS));
});

test('test-spawn: the whole-run deadline is finite, above the measured serial suite (271 s, 2026-10-08) and inside the gate job timeout (15 min), with a kill signal', () => {
  assert.ok(Number.isInteger(RUN_TIMEOUT_MS) && RUN_TIMEOUT_MS > 271000 && RUN_TIMEOUT_MS < 15 * 60 * 1000, String(RUN_TIMEOUT_MS));
  const plan = testSpawnPlan(['a.test.mjs'], {});
  assert.equal(plan.timeout, RUN_TIMEOUT_MS);
  assert.equal(plan.killSignal, RUN_KILL_SIGNAL);
  assert.equal(RUN_KILL_SIGNAL, 'SIGKILL');
});

test('test-spawn: the env carries the heap cap for every per-file child and for the processes a test spawns, and the argv does not', () => {
  const { env, args } = testSpawnPlan(['a.test.mjs'], { PATH: '/bin' });
  assert.equal(env.NODE_OPTIONS, HEAP_FLAG);
  assert.equal(HEAP_FLAG, '--max-old-space-size=2048');
  assert.equal(env.PATH, '/bin', 'the rest of the env passes through');
  assert.ok(!args.some((a) => a.includes('max-old-space-size')), 'a flag on the argv would not reach a process a test itself spawns (measured 4288 MB vs 2240 MB with the env form, Node 24.19)');
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

test('test-spawn: scripts/test.mjs spawns its child with the plan argv, env, deadline and kill signal, and a deadline is a named FAIL (the wiring, not just the builder)', () => {
  const src = fs.readFileSync(path.join(ROOM, 'scripts', 'test.mjs'), 'utf8');
  assert.match(src, /testSpawnPlan\(TESTS, process\.env\)/);
  assert.match(src, /spawnSync\(process\.execPath, plan\.args, \{[^}]*env: plan\.env[^}]*timeout: plan\.timeout[^}]*killSignal: plan\.killSignal/);
  assert.match(src, /if \(r\.error\)[\s\S]*?console\.error\(`FAIL test runner:[\s\S]*?process\.exitCode = 1/);
});

// ---- end to end: the REAL test.mjs and plan, copied into a temp tree whose roster is one planted file ----
// The per-test clock and the whole-run deadline are patched down in the COPY only (3 s and 6 s unless a test says otherwise). Every
// run is bounded by its own 40 s timer that kills the whole tree, so a regression fails this test instead of hanging the suite.
function plant(t, probeSource, testClockMs = 3000) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-testspawn-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  const runner = fs.readFileSync(path.join(ROOM, 'scripts', 'test.mjs'), 'utf8');
  const roster = runner.replace(/const TESTS = \[[\s\S]*?\n\];/, "const TESTS = ['scripts/lib/probe.test.mjs'];");
  assert.notEqual(roster, runner, 'the roster in the copy was replaced');
  fs.writeFileSync(path.join(dir, 'scripts', 'test.mjs'), roster);
  const plan = fs.readFileSync(path.join(ROOM, 'scripts', 'lib', 'test-spawn.mjs'), 'utf8')
    .replace('TEST_TIMEOUT_MS = 120000', `TEST_TIMEOUT_MS = ${testClockMs}`).replace('RUN_TIMEOUT_MS = 600000', `RUN_TIMEOUT_MS = ${PLANT_RUN_MS}`);
  fs.writeFileSync(path.join(dir, 'scripts', 'lib', 'test-spawn.mjs'), plan);
  fs.writeFileSync(path.join(dir, 'scripts', 'lib', 'probe.test.mjs'), probeSource);
  return dir;
}

function killTree(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { timeout: 30000 });
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } }
}

function runPlanted(dir) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    // NODE_TEST_CONTEXT is set inside a node --test file child; inherited, the nested runner would behave as a child and run nothing.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, ['scripts/test.mjs'], { cwd: dir, env, detached: process.platform !== 'win32' });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    let bound = false;
    const timer = setTimeout(() => { bound = true; killTree(child); }, 40000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, bound, out, s: (Date.now() - t0) / 1000 }); });
  });
}

test('test-spawn (run): a test that awaits forever with a live interval FAILS and the run ENDS (08b INSPECT M-1, shape R2)', async (t) => {
  const dir = plant(t, "import test from 'node:test';\ntest('awaits forever', () => new Promise(() => { setInterval(() => {}, 1000); }));\n");
  const r = await runPlanted(dir);
  assert.equal(r.bound, false, 'the run did not end by itself\n' + r.out.slice(-400));
  assert.notEqual(r.code, 0, 'the hung test is a failure, not a pass');
  assert.ok(r.s < 30, String(r.s));
});

test('test-spawn (run): a file that leaks a handle at its top level while its one test passes ENDS the run, green (08b INSPECT M-1, shape R3)', async (t) => {
  const dir = plant(t, "import test from 'node:test';\nsetInterval(() => {}, 1000);\ntest('passes', () => {});\n");
  const r = await runPlanted(dir);
  assert.equal(r.bound, false, 'the run did not end by itself\n' + r.out.slice(-400));
  assert.equal(r.code, 0, r.out.slice(-400));
});

// Why this fixture's per-test clock is LONGER than the deadline (08b bounce 2, CI run 37724484940): before Node 24.0.0 --test-timeout
// applied per test EXECUTION, which on our reading of the CI log includes the FILE ("test_runner: improve --test-timeout to be per test", nodejs/node #57672, listed under Notable
// Changes in CHANGELOG_V24 and in neither CHANGELOG_V22 nor CHANGELOG_V23; the CLI docs say "subtests inherit this value from their
// parent"), so on Node 22 a 3 s clock cancelled the thread-blocked file at 3 s ("failureType: 'testTimeoutFailure'" on probe.test.mjs,
// cancelled 1), before the 6 s deadline could fire, and no FAIL line was printed. With the clock at 60 s the deadline is the first
// clock to fire on both lines, so the backstop branch is tested on Node 22 and on Node 24 alike.
const PLANT_RUN_MS = 6000;
const BACKSTOP_TEST_CLOCK_MS = 60000;
test('test-spawn (run): a test that blocks its thread past the whole-run deadline is a named FAIL and a non-zero exit, never a pass (08b INSPECT M-1 backstop)', async (t) => {
  assert.ok(BACKSTOP_TEST_CLOCK_MS > PLANT_RUN_MS, 'the deadline must be the first clock to fire in this fixture');
  const dir = plant(t, "import test from 'node:test';\nimport fs from 'node:fs';\ntest('blocks the thread', () => { fs.writeFileSync('child.pid', String(process.pid)); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000); });\n", BACKSTOP_TEST_CLOCK_MS);
  const r = await runPlanted(dir);
  try { process.kill(Number(fs.readFileSync(path.join(dir, 'child.pid'), 'utf8')), 'SIGKILL'); } catch { /* gone, or never written */ }
  assert.equal(r.bound, false, 'the run did not end by itself\n' + r.out.slice(-400));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /^FAIL test runner: the run did not finish \(ETIMEDOUT\)/m);
});
