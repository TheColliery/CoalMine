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

// UMB-182 M1 (CoalFace rehearsal leg c+, run 35760645457): `zip -r` stores entry mtimes, so a rebuild never
// matches -- a re-run of an already-published tag always lands here. The red is the safe outcome; the reason
// must say so, and must say nothing was overwritten, instead of implying a skip path that cannot fire.
test('decideUpload: the fail reason names the expected re-run cause and that nothing was overwritten -- RED before M1', () => {
  const d = decideUpload('abc  CoalMine.zip\n', 'zzz  CoalMine.zip\n');
  assert.match(d.reason, /zip/i);
  assert.match(d.reason, /re-run/);
  assert.match(d.reason, /nothing was overwritten/);
});

test('decideUpload: order-of-lines differing but content identical is still a genuine difference at this layer -- the caller normalizes before comparing, this function does a plain equality check only', () => {
  const a = 'abc  A.zip\ndef  B.zip\n';
  const b = 'def  B.zip\nabc  A.zip\n';
  assert.equal(decideUpload(a, b).action, 'fail', 'this function is intentionally naive about ordering; a caller wanting order-independence sorts before calling it');
});
