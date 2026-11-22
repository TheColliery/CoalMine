// T-29nj-1 (29nu): a link the reader honours is retargeted between its realpath check and the identity read, and the reader then reads the new file. The fix
// takes a link's identity from the target its one realpath resolved (the same path, read again with an lstat that must say regular file), never from a second
// stat of the entry's name, and the open is compared with that identity (dev and ino). The seam needs no symlink privilege: the first lstat of the entry
// reports a link, and the first realpath of the entry returns the TARGET's path; just after that realpath the entry's name is retargeted (unlink, then a hard
// link to another file). A real-link leg (its own test) retargets a real symlink at the same point, where the account can make one.
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
const VICTIM = Buffer.from('{ "autoScanFileCap": 7 }\n');
const INSIDE = Buffer.from('{ "autoScanFileCap": 8 }\n');
const OUTSIDE = Buffer.from('{ "autoScanFileCap": 9 }\n');

// The hook reader, evaluated from the shared partial's text (the same code a hook copy runs).
function loadHookReader() {
  const text = fs.readFileSync(PARTIAL, 'utf8');
  const req = createRequire(import.meta.url);
  return new Function('require', 'fs', 'path', 'os', `${text}\nreturn { readRepoFileBounded };`)(req, fs, path, os).readRepoFileBounded;
}

const readScript = (p, root) => { const r = readRepoBytesAndStat(p, root, MAX); return r === null ? null : r.bytes; };
const readHook = (p, root) => { const s = loadHookReader()(p, root, MAX, false); return s === null ? null : Buffer.from(s, 'utf8'); };

// proj/victim.json is the target the walk resolves; proj/coalmine.json is the entry. Outside the project, root/outside/secret.json.
function fixture(t, prefix) {
  const root = makeRoot(prefix, removeTree, t);
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const target = path.join(proj, 'victim.json');
  const inside = path.join(proj, 'inside.json');
  const entry = path.join(proj, 'coalmine.json');
  const outDir = path.join(root, 'outside');
  fs.mkdirSync(outDir);
  const outside = path.join(outDir, 'secret.json');
  fs.writeFileSync(target, VICTIM);
  fs.writeFileSync(inside, INSIDE);
  fs.writeFileSync(outside, OUTSIDE);
  return { proj, target, inside, outside, entry };
}

// The seam (no privilege): the first lstat of `entry` reports a link, and the first realpath of `entry` returns `target`. Just after that realpath the entry's
// name is retargeted to `next` (mode 'in' or 'out'; mode 'none' is the control). The name is restored by the finally path.
function withFakeLink({ entry, target, next, mode }, body) {
  const realL = fs.lstatSync;
  const realR = fs.realpathSync.native;
  let retargeted = false;
  fs.lstatSync = function (q, ...r) {
    const st = realL.call(this, q, ...r);
    if (typeof q === 'string' && path.resolve(q) === path.resolve(entry)) {
      return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { isSymbolicLink: () => true });
    }
    return st;
  };
  fs.realpathSync.native = function (q, ...r) {
    if (!retargeted && typeof q === 'string' && path.resolve(q) === path.resolve(entry)) {
      retargeted = true;
      if (mode !== 'none') { fs.unlinkSync(entry); fs.linkSync(next, entry); }
      return target;
    }
    return realR.call(this, q, ...r);
  };
  try { return body(); } finally {
    fs.lstatSync = realL;
    fs.realpathSync.native = realR;
  }
}

// The real-link seam: the entry is a real symlink to the target. Just after the entry's first realpath, the link is replaced by one to `next`.
function withRealLink({ entry, next }, body) {
  const realR = fs.realpathSync.native;
  let retargeted = false;
  fs.realpathSync.native = function (q, ...r) {
    const real = realR.call(this, q, ...r);
    if (!retargeted && typeof q === 'string' && path.resolve(q) === path.resolve(entry)) {
      retargeted = true;
      fs.unlinkSync(entry);
      fs.symlinkSync(next, entry);
    }
    return real;
  };
  try { return body(); } finally { fs.realpathSync.native = realR; }
}

// Can this account make a file symlink? (Windows without developer mode or privilege cannot.)
function canMakeFileLink(t) {
  const root = makeRoot('cm-link-probe-', removeTree, t);
  const a = path.join(root, 'a.txt');
  fs.writeFileSync(a, 'x');
  try { fs.symlinkSync(a, path.join(root, 'l.txt')); return true; } catch { return false; }
}

const READERS = [
  ['script', readScript],
  ['hook', readHook],
];

for (const [name, reader] of READERS) {
  test(`${name} reader, control: a link honoured with no retarget reads the target (VICTIM)`, (t) => {
    const f = fixture(t, `cm-retarget-ctl-${name}-`);
    fs.linkSync(f.target, f.entry); // the entry and the target share one file, as a link does
    const got = withFakeLink({ entry: f.entry, target: f.target, next: f.inside, mode: 'none' }, () => reader(f.entry, f.proj));
    assert.deepEqual(got, VICTIM, 'the unswapped link reads the target');
  });

  test(`${name} reader: a link retargeted to a file INSIDE the root after the realpath is refused, never read (leg in)`, (t) => {
    const f = fixture(t, `cm-retarget-in-${name}-`);
    fs.linkSync(f.target, f.entry);
    const got = withFakeLink({ entry: f.entry, target: f.target, next: f.inside, mode: 'in' }, () => reader(f.entry, f.proj));
    assert.equal(got, null, `the retargeted link is refused; read ${got ? JSON.stringify(got.toString()) : ''}`);
  });

  test(`${name} reader: a link retargeted to a file OUTSIDE the root after the realpath is refused, never read (leg out)`, (t) => {
    const f = fixture(t, `cm-retarget-out-${name}-`);
    fs.linkSync(f.target, f.entry);
    const got = withFakeLink({ entry: f.entry, target: f.target, next: f.outside, mode: 'out' }, () => reader(f.entry, f.proj));
    assert.equal(got, null, `the retargeted link is refused; read ${got ? JSON.stringify(got.toString()) : ''}`);
  });

  test(`${name} reader: a real symlink retargeted outside the root after the realpath is refused, never read (real link; skipped visibly where the account cannot make one)`, (t) => {
    if (!canMakeFileLink(t)) { t.skip('this account cannot make a file symlink (no developer mode or privilege); the ubuntu and macos CI legs run this leg'); return; }
    const f = fixture(t, `cm-retarget-real-${name}-`);
    fs.symlinkSync(f.target, f.entry);
    const got = withRealLink({ entry: f.entry, next: f.outside }, () => reader(f.entry, f.proj));
    assert.equal(got, null, `the real link retargeted outside is refused; read ${got ? JSON.stringify(got.toString()) : ''}`);
  });
}
