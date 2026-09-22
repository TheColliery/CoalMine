// Unit tests for scripts/lib/jsonc.mjs — the JSONC comment stripper.
// Zero-dep (node:test + built-ins), per scripts-quality.md section 2.
// Guards CoalMine #12: a value ending in a literal backslash used to leak escape
// state into the next token, mis-stripping a later //-containing string so
// JSON.parse threw and the catch silently reverted the config (DATA LOSS in the
// configure.mjs write path). Each case below pairs stripJsonc with JSON.parse —
// the contract the callers depend on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripJsonc } from './jsonc.mjs';

test('backslash-terminated value before a // string parses and preserves both strings (the bug)', () => {
  const input = '{"p":"C:\\\\","x":"a//b"}';
  const parsed = JSON.parse(stripJsonc(input));
  assert.equal(parsed.p, 'C:\\', 'a value ending in a literal backslash survives intact');
  assert.equal(parsed.x, 'a//b', 'the later //-containing string is NOT mis-stripped');
});

test('escaped quote inside a string is preserved', () => {
  const input = '{"q":"he said \\"hi\\""}';
  const parsed = JSON.parse(stripJsonc(input));
  assert.equal(parsed.q, 'he said "hi"');
});

test('a real // line comment and a /* */ block comment after a string are stripped', () => {
  const input = [
    '{',
    '  "a": "keep", // line comment',
    '  "b": "keep2" /* block comment */',
    '}',
  ].join('\n');
  const parsed = JSON.parse(stripJsonc(input));
  assert.deepEqual(parsed, { a: 'keep', b: 'keep2' });
});

test('// inside a string is preserved (not treated as a comment)', () => {
  const input = '{"url":"http://example.com"}';
  const parsed = JSON.parse(stripJsonc(input));
  assert.equal(parsed.url, 'http://example.com');
});

// Node≡PS parity: the fixtures below are the canonical cross-stripper equivalence set.
// The PS port (hooks/_shared/ps-config.ps1 Remove-JsoncComments) must produce identical
// parse results on all of these. Run manually with pwsh to verify the PS side.
test('Node stripJsonc: inline trailing comment on the same line as a value is stripped', () => {
  const input = [
    '{',
    '  "mode": "auto", // trailing note',
    '  "count": 3',
    '}',
  ].join('\n');
  const parsed = JSON.parse(stripJsonc(input));
  assert.deepEqual(parsed, { mode: 'auto', count: 3 });
});

test('Node stripJsonc: // inside a string value is NOT stripped (parity fixture)', () => {
  // This is the primary parity fixture: the old PS regex mis-stripped the whole
  // line when a string contained //, causing ConvertFrom-Json to throw and the
  // config to be silently ignored. The PS port must match this result.
  const input = '{"url":"http://example.com","mode":"auto"}';
  const parsed = JSON.parse(stripJsonc(input));
  assert.equal(parsed.url, 'http://example.com', '// inside a string survives');
  assert.equal(parsed.mode, 'auto', 'other fields unaffected');
});
