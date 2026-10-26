// CWK-142: the consistency CLI's mirror-base surface. Spawns the REAL scripts/consistency.mjs against temp
// fixtures under os.tmpdir(), never the live umbrella. Zero-dep (node:test + built-ins), per scripts-quality.md §2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'consistency.mjs');
const ROOTS = ['.claude/rules/ecc', '.agents/rules/ecc'];

function mkDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cons-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeRule(base, root, rel, text) {
  const p = path.join(base, root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 120000 });
}

function runCli(cli, args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 120000 });
}

// A copy of this repo's working tree under `parent`. A bare run from inside the copy is how CI and the hooks run it (the
// repo root as cwd), and the copy has a parent the test controls. .git, scratchpad and the agent homes are left out: the test
// plants its own rule trees, and the copy must hold none the test did not plant.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COPY_SKIP = new Set(['.git', 'scratchpad', '.claude', '.agents', 'node_modules']);
function copyRepoUnder(parent) {
  const dest = path.join(parent, 'CoalMine');
  fs.cpSync(REPO, dest, { recursive: true, filter: (src) => !src.split(path.sep).some((seg) => COPY_SKIP.has(seg)) });
  return dest;
}

test('--base at a base whose two rule homes agree passes, and the PASS line names that base', (t) => {
  const base = mkDir(t);
  for (const r of ROOTS) writeRule(base, r, 'common/rule.md', 'same text\n');
  const res = run(['--base', base], mkDir(t));
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /CONSISTENCY: PASS/);
  assert.ok(res.stdout.includes(path.resolve(base)), 'the PASS line names the base actually compared');
});

test('--base at a base whose two rule homes diverge fails and names the diverged file', (t) => {
  const base = mkDir(t);
  writeRule(base, ROOTS[0], 'common/rule.md', 'claude copy\n');
  writeRule(base, ROOTS[1], 'common/rule.md', 'agents copy\n');
  const res = run(['--base', base], mkDir(t));
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /CONSISTENCY: FAIL/);
  assert.match(res.stdout, /rule\.md/);
});

test('--base at a base with NEITHER rule home fails loud, naming the base and the roots it looked for', (t) => {
  const base = mkDir(t);
  const res = run(['--base', base], mkDir(t));
  assert.notEqual(res.status, 0, 'a base with no rule home must never PASS over zero files');
  const out = res.stdout + res.stderr;
  assert.ok(out.includes(path.resolve(base)), 'the failure names the base');
  for (const r of ROOTS) assert.ok(out.includes(r), `the failure names the root it looked for: ${r}`);
});

test('with no flag, a cwd that holds the rule homes is the mirror base, and divergence there fails', (t) => {
  const base = mkDir(t);
  writeRule(base, ROOTS[0], 'common/rule.md', 'claude copy\n');
  writeRule(base, ROOTS[1], 'common/rule.md', 'agents copy\n');
  const res = run([], base);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /rule\.md/);
});

test('the bare default is unchanged: no flag and a cwd with no rule home still PASS, and name no fixture base', (t) => {
  // Pinned to a fixture parent with no rule homes (INSPECT F2): the real repo's parent must not decide this test.
  const copy = copyRepoUnder(mkDir(t));
  const empty = mkDir(t);
  const res = runCli(path.join(copy, 'scripts', 'consistency.mjs'), [], empty);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /CONSISTENCY: PASS/);
  assert.ok(!res.stdout.includes(path.resolve(empty)), 'the default never reports a cwd it did not use');
});

// INSPECT F1 (26b, HIGH): a bare run from the repo root, with the repo holding ONE stray rule tree, must keep the M2 widening of
// resolveMirrorBase. The cwd is the mirror base only when it is NOT this repo. Before the fix this run compared the stray tree
// alone and PASSed over a diverged parent.
test('a bare run from the repo root with ONE stray rule tree still widens to the parent, and a divergence there FAILs', (t) => {
  const parent = mkDir(t);
  writeRule(parent, ROOTS[0], 'common/rule.md', 'claude copy\n');
  writeRule(parent, ROOTS[1], 'common/rule.md', 'agents copy\n');
  const copy = copyRepoUnder(parent);
  writeRule(copy, ROOTS[1], 'stray.md', 'one stray tree, in the repo itself\n');
  const res = runCli(path.join(copy, 'scripts', 'consistency.mjs'), [], copy);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /DIVERGED/);
  assert.ok(res.stdout.includes(path.resolve(parent)), 'the divergence is checked at the parent the M2 ruling widens to');
});

test('-h prints usage to stdout, exits 0, and does no consistency work', (t) => {
  const res = run(['-h'], mkDir(t));
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Usage/);
  assert.match(res.stdout, /--base/);
  assert.ok(!/CONSISTENCY:/.test(res.stdout), 'help does no work: no check verdict is printed');
});

test('an unknown flag exits non-zero with the usage line on stderr', (t) => {
  const res = run(['--bogus'], mkDir(t));
  assert.notEqual(res.status, 0, 'an unknown flag is an error, never ignored');
  assert.match(res.stderr, /Usage/);
});

test('--base with no value exits non-zero with the usage line on stderr', (t) => {
  const res = run(['--base'], mkDir(t));
  assert.notEqual(res.status, 0, '--base needs its directory');
  assert.match(res.stderr, /Usage/);
});
