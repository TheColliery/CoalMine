// Guard-rail tests only. The actual list-releases/delete-asset calls are a real externality
// (the GitHub API) that testing.md's own Test Doubles rule says to mock only when you can't
// run in-process at all -- here we simply never reach them: both cases below return/exit
// before any network call happens, so the test proves that WITHOUT touching the network
// (never a fake, since there is nothing safe to fake a delete call into).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listReleases } from './prune-release-zips.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prune-release-zips.mjs');

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

// The child gets the sandbox environment and the case's own variables only: an ambient GITHUB_TOKEN, GITHUB_REPOSITORY or PRUNE_OLD_RELEASE_ZIPS of the parent (this test may run inside a workflow that has them)
// never reaches it, so each case controls its inputs exactly.
function run(env) {
  return spawnIn(scratch(), SCRIPT, [], { env });
}

test('prune-release-zips.mjs: flag unset -- exit 0, "flag off" message, no attempt to reach the network', () => {
  const res = run({});
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /flag off, nothing pruned/);
});

test('prune-release-zips.mjs: flag set to anything other than the literal "true" is still off (e.g. "1", "TRUE")', () => {
  for (const v of ['1', 'TRUE', 'yes']) {
    const res = run({ PRUNE_OLD_RELEASE_ZIPS: v });
    assert.equal(res.status, 0, `value "${v}": ${res.stderr}`);
    assert.match(res.stdout, /flag off/);
  }
});

test('prune-release-zips.mjs: flag on but GITHUB_TOKEN/GITHUB_REPOSITORY missing -- fails loud, exit 1, never reaches the network', () => {
  const res = run({ PRUNE_OLD_RELEASE_ZIPS: 'true' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /GITHUB_TOKEN and GITHUB_REPOSITORY must both be set/);
});

// 14h item 14 (7), CoalFace #9 = CoalLedger #7 (Major): `for (let page = 1; page < 10; page++)` read nine pages and stopped SILENTLY, so a repository with more than 900 Releases handed the
// selection a list that was missing its newest-or-oldest Releases and could prune the wrong one. The pager now reads until a short page, and fails loud when the cap is reached on a full page.

const fakePages = (total, seen = []) => async (url) => {
  const page = Number(new URL(url).searchParams.get('page'));
  seen.push(page);
  const from = (page - 1) * 100;
  const n = Math.max(0, Math.min(100, total - from));
  const body = Array.from({ length: n }, (_, i) => ({ tag_name: 'v' + (from + i) }));
  return { ok: true, status: 200, json: async () => body };
};

test('listReleases reads every page until a short one: 950 and 1,000 Releases are listed whole (a full last page is followed by an empty one) -- RED before 14h (7)', async () => {
  for (const total of [0, 99, 100, 250, 900, 950, 1000]) {
    const seen = [];
    const got = await listReleases('o/r', 't', fakePages(total, seen));
    assert.equal(got.length, total, `${total} Releases`);
    assert.equal(new Set(got.map((r) => r.tag_name)).size, total, 'no page was read twice');
    assert.equal(seen.length, Math.floor(total / 100) + 1, `${total}: one request per page and one for the short or empty page that ends it`);
  }
});

test('listReleases fails loud when it hits its page cap on a full page, never returns a list that may be missing Releases', async () => {
  await assert.rejects(listReleases('o/r', 't', fakePages(100000), 5), /still full at page 5.*refusing to prune/);
  const seen = [];
  const exactly = await listReleases('o/r', 't', fakePages(499, seen), 5); // 4 full pages and a short fifth: complete, within the cap
  assert.equal(exactly.length, 499);
});

test('listReleases: an HTTP error or a body that is not a list is a failure naming the page', async () => {
  await assert.rejects(listReleases('o/r', 't', async () => ({ ok: false, status: 502, json: async () => ({}) })), /page 1 -> HTTP 502/);
  await assert.rejects(listReleases('o/r', 't', async () => ({ ok: true, status: 200, json: async () => ({ message: 'x' }) })), /page 1 .*not a list/);
});

// 14h (item 14, courier 10; CoalLedger PR #20 #12): every spawn of this file goes through the sandboxed spawnIn above, so no child of prune-release-zips.mjs sees the developer's profile, temp folder or an ambient token.
test('prune-release-zips.mjs tests: spawnIn is the only spawn call in this file, and run() is built on it -- RED before 14h (10 #12)', () => {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const calls = src.split('\n').filter((l) => !l.trim().startsWith('//') && /spawnSync\(/.test(l)).map((l) => l.trim().slice(0, 60));
  assert.equal(calls.length, 1, calls.join(' | '));
  assert.ok(calls[0].startsWith('const spawnIn ='), calls[0]);
  assert.match(src, /function run\([^)]*\) \{\s*return spawnIn\(scratch\(\), SCRIPT/);
});

// UMB-443 ruling 2: the sandbox is real for this CLI too.
test('prune-release-zips.mjs tests: the shared spawn gives the child the scratch folder as HOME, USERPROFILE, TEMP, TMP and TMPDIR and a git ceiling above it -- RED before UMB-443', () => {
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
