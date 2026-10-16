import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideUpload } from './asset-upload-mode.mjs';

test('decideUpload: nothing published yet -- clobber is safe, there is nothing to clobber (first run of the tag)', () => {
  const d = decideUpload(null, 'abc  CoalMine.zip\n');
  assert.equal(d.action, 'upload-clobber');
});

test('decideUpload: a byte-identical re-run (workflow_dispatch retry) is a no-op, not a re-upload', () => {
  const sums = 'abc  CoalMine.zip\ndef  SHA256SUMS.txt\n';
  const d = decideUpload(sums, sums);
  assert.equal(d.action, 'skip');
});

test('decideUpload: a DIFFERENT rebuild of a tag that already published assets fails loud -- never a silent overwrite', () => {
  const d = decideUpload('abc  CoalMine.zip\n', 'zzz  CoalMine.zip\n');
  assert.equal(d.action, 'fail');
  assert.match(d.reason, /must never change/);
});

// UMB-182 M1 (CoalFace rehearsal leg c+, run 35760645457) said a re-run always lands here because `zip -r` stores entry mtimes; since 09g the ZIPs are
// reproducible (file times from the tag commit, a fixed file order), so `skip` is the re-run's outcome and `fail` means a different zip program or a
// changed tree (16j, the courier: the fail text contradicted its comment). The reason says so, and still says nothing was overwritten.
test('decideUpload: the fail reason names the reproducible rebuild, what a difference means, and that nothing was overwritten -- RED before 16j', () => {
  const d = decideUpload('abc  CoalMine.zip\n', 'zzz  CoalMine.zip\n');
  assert.match(d.reason, /same runner image reproduces/);
  assert.match(d.reason, /different zip program or a changed tree/);
  assert.match(d.reason, /nothing was overwritten/);
  assert.doesNotMatch(d.reason, /never matches/);
});

test('decideUpload: order-of-lines differing but content identical is still a genuine difference at this layer -- the caller normalizes before comparing, this function does a plain equality check only', () => {
  const a = 'abc  A.zip\ndef  B.zip\n';
  const b = 'def  B.zip\nabc  A.zip\n';
  assert.equal(decideUpload(a, b).action, 'fail', 'this function is intentionally naive about ordering; a caller wanting order-independence sorts before calling it');
});
