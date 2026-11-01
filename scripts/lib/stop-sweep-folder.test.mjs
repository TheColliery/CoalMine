// The Stop hook's stale-state sweep checks its markers folder first (29l (a)). The sweep reaches into <tmp>/coalmine by name and
// deletes there, so it runs only when that folder passes the owner, type and mode checks the markers use: a folder another
// local account made, or one left open to group or other users, is left alone, and a link at the folder is never followed.
// The normal private folder is still swept. Hermetic: a spawn of the real hook with sandboxed TEMP and HOME and fixture stdin.
// Zero-dep (node:test + built-ins), scripts-quality.md section 2; testing.md Determinism: no clock, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STOP = path.join(repo, 'hooks', 'rot-canary-stop.js');
const DAY = 24 * 60 * 60 * 1000;

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-sweepdir-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  return dir;
}

// The hook reads the session from stdin and sweeps before anything else. The sandbox owns every temp and home variable.
function runStop(tmp) {
  return spawnSync(process.execPath, [STOP], {
    input: JSON.stringify({ session_id: 'SWEEPDIR', stop_hook_active: false }),
    encoding: 'utf8',
    cwd: tmp,
    env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp, USERPROFILE: tmp, HOME: tmp },
    timeout: 60000,
  });
}

// A stale marker from a crashed session: a conductor marker is swept whatever the canary's mode, so it isolates the folder check.
function plantStale(file) {
  fs.writeFileSync(file, '', 'utf8');
  const old = new Date(Date.now() - 99 * DAY);
  fs.utimesSync(file, old, old);
}

test('the Stop hook still sweeps a stale marker in its own folder when the folder is private', (t) => {
  const tmp = sandbox(t);
  const dir = path.join(tmp, 'coalmine');
  fs.mkdirSync(dir, { mode: 0o700 });
  const stale = path.join(dir, 'coalmine-conductor-OLD.marker');
  plantStale(stale);
  const r = runStop(tmp);
  assert.equal(r.status, 0, 'fail-silent: exit 0 (Phoenix #4)');
  assert.equal(r.stdout, '', 'no output (Phoenix #13)');
  assert.ok(!fs.existsSync(stale), 'a stale marker in a private folder is swept');
});

test('the Stop hook deletes nothing in a markers folder left open to group or other users', (t) => {
  if (typeof process.getuid !== 'function') {
    t.skip('POSIX mode bits are not available on this platform: the open-folder leg is not run');
    return;
  }
  const tmp = sandbox(t);
  const dir = path.join(tmp, 'coalmine');
  fs.mkdirSync(dir, { mode: 0o700 });
  fs.chmodSync(dir, 0o777);
  if ((fs.statSync(dir).mode & 0o022) === 0) {
    t.skip('this filesystem does not keep group or other write bits on a folder: the open-folder leg is not run');
    return;
  }
  const stale = path.join(dir, 'coalmine-conductor-OLD.marker');
  plantStale(stale);
  const r = runStop(tmp);
  assert.equal(r.status, 0, 'fail-silent: exit 0 (Phoenix #4)');
  assert.equal(r.stdout, '', 'no output (Phoenix #13)');
  assert.ok(fs.existsSync(stale), 'a stale file in a folder open to other users is not deleted');
});

test('the Stop hook never sweeps through a link at its markers folder', (t) => {
  const tmp = sandbox(t);
  const outside = sandbox(t);
  const stale = path.join(outside, 'coalmine-conductor-OLD.marker');
  plantStale(stale);
  try {
    // junction = the unprivileged dir-link shim on Windows; 'dir' on POSIX.
    fs.symlinkSync(outside, path.join(tmp, 'coalmine'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (e) {
    t.skip(`symlink/junction unavailable (${e.code}) — cannot plant a link at the markers folder`);
    return;
  }
  const r = runStop(tmp);
  assert.equal(r.status, 0, 'fail-silent: exit 0 (Phoenix #4)');
  assert.equal(r.stdout, '', 'no output (Phoenix #13)');
  assert.ok(fs.existsSync(stale), 'nothing is deleted through the link into the folder it points at');
});
