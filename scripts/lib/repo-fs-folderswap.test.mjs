// T-29qn-1 (29qn, U2): one swap of a config's entry folder to a junction, made after the chain check's lstat of that folder and before the entry's identity is
// taken, must not let the entry be read from OUTSIDE the root. The map (scratchpad/29qn/i73-B.md) names the rows: a link entry reads OUTSIDE after one folder
// swap; a plain entry is refused (its identity comes from the first lstat). The seam reports the entry as a link at its first lstat (no symlink privilege
// needed); the folder swap is a REAL junction, and a leg that needs a junction or a file symlink probes it and skips VISIBLY where the account cannot make one.
// Every swap leg asserts that the swap happened, so a failed swap cannot pass vacuously. Both readers are exercised: the script reader (repo-fs.mjs) and the hook
// reader (the shared partial, evaluated from its own text, the code a hook copy runs).
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
const OUTSIDE = Buffer.from('{ "autoScanFileCap": 9 }\n');

// The hook reader, evaluated from the shared partial's text (the same code a hook copy runs).
function loadHookReader() {
  const text = fs.readFileSync(PARTIAL, 'utf8');
  const req = createRequire(import.meta.url);
  return new Function('require', 'fs', 'path', 'os', `${text}\nreturn { readRepoFileBounded };`)(req, fs, path, os).readRepoFileBounded;
}
const readScript = (p, root) => { const r = readRepoBytesAndStat(p, root, MAX); return r === null ? null : r.bytes; };
const readHook = (p, root) => { const s = loadHookReader()(p, root, MAX, false); return s === null ? null : Buffer.from(s, 'utf8'); };
const READERS = [['script', readScript], ['hook', readHook]];

// Can this account make a directory junction (or, on POSIX, a directory link)? A junction needs no privilege on Windows.
function canMakeJunction(t) {
  const root = makeRoot('cm-junction-probe-', removeTree, t);
  const target = path.join(root, 'target');
  fs.mkdirSync(target);
  try { fs.symlinkSync(target, path.join(root, 'junction'), 'junction'); return true; } catch { return false; }
}
// Can this account make a file symlink? (Windows without developer mode or privilege cannot.)
function canMakeFileLink(t) {
  const root = makeRoot('cm-filelink-probe-', removeTree, t);
  const a = path.join(root, 'a.txt');
  fs.writeFileSync(a, 'x');
  try { fs.symlinkSync(a, path.join(root, 'l.txt')); return true; } catch { return false; }
}

// proj/.claude/coal is the entry's folder (inside the root); coalmine.json is the entry; outDir (outside proj) holds a file of the same name, OUTSIDE.
function fixture(t, prefix) {
  const root = makeRoot(prefix, removeTree, t);
  const proj = path.join(root, 'proj');
  const folder = path.join(proj, '.claude', 'coal');
  fs.mkdirSync(folder, { recursive: true });
  const entry = path.join(folder, 'coalmine.json');
  fs.writeFileSync(entry, VICTIM);
  const outDir = path.join(root, 'outside');
  fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, 'coalmine.json'), OUTSIDE);
  return { root, proj, folder, entry, outDir };
}

// Runs body with the swap armed. The first lstat of `folder` (the chain check's, which returns the real directory) is followed by the swap: the folder is renamed
// aside and a junction at `folder` points at `outDir`. `fakeEntry` makes the first lstat of `entry` report a symbolic link (the seam). `swap` false is the control.
// The state object records whether the swap happened; the folder is put back in the finally path, before any teardown.
function withFolderSwap({ folder, entry, outDir, fakeEntry, swap }, body) {
  const realL = fs.lstatSync;
  const state = { swapped: false, aside: null };
  let faked = false;
  fs.lstatSync = function (q, ...r) {
    const st = realL.call(this, q, ...r);
    const rq = typeof q === 'string' ? path.resolve(q) : '';
    if (fakeEntry && !faked && rq === path.resolve(entry)) {
      faked = true;
      return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { isSymbolicLink: () => true, isFile: () => false });
    }
    if (swap && !state.swapped && rq === path.resolve(folder)) {
      state.swapped = true;
      state.aside = folder + '.real';
      fs.renameSync(folder, state.aside);
      fs.symlinkSync(outDir, folder, 'junction');
    }
    return st;
  };
  try {
    return { got: body(), state };
  } finally {
    fs.lstatSync = realL;
    if (state.swapped) {
      fs.unlinkSync(folder);
      fs.renameSync(state.aside, folder);
    }
  }
}

for (const [name, reader] of READERS) {
  test(`${name} reader, control: a link entry with no folder swap reads the target (VICTIM)`, (t) => {
    const f = fixture(t, `cm-folderswap-ctl-${name}-`);
    const { got, state } = withFolderSwap({ folder: f.folder, entry: f.entry, outDir: f.outDir, fakeEntry: true, swap: false }, () => reader(f.entry, f.proj));
    assert.equal(state.swapped, false, 'the control leg does not swap');
    assert.deepEqual(got, VICTIM, 'the unswapped link entry reads the target inside the root');
  });

  test(`${name} reader: a link entry whose folder is swapped to a junction after the chain check is refused, never read (S1)`, (t) => {
    if (!canMakeJunction(t)) { t.skip('this account cannot make a directory junction here; the leg runs where it can'); return; }
    const f = fixture(t, `cm-folderswap-s1-${name}-`);
    const { got, state } = withFolderSwap({ folder: f.folder, entry: f.entry, outDir: f.outDir, fakeEntry: true, swap: true }, () => reader(f.entry, f.proj));
    assert.ok(state.swapped, 'the folder swap happened, so this leg is not vacuous');
    assert.equal(got, null, `the swapped link entry is refused; read ${got ? JSON.stringify(got.toString()) : ''}`);
  });

  test(`${name} reader: a plain entry whose folder is swapped to a junction after the chain check is refused, never read (P1)`, (t) => {
    if (!canMakeJunction(t)) { t.skip('this account cannot make a directory junction here; the leg runs where it can'); return; }
    const f = fixture(t, `cm-folderswap-p1-${name}-`);
    const { got, state } = withFolderSwap({ folder: f.folder, entry: f.entry, outDir: f.outDir, fakeEntry: false, swap: true }, () => reader(f.entry, f.proj));
    assert.ok(state.swapped, 'the folder swap happened, so this leg is not vacuous');
    assert.equal(got, null, `the swapped plain entry is refused; read ${got ? JSON.stringify(got.toString()) : ''}`);
  });

  test(`${name} reader, real link: a real file symlink entry with no folder swap is read (skipped visibly where the account cannot make one)`, (t) => {
    if (!canMakeFileLink(t)) { t.skip('this account cannot make a file symlink here; the ubuntu and macos CI legs run this leg'); return; }
    const f = fixture(t, `cm-folderswap-rlc-${name}-`);
    const victim = path.join(f.folder, 'victim.json');
    fs.writeFileSync(victim, VICTIM);
    fs.unlinkSync(f.entry);
    fs.symlinkSync(victim, f.entry);
    const { got, state } = withFolderSwap({ folder: f.folder, entry: f.entry, outDir: f.outDir, fakeEntry: false, swap: false }, () => reader(f.entry, f.proj));
    assert.equal(state.swapped, false, 'the control leg does not swap');
    assert.deepEqual(got, VICTIM, 'the real link inside the root reads its target');
  });

  test(`${name} reader, real link: a real file symlink entry whose folder is swapped to a junction after the chain check is refused (R1)`, (t) => {
    if (!canMakeFileLink(t) || !canMakeJunction(t)) { t.skip('this account cannot make a file symlink and a junction here; the leg runs where it can'); return; }
    const f = fixture(t, `cm-folderswap-r1-${name}-`);
    const victim = path.join(f.folder, 'victim.json');
    fs.writeFileSync(victim, VICTIM);
    fs.writeFileSync(path.join(f.outDir, 'victim.json'), OUTSIDE);
    fs.unlinkSync(f.entry);
    fs.symlinkSync(victim, f.entry);
    const { got, state } = withFolderSwap({ folder: f.folder, entry: f.entry, outDir: f.outDir, fakeEntry: false, swap: true }, () => reader(f.entry, f.proj));
    assert.ok(state.swapped, 'the folder swap happened, so this leg is not vacuous');
    assert.equal(got, null, `the real link whose folder was swapped is refused; read ${got ? JSON.stringify(got.toString()) : ''}`);
  });
}

// A control for the plain path with no swap: the plain entry inside its folder is read (the swap-free baseline for the P1 leg).
test('the script reader reads a plain entry in its own folder with no swap (positive control for the plain leg)', (t) => {
  const f = fixture(t, 'cm-folderswap-plain-ctl-');
  const { got, state } = withFolderSwap({ folder: f.folder, entry: f.entry, outDir: f.outDir, fakeEntry: false, swap: false }, () => readScript(f.entry, f.proj));
  assert.equal(state.swapped, false, 'the control leg does not swap');
  assert.deepEqual(got, VICTIM, 'the plain entry inside the root is read');
});
