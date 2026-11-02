// 29am (T-29al-6, Deep Scan rows for pointer-check.mjs and verify.mjs walkMd): a document reached by two names is read ONCE, by its
// realpath, and a token's trailing slashes are stripped by a counted loop (the replaced pattern /\/+$/ restarted at every slash of a long
// run). Zero-dep (node:test + built-ins); the witness counts reads and steps, never a clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSurfaces, stripTrailingSlashes } from './pointer-check.mjs';

test('29am: two walked names that resolve to one document read it once', () => {
  let reads = 0;
  const io = {
    join: (a, b) => a + '/' + b,
    rel: (x) => x,
    read: () => { reads++; return 'text'; },
    walkMd: () => ['docs/a.md', 'docs/link.md'],
    walkSrc: () => [],
    realpath: (p) => (p === 'docs/link.md' ? 'docs/a.md' : p),
  };
  const surfaces = collectSurfaces('repo', [{ dir: true, root: 'docs', kind: 'md' }], io);
  assert.equal(reads, 1, 'one document is read once');
  assert.equal(surfaces.length, 1, 'one surface, not two');
});

test('29am: a token keeps its name when no realpath is given, and two names with no realpath are two documents', () => {
  let reads = 0;
  const io = { join: (a, b) => a + '/' + b, rel: (x) => x, read: () => { reads++; return 't'; }, walkMd: () => ['docs/a.md', 'docs/b.md'], walkSrc: () => [] };
  collectSurfaces('repo', [{ dir: true, root: 'docs', kind: 'md' }], io);
  assert.equal(reads, 2, 'without a realpath the two names are kept apart');
});

test('29am: the trailing slashes of a long run are stripped in a number of steps proportional to the token', () => {
  const counter = { steps: 0 };
  const n = 100000;
  const tok = 'docs' + '/'.repeat(n);
  assert.equal(stripTrailingSlashes(tok, counter), 'docs');
  assert.ok(counter.steps <= 2 * tok.length, `steps ${counter.steps} must stay within 2 per character (n = ${tok.length})`);
});

test('29am: ordinary tokens lose only their trailing slashes', () => {
  assert.equal(stripTrailingSlashes('scripts/'), 'scripts');
  assert.equal(stripTrailingSlashes('a//'), 'a');
  assert.equal(stripTrailingSlashes('a/b'), 'a/b');
  assert.equal(stripTrailingSlashes('/'), '');
  assert.equal(stripTrailingSlashes(''), '');
});
