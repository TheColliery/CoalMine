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
  } finally { removeTree(dir); }
});

// Teardown of a tree git children just used: on Windows a git.exe that outlives its launcher by a few seconds still holds the tree, and one plain rmSync
// answers EBUSY, EPERM or ENOTEMPTY, failing the test for a reason that is not the test's (CoalWash e63, measured: a loop of fresh calls clears it, the
// retry options of one call do not; order 16i item 6). A tree still held past the budget throws: a real leak stays loud.
function removeTree(dir, budgetMs = 30000) {
  const until = Date.now() + budgetMs;
  for (;;) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch (e) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(e && e.code) || Date.now() >= until) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

test('the lexer reads a quote inside a regex and a backtick inside a template without losing the line (F41), and a shebang is not code', () => {
  const toks = lex("#!/usr/bin/env node\nconst r = /['\"]/g; const t = `a ${'b'} c`; marker('git');\n");
  assert.ok(toks.some((t) => t.k === 're'), 'a regex literal is one token');
  assert.ok(toks.some((t) => t.k === 'id' && t.v === 'marker'), 'the call after them is still seen');
  assert.ok(!toks.some((t) => t.v === 'usr'), 'the shebang line is skipped');
});

// ---- 2026-11-02a (a): the four Deep Scan classes of 2026-11-01, each with a witness that was red before its fix ---------------------------------------------
// (1) Work grows with the file, not its square: three scans walked the whole file again for each reference (the assignment-target test and the enclosing-
// bracket test walked back over every earlier statement; a regex candidate that found no closing slash searched to the end of its line again for every later
// slash). The counter is the census's own (CENSUS_WORK); the bound is per character and on the doubling, never a clock.
test('the census does linear work on the five shapes that made it quadratic: repeated reads of a declared name, a spawner named many times, a line of unclosed regex candidates, and two for heads -- RED before 2026-11-02a', async () => {
  const { CENSUS_WORK } = await import('./git-env-census.mjs');
  const shapes = {
    reads: (n) => 'const a = 1;\n' + 'a;\n'.repeat(n),
    spawnerNames: (n) => 'spawnSync;\n'.repeat(n),
    regexLine: (n) => '/['.repeat(n) + '\n',
    // every reference sits in a for-of head after its `of`: the for-head question must not walk to the head's end again for each one
    forOf: (n) => 'const a = 1;\nfor (const x of [' + 'a,'.repeat(n) + ']) {}\n',
    // every reference sits before the head's first `;`: each asks for the head's keyword, which lies past all of them, so it must be found once per head
    forInit: (n) => 'const a = 1;\nfor (' + 'a,'.repeat(n) + 'a;;) {}\n',
  };
  for (const [name, make] of Object.entries(shapes)) {
    const at = (n) => { const text = make(n); CENSUS_WORK.steps = 0; scan(text); return { chars: text.length, steps: CENSUS_WORK.steps }; };
    const small = at(2000), big = at(4000);
    assert.ok(big.steps > 0, `${name}: the counter moved`);
    assert.ok(big.steps / big.chars <= 8, `${name}: ${big.steps / big.chars} steps per character`);
    assert.ok(big.steps / small.steps <= 2.3, `${name}: doubling the file took ${big.steps / small.steps} times the work`);
  }
});

// Counts the bytes fs.readSync hands back while `body` runs (F4 of t342, 2026-11-17): a fixture ONE byte over the budget is read to its last byte by a reader that stops at the budget plus one and by one that
// reads on to the end, so a bound test needs a file well past the budget and a count of what was actually read.
function countRead(body) {
  const real = fs.readSync; const o = { bytes: 0 };
  fs.readSync = function (...a) { const n = real.apply(this, a); o.bytes += n; return n; };
  try { body(); } finally { fs.readSync = real; }
  return o;
}

// (2) The collector reads only regular files, within a byte budget: a .mjs symlink (or a link to a directory) under scripts/ is refused by name, never
// followed and never skipped, and a file past the budget is refused by name before it is read.
test('collectScriptsMjs refuses a .mjs past the byte budget by name, before reading it -- RED before 2026-11-02a', async () => {
  const { MAX_SOURCE_BYTES } = await import('./git-env-census.mjs');
  assert.ok(Number.isInteger(MAX_SOURCE_BYTES) && MAX_SOURCE_BYTES > 0, 'the budget is a named number');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-env-census-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'scripts', 'big.mjs'), 'x'.repeat(2 * MAX_SOURCE_BYTES));
    const read = countRead(() => assert.throws(() => collectScriptsMjs(dir), /scripts\/big\.mjs.*budget/, 'an over-budget file is refused by name'));
    assert.strictEqual(read.bytes, 0, 'refused on the descriptor\'s size: not one byte of it was read (the old fixture, one byte over, read every byte before it threw)');
  } finally { removeTree(dir); }
});

// The link leg on its own, so where the account cannot make a link only this leg is skipped (one skippable leg per test).
test('collectScriptsMjs refuses a symlink or junction under scripts/ by name, instead of following it -- RED before 2026-11-02a', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-env-census-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'real.mjs'), 'export const x = 1;\n');
    let made = true;
    try { fs.symlinkSync(process.platform === 'win32' ? dir : path.join(dir, 'real.mjs'), path.join(dir, 'scripts', 'link.mjs'), process.platform === 'win32' ? 'junction' : 'file'); } catch { made = false; }
    if (!made) { t.skip('this account cannot make a symlink or junction here'); return; }
    assert.throws(() => collectScriptsMjs(dir), /scripts\/link\.mjs.*(symlink|regular file)/, 'a link is refused by name');
  } finally { removeTree(dir); }
});

// The fixture calls are built from these names, so the repository's spawn-timeout scan does not read a fixture string as a spawn of this file.
const SP = 'spawn' + 'Sync';
const EF = 'execFile' + 'Sync';

// (3) The env must sit in the argument Node reads as the options: the second argument when it is an object, else the third. An env in any other argument is a decoy.
test('an env in an argument Node does not read as the options is not counted: a decoy after an options object, or after the options position -- RED before 2026-11-02a', () => {
  const head = "import { spawnSync, execFileSync } from 'node:child_process';\n";
  for (const call of [
    `${SP}('git', { cwd: '.' }, { env: gitEnv() });`,
    `${SP}('git', ['status'], {}, { env: gitEnv() });`,
    `${EF}('git', { cwd: '.' }, { env: gitEnv() });`,
  ]) assert.ok(scan(head + call + '\n').findings.length >= 1, `passed: ${call}`);
  for (const call of [`${SP}('git', { env: gitEnv() });`, `${SP}('git', ['status'], { env: gitEnv() });`, `${SP}('git', args, { env: gitEnv() });`]) {
    const r = scan(head + call + '\n');
    assert.deepEqual([r.findings, r.safe], [[], 1], `refused: ${call}`);
  }
});

// (4) A helper is safe only when every way out of it returns a safe value: a bare return, or a body that can end without a return, hands the child undefined, and Node then
// gives it the parent's whole environment.
test('a helper with a bare return, or one whose body can end without returning, is not a safe env -- RED before 2026-11-02a', () => {
  const head = "import { spawnSync } from 'node:child_process';\n";
  const call = `${SP}('git', ['status'], { env: mk() });\n`;
  for (const fn of [
    'function mk() { if (process.argv[2]) return gitEnv(); }',
    'function mk() { if (process.argv[2]) return; return gitEnv(); }',
    'const mk = () => { if (process.argv[2]) return gitEnv(); };',
    'function mk() {\n  return\n  gitEnv();\n}', // t346 F15: a line break after return ends the statement (ASI), so mk returns undefined
    'const mk = () => {\n  return\n  {};\n};',
  ]) assert.ok(scan(head + fn + '\n' + call).findings.length >= 1, `passed: ${fn}`);
  for (const fn of ['function mk() { return gitEnv(); }', 'function mk() { if (process.argv[2]) return gitEnv(); return gitEnv(); }', 'const mk = () => gitEnv();', 'function mk() {\n  return gitEnv(\n  );\n}']) {
    const r = scan(head + fn + '\n' + call);
    assert.deepEqual([r.findings, r.safe], [[], 1], `refused: ${fn}`);
  }
});

// The collector's read: the size is checked on the open descriptor, and the read itself stops at the budget plus one byte, so a .mjs that grows after the
// check is refused by name. A preload-free stand-in for the growth: fstat reports 0 bytes for every regular file during the call.
test('collectScriptsMjs stops reading at the budget: a .mjs that grows past it after the size check is refused by name, never read to its end', async () => {
  const { MAX_SOURCE_BYTES } = await import('./git-env-census.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-env-census-'));
  const orig = fs.fstatSync;
  try {
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'scripts', 'grows.mjs'), 'x'.repeat(2 * MAX_SOURCE_BYTES));
    fs.fstatSync = function (...a) { const s = orig.apply(this, a); if (s.isFile()) Object.defineProperty(s, 'size', { value: 0 }); return s; };
    const read = countRead(() => assert.throws(() => collectScriptsMjs(dir), /scripts\/grows\.mjs.*budget/));
    assert.ok(read.bytes <= MAX_SOURCE_BYTES + 1, `the read stopped at the budget plus one byte, not at the end of a file of twice the budget: ${read.bytes} bytes read`);
    assert.ok(read.bytes > MAX_SOURCE_BYTES, 'and it did read up to the budget (a reader that read nothing would refuse nothing)');
  } finally { fs.fstatSync = orig; removeTree(dir); }
});

// A .mjs that the listing saw as a regular file and that is a link when it is opened (a swap after the listing): the open refuses it (O_NOFOLLOW where the
// platform has it) or the check of the name after the open does, never reading the link's target. The listing is stood in for by a readdir that reports
// the link as a file. The leg needs a file symlink and skips visibly where the account cannot make one.
test('collectScriptsMjs refuses a .mjs that became a link after the listing, never reading the link\'s target', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-env-census-'));
  const origReaddir = fs.readdirSync;
  try {
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'target.mjs'), 'export const x = 1;\n');
    try { fs.symlinkSync(path.join(dir, 'target.mjs'), path.join(dir, 'scripts', 'swapped.mjs'), 'file'); } catch (e) { t.skip(`this account cannot make a file symlink (${e.code})`); return; }
    fs.readdirSync = function (d, o) {
      const list = origReaddir.call(this, d, o);
      return list.map((e) => (e.name === 'swapped.mjs' ? { name: e.name, isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true } : e));
    };
    assert.throws(() => collectScriptsMjs(dir), /scripts\/swapped\.mjs.*(symlink|regular file|changed)/);
  } finally { fs.readdirSync = origReaddir; removeTree(dir); }
});

// The open lands on another regular file than the one the name holds (the entry swapped between the listing and the open, or an open the platform
// redirected): the census compares the descriptor with the name (dev and ino) and refuses before any read. Stood in for by an openSync that opens
// another file for this one name.
test('collectScriptsMjs refuses a .mjs whose open lands on another file than its name holds, never reading the other file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-env-census-'));
  const origOpen = fs.openSync;
  try {
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'scripts', 'named.mjs'), 'export const named = 1;\n');
    fs.writeFileSync(path.join(dir, 'other.mjs'), 'export const other = 1;\n');
    fs.openSync = function (p, ...rest) { return origOpen.call(this, String(p).endsWith('named.mjs') ? path.join(dir, 'other.mjs') : p, ...rest); };
    assert.throws(() => collectScriptsMjs(dir), /scripts\/named\.mjs changed between the listing and the read/);
  } finally { fs.openSync = origOpen; removeTree(dir); }
});
