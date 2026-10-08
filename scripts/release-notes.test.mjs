// Spawns the real CLI against a sandboxed scratch tree (never re-derives the derivation logic
// by import -- that is release-shape.test.mjs's job; this proves the CLI wiring itself: env in,
// files out, exit codes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'release-notes.mjs');
const LIB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib');

// F-R19-2 and UMB-443 ruling 2: a spawned child gets an EXPLICIT environment, never the parent's, and its HOME, USERPROFILE, TEMP, TMP and
// TMPDIR are the test's OWN scratch folder, so nothing it reads or writes can reach the developer's profile or temp folder, and
// GIT_CEILING_DIRECTORIES stops git climbing out of the scratch folder into a repository above it. RELEASE_TAG, PREVIOUS_STABLE_TAG,
// LATEST_TAG, LAUNCH_FORM, GITHUB_REF_NAME and the rest of an Actions run's variables change what these scripts do, so none of the
// parent's reaches the child. Only what a node child needs to start (the program path and, on Windows, SystemRoot) is passed through.
const BASE_ENV_KEYS = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT'];
const sandboxEnv = (dir, extra = {}) => ({
  ...Object.fromEntries(BASE_ENV_KEYS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])),
  HOME: dir, USERPROFILE: dir, TEMP: dir, TMP: dir, TMPDIR: dir, GIT_CEILING_DIRECTORIES: path.dirname(dir),
  // Windows puts HOMEDRIVE and HOMEPATH (the real profile) into every process it starts; they are overridden too, so no path variable points out.
  ...(process.platform === 'win32' ? { HOMEDRIVE: path.parse(dir).root.replace(/[\\/]+$/, ''), HOMEPATH: dir.slice(path.parse(dir).root.length - 1) } : {}),
  ...extra,
});
// The one place every spawn of these tests goes through, so the sandbox is applied by construction.
const spawnIn = (cwd, script, args = [], { env, input } = {}) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', timeout: 30000, input, env: sandboxEnv(cwd, env) });
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function scratchWithLib() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-notes-test-'));
  made.push(dir);
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(LIB_DIR, 'release-shape.mjs'), path.join(dir, 'scripts', 'lib', 'release-shape.mjs'));
  return dir;
}

function run(cwd, env, args = []) {
  return spawnIn(cwd, SCRIPT, args, { env });
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
  fs.writeFileSync(probe, "const e = process.env; console.log(JSON.stringify({ HOME: e.HOME, USERPROFILE: e.USERPROFILE, TEMP: e.TEMP, TMP: e.TMP, TMPDIR: e.TMPDIR, CEIL: e.GIT_CEILING_DIRECTORIES, HOMEDRIVE: e.HOMEDRIVE, HOMEPATH: e.HOMEPATH, KEYS: Object.keys(e).sort() }));\n");
  const saved = { HOME: process.env.HOME, GITHUB_TOKEN: process.env.GITHUB_TOKEN, GH_TOKEN: process.env.GH_TOKEN };
  process.env.GITHUB_TOKEN = 'a-parent-value'; process.env.GH_TOKEN = 'a-parent-value';
  try {
    const r = spawnIn(dir, probe);
    assert.equal(r.status, 0, r.stderr);
    const seen = JSON.parse(r.stdout);
    for (const k of ['HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR']) assert.equal(seen[k], dir, k + ' is the scratch folder');
    assert.equal(seen.CEIL, path.dirname(dir));
    if (process.platform === 'win32') assert.equal(seen.HOMEDRIVE + seen.HOMEPATH, dir, 'HOMEDRIVE and HOMEPATH point into the scratch folder too');
    assert.ok(!seen.KEYS.includes('GITHUB_TOKEN') && !seen.KEYS.includes('GH_TOKEN'), 'no credential of the parent reaches the child');
    assert.deepEqual(seen.KEYS.filter((k) => !CHILD_KEYS_OK.test(k)), [], 'nothing else but what node needs to start');
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
  const res = run(sub, { GIT_CEILING_DIRECTORIES: outer }, ['--check']);
  assert.equal(res.status, 1, res.stdout);
  assert.match(res.stderr, /cannot tell the repository name/);
  assert.doesNotMatch(res.stdout + res.stderr, /Enclosing/);
  // and without a ceiling the enclosing repository is what git finds, which is why the ceiling has to get through
  const open = run(sub, { GIT_CEILING_DIRECTORIES: path.dirname(outer) }, ['--check']);
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
