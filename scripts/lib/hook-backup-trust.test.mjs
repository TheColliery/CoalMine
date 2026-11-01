// 29q (a), CWK2-072 #4: the installer runs a user's hook backup only when it can prove the backup is the file it made. The
// installed wrapper embeds the git blob id of the backup it recorded (`want='<id>'`), and runs `<hook>.pre-coalmine` only when
// `git hash-object` of that file equals it. A backup nothing recorded is never run and never activated: the hook refuses with
// one stderr line and exit 1. Uninstall restores a backup only when its id matches the recorded one.
// Hermetic: every child runs with HOME, TEMP and TMP in a fixture under os.tmpdir(), and no GIT_* key from the host is inherited.
// The hook is run with `sh`; a missing `sh` skips visibly (a capability probe, never a platform name).
// Zero-dep (node:test + built-ins), scripts-quality.md section 2; testing.md Determinism: no clock, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitEnv } from './git-env.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALL = path.join(repo, 'scripts', 'install.mjs');
const TIMEOUT = 100000;
const shAvailable = spawnSync('sh', ['-c', 'exit 0'], { encoding: 'utf8', timeout: 20000 }).status === 0;
const SKIP_NO_SH = 'no `sh` on this machine: the wrapper cannot be run here, so this leg is not run';

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-hbt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  return dir;
}

// A child environment built from scratch: nothing from the host's GIT_* family or the user's profile reaches the child.
function childEnv(sb) {
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: sb,
    USERPROFILE: sb,
    TEMP: sb,
    TMP: sb,
    TMPDIR: sb,
    GIT_CEILING_DIRECTORIES: path.dirname(sb),
  };
}

function gitInit(sb, repoDir) {
  fs.mkdirSync(repoDir, { recursive: true });
  const r = spawnSync('git', ['init', '-q'], { cwd: repoDir, encoding: 'utf8', env: gitEnv(path.dirname(repoDir)), timeout: TIMEOUT });
  assert.equal(r.status, 0, `control: git init in the fixture (${r.stderr})`);
  assert.ok(fs.existsSync(path.join(repoDir, '.git')), 'control: the fixture is its own repository');
}

function installer(sb, cwd, args) {
  return spawnSync(process.execPath, ['--max-old-space-size=512', INSTALL, ...args], {
    cwd, encoding: 'utf8', timeout: TIMEOUT, killSignal: 'SIGKILL', env: childEnv(sb),
  });
}

// Runs the installed hook the way git does: `sh <hook>` from the repository root.
function runHook(sb, repoDir, name) {
  return spawnSync('sh', [path.join(repoDir, '.git', 'hooks', name)], { cwd: repoDir, encoding: 'utf8', timeout: TIMEOUT, env: childEnv(sb) });
}

// A script that leaves a marker file when it runs. The marker path is written with forward slashes, which `sh` accepts on Windows too.
function markerScript(marker) {
  return `#!/bin/sh\nprintf ran > "${marker.replace(/\\/g, '/')}"\nexit 0\n`;
}

function writeExec(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  fs.chmodSync(file, 0o755);
}

test('the installed hook never runs a backup nothing recorded: a planted backup stays unrun', (t) => {
  if (!shAvailable) return t.skip(SKIP_NO_SH);
  const sb = sandbox(t);
  const repoDir = path.join(sb, 'proj');
  gitInit(sb, repoDir);
  const hooks = path.join(repoDir, '.git', 'hooks');
  const marker = path.join(sb, 'planted.marker');
  writeExec(path.join(hooks, 'pre-commit.pre-coalmine'), markerScript(marker));
  installer(sb, repoDir, [path.join(sb, 'skills')]);
  const r = runHook(sb, repoDir, 'pre-commit');
  assert.ok(!fs.existsSync(marker), 'a backup no install recorded is not executed by the hook');
  assert.notEqual(r.status, 0, 'the hook refuses (exit 1) instead of passing a backup it cannot prove');
  assert.match(r.stderr, /not the backup CoalMine recorded/, 'one stderr line names the refusal');
});

test('the installed hook refuses a backup whose contents changed after install', (t) => {
  if (!shAvailable) return t.skip(SKIP_NO_SH);
  const sb = sandbox(t);
  const repoDir = path.join(sb, 'proj');
  gitInit(sb, repoDir);
  const hooks = path.join(repoDir, '.git', 'hooks');
  writeExec(path.join(hooks, 'pre-push'), '#!/bin/sh\nexit 0\n');
  const inst = installer(sb, repoDir, [path.join(sb, 'skills')]);
  assert.equal(inst.status, 0, `control: the install records the user's hook (${inst.stdout}${inst.stderr})`);
  const marker = path.join(sb, 'changed.marker');
  writeExec(path.join(hooks, 'pre-push.pre-coalmine'), markerScript(marker));
  const r = runHook(sb, repoDir, 'pre-push');
  assert.ok(!fs.existsSync(marker), 'a changed backup is not executed');
  assert.notEqual(r.status, 0, 'the hook refuses (exit 1) on a hash mismatch');
});

test('the installed hook still runs the backup it recorded at install (the normal path keeps working)', (t) => {
  if (!shAvailable) return t.skip(SKIP_NO_SH);
  const sb = sandbox(t);
  const repoDir = path.join(sb, 'proj');
  gitInit(sb, repoDir);
  const hooks = path.join(repoDir, '.git', 'hooks');
  const marker = path.join(sb, 'recorded.marker');
  writeExec(path.join(hooks, 'pre-commit'), markerScript(marker));
  const inst = installer(sb, repoDir, [path.join(sb, 'skills')]);
  assert.equal(inst.status, 0, `control: the install succeeds (${inst.stdout}${inst.stderr})`);
  const r = runHook(sb, repoDir, 'pre-commit');
  assert.equal(r.status, 0, `the recorded backup runs and exits 0 (${r.stderr})`);
  assert.ok(fs.existsSync(marker), 'the user hook that install recorded still runs');
});

test('uninstall does not restore a backup whose contents no longer match the recorded one', (t) => {
  if (!shAvailable) return t.skip(SKIP_NO_SH);
  const sb = sandbox(t);
  const repoDir = path.join(sb, 'proj');
  gitInit(sb, repoDir);
  const hooks = path.join(repoDir, '.git', 'hooks');
  writeExec(path.join(hooks, 'pre-commit'), '#!/bin/sh\nexit 0\n');
  const skills = path.join(sb, 'skills');
  const inst = installer(sb, repoDir, [skills]);
  assert.equal(inst.status, 0, `control: the install succeeds (${inst.stdout}${inst.stderr})`);
  const planted = '#!/bin/sh\necho planted-by-someone-else\n';
  fs.writeFileSync(path.join(hooks, 'pre-commit.pre-coalmine'), planted, 'utf8');
  installer(sb, repoDir, ['--uninstall', skills]);
  const after = fs.readFileSync(path.join(hooks, 'pre-commit'), 'utf8');
  assert.ok(!after.includes('planted-by-someone-else'), 'the planted backup is not restored over the installed hook');
  assert.ok(fs.existsSync(path.join(hooks, 'pre-commit.pre-coalmine')), 'the unrecorded backup stays in place for the user to review');
});

test('uninstall restores the user hook it recorded, byte for byte (the normal round trip)', (t) => {
  const sb = sandbox(t);
  const repoDir = path.join(sb, 'proj');
  gitInit(sb, repoDir);
  const hooks = path.join(repoDir, '.git', 'hooks');
  const original = '#!/bin/sh\n# the user\'s own hook\nexit 0\n';
  writeExec(path.join(hooks, 'pre-commit'), original);
  const skills = path.join(sb, 'skills');
  const inst = installer(sb, repoDir, [skills]);
  assert.equal(inst.status, 0, `control: the install succeeds (${inst.stdout}${inst.stderr})`);
  installer(sb, repoDir, ['--uninstall', skills]);
  assert.equal(fs.readFileSync(path.join(hooks, 'pre-commit'), 'utf8'), original, 'the user hook comes back unchanged');
  assert.ok(!fs.existsSync(path.join(hooks, 'pre-commit.pre-coalmine')), 'the restored backup is removed');
});

// 29q c36 item 1: a backup beside an OLD CoalMine wrapper (one with no `want=` line, the released 35d6bc9 shape) was made by an
// earlier CoalMine install, so it is adopted: the new wrapper records its blob id, and it runs and restores like any recorded backup.
const LEGACY_PRE_COMMIT = path.join(repo, 'scripts', 'lib', 'fixtures', 'legacy-pre-commit.wrapper');
function blobOf(file, cwd) {
  const r = spawnSync('git', ['hash-object', file], { cwd, encoding: 'utf8', env: gitEnv(path.dirname(cwd)), timeout: TIMEOUT });
  assert.equal(r.status, 0, `control: git hash-object (${r.stderr})`);
  return r.stdout.trim();
}

test('a backup beside an old CoalMine wrapper is adopted: recorded, run by the hook, restored on uninstall', (t) => {
  if (!shAvailable) return t.skip(SKIP_NO_SH);
  const sb = sandbox(t);
  const repoDir = path.join(sb, 'proj');
  gitInit(sb, repoDir);
  const hooks = path.join(repoDir, '.git', 'hooks');
  const marker = path.join(sb, 'adopted.marker');
  const userHook = markerScript(marker);
  fs.copyFileSync(LEGACY_PRE_COMMIT, path.join(hooks, 'pre-commit'));
  writeExec(path.join(hooks, 'pre-commit.pre-coalmine'), userHook);
  const skills = path.join(sb, 'skills');
  const inst = installer(sb, repoDir, [skills]);
  assert.equal(inst.status, 0, `the old wrapper is adopted, not refused (${inst.stdout}${inst.stderr})`);
  assert.match(inst.stdout, /adopted .*pre-commit\.pre-coalmine/, 'one line names the adoption');
  const backupId = blobOf(path.join(hooks, 'pre-commit.pre-coalmine'), repoDir);
  assert.ok(fs.readFileSync(path.join(hooks, 'pre-commit'), 'utf8').includes(`want='${backupId}'`), 'the new wrapper records the backup id');
  const r = runHook(sb, repoDir, 'pre-commit');
  assert.equal(r.status, 0, `the adopted backup runs (${r.stderr})`);
  assert.ok(fs.existsSync(marker), 'the adopted user hook ran');
  const un = installer(sb, repoDir, ['--uninstall', skills]);
  assert.equal(un.status, 0, `control: uninstall succeeds (${un.stdout}${un.stderr})`);
  assert.equal(fs.readFileSync(path.join(hooks, 'pre-commit'), 'utf8'), userHook, 'uninstall restores the adopted backup byte for byte');
  assert.ok(!fs.existsSync(path.join(hooks, 'pre-commit.pre-coalmine')), 'the restored backup is removed');
});

test('a planted backup beside a foreign active hook is refused, and neither file changes', (t) => {
  const sb = sandbox(t);
  const repoDir = path.join(sb, 'proj');
  gitInit(sb, repoDir);
  const hooks = path.join(repoDir, '.git', 'hooks');
  const foreign = '#!/bin/sh\n# written by someone else\nexit 0\n';
  fs.writeFileSync(path.join(hooks, 'pre-commit'), foreign, 'utf8');
  fs.chmodSync(path.join(hooks, 'pre-commit'), 0o755);
  const planted = markerScript(path.join(sb, 'never.marker'));
  writeExec(path.join(hooks, 'pre-commit.pre-coalmine'), planted);
  const inst = installer(sb, repoDir, [path.join(sb, 'skills')]);
  assert.notEqual(inst.status, 0, 'the install refuses a backup it did not make');
  assert.equal(fs.readFileSync(path.join(hooks, 'pre-commit.pre-coalmine'), 'utf8'), planted, 'the planted backup is untouched');
  assert.equal(fs.readFileSync(path.join(hooks, 'pre-commit'), 'utf8'), foreign, 'the foreign hook is untouched');
});
