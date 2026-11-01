// c36 item 3.4: verifyAgainstManifest reads an installed file once per REAL path, however many manifest keys name it, and stops
// its whole pass at a cumulative byte budget. Witnesses count the reads the verifier makes (reads, bytesRead in its result), so
// the claim is a count, never a clock. Hermetic: fixtures are temp folders under os.tmpdir(). Zero-dep (node:test).
// The alias leg needs a case-insensitive volume (Windows, macOS default); it probes for one and skips visibly otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyAgainstManifest, MANIFEST_NAME } from './manifest.mjs';

function tempDest(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-alias-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  return dir;
}
const sha = (text) => createHash('sha256').update(text).digest('hex');

test('three manifest keys that name one file on a case-insensitive volume read and hash it once', (t) => {
  const dest = tempDest(t);
  fs.mkdirSync(path.join(dest, 'alpha'));
  fs.writeFileSync(path.join(dest, 'alpha', 'SKILL.md'), 'same bytes\n');
  if (!fs.existsSync(path.join(dest, 'alpha', 'skill.MD'))) {
    t.skip('this volume is case-sensitive: the alias spellings name different files, so the alias leg is not run here');
    return;
  }
  const hash = sha('same bytes\n');
  fs.writeFileSync(path.join(dest, MANIFEST_NAME), JSON.stringify({ skills: ['alpha'], hashes: { 'alpha/SKILL.md': hash, 'alpha/SKILL.MD': hash, 'ALPHA/skill.md': hash } }));
  const r = verifyAgainstManifest(dest);
  assert.equal(r.ok, true, JSON.stringify(r.findings));
  assert.equal(r.checked, 3, 'control: all three keys are checked');
  assert.equal(r.reads, 1, 'the three aliases share one read');
  assert.equal(r.bytesRead, Buffer.byteLength('same bytes\n'), 'the one read counts its bytes once');
});

test('the verifier stops its whole pass at a cumulative byte budget, and says so', (t) => {
  const dest = tempDest(t);
  fs.mkdirSync(path.join(dest, 'beta'));
  fs.writeFileSync(path.join(dest, 'beta', 'one.md'), 'x'.repeat(100));
  fs.writeFileSync(path.join(dest, 'beta', 'two.md'), 'y'.repeat(100));
  fs.writeFileSync(path.join(dest, MANIFEST_NAME), JSON.stringify({ skills: ['beta'], hashes: { 'beta/one.md': sha('x'.repeat(100)), 'beta/two.md': sha('y'.repeat(100)) } }));
  const r = verifyAgainstManifest(dest, { byteBudget: 50 });
  assert.equal(r.ok, false, 'a pass over budget is a failure, not a clean report');
  assert.ok(r.findings.some((f) => f.level === 'FAIL' && /integrity pass stopped/.test(f.msg)), 'a named finding says the pass stopped');
  assert.equal(r.reads, 1, 'the second file is never read once the budget is spent');
});

test('the same manifest with no budget passes, so the budget is the only thing that stopped it', (t) => {
  const dest = tempDest(t);
  fs.mkdirSync(path.join(dest, 'beta'));
  fs.writeFileSync(path.join(dest, 'beta', 'one.md'), 'x'.repeat(100));
  fs.writeFileSync(path.join(dest, MANIFEST_NAME), JSON.stringify({ skills: ['beta'], hashes: { 'beta/one.md': sha('x'.repeat(100)) } }));
  const r = verifyAgainstManifest(dest);
  assert.equal(r.ok, true, JSON.stringify(r.findings));
  assert.equal(r.reads, 1);
});
