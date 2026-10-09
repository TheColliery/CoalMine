// The test runner's spawn plan (CWK-199's class, rebuilt at 09a around the canon wave runner scripts/lib/wave-run.mjs, whose own tests are wave-run.test.mjs).
// This file tests the PLAN (the room's numbers and the command line they build), the wiring in scripts/test.mjs, and the runner END TO END: the real test.mjs, plan and wave runner are
// copied into a temp tree whose roster is one planted file. What it holds that the canon's tests do not: the 08b INSPECT M-1 shapes (a hung test or a leaked handle must END the
// run, a thread-blocking test must hit the whole-run deadline and fail loudly) and the TAP-names MUST of common/testing.md (a file that exits 0 before its tests report is a FAILURE
// named VACUOUS, never a pass; measured on Node 24.19, UMB2-026).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testSpawnPlan, plainSpawnPlan, OUTSIDE_WAVES, HEAP_FLAG, HEAP_MB, TEST_TIMEOUT_MS, FILE_CLOCK_MS, RUN_TIMEOUT_MS, OUTER_TIMEOUT_MS, RUN_KILL_SIGNAL, WAVE_RUN } from './test-spawn.mjs';

const ROOM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('test-spawn: the argv is the wave runner with the room numbers, then the file list after --', () => {
  const { args } = testSpawnPlan(['a.test.mjs', 'b.test.mjs'], {});
  assert.deepEqual(args, [WAVE_RUN, '--heap-mb', String(HEAP_MB), '--file-timeout-ms', String(TEST_TIMEOUT_MS), '--deadline-ms', String(RUN_TIMEOUT_MS), '--file-clock-ms', String(FILE_CLOCK_MS), '--', 'a.test.mjs', 'b.test.mjs']);
  assert.equal(WAVE_RUN, 'scripts/lib/wave-run.mjs');
  assert.ok(!args.includes('--serial'), 'files are admitted by the live reading, not run one at a time');
  assert.ok(!args.some((a) => a.startsWith('--test-')), 'the node --test flags are wave-run\'s own business (force-exit, the clock per test), not the plan\'s');
});

test('test-spawn: the per-test clock is a named, finite value above the slowest measured file (47.7 s, 2026-10-08) and not past two minutes', () => {
  assert.ok(Number.isInteger(TEST_TIMEOUT_MS) && TEST_TIMEOUT_MS > 47700 && TEST_TIMEOUT_MS <= 120000, String(TEST_TIMEOUT_MS));
});

test('test-spawn: the file clock is finite, above the slowest serial file and above the per-test clock', () => {
  assert.ok(Number.isInteger(FILE_CLOCK_MS) && FILE_CLOCK_MS > 47700 && FILE_CLOCK_MS > TEST_TIMEOUT_MS && FILE_CLOCK_MS < RUN_TIMEOUT_MS, String(FILE_CLOCK_MS));
});

test('test-spawn: the whole-run deadline is finite, above the measured serial suite (271 s, 2026-10-08), and the outer backstop around wave-run stays inside the gate job timeout (15 min)', () => {
  assert.ok(Number.isInteger(RUN_TIMEOUT_MS) && RUN_TIMEOUT_MS > 271000, String(RUN_TIMEOUT_MS));
  assert.ok(OUTER_TIMEOUT_MS > RUN_TIMEOUT_MS + TEST_TIMEOUT_MS, 'the backstop must outlast the deadline AND the wait wave-run allows its killed children');
  assert.ok(OUTER_TIMEOUT_MS < 15 * 60 * 1000, String(OUTER_TIMEOUT_MS));
  const plan = testSpawnPlan(['a.test.mjs'], {});
  assert.equal(plan.timeout, OUTER_TIMEOUT_MS);
  assert.equal(plan.killSignal, RUN_KILL_SIGNAL);
  assert.equal(RUN_KILL_SIGNAL, 'SIGKILL');
});

test('test-spawn: the heap cap is wave-run\'s --heap-mb (it rides NODE_OPTIONS of every child, so a process a test spawns inherits it), and the base env passes through unchanged', () => {
  assert.equal(HEAP_MB, 2048);
  const base = { PATH: '/bin', NODE_OPTIONS: '--no-warnings' };
  const { env } = testSpawnPlan(['a.test.mjs'], base);
  assert.deepEqual(env, base, 'wave-run adds the cap per child; the plan does not edit NODE_OPTIONS');
  assert.notEqual(env, base);
  assert.deepEqual(base, { PATH: '/bin', NODE_OPTIONS: '--no-warnings' }, 'the base env is not mutated');
});

test('test-spawn: scripts/test.mjs spawns its child with the plan argv, env, backstop and kill signal, and a backstop hit is a named FAIL (the wiring, not just the builder)', () => {
  const src = fs.readFileSync(path.join(ROOM, 'scripts', 'test.mjs'), 'utf8');
  assert.match(src, /testSpawnPlan\(TESTS\.filter\(\(t\) => !OUTSIDE_WAVES\.includes\(t\)\), process\.env\)/);
  assert.match(src, /spawnSync\(process\.execPath, plan\.args, \{[^}]*env: plan\.env[^}]*timeout: plan\.timeout[^}]*killSignal: plan\.killSignal/);
  assert.match(src, /if \(r\.error\)[\s\S]*?console\.error\(`FAIL test runner:[\s\S]*?process\.exitCode = 1/);
});

test('test-spawn: wave-run.test.mjs runs OUTSIDE the waves, on the plain node --test line with the 08b plan (heap cap in the env, serial, force-exit, a clock per test, the deadline)', () => {
  assert.deepEqual(OUTSIDE_WAVES, ['scripts/lib/wave-run.test.mjs']);
  const { args, env, timeout, killSignal } = plainSpawnPlan(OUTSIDE_WAVES, { PATH: '/bin' });
  assert.deepEqual(args, ['--test', '--test-concurrency=1', '--test-force-exit', `--test-timeout=${TEST_TIMEOUT_MS}`, 'scripts/lib/wave-run.test.mjs']);
  assert.equal(env.NODE_OPTIONS, HEAP_FLAG);
  assert.equal(timeout, RUN_TIMEOUT_MS);
  assert.equal(killSignal, RUN_KILL_SIGNAL);
  assert.deepEqual(plainSpawnPlan(['a'], { NODE_OPTIONS: '--max-old-space-size=1024 --no-warnings' }).env.NODE_OPTIONS, '--max-old-space-size=1024 --no-warnings', 'a caller heap flag is kept, never doubled');
  assert.equal(plainSpawnPlan(['a'], { NODE_OPTIONS: '--no-warnings' }).env.NODE_OPTIONS, '--no-warnings ' + HEAP_FLAG);
  const wave = testSpawnPlan(['x'], {});
  assert.ok(!wave.args.includes('scripts/lib/wave-run.test.mjs'));
});

test('test-spawn: scripts/test.mjs keeps the outside-the-waves files out of the wave list and runs them on the plain line, a red in either turning the run red', () => {
  const src = fs.readFileSync(path.join(ROOM, 'scripts', 'test.mjs'), 'utf8');
  assert.match(src, /testSpawnPlan\(TESTS\.filter\(\(t\) => !OUTSIDE_WAVES\.includes\(t\)\), process\.env\)/);
  assert.match(src, /plainSpawnPlan\(outside, process\.env\)/);
  assert.match(src, /process\.exitCode = code;/);
});

// ---- end to end: the REAL test.mjs, plan and wave runner, copied into a temp tree whose roster is one planted file ----
// The per-test clock and the whole-run deadline are patched down in the COPY only (3 s and 6 s unless a test says otherwise). Every
// run is bounded by its own 40 s timer that kills the whole tree, so a regression fails this test instead of hanging the suite.
const COPIED = ['wave-run.mjs', 'machine-reading.mjs', 'stdout-sync.mjs'];
function plant(t, probeSource, testClockMs = 3000) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-testspawn-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  const runner = fs.readFileSync(path.join(ROOM, 'scripts', 'test.mjs'), 'utf8');
  const roster = runner.replace(/const TESTS = \[[\s\S]*?\n\];/, "const TESTS = ['scripts/lib/probe.test.mjs'];");
  assert.notEqual(roster, runner, 'the roster in the copy was replaced');
  fs.writeFileSync(path.join(dir, 'scripts', 'test.mjs'), roster);
  const planSrc = fs.readFileSync(path.join(ROOM, 'scripts', 'lib', 'test-spawn.mjs'), 'utf8');
  const plan = planSrc.replace('TEST_TIMEOUT_MS = 120000', `TEST_TIMEOUT_MS = ${testClockMs}`).replace('RUN_TIMEOUT_MS = 600000', `RUN_TIMEOUT_MS = ${PLANT_RUN_MS}`);
  assert.notEqual(plan, planSrc, 'the numbers in the copy were patched');
  fs.writeFileSync(path.join(dir, 'scripts', 'lib', 'test-spawn.mjs'), plan);
  for (const f of COPIED) fs.copyFileSync(path.join(ROOM, 'scripts', 'lib', f), path.join(dir, 'scripts', 'lib', f));
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
// cancelled 1), before the 6 s deadline could fire. With the clock at 60 s the deadline is the first clock to fire on both lines.
const PLANT_RUN_MS = 6000;
const BACKSTOP_TEST_CLOCK_MS = 60000;
test('test-spawn (run): a test that blocks its thread past the whole-run deadline is a named FAIL and a non-zero exit, never a pass (08b INSPECT M-1 backstop, now wave-run\'s deadline)', async (t) => {
  assert.ok(BACKSTOP_TEST_CLOCK_MS > PLANT_RUN_MS, 'the deadline must be the first clock to fire in this fixture');
  const dir = plant(t, "import test from 'node:test';\nimport fs from 'node:fs';\ntest('blocks the thread', () => { fs.writeFileSync('child.pid', String(process.pid)); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120000); });\n", BACKSTOP_TEST_CLOCK_MS);
  const r = await runPlanted(dir);
  try { process.kill(Number(fs.readFileSync(path.join(dir, 'child.pid'), 'utf8')), 'SIGKILL'); } catch { /* gone, or never written */ }
  assert.equal(r.bound, false, 'the run did not end by itself\n' + r.out.slice(-400));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /killed at the whole-run deadline/, r.out.slice(-600));
  assert.match(r.out, /FAIL/, 'the killed file is a named FAIL');
});

// ---- the TAP-names MUST (common/testing.md, UMB2-026): a gate judges a run by the TAP test names it EXPECTS, never by the exit code and the pass count alone ----
// Measured on Node 24.19, 2026-10-08: a file that calls process.exit(0) before its tests register, or inside a test, exits 0 and prints "# pass 1" like a real pass. wave-run reads
// the TAP: the file's only result line names the FILE itself, where a real pass names a test, so it is VACUOUS, its own status, never a pass, and the run is red.
test('test-spawn (run) TAP-names MUST: a file that exits 0 BEFORE its tests register is VACUOUS and the run exits non-zero', async (t) => {
  const dir = plant(t, "import test from 'node:test';\nprocess.exit(0);\ntest('never registers', () => {});\n");
  const r = await runPlanted(dir);
  assert.equal(r.bound, false, r.out.slice(-400));
  assert.notEqual(r.code, 0, 'a file that never ran its tests must not read green\n' + r.out.slice(-500));
  assert.match(r.out, /VACUOUS/, r.out.slice(-600));
  assert.match(r.out, /probe\.test\.mjs/, 'the vacuous file is named');
});

test('test-spawn (run) TAP-names MUST: a file that exits 0 INSIDE a test is VACUOUS and the run exits non-zero', async (t) => {
  const dir = plant(t, "import test from 'node:test';\ntest('exits inside', () => { process.exit(0); });\n");
  const r = await runPlanted(dir);
  assert.equal(r.bound, false, r.out.slice(-400));
  assert.notEqual(r.code, 0, 'a file whose test never reported must not read green\n' + r.out.slice(-500));
  assert.match(r.out, /VACUOUS/, r.out.slice(-600));
});

test('test-spawn (run) TAP-names MUST, control: a file whose named test passes is a PASS and the run exits 0', async (t) => {
  const dir = plant(t, "import test from 'node:test';\ntest('a named test that passes', () => {});\n");
  const r = await runPlanted(dir);
  assert.equal(r.code, 0, r.out.slice(-500));
  assert.doesNotMatch(r.out, /VACUOUS/);
});
