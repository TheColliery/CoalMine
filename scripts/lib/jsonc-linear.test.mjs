// Linear-time strip and malformed-input preservation for scripts/lib/jsonc.mjs (28c item a).
// The JSONC comment stripper used a lazy block-comment match that re-scanned to the end of the
// input for every unclosed opener, and a string match that did the same for every unclosed
// quote, so an input with many openers that never close cost time roughly quadratic in its size.
// The regex now consumes an unclosed opener to the end of the input in ONE match, and the
// callback keeps such an opener's text unchanged: a malformed config still fails JSON.parse,
// exactly as before, and a well-formed one parses to the same value byte for byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsonc } from './jsonc.mjs';
import { checkJsoncRegexSync } from './consistency.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The regex as it stood before this change, kept as the reference for the differential test.
const OLD_RE = /"(?:\\.|[^"\\])*"|\/\/.*|\/\*[\s\S]*?\*\//g;
const oldStrip = (c) => c.replace(OLD_RE, (m) => (m[0] === '"' ? m : ''));

const SIZE = 48 * 1024;
// Neither shape closes: the block openers never meet a star-slash, and the escaped quotes never meet an unescaped one.
const SHAPES = {
  unclosedBlockOpeners: '/* a'.repeat(SIZE / 4),
  unclosedStringEscapes: '"' + '\\"'.repeat(SIZE / 3),
  // A string opener whose body ends in a lone backslash: the string branch fails there and restarts two characters on.
  danglingBackslash: '"\\'.repeat(SIZE / 2),
};
const BUDGET_MS = 50;

test('stripJsonc is linear: 48 KB of unclosed openers strips in under 50 ms (best of 3 runs)', () => {
  for (const [name, input] of Object.entries(SHAPES)) {
    const times = [];
    for (let i = 0; i < 3; i++) {
      const t0 = process.hrtime.bigint();
      stripJsonc(input);
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    assert.ok(Math.min(...times) < BUDGET_MS, `${name}: best of 3 = ${Math.min(...times).toFixed(1)} ms, budget ${BUDGET_MS} ms`);
  }
});

test('stripJsonc leaves an unclosed opener in place, so a malformed config still fails JSON.parse', () => {
  for (const [name, input] of Object.entries(SHAPES)) {
    assert.equal(stripJsonc(input), input, `${name}: the unclosed text is emitted unchanged`);
  }
  assert.throws(() => JSON.parse(stripJsonc('{"a":1} /* never closed')));
  assert.throws(() => JSON.parse(stripJsonc('{"a":"never closed')));
});

test('stripJsonc matches the previous regex byte for byte on well-formed JSON-with-comments', () => {
  const fixtures = [
    '',
    '{}',
    '{"url":"http://example.com","mode":"auto"}',
    '{"p":"C:\\\\","x":"a//b"}',
    '{"q":"he said \\"hi\\""}',
    '{\n  "a": "keep", // line comment with "quotes" inside\n  "b": "x" /* block */\n}',
    '{"s":"/* not a comment */","t":"// not either"} // trailing',
    '{"a":1 /**/ , "b":2 /* a */ /* b */}',
    '{"a":"x\\\\"} /* after an escaped-backslash value */',
    '/* header */ {"k": [1, 2, 3]} // footer */',
    '{"w":"a/*b","v":"c*/d"}',
  ];
  for (const f of fixtures) {
    assert.equal(stripJsonc(f), oldStrip(f), `differs on ${JSON.stringify(f)}`);
  }
});

// The consistency guard must pin all five copies of the strip call equal, callback included.
test('the JSONC consistency guard passes on the repo and names a hook copy that diverges', (t) => {
  assert.deepEqual(checkJsoncRegexSync(repo), []);
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-jsonc-guard-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const files = ['scripts/lib/jsonc.mjs', 'hooks/_shared/node-config.js', 'hooks/coalmine-conductor.js', 'hooks/rot-canary-stop.js', 'hooks/rot-canary-touch.js'];
  for (const rel of files) {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.copyFileSync(path.join(repo, rel), path.join(tmp, rel));
  }
  const planted = path.join(tmp, 'hooks/coalmine-conductor.js');
  const body = fs.readFileSync(planted, 'utf8');
  assert.ok(body.includes('(m, close) => (m[0]'), 'the planted copy holds the strip callback');
  fs.writeFileSync(planted, body.replace('(m, close) => (m[0]', '(m) => (m[0]'));
  const out = checkJsoncRegexSync(tmp);
  assert.ok(out.some((f) => f.level === 'FAIL' && f.msg.includes('DIVERGED') && f.msg.includes('coalmine-conductor.js')), JSON.stringify(out));
});
