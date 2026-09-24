// CWK-133 + CWK-136 -- the git-spawn census, both rungs, red-first on fixture text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { censusGitSpawns, collectScriptsMjs } from './git-env-census.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const one = (text) => censusGitSpawns([{ rel: 'scripts/x.mjs', text }]);
// The fixture calls are assembled from pieces so this file never holds the literal call
// shape itself -- the census scans scripts/**, this file included (the last test).
const SG = 'spawn' + "Sync('git'";
const EG = 'execFile' + "Sync('git'";

test('census rung 1 (CWK-133): a git spawn with NO env: is a finding, naming file and line', () => {
  const f = one("const a = 1;\n" + SG + ", ['init', '-q', '.'], { cwd: dir });\n");
  assert.equal(f.length, 1);
  assert.match(f[0], /^scripts\/x\.mjs:2 spawnSync\('git', \.\.\.\) carries no 'env:'/);
});

test('census rung 2 (CWK-136): env: process.env is REFUSED -- presence is not safety', () => {
  const f = one(SG + ", ['init'], { cwd: dir, env: process.env });\n");
  assert.equal(f.length, 1);
  assert.match(f[0], /passes process\.env without gitEnv\(\)/);
});

test('census rung 2 (CWK-136): a spread of process.env is REFUSED the same way', () => {
  const f = one(SG + ", ['init'], { cwd: dir, env: { ...process.env, GIT_CEILING_DIRECTORIES: base } });\n");
  assert.equal(f.length, 1);
  assert.match(f[0], /CWK-136/);
});

test('census: env: gitEnv(...) passes both rungs, on one line or across lines', () => {
  assert.deepEqual(one(SG + ", ['init'], { cwd: dir, env: gitEnv(path.dirname(dir)) });\n"), []);
  assert.deepEqual(one(EG + ",\n  ['status'],\n  { cwd: dir, env: gitEnv(base), encoding: 'utf8' });\n"), []);
  assert.deepEqual(one(SG + ", ['x'], { env: { ...gitEnv(b), LANG: process.env.LANG } });\n"), [], 'a process.env READ beside gitEnv() is not the hazard');
});

test('census: a call inside a line comment is not code', () => {
  assert.deepEqual(one("// e.g. " + SG + ", ['init'], { cwd: dir })\n"), []);
});

test('census: this room itself is clean -- every git spawn under scripts/ passes both rungs', () => {
  assert.deepEqual(censusGitSpawns(collectScriptsMjs(repo)), []);
});
