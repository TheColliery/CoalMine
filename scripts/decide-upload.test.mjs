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

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
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
