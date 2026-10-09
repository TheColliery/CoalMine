// wave-run.test.mjs -- BB-87 (owner 2026-10-08): the test runner that admits its files by the live machine reading.
// Hermetic: the fixtures are written into a scratch folder at run time, the reading is a stub that answers what the test says, and every child runs under a heap cap and a
// finite clock. RED before BB-87: ./wave-run.mjs did not exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STATUS, parseTap, classifyFile, summarize, nodeOptionsWithHeap, withStdoutSync, runWaves, defaultRead } from './wave-run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WAVE_RUN = path.join(HERE, 'wave-run.mjs');
const MACHINE_READING = path.join(HERE, 'machine-reading.mjs');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-run-test-'));
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

// The room-supplied numbers of every run here: a heap cap, a clock per file, a whole-run deadline.
const LIMITS = { heapMb: 512, fileTimeoutMs: 20000, deadlineMs: 60000 };

// ---- the fixtures: what a test file can do, written once into the sandbox ------------------------------------------------------------------
const FIXTURES = {
  'pass.fixture.mjs': "import { test } from 'node:test'; import assert from 'node:assert/strict';\ntest('real check', () => assert.equal(1, 1));\ntest('second check', () => assert.equal(2, 2));\n",
  'pass-slow.fixture.mjs': "import { test } from 'node:test';\ntest('slow check', async () => { await new Promise((r) => setTimeout(r, 700)); });\n",
  'fail.fixture.mjs': "import { test } from 'node:test'; import assert from 'node:assert/strict';\ntest('good', () => assert.ok(true));\ntest('bad one', () => assert.equal(1, 2));\n",
  'skip.fixture.mjs': "import { test } from 'node:test';\ntest('platform leg', { skip: 'no symlink here' }, () => {});\n",
  'mixed.fixture.mjs': "import { test } from 'node:test'; import assert from 'node:assert/strict';\ntest('runs', () => assert.ok(true));\ntest('platform leg', { skip: 'no symlink here' }, () => {});\n",
  // exit 0 before any test registers, and exit 0 inside a test before its assert: both read "# pass 1" and exit 0 on Node 24.19 (main's measurement, 2026-10-08)
  'exit0-before.fixture.mjs': "import { test } from 'node:test'; import assert from 'node:assert/strict';\nprocess.exit(0);\ntest('never registered', () => assert.equal(1, 2));\n",
  'exit0-inside.fixture.mjs': "import { test } from 'node:test'; import assert from 'node:assert/strict';\ntest('exits before its assert', () => { process.exit(0); assert.equal(1, 2); });\n",
  'no-tests.fixture.mjs': '// registers no test at all\nconst x = 1;\n',
  'throws-at-load.fixture.mjs': "throw new Error('load failure');\n",
  // a test that finishes but leaves a handle open: only --test-force-exit lets the file end
  'open-handle.fixture.mjs': "import { test } from 'node:test';\ntest('done', () => {});\nsetInterval(() => {}, 1000);\n",
  // an async test that never settles: --test-timeout cancels it
  'hang-async.fixture.mjs': "import { test } from 'node:test';\ntest('waits forever', () => new Promise(() => {}));\n",
  // a synchronous block: --test-timeout cannot cut it, only the whole-run deadline (and its tree kill) can
  'hang-sync.fixture.mjs': "import { test } from 'node:test';\ntest('spins', () => { for (;;) { /* never returns */ } });\n",
};
for (const [name, text] of Object.entries(FIXTURES)) fs.writeFileSync(path.join(SANDBOX, name), text);
const fx = (...names) => names.map((n) => path.join(SANDBOX, n + '.fixture.mjs'));

// A reading that answers from a script: each call takes the next answer, the last answer repeats.
const scripted = (...answers) => {
  const calls = [];
  const read = async (arg) => { calls.push(arg); return { verdict: answers[Math.min(calls.length - 1, answers.length - 1)] }; };
  read.calls = calls;
  return read;
};
const trace = () => { const ev = []; const onEvent = (e) => ev.push(e); onEvent.events = ev; return onEvent; };
const maxRunning = (ev) => Math.max(0, ...ev.filter((e) => e.type === 'start').map((e) => e.running));
const statuses = (r) => Object.fromEntries(r.results.map((x) => [path.basename(x.file).replace('.fixture.mjs', ''), x.status]));

// ---- the TAP reader (pure) --------------------------------------------------------------------------------------------------------------
const tap = (lines) => ['TAP version 13', ...lines].join('\n') + '\n';
const REAL_PASS = tap(['# Subtest: real check', 'ok 1 - real check', '# Subtest: second check', 'ok 2 - second check', '1..2', '# tests 2', '# suites 0', '# pass 2', '# fail 0', '# cancelled 0', '# skipped 0', '# todo 0', '# duration_ms 150']);
const FILE_ONLY = (name) => tap(['# Subtest: ' + name, 'ok 1 - ' + name, '1..1', '# tests 1', '# suites 0', '# pass 1', '# fail 0', '# cancelled 0', '# skipped 0', '# todo 0', '# duration_ms 120']);

test('parseTap: reads the top-level result lines, the plan and the summary counts; a nested subtest is not a top-level result', () => {
  const p = parseTap(tap(['# Subtest: a suite', '    # Subtest: inner', '    ok 1 - inner', '    1..1', 'ok 1 - a suite', '1..1', '# tests 2', '# suites 1', '# pass 2', '# fail 0', '# cancelled 0', '# skipped 0', '# todo 0']));
  assert.deepEqual(p.results.map((r) => r.name), ['a suite']);
  assert.equal(p.plan, 1);
  assert.deepEqual(p.counts, { tests: 2, pass: 2, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  assert.deepEqual(parseTap('no tap here\n').results, []);
  assert.equal(parseTap('no tap here\n').counts, null);
});

test('classifyFile: a real pass is PASS, a failing test is FAIL naming the test, a cancelled test is FAIL', () => {
  const pass = classifyFile({ file: 'a.test.mjs', code: 0, signal: null, stdout: REAL_PASS });
  assert.equal(pass.status, STATUS.PASS);
  assert.equal(pass.counts.pass, 2);
  const failTap = tap(['# Subtest: good', 'ok 1 - good', '# Subtest: bad one', 'not ok 2 - bad one', '1..2', '# tests 2', '# suites 0', '# pass 1', '# fail 1', '# cancelled 0', '# skipped 0', '# todo 0']);
  const fail = classifyFile({ file: 'a.test.mjs', code: 1, signal: null, stdout: failTap });
  assert.equal(fail.status, STATUS.FAIL);
  assert.deepEqual(fail.failing, ['bad one']);
  const cancelled = classifyFile({ file: 'a.test.mjs', code: 1, signal: null, stdout: tap(['# Subtest: hangs', 'not ok 1 - hangs', '1..1', '# tests 1', '# suites 0', '# pass 0', '# fail 0', '# cancelled 1', '# skipped 0', '# todo 0']) });
  assert.equal(cancelled.status, STATUS.FAIL);
  assert.match(cancelled.reason, /cancelled 1/);
});

test('classifyFile: exit 0 and "# pass 1" where the only result line names the FILE is VACUOUS, in the relative, the bare and the absolute spelling -- RED before BB-87', () => {
  for (const name of ['exit0-before.fixture.mjs', 'scripts/lib/exit0-before.fixture.mjs', 'C:\\work\\scripts\\lib\\exit0-before.fixture.mjs', 'C:\\\\work\\\\scripts\\\\lib\\\\exit0-before.fixture.mjs' /* TAP doubles each backslash */, '/work/scripts/lib/exit0-before.fixture.mjs']) {
    const r = classifyFile({ file: 'scripts/lib/exit0-before.fixture.mjs', code: 0, signal: null, stdout: FILE_ONLY(name) });
    assert.equal(r.status, STATUS.VACUOUS, name);
    assert.match(r.reason, /no test of its own/);
  }
});

test('classifyFile: no plan line, no summary or zero tests with exit 0 is VACUOUS; a signal is FAIL; a non-zero exit with no TAP is FAIL; an all-skipped file is SKIP, never vacuous', () => {
  assert.equal(classifyFile({ file: 'a.test.mjs', code: 0, signal: null, stdout: 'TAP version 13\n' }).status, STATUS.VACUOUS);
  assert.equal(classifyFile({ file: 'a.test.mjs', code: 0, signal: null, stdout: '' }).status, STATUS.VACUOUS);
  const none = classifyFile({ file: 'a.test.mjs', code: 0, signal: null, stdout: tap(['1..0', '# tests 0', '# suites 0', '# pass 0', '# fail 0', '# cancelled 0', '# skipped 0', '# todo 0']) });
  assert.equal(none.status, STATUS.VACUOUS);
  assert.match(none.reason, /registered no test/, 'named for what it is, not for the file-name tell');
  // exit 0 with a summary that still reports a failure or a cancelled test is a FAIL, whatever the exit code says
  for (const [fail, cancelled] of [[1, 0], [0, 1]]) {
    const inconsistent = classifyFile({ file: 'a.test.mjs', code: 0, signal: null, stdout: tap(['# Subtest: x', 'ok 1 - x', '1..1', '# tests 1', '# suites 0', '# pass 1', '# fail ' + fail, '# cancelled ' + cancelled, '# skipped 0', '# todo 0']) });
    assert.equal(inconsistent.status, STATUS.FAIL, 'fail ' + fail + ' cancelled ' + cancelled);
    assert.match(inconsistent.reason, /exit 0 but the summary reports/);
  }
  const sig = classifyFile({ file: 'a.test.mjs', code: null, signal: 'SIGKILL', stdout: '' });
  assert.equal(sig.status, STATUS.FAIL);
  assert.match(sig.reason, /SIGKILL/);
  const noTap = classifyFile({ file: 'a.test.mjs', code: 1, signal: null, stdout: 'Could not find a.test.mjs\n' });
  assert.equal(noTap.status, STATUS.FAIL);
  const skipTap = tap(['# Subtest: platform leg', 'ok 1 - platform leg # SKIP no symlink here', '1..1', '# tests 1', '# suites 0', '# pass 0', '# fail 0', '# cancelled 0', '# skipped 1', '# todo 0']);
  const skip = classifyFile({ file: 'a.test.mjs', code: 0, signal: null, stdout: skipTap });
  assert.equal(skip.status, STATUS.SKIP);
  assert.equal(skip.counts.skipped, 1);
  const mixedTap = tap(['# Subtest: runs', 'ok 1 - runs', '# Subtest: platform leg', 'ok 2 - platform leg # SKIP no symlink here', '1..2', '# tests 2', '# suites 0', '# pass 1', '# fail 0', '# cancelled 0', '# skipped 1', '# todo 0']);
  assert.equal(classifyFile({ file: 'a.test.mjs', code: 0, signal: null, stdout: mixedTap }).status, STATUS.PASS, 'a skipped leg beside a real pass is still a PASS file');
});

test('summarize: pass + fail + vacuous + skipped + not-run is reconciled against the roster, and a mismatch is RED by itself', () => {
  const r = (status, file) => ({ file, status, reason: status === STATUS.PASS ? '' : 'why', counts: null, failing: [] });
  const ok = summarize([r(STATUS.PASS, 'a'), r(STATUS.PASS, 'b'), r(STATUS.SKIP, 'c')], 3);
  assert.equal(ok.red, false);
  assert.match(ok.line, /3 files/);
  assert.match(ok.line, /pass 2/);
  assert.match(ok.line, /skipped 1/);
  assert.match(ok.line, /reconciled 3 of 3/);
  const red = summarize([r(STATUS.PASS, 'a'), r(STATUS.FAIL, 'b'), r(STATUS.VACUOUS, 'c'), r(STATUS.NOT_RUN, 'd')], 4);
  assert.equal(red.red, true);
  assert.match(red.line, /fail 1 \(b\)/);
  assert.match(red.line, /vacuous 1 \(c\)/);
  assert.match(red.line, /not-run 1 \(d\)/);
  assert.equal(summarize([r(STATUS.PASS, 'a'), r(STATUS.NOT_RUN, 'b')], 2).red, true, 'a file that never started is not a green run');
  assert.equal(summarize([r(STATUS.PASS, 'a'), r(STATUS.VACUOUS, 'b')], 2).red, true, 'a vacuous file is not a green run');
  assert.equal(summarize([r(STATUS.PASS, 'a'), r(STATUS.FAIL, 'b')], 2).red, true);
  const mismatch = summarize([r(STATUS.PASS, 'a')], 2);
  assert.equal(mismatch.red, true);
  assert.match(mismatch.line, /MISMATCH 1 of 2/);
});

test('nodeOptionsWithHeap: the room\'s cap rides NODE_OPTIONS; a caller\'s own heap flag is kept, in either spelling, and never doubled', () => {
  assert.equal(nodeOptionsWithHeap('', 512), '--max-old-space-size=512');
  assert.equal(nodeOptionsWithHeap('--no-warnings', 512), '--no-warnings --max-old-space-size=512');
  assert.equal(nodeOptionsWithHeap('--max-old-space-size=1024', 512), '--max-old-space-size=1024');
  assert.equal(nodeOptionsWithHeap('--max_old_space_size=1024 --no-warnings', 512), '--max_old_space_size=1024 --no-warnings');
});

// ---- the admission loop (real children, a stub reading) ---------------------------------------------------------------------------------
test('a permanent WAIT never stops the run: at least one file is always running, so every file still runs, one at a time -- RED before BB-87', async () => {
  const onEvent = trace();
  const r = await runWaves({ files: fx('pass', 'pass-slow', 'mixed'), cwd: SANDBOX, env: process.env, ...LIMITS, read: scripted('WAIT'), onEvent });
  assert.deepEqual(r.results.map((x) => x.status), [STATUS.PASS, STATUS.PASS, STATUS.PASS]);
  assert.equal(maxRunning(onEvent.events), 1, 'a WAIT holds every second file');
  assert.ok(onEvent.events.some((e) => e.type === 'hold'), 'a hold was recorded');
  assert.equal(r.exitCode, 0);
});

test('a WAIT holds the next file until a running one exits, a BREATHE admits it beside the running one -- RED before BB-87', async () => {
  const held = trace();
  await runWaves({ files: fx('pass-slow', 'pass'), cwd: SANDBOX, env: process.env, ...LIMITS, read: scripted('WAIT'), onEvent: held });
  const startOfSecond = held.events.findIndex((e) => e.type === 'start' && e.file.endsWith('pass.fixture.mjs'));
  const exitOfFirst = held.events.findIndex((e) => e.type === 'exit' && e.file.endsWith('pass-slow.fixture.mjs'));
  assert.ok(exitOfFirst >= 0 && startOfSecond > exitOfFirst, 'the second file started only after the first exited');
  const open = trace();
  const reading = scripted('BREATHE');
  await runWaves({ files: fx('pass-slow', 'pass'), cwd: SANDBOX, env: process.env, ...LIMITS, read: reading, onEvent: open });
  assert.equal(maxRunning(open.events), 2, 'the second file started beside the first');
  assert.deepEqual(reading.calls, [{ running: 1 }], 'one reading, taken with the number of files already running');
});

test('a WAIT then a BREATHE: the file held at the first reading is admitted at the second -- RED before BB-87', async () => {
  const onEvent = trace();
  const reading = scripted('WAIT', 'BREATHE');
  const r = await runWaves({ files: fx('pass-slow', 'pass', 'mixed'), cwd: SANDBOX, env: process.env, ...LIMITS, read: reading, onEvent });
  assert.deepEqual(r.results.map((x) => x.status), [STATUS.PASS, STATUS.PASS, STATUS.PASS]);
  assert.ok(reading.calls.length >= 2, 'the reading was taken again after the hold');
  assert.ok(onEvent.events.filter((e) => e.type === 'hold').length >= 1);
});

test('--serial runs one file at a time and takes no reading at all', async () => {
  const onEvent = trace();
  const reading = scripted('BREATHE');
  const r = await runWaves({ files: fx('pass', 'pass-slow', 'skip'), cwd: SANDBOX, env: process.env, ...LIMITS, serial: true, read: reading, onEvent });
  assert.equal(maxRunning(onEvent.events), 1);
  assert.equal(reading.calls.length, 0);
  assert.deepEqual(r.results.map((x) => x.status), [STATUS.PASS, STATUS.PASS, STATUS.SKIP]);
});

test('one failing file turns the run red and the summary names it; the other files still ran', async () => {
  const r = await runWaves({ files: fx('pass', 'fail', 'mixed'), cwd: SANDBOX, env: process.env, ...LIMITS, read: scripted('BREATHE') });
  assert.deepEqual(statuses(r), { pass: STATUS.PASS, fail: STATUS.FAIL, mixed: STATUS.PASS });
  assert.equal(r.exitCode, 1);
  assert.match(r.summary.line, /fail 1 \(fail\.fixture\.mjs\)/);
  assert.deepEqual(r.results.find((x) => x.file.endsWith('fail.fixture.mjs')).failing, ['bad one']);
});

test('a file that exits 0 before its tests, and one that exits 0 inside a test, are VACUOUS: never a pass, never a fail, the run is red and names them -- RED before BB-87', async () => {
  const r = await runWaves({ files: fx('pass', 'exit0-before', 'exit0-inside', 'no-tests'), cwd: SANDBOX, env: process.env, ...LIMITS, read: scripted('BREATHE') });
  assert.deepEqual(statuses(r), { pass: STATUS.PASS, 'exit0-before': STATUS.VACUOUS, 'exit0-inside': STATUS.VACUOUS, 'no-tests': STATUS.VACUOUS });
  assert.equal(r.exitCode, 1, 'a run with a vacuous file is not green');
  assert.match(r.summary.line, /vacuous 3 \(exit0-before\.fixture\.mjs, exit0-inside\.fixture\.mjs, no-tests\.fixture\.mjs\)/);
  assert.match(r.summary.line, /pass 1/);
  assert.match(r.summary.line, /reconciled 4 of 4/);
});

test('the NODE_TEST_CONTEXT of a parent test runner never reaches a child: it would switch the child to a binary format and leave no TAP to read -- RED before BB-87', async () => {
  const r = await runWaves({ files: fx('pass'), cwd: SANDBOX, env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8' }, ...LIMITS, read: scripted('BREATHE') });
  assert.deepEqual(r.results.map((x) => x.status), [STATUS.PASS]);
});

test('a file that leaves a handle open still ends (--test-force-exit), and a test that never settles is cancelled at the clock of the room: FAIL naming the cancel -- RED before BB-87', async () => {
  const open = await runWaves({ files: fx('open-handle'), cwd: SANDBOX, env: process.env, ...LIMITS, serial: true, read: scripted('BREATHE') });
  assert.deepEqual(open.results.map((x) => x.status), [STATUS.PASS]);
  const hung = await runWaves({ files: fx('hang-async'), cwd: SANDBOX, env: process.env, ...LIMITS, fileTimeoutMs: 1500, serial: true, read: scripted('BREATHE') });
  assert.deepEqual(hung.results.map((x) => x.status), [STATUS.FAIL]);
  assert.match(hung.results[0].reason, /cancelled 1/);
});

test('a module that throws at load is FAIL; a listed file that does not exist is FAIL without a child', async () => {
  const gone = path.join(SANDBOX, 'not-here.fixture.mjs');
  const onEvent = trace();
  const r = await runWaves({ files: [...fx('throws-at-load'), gone], cwd: SANDBOX, env: process.env, ...LIMITS, read: scripted('BREATHE'), onEvent });
  assert.deepEqual(r.results.map((x) => x.status), [STATUS.FAIL, STATUS.FAIL]);
  assert.match(r.results[1].reason, /missing/);
  assert.equal(onEvent.events.filter((e) => e.type === 'start').length, 1, 'no child for the missing file');
});

test('the whole-run deadline kills a hung file\'s tree and the run ends; a file never started is NOT-RUN and the roster still reconciles -- RED before BB-87', async () => {
  const r = await runWaves({ files: fx('hang-sync', 'pass'), cwd: SANDBOX, env: process.env, ...LIMITS, deadlineMs: 2500, serial: true, read: scripted('BREATHE') });
  assert.deepEqual(r.results.map((x) => x.status), [STATUS.FAIL, STATUS.NOT_RUN]);
  assert.match(r.results[0].reason, /whole-run deadline/);
  assert.match(r.results[1].reason, /before this file started/);
  assert.equal(r.exitCode, 1);
  assert.match(r.summary.line, /reconciled 2 of 2/);
});

test('the summary counts match the files: five files of five kinds, one line, every count named', async () => {
  const r = await runWaves({ files: fx('pass', 'mixed', 'skip', 'fail', 'exit0-before'), cwd: SANDBOX, env: process.env, ...LIMITS, read: scripted('BREATHE') });
  const s = r.summary;
  assert.deepEqual(s.counts, { pass: 2, fail: 1, vacuous: 1, skipped: 1, notRun: 0 });
  assert.equal(s.line.split('\n').length, 1, 'one line');
  assert.match(s.line, /^wave-run: 5 files · pass 2 · fail 1 \(fail\.fixture\.mjs\) · vacuous 1 \(exit0-before\.fixture\.mjs\) · skipped 1 · not-run 0 · reconciled 5 of 5 — RED$/);
});

test('an unreadable machine (exit 2 of the reading) never blocks a file and is counted', async () => {
  const unmeasured = async () => ({ verdict: 'UNMEASURED' });
  const onEvent = trace();
  const r = await runWaves({ files: fx('pass-slow', 'pass'), cwd: SANDBOX, env: process.env, ...LIMITS, read: unmeasured, onEvent });
  assert.equal(maxRunning(onEvent.events), 2);
  assert.equal(r.readings.unmeasured, 1);
});

test('refuses a run with no finite clock, a duplicate file or an empty roster: the numbers are the room\'s, the clock is not optional', async () => {
  const base = { files: fx('pass'), cwd: SANDBOX, env: process.env, ...LIMITS, read: scripted('BREATHE') };
  await assert.rejects(runWaves({ ...base, deadlineMs: undefined }), /deadlineMs/);
  await assert.rejects(runWaves({ ...base, fileTimeoutMs: 0 }), /fileTimeoutMs/);
  await assert.rejects(runWaves({ ...base, heapMb: -1 }), /heapMb/);
  await assert.rejects(runWaves({ ...base, files: [...fx('pass'), ...fx('pass')] }), /twice/);
  await assert.rejects(runWaves({ ...base, files: [] }), /no test files/);
});

// ---- the reading itself: the byte-equal core, called as a child --------------------------------------------------------------------------
// CoalFace's machine-reading.mjs, adopted by blob id and NEVER edited here (the owner's rule, BB-87: an improvement found here goes back to CoalFace, whose head builds it in its own belt,
// and this folder re-adopts by blob id). Source: CoalFace commit 62184163c80c543d497732c0611e43ab9084533c, plugin/skills/coalface/scripts/machine-reading.mjs.
const MACHINE_READING_BLOB = '1c550b6605125aebda5a2552294eaeb9a5d488ba';
test('machine-reading.mjs is CoalFace\'s file byte for byte (its git blob id, line endings as the repository stores them) -- RED before BB-87', () => {
  const text = fs.readFileSync(MACHINE_READING).toString('utf8').replace(/\r\n/g, '\n');
  const body = Buffer.from(text, 'utf8');
  const id = createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${body.length}\0`), body])).digest('hex');
  assert.equal(id, MACHINE_READING_BLOB);
});

// A stand-in for the core: prints its own argv as JSON (with the verdict its exit code stands for) and exits with the code the test gives it.
const stubReader = (name, code, body) => {
  const p = path.join(SANDBOX, name);
  fs.writeFileSync(p, body ?? ('process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), verdict: ' + JSON.stringify(code === 0 ? 'BREATHE' : 'WAIT') + ' }) + String.fromCharCode(10)); process.exitCode = ' + code + ';'));
  return p;
};

test('defaultRead maps the exit codes of the core: 0 BREATHE, 1 WAIT, 2 or a garbage line or a missing reader UNMEASURED (never a block), 64 a usage error that throws -- RED before BB-87', async () => {
  const t = LIMITS.fileTimeoutMs;
  assert.equal((await defaultRead({ readerPath: stubReader('r0.mjs', 0), timeoutMs: t })({ running: 1 })).verdict, 'BREATHE');
  assert.equal((await defaultRead({ readerPath: stubReader('r1.mjs', 1), timeoutMs: t })({ running: 1 })).verdict, 'WAIT');
  assert.equal((await defaultRead({ readerPath: stubReader('r2.mjs', 2), timeoutMs: t })({ running: 1 })).verdict, 'UNMEASURED');
  assert.equal((await defaultRead({ readerPath: stubReader('rg.mjs', 0, 'process.stdout.write("not json");'), timeoutMs: t })({ running: 1 })).verdict, 'UNMEASURED');
  assert.equal((await defaultRead({ readerPath: path.join(SANDBOX, 'no-such-reader.mjs'), timeoutMs: t })({ running: 1 })).verdict, 'UNMEASURED');
  await assert.rejects(defaultRead({ readerPath: stubReader('r64.mjs', 64), timeoutMs: t })({ running: 1 }), /usage/);
});

test('defaultRead passes the running count and the thresholds the room gives to the core as its own flags, and passes nothing it was not given -- RED before BB-87', async () => {
  const reader = stubReader('rargs.mjs', 0);
  const full = await defaultRead({ readerPath: reader, timeoutMs: LIMITS.fileTimeoutMs, cpuMax: 70, memMin: 15 })({ running: 3 });
  assert.deepEqual(full.raw.argv, ['--json', '--running', '3', '--cpu-max', '70', '--mem-min', '15']);
  const bare = await defaultRead({ readerPath: reader, timeoutMs: LIMITS.fileTimeoutMs })({ running: 1 });
  assert.deepEqual(bare.raw.argv, ['--json', '--running', '1'], 'no threshold of ours is passed: the defaults of the core apply');
});

test('defaultRead against the real core: one reading comes back as a verdict of the three kinds within the clock of the room -- RED before BB-87', async () => {
  const r = await defaultRead({ readerPath: MACHINE_READING, timeoutMs: LIMITS.fileTimeoutMs })({ running: 1 });
  assert.ok(['BREATHE', 'WAIT', 'UNMEASURED'].includes(r.verdict), r.verdict);
  if (r.verdict !== 'UNMEASURED') assert.equal(typeof r.raw.thresholds.cpuMaxPct, 'number');
});

// ---- the command line -----------------------------------------------------------------------------------------------------------------
const cli = (args) => spawnSync(process.execPath, [WAVE_RUN, ...args], { cwd: SANDBOX, encoding: 'utf8', timeout: 90000 });

test('the command line: --help prints usage and exits 0, a missing clock or an unknown flag exits 64 with the usage line on stderr', () => {
  const help = cli(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--deadline-ms/);
  const noClock = cli(['--heap-mb', '512', '--file-timeout-ms', '20000', '--', ...fx('pass')]);
  assert.equal(noClock.status, 64);
  assert.match(noClock.stderr, /--deadline-ms/);
  const unknown = cli(['--nope']);
  assert.equal(unknown.status, 64);
  assert.match(unknown.stderr, /unknown argument/);
});

test('the command line: a serial run over real files prints one summary line on stdout and exits 0; a vacuous file makes it exit 1 and print its FAIL-style line', () => {
  const green = cli(['--heap-mb', '512', '--file-timeout-ms', '20000', '--deadline-ms', '60000', '--serial', '--', ...fx('pass', 'skip')]);
  assert.equal(green.status, 0, green.stdout + green.stderr);
  assert.equal(green.stdout.trim().split('\n').length, 1);
  assert.match(green.stdout.trim(), /^wave-run: 2 files · pass 1 · fail 0 · vacuous 0 · skipped 1 · not-run 0 · reconciled 2 of 2 — GREEN$/);
  const red = cli(['--heap-mb', '512', '--file-timeout-ms', '20000', '--deadline-ms', '60000', '--serial', '--', ...fx('pass', 'exit0-before')]);
  assert.equal(red.status, 1);
  assert.match(red.stdout, /^VACUOUS .*exit0-before\.fixture\.mjs: /m);
  assert.match(red.stdout, /RED$/m);
});

// ---- 08d D2 (2026-10-09): a force-exited file process must not lose the tail of its report on a POSIX pipe; a hang before the first test needs a clock of its own ----
// A POSIX pipe, SIMULATED (a Windows pipe is blocking, so the loss cannot happen on the machine that wrote this): in the test FILE's own process (the runner's child) the first
// 32 KiB written go through at once, the rest is queued and dies with process.exit() -- unless the stream was switched to blocking, which is what stdout-sync.mjs does.
const SIM = [
  "if (process.env.NODE_TEST_CONTEXT === 'child-v8') {",
  '  const out = process.stdout;',
  '  let written = 0;',
  '  let blocking = false;',
  '  const h = out._handle;',
  "  if (h && typeof h.setBlocking === 'function') { const real = h.setBlocking.bind(h); h.setBlocking = (v) => { blocking = !!v; return real(v); }; }",
  '  const realWrite = out.write.bind(out);',
  '  out.write = function (chunk, enc, cb) {',
  "    const n = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;",
  '    const direct = blocking || written + n <= 32768;',
  '    written += n;',
  '    if (direct) return realWrite(chunk, enc, cb);',
  '    setTimeout(() => realWrite(chunk, enc, cb), 400);',
  '    return true;',
  '  };',
  '}',
  '',
].join(String.fromCharCode(10));
fs.writeFileSync(path.join(SANDBOX, 'async-pipe.sim.mjs'), SIM);
const SIM_NODE_OPTIONS = '--import ' + pathToFileURL(path.join(SANDBOX, 'async-pipe.sim.mjs')).href;
const MANY = 300;
fs.writeFileSync(path.join(SANDBOX, 'many.fixture.mjs'), "import { test } from 'node:test';" + String.fromCharCode(10) + 'for (let i = 0; i < ' + MANY + "; i++) test('t' + i, () => {});" + String.fromCharCode(10));
// a hang BEFORE the first test: --test-timeout never applies to it, only a clock on the file itself can end it
fs.writeFileSync(path.join(SANDBOX, 'hang-top.fixture.mjs'), "import { test } from 'node:test';" + String.fromCharCode(10) + 'setInterval(() => {}, 1000);' + String.fromCharCode(10) + 'await new Promise(() => {});' + String.fromCharCode(10));
const STDOUT_SYNC_URL = pathToFileURL(path.join(HERE, 'stdout-sync.mjs')).href;

test('the simulation is faithful: with no preload a force-exited file of 300 tests loses the end of its TAP and reads VACUOUS (the control for the fix below)', () => {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-force-exit', path.join(SANDBOX, 'many.fixture.mjs')], {
    cwd: SANDBOX, env: { ...process.env, NODE_TEST_CONTEXT: undefined, NODE_OPTIONS: SIM_NODE_OPTIONS }, encoding: 'utf8', timeout: 60000,
  });
  const c = classifyFile({ file: 'many.fixture.mjs', code: r.status, signal: r.signal, stdout: r.stdout });
  assert.ok(c.status === STATUS.VACUOUS || c.status === STATUS.FAIL, `the loss must show: ${c.status} ${c.reason}`);
  assert.notEqual(c.status, STATUS.PASS);
});

test('every child gets the stdout preload: the 300 tests of a force-exited file all report under the simulated POSIX pipe -- RED before the fix', async () => {
  const r = await runWaves({ files: fx('many'), cwd: SANDBOX, env: { ...process.env, NODE_OPTIONS: SIM_NODE_OPTIONS }, ...LIMITS, serial: true, read: scripted('BREATHE') });
  assert.equal(r.results[0].status, STATUS.PASS, r.results[0].reason);
  assert.equal(r.results[0].counts.tests, MANY);
  assert.equal(r.exitCode, 0);
});

test('withStdoutSync: the preload goes AFTER what the caller already set in NODE_OPTIONS, once, and the other variables are kept', () => {
  assert.equal(withStdoutSync({ A: '1' }).NODE_OPTIONS, '--import ' + STDOUT_SYNC_URL);
  assert.equal(withStdoutSync({ A: '1' }).A, '1');
  const mine = '--import file:///sim.mjs --max-old-space-size=512';
  assert.equal(withStdoutSync({ NODE_OPTIONS: mine }).NODE_OPTIONS, mine + ' --import ' + STDOUT_SYNC_URL);
  const once = withStdoutSync({ NODE_OPTIONS: mine });
  assert.equal(withStdoutSync(once), once, 'a second call adds nothing');
});

test('the stdout preload is silent and harmless: with stdout a pipe, a file or nothing it exits 0 and says nothing', () => {
  const out = path.join(SANDBOX, 'preload-out.txt');
  const fd = fs.openSync(out, 'w+'); // read back through this descriptor, never through the path again
  try {
    const piped = spawnSync(process.execPath, ['--import', STDOUT_SYNC_URL, '-e', "process.stdout.write('hello'); process.stderr.write('')"], { encoding: 'utf8', timeout: 30000 });
    assert.equal(piped.status, 0);
    assert.equal(piped.stdout, 'hello');
    assert.equal(piped.stderr, '');
    const toFile = spawnSync(process.execPath, ['--import', STDOUT_SYNC_URL, '-e', "process.stdout.write('hello')"], { stdio: ['ignore', fd, 'pipe'], encoding: 'utf8', timeout: 30000 });
    assert.equal(toFile.status, 0);
    assert.equal(toFile.stderr, '');
    const none = spawnSync(process.execPath, ['--import', STDOUT_SYNC_URL, '-e', '1'], { stdio: 'ignore', timeout: 30000 });
    assert.equal(none.status, 0);
    const got = Buffer.alloc(16);
    assert.equal(got.toString('utf8', 0, fs.readSync(fd, got, 0, got.length, 0)), 'hello', 'the output of the child reached the file');
  } finally {
    fs.closeSync(fd);
  }
});

test('the stdout preload switches BOTH pipes, stdout and stderr, to blocking (a recorder loaded first sees the two calls)', () => {
  const rec = path.join(SANDBOX, 'record-blocking.mjs');
  fs.writeFileSync(rec, [
    'globalThis.__calls = [];',
    "for (const [name, s] of [['stdout', process.stdout], ['stderr', process.stderr]]) {",
    "  const h = s._handle;",
    "  if (h && typeof h.setBlocking === 'function') { const real = h.setBlocking.bind(h); h.setBlocking = (v) => { globalThis.__calls.push(name + ':' + v); return real(v); }; }",
    '}',
    '',
  ].join(String.fromCharCode(10)));
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(rec).href, '--import', STDOUT_SYNC_URL, '-e', 'console.log(JSON.stringify(globalThis.__calls))'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()).sort(), ['stderr:true', 'stdout:true']);
});

test('the file clock: a file that hangs before its first test is killed at the clock of the file (FAIL naming it) and the next file still runs -- RED before the fix', async () => {
  const r = await runWaves({ files: fx('hang-top', 'pass'), cwd: SANDBOX, env: process.env, ...LIMITS, deadlineMs: 40000, fileClockMs: 2000, serial: true, read: scripted('BREATHE') });
  assert.deepEqual(r.results.map((x) => x.status), [STATUS.FAIL, STATUS.PASS]);
  assert.match(r.results[0].reason, /file clock/);
  assert.equal(r.exitCode, 1);
});

test('the file clock is optional but never loose: a value that is not a positive whole number is refused, and without it the whole-run deadline still ends a hang', async () => {
  for (const bad of [0, -5, 1.5, '2000']) {
    await assert.rejects(runWaves({ files: fx('pass'), cwd: SANDBOX, env: process.env, ...LIMITS, fileClockMs: bad, read: scripted('BREATHE') }), /fileClockMs must be a positive integer/, JSON.stringify(bad));
  }
  const r = await runWaves({ files: fx('hang-top', 'pass'), cwd: SANDBOX, env: process.env, ...LIMITS, deadlineMs: 2500, serial: true, read: scripted('BREATHE') });
  assert.deepEqual(r.results.map((x) => x.status), [STATUS.FAIL, STATUS.NOT_RUN]);
  assert.match(r.results[0].reason, /whole-run deadline/);
});

test('the command line: a file clock that never fires does not hold the process open (the timer is cleared when its file exits)', () => {
  const r = spawnSync(process.execPath, [WAVE_RUN, '--heap-mb', '512', '--file-timeout-ms', '20000', '--deadline-ms', '60000', '--file-clock-ms', '600000', '--serial', '--', ...fx('pass')], { cwd: SANDBOX, encoding: 'utf8', timeout: 45000 });
  assert.equal(r.status, 0, 'the process ended on its own, not at the spawn timeout: ' + (r.error ? r.error.code : r.stdout));
  assert.match(r.stdout, /GREEN$/m);
});

test('the command line: --file-clock-ms is accepted, shown in the usage, and kills a hang before the first test without stopping the run', () => {
  assert.match(cli(['--help']).stdout, /--file-clock-ms N {4}wall clock of ONE file/);
  const bad = cli(['--file-clock-ms', 'soon']);
  assert.equal(bad.status, 64);
  assert.match(bad.stderr, /--file-clock-ms needs a whole number/);
  const r = cli(['--heap-mb', '512', '--file-timeout-ms', '20000', '--deadline-ms', '40000', '--file-clock-ms', '2000', '--serial', '--', ...fx('hang-top', 'pass')]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^FAIL .*hang-top\.fixture\.mjs: killed at the file clock/m);
  assert.match(r.stdout, /pass 1 · fail 1 \(hang-top\.fixture\.mjs\) · vacuous 0 · skipped 0 · not-run 0 · reconciled 2 of 2 — RED$/m);
});
