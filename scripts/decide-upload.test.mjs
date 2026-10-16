import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, 'decide-upload.mjs');

// The script's own `./lib/asset-upload-mode.mjs` import resolves relative to ITS file URL,
// not the process cwd -- so a plain scratch dir for input files is enough, no need to copy
// the lib alongside a spawned-from-elsewhere script.
function scratchWithLib() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'decide-upload-test-'));
}

// F-R19-2 and UMB-443 ruling 2: a spawned child gets an EXPLICIT environment, never the parent's, and its HOME, USERPROFILE, TEMP, TMP and
// TMPDIR are the test's OWN scratch folder, so nothing it reads or writes can reach the developer's profile or temp folder, and
// GIT_CEILING_DIRECTORIES stops git climbing out of the scratch folder into a repository above it. RELEASE_TAG, PREVIOUS_STABLE_TAG,
// LATEST_TAG, LAUNCH_FORM, GITHUB_REF_NAME and the rest of an Actions run's variables change what these scripts do, so none of the
// parent's reaches the child. Only what a node child needs to start (the program path and, on Windows, SystemRoot) is passed through.
const BASE_ENV_KEYS = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT'];
// The keys that make this a sandbox. A caller's `extra` env may add or change anything else, but changing one of these needs the caller to name it in `allow`:
// a silent override of HOME, TEMP or the ceiling would defeat the sandbox every other test here relies on (CoalBoard's patrol, t24 #5).
const SANDBOX_KEYS = ['HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR', 'HOMEDRIVE', 'HOMEPATH', 'GIT_CEILING_DIRECTORIES'];
// The sandbox environment as one literal built from named keys: the allowlist shape a room's git-spawn census accepts without a pin (an allowlisted base, named
// keys, GIT_CONFIG_NOSYSTEM the literal 1, no spread of a caller's object). Windows puts HOMEDRIVE and HOMEPATH (the real profile) into every process it starts;
// they are overridden too, so no path variable points out, and the undefined they take elsewhere is dropped by spawn.
const sandboxEnv = (dir) => ({
  ...Object.fromEntries(BASE_ENV_KEYS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])),
  HOME: dir, USERPROFILE: dir, TEMP: dir, TMP: dir, TMPDIR: dir, GIT_CEILING_DIRECTORIES: path.dirname(dir), GIT_CONFIG_NOSYSTEM: '1',
  HOMEDRIVE: process.platform === 'win32' ? path.parse(dir).root.replace(/[\\/]+$/, '') : undefined,
  HOMEPATH: process.platform === 'win32' ? dir.slice(path.parse(dir).root.length - 1) : undefined,
});
// The environment of a spawned script: the sandbox, then the caller's `extra` (a workflow variable such as GITHUB_REF_NAME), a sandbox key only when named in `allow`.
const childEnv = (dir, extra = {}, allow = []) => {
  const silent = Object.keys(extra).filter((k) => SANDBOX_KEYS.includes(k.toUpperCase()) && !allow.includes(k));
  if (silent.length) throw new Error('childEnv: the caller overrides sandbox key(s) ' + silent.join(', ') + ' without naming them in allow');
  return Object.assign(sandboxEnv(dir), extra);
};
// The one place every spawn of these tests goes through, so the sandbox is applied by construction.
const spawnIn = (cwd, script, args = [], { env, allow, input } = {}) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', timeout: 30000, input, env: childEnv(cwd, env, allow) });
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-release-shape-test-'));
  made.push(dir);
  return dir;
}

function run(args) {
  return spawnIn(scratch(), SCRIPT, args);
}

test('decide-upload.mjs: no existing sums path given at all -- first run, upload-clobber, exit 0, prints the action on stdout', () => {
  const dir = scratchWithLib();
  const fresh = path.join(dir, 'fresh.txt');
  fs.writeFileSync(fresh, 'abc  X.zip\n');
  const res = run([fresh]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), 'upload-clobber');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('decide-upload.mjs: existing path given but the file does not exist (the best-effort download found nothing) -- same as no prior upload', () => {
  const dir = scratchWithLib();
  const fresh = path.join(dir, 'fresh.txt');
  fs.writeFileSync(fresh, 'abc  X.zip\n');
  const res = run([fresh, path.join(dir, 'does-not-exist.txt')]);
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), 'upload-clobber');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('decide-upload.mjs: identical existing + fresh sums -- skip, exit 0', () => {
  const dir = scratchWithLib();
  const fresh = path.join(dir, 'fresh.txt');
  const existing = path.join(dir, 'existing.txt');
  fs.writeFileSync(fresh, 'abc  X.zip\n');
  fs.writeFileSync(existing, 'abc  X.zip\n');
  const res = run([fresh, existing]);
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), 'skip');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('decide-upload.mjs: existing + fresh DIFFER -- fail, exit 1, still prints the action (never a bare crash)', () => {
  const dir = scratchWithLib();
  const fresh = path.join(dir, 'fresh.txt');
  const existing = path.join(dir, 'existing.txt');
  fs.writeFileSync(fresh, 'zzz  X.zip\n');
  fs.writeFileSync(existing, 'abc  X.zip\n');
  const res = run([fresh, existing]);
  assert.equal(res.status, 1);
  assert.equal(res.stdout.trim(), 'fail');
  assert.match(res.stderr, /must never change/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('decide-upload.mjs: no arguments at all -- usage error, exit 2 (distinct from a "fail" verdict)', () => {
  const res = run([]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /usage:/);
});

test('decide-upload.mjs: the fresh sums path itself does not exist -- exit 2, never crashes with a raw ENOENT stack', () => {
  const res = run(['/no/such/path/fresh.txt']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /could not read the freshly built/);
});

// 14h (item 14, courier 10; CoalLedger PR #20 #12): every spawn of this file goes through the sandboxed spawnIn above, so no child of decide-upload.mjs sees the developer's profile, temp folder or an ambient token.
test('decide-upload.mjs tests: spawnIn is the only spawn call in this file, and run() is built on it -- RED before 14h (10 #12)', () => {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const calls = src.split('\n').filter((l) => !l.trim().startsWith('//') && /spawnSync\(/.test(l)).map((l) => l.trim().slice(0, 60));
  assert.equal(calls.length, 1, calls.join(' | '));
  assert.ok(calls[0].startsWith('const spawnIn ='), calls[0]);
  assert.match(src, /function run\([^)]*\) \{\s*return spawnIn\(scratch\(\), SCRIPT/);
});

// UMB-443 ruling 2: the sandbox is real for this CLI too.
test('decide-upload.mjs tests: the shared spawn gives the child the scratch folder as HOME, USERPROFILE, TEMP, TMP and TMPDIR and a git ceiling above it -- RED before UMB-443', () => {
  const dir = scratch();
  const probe = path.join(dir, 'probe.mjs');
  fs.writeFileSync(probe, "const e = process.env; console.log(JSON.stringify([e.HOME, e.USERPROFILE, e.TEMP, e.TMP, e.TMPDIR, e.GIT_CEILING_DIRECTORIES]));\n");
  const r = spawnIn(dir, probe);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [dir, dir, dir, dir, dir, path.dirname(dir)]);
});

// CoalBoard's patrol (t24 #5, 2026-10-08): `extra` was spread last, so a caller could override HOME, TEMP or the ceiling and silently defeat the sandbox. A sandbox key now
// changes only when the caller names it in `allow`; any other key (GITHUB_REF_NAME, LATEST_TAG ...) passes as before.
test('childEnv: overriding a sandbox key without naming it in allow throws; naming it, or changing any other key, works -- RED before the CoalBoard canon ticket', () => {
  const dir = path.join(os.tmpdir(), 'sandbox-env-probe');
  for (const key of ['HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR', 'GIT_CEILING_DIRECTORIES']) {
    assert.throws(() => childEnv(dir, { [key]: 'elsewhere' }), /overrides sandbox key/, key + ' is a sandbox key');
    assert.equal(childEnv(dir, { [key]: 'elsewhere' }, [key])[key], 'elsewhere', key + ' named in allow');
  }
  assert.throws(() => childEnv(dir, { HOME: 'x', GIT_CEILING_DIRECTORIES: 'y' }, ['HOME']), /GIT_CEILING_DIRECTORIES/, 'allowing one key does not allow the next');
  assert.equal(childEnv(dir, { GITHUB_REF_NAME: 'v1.2.0' }).GITHUB_REF_NAME, 'v1.2.0', 'a key outside the sandbox set passes');
  assert.equal(childEnv(dir, {}).HOME, dir);
});

// CoalFace, CoalHearth and CoalLedger each carried a pin for this file because its sandboxEnv spread the caller's object and a conditional object and set no GIT_CONFIG_NOSYSTEM
// (the CoalWorks chief's 08c, canon item 4 i). The literal below is what lets the pin come out: the system git config is off, and the only spread is the allowlisted base.
test('sandboxEnv: one literal of named keys with GIT_CONFIG_NOSYSTEM the literal 1 and no spread but the allowlisted base -- RED before the 08c canon ticket', () => {
  assert.equal(sandboxEnv(path.join(os.tmpdir(), 'sandbox-env-probe')).GIT_CONFIG_NOSYSTEM, '1');
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('const sandboxEnv = (dir) => ({'), src.indexOf('// The environment of a spawned script'));
  const spreads = body.split('\n').filter((l) => !l.trim().startsWith('//') && /\.\.\./.test(l)).map((l) => l.trim());
  assert.deepEqual(spreads, ['...Object.fromEntries(BASE_ENV_KEYS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])),']);
  assert.ok(/GIT_CONFIG_NOSYSTEM: '1'/.test(body));
});
