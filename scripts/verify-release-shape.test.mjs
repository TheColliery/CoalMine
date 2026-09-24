import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify-release-shape.mjs');

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'verify-release-shape-test-'));
}

function run(cwd, stdin) {
  return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', input: stdin });
}

test('verify-release-shape.mjs: matching title + body -> exit 0', () => {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, 'release-title.txt'), 'v1.0.0 - a fix\n');
  fs.writeFileSync(path.join(dir, 'release-body.md'), 'A fix.\n');
  const res = run(dir, JSON.stringify({ name: 'v1.0.0 - a fix', body: 'A fix.' }));
  assert.equal(res.status, 0, res.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('verify-release-shape.mjs: a published body that PRESERVES its trailing newline still matches -- rot-canary catch: the old code only trimmed the INTENDED side, so this exact shape would have false-failed every real release under this mechanism', () => {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, 'release-title.txt'), 'v1.0.0 - a fix\n');
  fs.writeFileSync(path.join(dir, 'release-body.md'), 'A fix.\n');
  const res = run(dir, JSON.stringify({ name: 'v1.0.0 - a fix', body: 'A fix.\n' }));
  assert.equal(res.status, 0, res.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('verify-release-shape.mjs: a title mismatch fails loud and names both strings, exit 1', () => {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, 'release-title.txt'), 'v1.0.0 - a fix\n');
  fs.writeFileSync(path.join(dir, 'release-body.md'), 'A fix.\n');
  const res = run(dir, JSON.stringify({ name: 'v1.0.0', body: 'A fix.' }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /TITLE MISMATCH/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('verify-release-shape.mjs: a SAME-LENGTH body substitution is caught -- the exact CoalHearth em-dash-to-hyphen incident this rail exists for', () => {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, 'release-title.txt'), 'v1.0.0 - a fix\n');
  fs.writeFileSync(path.join(dir, 'release-body.md'), 'The API—which is public—returns JSON.\n');
  const res = run(dir, JSON.stringify({ name: 'v1.0.0 - a fix', body: 'The API-which is public-returns JSON.' }));
  assert.equal(res.status, 1, 'same character COUNT, different bytes -- a length compare would have missed this');
  assert.match(res.stderr, /BODY MISMATCH/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('verify-release-shape.mjs: no stdin at all fails loud rather than comparing against an empty string silently', () => {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, 'release-title.txt'), 'v1.0.0 - a fix\n');
  fs.writeFileSync(path.join(dir, 'release-body.md'), 'A fix.\n');
  const res = run(dir, '');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /no published Release JSON on stdin/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('verify-release-shape.mjs: malformed JSON on stdin fails loud, names it, never crashes with a raw stack', () => {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, 'release-title.txt'), 'v1.0.0 - a fix\n');
  fs.writeFileSync(path.join(dir, 'release-body.md'), 'A fix.\n');
  const res = run(dir, '{not json');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /not valid JSON/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('verify-release-shape.mjs: the derived files are missing (release-notes.mjs never ran) fails loud, names the problem', () => {
  const dir = scratch();
  const res = run(dir, JSON.stringify({ name: 'x', body: 'y' }));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /could not read the derived title\/body/);
  fs.rmSync(dir, { recursive: true, force: true });
});
