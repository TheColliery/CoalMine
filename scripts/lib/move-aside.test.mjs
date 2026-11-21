// BB-533 unit legs for move-aside.mjs: one rename, a read-back and a verdict that never throws. Real files in a temp root of this test's own making.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { removeTree } from './test-sandbox.mjs';
import { makeRoot } from './read-window.mjs';
import { moveAndCompare, sourceNote } from './move-aside.mjs';

test('moveAndCompare: a plain move reports moved, same true, no replacement, and the source is gone', (t) => {
  const root = makeRoot('cm-moveaside-', removeTree, t);
  const src = path.join(root, 'a.txt');
  const dest = src + '.bak';
  fs.writeFileSync(src, 'payload\n');
  const v = moveAndCompare({ src, dest, root, maxBytes: 1024, snapshot: Buffer.from('payload\n') });
  assert.deepEqual(v, { moved: true, replaced: false, same: true });
  assert.equal(fs.existsSync(src), false, 'the source is no longer at its path');
  assert.equal(fs.readFileSync(dest, 'utf8'), 'payload\n', 'the destination holds the moved bytes');
});

test('moveAndCompare: an existing destination is replaced by the move, and the verdict says so', (t) => {
  const root = makeRoot('cm-moveaside-', removeTree, t);
  const src = path.join(root, 'a.txt');
  const dest = src + '.bak';
  fs.writeFileSync(src, 'payload\n');
  fs.writeFileSync(dest, 'OLD\n');
  const v = moveAndCompare({ src, dest, root, maxBytes: 1024, snapshot: Buffer.from('payload\n') });
  assert.deepEqual(v, { moved: true, replaced: true, same: true });
  assert.equal(fs.readFileSync(dest, 'utf8'), 'payload\n');
});

test('moveAndCompare: bytes on disk that differ from the snapshot read back as same false', (t) => {
  const root = makeRoot('cm-moveaside-', removeTree, t);
  const src = path.join(root, 'a.txt');
  const dest = src + '.bak';
  fs.writeFileSync(src, 'changed\n');
  const v = moveAndCompare({ src, dest, root, maxBytes: 1024, snapshot: Buffer.from('payload\n') });
  assert.equal(v.moved, true);
  assert.equal(v.same, false, 'a difference from the snapshot is reported, not hidden');
});

test('moveAndCompare: a read-back over the bound reads back as same null', (t) => {
  const root = makeRoot('cm-moveaside-', removeTree, t);
  const src = path.join(root, 'a.txt');
  const dest = src + '.bak';
  fs.writeFileSync(src, 'payload\n');
  const v = moveAndCompare({ src, dest, root, maxBytes: 4, snapshot: Buffer.from('payload\n') });
  assert.equal(v.moved, true);
  assert.equal(v.same, null, 'a read-back that cannot be made is reported as unknown, never as the same');
});

test('moveAndCompare: a failed rename reports its code, and the source is kept', (t) => {
  const root = makeRoot('cm-moveaside-', removeTree, t);
  const src = path.join(root, 'a.txt');
  fs.writeFileSync(src, 'payload\n');
  const dest = path.join(root, 'no-such-folder', 'a.txt.bak');
  const v = moveAndCompare({ src, dest, root, maxBytes: 1024, snapshot: Buffer.from('payload\n') });
  assert.equal(v.moved, false);
  assert.ok(typeof v.code === 'string' && v.code.length > 0, 'the failed rename names its error code');
  assert.equal(v.srcState, 'kept');
  assert.equal(fs.readFileSync(src, 'utf8'), 'payload\n', 'nothing was moved or removed');
});

test('moveAndCompare: a failed rename reports the source gone when it is absent', (t) => {
  const root = makeRoot('cm-moveaside-', removeTree, t);
  const v = moveAndCompare({ src: path.join(root, 'nothere.txt'), dest: path.join(root, 'x.bak'), root, maxBytes: 1024, snapshot: Buffer.from('') });
  assert.equal(v.moved, false);
  assert.equal(v.srcState, 'gone');
});

test('moveAndCompare: a destination that is a link is refused, and nothing moves', (t) => {
  const root = makeRoot('cm-moveaside-', removeTree, t);
  const src = path.join(root, 'a.txt');
  const outside = path.join(root, 'outside.txt');
  const link = src + '.bak';
  fs.writeFileSync(src, 'payload\n');
  fs.writeFileSync(outside, 'outside\n');
  try {
    fs.symlinkSync(outside, link);
  } catch {
    t.skip('this account cannot make a symlink: the refused-link leg needs one');
    return;
  }
  const v = moveAndCompare({ src, dest: link, root, maxBytes: 1024, snapshot: Buffer.from('payload\n') });
  assert.ok(v.refused, 'a link at the destination is refused');
  assert.equal(fs.readFileSync(src, 'utf8'), 'payload\n', 'the source did not move');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside\n', 'the link target was not written through');
});

test('sourceNote: names each source state in words that do not end with a period', () => {
  assert.equal(sourceNote('kept', 'x'), 'x is kept');
  assert.equal(sourceNote('gone', 'x'), 'x is no longer there');
  assert.equal(sourceNote('unchecked', 'x'), 'x could not be checked');
});
