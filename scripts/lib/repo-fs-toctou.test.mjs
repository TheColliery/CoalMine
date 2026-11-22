// T-76 / 29nj: the reader's check-then-use window. A user's file is checked by name (the folder chain, the kind) and then opened BY NAME, so a
// name swapped between the check and the open used to be read. The fix compares the opened handle's dev and ino (bigint) with the identity the check
// took, and refuses a mismatch. The seam: the test reassigns fs.openSync to swap the name just before the real open, in the script helper and in the
// hook reader (the hook partial is spliced into each hook copy, not exported, so its text is evaluated the way a copy runs it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { removeTree } from './test-sandbox.mjs';
import { makeRoot } from './read-window.mjs';
import { readRepoBytesAndStat } from './repo-fs.mjs';

const ROOM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PARTIAL = path.join(ROOM, 'hooks', '_shared', 'node-config.js');
const MAX = 1 << 20;
const ORIGINAL = Buffer.from('{ "autoScanFileCap": 7 }\n');
const OTHER = Buffer.from('{ "autoScanFileCap": 9 }\n');

// The hook reader, evaluated from the shared partial's text (the same code a hook copy runs).
function loadHookReader() {
  const text = fs.readFileSync(PARTIAL, 'utf8');
  const req = createRequire(import.meta.url);
  return new Function('require', 'fs', 'path', 'os', `${text}\nreturn { readRepoFileBounded };`)(req, fs, path, os).readRepoFileBounded;
}

// Leg a: the name is replaced by another file (a rename over the name). Leg b: the name is pointed at another file inside the root (a hard link).
// The swap runs once, just before the first open of the target, and the real open then runs on whatever the name holds.
function withSwap(target, kind, other, body) {
  const realOpen = fs.openSync;
  let swapped = false;
  fs.openSync = function (p, ...rest) {
    if (!swapped && path.resolve(String(p)) === path.resolve(target)) {
      swapped = true;
      if (kind === 'replace') fs.renameSync(other, target);
      else { fs.unlinkSync(target); fs.linkSync(other, target); }
    }
    return realOpen.call(fs, p, ...rest);
  };
  try { return body(); } finally { fs.openSync = realOpen; }
}

function fixture(t, prefix) {
  const root = makeRoot(prefix, removeTree, t);
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const target = path.join(proj, 'config.json');
  const other = path.join(proj, 'other.json');
  fs.writeFileSync(target, ORIGINAL);
  fs.writeFileSync(other, OTHER);
  return { proj, target, other };
}

const LEGS = [
  ['a', 'replace', 'the name is replaced by another file'],
  ['b', 'link', 'the name is pointed at another file inside the root'],
];

for (const [leg, kind, what] of LEGS) {
  test(`repo-fs: a read whose name is swapped after the check is refused, never read (leg ${leg}: ${what})`, (t) => {
    const { proj, target, other } = fixture(t, 'cm-toctou-s-');
    const got = withSwap(target, kind, other, () => readRepoBytesAndStat(target, proj, MAX));
    assert.equal(got, null, `the swapped name is refused; read ${got ? JSON.stringify(got.bytes.toString('utf8')) : ''}`);
  });

  test(`hook reader: a read whose name is swapped after the check is refused, never read (leg ${leg}: ${what})`, (t) => {
    const readRepoFileBounded = loadHookReader();
    const { proj, target, other } = fixture(t, 'cm-toctou-h-');
    const got = withSwap(target, kind, other, () => readRepoFileBounded(target, proj, MAX));
    assert.equal(got, null, `the swapped name is refused; read ${got ? JSON.stringify(got) : ''}`);
  });
}

test('repo-fs: a read with no swap returns the file\'s bytes (positive control: the leg above is not vacuous)', (t) => {
  const { proj, target } = fixture(t, 'cm-toctou-c-');
  const got = readRepoBytesAndStat(target, proj, MAX);
  assert.ok(got, 'the unswapped file is read');
  assert.deepEqual(got.bytes, ORIGINAL);
});

test('hook reader: a read with no swap returns the file\'s text (positive control)', (t) => {
  const readRepoFileBounded = loadHookReader();
  const { proj, target } = fixture(t, 'cm-toctou-hc-');
  assert.equal(readRepoFileBounded(target, proj, MAX), ORIGINAL.toString('utf8'));
});
