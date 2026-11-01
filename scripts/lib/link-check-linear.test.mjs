// Link extraction is linear on every input shape, and a test proves it by counting work, never by reading a clock.
// extractLinks is a single-pass scanner with an optional counter ({ steps }, one step per character visit). This file holds three things:
//   1. the scanner returns exactly what the previous regex returned, on the existing fixtures, on every markdown file the repo carries
//      and on a seeded random corpus (a differential against the pattern kept below as OLD_LINK_RE);
//   2. its step count stays under C * text length and at most doubles when the text doubles, on the shapes that used to be
//      quadratic and on shapes aimed at the scanner's own stop sets;
//   3. that witness goes red on a deliberately quadratic stand-in (a copy of the scanner whose label or target does not stop at
//      a bracket, the two reads the previous pattern had), so it can fail.
// Zero-dep (node:test + built-ins), scripts-quality.md section 2; testing.md Determinism: no clock, a fixed seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractLinks, stripCode } from './link-check.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The pattern extraction used before the scanner, applied to the same stripped text, kept verbatim as the reference.
const OLD_LINK_RE = /\[([^[\]]*)\]\(([^)\s[\]]+)(?:[ \t]+"[^"]*")?\)/g;
const oldLinks = (text) => {
  const s = stripCode(text);
  const out = [];
  let m;
  OLD_LINK_RE.lastIndex = 0;
  while ((m = OLD_LINK_RE.exec(s))) out.push({ text: m[1], target: m[2] });
  return out;
};

// C is the most character visits per input character the witness accepts. The scanner visits a character once to find a start,
// once in a label, target or title run, so it measures at most 2 per character; 6 leaves room and still fails a quadratic
// scan at these sizes. SLACK covers a fixed handful of steps at both sizes.
const C = 6;
const SLACK = 64;
const SIZES = [4096, 8192];

function work(extract, text) {
  const counter = { steps: 0 };
  extract(text, counter);
  return { steps: counter.steps, length: text.length };
}

// Returns '' when the extractor is linear on the shape at both sizes, else the first thing that is not.
function witness(extract, name, build) {
  const small = work(extract, build(SIZES[0]));
  const large = work(extract, build(SIZES[1]));
  if (small.steps < 1 || large.steps < 1) return `${name}: no steps counted (${small.steps}, ${large.steps}): the extractor does not count its work`;
  if (small.steps > C * small.length) return `${name}: ${small.steps} steps for ${small.length} characters, over ${C} per character`;
  if (large.steps > C * large.length) return `${name}: ${large.steps} steps for ${large.length} characters, over ${C} per character`;
  if (large.steps > 2 * small.steps + SLACK) return `${name}: ${small.steps} steps became ${large.steps} when the text went from ${small.length} to ${large.length} characters`;
  return '';
}

const SHAPES = {
  'the unclosed "[" run': (n) => '['.repeat(n),
  'the "[](" run, with no ")" anywhere': (n) => '[]('.repeat(n),
  'the "[a](" run, with no ")" anywhere': (n) => '[a]('.repeat(n),
  'nested brackets that never close': (n) => '[[a]('.repeat(n),
  'many closed links': (n) => '[a](b) '.repeat(n),
  'a title that never closes': (n) => '[](a "' + 'x'.repeat(4 * n),
  'a white space run after a target that does not close': (n) => '[](a' + ' '.repeat(4 * n) + 'x',
  'a title that closes without ")" after every start': (n) => '[](a "t"x'.repeat(n),
};

test('extractLinks work is linear in the text: steps stay under C per character and at most double when the text doubles', () => {
  for (const [name, build] of Object.entries(SHAPES)) {
    assert.equal(witness(extractLinks, name, build), '', name);
  }
});

// Quadratic stand-ins: a copy of the scanner whose label, or whose target, does not stop at a bracket. Each start then rescans
// to the end of the text, the way the two reads of the previous pattern did. A witness red here is the proof the witness can fail.
function standIn({ labelStopsAtBracket, targetStopsAtBracket }) {
  return (text, counter) => {
    const s = stripCode(text);
    const n = s.length;
    let steps = 0;
    for (let p = 0; p < n; p++) { // every opening bracket starts a fresh read, the way the previous pattern did
      steps++;
      if (s[p] !== '[') continue;
      let j = p + 1;
      while (j < n && (labelStopsAtBracket ? s[j] !== '[' && s[j] !== ']' : s[j] !== ']')) { steps++; j++; }
      if (j >= n || s[j] !== ']' || j + 1 >= n || s[j + 1] !== '(') continue;
      let e = j + 2;
      while (e < n && s[e] !== ')' && !/\s/.test(s[e]) && (!targetStopsAtBracket || (s[e] !== '[' && s[e] !== ']'))) { steps++; e++; }
    }
    counter.steps += steps;
    return [];
  };
}

test('the work witness goes red on a quadratic stand-in whose label does not stop at a bracket', () => {
  const v = witness(standIn({ labelStopsAtBracket: false, targetStopsAtBracket: true }), 'the unclosed "[" run', SHAPES['the unclosed "[" run']);
  assert.notEqual(v, '', 'a label that rescans to the next closing bracket must fail the witness');
});

test('the work witness goes red on a quadratic stand-in whose target does not stop at a bracket', () => {
  const v = witness(standIn({ labelStopsAtBracket: true, targetStopsAtBracket: false }), 'the "[](" run', SHAPES['the "[](" run, with no ")" anywhere']);
  assert.notEqual(v, '', 'a target that runs across brackets must fail the witness');
});

test('the work witness goes red on an extractor that counts nothing, so it cannot pass vacuously', () => {
  const uncounted = (text) => oldLinks(text);
  assert.notEqual(witness(uncounted, 'many closed links', SHAPES['many closed links']), '', 'an extractor that leaves the counter at zero must fail');
});

test('extractLinks still finds an ordinary link, an image, and a link after an unclosed bracket', () => {
  assert.deepEqual(extractLinks('see [docs](./a.md) and ![logo](./img/b.png) and [x [y](./c.md) tail').map((l) => l.target), ['./a.md', './img/b.png', './c.md']);
  assert.deepEqual(extractLinks('[unclosed\n\nlater [y](./d.md)').map((l) => l.target), ['./d.md']);
  assert.deepEqual(extractLinks('[![badge](./badge.svg)](./home.md)').map((l) => l.target), ['./badge.svg']);
  assert.deepEqual(extractLinks('[t](./a.md "a title") and [u](./b.md "second")').map((l) => l.target), ['./a.md', './b.md']);
  assert.deepEqual(extractLinks('[v](./c.md \n"x")').map((l) => l.target), [], 'a title after a line break is not part of the link');
});

const FIXTURES = [
  '', '[', '[]', '[](', '[]()', '[](a)', '[](a', '[](a ', '[](a "', '[](a "t', '[](a "t"', '[](a "t")', '[](a  "t")', '[](a\n"t")',
  '[a](b[c](d)', '![x](y)', '[x]](y)', '[x](y))', '[x]( y)', '[x](y "z" )', '[[x](y)](z)', '[x\ny](z)', '[x](y\nz)',
  '[x](y "a\nb")', '[x](y "a""b")', '[x](y "a" "b")', '[x] (y)', '[x](y)[z](w)', '[x](y)[z](w', '[](][](a)', '[](x "y"[](z)',
  'text [a](b) more [c](d "e") end', '[x](a\t"t")', '[x](a\r\n"t")', '[x](a "t")', '[x](a )', '[x]( )',
  '```\n[a](b)\n```', '`[a](b)` [c](d)', '[a](b "c d") e',
];

test('differential: the scanner returns what the previous pattern returned on the existing fixtures and this repo\'s own markdown', () => {
  let compared = 0;
  for (const text of FIXTURES) {
    assert.deepEqual(extractLinks(text), oldLinks(text), JSON.stringify(text));
    compared++;
  }
  const mdFiles = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', 'scratchpad', 'coverage', '.claude', '.agents'].includes(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith('.md')) mdFiles.push(full);
    }
  };
  walk(repo);
  mdFiles.sort();
  assert.ok(mdFiles.length > 0, 'the repo holds markdown files');
  for (const file of mdFiles) {
    const text = fs.readFileSync(file, 'utf8');
    assert.deepEqual(extractLinks(text), oldLinks(text), path.relative(repo, file));
    compared++;
  }
  const names = mdFiles.map((f) => path.relative(repo, f));
  assert.ok(names.includes('README.md') && names.includes('CHANGELOG.md'), 'the README and the CHANGELOG are among the files compared');
  assert.ok(compared >= FIXTURES.length + mdFiles.length);
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

test('differential: the scanner returns what the previous pattern returned on 20000 seeded random short strings', () => {
  const alphabet = ['[', ']', '(', ')', '!', ' ', '\t', 'x', 'a', '"', '\n', ' ', ' ', '`', '\r'];
  const rand = seeded(2904);
  for (let i = 0; i < 20000; i++) {
    const len = Math.floor(rand() * 40);
    let text = '';
    for (let k = 0; k < len; k++) text += alphabet[Math.floor(rand() * alphabet.length)];
    assert.deepEqual(extractLinks(text), oldLinks(text), JSON.stringify(text));
  }
});
