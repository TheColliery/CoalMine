import test from 'node:test';
import assert from 'node:assert/strict';
import { trimDescription, CLAUDE_AI_DESC_CAP } from './claude-ai-trim.mjs';

test('CLAUDE_AI_DESC_CAP is 200 (the platform constraint this exists to satisfy)', () => {
  assert.equal(CLAUDE_AI_DESC_CAP, 200);
});

test('a description already under the cap is returned unchanged', () => {
  const d = 'Short description.';
  assert.equal(trimDescription(d), d);
});

test('a description exactly at the cap is returned unchanged (boundary, not over)', () => {
  const d = 'x'.repeat(200);
  assert.equal(trimDescription(d), d);
  assert.equal(trimDescription(d).length, 200);
});

test('a description one char over the cap is trimmed and never exceeds it', () => {
  const d = 'word '.repeat(50); // 250 chars, always word-boundary-safe
  const out = trimDescription(d);
  assert.ok(out.length <= 200, `trimmed length ${out.length} must be <= 200`);
  assert.ok(out.endsWith('...'), 'trimmed output carries the ellipsis');
});

test('trim cuts at the last whitespace boundary, never mid-word', () => {
  const d = 'a'.repeat(150) + ' ' + 'b'.repeat(100); // 251 chars total
  const out = trimDescription(d);
  const withoutEllipsis = out.slice(0, -3);
  assert.ok(!withoutEllipsis.includes('b'), 'the cut lands before the second word, never splitting it');
});

test('deterministic: the same input always produces the same output', () => {
  const d = 'x'.repeat(300);
  assert.equal(trimDescription(d), trimDescription(d));
});

test('a non-BMP character straddling the cut boundary does not leave a lone surrogate (board #40 fixback F3)', () => {
  // Scope: this ONE case (an astral character, here an emoji, sitting exactly at the
  // UTF-16 code-unit cut index, with no ASCII space before it so the existing
  // whitespace rescue can't accidentally save it) proves the REGRESSION is fixed --
  // it does not by itself prove every non-BMP boundary position is covered. Not
  // extended to a CJK-extension codepoint or other boundary offsets: the failure
  // mechanism (charCodeAt landing on a high surrogate) is identical regardless of
  // which non-BMP character or exact index triggers it, so one reproducing case is
  // judged sufficient to pin the fix without multiplying near-duplicate assertions.
  const d = 'x'.repeat(196) + String.fromCodePoint(0x1F600) + 'y'.repeat(50);
  const out = trimDescription(d);
  assert.ok(out.length <= 200, `trimmed length ${out.length} must be <= 200`);
  const loneHighSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out);
  assert.ok(!loneHighSurrogate, `output must not end mid-surrogate-pair: ${JSON.stringify(out.slice(-6))}`);
});

test('a real CoalMine description (rot-canary) trims to <=200 and stays non-empty', () => {
  const real = 'Code-health scan — dead code, bug-prone logic, resource leaks, concurrency bugs, silent failures, input-boundary issues, doc rot. Triggers on: "/rot-canary", "rot-canary", "code-health" (legacy aliases: "/rotcanary", "rotcanary"). Auto-runs at session end on touched files (QUICK, report only) via platform hooks — auto-wired by the Claude Code plugin, manual elsewhere. Run manually for fix mode. Reports; fixes on request via choice-gated menu.';
  assert.ok(real.length > 200, 'fixture must actually exceed the cap to test trimming');
  const out = trimDescription(real);
  assert.ok(out.length <= 200);
  assert.ok(out.length > 0);
});
