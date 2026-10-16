// 17a CWK2-042: the project-WRITE folder pin. A link or junction at ANY component between the project root and the target's folder is refused wherever it points (an in-project
// target included), nothing is made past a checked component, and the root itself is not walked. This is the write twin of the 15b5 read pin (folder-pin.test.mjs): without it
// configure.mjs wrote a config at <proj>/realclaude/coal/coalmine.json through a .claude junction and the hooks then refused to read that very path.
// Measured at main (scratchpad/r17a/witness-042.mjs): a junction to OUTSIDE the project was already refused before anything was made, so those legs are regression guards;
// the in-project legs are the gap. Windows junction legs run here; the POSIX symlink legs are probed by capability (they run on CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FOLDER_FIX, writeRepoFile, mkdirRepoParents, checkRepoDirTarget, checkRepoWriteTarget, readRepoFileBounded, MAX_CONFIG_BYTES } from './repo-fs.mjs';
import { removeTree } from './test-sandbox.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CFG = path.join('.claude', 'coal', 'coalmine.json');

function fixture(t) {
  const base = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-wpin-'));
  t.after(() => {
    // unlink every link first: removeTree must never follow one
    for (const p of ['proj/.claude', 'proj/.claude/coal', 'rootlink']) { try { if (fs.lstatSync(path.join(base, p)).isSymbolicLink()) fs.unlinkSync(path.join(base, p)); } catch { /* not there */ } }
    removeTree(base);
  });
  const proj = path.join(base, 'proj'); const outside = path.join(base, 'outside');
  fs.mkdirSync(proj); fs.mkdirSync(outside);
  return { base, proj, outside };
}
const link = (target, at) => { fs.mkdirSync(path.dirname(at), { recursive: true }); fs.symlinkSync(target, at, 'junction'); };
const names = (d) => fs.readdirSync(d).sort();
const refused = (e) => e && e.code === 'COALMINE_WRITE_REFUSED';
// 17a INSPECT LOW-1: a refused FOLDER tells the user to make it a real folder, never to "replace it with a regular file".
const folderText = (m) => { assert.ok(m.includes(FOLDER_FIX), `the folder instruction is shown: ${m}`); assert.ok(!/regular file/.test(m), `and the file instruction is not: ${m}`); };
const SPAWN_ENV = (home) => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home });

test('a .claude junction to a folder INSIDE the project is refused, and nothing is made behind it (the gap)', (t) => {
  const { proj } = fixture(t);
  const real = path.join(proj, 'realclaude'); fs.mkdirSync(real);
  link(real, path.join(proj, '.claude'));
  assert.throws(() => writeRepoFile(path.join(proj, CFG), '{}', proj), refused);
  assert.deepEqual(names(real), [], 'nothing was made behind the link');
  assert.match(checkRepoDirTarget(path.dirname(path.join(proj, CFG)), proj) || '', /link or junction/, 'every caller\'s pre-check refuses too, before it writes anything');
  assert.match(checkRepoWriteTarget(path.join(proj, CFG), proj) || '', /link or junction/);
  folderText(checkRepoDirTarget(path.dirname(path.join(proj, CFG)), proj));
  folderText(checkRepoWriteTarget(path.join(proj, CFG), proj));
  assert.throws(() => writeRepoFile(path.join(proj, CFG), '{}', proj), (e) => { folderText(e.message); return true; });
});

test('a .claude junction to a folder OUTSIDE the project is still refused, and nothing is made outside (regression guard)', (t) => {
  const { proj, outside } = fixture(t);
  link(outside, path.join(proj, '.claude'));
  assert.throws(() => writeRepoFile(path.join(proj, CFG), '{}', proj), refused);
  assert.deepEqual(names(outside), [], 'no folder appeared outside the project');
  // the ancestor-resolves-outside reason (checkRepoDirTarget's realpath branch) is a folder refusal too and carries the folder instruction (17a CI red 2)
  folderText(checkRepoDirTarget(path.dirname(path.join(proj, CFG)), proj));
  folderText(checkRepoWriteTarget(path.join(proj, CFG), proj));
});

test('a junction at .claude/coal (the folder, not its parent) is refused and nothing is made behind it', (t) => {
  const { proj } = fixture(t);
  const real = path.join(proj, 'elsewhere'); fs.mkdirSync(real);
  fs.mkdirSync(path.join(proj, '.claude'));
  link(real, path.join(proj, '.claude', 'coal'));
  assert.throws(() => writeRepoFile(path.join(proj, CFG), '{}', proj), refused);
  assert.deepEqual(names(real), []);
  folderText(checkRepoWriteTarget(path.join(proj, CFG), proj));
});

test('a missing parent chain inside the project is made, one real folder at a time, and the file is written and readable by the read pin', (t) => {
  const { proj } = fixture(t);
  writeRepoFile(path.join(proj, CFG), '{"x":1}', proj);
  assert.equal(fs.readFileSync(path.join(proj, CFG), 'utf8'), '{"x":1}');
  for (const d of ['.claude', path.join('.claude', 'coal')]) assert.ok(fs.lstatSync(path.join(proj, d)).isDirectory() && !fs.lstatSync(path.join(proj, d)).isSymbolicLink());
  assert.equal(readRepoFileBounded(path.join(proj, CFG), proj, MAX_CONFIG_BYTES), '{"x":1}', 'what the write side makes, the read side reads');
  writeRepoFile(path.join(proj, CFG), '{"x":2}', proj); // an existing chain is written through again
  assert.equal(fs.readFileSync(path.join(proj, CFG), 'utf8'), '{"x":2}');
});

test('a regular FILE where a folder is needed is refused ("exists and is not a directory"), nothing past it is made', (t) => {
  const { proj } = fixture(t);
  fs.writeFileSync(path.join(proj, '.claude'), 'i am a file');
  assert.throws(() => writeRepoFile(path.join(proj, CFG), '{}', proj), (e) => refused(e));
  folderText(checkRepoWriteTarget(path.join(proj, CFG), proj));
  assert.equal(fs.readFileSync(path.join(proj, '.claude'), 'utf8'), 'i am a file', 'and the file is untouched');
});

test('a ".." segment that leaves the project is refused by the make, and nothing is made outside', (t) => {
  const { proj, base } = fixture(t);
  const out = path.join(base, 'made-outside');
  assert.throws(() => mkdirRepoParents(path.join(proj, '..', 'made-outside', 'deep'), proj), refused);
  assert.ok(!fs.existsSync(out), 'no folder was made outside the root');
  assert.throws(() => writeRepoFile(path.join(proj, '..', 'made-outside', 'f.json'), '{}', proj), refused);
  assert.ok(!fs.existsSync(out));
  // a folder merely NAMED like a parent reference is not one
  mkdirRepoParents(path.join(proj, '..cfg', 'x'), proj);
  assert.ok(fs.lstatSync(path.join(proj, '..cfg', 'x')).isDirectory());
});

// The make is its own line of defence: writeRepoFile's pre-check (checkRepoWriteTarget) refuses these first, so only a direct call proves the walk itself (and the
// race, a folder swapped for a link between the check and the make, is the case where the walk is the only guard left).
test('mkdirRepoParents on its own: an in-project junction on the chain throws and makes nothing behind it; a file on the chain throws', (t) => {
  const { proj } = fixture(t);
  const real = path.join(proj, 'realclaude'); fs.mkdirSync(real);
  link(real, path.join(proj, '.claude'));
  assert.throws(() => mkdirRepoParents(path.join(proj, '.claude', 'coal', 'deeper'), proj), (e) => refused(e) && /link or junction/.test(e.message));
  assert.deepEqual(names(real), [], 'nothing was made behind the link');
  fs.writeFileSync(path.join(proj, 'afile'), 'x');
  assert.throws(() => mkdirRepoParents(path.join(proj, 'afile', 'sub'), proj), (e) => refused(e) && /not a directory/.test(e.message));
});

test('the ROOT itself reached through a link still writes (the root is not walked, as for reads)', (t) => {
  const { base, proj } = fixture(t);
  const viaLink = path.join(base, 'rootlink');
  link(proj, viaLink);
  writeRepoFile(path.join(viaLink, CFG), '{"r":1}', viaLink);
  assert.equal(fs.readFileSync(path.join(proj, CFG), 'utf8'), '{"r":1}', 'the file landed in the real project');
});

test('root = null (a user-chosen folder that is its own root) keeps the plain recursive make', (t) => {
  const { base } = fixture(t);
  mkdirRepoParents(path.join(base, 'a', 'b', 'c'), null);
  assert.ok(fs.lstatSync(path.join(base, 'a', 'b', 'c')).isDirectory());
});

test('configure.mjs end to end: a .claude junction inside the project makes it exit non-zero and write nothing behind the link', (t) => {
  const { base, proj } = fixture(t);
  fs.mkdirSync(path.join(proj, '.git'));
  const real = path.join(proj, 'realclaude'); fs.mkdirSync(real);
  link(real, path.join(proj, '.claude'));
  const home = path.join(base, 'home'); fs.mkdirSync(home);
  const r = spawnSync(process.execPath, ['--max-old-space-size=512', path.join(repo, 'scripts', 'configure.mjs'), '--updateMode', 'off'], {
    cwd: proj, encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL',
    env: SPAWN_ENV(home),
  });
  assert.notEqual(r.status, 0, `configure refuses (${r.stdout.slice(0, 200)}${r.stderr.slice(0, 300)})`);
  folderText(r.stdout + r.stderr);
  assert.deepEqual(names(real), [], 'no config was written behind the link');
});

test('install.mjs end to end: a .cursor junction inside the project is refused with the FOLDER instruction (the text the user sees)', (t) => {
  const { base, proj } = fixture(t);
  fs.mkdirSync(path.join(proj, '.git'));
  const real = path.join(proj, 'realcursor'); fs.mkdirSync(real);
  link(real, path.join(proj, '.cursor'));
  const home = path.join(base, 'home'); fs.mkdirSync(home);
  const r = spawnSync(process.execPath, ['--max-old-space-size=512', path.join(repo, 'scripts', 'install.mjs'), 'cursor'], { cwd: proj, encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL', env: SPAWN_ENV(home) });
  assert.notEqual(r.status, 0, `install refuses (${r.stdout.slice(0, 200)}${r.stderr.slice(0, 300)})`);
  folderText(r.stdout + r.stderr);
  assert.deepEqual(names(real), [], 'nothing was installed behind the link');
});

// POSIX symlink legs, probed by capability (Windows without the privilege skips them visibly; CI runs them).
function symlinkOk(dir) {
  const p = path.join(dir, '.probe-sym');
  try { fs.symlinkSync(dir, p, 'dir'); fs.unlinkSync(p); return true; } catch { return false; }
}
test('POSIX symlink at .claude (in-project and outside targets) is refused like a junction, nothing is made behind it', (t) => {
  const { proj, outside, base } = fixture(t);
  if (!symlinkOk(base)) { t.skip('directory symlinks need privilege on this volume'); return; }
  const real = path.join(proj, 'realclaude'); fs.mkdirSync(real);
  fs.symlinkSync(real, path.join(proj, '.claude'), 'dir');
  assert.throws(() => writeRepoFile(path.join(proj, CFG), '{}', proj), refused);
  assert.deepEqual(names(real), []);
  fs.unlinkSync(path.join(proj, '.claude'));
  fs.symlinkSync(outside, path.join(proj, '.claude'), 'dir');
  assert.throws(() => writeRepoFile(path.join(proj, CFG), '{}', proj), refused);
  assert.deepEqual(names(outside), []);
  folderText(checkRepoWriteTarget(path.join(proj, CFG), proj)); // the outside-target symlink reaches the ancestor-resolves-outside reason
});
test('a symlink to a FILE at .claude is refused (no folder can be made behind it)', (t) => {
  const { proj, base } = fixture(t);
  const probe = path.join(base, 'pf'); fs.writeFileSync(probe, 'x');
  try { fs.symlinkSync(probe, path.join(proj, '.claude'), 'file'); } catch { t.skip('file symlinks need privilege on this volume'); return; }
  assert.throws(() => writeRepoFile(path.join(proj, CFG), '{}', proj), refused);
  assert.equal(fs.readFileSync(probe, 'utf8'), 'x', 'the link target is untouched');
  folderText(checkRepoWriteTarget(path.join(proj, CFG), proj));
});
test('a linked FILE (the config itself a symlink) keeps the FILE instruction, not the folder one', (t) => {
  const { proj, base } = fixture(t);
  const real = path.join(base, 'real.json'); fs.writeFileSync(real, '{}');
  fs.mkdirSync(path.join(proj, '.claude', 'coal'), { recursive: true });
  try { fs.symlinkSync(real, path.join(proj, CFG), 'file'); } catch { t.skip('file symlinks need privilege on this volume'); return; }
  const why = checkRepoWriteTarget(path.join(proj, CFG), proj) || '';
  assert.match(why, /symbolic link/);
  assert.ok(!why.includes(FOLDER_FIX), 'a linked file is not told to make a folder');
});
