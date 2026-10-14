// 14a LOW-3 (09b INSPECT unit 2): a killed FIRST install used to leave a partial skill folder with no skill-meta.json and no
// manifest, which every later install refused and uninstall left behind. The cure: installSkillDir builds the folder inside a
// sibling work folder (`.<skill>.coalmine-tmp-<pid>`, marked), proves it complete, and renames it into place; the next install
// sweeps a dead installer's work folder, narrowly (a directory, a marker file, a dead pid, a realpath directly inside the parent).
// Hermetic: every installer child runs with cwd, HOME, USERPROFILE and TEMP in a fixture under os.tmpdir(), heap-capped and timed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALL = path.join(repo, 'scripts', 'install.mjs');
const RENDER = pathToFileURL(path.join(repo, 'scripts', 'lib', 'render.mjs')).href;
const TIMEOUT = 100000;

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-low3-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // SIGKILL the installer on the Nth fs.copyFileSync (a real kill mid-copy), or on the write of a SKILL.md (the last step of a skill).
  const pre = path.join(dir, 'kill-preload.mjs');
  fs.writeFileSync(pre, [
    "import fs from 'node:fs';",
    'const N = Number(process.env.KILL_AT || 0);',
    'if (N > 0) { const real = fs.copyFileSync; let n = 0; fs.copyFileSync = function (...a) { if (++n === N) process.kill(process.pid, "SIGKILL"); return real.apply(this, a); }; }',
    'if (process.env.KILL_AT_SKILLMD === "1") { const real = fs.writeFileSync; fs.writeFileSync = function (f, ...a) { if (String(f).endsWith("SKILL.md")) process.kill(process.pid, "SIGKILL"); return real.call(this, f, ...a); }; }',
    '',
  ].join('\n'));
  return { dir, pre: pathToFileURL(pre).href };
}
function install(sb, cwd, args, env = {}) {
  return spawnSync(process.execPath, ['--max-old-space-size=512', '--import', sb.pre, INSTALL, ...args], {
    cwd, encoding: 'utf8', timeout: TIMEOUT, killSignal: 'SIGKILL',
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: sb.dir, USERPROFILE: sb.dir, TEMP: sb.dir, TMP: sb.dir, TMPDIR: sb.dir, ...env },
  });
}
// A SIGKILL reads as exit null + signal on POSIX and as exit 1 on Windows (TerminateProcess), so the control is: no clean exit and no closing summary line.
const wasKilled = (r) => r.status !== 0 && !/^Done:/m.test(r.stdout);
const files = (d) => {
  const out = [];
  const walk = (a, r) => { for (const e of fs.readdirSync(a, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(a, e.name), r + e.name + '/'); else out.push(r + e.name); } };
  walk(d, '');
  return out.sort();
};
const skillDirs = (dest) => fs.readdirSync(dest, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
const dotEntries = (dest) => fs.readdirSync(dest).filter((n) => n.startsWith('.')).sort();
// The reference: a clean install into its own fixture, to compare every later state against.
function reference(sb) {
  const proj = path.join(sb.dir, 'ref'); fs.mkdirSync(proj);
  const dest = path.join(proj, 'skills');
  const r = install(sb, proj, [dest]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const tree = {};
  for (const s of skillDirs(dest)) tree[s] = files(path.join(dest, s));
  assert.ok(Object.keys(tree).length >= 9, 'control: the reference install holds every skill');
  return tree;
}
function assertComplete(dest, ref, why) {
  assert.deepEqual(skillDirs(dest), Object.keys(ref).sort(), `${why}: every skill folder present`);
  for (const s of Object.keys(ref)) assert.deepEqual(files(path.join(dest, s)), ref[s], `${why}: ${s} is whole`);
}

for (const [label, env] of [['copy 1', { KILL_AT: '1' }], ['copy 3', { KILL_AT: '3' }], ['the SKILL.md write', { KILL_AT_SKILLMD: '1' }]]) {
  test(`LOW-3: a FIRST install killed at ${label} leaves no PARTIAL skill folder, and the next install completes with exit 0 and every skill`, (t) => {
    const sb = sandbox(t);
    const ref = reference(sb);
    const proj = path.join(sb.dir, 'p'); fs.mkdirSync(proj);
    const dest = path.join(proj, 'skills');
    const killed = install(sb, proj, [dest], env);
    assert.ok(wasKilled(killed), 'control: the installer really was killed before its summary line');
    // Skills finished before the kill are whole (a copy-1 kill lands in the first skill, so none exist); the one in flight lives only in the work folder.
    for (const s of skillDirs(dest)) assert.deepEqual(files(path.join(dest, s)), ref[s], `${s} is whole or absent, never partial`);
    assert.ok(skillDirs(dest).length < Object.keys(ref).length, 'control: the kill really cut the run short');
    const again = install(sb, proj, [dest]);
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.doesNotMatch(again.stdout + again.stderr, /\[refused\]/);
    assertComplete(dest, ref, 'after the next install');
    assert.deepEqual(dotEntries(dest), ['.coalmine-manifest.json'], 'the dead installer\'s work folder is gone and only the manifest is dotted');
  });
}

test('LOW-3: a REINSTALL killed mid-copy leaves every previously installed skill whole, and the next install completes', (t) => {
  const sb = sandbox(t);
  const ref = reference(sb);
  const proj = path.join(sb.dir, 'p'); fs.mkdirSync(proj);
  const dest = path.join(proj, 'skills');
  assert.equal(install(sb, proj, [dest]).status, 0);
  const killed = install(sb, proj, [dest], { KILL_AT: '3' });
  assert.ok(wasKilled(killed), 'control: killed');
  assertComplete(dest, ref, 'after the killed reinstall');
  const again = install(sb, proj, [dest]);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assertComplete(dest, ref, 'after the next install');
  assert.deepEqual(dotEntries(dest), ['.coalmine-manifest.json']);
});

test('LOW-3: an uninstall after a killed first install removes the dead work folder and leaves nothing behind', (t) => {
  const sb = sandbox(t);
  const proj = path.join(sb.dir, 'p'); fs.mkdirSync(proj);
  const dest = path.join(proj, 'skills');
  assert.ok(wasKilled(install(sb, proj, [dest], { KILL_AT: '3' })), 'control: killed');
  assert.ok(dotEntries(dest).some((n) => n.includes('.coalmine-tmp-')), 'control: the kill left a work folder');
  const un = install(sb, proj, ['--uninstall', dest]);
  assert.equal(un.status, 0, un.stdout + un.stderr);
  assert.deepEqual(fs.readdirSync(dest), [], 'nothing of CoalMine is left');
});

// ---- the in-process legs: the leftover sweep's refusals and the rename-failure branch (a fault-injection seam on fs.renameSync) ----
const render = await import(RENDER);
const PID_DEAD = 2147483000; // far above any live pid on the box; process.kill(pid, 0) answers ESRCH
function leftover(parent, skill, pid, { marker = true } = {}) {
  const w = path.join(parent, `.${skill}.coalmine-tmp-${pid}`);
  fs.mkdirSync(path.join(w, 'new'), { recursive: true });
  fs.writeFileSync(path.join(w, 'new', 'half.md'), 'x');
  if (marker) fs.writeFileSync(path.join(w, '.coalmine-installing'), String(pid));
  return w;
}

test('LOW-3 sweep: a dead installer\'s MARKED work folder directly inside the parent is removed; nothing else is touched', (t) => {
  const sb = sandbox(t);
  const parent = path.join(sb.dir, 'skills'); fs.mkdirSync(parent);
  const w = leftover(parent, 'rot-canary', PID_DEAD);
  fs.mkdirSync(path.join(parent, 'rot-canary')); fs.writeFileSync(path.join(parent, 'rot-canary', 'keep.md'), 'user');
  const removed = render.sweepInstallLeftovers(parent);
  assert.deepEqual(removed, ['.rot-canary.coalmine-tmp-' + PID_DEAD]);
  assert.ok(!fs.existsSync(w));
  assert.equal(fs.readFileSync(path.join(parent, 'rot-canary', 'keep.md'), 'utf8'), 'user');
});

test('LOW-3 sweep: a folder with the temp NAME but no installer marker is kept (the marker is the proof, the name is not)', (t) => {
  const sb = sandbox(t);
  const parent = path.join(sb.dir, 'skills'); fs.mkdirSync(parent);
  const w = leftover(parent, 'rot-canary', PID_DEAD, { marker: false });
  assert.deepEqual(render.sweepInstallLeftovers(parent), []);
  assert.ok(fs.existsSync(path.join(w, 'new', 'half.md')));
});

test('LOW-3 sweep: a temp-named LINK to a folder outside the parent is never followed, even with a marker behind it', (t) => {
  const sb = sandbox(t);
  const parent = path.join(sb.dir, 'skills'); fs.mkdirSync(parent);
  const outside = path.join(sb.dir, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, '.coalmine-installing'), 'x'); fs.writeFileSync(path.join(outside, 'precious.md'), 'keep');
  fs.symlinkSync(outside, path.join(parent, `.rot-canary.coalmine-tmp-${PID_DEAD}`), 'junction');
  assert.deepEqual(render.sweepInstallLeftovers(parent), []);
  assert.equal(fs.readFileSync(path.join(outside, 'precious.md'), 'utf8'), 'keep');
});

test('LOW-3 sweep: a work folder whose installer is still ALIVE (another pid, or this process) is left alone', (t) => {
  const sb = sandbox(t);
  const parent = path.join(sb.dir, 'skills'); fs.mkdirSync(parent);
  const mine = leftover(parent, 'a-skill', process.pid);
  const live = spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1)'], { timeout: 30000 });
  assert.equal(live.status, 0);
  assert.deepEqual(render.sweepInstallLeftovers(parent), []);
  assert.ok(fs.existsSync(mine), 'this process\'s own work folder is never swept');
});

function fixtureSkill(sb) {
  const from = path.join(sb.dir, 'src'); fs.mkdirSync(path.join(from, 'references'), { recursive: true });
  fs.writeFileSync(path.join(from, 'SKILL.md'), '# skill\n');
  fs.writeFileSync(path.join(from, 'skill-meta.json'), '{}');
  fs.writeFileSync(path.join(from, 'references', 'a.md'), 'a');
  const shared = { languageHeader: 'LANG', orchestration: 'ORCH', escalationFooter: 'ESC', reportingFooter: 'REP', sharedReferences: {} };
  return { from, shared };
}
function withRename(fake, fn) {
  const real = fs.renameSync;
  fs.renameSync = function (a, b) { return fake(real, a, b); };
  try { return fn(); } finally { fs.renameSync = real; }
}
const eperm = () => Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });

test('LOW-3 rename failure: the move of the NEW folder into place fails (EPERM) -> the old folder is restored byte for byte, the work folder is gone, the error surfaces, no in-place copy', (t) => {
  const sb = sandbox(t);
  const { from, shared } = fixtureSkill(sb);
  const to = path.join(sb.dir, 'skills', 'sk'); fs.mkdirSync(to, { recursive: true });
  fs.writeFileSync(path.join(to, 'old.md'), 'OLD');
  assert.throws(() => withRename((real, a, b) => { if (path.resolve(b) === path.resolve(to) && String(a).endsWith(path.join('new'))) throw eperm(); return real(a, b); },
    () => render.installSkillDir(from, to, shared)), /EPERM/);
  assert.deepEqual(files(to), ['old.md'], 'the previous install is exactly as it was: nothing of the new copy leaked in');
  assert.equal(fs.readFileSync(path.join(to, 'old.md'), 'utf8'), 'OLD');
  assert.deepEqual(fs.readdirSync(path.join(sb.dir, 'skills')), ['sk'], 'no work folder is left');
});

test('LOW-3 rename failure: the old folder cannot be moved aside (EBUSY, a process holds it) -> nothing changed, work folder gone, error surfaces', (t) => {
  const sb = sandbox(t);
  const { from, shared } = fixtureSkill(sb);
  const to = path.join(sb.dir, 'skills', 'sk'); fs.mkdirSync(to, { recursive: true });
  fs.writeFileSync(path.join(to, 'old.md'), 'OLD');
  assert.throws(() => withRename((real, a, b) => { if (path.resolve(a) === path.resolve(to)) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); return real(a, b); },
    () => render.installSkillDir(from, to, shared)), /EBUSY/);
  assert.deepEqual(files(to), ['old.md']);
  assert.deepEqual(fs.readdirSync(path.join(sb.dir, 'skills')), ['sk']);
});

test('LOW-3 rename failure: when the restore ALSO fails the work folder is kept (it holds the only copy of the old install) and the error names it', (t) => {
  const sb = sandbox(t);
  const { from, shared } = fixtureSkill(sb);
  const to = path.join(sb.dir, 'skills', 'sk'); fs.mkdirSync(to, { recursive: true });
  fs.writeFileSync(path.join(to, 'old.md'), 'OLD');
  let err;
  try {
    withRename((real, a, b) => { if (path.resolve(b) === path.resolve(to)) throw eperm(); return real(a, b); }, () => render.installSkillDir(from, to, shared));
  } catch (e) { err = e; }
  assert.ok(err && /EPERM/.test(err.message), 'the original error surfaces');
  const left = fs.readdirSync(path.join(sb.dir, 'skills')).filter((n) => n.includes('.coalmine-tmp-'));
  assert.equal(left.length, 1, 'the work folder holding the old copy is kept');
  assert.equal(fs.readFileSync(path.join(sb.dir, 'skills', left[0], 'old', 'old.md'), 'utf8'), 'OLD');
  assert.ok(err.message.includes(left[0]), 'the message names where the old copy is');
});

test('LOW-3: the copy is proven complete before the rename -- a missing source file in the new folder aborts and leaves the old folder alone', (t) => {
  const sb = sandbox(t);
  const { from, shared } = fixtureSkill(sb);
  const to = path.join(sb.dir, 'skills', 'sk'); fs.mkdirSync(to, { recursive: true });
  fs.writeFileSync(path.join(to, 'old.md'), 'OLD');
  const real = fs.copyFileSync;
  fs.copyFileSync = function (a, b, ...r) { if (String(a).endsWith('skill-meta.json')) return undefined; return real.call(this, a, b, ...r); }; // a copy that "succeeds" and writes nothing
  try { assert.throws(() => render.installSkillDir(from, to, shared), /incomplete/i); } finally { fs.copyFileSync = real; }
  assert.deepEqual(files(to), ['old.md']);
  assert.deepEqual(fs.readdirSync(path.join(sb.dir, 'skills')), ['sk']);
});
