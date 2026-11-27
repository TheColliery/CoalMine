// CWK-142 round 2 (29sg, c152 part a): an uninstall catch that warns must also fail the run. install.mjs's git-hook uninstall catch printed
// `[warn] failed to uninstall git hooks` and left the exit code at 0, so a removal that failed read as success. The input below reaches that
// catch with no seam: an installed CoalMine hook whose folder refuses the removal (`fs.unlinkSync` fails with EACCES when the folder has no
// write bit, the POSIX case). Windows does not reach it this way: libuv clears a file's read-only attribute before it unlinks, so a read-only
// hook is removed there. A capability probe decides: where this account cannot make the removal fail (Windows, or root), the leg skips visibly.
// Hermetic: every child runs with HOME, TEMP and TMP in a fixture under os.tmpdir(), and no GIT_* key from the host is inherited.
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

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-iue-'));
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

function gitInit(repoDir) {
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

// Can this account make an unlink fail by taking away the folder's write bit? POSIX without root: yes. Windows and root: no.
function canFailUnlinkByFolder(t) {
  const sb = sandbox(t);
  const dir = path.join(sb, 'probe');
  fs.mkdirSync(dir);
  const f = path.join(dir, 'f');
  fs.writeFileSync(f, 'x');
  fs.chmodSync(dir, 0o555);
  try { fs.unlinkSync(f); return false; }
  catch { return true; }
  finally { fs.chmodSync(dir, 0o755); }
}

test('install --uninstall: a git hook that cannot be removed fails the run (the git-hook uninstall catch sets exit 1)', (t) => {
  if (!canFailUnlinkByFolder(t)) { t.skip('this account removes a file whose folder has no write bit (Windows, or root), so the catch is not reached here; the POSIX CI legs run this leg'); return; }
  const sb = sandbox(t);
  const repoDir = path.join(sb, 'repo');
  gitInit(repoDir);
  const skills = path.join(sb, 'skills');
  fs.mkdirSync(skills);
  const inst = installer(sb, repoDir, [skills]);
  assert.equal(inst.status, 0, `control: install writes the git hooks (${inst.stdout}${inst.stderr})`);
  const hook = path.join(repoDir, '.git', 'hooks', 'pre-commit');
  assert.ok(fs.existsSync(hook), 'control: the pre-commit hook is installed');
  const hooksDir = path.dirname(hook);
  fs.chmodSync(hooksDir, 0o555);
  try {
    const un = installer(sb, repoDir, ['--uninstall', skills]);
    assert.match(un.stdout + un.stderr, /\[warn\] failed to uninstall git hooks/, 'the catch is the one reached: its warning is printed');
    assert.equal(un.status, 1, `a failed uninstall is not success: ${un.stdout}${un.stderr}`);
  } finally {
    fs.chmodSync(hooksDir, 0o755);
  }
  assert.ok(fs.existsSync(hook), 'the hook is still there: nothing was removed');
});
