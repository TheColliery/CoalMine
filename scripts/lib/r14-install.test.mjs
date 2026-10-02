// R14 BUILD part A, items 4 and 5 and the B-u2-5b / R14-N1 rulings:
//   B-u2-5b : the install output says an absolute core.hooksPath outside the project is a folder shared by every repo.
//   R14-N1  : GIT_CONFIG_GLOBAL (the user's git config selection) reaches the installer's core.hooksPath read.
//   LOW-3   : a not-yet-existing hooks folder outside the project is refused with advice that fits.
//   item 4  : the real global config is recognised as the global file even when HOME/USERPROFILE point elsewhere.
// Every install runs with HOME/USERPROFILE/TEMP in a fixture OUTSIDE the home tree (os.tmpdir() is outside it).
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
const fwd = (p) => p.split(path.sep).join('/');

function fixture(t) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-r14-ih-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const proj = path.join(sandbox, 'proj');
  fs.mkdirSync(proj);
  const git = (args, cwd = proj) => spawnSync('git', args, { cwd, env: gitEnv(path.dirname(cwd)), encoding: 'utf8', timeout: 30000 });
  assert.equal(git(['init', '-q', '.']).status, 0);
  return { sandbox, proj, git };
}
function install(sandbox, proj, extraEnv = {}) {
  return spawnSync(process.execPath, [INSTALL, path.join(sandbox, 'skills-target')], {
    cwd: proj, encoding: 'utf8', timeout: 90000,
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048', TEMP: sandbox, TMP: sandbox, TMPDIR: sandbox, USERPROFILE: sandbox, HOME: sandbox, ...extraEnv },
  });
}

test('an absolute core.hooksPath outside the project is installed into, and the output says the folder is shared (B-u2-5b)', (t) => {
  const { sandbox, proj, git } = fixture(t);
  const shared = path.join(sandbox, 'shared-hooks');
  fs.mkdirSync(shared);
  assert.equal(git(['config', 'core.hooksPath', fwd(shared)]).status, 0);
  const r = install(sandbox, proj);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /shared by every repo that uses it/);
  assert.ok(fs.existsSync(path.join(shared, 'pre-commit')), 'the hook went to the configured folder');
});

test('a core.hooksPath folder outside the project that does not exist yet is refused with advice that fits (R13 LOW-3)', (t) => {
  const { sandbox, proj, git } = fixture(t);
  assert.equal(git(['config', 'core.hooksPath', fwd(path.join(sandbox, 'not-yet'))]).status, 0);
  const r = install(sandbox, proj);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /does not exist yet/);
  assert.ok(!/regular file/.test(r.stderr), 'not the advice for a different problem');
  assert.ok(!fs.existsSync(path.join(sandbox, 'not-yet')), 'and nothing was created outside the project');
});

test('GIT_CONFIG_GLOBAL reaches the core.hooksPath read: the hooks land where the user\'s own git looks (R14-N1)', (t) => {
  const { sandbox, proj } = fixture(t);
  const shared = path.join(sandbox, 'global-hooks');
  fs.mkdirSync(shared);
  const gc = path.join(sandbox, 'gitconfig-global');
  fs.writeFileSync(gc, `[core]\n\thooksPath = ${fwd(shared)}\n`);
  const r = install(sandbox, proj, { GIT_CONFIG_GLOBAL: gc });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(shared, 'pre-commit')), 'installed where git (with that global config) looks');
  assert.ok(!fs.existsSync(path.join(proj, '.git', 'hooks', 'pre-commit')), 'not as an inert hook in .git/hooks');
});

test('the real global config is recognised as the global file under a sandboxed HOME (item 4, the git-home case)', (t) => {
  const real = path.join(os.userInfo().homedir, '.claude', '.coalmine.json');
  if (!fs.existsSync(real)) { t.skip('this machine has no ~/.claude/.coalmine.json to recognise'); return; }
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-r14-home-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const probe = 'import { isGlobalCfgFile } from ' + JSON.stringify(new URL('./config-paths.mjs', import.meta.url).href) + ';' +
    'process.stdout.write(String(isGlobalCfgFile(' + JSON.stringify(real) + ')));';
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, HOME: sandbox, USERPROFILE: sandbox },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'true', 'moved HOME/USERPROFILE must not hide the real profile\'s global config');
});
