// c37 item 3.5: link-check reads and indexes each target once per RUN (a heading set cached by its absolute path), and bounds its work:
// a per-document link cap and a per-run target budget, each refusing with a named finding line. Witnesses count target reads and heading
// builds, never a clock. Hermetic: fixtures are temp folders under os.tmpdir(); the reader is injected and counts its calls.
// Namespace import: the new helper is absent on the old tree, so those legs fail on their own assertions, not on an import error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as lc from './link-check.mjs';
import { readRepoFileBounded, MAX_DOC_BYTES } from './repo-fs.mjs';

function tempDocs(t, files) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-lcache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text, 'utf8');
  }
  return dir;
}

// A reader that counts how often each path is read, and reads through the bounded reader like the default does.
function countingReader(dir) {
  const reads = new Map();
  const read = (p) => {
    reads.set(p, (reads.get(p) ?? 0) + 1);
    return readRepoFileBounded(p, dir, MAX_DOC_BYTES);
  };
  return { read, reads };
}

test('N links to one target read it once and index its headings once in a run', (t) => {
  const links = Array.from({ length: 50 }, () => '[x](b.md#h)').join(' ');
  const dir = tempDocs(t, { 'a.md': `# a\n\n${links}\n`, 'd.md': `# d\n\n[y](b.md#h)\n`, 'b.md': '# h\n' });
  const counted = countingReader(dir);
  const run = lc.newLinkRun?.();
  const bPath = path.join(dir, 'b.md');
  assert.deepEqual(lc.checkFile(path.join(dir, 'a.md'), dir, counted.read, run), [], 'control: every link resolves');
  assert.deepEqual(lc.checkFile(path.join(dir, 'd.md'), dir, counted.read, run), [], 'a second document in the same run resolves');
  assert.equal(counted.reads.get(bPath), 1, 'the target is read once for 51 links in two documents');
  assert.equal(run?.stats?.headingBuilds, 1, 'and its heading set is built once');
});

test('a document with more links than the per-document cap is refused by a named finding; the links past the cap are not checked', (t) => {
  const dead = Array.from({ length: 5001 }, (_, i) => `[x](missing-${i}.md)`).join('\n');
  const dir = tempDocs(t, { 'a.md': `# a\n\n${dead}\n` });
  const findings = lc.checkFile(path.join(dir, 'a.md'), dir);
  assert.ok(findings.some((f) => /not fully checked/.test(f) && /5000 links/.test(f)), 'a named line says the cap cut the document');
  assert.equal(findings.length, 5001, '5,000 dead-link findings and the one refusal line; the 5,001st link is never judged');
  assert.ok(!findings.some((f) => f.includes('missing-5000.md')), 'the link past the cap produces no finding of its own');
});

test('a run whose targets pass the aggregate character budget refuses the rest with a named finding', (t) => {
  const dir = tempDocs(t, {
    'a.md': '# a\n\n[x](b.md#h) [y](c.md#k)\n',
    'b.md': '# h\n' + 'b'.repeat(100) + '\n',
    'c.md': '# k\n' + 'c'.repeat(100) + '\n',
  });
  const run = lc.newLinkRun?.({ maxTargetChars: 50 });
  const findings = lc.checkFile(path.join(dir, 'a.md'), dir, undefined, run);
  assert.equal(findings.length, 1, 'the first target fits and is checked; the second is refused by the budget');
  assert.match(findings[0], /not checked -> c\.md#k .*read budget of 50 characters is spent/);
});
