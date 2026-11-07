// Spawns the real CLI against a sandboxed scratch tree (never re-derives the derivation logic
// by import -- that is release-shape.test.mjs's job; this proves the CLI wiring itself: env in,
// files out, exit codes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'release-notes.mjs');
const LIB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib');

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
// Teardown of a tree git children just used: on Windows a git.exe that outlives its launcher by a few seconds still holds the tree, and one plain rmSync
// answers EBUSY, EPERM or ENOTEMPTY, failing the test for a reason that is not the test's (CoalWash e63, measured: a loop of fresh calls clears it, the
// retry options of one call do not; CWK2-041, order 16j). A tree still held past the budget throws: a real leak stays loud.
function removeTree(dir, budgetMs = 30000) {
  const until = Date.now() + budgetMs;
  for (;;) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch (e) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(e && e.code) || Date.now() >= until) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}
test.after(() => { for (const d of made) removeTree(d); });

function scratchWithLib() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-notes-test-'));
  made.push(dir);
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(LIB_DIR, 'release-shape.mjs'), path.join(dir, 'scripts', 'lib', 'release-shape.mjs'));
  return dir;
}

function run(cwd, env, args = [], allow = []) {
  return spawnIn(cwd, SCRIPT, args, { env, allow });
}

test('release-notes.mjs: writes release-title.txt + release-body.md derived from CHANGELOG.md, exit 0', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [1.2.0] - 2026-09-22\n\nA test-only CLI wiring proof.\n\n### Added\n- x\n');
  const res = run(dir, { GITHUB_REF_NAME: 'v1.2.0' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'release-title.txt'), 'utf8'), 'v1.2.0 - a test-only CLI wiring proof');
  assert.equal(fs.readFileSync(path.join(dir, 'release-body.md'), 'utf8'), 'A test-only CLI wiring proof.\n\n### Added\n- x\n');
});

test('release-notes.mjs: a non-vX.Y.Z ref (e.g. a branch name from workflow_dispatch) fails loud, exit 1, no files written', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [1.0.0] - 2026-01-01\n\nx.\n');
  const res = run(dir, { GITHUB_REF_NAME: 'main' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /not a bare vX\.Y\.Z tag/);
  assert.equal(fs.existsSync(path.join(dir, 'release-title.txt')), false);
});

test('release-notes.mjs: CHANGELOG.md missing fails loud, exit 1, names the problem', () => {
  const dir = scratchWithLib();
  const res = run(dir, { GITHUB_REF_NAME: 'v1.0.0' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /could not read CHANGELOG\.md/);
});

// UMB-182: the workflow passes PREVIOUS_STABLE_TAG (git describe) and LATEST_TAG (the repo's current Latest).
const TWO = '## [1.2.0] - 2026-09-22\n\nNew.\n\n### Added\n- x\n\n## [1.1.0] - 2026-09-01\n\nOld.\n';

test('release-notes.mjs: release-latest.txt is "true" with no Latest yet and "false" for a tag older than Latest -- RED before UMB-182', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), TWO);
  let res = run(dir, { GITHUB_REF_NAME: 'v1.2.0', PREVIOUS_STABLE_TAG: 'v1.1.0', LATEST_TAG: '' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'release-latest.txt'), 'utf8'), 'true');
  res = run(dir, { GITHUB_REF_NAME: 'v1.2.0', PREVIOUS_STABLE_TAG: 'v1.1.0', LATEST_TAG: 'v2.0.0' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'release-latest.txt'), 'utf8'), 'false');
});

test('release-notes.mjs: an entry not followed by the previous stable tag heading fails loud, no files written (C-2)', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), TWO);
  const res = run(dir, { GITHUB_REF_NAME: 'v1.2.0', PREVIOUS_STABLE_TAG: 'v1.1.5', LATEST_TAG: '' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /v1\.1\.5/);
  assert.equal(fs.existsSync(path.join(dir, 'release-title.txt')), false);
});

test('release-notes.mjs: a PREVIOUS_STABLE_TAG or LATEST_TAG that is not a bare vX.Y.Z fails loud', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), TWO);
  let res = run(dir, { GITHUB_REF_NAME: 'v1.2.0', PREVIOUS_STABLE_TAG: 'main', LATEST_TAG: '' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /PREVIOUS_STABLE_TAG/);
  res = run(dir, { GITHUB_REF_NAME: 'v1.2.0', PREVIOUS_STABLE_TAG: 'v1.1.0', LATEST_TAG: 'latest' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /LATEST_TAG/);
});

test('release-notes.mjs: a tag/entry version mismatch fails loud rather than writing a wrong title', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [1.0.1] - 2026-01-02\n\nx.\n');
  const res = run(dir, { GITHUB_REF_NAME: 'v1.0.0' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /pushed tag is v1\.0\.0/);
  assert.equal(fs.existsSync(path.join(dir, 'release-title.txt')), false);
});

// UMB-182 posting path for a tag that already exists: a workflow_dispatch run sits on the DEFAULT BRANCH,
// so GITHUB_REF_NAME is the branch name and the tag being posted arrives as RELEASE_TAG.
test('release-notes.mjs: RELEASE_TAG wins over GITHUB_REF_NAME, so a dispatch run on main derives the named tag -- RED before the posting path', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), TWO);
  const res = run(dir, { GITHUB_REF_NAME: 'main', RELEASE_TAG: 'v1.2.0', PREVIOUS_STABLE_TAG: 'v1.1.0', LATEST_TAG: 'v1.1.0' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'release-title.txt'), 'utf8'), 'v1.2.0 - new');
  assert.equal(fs.readFileSync(path.join(dir, 'release-latest.txt'), 'utf8'), 'true');
  assert.equal(fs.readFileSync(path.join(dir, 'release-prerelease.txt'), 'utf8'), 'false');
});

test('release-notes.mjs: a RELEASE_TAG that is not a bare vX.Y.Z fails loud, even when it looks like shell (the input is untrusted text)', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), TWO);
  for (const bad of ['v1.2.0; echo pwned', '$(id)', 'v1.2', 'main', 'v1.2.0-beta.1']) {
    const res = run(dir, { GITHUB_REF_NAME: 'main', RELEASE_TAG: bad });
    assert.equal(res.status, 1, bad);
    assert.match(res.stderr, /not a bare vX\.Y\.Z tag/, bad);
  }
  assert.equal(fs.existsSync(path.join(dir, 'release-title.txt')), false);
});

const LAUNCH = '## [0.1.0-beta.1] - 2026-09-21\n\nThe first public beta.\n\n### Added\n- engine\n';

test('release-notes.mjs: LAUNCH_FORM=true derives the one pre-release launch Release: title with the label, never Latest, prerelease true', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), LAUNCH);
  const res = run(dir, { GITHUB_REF_NAME: 'main', RELEASE_TAG: 'v0.1.0-beta.1', LAUNCH_FORM: 'true', PREVIOUS_STABLE_TAG: '', LATEST_TAG: '' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'release-title.txt'), 'utf8'), 'v0.1.0-beta.1 - the first public beta');
  assert.equal(fs.readFileSync(path.join(dir, 'release-latest.txt'), 'utf8'), 'false', 'a pre-release is never Latest, even when the repo has no Latest yet');
  assert.equal(fs.readFileSync(path.join(dir, 'release-prerelease.txt'), 'utf8'), 'true');
});

test('release-notes.mjs: a hyphenated tag without LAUNCH_FORM, and LAUNCH_FORM on a stable tag, both fail loud (a launch form is one pre-release tag, said out loud)', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), LAUNCH);
  let res = run(dir, { GITHUB_REF_NAME: 'main', RELEASE_TAG: 'v0.1.0-beta.1' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /pre-release tag/);
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), TWO);
  res = run(dir, { GITHUB_REF_NAME: 'main', RELEASE_TAG: 'v1.2.0', LAUNCH_FORM: 'true' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /launch form/);
  assert.equal(fs.existsSync(path.join(dir, 'release-title.txt')), false);
});

// UMB-392: a lead paragraph under the summary line rides into the body (right after the Lead, before the sections); the title stays the summary only.
test('release-notes.mjs: a lead paragraph under the summary line is carried into release-body.md after the Lead -- RED before UMB-392', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [1.2.0] - 2026-10-03\n\nA short summary line.\n\nThe longer explanation, in a paragraph.\n\n### Added\n- x\n');
  const res = run(dir, { GITHUB_REF_NAME: 'v1.2.0' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'release-title.txt'), 'utf8'), 'v1.2.0 - a short summary line');
  assert.equal(fs.readFileSync(path.join(dir, 'release-body.md'), 'utf8'), 'A short summary line.\n\nThe longer explanation, in a paragraph.\n\n### Added\n- x\n');
});

// F-R19-2: the environment of the PARENT never reaches the child. An exported RELEASE_TAG, a launch-form flag and stale tags in the
// parent must not change what the CLI derives (the witness: RELEASE_TAG=v9.9.9 turned the lead-paragraph test red).
test('release-notes.mjs: the parent\'s RELEASE_TAG, PREVIOUS_STABLE_TAG, LATEST_TAG and LAUNCH_FORM never reach the child -- RED before F-R19-2', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [1.2.0] - 2026-10-03\n\nA short summary line.\n\n### Added\n- x\n');
  const saved = {};
  const leak = { RELEASE_TAG: 'v9.9.9', PREVIOUS_STABLE_TAG: 'v8.0.0', LATEST_TAG: 'v7.0.0', LAUNCH_FORM: 'true', GITHUB_REF_NAME: 'v6.6.6' };
  for (const k of Object.keys(leak)) { saved[k] = process.env[k]; process.env[k] = leak[k]; }
  try {
    const res = run(dir, { GITHUB_REF_NAME: 'v1.2.0' });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(fs.readFileSync(path.join(dir, 'release-title.txt'), 'utf8'), 'v1.2.0 - a short summary line');
    assert.equal(fs.readFileSync(path.join(dir, 'release-prerelease.txt'), 'utf8'), 'false', 'LAUNCH_FORM did not leak');
  } finally {
    for (const k of Object.keys(leak)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});

// UMB-433: the pre-tag check. "node scripts/release-notes.mjs --check" reads the TOP CHANGELOG entry (no tag needed, so it runs BEFORE the
// tag) and fails a summary whose announcement title would overflow GitHub's 200-character ceiling; the band stays an advisory warning.
const checkEntry = (summaryLen) => '## [1.2.0] - 2026-10-04\n\n' + 'Word '.repeat(Math.ceil(summaryLen / 5)).slice(0, summaryLen).trimEnd() + '.\n\n### Added\n- x\n';

test('release-notes.mjs --check: a summary whose announcement title fits passes (exit 0) and prints what it checked', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), checkEntry(60));
  const res = run(dir, {}, ['--check', '--repo', 'CoalBoard']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /release-notes --check: v1\.2\.0, announcement title "CoalBoard v1\.2\.0 - word/);
  assert.equal(fs.existsSync(path.join(dir, 'release-title.txt')), false, 'a check writes no release file');
});

test('release-notes.mjs --check: a summary that overflows the 200-character ceiling FAILS by name, exit 1; one over the 75 band only warns and passes -- RED before UMB-433', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), checkEntry(192));
  const bad = run(dir, {}, ['--check', '--repo', 'CoalBoard']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /release-title-cap: the announcement title "CoalBoard v1\.2\.0 - word/);
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), checkEntry(120));
  const warn = run(dir, {}, ['--check', '--repo', 'CoalBoard']);
  assert.equal(warn.status, 0, warn.stderr);
  assert.match(warn.stdout, /WARNING release-title-band/);
});

test('release-notes.mjs --check: the repository name comes from --repo, else GITHUB_REPOSITORY; with neither it says so (exit 1); an unknown flag is exit 64', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), checkEntry(60));
  assert.equal(run(dir, { GITHUB_REPOSITORY: 'TheColliery/CoalBoard' }, ['--check']).status, 0);
  const none = run(dir, {}, ['--check']);
  assert.equal(none.status, 1); assert.match(none.stderr, /cannot tell the repository name/);
  const flag = run(dir, {}, ['--bogus']);
  assert.equal(flag.status, 64); assert.match(flag.stderr, /usage:/);
  assert.equal(run(dir, {}, ['-h']).status, 0);
});

test('release-notes.mjs (the derive step after the tag): an announcement overflow is a WARNING that names the way out and never blocks the Release', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), checkEntry(192));
  const res = run(dir, { GITHUB_REF_NAME: 'v1.2.0', GITHUB_REPOSITORY: 'TheColliery/CoalBoard' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /WARNING release-title-cap: the announcement title/);
  assert.ok(fs.existsSync(path.join(dir, 'release-title.txt')), 'the Release is still derived');
});

// UMB-456 (1) i: the keys a node child is expected to hold are a NAMED set, not an inline guess. Two of them are not ours and not the parent's: macOS adds
// __CF_USER_TEXT_ENCODING to every process it starts, and node:test adds NODE_V8_COVERAGE to a child when the run measures coverage (CoalBoard's run
// 37224469491 failed on the first; a coverage run on this box fails on the second). A parent's credential or a workflow variable is still refused.
const CHILD_KEY_NAMES = ['path', 'systemroot', 'home', 'userprofile', 'temp', 'tmp', 'tmpdir', 'git_ceiling_directories', 'systemdrive', 'comspec', 'pathext', 'windir', 'homedrive', 'homepath', 'username', 'userdomain', 'logonserver', '__cf_user_text_encoding', 'node_v8_coverage'];
const CHILD_KEYS_OK = new RegExp('^(' + CHILD_KEY_NAMES.join('|') + ')$', 'i');

test('the allowed child keys take the two a runtime or an OS injects and refuse a credential or a workflow variable -- RED before UMB-456 (1) i', () => {
  for (const k of ['__CF_USER_TEXT_ENCODING', 'NODE_V8_COVERAGE', 'PATH', 'Path', 'HOME']) assert.ok(CHILD_KEYS_OK.test(k), k);
  for (const k of ['GITHUB_TOKEN', 'GH_TOKEN', 'RELEASE_TAG', 'GITHUB_REF_NAME', 'GIT_DIR', 'NODE_OPTIONS', 'LATEST_TAG']) assert.ok(!CHILD_KEYS_OK.test(k), k);
});

// UMB-443 ruling 2: the sandbox is real. A probe run through the same spawn function every test uses prints what the child sees.
test('the spawn the tests share gives the child the scratch folder as HOME, USERPROFILE, TEMP, TMP and TMPDIR, a git ceiling above it, and nothing of the parent\'s -- RED before UMB-443', () => {
  const dir = scratchWithLib();
  const probe = path.join(dir, 'probe.mjs');
  fs.writeFileSync(probe, "const e = process.env; console.log(JSON.stringify({ HOME: e.HOME, USERPROFILE: e.USERPROFILE, TEMP: e.TEMP, TMP: e.TMP, TMPDIR: e.TMPDIR, CEIL: e.GIT_CEILING_DIRECTORIES, HOMEDRIVE: e.HOMEDRIVE, HOMEPATH: e.HOMEPATH, NOSYS: e.GIT_CONFIG_NOSYSTEM, KEYS: Object.keys(e).sort() }));\n");
  const saved = { HOME: process.env.HOME, GITHUB_TOKEN: process.env.GITHUB_TOKEN, GH_TOKEN: process.env.GH_TOKEN };
  process.env.GITHUB_TOKEN = 'a-parent-value'; process.env.GH_TOKEN = 'a-parent-value';
  try {
    const r = spawnIn(dir, probe);
    assert.equal(r.status, 0, r.stderr);
    const seen = JSON.parse(r.stdout);
    for (const k of ['HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR']) assert.equal(seen[k], dir, k + ' is the scratch folder');
    assert.equal(seen.CEIL, path.dirname(dir));
    assert.equal(seen.NOSYS, '1', 'the system git configuration is off for the child too');
    if (process.platform === 'win32') assert.equal(seen.HOMEDRIVE + seen.HOMEPATH, dir, 'HOMEDRIVE and HOMEPATH point into the scratch folder too');
    assert.ok(!seen.KEYS.includes('GITHUB_TOKEN') && !seen.KEYS.includes('GH_TOKEN'), 'no credential of the parent reaches the child');
    assert.deepEqual(seen.KEYS.filter((k) => k !== 'GIT_CONFIG_NOSYSTEM' && !CHILD_KEYS_OK.test(k)), [], 'nothing else but what node needs to start');
  } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
});

// UMB-443 ruling 2: the git spawn inside --check gets an explicit env too. A GIT_DIR a hook (or a patrol) leaves in the environment would aim it
// at ANOTHER repository's origin; the check must read the repository it runs in.
test('release-notes.mjs --check reads the origin of the repository it runs in, never the one a GIT_DIR names -- RED before UMB-443', () => {
  const dir = scratchWithLib();
  const decoy = scratchWithLib();
  const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8', timeout: 30000, env: sandboxEnv(cwd) });
  for (const [d, name] of [[dir, 'Realrepo'], [decoy, 'Decoyrepo']]) { git(d, 'init', '-q'); git(d, 'remote', 'add', 'origin', 'https://github.com/TheColliery/' + name + '.git'); }
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), checkEntry(60));
  const res = run(dir, { GIT_DIR: path.join(decoy, '.git'), GIT_WORK_TREE: decoy }, ['--check']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /announcement title "Realrepo v1\.2\.0 - /, res.stdout);
  assert.doesNotMatch(res.stdout, /Decoyrepo/);
});

// UMB-456 (1) iii: the keep list passes GIT_CEILING_DIRECTORIES through, so a folder that is NOT a repository but sits inside one does not read the
// enclosing repository's origin when a ceiling says where the search stops (CoalBoard LOW-2). RED before UMB-456 (1) iii: the ceiling was dropped.
test('release-notes.mjs --check: a plain folder inside a repository honours GIT_CEILING_DIRECTORIES and never reads the enclosing origin -- RED before UMB-456 (1) iii', () => {
  const outer = scratchWithLib();
  const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8', timeout: 30000, env: sandboxEnv(cwd) });
  git(outer, 'init', '-q'); git(outer, 'remote', 'add', 'origin', 'https://github.com/TheColliery/Enclosing.git');
  const sub = path.join(outer, 'sub'); fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, 'CHANGELOG.md'), checkEntry(60));
  const res = run(sub, { GIT_CEILING_DIRECTORIES: outer }, ['--check'], ['GIT_CEILING_DIRECTORIES']);
  assert.equal(res.status, 1, res.stdout);
  assert.match(res.stderr, /cannot tell the repository name/);
  assert.doesNotMatch(res.stdout + res.stderr, /Enclosing/);
  // and without a ceiling the enclosing repository is what git finds, which is why the ceiling has to get through
  const open = run(sub, { GIT_CEILING_DIRECTORIES: path.dirname(outer) }, ['--check'], ['GIT_CEILING_DIRECTORIES']);
  assert.equal(open.status, 0, open.stderr);
  assert.match(open.stdout, /announcement title "Enclosing v1\.2\.0 - /);
});

// UMB-456 (1) vii: --repo names the repository for --check only. In the derive step it was silently accepted and ignored.
test('release-notes.mjs: --repo outside --check is an unknown argument (exit 64), and --check --repo still works -- RED before UMB-456 (1) vii', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [1.2.0] - 2026-09-22\n\nA proof.\n');
  const res = run(dir, { GITHUB_REF_NAME: 'v1.2.0' }, ['--repo', 'CoalBoard']);
  assert.equal(res.status, 64, res.stderr);
  assert.match(res.stderr, /unknown argument "--repo"/);
  assert.equal(fs.existsSync(path.join(dir, 'release-title.txt')), false, 'nothing was derived');
  assert.equal(run(dir, {}, ['--check', '--repo', 'CoalBoard']).status, 0);
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

// 2026-11-03a: the CHANGELOG is read only as a regular file under a byte bound, and the four release files are written by replacing their directory entry, never
// through whatever an existing entry points at (a link left in the tag's tree, or a second name of another file).
test('release-notes.mjs: a CHANGELOG.md past the byte bound is refused by name before it is read, exit 1, no files written -- RED before 2026-11-03a', () => {
  // read from the script's text: importing it would run it
  const MAX_CHANGELOG_BYTES = Number((/^const MAX_CHANGELOG_BYTES = ([0-9]+);/m.exec(fs.readFileSync(SCRIPT, 'utf8')) || [])[1]);
  assert.ok(Number.isInteger(MAX_CHANGELOG_BYTES) && MAX_CHANGELOG_BYTES > 0, 'the bound is a named number');
  const dir = scratchWithLib();
  const head = '## [1.2.0] - 2026-09-22\n\nA test-only CLI wiring proof.\n\n### Added\n- x\n';
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), head + ' '.repeat(MAX_CHANGELOG_BYTES + 1 - head.length));
  const res = run(dir, { GITHUB_REF_NAME: 'v1.2.0' });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stderr, /CHANGELOG\.md .*byte bound/);
  assert.equal(fs.existsSync(path.join(dir, 'release-title.txt')), false);
  const chk = run(dir, { GITHUB_REPOSITORY: 'o/Demo' }, ['--check']);
  assert.equal(chk.status, 1, chk.stdout + chk.stderr);
  assert.match(chk.stderr, /CHANGELOG\.md .*byte bound/);
});

test('release-notes.mjs: a CHANGELOG.md that is a symlink is refused by name, never followed (skipped visibly where the account cannot make one) -- RED before 2026-11-03a', (t) => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'real.md'), '## [1.2.0] - 2026-09-22\n\nA test-only CLI wiring proof.\n\n### Added\n- x\n');
  try { fs.symlinkSync(path.join(dir, 'real.md'), path.join(dir, 'CHANGELOG.md'), 'file'); } catch { t.skip('this account cannot make a file symlink here'); return; }
  const res = run(dir, { GITHUB_REF_NAME: 'v1.2.0' });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stderr, /CHANGELOG\.md .*not a regular file/);
});

test('release-notes.mjs: a release file that already exists as a second name of another file is replaced, and the other file keeps its bytes -- RED before 2026-11-03a', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [1.2.0] - 2026-09-22\n\nA test-only CLI wiring proof.\n\n### Added\n- x\n');
  const victim = path.join(dir, 'victim.txt');
  fs.writeFileSync(victim, 'keep me\n');
  for (const name of ['release-title.txt', 'release-body.md', 'release-latest.txt', 'release-prerelease.txt']) fs.linkSync(victim, path.join(dir, name));
  const res = run(dir, { GITHUB_REF_NAME: 'v1.2.0' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'keep me\n', 'the write went through the existing entry to the other file');
  assert.equal(fs.readFileSync(path.join(dir, 'release-title.txt'), 'utf8'), 'v1.2.0 - a test-only CLI wiring proof');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.includes('.tmp-')), [], 'no temporary file is left behind');
});

test('release-notes.mjs: a release file that is a symlink is replaced by a plain file, never written through (skipped visibly where the account cannot make one) -- RED before 2026-11-03a', (t) => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [1.2.0] - 2026-09-22\n\nA test-only CLI wiring proof.\n\n### Added\n- x\n');
  const victim = path.join(dir, 'victim.txt');
  fs.writeFileSync(victim, 'keep me\n');
  try { fs.symlinkSync(victim, path.join(dir, 'release-body.md'), 'file'); } catch { t.skip('this account cannot make a file symlink here'); return; }
  const res = run(dir, { GITHUB_REF_NAME: 'v1.2.0' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'keep me\n');
  assert.equal(fs.lstatSync(path.join(dir, 'release-body.md')).isSymbolicLink(), false);
});

// order 2026-11-03b: the CHANGELOG is opened FIRST and every check reads the open descriptor. A stat of the name before the open leaves a window in
// which the entry can be swapped for a link to another file between the check and the read (a file-system race). A preload records the order in which
// the script touches CHANGELOG.md; the script's own code is never changed for the test.
test('release-notes.mjs: CHANGELOG.md is opened before any check of its name, so no swap can land between a check and the read -- RED before 2026-11-03b', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [1.2.0] - 2026-09-22\n\nA test-only CLI wiring proof.\n\n### Added\n- x\n');
  const preload = path.join(dir, 'order-probe.mjs');
  const log = path.join(dir, 'order.log');
  fs.writeFileSync(preload, [
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const seen = [];',
    "for (const name of ['lstatSync', 'statSync', 'existsSync', 'accessSync', 'openSync', 'readFileSync']) {",
    '  const orig = fs[name];',
    "  fs[name] = function (p, ...rest) { if (typeof p === 'string' && p.endsWith('CHANGELOG.md')) seen.push(name); return orig.call(this, p, ...rest); };",
    '}',
    'syncBuiltinESMExports();',
    "process.on('exit', () => { fs.writeFileSync(process.env.ORDER_LOG, seen.join(' ')); });",
  ].join('\n'));
  for (const args of [[], ['--check']]) {
    const res = spawnIn(dir, SCRIPT, args, { env: { GITHUB_REF_NAME: 'v1.2.0', GITHUB_REPOSITORY: 'o/Demo', NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, ORDER_LOG: log } });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const order = fs.readFileSync(log, 'utf8').split(' ').filter(Boolean);
    const open = order.indexOf('openSync');
    assert.ok(open >= 0, `the CHANGELOG is opened (${args.join(' ') || 'derive'}): ${order.join(' ')}`);
    assert.deepEqual(order.slice(0, open), [], `nothing reads the name before the open (${args.join(' ') || 'derive'}): ${order.join(' ')}`);
    assert.ok(!order.slice(open).includes('readFileSync'), 'the read goes through the open descriptor, never the name');
  }
});
// order 2026-11-07a (CoalLedger's CodeQL #29 hardening, brought into the canon): the descriptor that is read must be the file the name names when the
// checks run. A preload swaps the entry right after the script's own open returns, the window a race would use; the script's code is never changed.
const swapProbe = (dir) => {
  const preload = path.join(dir, 'swap-probe.mjs');
  fs.writeFileSync(preload, [
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const orig = fs.openSync;',
    'let done = false;',
    'fs.openSync = function (p, ...rest) {',
    '  const fd = orig.call(this, p, ...rest);',
    "  if (!done && typeof p === 'string' && p.endsWith('CHANGELOG.md')) { done = true; fs.rmSync(p, { force: true }); fs.renameSync(process.env.SWAP_FROM, p); }",
    '  return fd;',
    '};',
    'syncBuiltinESMExports();',
  ].join('\n'));
  return preload;
};
const ENTRY = '## [1.2.0] - 2026-09-22\n\nA test-only CLI wiring proof.\n\n### Added\n- x\n';

test('release-notes.mjs: a CHANGELOG.md swapped for another file between the open and the read is refused by name, exit 1, no release files -- RED before 2026-11-07a', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), ENTRY);
  fs.writeFileSync(path.join(dir, 'other.md'), ENTRY.replace('A test-only', 'Another'));
  const preload = swapProbe(dir);
  const res = spawnIn(dir, SCRIPT, [], { env: { GITHUB_REF_NAME: 'v1.2.0', NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, SWAP_FROM: path.join(dir, 'other.md') } });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stderr, /CHANGELOG\.md changed between the check and the read: refused, never read/);
  assert.equal(fs.existsSync(path.join(dir, 'release-title.txt')), false, 'no release file is written from the file the name no longer names');
});

test('release-notes.mjs: a CHANGELOG.md that is a link when opened and a plain file by the read is refused with the link message, on every platform (skipped visibly where the account cannot make a file symlink) -- RED before 2026-11-07a where no-follow is missing (Windows)', (t) => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'real.md'), ENTRY);
  fs.writeFileSync(path.join(dir, 'other.md'), ENTRY.replace('A test-only', 'Another'));
  try { fs.symlinkSync(path.join(dir, 'real.md'), path.join(dir, 'CHANGELOG.md'), 'file'); } catch { t.skip('this account cannot make a file symlink here'); return; }
  const preload = swapProbe(dir);
  const res = spawnIn(dir, SCRIPT, [], { env: { GITHUB_REF_NAME: 'v1.2.0', NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, SWAP_FROM: path.join(dir, 'other.md') } });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stderr, /CHANGELOG\.md (is not a regular file|changed between the check and the read)/);
  assert.equal(fs.existsSync(path.join(dir, 'release-title.txt')), false);
});

test('release-notes.mjs: an untouched regular CHANGELOG.md still derives (the descriptor and the name agree), so the swap check refuses nothing it should read', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), ENTRY);
  const res = spawnIn(dir, SCRIPT, [], { env: { GITHUB_REF_NAME: 'v1.2.0' } });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'release-title.txt'), 'utf8'), 'v1.2.0 - a test-only CLI wiring proof');
});

// order 2026-11-07b (1): the size check reads the descriptor at its fstat, so a CHANGELOG.md that grows after it must still be read only up to the bound. The seam is a
// preload: right after the script's own fstat of the open descriptor returns, it appends to the file, the growth a race would make; the script's code is never changed.
const BOUND = 8388608;
const growProbe = (dir) => {
  const preload = path.join(dir, 'grow-probe.mjs');
  fs.writeFileSync(preload, [
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const open = fs.openSync;',
    'const fstat = fs.fstatSync;',
    'let fd = null;',
    'let grown = false;',
    "fs.openSync = function (p, ...rest) { const r = open.call(this, p, ...rest); if (fd === null && typeof p === 'string' && p.endsWith('CHANGELOG.md')) fd = r; return r; };",
    'fs.fstatSync = function (f, ...rest) {',
    '  const r = fstat.call(this, f, ...rest);',
    '  if (!grown && f === fd) { grown = true; fs.appendFileSync(process.env.GROW_PATH, Buffer.alloc(Number(process.env.GROW_BYTES), 0x78)); }',
    '  return r;',
    '};',
    'syncBuiltinESMExports();',
  ].join('\n'));
  return preload;
};
const growEnv = (dir, preload, bytes) => ({ GITHUB_REF_NAME: 'v1.2.0', NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, GROW_PATH: path.join(dir, 'CHANGELOG.md'), GROW_BYTES: String(bytes) });

test('release-notes.mjs: a CHANGELOG.md that grows past the byte bound after the size check is refused by the read, exit 1, no release files -- RED before 2026-11-07b', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), ENTRY);
  const res = spawnIn(dir, SCRIPT, [], { env: growEnv(dir, growProbe(dir), BOUND) });
  assert.equal(res.status, 1, res.stdout + res.stderr.slice(0, 2000));
  assert.match(res.stderr, new RegExp(`CHANGELOG\\.md is more than ${BOUND} bytes by the read \\(it grew after the size check\\), past the byte bound of ${BOUND}: refused before it is used`));
  assert.equal(fs.existsSync(path.join(dir, 'release-title.txt')), false, 'no release file is written from a CHANGELOG read past its bound');
});

test('release-notes.mjs: a CHANGELOG.md that grows after the size check to exactly the byte bound is still read and derives -- the bound is inclusive', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), ENTRY);
  const res = spawnIn(dir, SCRIPT, [], { env: growEnv(dir, growProbe(dir), BOUND - Buffer.byteLength(ENTRY)) });
  assert.equal(res.status, 0, res.stdout + res.stderr.slice(0, 2000));
  assert.equal(fs.readFileSync(path.join(dir, 'release-title.txt'), 'utf8'), 'v1.2.0 - a test-only CLI wiring proof');
});


// order 2026-11-07b (2): an O_NOFOLLOW open of a link fails ELOOP on Linux and macOS, EMLINK on FreeBSD and EFTYPE on NetBSD (their open(2) pages); each is the link
// message. The seam is a preload whose open of CHANGELOG.md throws that code, since this box raises none of the three; any other open error still reaches the reader as itself.
const openErrorProbe = (dir, code) => {
  const preload = path.join(dir, `open-error-${code}.mjs`);
  fs.writeFileSync(preload, [
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const open = fs.openSync;',
    `fs.openSync = function (p, ...rest) { if (typeof p === 'string' && p.endsWith('CHANGELOG.md')) throw Object.assign(new Error('${code}: probe'), { code: '${code}' }); return open.call(this, p, ...rest); };`,
    'syncBuiltinESMExports();',
  ].join('\n'));
  return preload;
};

for (const [code, where] of [['ELOOP', 'Linux and macOS, so this box tests it too'], ['EMLINK', 'FreeBSD'], ['EFTYPE', 'NetBSD']]) {
  test(`release-notes.mjs: an open that fails ${code} (a no-follow open of a link on ${where}) is refused with the link message, exit 1${code === 'ELOOP' ? '' : ' -- RED before 2026-11-07b'}`, () => {
    const dir = scratchWithLib();
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), ENTRY);
    const res = spawnIn(dir, SCRIPT, [], { env: { GITHUB_REF_NAME: 'v1.2.0', NODE_OPTIONS: `--import=${pathToFileURL(openErrorProbe(dir, code)).href}` } });
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stderr, /CHANGELOG\.md is not a regular file \(a link or a device is refused, never followed\)/);
    assert.doesNotMatch(res.stderr, new RegExp(code));
  });
}

test('release-notes.mjs: any other open error (EACCES) still reaches the reader as itself, never dressed as the link message', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), ENTRY);
  const res = spawnIn(dir, SCRIPT, [], { env: { GITHUB_REF_NAME: 'v1.2.0', NODE_OPTIONS: `--import=${pathToFileURL(openErrorProbe(dir, 'EACCES')).href}` } });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stderr, /could not read CHANGELOG\.md: EACCES: probe/);
  assert.doesNotMatch(res.stderr, /not a regular file/);
});
