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
  return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
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

test('release-notes.mjs: a tag/entry version mismatch fails loud rather than writing a wrong title', () => {
  const dir = scratchWithLib();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '## [1.0.1] - 2026-01-02\n\nx.\n');
  const res = run(dir, { GITHUB_REF_NAME: 'v1.0.0' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /pushed tag is v1\.0\.0/);
  assert.equal(fs.existsSync(path.join(dir, 'release-title.txt')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
