#!/usr/bin/env node
// wave-run.mjs -- run a room's enumerated test files in waves admitted by the LIVE machine reading (BB-87, owner 2026-10-08).
//
//   node scripts/lib/wave-run.mjs --heap-mb N --file-timeout-ms N --deadline-ms N [--cpu-max N] [--mem-min N] [--serial] -- <test files...>
//
// WHY: a serial runner is safe and slow; every file at once saturates the box (AGENTS.md THE MACHINE BOUND). This runs each file as its own child,
//   node --test --test-reporter=tap --test-timeout=<file clock> --test-force-exit <file>
// under the room's heap cap (NODE_OPTIONS, so a test's own spawns inherit it), and admits the next file only while a FRESH reading says BREATHE.
// The first file always runs (the core's own rule: a queue never sticks), a WAIT holds the next file until a running one exits, and the whole run
// has a deadline that kills the tree. An optional clock on each FILE (--file-clock-ms) kills just that file's tree, so a hang before its first test, which --test-timeout never
// reaches, ends that file alone and the rest of the roster still runs. The reading is CoalFace's machine-reading.mjs, adopted byte for byte beside this file and called as a child:
// it is the one core, `decide()` included, and an improvement to it belongs to CoalFace (its blob id is held by wave-run.test.mjs).
//
// A FORCE-EXITED FILE MUST NOT LOSE ITS TAIL (08d D2, 2026-10-09): --test-force-exit ends the file process with process.exit(), and on a POSIX pipe whatever the kernel buffer had not
// taken yet is discarded, so the reader counts fewer tests than ran and the file reads VACUOUS or, worse, a lost `not ok` reads green. Windows pipes are blocking, so the defect was
// invisible on the machine that wrote this. Every child gets stdout-sync.mjs as a preload (withStdoutSync), which makes the pipes blocking.
//
// NO NUMBER OF OURS: the heap cap, the clock per test and the whole-run deadline are flags the room passes (a run with no finite clock is refused, not defaulted),
// and the CPU and memory thresholds are passed to the core only when the room gives them, so the core's own defaults apply otherwise.
//
// EVERY FILE IS COUNTED, AND A PASS IS READ FROM THE TAP, NEVER FROM THE EXIT CODE (measured on Node 24.19, 2026-10-08): a file that calls process.exit(0) before
// its tests register, or inside a test before its assert, exits 0 and prints "# pass 1", byte for byte like a real pass; the one tell is its only result
// line, which names the FILE where a real pass names a test. Such a file is VACUOUS: its own status beside PASS, FAIL, SKIP and NOT-RUN, never counted as a pass,
// never folded into FAIL (a file that never ran its checks needs a different fix from one that failed them), listed by name, and the run is RED. The summary
// reconciles the five counts against the roster and prints a mismatch as RED, so a file can never leave the denominator unseen. A legitimate platform skip
// uses t.skip, which reports a named skipped test: an all-skipped file is SKIP, a skipped leg beside a real pass leaves the file a PASS.
// NAMED OPEN: a file whose test exits 0 AFTER another test already passed, from a timer or an async step the runner never sees finish, reports only the tests
// that completed ("# pass 1" for the first) and is a PASS here; no TAP reader can see a test that vanished before it reported. Node 22 spells the file-level line
// with the absolute path, which the identity check accepts; the Node 22 shape is covered by a captured sample, not by a run on Node 22.
// NAMED OPEN (canon TODO, not built): VACUOUS covers only a file with zero tests, so a file that loses SOME tests still reads PASS; a per-file count floor or an expected-names manifest closes it.
// NAMED OPEN (canon TODO, not built): the TAP of a PASS file is kept nowhere, so no room can compare test NAMES after the run.
// A `not ok ... # TODO` is a known gap, not a failure: Node counts it under `# todo`, reads `# fail 0` and exits 0, and classifyFile agrees.
//
// Pure functions (parseTap, classifyFile, summarize, nodeOptionsWithHeap) plus runWaves(); node builtins only (Phoenix #2). Exit: 0 green, 1 red, 64 usage.
import { execFile, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const STATUS = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', VACUOUS: 'VACUOUS', SKIP: 'SKIP', NOT_RUN: 'NOT-RUN' });
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXIT_USAGE = 64;

class UsageError extends Error {}

// TAP escapes a backslash and a hash in a name with a backslash (a Windows path arrives with every backslash doubled).
const unescapeTap = (text) => text.replace(/\\([\\#])/g, '$1');

// ---- the TAP reader ------------------------------------------------------------------------------------------------------------------
// Top-level result lines only (a nested subtest is indented), the plan line, and the summary comments `# tests N` ... `# todo N`.
export function parseTap(text) {
  const results = [];
  const found = {};
  let plan = null;
  for (const line of String(text).split(/\r?\n/)) {
    let m = /^(not )?ok \d+(?: - (.*?))?(?:\s+# (SKIP|TODO)\b.*)?$/.exec(line);
    if (m) { results.push({ ok: !m[1], name: unescapeTap(m[2] ?? '').trim(), directive: m[3] ?? null }); continue; }
    m = /^1\.\.(\d+)$/.exec(line);
    if (m) { plan = Number(m[1]); continue; }
    m = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
    if (m) found[m[1]] = Number(m[2]);
  }
  const counts = 'tests' in found ? { tests: found.tests, pass: found.pass ?? 0, fail: found.fail ?? 0, cancelled: found.cancelled ?? 0, skipped: found.skipped ?? 0, todo: found.todo ?? 0 } : null;
  return { results, plan, counts };
}

// Does a result name the test FILE itself? The bare name (Node 24), the path as listed, or an absolute path (Node 22), in either slash.
function namesFile(name, file) {
  const n = name.replace(/\\/g, '/').toLowerCase();
  const f = file.replace(/\\/g, '/').toLowerCase();
  const base = f.slice(f.lastIndexOf('/') + 1);
  return n === f || n === base || n.endsWith('/' + f) || f.endsWith('/' + n);
}

// One finished child to one status. `killedBy` is a reason the runner itself ended the child.
export function classifyFile({ file, code, signal, stdout, killedBy = null }) {
  const out = (status, reason, parsed, failing = []) => ({ file, status, reason, counts: parsed ? parsed.counts : null, failing });
  if (killedBy) return out(STATUS.FAIL, killedBy, null);
  if (signal) return out(STATUS.FAIL, `died by signal ${signal}`, null);
  const p = parseTap(stdout);
  // `not ok ... # TODO` is a test its author marked as a known gap: node counts it under `# todo`, reads `# fail 0` and exits 0, and so does this reader.
  const failing = p.results.filter((r) => !r.ok && r.directive !== 'TODO').map((r) => r.name);
  if (code !== 0) {
    const parts = [];
    if (failing.length) parts.push(`not ok: ${failing.join(', ')}`);
    if (p.counts && p.counts.cancelled > 0) parts.push(`cancelled ${p.counts.cancelled}`);
    if (!parts.length) parts.push(p.counts ? `exit ${code}` : `exit ${code} and no TAP result`);
    return out(STATUS.FAIL, parts.join('; '), p, failing);
  }
  if (!p.counts || p.plan === null) return out(STATUS.VACUOUS, 'exit 0 but the runner printed no plan line or no summary: there is no result to count', p);
  if (p.counts.fail > 0 || p.counts.cancelled > 0 || failing.length) return out(STATUS.FAIL, `exit 0 but the summary reports fail ${p.counts.fail}, cancelled ${p.counts.cancelled}`, p, failing);
  if (p.counts.tests === 0 || p.results.length === 0) return out(STATUS.VACUOUS, 'the file registered no test', p);
  if (p.results.every((r) => namesFile(r.name, file))) return out(STATUS.VACUOUS, 'no test of its own was reported: the only result line names the file itself (it exited, or registered nothing, before a test ran)', p);
  if (p.counts.pass === 0 && p.counts.skipped > 0) return out(STATUS.SKIP, `all ${p.counts.skipped} test(s) skipped`, p);
  return out(STATUS.PASS, '', p);
}

// ---- the summary: one line, five counts, reconciled against the roster ---------------------------------------------------------------------
export function summarize(results, roster) {
  const by = (s) => results.filter((r) => r.status === s);
  const names = (list) => (list.length ? ` (${list.map((r) => r.name ?? r.file).join(', ')})` : '');
  const counts = { pass: by(STATUS.PASS).length, fail: by(STATUS.FAIL).length, vacuous: by(STATUS.VACUOUS).length, skipped: by(STATUS.SKIP).length, notRun: by(STATUS.NOT_RUN).length };
  const sum = counts.pass + counts.fail + counts.vacuous + counts.skipped + counts.notRun;
  const matched = sum === roster;
  const red = !matched || counts.fail > 0 || counts.vacuous > 0 || counts.notRun > 0;
  const line = `wave-run: ${roster} file${roster === 1 ? '' : 's'} · pass ${counts.pass} · fail ${counts.fail}${names(by(STATUS.FAIL))} · vacuous ${counts.vacuous}${names(by(STATUS.VACUOUS))} · skipped ${counts.skipped} · not-run ${counts.notRun}${names(by(STATUS.NOT_RUN))} · ${matched ? 'reconciled' : 'MISMATCH'} ${sum} of ${roster} — ${red ? 'RED' : 'GREEN'}`;
  return { line, red, counts };
}

// The preload that keeps a force-exited file process from losing what it has written (see stdout-sync.mjs: a POSIX pipe queues writes and process.exit() drops them).
const STDOUT_SYNC = new URL('./stdout-sync.mjs', import.meta.url).href;
export function withStdoutSync(env) {
  const have = String(env.NODE_OPTIONS || '');
  return have.includes(STDOUT_SYNC) ? env : { ...env, NODE_OPTIONS: (have + ' --import ' + STDOUT_SYNC).trim() };
}

// The room's heap cap rides NODE_OPTIONS so every descendant inherits it, a test's own spawns included. A caller's own heap flag wins, in either spelling.
export function nodeOptionsWithHeap(caller, heapMb) {
  const have = String(caller || '');
  return /(^|\s)--max[-_]old[-_]space[-_]size=/.test(have) ? have : `${have} --max-old-space-size=${heapMb}`.trim();
}

// ---- the reading: the byte-equal core, called as a child -------------------------------------------------------------------------------
// Exit 0 BREATHE, 1 WAIT, 2 or anything unreadable UNMEASURED (never blocks, counted), 64 the core refused its arguments (a bug of ours, thrown).
export function defaultRead({ readerPath = path.join(HERE, 'machine-reading.mjs'), timeoutMs, cpuMax, memMin } = {}) {
  return ({ running }) => new Promise((resolve, reject) => {
    const args = [readerPath, '--json', '--running', String(running)];
    if (cpuMax !== undefined) args.push('--cpu-max', String(cpuMax));
    if (memMin !== undefined) args.push('--mem-min', String(memMin));
    execFile(process.execPath, args, { timeout: timeoutMs, encoding: 'utf8', windowsHide: true }, (err, stdout) => {
      const code = err ? (typeof err.code === 'number' ? err.code : null) : 0;
      if (code === EXIT_USAGE) { reject(new Error(`machine-reading refused its arguments (usage error ${EXIT_USAGE}): ${args.slice(1).join(' ')}`)); return; }
      let raw = null;
      try { raw = JSON.parse(String(stdout).trim().split('\n').pop()); } catch { raw = null; }
      if ((code === 0 || code === 1) && raw && typeof raw === 'object') resolve({ verdict: code === 0 ? 'BREATHE' : 'WAIT', raw });
      else resolve({ verdict: 'UNMEASURED', raw, error: err ? String(err.code ?? err.message) : 'unparseable reading' });
    });
  });
}

// ---- the run ---------------------------------------------------------------------------------------------------------------------------
function killTree(child) {
  if (process.platform === 'win32') { spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', timeout: 30000, windowsHide: true }); return; }
  try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') child.kill('SIGKILL'); }
}

const posInt = (n) => Number.isInteger(n) && n > 0;

export async function runWaves(opts) {
  const { files, cwd = process.cwd(), env = process.env, heapMb, fileTimeoutMs, deadlineMs, fileClockMs, serial = false, onEvent = () => {} } = opts;
  if (!Array.isArray(files) || files.length === 0) throw new UsageError('no test files were given');
  for (const [k, v] of [['heapMb', heapMb], ['fileTimeoutMs', fileTimeoutMs], ['deadlineMs', deadlineMs]]) {
    if (!posInt(v)) throw new UsageError(`${k} must be a positive integer: the heap cap, the clock per file and the whole-run deadline are the room's numbers, and a run with no finite clock is refused`);
  }
  if (fileClockMs !== undefined && !posInt(fileClockMs)) throw new UsageError('fileClockMs must be a positive integer when given: it is the wall clock of one file, in milliseconds');
  const dupe = files.find((f, i) => files.indexOf(f) !== i);
  if (dupe) throw new UsageError(`${dupe} is listed twice`);
  const read = opts.read ?? defaultRead({ timeoutMs: fileTimeoutMs, cpuMax: opts.cpuMax, memMin: opts.memMin });
  // NODE_TEST_CONTEXT is what a parent test runner sets for its own children: a nested `node --test` that inherits it reports in the runner's binary format, not TAP.
  const syncEnv = withStdoutSync(env);
  const childEnv = { ...syncEnv, NODE_OPTIONS: nodeOptionsWithHeap(syncEnv.NODE_OPTIONS, heapMb) };
  delete childEnv.NODE_TEST_CONTEXT;
  // A name is shown relative to the folder only after BOTH sides are real paths: a temp folder can be a symlink (macOS /var is /private/var), so one folder has two spellings and
  // the lexical relative of a file named by one against a cwd spelled by the other leaves the folder. Fail closed: a path that cannot be resolved is shown as the caller wrote it.
  let realCwd = null;
  try { realCwd = fs.realpathSync.native(cwd); } catch { /* every name is shown as given */ }
  const display = (f) => {
    if (realCwd === null) return f;
    let rel;
    try { rel = path.relative(realCwd, fs.realpathSync.native(path.resolve(cwd, f))); } catch { return f; }
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : f;
  };

  const results = new Map();
  const queue = [];
  for (const f of files) {
    if (fs.existsSync(path.resolve(cwd, f))) queue.push(f);
    else results.set(f, { file: f, name: display(f), status: STATUS.FAIL, reason: 'the listed test file is missing', counts: null, failing: [] });
  }
  const running = new Map();
  const closes = [];
  const readings = { n: 0, unmeasured: 0, ms: [] };
  let tick = 0;
  let waiter = null;
  const bump = () => { tick++; if (waiter) { const w = waiter; waiter = null; w(); } };
  let deadlineHit = false;

  const start = (file) => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', `--test-timeout=${fileTimeoutMs}`, '--test-force-exit', file], {
      cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const entry = { child, killed: null };
    const clock = fileClockMs === undefined ? null : setTimeout(() => {
      if (!entry.killed) { entry.killed = `killed at the file clock (${fileClockMs} ms)`; killTree(child); }
    }, fileClockMs);
    running.set(file, entry);
    onEvent({ type: 'start', file, running: running.size });
    closes.push(new Promise((resolve) => {
      let finished = false;
      const finish = (code, signal, startError) => {
        if (finished) return;
        finished = true;
        if (clock) clearTimeout(clock);
        running.delete(file);
        const r = startError
          ? { file, status: STATUS.FAIL, reason: `could not start: ${startError}`, counts: null, failing: [] }
          : classifyFile({ file, code, signal, stdout: out, killedBy: entry.killed });
        r.name = display(file);
        if (r.status === STATUS.FAIL || r.status === STATUS.VACUOUS) { r.stdout = out; r.stderr = err; }
        results.set(file, r);
        onEvent({ type: 'exit', file, status: r.status, running: running.size });
        bump();
        resolve();
      };
      child.on('error', (e) => finish(null, null, e.code ?? e.message));
      child.on('close', (code, signal) => finish(code, signal));
    }));
  };

  const admission = async () => {
    const t0 = Date.now();
    try {
      const r = await read({ running: running.size });
      if (r.verdict === 'UNMEASURED') { readings.unmeasured++; return true; }
      return r.verdict === 'BREATHE';
    } finally { readings.n++; readings.ms.push(Date.now() - t0); }
  };

  const timer = setTimeout(() => {
    deadlineHit = true;
    for (const entry of running.values()) { entry.killed = 'killed at the whole-run deadline'; killTree(entry.child); }
    bump();
  }, deadlineMs);
  try {
    for (;;) {
      const seen = tick;
      while (queue.length && !deadlineHit) {
        let admit = running.size === 0; // the first file always runs, whatever the reading says
        if (!admit && !serial) admit = await admission();
        if (deadlineHit) break;
        if (!admit) { if (!serial) onEvent({ type: 'hold', file: queue[0], running: running.size }); break; }
        start(queue.shift());
      }
      if (deadlineHit || (queue.length === 0 && running.size === 0)) break;
      if (tick !== seen) continue; // a file exited while this pass was deciding
      await new Promise((resolve) => { waiter = resolve; });
    }
    // after a kill the closes arrive at once; wait for them for as long as one file may take, never longer
    await Promise.race([Promise.all(closes), new Promise((resolve) => setTimeout(resolve, fileTimeoutMs).unref())]);
  } finally {
    clearTimeout(timer);
    for (const entry of running.values()) killTree(entry.child);
  }
  for (const [file] of running) results.set(file, { file, name: display(file), status: STATUS.FAIL, reason: 'did not stop after the kill', counts: null, failing: [] });
  for (const file of queue) results.set(file, { file, name: display(file), status: STATUS.NOT_RUN, reason: 'the whole-run deadline was reached before this file started', counts: null, failing: [] });
  const ordered = files.map((f) => results.get(f));
  const summary = summarize(ordered, files.length);
  return { results: ordered, summary, exitCode: summary.red ? 1 : 0, readings };
}

// ---- the command line ------------------------------------------------------------------------------------------------------------------
const USAGE = `usage: wave-run.mjs --heap-mb N --file-timeout-ms N --deadline-ms N [--file-clock-ms N] [--cpu-max N] [--mem-min N] [--serial] [--] <test files...>
  Runs each test file as its own node --test child, admitting the next only while a fresh machine reading says BREATHE (the first always runs).
  --heap-mb N          heap cap for every child and every process a test starts (required: the room's number)
  --file-timeout-ms N  clock per TEST, passed as --test-timeout (required)
  --deadline-ms N      whole-run deadline; the tree of every running file is killed there (required)
  --file-clock-ms N    wall clock of ONE file; the tree of a file still running at it is killed and the file is FAIL, the rest of the roster runs (optional)
  --cpu-max N          WAIT when CPU busy is at or above N percent (passed to the core only when given)
  --mem-min N          WAIT when free memory is below N percent (passed to the core only when given)
  --serial             one file at a time, no reading
  Prints FAIL/VACUOUS/NOT-RUN lines and ONE summary line on stdout; the diagnostics of a red file go to stderr. Exit 0 green, 1 red, 64 usage.
  Example: node scripts/lib/wave-run.mjs --heap-mb 2048 --file-timeout-ms 240000 --deadline-ms 600000 -- scripts/a.test.mjs scripts/b.test.mjs
`;

function parseArgs(argv) {
  const out = { files: [], serial: false, help: false };
  const num = { '--heap-mb': 'heapMb', '--file-timeout-ms': 'fileTimeoutMs', '--deadline-ms': 'deadlineMs', '--file-clock-ms': 'fileClockMs', '--cpu-max': 'cpuMax', '--mem-min': 'memMin' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out.files.push(...argv.slice(i + 1)); break; }
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--serial') out.serial = true;
    else if (a in num) {
      const raw = argv[++i];
      if (!/^\d+$/.test(raw ?? '')) throw new UsageError(`${a} needs a whole number`);
      out[num[a]] = Number(raw);
    } else if (a.startsWith('-')) throw new UsageError(`unknown argument: ${a}`);
    else out.files.push(a);
  }
  return out;
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) {
    process.stderr.write(`wave-run: ${e.message}\n${USAGE}`);
    process.exitCode = EXIT_USAGE;
    return;
  }
  if (args.help) { process.stdout.write(USAGE); return; }
  let run;
  try { run = await runWaves({ ...args, cwd: process.cwd(), env: process.env }); } catch (e) {
    process.stderr.write(`wave-run: ${e.message}\n${e instanceof UsageError ? USAGE : ''}`);
    process.exitCode = e instanceof UsageError ? EXIT_USAGE : 2;
    return;
  }
  for (const r of run.results) {
    if (r.status === STATUS.PASS || r.status === STATUS.SKIP) continue;
    process.stdout.write(`${r.status} ${r.name}: ${r.reason}\n`);
    if (r.stdout || r.stderr) process.stderr.write(`--- ${r.name} (${r.status}) ---\n${r.stdout ?? ''}${r.stderr ?? ''}\n`);
  }
  process.stdout.write(`${run.summary.line}\n`);
  process.exitCode = run.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { process.stderr.write(`wave-run: crashed (${e && e.message ? e.message : 'error'})\n`); process.exitCode = 2; });
}
