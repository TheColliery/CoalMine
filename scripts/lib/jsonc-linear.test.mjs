// The JSONC comment stripper does its work in one counted pass. This file proves three things, all by counting work and never by
// reading a clock:
//   1. the work is linear: steps stay under C per character, and at most double when the text doubles, on the shapes that used to
//      cost more than their size. The witness is red on a quadratic stand-in and on a stand-in that does not count, so it can fail;
//   2. the output is the same as the previous regex and callback on every JSON file the repo carries, on the existing fixtures and on
//      seeded random texts;
//   3. a malformed input is kept to the end unchanged, so it still fails JSON.parse, and a well-formed one parses to the same value.
// Zero-dep (node:test + built-ins), scripts-quality.md section 2; testing.md Determinism: no clock, a fixed seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsonc } from './jsonc.mjs';
import { checkJsoncRegexSync } from './consistency.mjs';
import { MAX_CONFIG_BYTES } from './repo-fs.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The previous regex and callback, kept verbatim as the reference the differential compares against.
const OLD_RE = /"(?:\\[\s\S]|[^"\\])*(?:"|\\?$)|\/\/.*|\/\*[\s\S]*?(\*\/|$)/g;
const oldStrip = (c) => c.replace(OLD_RE, (m, close) => (m[0] === '"' || (m[1] === '*' && close !== '*/') ? m : ''));

// The two sizes every shape is measured at: the second is double the first, in units of the shape's own building block.
const SIZES = [2048, 4096];
// The most steps per character the witness accepts: one visit in the outer pass and at most one in an inner run.
const C = 6;
// Slack for the doubling check, so a shape that costs a fixed handful of steps at both sizes does not read as growth.
const SLACK = 64;

const CONFIG_LINE = '  "key": "' + 'v'.repeat(230) + '", // note\n';
const SHAPES = {
  'unclosed block openers': (n) => '/* a'.repeat(n),
  'nested block openers, never closed': (n) => '/* /* '.repeat(n),
  'unclosed string escapes': (n) => '"' + '\\"'.repeat(n),
  'a string ending in a lone backslash': (n) => '"\\'.repeat(n),
  'line comments with no line break': (n) => '// x'.repeat(n),
  'closed block comments': (n) => '/* c */ "k": 1, /* d */\n'.repeat(n),
  'closed line comments': (n) => '"k": 1, // c "x"\n'.repeat(n),
  // a config built to sit just under MAX_CONFIG_BYTES at the larger size, so the witness reads the largest config the reader accepts
  'a config at the size bound': (n) => '{\n' + CONFIG_LINE.repeat(n) + '}\n',
};

// One run: the text the shape builds at n units, and the steps the check counted on it.
function work(check, build, n) {
  const text = build(n);
  const counter = { steps: 0 };
  check(text, counter);
  return { length: text.length, steps: counter.steps };
}

// '' when the check's work is linear on this shape, else the reason it is not.
function linearVerdict(check, build) {
  const small = work(check, build, SIZES[0]);
  const large = work(check, build, SIZES[1]);
  if (small.steps < 1 || large.steps < 1) return `no steps counted (${small.steps}, ${large.steps}): the check does not count its work`;
  if (large.steps > C * large.length) return `${large.steps} steps for ${large.length} characters, over ${C} per character`;
  if (large.steps > 2 * small.steps + SLACK) return `${small.steps} steps became ${large.steps} as the text went from ${small.length} to ${large.length} characters`;
  return '';
}

test('stripJsonc work is linear on every shape: steps stay under C per character and at most double when the text doubles', () => {
  for (const [name, build] of Object.entries(SHAPES)) {
    assert.equal(linearVerdict(stripJsonc, build), '', name);
  }
});

test('the largest shape sits near MAX_CONFIG_BYTES, so the witness covers the size the reader accepts', () => {
  const large = work(stripJsonc, SHAPES['a config at the size bound'], SIZES[1]).length;
  assert.ok(large <= MAX_CONFIG_BYTES && large >= MAX_CONFIG_BYTES / 2, `${large} characters against a bound of ${MAX_CONFIG_BYTES}`);
});

// A deliberately quadratic stand-in: every block opener rescans to the end of the input, as the pattern it replaces did.
function quadraticStandIn(content, counter) {
  let steps = 0;
  for (let i = 0; i < content.length; i++) {
    steps++;
    if (content[i] === '/' && content[i + 1] === '*') {
      for (let j = i + 2; j < content.length; j++) {
        steps++;
        if (content[j] === '*' && content[j + 1] === '/') break;
      }
    }
  }
  counter.steps += steps;
  return content;
}

test('the work witness goes red on a quadratic stand-in that rescans to the end at every block opener', () => {
  assert.notEqual(linearVerdict(quadraticStandIn, SHAPES['unclosed block openers']), '', 'a rescanning check must fail the witness');
  assert.notEqual(linearVerdict(quadraticStandIn, SHAPES['nested block openers, never closed']), '', 'a rescanning check must fail the witness');
});

test('the work witness goes red on a check that never counts its work, so it cannot pass vacuously', () => {
  const uncounted = (content) => oldStrip(content);
  assert.notEqual(linearVerdict(uncounted, SHAPES['closed block comments']), '', 'a check that leaves the counter at zero must fail');
});

test('an unclosed string or block comment is kept to the end, so a malformed config still fails JSON.parse', () => {
  for (const name of ['unclosed block openers', 'unclosed string escapes', 'a string ending in a lone backslash']) {
    const input = SHAPES[name](8);
    assert.equal(stripJsonc(input), input, `${name}: the unclosed text is emitted unchanged`);
  }
  assert.throws(() => JSON.parse(stripJsonc('{"a":1} /* never closed')));
  assert.throws(() => JSON.parse(stripJsonc('{"a":"never closed')));
});

const FIXTURES = [
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
  '{"mode": "auto", // trailing note\n  "count": 3,\n}',
];

// Every .json file under the repo, outside the untracked and scratch folders. Read-only: the differential reads each file once.
function jsonFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'scratchpad', '.claude', '.agents'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) jsonFiles(p, out);
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

test('differential: the scanner returns the previous regex output on every JSON file the repo carries, and on the fixtures', () => {
  const files = jsonFiles(repo);
  assert.ok(files.length >= 10, `only ${files.length} JSON files found`);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    assert.equal(stripJsonc(text), oldStrip(text), path.relative(repo, f));
  }
  for (const f of FIXTURES) assert.equal(stripJsonc(f), oldStrip(f), JSON.stringify(f));
});

// mulberry32: a small seeded generator, so the corpus is the same on every run and every platform.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('differential: the scanner returns the previous regex output on 20000 seeded random texts of string, escape, comment and newline pieces', () => {
  const rand = seeded(29);
  const pieces = ['"', '\\', '\\"', '\\\\', '/', '*', '//', '/*', '*/', '\n', '\r', '\u2028', '\u2029', 'a', ' ', ',', '{', '}', ':', 'k', '1', '\t'];
  for (let i = 0; i < 20000; i++) {
    let text = '';
    const k = Math.floor(rand() * 24);
    for (let j = 0; j < k; j++) text += pieces[Math.floor(rand() * pieces.length)];
    assert.equal(stripJsonc(text), oldStrip(text), JSON.stringify(text));
  }
});

test('differential: 5000 seeded texts built from well-formed tokens agree with the previous regex, and most of them parse', () => {
  const rand = seeded(31);
  const tokens = ['"v"', '"a\\"b"', '"C:\\\\"', '"http://x"', '"/* no */"', ' ', '\n', ' // c\n', ' /* c */ ', ',', '1', 'true'];
  let parsed = 0;
  for (let i = 0; i < 5000; i++) {
    const text = '[' + Array.from({ length: 1 + Math.floor(rand() * 8) }, () => tokens[Math.floor(rand() * tokens.length)]).join('') + ']';
    const got = stripJsonc(text);
    assert.equal(got, oldStrip(text), JSON.stringify(text));
    try { JSON.parse(got); parsed++; } catch { /* a token mix that is not valid JSON is still compared above */ }
  }
  assert.ok(parsed >= 1000, `only ${parsed} of 5000 well-formed texts parsed`);
});

test('the consistency guard passes on the repo and names a copy whose stripper text diverges', (t) => {
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
  assert.ok(body.includes('  let steps = 0;'), 'the planted copy holds the stripper body');
  fs.writeFileSync(planted, body.replace('  let steps = 0;', '  let steps = 1;'));
  const out = checkJsoncRegexSync(tmp);
  assert.ok(out.some((f) => f.level === 'FAIL' && f.msg.includes('DIVERGED') && f.msg.includes('coalmine-conductor.js')), JSON.stringify(out));
});
