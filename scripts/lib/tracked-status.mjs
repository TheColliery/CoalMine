// Tracked-ness of one file in its repository, asked of git (BB-533, moved here from install.mjs so configure.mjs and install.mjs share one answer).
// `git ls-files --error-unmatch` is the oracle: exit 0 = tracked, exit 1 = genuinely untracked. ANYTHING ELSE means the question could not be answered,
// and "could not tell" is never read as "untracked" (CWK-096). A git that never answers (a hang, a kill) is cut at 10 s and reads "unknown".
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { gitEnv } from './git-env.mjs';

const TRACKED_PROBE_MS = 10000;

// `file` is absolute; `repoDir` is the work tree the question is asked in.
export function trackedStatus(file, repoDir) {
  const r = spawnSync('git', ['ls-files', '--error-unmatch', file], { cwd: repoDir, env: gitEnv(path.dirname(repoDir)), encoding: 'utf8', timeout: TRACKED_PROBE_MS });
  if (r.error) return 'unknown';
  if (r.status === 0) return 'tracked';
  if (r.status === 1) return 'untracked';
  return 'unknown';
}
