// 29am (T-29al-7, Deep Scan row 16): folderHashes keys its result by file name. A plain object takes a file named __proto__ as the
// prototype, so that file is never hashed and a change to its bytes is invisible to sameHashes. Hermetic: a temp folder under os.tmpdir().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { folderHashes, sameHashes } from './install-record.mjs';

function mkFolder(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-proto-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  return dir;
}

test('29am: a root file named __proto__ is hashed as a key of its own, and a change to its bytes changes the hashes', (t) => {
  const dir = mkFolder(t);
  fs.writeFileSync(path.join(dir, '__proto__'), 'one', 'utf8');
  const first = folderHashes(dir);
  assert.ok(first && Object.hasOwn(first, '__proto__'), 'the file named __proto__ is an own key of the result, not the prototype');
  fs.writeFileSync(path.join(dir, '__proto__'), 'two', 'utf8');
  const second = folderHashes(dir);
  assert.notDeepStrictEqual(first, second, 'a changed __proto__ file must change the recorded hashes');
  assert.equal(sameHashes(first, second), false, 'sameHashes sees the change');
});

test('29am: sameHashes compares own keys only, so a prototype never makes two hash maps equal', (t) => {
  const dir = mkFolder(t);
  fs.writeFileSync(path.join(dir, 'a.md'), 'same', 'utf8');
  const here = folderHashes(dir);
  assert.ok(here, 'control: the folder is hashable');
  assert.equal(sameHashes(here, here), true, 'control: a map equals itself');
  assert.equal(sameHashes(here, {}), false, 'an empty recorded map never matches a folder that holds a file');
});
