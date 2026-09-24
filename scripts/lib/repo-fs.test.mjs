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

test('the hooks carry the SAME two bounds as repo-fs.mjs (the copy the hooks cannot import)', () => {
  // MAX_CONFIG_BYTES lives in the shared partial (every hook reads a config); MAX_DOC_BYTES
  // lives in the conductor only, its one reader (CodeQL #70-#73 -- the partial made the stop
  // and touch hooks carry it unused).
  const partial = fs.readFileSync(path.join(repo, 'hooks', '_shared', 'node-config.js'), 'utf8');
  const conductor = fs.readFileSync(path.join(repo, 'hooks', 'coalmine-conductor.js'), 'utf8');
  const cfg = partial.match(/const MAX_CONFIG_BYTES = ([^;]+);/);
  const doc = conductor.match(/const MAX_DOC_BYTES = ([^;]+);/);
  assert.ok(cfg, 'MAX_CONFIG_BYTES is declared in hooks/_shared/node-config.js');
  assert.ok(doc, 'MAX_DOC_BYTES is declared in hooks/coalmine-conductor.js');
  assert.ok(!/const MAX_DOC_BYTES/.test(partial), 'MAX_DOC_BYTES is NOT in the shared partial any more');
  for (const hook of ['rot-canary-stop.js', 'rot-canary-touch.js']) {
    assert.ok(!/const MAX_DOC_BYTES/.test(fs.readFileSync(path.join(repo, 'hooks', hook), 'utf8')), `${hook} declares no MAX_DOC_BYTES`);
  }
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

// CWK-137 carry-over, CodeQL #69 (js/file-system-race): the EPERM fallback's check must
// bind to the thing it writes. The attacker here swaps the target for a symlink to a victim
// IMMEDIATELY AFTER the implementation's check step -- whichever of lstatSync (the old
// path check) or openSync (the fd check) it calls first on the target. Against the old
// path check the write follows the link (RED, measured before the fix); against the fd
// check the write lands in the inode that was checked, never the victim.
test('writeRepoFile EPERM fallback: a link swapped in right after the check never redirects the write (POSIX, or privileged Windows)', (t) => {
  const root = tmpDir(t, 'wrace');
  if (!canFileSymlink(root)) { t.skip('file symlinks need privilege on this volume'); return; }
  const outside = tmpDir(t, 'wrace-out');
  const victim = path.join(outside, 'bashrc');
  fs.writeFileSync(victim, 'export SECRET_TOKEN=abc123\n');
  const target = path.join(root, 'pre-commit');
  fs.writeFileSync(target, 'OLD');
  withRenameFault(t, 'EPERM');
  let swapped = false;
  const swap = () => { if (!swapped) { swapped = true; fs.unlinkSync(target); fs.symlinkSync(victim, target, 'file'); } };
  const origLstat = fs.lstatSync;
  const origOpen = fs.openSync;
  let armed = false; // arm only after the pre-rename containment check has run
  fs.lstatSync = (p, ...rest) => { const r = origLstat(p, ...rest); if (armed && String(p) === target) swap(); return r; };
  fs.openSync = (p, ...rest) => { const r = origOpen(p, ...rest); if (armed && String(p) === target) swap(); return r; };
  const origRename = fs.renameSync; // withRenameFault already replaced it; arm inside it
  fs.renameSync = (...a) => { armed = true; return origRename(...a); };
  t.after(() => { fs.lstatSync = origLstat; fs.openSync = origOpen; });
  try { writeRepoFile(target, 'PWNED', root); } catch { /* refusing is also safe */ }
  assert.equal(fs.readFileSync(victim, 'utf8'), 'export SECRET_TOKEN=abc123\n', 'the victim behind the swapped-in link keeps its bytes');
});

// R8 INSPECT MEDIUM-1: the race above swaps AFTER the fallback's open returned, so it pins
// "check the fd, not the path" and nothing else. This one swaps INSIDE the refused rename,
// BEFORE the fallback's open -- the window only O_NOFOLLOW closes. With O_NOFOLLOW removed
// the open follows the link, fstat sees the victim (a single-link regular file) and the
// write lands in it (RED, measured). Skips where file symlinks need privilege, and on a
// platform with no O_NOFOLLOW (the named Windows residual, which this test would fail).
test('writeRepoFile EPERM fallback: a link planted BEFORE the fallback opens (inside the refused rename) is never followed', (t) => {
  const root = tmpDir(t, 'wpre');
  if (!fs.constants.O_NOFOLLOW) { t.skip('no O_NOFOLLOW on this platform (the named Windows residual)'); return; }
  if (!canFileSymlink(root)) { t.skip('file symlinks need privilege on this volume'); return; }
  const outside = tmpDir(t, 'wpre-out');
  const victim = path.join(outside, 'bashrc');
  fs.writeFileSync(victim, 'export SECRET_TOKEN=abc123\n');
  const target = path.join(root, 'pre-commit');
  fs.writeFileSync(target, 'OLD');
  const orig = fs.renameSync;
  fs.renameSync = () => {
    fs.unlinkSync(target);
    fs.symlinkSync(victim, target, 'file');
    throw Object.assign(new Error('EPERM: simulated'), { code: 'EPERM' });
  };
  t.after(() => { fs.renameSync = orig; });
  assert.throws(() => writeRepoFile(target, 'PWNED', root), (e) => e.code === 'EPERM', 'the refused rename is rethrown, not papered over');
  assert.equal(fs.readFileSync(victim, 'utf8'), 'export SECRET_TOKEN=abc123\n', 'the victim behind the pre-planted link keeps its bytes');
});

// R8 INSPECT LOW-1: a FIFO planted in the same window. An O_WRONLY open of a FIFO with no
// reader BLOCKS until one appears, and the fstat that rejects it runs only after the open
// returns -- so without O_NONBLOCK the installer hangs forever. The write runs in a CHILD
// with a timeout, so the red (a hang) is a failed assertion, never a hung suite. With
// O_NONBLOCK the open fails ENXIO at once and the original EPERM is rethrown.
test('writeRepoFile EPERM fallback: a FIFO planted before the fallback opens fails fast, never hangs', (t) => {
  const root = tmpDir(t, 'wfifo');
  if (!fs.constants.O_NONBLOCK) { t.skip('no O_NONBLOCK on this platform'); return; }
  if (!canMkfifo(root)) { t.skip('mkfifo unavailable on this volume'); return; }
  const target = path.join(root, 'pre-commit');
  fs.writeFileSync(target, 'OLD');
  const child = [
    "import fs from 'node:fs';",
    "import { spawnSync } from 'node:child_process';",
    'const { writeRepoFile } = await import(process.env.CM_REPOFS_URL);',
    'const target = process.env.CM_TARGET;',
    'fs.renameSync = () => {',
    '  fs.unlinkSync(target);',
    "  if (spawnSync('mkfifo', [target]).status !== 0) throw new Error('mkfifo failed');",
    "  throw Object.assign(new Error('EPERM: simulated'), { code: 'EPERM' });",
    '};',
    "try { writeRepoFile(target, 'NEW', process.env.CM_ROOT); console.log('wrote'); }",
    "catch (e) { console.log('threw ' + e.code); }",
  ].join('\n');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', child], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      CM_REPOFS_URL: new URL('./repo-fs.mjs', import.meta.url).href,
      CM_TARGET: target,
      CM_ROOT: root,
    },
  });
  assert.equal(r.error?.code, undefined, 'the fallback must not block on the FIFO (the child was killed by its timeout)');
  assert.equal(r.stdout.trim(), 'threw EPERM', `the refused rename is rethrown (stderr: ${r.stderr.trim()})`);
  assert.ok(fs.lstatSync(target).isFIFO(), 'nothing replaced the FIFO');
});
