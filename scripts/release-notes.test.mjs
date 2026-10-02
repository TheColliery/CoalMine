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

function scratchWithLib() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-notes-test-'));
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(LIB_DIR, 'release-shape.mjs'), path.join(dir, 'scripts', 'lib', 'release-shape.mjs'));
  return dir;
}

function run(cwd, env) {
  return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', timeout: 30000, env: { ...process.env, ...env } });
}

test('release-notes.mjs: writes release-title.txt + release-body.md derived from CHANGELOG.md, exit 0', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [1.2.0] - 2026-09-22\n\nA test-only CLI wiring proof.\n\n### Added\n- x\n');
  const res = run(dir, { GITHUB_REF_NAME: 'v1.2.0' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'release-title.txt'), 'utf8'), 'v1.2.0 - a test-only CLI wiring proof');
  assert.equal(fs.readFileSync(path.join(dir, 'release-body.md'), 'utf8'), 'A test-only CLI wiring proof.\n\n### Added\n- x\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('release-notes.mjs: a non-vX.Y.Z ref (e.g. a branch name from workflow_dispatch) fails loud, exit 1, no files written', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [1.0.0] - 2026-01-01\n\nx.\n');
  const res = run(dir, { GITHUB_REF_NAME: 'main' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /not a bare vX\.Y\.Z tag/);
  assert.equal(fs.existsSync(path.join(dir, 'release-title.txt')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('release-notes.mjs: CHANGELOG.md missing fails loud, exit 1, names the problem', () => {
  const dir = scratchWithLib();
  const res = run(dir, { GITHUB_REF_NAME: 'v1.0.0' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /could not read CHANGELOG\.md/);
  fs.rmSync(dir, { recursive: true, force: true });
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
  fs.rmSync(dir, { recursive: true, force: true });
});

test('release-notes.mjs: an entry not followed by the previous stable tag heading fails loud, no files written (C-2)', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), TWO);
  const res = run(dir, { GITHUB_REF_NAME: 'v1.2.0', PREVIOUS_STABLE_TAG: 'v1.1.5', LATEST_TAG: '' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /v1\.1\.5/);
  assert.equal(fs.existsSync(path.join(dir, 'release-title.txt')), false);
  fs.rmSync(dir, { recursive: true, force: true });
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
  fs.rmSync(dir, { recursive: true, force: true });
});

test('release-notes.mjs: a tag/entry version mismatch fails loud rather than writing a wrong title', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [1.0.1] - 2026-01-02\n\nx.\n');
  const res = run(dir, { GITHUB_REF_NAME: 'v1.0.0' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /pushed tag is v1\.0\.0/);
  assert.equal(fs.existsSync(path.join(dir, 'release-title.txt')), false);
  fs.rmSync(dir, { recursive: true, force: true });
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
  fs.rmSync(dir, { recursive: true, force: true });
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
  fs.rmSync(dir, { recursive: true, force: true });
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
  fs.rmSync(dir, { recursive: true, force: true });
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
  fs.rmSync(dir, { recursive: true, force: true });
});
