// 16e item 4 (CWK2-041): the teardown shape. On Windows a process that outlives its launcher (a git.exe the launcher's timeout killed the parent of, an install.mjs
// the test's own spawn timeout killed) can hold the fixture folder as its working directory, and one plain `fs.rmSync(dir, { recursive: true, force: true })` then
// answers EBUSY, EPERM or ENOTEMPTY: a red that has nothing to do with the code under test. `removeTree` (scripts/lib/test-sandbox.mjs, the CoalWash repo's test-plan
// helper at its v1.12.4) retries ONLY on those held-folder codes, inside a time budget, then throws.
// The class is provoked here with a child whose cwd is inside the tree. POSIX has no such lock (a plain rmSync of a folder another process stands in succeeds),
// so the held legs probe the capability (plain rmSync fails on a held tree) and skip VISIBLY where it cannot be provoked, never by process.platform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { removeTree } from './test-sandbox.mjs';

const HOLDER = 'console.log("ready"); setTimeout(() => {}, Number(process.argv[1]))';

function mkRoot(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-rmtree-'));
  t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* a still-held tree is the test's own concern */ } });
  return root;
}

// A tree with a live child standing in it for `holdMs`; resolves once the child exists. The returned stop() ends it and waits for the exit.
async function heldTree(t, holdMs) {
  const dir = path.join(mkRoot(t), 'held');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sub', 'f.txt'), 'x');
  const child = spawn(process.execPath, ['--max-old-space-size=64', '-e', HOLDER, String(holdMs)], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  await new Promise((resolve, reject) => { child.once('error', reject); child.stdout.once('data', resolve); }); // the child printed: it is running JS, so its cwd handle on the tree exists (the 'spawn' event alone fires before the child initialises, and a removal in that gap succeeds)
  const stop = async () => { child.kill('SIGKILL'); await exited; };
  t.after(stop);
  return { dir, stop, exited };
}

// The capability: does a plain rmSync of a tree a live child holds as its cwd FAIL here? Probed on a throwaway tree, never decided by the platform name.
async function plainRmFailsOnHeld(t) {
  const h = await heldTree(t, 30_000);
  let failed = null;
  try { fs.rmSync(h.dir, { recursive: true, force: true }); } catch (e) { failed = e.code; }
  await h.stop();
  return failed;
}

test('the class: a plain rmSync of a tree a live child holds as its cwd fails (EBUSY, EPERM or ENOTEMPTY); the tree is still there', async (t) => {
  const h = await heldTree(t, 30_000);
  let code = null;
  try { fs.rmSync(h.dir, { recursive: true, force: true }); } catch (e) { code = e.code; }
  if (code === null) { t.skip('a plain rmSync removes a held tree on this volume and platform, so the class cannot be provoked here'); await h.stop(); return; }
  assert.ok(['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(code), `the held-folder code: ${code}`);
  assert.ok(fs.existsSync(h.dir), 'the tree survives the failed removal');
  await h.stop();
});

// A counting rm over the real one, and a fake clock that only the injected sleep advances: the retry count and the budget are observed, never timed.
function counted() {
  const c = { rm: 0, sleeps: 0, clock: 0 };
  return { c, opts: { rm: (d) => { c.rm++; fs.rmSync(d, { recursive: true, force: true }); }, now: () => c.clock, sleep: (ms) => { c.sleeps++; c.clock += ms; } } };
}

test('removeTree clears a held tree once the holder exits: the tree is gone and it retried (the first attempt failed)', async (t) => {
  const held = await plainRmFailsOnHeld(t);
  if (held === null) { t.skip('the class cannot be provoked here (plain rmSync succeeds on a held tree)'); return; }
  const h = await heldTree(t, 1500);
  const { c, opts } = counted();
  removeTree(h.dir, { rm: opts.rm }); // real clock and sleep: the holder exits by itself, the budget is the default
  assert.ok(!fs.existsSync(h.dir), 'the tree is gone');
  assert.ok(c.rm >= 2, `the first attempt hit the held folder and a later one cleared it (${c.rm} attempts)`);
});

test('removeTree is LOUD: a tree still held when the budget is spent throws the held-folder code after budget/poll retries; nothing is dropped', async (t) => {
  const held = await plainRmFailsOnHeld(t);
  if (held === null) { t.skip('the class cannot be provoked here (plain rmSync succeeds on a held tree)'); return; }
  const h = await heldTree(t, 30_000);
  const { c, opts } = counted();
  assert.throws(() => removeTree(h.dir, { budgetMs: 600, pollMs: 50, ...opts }), (e) => ['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(e.code));
  assert.equal(c.sleeps, 12, 'it slept once per poll until the fake clock reached the 600 ms budget');
  assert.equal(c.rm, 13, 'one attempt per poll plus the first and the last');
  assert.ok(fs.existsSync(h.dir), 'the tree is still there: nothing is silently dropped');
});

test('removeTree retries ONLY a held-folder code: any other error is thrown at once, never waited out', () => {
  const { c, opts } = counted();
  assert.throws(() => removeTree(12345, { budgetMs: 5000, pollMs: 50, ...opts }), (e) => e.code === 'ERR_INVALID_ARG_TYPE');
  assert.equal(c.sleeps, 0, 'a non-held error does not enter the retry loop');
  assert.equal(c.rm, 1);
});

test('removeTree retries a held code with a stubbed rm until it clears, then returns (no held tree needed)', () => {
  let left = 3; const c = { sleeps: 0 };
  removeTree('x', { rm: () => { if (left-- > 0) throw Object.assign(new Error('held'), { code: 'EBUSY' }); }, now: () => 0, sleep: () => { c.sleeps++; } });
  assert.equal(c.sleeps, 3, 'three held answers, three sleeps, the fourth attempt cleared');
});

test('removeTree removes an ordinary tree and tolerates a path that is not there', (t) => {
  const root = mkRoot(t);
  const dir = path.join(root, 'plain');
  fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a', 'b', 'f.txt'), 'x');
  removeTree(dir);
  assert.ok(!fs.existsSync(dir));
  removeTree(dir);
});

test('removeTree waits through its DEFAULT sleep between held-folder retries (a lower bound only: a no-op default would spin)', () => {
  let left = 2, calls = 0;
  const t0 = process.hrtime.bigint();
  removeTree('x', { pollMs: 60, rm: () => { calls++; if (left-- > 0) throw Object.assign(new Error('held'), { code: 'EBUSY' }); } });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(calls, 3, 'two held answers, then it cleared');
  assert.ok(ms >= 100, `two polls of 60 ms were really waited (${ms} ms)`); // 100 not 120: leaves room for timer rounding
});
