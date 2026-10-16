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
import { removeTree, TEARDOWN_BUDGET_MS } from './test-sandbox.mjs';

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

test('removeTree clears a held tree once the holder exits, inside the budget', async (t) => {
  const held = await plainRmFailsOnHeld(t);
  if (held === null) { t.skip('the class cannot be provoked here (plain rmSync succeeds on a held tree)'); return; }
  const h = await heldTree(t, 1500);
  const t0 = Date.now();
  removeTree(h.dir);
  const ms = Date.now() - t0;
  assert.ok(!fs.existsSync(h.dir), 'the tree is gone');
  assert.ok(ms >= 500 && ms < TEARDOWN_BUDGET_MS, `it waited for the holder (${ms} ms), not zero and not the whole budget`);
});

test('removeTree is LOUD: a tree still held past the budget throws the held-folder code, near the budget and not before it', async (t) => {
  const held = await plainRmFailsOnHeld(t);
  if (held === null) { t.skip('the class cannot be provoked here (plain rmSync succeeds on a held tree)'); return; }
  const h = await heldTree(t, 30_000);
  const t0 = Date.now();
  assert.throws(() => removeTree(h.dir, { budgetMs: 600, pollMs: 50 }), (e) => ['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(e.code));
  const ms = Date.now() - t0;
  assert.ok(ms >= 550 && ms < 5000, `it kept retrying for the budget (${ms} ms), then threw`);
  assert.ok(fs.existsSync(h.dir), 'the tree is still there: nothing is silently dropped');
});

test('removeTree retries ONLY a held-folder code: any other error is thrown at once, never waited out', () => {
  const t0 = Date.now();
  assert.throws(() => removeTree(12345, { budgetMs: 5000, pollMs: 50 }), (e) => e.code === 'ERR_INVALID_ARG_TYPE');
  assert.ok(Date.now() - t0 < 1000, 'a non-held error does not enter the retry loop');
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
