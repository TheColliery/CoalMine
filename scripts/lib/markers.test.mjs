// R14 / CWK-158 item 8 (CSV-4, CSV-6, CSV-7, B-u1-L6): the per-session temp markers live in an owner-only
// subdir, are read non-blocking and bounded, and are written without following a planted link.
// Each test plants the hostile entry at BOTH the pre-R14 flat path and the R14 subdir path, so it goes red
// on the old hook (which reads the flat path) and stays meaningful on the new one (which reads the subdir).
// POSIX-only legs (FIFO, symlink, mode bits) skip VISIBLY where the platform cannot make the fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STOP = path.join(repo, 'hooks', 'rot-canary-stop.js');
const TOUCH = path.join(repo, 'hooks', 'rot-canary-touch.js');
const HANG_MS = 20000; // a blocked read never returns; the kill proves the hang

function mkTmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-markers-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.mkdirSync(path.join(dir, 'coalmine'), { mode: 0o700 });
  return dir;
}
function runHook(script, input, tmp) {
  return spawnSync(process.execPath, [script], {
    input,
    encoding: 'utf8',
    cwd: tmp,
    timeout: HANG_MS,
    killSignal: 'SIGKILL',
    env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp, USERPROFILE: tmp, HOME: tmp, NODE_OPTIONS: '--max-old-space-size=2048' },
  });
}
function canMkfifo(dir) {
  if (process.platform === 'win32') return false;
  const p = path.join(dir, '.probe-fifo');
  if (spawnSync('mkfifo', [p], { timeout: 10000 }).status !== 0) return false;
  fs.unlinkSync(p);
  return true;
}
function stopInput(sid) { return JSON.stringify({ session_id: sid, stop_hook_active: false }); }

// A session with one real touched code file, markers planted at the R14 subdir.
function plantSession(tmp, sid) {
  const code = path.join(tmp, 'edited.js');
  fs.writeFileSync(code, 'const x = 1;\n');
  // Also at the pre-R14 flat path, so the OLD hook (which reads only the flat one) gets past its
  // "nothing touched" early return and reaches the marker this test is about: red against the old hook.
  fs.writeFileSync(path.join(tmp, 'coalmine', `rot-canary-${sid}.touched`), code + '\n');
  fs.writeFileSync(path.join(tmp, `rot-canary-${sid}.touched`), code + '\n');
  return code;
}

for (const suffix of ['.scanned', '.smells', '.touched']) {
  test(`stop hook does not hang on a FIFO planted at the ${suffix} marker (CSV-6/7)`, (t) => {
    const tmp = mkTmp(t);
    if (!canMkfifo(tmp)) { t.skip('no mkfifo on this platform'); return; }
    const sid = 'FIFO' + suffix.slice(1).toUpperCase();
    const code = plantSession(tmp, sid);
    // FIFO at the old flat path AND the new subdir path. At .touched the FIFO replaces the real record.
    for (const dir of [tmp, path.join(tmp, 'coalmine')]) {
      const p = path.join(dir, `rot-canary-${sid}${suffix}`);
      fs.rmSync(p, { force: true });
      assert.equal(spawnSync('mkfifo', [p], { timeout: 10000 }).status, 0);
    }
    assert.ok(fs.existsSync(code));
    const r = runHook(STOP, stopInput(sid), tmp);
    assert.equal(r.error, undefined, `the hook must return, not hang (${r.error && r.error.code})`);
    assert.equal(r.status, 0, 'fail-silent exit 0');
  });
}

test('stop hook replaces a symlink planted at .scanned and never writes through it (CSV-4)', (t) => {
  const tmp = mkTmp(t);
  const victimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-markers-victim-'));
  t.after(() => fs.rmSync(victimDir, { recursive: true, force: true }));
  const victim = path.join(victimDir, 'victim.txt');
  fs.writeFileSync(victim, 'PRECIOUS\n');
  const sid = 'LINKSC';
  plantSession(tmp, sid);
  try {
    for (const dir of [tmp, path.join(tmp, 'coalmine')]) fs.symlinkSync(victim, path.join(dir, `rot-canary-${sid}.scanned`), 'file');
  } catch (e) { t.skip(`cannot create a file symlink here (${e.code})`); return; }
  const r = runHook(STOP, stopInput(sid), tmp);
  assert.equal(r.status, 0);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'PRECIOUS\n', 'the link target must be untouched');
  const ack = path.join(tmp, 'coalmine', `rot-canary-${sid}.scanned`);
  assert.ok(fs.lstatSync(ack).isFile() && !fs.lstatSync(ack).isSymbolicLink(), 'the planted link was replaced by a regular file');
});

test('touch hook records into the owner-only subdir, not the flat tmp root, and the stop hook reads it from there', (t) => {
  // The project lives outside the sandbox tmpdir, which the touch hook excludes by design.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-markers-proj-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const real = path.join(outside, 'b.js');
  fs.writeFileSync(real, 'const b = 1;\n');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-markers-sbx-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, [TOUCH], {
    input: JSON.stringify({ session_id: 'WHERE', tool_name: 'Edit', tool_input: { file_path: real } }),
    encoding: 'utf8',
    cwd: outside,
    timeout: HANG_MS,
    env: { ...process.env, TEMP: sandbox, TMP: sandbox, TMPDIR: sandbox, USERPROFILE: sandbox, HOME: sandbox },
  });
  assert.equal(r.status, 0);
  assert.ok(fs.existsSync(path.join(sandbox, 'coalmine', 'rot-canary-WHERE.touched')), 'recorded in the subdir');
  assert.ok(!fs.existsSync(path.join(sandbox, 'rot-canary-WHERE.touched')), 'nothing in the flat tmp root');
});

test('touch hook refuses a marker dir that is group/other-writable and records nothing (POSIX)', (t) => {
  if (typeof process.getuid !== 'function') { t.skip('no POSIX uid/mode semantics here'); return; }
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-markers-loose-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const dir = path.join(sandbox, 'coalmine');
  fs.mkdirSync(dir);
  fs.chmodSync(dir, 0o777);
  if ((fs.statSync(dir).mode & 0o022) === 0) { t.skip('chmod has no effect on this volume'); return; }
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-markers-proj-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const real = path.join(outside, 'c.js');
  fs.writeFileSync(real, 'const c = 1;\n');
  const r = spawnSync(process.execPath, [TOUCH], {
    input: JSON.stringify({ session_id: 'LOOSE', tool_name: 'Edit', tool_input: { file_path: real } }),
    encoding: 'utf8',
    cwd: outside,
    timeout: HANG_MS,
    env: { ...process.env, TEMP: sandbox, TMP: sandbox, TMPDIR: sandbox, USERPROFILE: sandbox, HOME: sandbox },
  });
  assert.equal(r.status, 0);
  assert.deepEqual(fs.readdirSync(dir), [], 'nothing written into a dir another user could write');
});

test('stop hook strips control characters from .smells lines before they enter the block reason (B-u1-L6)', (t) => {
  const tmp = mkTmp(t);
  const sid = 'CTRL';
  plantSession(tmp, sid);
  const esc = String.fromCharCode(27);
  fs.writeFileSync(path.join(tmp, 'coalmine', `rot-canary-${sid}.smells`), `/x/y.js: file >5 lines (9)${esc}[31mINJECT${esc}[0m\n`);
  const r = runHook(STOP, stopInput(sid), tmp);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.ok(out.reason.includes('INJECT'), 'the line itself still surfaces');
  assert.ok(!out.reason.includes(esc), 'no raw ESC reaches the model');
});
