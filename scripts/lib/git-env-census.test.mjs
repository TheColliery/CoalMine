// git-env-census.test.mjs -- the canon git-spawn census against the WITNESS LIST (08d, merged 2026-10-09): one leg per vector, each fixture run through scanGitSpawns with NO pins.
// A refused fixture must also be a COUNTED spawn, so a vector that hides the spawn itself cannot read as clean; a passing fixture must read clean with no pin and be counted
// safe. Hermetic: the fixtures are strings in git-env-census.vectors.mjs, written nowhere. Portable: a room that adopts the census by blob id adopts this file with it and adds
// its own pins and its own spawns in a test of its own (this file names no path outside scripts/lib/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanGitSpawns, censusGitSpawns, collectScriptsMjs, gitBlobId, lex, CENSUS_EXEMPT } from './git-env-census.mjs';
import { VECTORS, CEILINGS, COVERS } from './git-env-census.vectors.mjs';

const scan = (text, pins = []) => scanGitSpawns([{ rel: 'fixture.mjs', text }], pins);

for (const v of VECTORS) {
  test(`witness ${v.id}${v.src ? ` [${v.src}]` : ''}: ${v.expect === 'fail' ? 'every fixture is a counted spawn WITH a finding' : 'every fixture is a counted spawn with NO finding and no pin'} (${v.texts.length} fixture${v.texts.length === 1 ? '' : 's'})`, () => {
    v.texts.forEach((text, k) => {
      const r = scan(text);
      if (!v.noCount) assert.ok(r.calls >= 1, `${v.id}[${k}] was not counted as a git spawn:\n${text}`);
      if (v.expect === 'fail') assert.ok(r.findings.length >= 1, `${v.id}[${k}] passed the census:\n${text}`);
      else {
        assert.deepEqual(r.findings, [], `${v.id}[${k}] was refused:\n${text}`);
        assert.equal(r.safe, r.calls, `${v.id}[${k}] was counted but not safe`);
      }
    });
  });
}

// The loop above asserts nothing about WHICH vectors exist, so a deleted row or an emptied list would shrink it without a sound. Every id of the list is carried by a row.
test('every id of the witness list is carried by a row: F1-F60 and R1-R3 by a vector, R4 and R5 by a named ceiling, P3-P7 by a vector, and P1 and P2 by the canon carriers', () => {
  const have = new Set(VECTORS.map((v) => v.id.split(' ')[0]));
  const ceilings = new Set(CEILINGS.map((c) => c.id));
  const carriers = new Set(['P1', 'P2']); // the canon release-notes.mjs and its test, checked where those files live (the .github repository's own tests)
  const missing = [];
  const want = [...Array.from({ length: 60 }, (_, i) => `F${i + 1}`), 'R1', 'R2', 'R3', 'R4', 'R5', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
  for (const id of want) {
    const carried = have.has(id) || ceilings.has(id) || carriers.has(id) || (COVERS[id] && COVERS[id].length > 0 && COVERS[id].every((x) => have.has(x)));
    if (!carried) missing.push(id);
  }
  assert.deepEqual(missing, [], 'witness ids with no row');
  for (const [id, rows] of Object.entries(COVERS)) assert.ok(rows.every((x) => have.has(x)), `${id} points at a row that does not exist`);
  assert.ok(VECTORS.length >= 150, `the corpus shrank to ${VECTORS.length} rows`);
});

test('the named ceilings are what they say: R4 (a spawner named with a unicode escape) and R5 (a command built by concatenation) are NOT counted, each with its reason', () => {
  assert.deepEqual(CEILINGS.map((c) => c.id), ['R4', 'R5']);
  for (const c of CEILINGS) {
    assert.ok(c.why && c.why.length > 20, `${c.id} carries its reason`);
    for (const text of c.texts) assert.equal(scan(text).calls, 0, `${c.id} is counted now: close the ceiling in the census header and move the row to the vectors`);
  }
});

test('no pin ships with the canon, and a pin matches only the bytes it names: any edit re-arms the census on that file', () => {
  assert.deepEqual(CENSUS_EXEMPT, []);
  const dirty = "import { spawnSync } from 'node:child_process';\nspawnSync('git', ['status'], { env: process.env });\n";
  assert.ok(scan(dirty).findings.length >= 1);
  const pin = { rel: 'fixture.mjs', blob: gitBlobId(dirty), why: 'a test' };
  const pinned = scan(dirty, [pin]);
  assert.deepEqual([pinned.findings, pinned.exempted, pinned.calls], [[], 1, 0], 'a pin hides the file from the census and says so (exempted 1)');
  assert.ok(scan(dirty + '// edited\n', [pin]).findings.length >= 1, 'one edited byte spends the pin');
  assert.ok(scan(dirty, [{ ...pin, rel: 'other.mjs' }]).findings.length >= 1, 'a pin names its file');
  assert.equal(gitBlobId('a\r\nb\r\n'), gitBlobId('a\nb\n'), 'line endings are normalised, so a Windows checkout of the same file reads the same blob');
});

test('censusGitSpawns is the findings-only view, and collectScriptsMjs walks scripts/**/*.mjs of a repository with forward-slash names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-env-census-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'scripts', 'a.mjs'), "import { spawnSync } from 'node:child_process';\nspawnSync('git', ['status'], { env: process.env });\n");
    fs.writeFileSync(path.join(dir, 'scripts', 'lib', 'b.mjs'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(dir, 'scripts', 'notes.txt'), 'not code');
    const files = collectScriptsMjs(dir);
    assert.deepEqual(files.map((f) => f.rel).sort(), ['scripts/a.mjs', 'scripts/lib/b.mjs']);
    const findings = censusGitSpawns(files);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /^scripts\/a\.mjs:2 /);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the lexer reads a quote inside a regex and a backtick inside a template without losing the line (F41), and a shebang is not code', () => {
  const toks = lex("#!/usr/bin/env node\nconst r = /['\"]/g; const t = `a ${'b'} c`; marker('git');\n");
  assert.ok(toks.some((t) => t.k === 're'), 'a regex literal is one token');
  assert.ok(toks.some((t) => t.k === 'id' && t.v === 'marker'), 'the call after them is still seen');
  assert.ok(!toks.some((t) => t.v === 'usr'), 'the shebang line is skipped');
});
