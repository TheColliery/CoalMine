// CWK-137 -- bounded reads and contained writes on repo-derived paths.
// Zero-dep (node:test + built-ins), per scripts-quality.md section 2.
//
// Capability-gated legs PROBE the capability and skip VISIBLY, one skippable leg per
// test: a file symlink needs Developer Mode/admin on Windows, a FIFO and /dev/zero do
// not exist there. The directory legs use 'junction' (the unprivileged Windows shim;
// the type argument is ignored on POSIX), so the escape and write-through cases run on
// every platform. Every fixture lives under os.tmpdir() and is removed by t.after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFifoWriter } from './test-sandbox.mjs';
import {
  MAX_CONFIG_BYTES, MAX_DOC_BYTES, repoEntryKind, readRepoFileBounded, readRepoBytesBounded,
  checkRepoWriteTarget, writeRepoFile, RepoWriteRefused,
} from './repo-fs.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function tmpDir(t, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cm-repofs-${label}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function canFileSymlink(dir) {
  const probe = path.join(dir, '.probe-link');
  try { fs.symlinkSync(path.join(dir, 'x'), probe, 'file'); fs.unlinkSync(probe); return true; } catch { return false; }
}
function canMkfifo(dir) {
  if (process.platform === 'win32') return false;
  const r = spawnSync('mkfifo', [path.join(dir, '.probe-fifo')]);
  if (r.status !== 0) return false;
  fs.unlinkSync(path.join(dir, '.probe-fifo'));
  return true;
}

test('the hook partial carries the SAME two bounds as repo-fs.mjs (the copy the hooks cannot import)', () => {
  const partial = fs.readFileSync(path.join(repo, 'hooks', '_shared', 'node-config.js'), 'utf8');
  const cfg = partial.match(/const MAX_CONFIG_BYTES = ([^;]+);/);
  const doc = partial.match(/const MAX_DOC_BYTES = ([^;]+);/);
  assert.ok(cfg && doc, 'both constants are declared in hooks/_shared/node-config.js');
  assert.equal(Function(`return ${cfg[1]}`)(), MAX_CONFIG_BYTES);
  assert.equal(Function(`return ${doc[1]}`)(), MAX_DOC_BYTES);
});

test('a regular file is read; over the bound it is SKIPPED, never truncated; prefixOnly samples it', (t) => {
  const dir = tmpDir(t, 'read');
  const f = path.join(dir, 'a.json');
  fs.writeFileSync(f, '0123456789');
  assert.equal(readRepoFileBounded(f, dir, 64), '0123456789');
  assert.equal(readRepoFileBounded(f, dir, 5), null, 'over the bound -> null, not the first 5 bytes');
  assert.equal(readRepoFileBounded(f, dir, 4, true), '0123', 'prefixOnly -> the first maxBytes');
  assert.equal(readRepoFileBounded(path.join(dir, 'absent'), dir, 64), null);
  assert.equal(readRepoFileBounded(dir, dir, 64), null, 'a directory is never read');
  assert.deepEqual(readRepoBytesBounded(f, dir, 64), Buffer.from('0123456789'));
});

test('a read through a junction that ESCAPES the root is refused; one that stays inside is allowed', (t) => {
  const root = tmpDir(t, 'root');
  const outside = tmpDir(t, 'outside');
  fs.writeFileSync(path.join(outside, 'secret.md'), 'OUTSIDE');
  fs.mkdirSync(path.join(root, 'real'));
  fs.writeFileSync(path.join(root, 'real', 'doc.md'), 'INSIDE');
  fs.symlinkSync(outside, path.join(root, 'escape'), 'junction');
  fs.symlinkSync(path.join(root, 'real'), path.join(root, 'inner'), 'junction');
  assert.equal(repoEntryKind(path.join(root, 'escape'), root), null, 'the escaping junction itself is refused');
  assert.equal(readRepoFileBounded(path.join(root, 'escape', 'secret.md'), root, 64), null, 'a file under it is refused');
  assert.equal(readRepoFileBounded(path.join(root, 'inner', 'doc.md'), root, 64), 'INSIDE', 'a contained link is not hostile');
  assert.equal(readRepoFileBounded(path.join(root, 'escape', 'secret.md'), null, 64), 'OUTSIDE', 'root null = no containment (home files)');
});

test('a file symlink escaping the root is refused on read (POSIX, or Windows with symlink privilege)', (t) => {
  const root = tmpDir(t, 'fsl');
  if (!canFileSymlink(root)) { t.skip('file symlinks need privilege on this volume'); return; }
  const outside = tmpDir(t, 'fsl-out');
  fs.writeFileSync(path.join(outside, 'bashrc'), 'export SECRET_TOKEN=abc123\n');
  fs.symlinkSync(path.join(outside, 'bashrc'), path.join(root, 'cfg.json'), 'file');
  assert.equal(readRepoFileBounded(path.join(root, 'cfg.json'), root, MAX_CONFIG_BYTES), null);
});

// INSPECT MEDIUM-1c: "returned quickly" does not prove "never opened" -- an O_NONBLOCK open
// also returns at once. A writer blocked in open(O_WRONLY) unblocks iff the FIFO was opened
// for reading, so its fate is the observation (startFifoWriter, test-sandbox.mjs).
test('a FIFO is skipped BEFORE open -- a blocked writer proves the FIFO was never opened (POSIX)', async (t) => {
  const root = tmpDir(t, 'fifo');
  if (!canMkfifo(root)) { t.skip('no mkfifo on this platform'); return; }
  const fifo = path.join(root, 'AGENTS.md');
  assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
  const { exited } = await startFifoWriter(fifo, path.join(root, '.writer-ready'));
  assert.equal(readRepoFileBounded(fifo, root, MAX_DOC_BYTES), null);
  assert.equal(await exited, 'blocked', 'the FIFO must never be opened -- the writer would have unblocked');
});

test('a link to /dev/zero is refused -- no unbounded read, no allocation (POSIX)', (t) => {
  const root = tmpDir(t, 'zero');
  if (!fs.existsSync('/dev/zero') || !canFileSymlink(root)) { t.skip('no /dev/zero or no file symlinks here'); return; }
  fs.symlinkSync('/dev/zero', path.join(root, 'AGENTS.md'));
  assert.equal(readRepoFileBounded(path.join(root, 'AGENTS.md'), null, MAX_DOC_BYTES), null, 'refused even with no containment');
});

test('writeRepoFile creates and replaces a regular file inside the root', (t) => {
  const root = tmpDir(t, 'write');
  const f = path.join(root, '.claude', 'coal', 'coalmine.json');
  writeRepoFile(f, 'one', root);
  assert.equal(fs.readFileSync(f, 'utf8'), 'one');
  writeRepoFile(f, 'two', root);
  assert.equal(fs.readFileSync(f, 'utf8'), 'two');
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ['coalmine.json'], 'no temp file is left behind');
});

test('writeRepoFile REFUSES a parent junction that escapes the root, and the outside bytes are untouched', (t) => {
  const root = tmpDir(t, 'wjunc');
  const outside = tmpDir(t, 'wjunc-out');
  const victim = path.join(outside, 'copilot-instructions.md');
  fs.writeFileSync(victim, 'export SECRET_TOKEN=abc123\n');
  fs.symlinkSync(outside, path.join(root, '.github'), 'junction');
  const target = path.join(root, '.github', 'copilot-instructions.md');
  assert.match(checkRepoWriteTarget(target, root), /outside/);
  assert.throws(() => writeRepoFile(target, 'PWNED', root), RepoWriteRefused);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'export SECRET_TOKEN=abc123\n', 'the outside file keeps its bytes');
  assert.deepEqual(fs.readdirSync(outside), ['copilot-instructions.md'], 'no temp file lands outside either');
});

test('writeRepoFile REFUSES a target that is itself a symlink (POSIX, or Windows with symlink privilege)', (t) => {
  const root = tmpDir(t, 'wsl');
  if (!canFileSymlink(root)) { t.skip('file symlinks need privilege on this volume'); return; }
  const outside = tmpDir(t, 'wsl-out');
  const victim = path.join(outside, 'bashrc');
  fs.writeFileSync(victim, 'export SECRET_TOKEN=abc123\n');
  const target = path.join(root, 'coalmine.json');
  fs.symlinkSync(victim, target, 'file');
  assert.throws(() => writeRepoFile(target, '{}', root), (e) => e instanceof RepoWriteRefused && /symbolic link/.test(e.message));
  assert.equal(fs.readFileSync(victim, 'utf8'), 'export SECRET_TOKEN=abc123\n');
});

test('writeRepoFile REPLACES a hard-linked target instead of writing through it', (t) => {
  const root = tmpDir(t, 'whard');
  const other = path.join(root, 'other.txt');
  fs.writeFileSync(other, 'KEEP');
  const target = path.join(root, 'target.txt');
  try { fs.linkSync(other, target); } catch { t.skip('hard links unsupported on this volume'); return; }
  writeRepoFile(target, 'NEW', root);
  assert.equal(fs.readFileSync(target, 'utf8'), 'NEW');
  assert.equal(fs.readFileSync(other, 'utf8'), 'KEEP', 'the other name for the old inode keeps its bytes');
});

// Windows refuses a rename over a file another process holds open (measured: the
// installer rewriting `.githooks/pre-commit` while that hook runs). The fault is
// injected by patching fs.renameSync on the shared default export, so it runs on
// every platform.
function withRenameFault(t, code) {
  const orig = fs.renameSync;
  fs.renameSync = () => { throw Object.assign(new Error(`${code}: simulated`), { code }); };
  t.after(() => { fs.renameSync = orig; });
}

test('writeRepoFile falls back to an in-place write when the rename is refused (EPERM) on a plain regular file', (t) => {
  const root = tmpDir(t, 'weperm');
  const target = path.join(root, 'pre-commit');
  fs.writeFileSync(target, 'OLD');
  withRenameFault(t, 'EPERM');
  writeRepoFile(target, 'NEW', root);
  assert.equal(fs.readFileSync(target, 'utf8'), 'NEW');
  assert.deepEqual(fs.readdirSync(root), ['pre-commit'], 'the temp file is cleaned up');
});

test('writeRepoFile does NOT fall back when the refused target is hard-linked -- the other name keeps its bytes', (t) => {
  const root = tmpDir(t, 'wepermh');
  const other = path.join(root, 'other.txt');
  fs.writeFileSync(other, 'KEEP');
  const target = path.join(root, 'target.txt');
  try { fs.linkSync(other, target); } catch { t.skip('hard links unsupported on this volume'); return; }
  withRenameFault(t, 'EPERM');
  assert.throws(() => writeRepoFile(target, 'NEW', root), /EPERM/);
  assert.equal(fs.readFileSync(other, 'utf8'), 'KEEP');
});
