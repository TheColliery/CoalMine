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
  // a guard path writes a guard record with its stable name; a normal stop finish writes done with its counts
  const g = sandbox(t);
  run('stop', g, { debug: '1', input: 'not json {' });
  const gl = readHatch(g).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(gl.some((r) => r.ev === 'guard' && r.guard === 'stdin-bad-json'), `no stdin-bad-json guard record: ${readHatch(g)}`);
  const n = sandbox(t);
  primeEdit(n);
  run('stop', n, { debug: '1' });
  const done = readHatch(n).split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((r) => r.ev === 'done');
  assert.ok(done, `no done record after a normal stop: ${readHatch(n)}`);
  assert.equal(done.lane, 'cc', 'done does not name the CC lane');
  assert.equal(done.files, 1, `done does not count the one extant edit: ${done.files}`);
  assert.equal(done.reported, true, 'done does not say the scan was reported');
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

const DAY_MS = 24 * 60 * 60 * 1000;
const hatchFile = (sb, which) => path.join(sb.home, ...(which === 'live' ? HATCH_FILE : HATCH_OLD));
function plantHatchPair(sb, when) {
  for (const which of ['live', 'old']) {
    const p = hatchFile(sb, which);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{"ev":"start"}\n', 'utf8');
    fs.utimesSync(p, when, when);
  }
}

test('hatch-5 collector: the stop hook reaps a stale hatch pair with COALMINE_DEBUG unset, with canary mode off, and with temp coalmine planted as a file; it keeps a fresh pair; a machine with no hatch file grows no coal folder', (t) => {
  const old = new Date(Date.now() - 30 * DAY_MS);
  const a = sandbox(t);
  plantHatchPair(a, old);
  const ra = run('stop', a, { debug: undefined });
  assert.equal(ra.status, 0, ra.stderr);
  assert.equal(fs.existsSync(hatchFile(a, 'live')), false, 'the stale live hatch file survived the stop hook');
  assert.equal(fs.existsSync(hatchFile(a, 'old')), false, 'the stale rotated hatch file survived the stop hook');

  const b = sandbox(t); // positive twin: a fresh pair is not reaped
  plantHatchPair(b, new Date());
  run('stop', b, { debug: undefined });
  assert.ok(fs.existsSync(hatchFile(b, 'live')) && fs.existsSync(hatchFile(b, 'old')), 'a fresh hatch pair was reaped');

  const c = sandbox(t); // canary mode off still reaps
  fs.mkdirSync(path.join(c.home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(c.home, '.claude', '.rot-canary-mode'), 'off', 'utf8');
  plantHatchPair(c, old);
  run('stop', c, { debug: undefined });
  assert.equal(fs.existsSync(hatchFile(c, 'live')), false, 'canary mode off stopped the collector');

  const d = sandbox(t); // temp coalmine planted as a regular file (ensureMarkerDir refuses it) still reaps
  fs.rmSync(path.join(d.tmp, 'coalmine'), { recursive: true, force: true });
  fs.writeFileSync(path.join(d.tmp, 'coalmine'), 'x', 'utf8');
  plantHatchPair(d, old);
  run('stop', d, { debug: undefined });
  assert.equal(fs.existsSync(hatchFile(d, 'live')), false, 'a temp coalmine planted as a file stopped the collector');

  const e = sandbox(t); // no hatch file: the collector reads nothing and creates no coal folder
  run('stop', e, { debug: undefined });
  assert.equal(fs.existsSync(path.join(e.home, '.claude', 'coal')), false, 'a machine with no hatch file grew a coal folder');
});

const HOOK_FILES = ['rot-canary-touch.js', 'rot-canary-stop.js', 'coalmine-conductor.js'];
const TRY_MAIN = 'try { main(); } catch (e) { hatchCrash(e); }';
test('hatch-7 copies: each shipped hook, in hooks/ and plugin/hooks/, carries the debug-hatch region and ends in the crash catch, has no sibling require, and only the stop hook carries the collector region', () => {
  for (const dir of ['hooks', path.join('plugin', 'hooks')]) {
    for (const f of HOOK_FILES) {
      const text = fs.readFileSync(path.join(repo, dir, f), 'utf8');
      const where = `${dir}/${f}`;
      assert.ok(text.includes('// <coalmine-shared: debug-hatch>'), `${where}: no debug-hatch region`);
      assert.ok(text.trimEnd().endsWith(TRY_MAIN), `${where}: the file does not end in the crash catch`);
      assert.doesNotMatch(text, /\brequire\(\s*['"]\.\.?\//, `${where}: a require of a relative path`);
      const hasSweep = text.includes('// <coalmine-shared: debug-hatch-sweep>');
      assert.equal(hasSweep, f === 'rot-canary-stop.js', `${where}: the collector region is ${hasSweep ? 'present' : 'absent'}`);
    }
  }
});

// The bodies R6 names: a bare `return;` in one is a silent exit that leaves no record. A line comment is not code.
function bodyOf(text, name) {
  const start = text.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `no function ${name} in the file`);
  const end = text.indexOf('\n}\n', start);
  assert.ok(end !== -1, `no closing brace for ${name}`);
  return text.slice(start, end).split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}
test('hatch-7 guards: no bare return leaves main() of the touch and stop hooks or agMain and geminiMain of the conductor, and every guard carries a literal name', () => {
  const slices = [
    ['rot-canary-touch.js', 'main'], ['rot-canary-stop.js', 'main'],
    ['coalmine-conductor.js', 'agMain'], ['coalmine-conductor.js', 'geminiMain'],
  ];
  for (const dir of ['hooks', path.join('plugin', 'hooks')]) {
    for (const [f, name] of slices) {
      const body = bodyOf(fs.readFileSync(path.join(repo, dir, f), 'utf8'), name);
      const bare = body.split('\n').filter((l) => /\breturn\s*;/.test(l));
      assert.deepEqual(bare, [], `${dir}/${f} ${name}: a bare return leaves it: ${bare.join(' | ')}`);
      const unnamed = body.match(/hatchGuard\((?!'[a-z][a-z-]*'\))/g);
      assert.equal(unnamed, null, `${dir}/${f} ${name}: a guard without a literal name`);
    }
  }
});

// hatch-8 report: the problem-report reference, read as text (no spawn). Its step 3 must name exactly the fields the hooks write.
const REPORT = path.join(repo, 'skills', '_shared', 'references', 'problem-report.md');
const FOOTER = path.join(repo, 'skills', '_shared', 'escalation-footer.md');
function step3Of(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('3. **Scrub it.**'));
  const end = lines.findIndex((l, i) => i > start && /^4\. /.test(l));
  assert.ok(start !== -1 && end !== -1, 'step 3 is not found between its markers');
  return lines.slice(start, end).join('\n');
}
// The names the hooks can write: the keys of each hatch(...) call in the hook sources, the record's own fields in the partial, and the guard and crash fields.
function writtenNames() {
  const names = new Set(['guard', 'err', 'code', 'at']);
  for (const f of HOOK_FILES) {
    const src = fs.readFileSync(path.join(repo, 'hooks', f), 'utf8');
    for (const m of src.matchAll(/\bhatch\('[a-z]+',\s*\{([^}]*)\}\)/g)) {
      for (const k of m[1].matchAll(/([A-Za-z_]\w*)\s*:/g)) names.add(k[1]);
    }
  }
  const partial = fs.readFileSync(path.join(repo, 'hooks', '_shared', 'debug-hatch.js'), 'utf8');
  const rec = partial.match(/Object\.assign\(\{\}, fields \|\| \{\}, \{([\s\S]*?)\}\);/);
  assert.ok(rec, 'the record literal is not found in the partial');
  for (const k of rec[1].matchAll(/^\s*([A-Za-z_]\w*)\s*[:,]/gm)) names.add(k[1]);
  return names;
}
test('hatch-8 report: the reference names the variable, both files and the sweep days, forbids setting the variable, leaves the submit to the user, and its step 3 lists exactly the names the hooks write; the footers and every plugin skill point at it', () => {
  const report = fs.readFileSync(REPORT, 'utf8');
  for (const must of ['COALMINE_DEBUG', 'debug-hatch.jsonl', 'debug-hatch.1.jsonl', 'tempSweepStaleDays']) {
    assert.ok(report.includes(must), `the reference does not name ${must}`);
  }
  assert.ok(report.includes('Never set the variable yourself'), 'the reference does not forbid the agent setting the variable');
  assert.ok(report.includes('The user reads the whole draft and submits it'), 'the reference does not leave the submit to the user');
  const footerLine = fs.readFileSync(FOOTER, 'utf8').split('\n').find((l) => l.startsWith('**Self error-report:**'));
  assert.ok(footerLine && footerLine.includes('references/problem-report.md'), 'the footer Self error-report line does not name the reference');
  const condLine = fs.readFileSync(path.join(repo, 'hooks', 'coalmine-conductor.js'), 'utf8').split('\n').find((l) => l.includes('Self error-report:'));
  assert.ok(condLine && condLine.includes('references/problem-report.md'), 'the conductor Self error-report string does not name the reference');
  const skillsDir = path.join(repo, 'plugin', 'skills');
  for (const d of fs.readdirSync(skillsDir).filter((n) => fs.statSync(path.join(skillsDir, n)).isDirectory())) {
    assert.ok(fs.existsSync(path.join(skillsDir, d, 'references', 'problem-report.md')), `${d} carries no references/problem-report.md`);
  }
  const named = new Set([...step3Of(report).matchAll(/`([^`]+)`/g)].map((m) => m[1]));
  const written = writtenNames();
  const missing = [...written].filter((n) => !named.has(n)).sort();
  const extra = [...named].filter((n) => !written.has(n)).sort();
  assert.deepEqual(missing, [], `step 3 does not name ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `step 3 names what no hook writes: ${extra.join(', ')}`);
});


test('hatch-6 fields: a planted error name or code becomes redacted, a plain code and a 64-character word survive, a 65-character word does not', (t) => {
  const cases = [
    { name: 'C:/Users/alice/proj', code: 'ENOENT', err: 'redacted', kept: 'ENOENT' },
    { name: 'Bad' + String.fromCharCode(10) + 'Name', code: '/home/alice/x', err: 'redacted', kept: 'redacted' },
    { name: 'A'.repeat(64), code: 'B'.repeat(65), err: 'A'.repeat(64), kept: 'redacted' },
  ];
  for (const c of cases) {
    const sb = sandbox(t);
    const pre = path.join(sb.root, 'field-preload.cjs');
    // The preload's source is a fixed string: the case travels in a sibling JSON file, so no value is ever put into generated source.
    fs.writeFileSync(path.join(sb.root, 'field-case.json'), JSON.stringify(c), 'utf8');
    fs.writeFileSync(pre, [
      "const fs = require('fs');",
      "const path = require('path');",
      "const kase = JSON.parse(fs.readFileSync(path.join(__dirname, 'field-case.json'), 'utf8'));",
      'const realResolve = path.resolve;',
      "path.resolve = function (...a) { if (a.some((x) => typeof x === 'string' && x.includes('CRASHME'))) { const e = new Error('boom'); e.name = kase.name; e.code = kase.code; throw e; } return realResolve.apply(this, a); };",
      '',
    ].join('\n'), 'utf8');
    const input = payload('touch', sb, { tool_input: { file_path: path.join(sb.proj, 'CRASHME.js') } });
    const r = run('touch', sb, { debug: '1', preload: pre, input });
    assert.equal(r.status, 0, r.stderr);
    const rec = readHatch(sb).trim().split('\n').map((l) => JSON.parse(l)).find((x) => x.ev === 'crash');
    assert.ok(rec, 'no crash record was written');
    assert.equal(rec.err, c.err);
    assert.equal(rec.code, c.kept);
    assert.equal(rec.severity, 'ERROR');
  }
});

test('hatch-5 days: the collector keeps a pair younger than the days set in the global config and reaps one older', (t) => {
  const a = sandbox(t);
  writeGlobalConfig(a, { tempSweepStaleDays: 30 });
  plantHatchPair(a, new Date(Date.now() - 10 * DAY_MS));
  run('stop', a, { debug: undefined });
  assert.ok(fs.existsSync(hatchFile(a, 'live')) && fs.existsSync(hatchFile(a, 'old')), 'a 10-day pair was reaped under a 30-day global setting');
  const b = sandbox(t);
  writeGlobalConfig(b, { tempSweepStaleDays: 2 });
  plantHatchPair(b, new Date(Date.now() - 3 * DAY_MS));
  run('stop', b, { debug: undefined });
  assert.equal(fs.existsSync(hatchFile(b, 'live')), false, 'a 3-day pair survived a 2-day global setting');
  // F2 leg: a project file (1 day) in the cwd the stop hook runs in has no say over a file in the user's home: a 2-day pair stays under a 30-day global.
  const c = sandbox(t);
  writeGlobalConfig(c, { tempSweepStaleDays: 30 });
  fs.mkdirSync(path.join(c.proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(c.proj, '.claude', '.coalmine.json'), JSON.stringify({ tempSweepStaleDays: 1 }), 'utf8');
  plantHatchPair(c, new Date(Date.now() - 2 * DAY_MS));
  run('stop', c, { debug: undefined });
  assert.ok(fs.existsSync(hatchFile(c, 'live')) && fs.existsSync(hatchFile(c, 'old')), 'a project value of 1 day reaped a 2-day pair under a 30-day global setting');
});

test('hatch-4 mode: the record is created at 0600 where the file system keeps modes (skipped visibly where it does not)', (t) => {
  const sb = sandbox(t);
  const probe = path.join(sb.root, 'mode-probe');
  fs.writeFileSync(probe, 'x', { mode: 0o600 });
  if ((fs.statSync(probe).mode & 0o777) !== 0o600) { t.skip('this file system does not keep POSIX modes'); return; }
  run('touch', sb, { debug: '1' });
  assert.equal(fs.statSync(path.join(sb.home, ...HATCH_FILE)).mode & 0o777, 0o600);
});

test('hatch-2 honest done: a folder at the touched marker gives a touched-write-failed guard and no recorded line; a normal run gives recorded', (t) => {
  const bad = sandbox(t);
  fs.mkdirSync(path.join(bad.proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(bad.proj, 'src', 'a.js'), 'x\n', 'utf8');
  fs.mkdirSync(path.join(bad.tmp, 'coalmine', 'rot-canary-' + SID + '.touched'));
  run('touch', bad, { debug: '1' });
  const bl = readHatch(bad).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(bl.some((r) => r.ev === 'guard' && r.guard === 'touched-write-failed'), 'no touched-write-failed guard record: ' + readHatch(bad));
  assert.ok(!bl.some((r) => r.ev === 'done' && r.recorded === true), 'a done record claims recorded though the marker was not written');
  const ok = sandbox(t);
  fs.mkdirSync(path.join(ok.proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(ok.proj, 'src', 'a.js'), 'x\n', 'utf8');
  run('touch', ok, { debug: '1' });
  const ol = readHatch(ok).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(ol.some((r) => r.ev === 'done' && r.recorded === true), 'a normal run did not write a recorded done record');
});

test('hatch-2 honest memory: with no marker folder a MEMORY.md edit gives a memory-marker-failed guard and no memory line; a normal run gives memory at INFO', (t) => {
  const records = (sb) => readHatch(sb).trim().split('\n').map((l) => JSON.parse(l));
  const input = (sb) => payload('touch', sb, { tool_input: { file_path: path.join(sb.proj, 'MEMORY.md') } });
  const a = sandbox(t);
  fs.rmSync(path.join(a.tmp, 'coalmine'), { recursive: true });
  fs.writeFileSync(path.join(a.tmp, 'coalmine'), 'x', 'utf8');
  run('touch', a, { debug: '1', input: input(a) });
  assert.ok(records(a).some((x) => x.guard === 'memory-marker-failed'), 'no memory-marker-failed guard');
  assert.ok(!records(a).some((x) => x.memory === true), 'a failed marker still reads memory: true');
  const b = sandbox(t);
  run('touch', b, { debug: '1', input: input(b) });
  assert.ok(records(b).some((x) => x.memory === true && x.severity === 'INFO'), 'no memory line at INFO');
});
