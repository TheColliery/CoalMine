// Probe whether the agy CLI can run, for the AG plugin tests. Three answers, never two:
//   'absent'  -- the spawn reports ENOENT: agy is not on PATH (on Windows agy.exe, spawned without a shell).
//   'failed'  -- agy is there but did not answer: a timeout, another spawn error, or a non-zero exit. The caller FAILS.
//   'present' -- agy ran and exited 0.
// A timeout is a hang, not an absence: a skip that names the wrong cause hides a broken install.
import { spawnSync } from 'node:child_process';

export function probeAgy({ command = 'agy', args = ['--version'], timeoutMs }) {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: timeoutMs });
  const shown = [command, ...args].join(' ');
  if (r.error && r.error.code === 'ENOENT') return { state: 'absent', reason: `${command} is not on PATH` };
  if (r.error) return { state: 'failed', reason: `${shown} did not run: ${r.error.code}` };
  if (r.status !== 0) return { state: 'failed', reason: `${shown} exited ${r.status}: ${(r.stderr || '').trim()}` };
  return { state: 'present', reason: '' };
}
