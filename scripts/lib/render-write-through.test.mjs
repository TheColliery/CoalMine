// A generated reference is never written through a link copied from the source skill (28c round 2, fix 4).
// The per-skill copy keeps a symbolic link as a link, and the shared-reference write then followed it to a
// file outside the staging root. The write now refuses a link at its target: a loud build error, never a
// silent skip, and the outside file keeps its bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installSkillDir, loadShared } from './render.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REAL_SKILL = path.join(repo, 'skills', 'rot-canary');
const SHARED_DIR = path.join(repo, 'skills', '_shared');

function mkTmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  return dir;
}

// True when this process may create a file symbolic link here (Windows needs a privilege or Developer Mode).
function symlinksAllowed(dir) {
  const target = path.join(dir, 'probe-target.txt');
  const link = path.join(dir, 'probe-link.txt');
  fs.writeFileSync(target, 'x', 'utf8');
  try { fs.symlinkSync(target, link, 'file'); return true; } catch { return false; }
}

test('a normal build writes the shared reference and SKILL.md into the output folder', (t) => {
  const root = mkTmp(t, 'cm-render-wt-');
  const shared = loadShared(SHARED_DIR);
  const to = path.join(root, 'out', 'rot-canary');
  installSkillDir(REAL_SKILL, to, shared);
  const ref = fs.readFileSync(path.join(to, 'references', 'escalation.md'), 'utf8');
  assert.equal(ref, shared.sharedReferences['escalation.md']);
  assert.ok(fs.existsSync(path.join(to, 'SKILL.md')), 'SKILL.md is written');
});

test('a copied link to an outside file is refused, and the outside file keeps its bytes', (t) => {
  const root = mkTmp(t, 'cm-render-wt-');
  if (!symlinksAllowed(root)) {
    t.skip('this process cannot create a file symbolic link here (a privilege on Windows): the link leg is not run');
    return;
  }
  const from = path.join(root, 'src', 'skill');
  fs.mkdirSync(path.join(from, 'references'), { recursive: true });
  fs.writeFileSync(path.join(from, 'SKILL.md'), '---\nname: skill\ndescription: x\n---\n\nbody\n', 'utf8');
  const outside = path.join(root, 'outside.md');
  fs.writeFileSync(outside, 'OUTSIDE ORIGINAL\n', 'utf8');
  fs.symlinkSync(outside, path.join(from, 'references', 'escalation.md'), 'file');
  const to = path.join(root, 'out', 'skill');
  assert.throws(() => installSkillDir(from, to, loadShared(SHARED_DIR)), /symbolic link|link/i);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'OUTSIDE ORIGINAL\n', 'the outside file was written through the copied link');
});
