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
// The copy keeps a source unless a segment of its path RELATIVE TO THE REPO is in COPY_SKIP (CWK-142 round 2, the worktree case: a repo
// checked out under `.claude/worktrees/<name>` has `.claude` in its absolute path, so an absolute-segment filter copied nothing).
function keepForCopy(repoRoot, src) {
  return !path.relative(repoRoot, src).split(path.sep).some((seg) => COPY_SKIP.has(seg));
}

function copyRepoUnder(parent) {
  const dest = path.join(parent, 'CoalMine');
  fs.cpSync(REPO, dest, { recursive: true, filter: (src) => keepForCopy(REPO, src) });
  return dest;
}

// CWK-142 round 2 (i81 F1): the same folder spelled as a UNC path (\\localhost\<drive>$\<rest>) is on another volume from the repo, so
// path.relative() returns an ABSOLUTE path, and only the isAbsolute half of isInsideThisRepo reads that cwd as outside the repo. Returns
// the UNC spelling of `dir` when this box resolves it, the child takes it as its cwd, and path.relative() from the repo is absolute (the
// branch is reachable); otherwise null. The backslash is built from code point 92, never typed doubled (the Bash tool halves a pair).
function uncCwdOf(dir) {
  const bs = String.fromCharCode(92);
  let real;
  let repoReal;
  try { real = fs.realpathSync.native(dir); repoReal = fs.realpathSync.native(REPO); } catch { return null; }
  const m = /^([A-Za-z]):(.*)$/.exec(real);
  if (!m) return null;
  const unc = bs + bs + 'localhost' + bs + m[1] + '$' + m[2];
  let uncReal;
  try { uncReal = fs.realpathSync.native(unc); } catch { return null; }
  if (!path.isAbsolute(path.relative(repoReal, uncReal))) return null;
  const probe = spawnSync(process.execPath, ['-e', ''], { cwd: unc, encoding: 'utf8', timeout: 120000 });
  return probe.status === 0 ? unc : null;
}

// CWK-142 round 2 (29sg, c152 c): the copy filter reads the path RELATIVE TO THE REPO. A unit check on a repo root that sits under a
// `.claude` folder (a worktree checkout): a source inside the repo is kept, and a skipped segment inside the repo is still dropped.
test('the copy filter keeps a repo source when the repo itself sits under a .claude folder (a worktree checkout)', () => {
  const root = path.join(os.tmpdir(), 'cm-wt', '.claude', 'worktrees', 'w1', 'CoalMine');
  assert.equal(keepForCopy(root, path.join(root, 'scripts', 'install.mjs')), true, 'a source in the repo is kept');
  assert.equal(keepForCopy(root, path.join(root, '.claude', 'rules')), false, 'a skipped segment inside the repo is still dropped');
  assert.equal(keepForCopy(root, path.join(root, '.git')), false, 'the git folder is still dropped');
});

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

// CWK-142 round 2 (i81 F1): the leg that reaches the isAbsolute half. With the cwd spelled as a UNC path, the diverged rule homes in that folder
// must still be the mirror base; without the isAbsolute half the cwd reads as inside the repo and the default compares the bare repo, which
// holds no rule home and PASSes. Skips visibly where the UNC spelling does not resolve or a child cannot take it as its cwd.
test('with no flag, a cwd spelled on another volume (a UNC path), holding the rule homes, is still the mirror base, and divergence there fails', (t) => {
  const base = mkDir(t);
  writeRule(base, ROOTS[0], 'common/rule.md', 'claude copy\n');
  writeRule(base, ROOTS[1], 'common/rule.md', 'agents copy\n');
  const unc = uncCwdOf(base);
  if (unc === null) {
    t.skip('no UNC spelling of this folder resolves here as a cwd on another volume (no admin share, or a child cannot take it)');
    return;
  }
  const copy = copyRepoUnder(mkDir(t));
  const res = runCli(path.join(copy, 'scripts', 'consistency.mjs'), [], unc);
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

// CWK-142 round 2 (29sg, c152 b): the 26b reviewer's witness 3d. A cwd INSIDE the repo (a subfolder), holding one stray rule tree, is not
// "a rule home outside this repo", so the default must not compare that tree alone. Before the fix the subfolder counted as "not this
// repo", the stray tree was compared alone, and the run PASSed over a diverged parent. The fix: "inside this repo" is the test, and the
// default widens to the parent exactly as it does from the repo root.
test('a run from a SUBFOLDER of the repo, holding ONE stray rule tree, still widens to the parent, and a divergence there FAILs', (t) => {
  const parent = mkDir(t);
  writeRule(parent, ROOTS[0], 'common/rule.md', 'claude copy\n');
  writeRule(parent, ROOTS[1], 'common/rule.md', 'agents copy\n');
  const copy = copyRepoUnder(parent);
  const sub = path.join(copy, 'nested');
  fs.mkdirSync(sub);
  writeRule(sub, ROOTS[1], 'stray.md', 'one stray tree, in a subfolder of the repo\n');
  const res = runCli(path.join(copy, 'scripts', 'consistency.mjs'), [], sub);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /DIVERGED/);
  assert.ok(res.stdout.includes(path.resolve(parent)), 'the divergence is checked at the parent, not at the stray subfolder');
  assert.ok(!res.stdout.includes(path.resolve(sub)), 'the subfolder inside the repo is never the mirror base');
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
