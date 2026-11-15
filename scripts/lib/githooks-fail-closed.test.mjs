// CW-071 (CoalWorks chief ruling): pre-commit and pre-push FAIL CLOSED when a gate script is missing. Before the fix each hook wrapped its
// gate in `if [ -f scripts/verify.mjs ]; then ... fi` and ended `exit 0`, so a checkout that lost the gate committed and pushed ungated.
// The witness drives each hook from a fixture repository under the OS temp folder, never the room itself.
//  - REFUSAL leg: the fixture has NO scripts/verify.mjs (test.mjs and consistency.mjs present); the commit (or push) must be refused,
//    nothing recorded (no HEAD, or no ref on the remote), and stderr must name scripts/verify.mjs.
//  - POSITIVE twin, same test: the same fixture with all gate scripts present is ACCEPTED, so the refusal is about the missing file and
//    not a broken fixture.
// pre-push is driven against a LOCAL bare repository under the same temp root (a file path, not a network remote): git hands the hook the
// remote name and the ref lines on stdin, exactly as a real push does.
// Every git child takes its environment from gitEnv() (the room rule, scripts/lib/git-env.mjs; scripts/lib/git-env-census.room.test.mjs
// refuses a spawn that inherits the ambient GIT_* family), with GIT_CEILING_DIRECTORIES set to the temp root so no child walks above it.
// The hook runs under git's own `sh` (Git for Windows on this box). A probe, not process.platform, decides a skip: here none is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitEnv } from './git-env.mjs';
import { removeTree } from './test-sandbox.mjs';

const ROOM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK_DIR = path.join(ROOM, '.githooks');
const GATES = ['scripts/test.mjs', 'scripts/verify.mjs', 'scripts/consistency.mjs'];

// Every git spawn in this file: the environment is gitEnv(base), so the fixture never inherits a hook's exported GIT_DIR or GIT_INDEX_FILE.
function git(cwd, base, args) {
  return spawnSync('git', args, { cwd, env: gitEnv(base), encoding: 'utf8', timeout: 60_000 });
}
// Commit identity and no signing, passed as -c so no global config is read.
const ID = ['-c', 'user.name=cm-witness', '-c', 'user.email=cm-witness@example.invalid', '-c', 'commit.gpgsign=false'];

// A fixture: a git repo at <base>/repo with the gate stubs chosen by the caller, the named hook copied in and core.hooksPath set.
function fixture(t, hookName, { withVerify }) {
  const base = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-hookfc-'));
  t.after(() => removeTree(base));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  const init = git(repo, base, ['init', '-q']);
  assert.equal(init.status, 0, 'git init must succeed: ' + init.stderr);
  // The fixture's own .git must exist before any other git command is trusted to act on it.
  assert.ok(fs.existsSync(path.join(repo, '.git')), 'the fixture has its own .git before any other git command runs');
  fs.mkdirSync(path.join(repo, 'scripts', 'lib'), { recursive: true });
  const stub = 'process.exitCode = 0;\n';
  fs.writeFileSync(path.join(repo, 'scripts', 'secret-gate.mjs'), stub);
  fs.writeFileSync(path.join(repo, 'scripts', 'test.mjs'), stub);
  fs.writeFileSync(path.join(repo, 'scripts', 'consistency.mjs'), stub);
  if (withVerify) fs.writeFileSync(path.join(repo, 'scripts', 'verify.mjs'), stub);
  // Windows PowerShell parity files: the hook runs them only where pwsh exists, and an empty script exits 0 under pwsh.
  fs.writeFileSync(path.join(repo, 'scripts', 'lib', 'ps-config.test.ps1'), '');
  fs.writeFileSync(path.join(repo, 'scripts', 'lib', 'ps-hooks.test.ps1'), '');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  return { base, repo, hookName };
}

// Copy the room's hook into the fixture's .githooks and point core.hooksPath there, after the fixture's first commit has been made by the caller.
function installHook(repo, base, hookName) {
  const dir = path.join(repo, '.githooks');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, hookName);
  fs.copyFileSync(path.join(HOOK_DIR, hookName), dest);
  fs.chmodSync(dest, 0o755);
  const set = git(repo, base, ['config', 'core.hooksPath', '.githooks']);
  assert.equal(set.status, 0, 'core.hooksPath set: ' + set.stderr);
}

test('pre-commit fails closed: a commit with no scripts/verify.mjs is refused and names it; with every gate present it is accepted', (t) => {
  const { base, repo } = fixture(t, 'pre-commit', { withVerify: false });
  installHook(repo, base, 'pre-commit');
  // REFUSAL leg: nothing committed, stderr names the missing gate.
  git(repo, base, ['add', 'a.txt']);
  const refused = git(repo, base, [...ID, 'commit', '-q', '-m', 'refused']);
  assert.notEqual(refused.status, 0, 'a commit with a missing gate script must be refused: ' + refused.stdout + refused.stderr);
  assert.match(refused.stderr, /scripts\/verify\.mjs/, 'the refusal names scripts/verify.mjs: ' + refused.stderr);
  const head = git(repo, base, ['rev-parse', '--verify', '-q', 'HEAD']);
  assert.notEqual(head.status, 0, 'nothing was committed: the fixture still has no HEAD');
  // POSITIVE twin: the same fixture with the gate present is accepted.
  fs.writeFileSync(path.join(repo, 'scripts', 'verify.mjs'), 'process.exitCode = 0;\n');
  const ok = git(repo, base, [...ID, 'commit', '-q', '-m', 'accepted']);
  assert.equal(ok.status, 0, 'with every gate present the commit is accepted: ' + ok.stdout + ok.stderr);
  assert.equal(git(repo, base, ['rev-parse', '--verify', '-q', 'HEAD']).status, 0, 'the accepted commit exists');
});

test('pre-push fails closed: a push with no scripts/verify.mjs is refused and names it; with every gate present it is accepted', (t) => {
  const { base, repo } = fixture(t, 'pre-push', { withVerify: false });
  // Make the commit BEFORE any hook is installed, so the push is the first hook-gated act.
  git(repo, base, ['add', 'a.txt']);
  const first = git(repo, base, [...ID, 'commit', '-q', '-m', 'base']);
  assert.equal(first.status, 0, 'the base commit (no hook yet): ' + first.stderr);
  const remote = path.join(base, 'remote.git');
  const bare = git(base, base, ['init', '-q', '--bare', remote]);
  assert.equal(bare.status, 0, 'a local bare remote under the temp root: ' + bare.stderr);
  const add = git(repo, base, ['remote', 'add', 'origin', remote]);
  assert.equal(add.status, 0, 'origin added: ' + add.stderr);
  installHook(repo, base, 'pre-push');
  // REFUSAL leg: the push is refused, the remote records no branch, stderr names the missing gate.
  const refused = git(repo, base, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
  assert.notEqual(refused.status, 0, 'a push with a missing gate script must be refused: ' + refused.stdout + refused.stderr);
  assert.match(refused.stderr, /scripts\/verify\.mjs/, 'the refusal names scripts/verify.mjs: ' + refused.stderr);
  const none = git(remote, base, ['rev-parse', '--verify', '-q', 'refs/heads/main']);
  assert.notEqual(none.status, 0, 'nothing was pushed: the remote has no refs/heads/main');
  // POSITIVE twin: the same fixture with the gate present is accepted.
  fs.writeFileSync(path.join(repo, 'scripts', 'verify.mjs'), 'process.exitCode = 0;\n');
  const ok = git(repo, base, ['push', '-q', 'origin', 'HEAD:refs/heads/main']);
  assert.equal(ok.status, 0, 'with every gate present the push is accepted: ' + ok.stdout + ok.stderr);
  assert.equal(git(remote, base, ['rev-parse', '--verify', '-q', 'refs/heads/main']).status, 0, 'the accepted push landed on the remote');
});
