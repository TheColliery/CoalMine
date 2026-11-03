// 29ao (T-29al-4): the region sync in build-plugin.mjs writes through writeRepoFile, so a link at a sync target is refused and the bytes the
// link points at are left as they were. The witness runs build-plugin.mjs in a COPY of the source tree whose hook carries a stale region
// body (so the sync wants to write it). The capability-free leg reports the target as a link through a child-process preload (lstat), so it
// runs on every volume; the real-link leg probes the capability and skips only on the probe. Zero-dep (node:test + built-ins).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TIMEOUT = 300000;
const STALE = '// STALE-REGION-BODY (29ao witness)';
const HOOK = path.join('hooks', 'rot-canary-stop.js');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-regionlink-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  return dir;
}

// A copy of the parts build-plugin.mjs reads, with the stop hook's first shared region given a stale line inside it.
function copyTree(dir) {
  for (const d of ['scripts', 'hooks', 'skills', 'plugin-src', '.claude-plugin', 'alt']) {
    const from = path.join(repo, d);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, d), { recursive: true });
  }
  const hook = path.join(dir, HOOK);
  const lines = fs.readFileSync(hook, 'utf8').split('\n');
  const open = lines.findIndex((l) => l.includes('<coalmine-shared: markers>'));
  if (open < 0) throw new Error('control: the stop hook carries a markers region');
  lines.splice(open + 1, 0, STALE);
  fs.writeFileSync(hook, lines.join('\n'), 'utf8');
  return hook;
}

function runBuild(dir, preloadUrl) {
  const args = preloadUrl ? ['--import', preloadUrl] : [];
  return spawnSync(process.execPath, [...args, path.join(dir, 'scripts', 'build-plugin.mjs')], {
    cwd: dir, encoding: 'utf8', timeout: TIMEOUT,
    env: { ...process.env, TEMP: dir, TMP: dir, TMPDIR: dir, HOME: dir, USERPROFILE: dir },
  });
}

test('29ao: a sync target that reads as a link is refused by the region sync, and its bytes are left as they were (capability-free)', (t) => {
  const dir = tempDir(t);
  const hook = copyTree(dir);
  const before = fs.readFileSync(hook, 'utf8');
  assert.ok(before.includes(STALE), 'control: the stale line is in the region');
  const pre = path.join(dir, 'link-preload.mjs');
  const target = hook.replace(/\\/g, '/');
  fs.writeFileSync(pre, [
    "import fs from 'node:fs';",
    'const real = fs.lstatSync;',
    'fs.lstatSync = function (p, ...r) {',
    "  if (String(p).replace(/\\\\/g, '/') === " + JSON.stringify(target) + ") return { isSymbolicLink: () => true, isFile: () => false, isDirectory: () => false };",
    '  return real.call(this, p, ...r);',
    '};',
    '',
  ].join('\n'));
  const r = runBuild(dir, pathToFileURL(pre).href);
  assert.match(r.stderr, /hooks[\/]rot-canary-stop.js: region sync failed/, `the region sync refuses the link at the stop hook: ${r.stderr}`);
  assert.equal(fs.readFileSync(hook, 'utf8'), before, 'the sync target keeps its bytes (the stale region line is still there)');
});

test('29ao: a real link at a sync target is refused by the region sync, and what it points at keeps its bytes', (t) => {
  const dir = tempDir(t);
  const probe = path.join(dir, 'probe-target.txt');
  fs.writeFileSync(probe, 'x', 'utf8');
  try { fs.symlinkSync(probe, path.join(dir, 'probe-link.txt'), 'file'); } catch { return t.skip('this volume cannot create a file link without privilege: the real-link leg is not run here'); }
  copyTree(dir);
  const hook = path.join(dir, HOOK);
  const outside = path.join(dir, 'outside-hook.js');
  fs.writeFileSync(outside, 'OUTSIDE-BYTES', 'utf8');
  fs.rmSync(hook);
  fs.symlinkSync(outside, hook, 'file');
  const r = runBuild(dir, null);
  assert.match(r.stderr, /region sync failed/, `the region sync refuses the real link: ${r.stderr}`);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'OUTSIDE-BYTES', 'the file the link points at keeps its bytes');
});
