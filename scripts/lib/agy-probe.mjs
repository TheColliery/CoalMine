// Probe whether the agy CLI can run, for the AG plugin tests. Three answers, never two:
//   'absent'  -- the spawn reports ENOENT: agy is not on PATH (on Windows agy.exe, spawned without a shell).
//   'failed'  -- agy is there but did not answer: a timeout, another spawn error, or a non-zero exit. The caller FAILS.
//   'present' -- agy ran and exited 0.
// A timeout is a hang, not an absence: a skip that names the wrong cause hides a broken install.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_PROBE_TIMEOUT_MS = 30000;

// A shell-less spawn runs an .exe, never a .cmd or .bat shim: find one on PATH so the skip reason can name it.
function findShim(command) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = (process.env.PATHEXT || '').split(';').map((e) => e.toLowerCase()).filter((e) => e === '.cmd' || e === '.bat');
  for (const dir of dirs) for (const ext of exts) {
    const p = path.join(dir, command + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// A wrapper, not `spawnSync` passed as a value: the git-env census cannot follow a spawner passed on, and this probe spawns agy, not git.
const runChild = (command, args, opts) => spawnSync(command, args, opts);

export function probeAgy({ command = 'agy', args = ['--version'], timeoutMs = DEFAULT_PROBE_TIMEOUT_MS, spawn = runChild }) {
  const r = spawn(command, args, { encoding: 'utf8', timeout: timeoutMs });
  const shown = [command, ...args].join(' ');
  if (r.error && r.error.code === 'ENOENT') {
    const shim = findShim(command);
    return {
      state: 'absent',
      reason: shim ? `only a .cmd/.bat shim for ${command} is on PATH (${shim}); a shell-less spawn cannot run it` : `${command} is not on PATH`,
    };
  }
  if (r.error) return { state: 'failed', reason: `${shown} did not run: ${r.error.code}` };
  if (r.status !== 0) return { state: 'failed', reason: `${shown} exited ${r.status}: ${(r.stderr || '').trim()}` };
  return { state: 'present', reason: '' };
}
