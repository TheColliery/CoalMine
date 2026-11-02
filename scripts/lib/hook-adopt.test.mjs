// 29am (T-29al-5, Deep Scan row 'parseBackupHash'): a wrapper that recorded no backup (want='') is not an old wrapper. Only a wrapper
// with NO want= line is old enough to adopt a backup beside it. A backup planted after a no-backup install stays unrun and is kept.
// Hermetic: every child runs with HOME, TEMP and TMP in a fixture under os.tmpdir(); the hook runs with `sh`, and a missing `sh`
// skips visibly (a capability probe). Zero-dep (node:test + built-ins).
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
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-hadopt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  return dir;
}

function childEnv(sb) {
  return { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: sb, USERPROFILE: sb, TEMP: sb, TMP: sb, TMPDIR: sb, GIT_CEILING_DIRECTORIES: path.dirname(sb) };
}

function gitInit(repoDir) {
  fs.mkdirSync(repoDir, { recursive: true });
  const r = spawnSync('git', ['init', '-q'], { cwd: repoDir, encoding: 'utf8', env: gitEnv(path.dirname(repoDir)), timeout: TIMEOUT });
  assert.equal(r.status, 0, `control: git init in the fixture (${r.stderr})`);
}

function installer(sb, cwd, args) {
  return spawnSync(process.execPath, ['--max-old-space-size=512', INSTALL, ...args], { cwd, encoding: 'utf8', timeout: TIMEOUT, killSignal: 'SIGKILL', env: childEnv(sb) });
}

function runHook(sb, repoDir, name) {
  return spawnSync('sh', [path.join(repoDir, '.git', 'hooks', name)], { cwd: repoDir, encoding: 'utf8', timeout: TIMEOUT, env: childEnv(sb) });
}

function markerScript(marker) {
  return `#!/bin/sh\nprintf ran > "${marker.replace(/\\/g, '/')}"\nexit 0\n`;
}

function writeExec(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  fs.chmodSync(file, 0o755);
}

test('29am: a wrapper that recorded no backup (want=\'\') does not adopt a backup planted beside it later', (t) => {
  if (!shAvailable) return t.skip(SKIP_NO_SH);
  const sb = sandbox(t);
  const repoDir = path.join(sb, 'proj');
  gitInit(repoDir);
  const hooks = path.join(repoDir, '.git', 'hooks');
  const marker = path.join(sb, 'planted.marker');
  const first = installer(sb, repoDir, [path.join(sb, 'skills')]);
  assert.equal(first.status, 0, `control: the first install succeeds (${first.stdout}${first.stderr})`);
  assert.match(fs.readFileSync(path.join(hooks, 'pre-commit'), 'utf8'), /^want=''$/m, 'control: the wrapper recorded no backup');
  writeExec(path.join(hooks, 'pre-commit.pre-coalmine'), markerScript(marker));
  const second = installer(sb, repoDir, [path.join(sb, 'skills')]);
  assert.match(second.stdout + second.stderr, /\[kept\] pre-commit:/, 'the planted backup is kept, named, not adopted');
  assert.equal(second.status, 1, 'the kept backup makes the run exit 1');
  runHook(sb, repoDir, 'pre-commit');
  assert.ok(!fs.existsSync(marker), 'the planted backup is never run');
});
