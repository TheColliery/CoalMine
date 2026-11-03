// 29ao (T-29al-10): a skill source tree that holds a link, at the top level or nested, is refused with a named error before anything is
// written, and the target the link points at keeps its bytes. The capability (can this volume create a file link?) is PROBED; the legs skip
// only on that probe, never on the platform name. Zero-dep (node:test + built-ins); the tree is a temp folder under os.tmpdir().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installSkillDir } from './render.mjs';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-link-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  return dir;
}

// The capability probe: can this volume create a file link at all? Without it the legs have nothing to test.
function canMakeFileLink(dir) {
  const target = path.join(dir, 'probe-target.txt');
  fs.writeFileSync(target, 'x', 'utf8');
  try {
    fs.symlinkSync(target, path.join(dir, 'probe-link.txt'), 'file');
    return true;
  } catch {
    return false;
  }
}

const NO_LINK = 'this volume cannot create a file link without privilege: the link legs are not run here';

function linkSetup(t) {
  const root = tempDir(t);
  if (!canMakeFileLink(root)) return null;
  const outside = path.join(root, 'outside.txt');
  fs.writeFileSync(outside, 'OUTSIDE-BYTES', 'utf8');
  const from = path.join(root, 'skill');
  const to = path.join(root, 'out', 'skill');
  fs.mkdirSync(from, { recursive: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  return { root, outside, from, to };
}

// Capability-free leg: the directory listing reports one entry as a link (a fake dirent on the default fs export). It runs on every volume,
// so the refusal logic is witnessed even where no file link can be made. The real-link legs below still probe and run where links exist.
test('29ao: a link entry the directory listing reports is refused with a named error, and nothing is written (capability-free)', (t) => {
  const root = tempDir(t);
  const from = path.join(root, 'skill');
  const to = path.join(root, 'out', 'skill');
  fs.mkdirSync(from, { recursive: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(path.join(from, 'data.txt'), 'plain', 'utf8');
  fs.writeFileSync(path.join(from, 'linked.txt'), 'would be followed', 'utf8');
  const realReaddir = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', (dir, opts) => {
    const out = realReaddir(dir, opts);
    if (String(dir) !== from || !(opts && opts.withFileTypes)) return out;
    return out.map((d) => (d.name === 'linked.txt'
      ? { name: d.name, isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true }
      : d));
  });
  let caught = null;
  try { installSkillDir(from, to, { sharedReferences: {} }); } catch (e) { caught = e; }
  assert.ok(caught, 'the copy is refused');
  assert.equal(caught.name, 'SkillSourceLinkError', 'the refusal is the named error');
  assert.ok(!fs.existsSync(to), 'nothing was written at the target');
});

test('29ao: a skill source with a file link at the top level is refused with a named error, and nothing is written', (t) => {
  const s = linkSetup(t);
  if (!s) return t.skip(NO_LINK);
  fs.writeFileSync(path.join(s.from, 'data.txt'), 'plain', 'utf8');
  fs.symlinkSync(s.outside, path.join(s.from, 'linked.txt'), 'file');
  let caught = null;
  try { installSkillDir(s.from, s.to, { sharedReferences: {} }); } catch (e) { caught = e; }
  assert.ok(caught, 'the copy is refused');
  assert.equal(caught.name, 'SkillSourceLinkError', 'the refusal is the named error');
  assert.ok(!fs.existsSync(s.to), 'nothing was written at the target');
  assert.equal(fs.readFileSync(s.outside, 'utf8'), 'OUTSIDE-BYTES', 'the link target keeps its bytes');
});

test('29ao: a skill source with a file link nested in a subfolder is refused with a named error, and nothing is written', (t) => {
  const s = linkSetup(t);
  if (!s) return t.skip(NO_LINK);
  fs.mkdirSync(path.join(s.from, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(s.from, 'sub', 'data.txt'), 'plain', 'utf8');
  fs.symlinkSync(s.outside, path.join(s.from, 'sub', 'linked.txt'), 'file');
  let caught = null;
  try { installSkillDir(s.from, s.to, { sharedReferences: {} }); } catch (e) { caught = e; }
  assert.ok(caught, 'the copy is refused');
  assert.equal(caught.name, 'SkillSourceLinkError', 'the refusal is the named error');
  assert.ok(!fs.existsSync(s.to), 'nothing was written at the target');
  assert.equal(fs.readFileSync(s.outside, 'utf8'), 'OUTSIDE-BYTES', 'the link target keeps its bytes');
});
