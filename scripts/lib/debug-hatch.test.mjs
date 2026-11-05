// 29br (CWK3-007 stage 1, the debug hatch): the three shipped hooks, spawned from the BUILT copies (plugin/hooks/, the bytes a user runs).
// Hermetic per hooks-safety.md §7: TEMP/TMP/TMPDIR, USERPROFILE and HOME point at a throwaway root torn down by t.after; the hook env keys
// CLAUDE_PROJECT_DIR, CLAUDE_PLUGIN_ROOT, CLAUDE_PLUGIN_DATA and COALMINE_DEBUG are removed unless a test sets one. Zero-dep (node:test + built-ins).
// Test names begin with the point number so a red run names the point at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOKS = ['conductor', 'touch', 'stop'];
const FILE = {
  conductor: path.join(repo, 'plugin', 'hooks', 'coalmine-conductor.js'),
  touch: path.join(repo, 'plugin', 'hooks', 'rot-canary-touch.js'),
  stop: path.join(repo, 'plugin', 'hooks', 'rot-canary-stop.js'),
};
const SID = 'HATCH1';
const CLEAR = ['COALMINE_DEBUG', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_DATA'];
const HATCH_FILE = ['.claude', 'coal', 'coalmine', 'debug-hatch.jsonl'];
const HATCH_OLD = ['.claude', 'coal', 'coalmine', 'debug-hatch.1.jsonl'];
const HATCH_MAX_BYTES = 256 * 1024;

// A sandbox: home, temp and project are siblings under one throwaway root, so the project is never under the hook's os.tmpdir().
function sandbox(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-hatch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const sb = { root, home: path.join(root, 'home'), tmp: path.join(root, 'tmp'), proj: path.join(root, 'proj') };
  for (const d of [sb.home, sb.tmp, sb.proj]) fs.mkdirSync(d);
  fs.mkdirSync(path.join(sb.tmp, 'coalmine'), { mode: 0o700 });
  return sb;
}

function writeGlobalConfig(sb, obj) {
  fs.mkdirSync(path.join(sb.home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(sb.home, '.claude', '.coalmine.json'), JSON.stringify(obj), 'utf8');
}

// The stdin each hook reads. The touch payload names a file under the project; a 'CRASHME' token makes the crash preload throw.
function payload(which, sb, extra = {}) {
  if (which === 'touch') return JSON.stringify({ session_id: SID, cwd: sb.proj, tool_input: { file_path: path.join(sb.proj, 'src', 'a.js') }, ...extra });
  if (which === 'stop') return JSON.stringify({ session_id: SID, cwd: sb.proj, ...extra });
  return '{}';
}

// The preload makes process.stdout.write throw (the conductor and stop hooks write their result there, outside every inner try)
// and makes path.resolve throw for a payload carrying CRASHME (the touch hook resolves the edited path outside every inner try).
function crashPreload(sb) {
  const p = path.join(sb.root, 'crash-preload.cjs');
  fs.writeFileSync(p, [
    "const path = require('path');",
    "const msg = process.env.HATCH_CRASH_MSG || 'boom';",
    'const realResolve = path.resolve;',
    "path.resolve = function (...a) { if (a.some((x) => typeof x === 'string' && x.includes('CRASHME'))) throw new Error(msg); return realResolve.apply(this, a); };",
    'process.stdout.write = function () { throw new Error(msg); };',
    '',
  ].join('\n'), 'utf8');
  return p;
}

function run(which, sb, { debug, input, extraEnv = {}, preload, args = [] } = {}) {
  const env = { ...process.env, TEMP: sb.tmp, TMP: sb.tmp, TMPDIR: sb.tmp, USERPROFILE: sb.home, HOME: sb.home, ...extraEnv };
  for (const k of CLEAR) delete env[k];
  if (debug !== undefined) env.COALMINE_DEBUG = debug;
  const nodeArgs = [...(preload ? ['--require', preload] : []), FILE[which], ...args];
  return spawnSync(process.execPath, nodeArgs, {
    input: input !== undefined ? input : payload(which, sb),
    encoding: 'utf8',
    cwd: sb.proj,
    env,
    timeout: 60000,
  });
}

// Every entry under dir, relative, sorted: the listing two runs are compared by.
function listTree(dir, rel = '', out = []) {
  if (!fs.existsSync(dir)) return out;
  const ents = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of ents) {
    const r = path.join(rel, e.name);
    out.push(r);
    if (e.isDirectory()) listTree(path.join(dir, e.name), r, out);
  }
  return out;
}

function readHatch(sb) {
  return fs.readFileSync(path.join(sb.home, ...HATCH_FILE), 'utf8');
}

// Records one edit the touch hook would record (hatch off), so the stop hook has a nudge to write.
function primeEdit(sb) {
  fs.mkdirSync(path.join(sb.proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(sb.proj, 'src', 'a.js'), 'x\n', 'utf8');
  run('touch', sb, { debug: undefined });
}

test('hatch-1 off: unset and empty COALMINE_DEBUG give the same stdout, stderr, exit code and home listing for all three hooks, with no debug-hatch file; the touch marker still lands (positive twin)', (t) => {
  for (const which of HOOKS) {
    const a = sandbox(t);
    const b = sandbox(t);
    const ra = run(which, a, { debug: undefined });
    const rb = run(which, b, { debug: '' });
    assert.equal(ra.stdout, rb.stdout, `${which}: stdout differs between unset and empty`);
    assert.equal(ra.stderr, rb.stderr, `${which}: stderr differs between unset and empty`);
    assert.equal(ra.status, rb.status, `${which}: exit code differs between unset and empty`);
    assert.deepEqual(listTree(a.home), listTree(b.home), `${which}: home listing differs between unset and empty`);
    assert.ok(!listTree(a.home).some((p) => p.includes('debug-hatch')), `${which}: a debug-hatch file exists with COALMINE_DEBUG unset`);
    assert.ok(!listTree(b.home).some((p) => p.includes('debug-hatch')), `${which}: a debug-hatch file exists with COALMINE_DEBUG empty`);
  }
  // positive twin: the touch hook ran and wrote its normal per-session marker in the temp folder, with the hatch off
  const c = sandbox(t);
  run('touch', c, { debug: undefined });
  const markers = fs.readdirSync(path.join(c.tmp, 'coalmine'));
  assert.ok(markers.some((m) => m.startsWith(`rot-canary-${SID}`)), `the touch hook wrote no marker: ${markers.join(',')}`);
});

test('hatch-2 on: with COALMINE_DEBUG=1 each hook writes a parseable start record and its stdout and stderr equal the hatch-off run', (t) => {
  for (const which of HOOKS) {
    const off = sandbox(t);
    const on = sandbox(t);
    const roff = run(which, off, { debug: undefined });
    const ron = run(which, on, { debug: '1' });
    assert.equal(ron.stdout, roff.stdout, `${which}: stdout changed with the hatch on`);
    assert.equal(ron.stderr, roff.stderr, `${which}: stderr changed with the hatch on`);
    const lines = readHatch(on).split('\n').filter(Boolean);
    assert.ok(lines.length >= 1, `${which}: no record written with the hatch on`);
    const first = JSON.parse(lines[0]);
    assert.equal(first.ev, 'start', `${which}: first record is not start: ${lines[0]}`);
    assert.equal(first.hook, path.basename(FILE[which], '.js'), `${which}: record names the wrong hook`);
  }
});

test('hatch-3 exit: on and off give the same exit code on the normal, guard, bad-stdin and crash paths for all three hooks', (t) => {
  const pre = (sb) => crashPreload(sb);
  for (const which of HOOKS) {
    // normal path
    const n1 = sandbox(t); const n2 = sandbox(t);
    assert.equal(run(which, n2, { debug: '1' }).status, run(which, n1, { debug: undefined }).status, `${which}: normal path exit differs`);
    // guard path: the conductor's enableConductor switch, the canary's rotCanaryMode switch for touch and stop
    const g1 = sandbox(t); const g2 = sandbox(t);
    const cfg = which === 'conductor' ? { enableConductor: false } : { rotCanaryMode: 'off' };
    writeGlobalConfig(g1, cfg); writeGlobalConfig(g2, cfg);
    assert.equal(run(which, g2, { debug: '1' }).status, run(which, g1, { debug: undefined }).status, `${which}: guard path exit differs`);
    // bad-stdin path
    const b1 = sandbox(t); const b2 = sandbox(t);
    assert.equal(run(which, b2, { debug: '1', input: 'not json {' }).status, run(which, b1, { debug: undefined, input: 'not json {' }).status, `${which}: bad-stdin exit differs`);
    // crash path: the preload makes stdout throw; the stop hook writes only when it has a nudge, so it needs one recorded edit first
    const c1 = sandbox(t); const c2 = sandbox(t);
    if (which === 'stop') { primeEdit(c1); primeEdit(c2); }
    const crashInput = payload(which, c1, { tool_input: { file_path: path.join(c1.proj, 'CRASHME.js') } });
    const pa = pre(c1); const pb = pre(c2);
    const rc1 = run(which, c1, { debug: undefined, preload: pa, input: crashInput, extraEnv: { HATCH_CRASH_MSG: 'boom' } });
    const rc2 = run(which, c2, { debug: '1', preload: pb, input: crashInput, extraEnv: { HATCH_CRASH_MSG: 'boom' } });
    assert.equal(rc2.status, rc1.status, `${which}: crash path exit differs`);
    assert.ok(readHatch(c2).includes('"ev":"crash"'), `${which}: the crash path did not run (no crash record)`);
  }
});

test('hatch-4 unwritable: HOME and USERPROFILE at a regular file: ON exits 0, prints nothing, and the touch marker still lands in TEMP', (t) => {
  const sb = sandbox(t);
  const fileAsHome = path.join(sb.root, 'not-a-folder');
  fs.writeFileSync(fileAsHome, 'x', 'utf8');
  const hostile = { ...sb, home: fileAsHome };
  const r = run('touch', hostile, { debug: '1' });
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  assert.equal(r.stdout, '', `stdout not silent: ${r.stdout}`);
  assert.equal(r.stderr, '', `stderr not silent: ${r.stderr}`);
  const markers = fs.readdirSync(path.join(sb.tmp, 'coalmine'));
  assert.ok(markers.some((m) => m.startsWith(`rot-canary-${SID}`)), 'the touch marker was not written: a failed hatch took the hook down');
});

test('hatch-5 rotation: a live file just under the bound is moved to debug-hatch.1.jsonl, the new record lands in a fresh live file, and the two stay under twice the bound', (t) => {
  const sb = sandbox(t);
  const dir = path.join(sb.home, ...HATCH_FILE.slice(0, -1));
  fs.mkdirSync(dir, { recursive: true });
  const old = 'OLD\n'.repeat(Math.floor((HATCH_MAX_BYTES - 40) / 4));
  fs.writeFileSync(path.join(sb.home, ...HATCH_FILE), old, 'utf8');
  const r = run('touch', sb, { debug: '1' });
  assert.equal(r.status, 0, r.stderr);
  const rotated = fs.readFileSync(path.join(sb.home, ...HATCH_OLD), 'utf8');
  assert.equal(rotated, old, 'the old bytes were not moved to the rotated file');
  const live = readHatch(sb);
  assert.ok(!live.includes('OLD\n'), 'the live file still holds old bytes');
  assert.equal(JSON.parse(live.split('\n').filter(Boolean)[0]).ev, 'start', 'the new record is not in the fresh live file');
  const sum = fs.statSync(path.join(sb.home, ...HATCH_FILE)).size + fs.statSync(path.join(sb.home, ...HATCH_OLD)).size;
  assert.ok(sum < 2 * HATCH_MAX_BYTES, `the two files total ${sum} bytes, over twice the bound`);
});

test('hatch-6 structure: planted newline, CR, U+2028 and path words in the payload never reach the file; every line parses alone; a crash record carries err and at, and the planted message never does', (t) => {
  const PLANT_PATH = 'PLANT-PATH-XYZ';
  const PLANT_PROJ = 'PLANT-PROJ-XYZ';
  const PLANT_MSG = 'PLANT-MSG-XYZ';
  const sb = sandbox(t);
  const nasty = path.join(sb.proj, `${PLANT_PATH}\nline\r end`, 'src', 'a.js');
  const projName = path.join(sb.root, PLANT_PROJ);
  fs.mkdirSync(projName);
  const input = JSON.stringify({ session_id: SID, cwd: projName, tool_input: { file_path: nasty } });
  const normal = run('touch', { ...sb, proj: projName }, { debug: '1', input });
  assert.equal(normal.status, 0, normal.stderr);
  const bytes = fs.readFileSync(path.join(sb.home, ...HATCH_FILE), 'utf8');
  assert.ok(!bytes.includes(PLANT_PATH) && !bytes.includes(PLANT_PROJ), 'a planted payload word reached the hatch file');
  for (const ln of bytes.split('\n').filter(Boolean)) JSON.parse(ln);

  const c = sandbox(t);
  const pre = crashPreload(c);
  const crashInput = JSON.stringify({ session_id: SID, cwd: c.proj, tool_input: { file_path: path.join(c.proj, 'CRASHME.js') } });
  const cr = run('touch', c, { debug: '1', preload: pre, input: crashInput, extraEnv: { HATCH_CRASH_MSG: `${PLANT_MSG}\n/home/${PLANT_MSG}/secret.js:12` } });
  assert.equal(cr.status, 0, cr.stderr);
  const crBytes = readHatch(c);
  assert.ok(!crBytes.includes(PLANT_MSG), 'the planted crash message reached the hatch file');
  const crash = crBytes.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((r) => r.ev === 'crash');
  assert.ok(crash, `no crash record: ${crBytes}`);
  assert.equal(crash.err, 'Error', 'the crash record does not name the error');
  assert.match(crash.at, /^rot-canary-touch\.js:\d+$/, `at is not basename:line: ${crash.at}`);
});
