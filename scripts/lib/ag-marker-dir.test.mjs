// 3.26.1 (c67): the Antigravity conductor checks its marker folder the way the Stop hook does (markers.js ensureMarkerDir).
// Spawns the BUILT copy (plugin/hooks/coalmine-conductor.js) in its Antigravity mode, hermetic per hooks-safety.md §7:
// TEMP/TMP/TMPDIR, HOME and USERPROFILE point at a throwaway root torn down by t.after; the CLAUDE_* keys and COALMINE_DEBUG are cleared.
// The owner and mode legs need POSIX uid and mode bits; on a platform without them they skip visibly, and the positive twin runs everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONDUCTOR = path.join(repo, 'plugin', 'hooks', 'coalmine-conductor.js');
const CLEAR = ['CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_DATA', 'COALMINE_DEBUG'];

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-agmark-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const sb = { root, home: path.join(root, 'home'), tmp: path.join(root, 'tmp'), proj: path.join(root, 'proj') };
  for (const d of [sb.home, sb.tmp, sb.proj]) fs.mkdirSync(d);
  fs.mkdirSync(path.join(sb.proj, '.git')); // anchors findGitRoot inside the sandbox
  return sb;
}

function runAg(sb, session) {
  const env = { ...process.env, TEMP: sb.tmp, TMP: sb.tmp, TMPDIR: sb.tmp, HOME: sb.home, USERPROFILE: sb.home };
  for (const k of CLEAR) delete env[k];
  const input = JSON.stringify({ session_id: session, cwd: sb.proj, hook_event_name: 'PreInvocation' });
  return spawnSync(process.execPath, [CONDUCTOR, 'PreInvocation'], { input, encoding: 'utf8', cwd: sb.proj, env, timeout: 60000 });
}

const markersIn = (dir) => fs.readdirSync(dir).filter((f) => f.startsWith('ag-conductor-') && f.endsWith('.marker'));

test('ag marker dir open to others is refused', (t) => {
  if (typeof process.getuid !== 'function') {
    t.skip('no POSIX uid or mode bits on this platform: the owner and mode check does not apply here');
    return;
  }
  const sb = sandbox(t);
  const dir = path.join(sb.tmp, 'coalmine');
  fs.mkdirSync(dir);
  fs.chmodSync(dir, 0o777);
  if ((fs.statSync(dir).mode & 0o777) !== 0o777) {
    t.skip('this volume does not keep POSIX modes: the open-folder leg is not run');
    return;
  }
  const r = runAg(sb, 'AGOPEN1');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '', 'the conductor emitted into a marker folder open to other users');
  assert.equal(r.stderr, '', 'no stderr (Phoenix #13)');
  assert.equal(markersIn(dir).length, 0, 'a marker was written into the folder open to others');
});

test('ag marker dir owned by us is used', (t) => {
  const sb = sandbox(t);
  const r = runAg(sb, 'AGOWN1');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '', 'no stderr (Phoenix #13)');
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out), ['injectSteps'], 'injectSteps is the only key');
  assert.equal(out.injectSteps.length, 1, 'exactly one injected step');
  assert.equal(markersIn(path.join(sb.tmp, 'coalmine')).length, 1, 'expected one marker in the folder we made');
});

// Another owner cannot be made without root: the uid clause is covered by the same owner check as the open-folder leg, and is not run here.
