// Unit tests for scripts/lib/desc-cap.mjs — the skill-listing description-length
// gate. Zero-dep (node:test + built-ins), per scripts-quality.md section 2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontmatterField, descriptionCapCheck, DESC_CAP } from './desc-cap.mjs';

test('bare single-line description parses', () => {
  const text = '---\nname: x\ndescription: hello world\n---\nbody';
  assert.equal(frontmatterField(text, 'description'), 'hello world');
});

test('quoted single-line description strips the quotes', () => {
  const text = '---\nname: x\ndescription: "hello, world"\n---\nbody';
  assert.equal(frontmatterField(text, 'description'), 'hello, world');
});

test('block-scalar (>-) description joins indented lines with single spaces', () => {
  const text = '---\nname: x\ndescription: >-\n  line one\n  line two\n---\nbody';
  assert.equal(frontmatterField(text, 'description'), 'line one line two');
});

test('missing frontmatter block or missing key returns null', () => {
  assert.equal(frontmatterField('no frontmatter here', 'description'), null);
  assert.equal(frontmatterField('---\nname: x\n---\nbody', 'description'), null);
});

test('description at the cap passes (boundary, not over)', () => {
  const text = `---\nname: x\ndescription: ${'a'.repeat(DESC_CAP)}\n---\nbody`;
  const r = descriptionCapCheck(text);
  assert.equal(r.len, DESC_CAP);
  assert.equal(r.over, false);
});

test('description over the cap fails — the negative-path case', () => {
  const text = `---\nname: x\ndescription: ${'a'.repeat(DESC_CAP + 1)}\n---\nbody`;
  const r = descriptionCapCheck(text);
  assert.equal(r.len, DESC_CAP + 1);
  assert.equal(r.over, true);
});

test('description + when_to_use combine toward the cap', () => {
  const text = `---\nname: x\ndescription: ${'a'.repeat(600)}\nwhen_to_use: ${'b'.repeat(500)}\n---\nbody`;
  const r = descriptionCapCheck(text);
  assert.equal(r.len, 1100);
  assert.equal(r.over, true);
});
