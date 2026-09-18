// Unit tests for scripts/lib/link-check.mjs (CW-017). All fixtures are in-memory via the
// injected `readFile` param on checkFile -- no filesystem fixtures needed for the pure
// slug/extract/finding logic. checkFiles' repoRoot-relative path resolution is exercised
// against real temp files (existsSync has no injection point in the module).

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { headingSlugs, extractLinks, checkFile, checkFiles } from './link-check.mjs';

test('headingSlugs: basic heading slugified GitHub-style', () => {
  const slugs = headingSlugs('# Hello World\n\ntext');
  assert.ok(slugs.has('hello-world'));
});

test('headingSlugs: duplicate headings suffixed -1, -2 in document order', () => {
  const slugs = headingSlugs('# Foo\n\n## Foo\n\n### Foo\n');
  assert.deepStrictEqual([...slugs].sort(), ['foo', 'foo-1', 'foo-2']);
});

test('headingSlugs: a heading inside a fenced code block is not a real heading', () => {
  const slugs = headingSlugs('```\n# Not A Heading\n```\n\n# Real Heading\n');
  assert.strictEqual(slugs.size, 1);
  assert.ok(slugs.has('real-heading'));
});

test('headingSlugs: punctuation dropped, spaces to hyphens', () => {
  const slugs = headingSlugs("# What's New? (v2)\n");
  assert.ok(slugs.has('whats-new-v2'));
});

test('headingSlugs: an emoji-prefixed heading slugs with a LEADING hyphen, never trimmed -- GitHub itself does not trim (caught live against this repo\'s own README/CONTRIBUTING anchors)', () => {
  const slugs = headingSlugs('## 🔌 Universal Agent Support\n');
  assert.ok(slugs.has('-universal-agent-support'), [...slugs].join(','));
  assert.ok(!slugs.has('universal-agent-support'));
});

test('headingSlugs: an inline code span in a heading keeps its CONTENT and drops only the backtick markup -- r33 INSPECT LOW-5, this repo\'s own live evals/README.md#1 heading, GitHub\'s real anchor confirmed manually', () => {
  const slugs = headingSlugs('# CoalMine evals — `rot-canary` pilot\n');
  assert.ok(slugs.has('coalmine-evals--rot-canary-pilot'), [...slugs].join(','));
});

test('headingSlugs: a TAB inside a heading is DROPPED, never hyphenated -- r33 RE-INSPECT LOW-A, github-slugger strips a tab as a C0 control char rather than treating it like a space', () => {
  const slugs = headingSlugs('## a\tb\n');
  assert.ok(slugs.has('ab'), [...slugs].join(','));
  assert.ok(!slugs.has('a-b'));
});

test('headingSlugs: a fenced block INSIDE the doc still hides its own headings even though inline spans in a real heading no longer strip their content', () => {
  const slugs = headingSlugs('```\n# `fenced` fake heading\n```\n\n# Real `heading`\n');
  assert.strictEqual(slugs.size, 1);
  assert.ok(slugs.has('real-heading'));
});

// CodeQL #68 (js/incomplete-multi-character-sanitization, HIGH) dismissal proof, r34
// ITEM 1. slugify()'s single-pass HTML_TAG_RE strip is not fixed-point, but its own
// disallowed-char filter two steps later strips every `<`/`>` regardless -- pinned
// directly against the property the dismissal rests on, not against a specific
// mechanism, so it stays true even if the internals change. The adversarial shapes
// are the ones the CodeQL query's own class is about: nested/malformed tags whose
// single-pass strip could in principle leave a re-formed tag behind.
test('headingSlugs never yields a slug containing < or > -- CodeQL #68 dismissal proof (r34)', () => {
  const adversarial = [
    '# <scr<script>ipt> pilot\n',
    '# <<a>b>\n',
    '# <<<x>>>\n',
    '# a <script b\n',
  ];
  for (const heading of adversarial) {
    for (const slug of headingSlugs(heading)) {
      assert.ok(!slug.includes('<') && !slug.includes('>'), `slug ${JSON.stringify(slug)} from heading ${JSON.stringify(heading)} contains < or >`);
    }
  }
});

test('extractLinks: basic inline link', () => {
  const links = extractLinks('see [the docs](./docs/README.md) for more');
  assert.deepStrictEqual(links, [{ text: 'the docs', target: './docs/README.md' }]);
});

test('extractLinks: a link shown as a markdown EXAMPLE inside a code span is not extracted', () => {
  const links = extractLinks('use `[text](target)` syntax for links');
  assert.strictEqual(links.length, 0);
});

test('extractLinks: a link shown inside a fenced code block is not extracted', () => {
  const links = extractLinks('```md\n[example](./fake.md)\n```\n\n[real](./real.md)');
  assert.deepStrictEqual(links, [{ text: 'real', target: './real.md' }]);
});

test('extractLinks: a titled link keeps only the target, not the title', () => {
  const links = extractLinks('[x](./a.md "A Title")');
  assert.deepStrictEqual(links, [{ text: 'x', target: './a.md' }]);
});

test('checkFile: a dead relative link is reported', () => {
  const files = { '/repo/a.md': '[dead](./missing.md)' };
  const findings = checkFile('/repo/a.md', '/repo', (p) => {
    if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
    return files[p];
  });
  assert.strictEqual(findings.length, 1);
  assert.match(findings[0], /dead link/);
});

test('checkFile: a live relative link (file exists on disk) is not reported', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'target.md'), '# Target\n');
  const citing = path.join(dir, 'a.md');
  const files = { [citing]: '[live](./target.md)' };
  const findings = checkFile(citing, dir, (p) => files[p]);
  assert.strictEqual(findings.length, 0);
});

test('checkFile: a bare #anchor with no matching heading in the SAME file is reported', () => {
  const files = { '/repo/a.md': '# Real\n\nsee [x](#not-real)' };
  const findings = checkFile('/repo/a.md', '/repo', (p) => files[p]);
  assert.strictEqual(findings.length, 1);
  assert.match(findings[0], /dead anchor #not-real/);
});

test('checkFile: a bare #anchor matching a real heading in the same file is not reported', () => {
  const files = { '/repo/a.md': '# Real Heading\n\nsee [x](#real-heading)' };
  const findings = checkFile('/repo/a.md', '/repo', (p) => files[p]);
  assert.strictEqual(findings.length, 0);
});

test('checkFile: file+anchor link -- dead anchor in an otherwise-live target file is reported', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'target.md'), '# Only Heading\n');
  const citing = path.join(dir, 'a.md');
  const files = {
    [citing]: '[x](./target.md#missing)',
    [path.join(dir, 'target.md')]: '# Only Heading\n',
  };
  const findings = checkFile(citing, dir, (p) => files[p]);
  assert.strictEqual(findings.length, 1);
  assert.match(findings[0], /dead anchor -> \.\/target\.md#missing/);
});

test('checkFile: file+anchor link -- live anchor in a live target file is not reported', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const citing = path.join(dir, 'a.md');
  const targetPath = path.join(dir, 'target.md');
  fs.writeFileSync(targetPath, '# Present\n');
  const files = { [citing]: '[x](./target.md#present)', [targetPath]: '# Present\n' };
  const findings = checkFile(citing, dir, (p) => files[p]);
  assert.strictEqual(findings.length, 0);
});

test('checkFile: external http(s) links are out of scope, never checked', () => {
  const files = { '/repo/a.md': '[ext](https://example.com/nonexistent)' };
  const findings = checkFile('/repo/a.md', '/repo', (p) => files[p]);
  assert.strictEqual(findings.length, 0);
});

test('checkFile: mailto: links are out of scope', () => {
  const files = { '/repo/a.md': '[mail](mailto:someone@example.com)' };
  const findings = checkFile('/repo/a.md', '/repo', (p) => files[p]);
  assert.strictEqual(findings.length, 0);
});

test('checkFile: a site-root-absolute path is out of scope, never checked', () => {
  const files = { '/repo/a.md': '[root](/some/absolute/path.md)' };
  const findings = checkFile('/repo/a.md', '/repo', (p) => files[p]);
  assert.strictEqual(findings.length, 0);
});

test('checkFiles: aggregates findings across multiple files', () => {
  const files = {
    '/repo/a.md': '[dead](./missing-a.md)',
    '/repo/b.md': '[dead](./missing-b.md)',
  };
  const readFile = (p) => files[p];
  const findings = [
    ...checkFile('/repo/a.md', '/repo', readFile),
    ...checkFile('/repo/b.md', '/repo', readFile),
  ];
  assert.strictEqual(findings.length, 2);
});

test('checkFiles: real end-to-end over temp files, zero findings when everything resolves', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'README.md'), '# Home\n\nsee [other](./OTHER.md#section)\n');
  fs.writeFileSync(path.join(dir, 'OTHER.md'), '# Other\n\n## Section\n');
  const findings = checkFiles([path.join(dir, 'README.md'), path.join(dir, 'OTHER.md')], dir);
  assert.strictEqual(findings.length, 0);
});

test('checkFiles: real end-to-end over temp files, a planted dead link is caught', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'README.md'), '[gone](./NOPE.md)\n');
  const findings = checkFiles([path.join(dir, 'README.md')], dir);
  assert.strictEqual(findings.length, 1);
});
