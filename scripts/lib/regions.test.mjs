// Unit tests for the shared-region sync mechanism (hooks/_shared injection).
// Zero-dep (node:test + built-ins), per scripts-quality.md section 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRegion, syncRegion } from './shared-regions.mjs';

const FILE = [
  'before();',
  '// <coalmine-shared: demo> — synced; do not edit',
  'old body line 1',
  'old body line 2',
  '// </coalmine-shared: demo>',
  'after();',
  '',
].join('\n');

test('syncRegion replaces the body from the partial and is idempotent', () => {
  const once = syncRegion(FILE, 'demo', '//', 'new body\n');
  assert.ok(once.includes('new body'));
  assert.ok(!once.includes('old body'), 'old body must be fully replaced');
  assert.ok(once.startsWith('before();'), 'content outside the region is untouched');
  assert.ok(once.includes('after();'));
  const twice = syncRegion(once, 'demo', '//', 'new body\n');
  assert.equal(twice, once, 'syncing an already-synced region changes nothing');
  assert.equal(extractRegion(once, 'demo', '//'), 'new body\n');
});

test('missing or malformed markers return null instead of corrupting the file', () => {
  assert.equal(extractRegion('no markers here', 'demo', '//'), null);
  assert.equal(syncRegion('no markers here', 'demo', '//', 'x\n'), null);
  // close marker before open marker → malformed
  const malformed = '// </coalmine-shared: demo>\n// <coalmine-shared: demo>\n';
  assert.equal(extractRegion(malformed, 'demo', '//'), null);
});
