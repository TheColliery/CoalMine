// Shared spawn-sandbox helper for this room's OWN test files (scripts/lib/*.test.mjs).
// NOT shipped -- outside build-plugin.mjs's copy list, so Phoenix #9's copy-one-file
// rule (which binds a shipped hook, never a dev-only test harness) does not apply: ONE
// shared implementation is correct here, not a per-file duplicate.
//
// r34 findings-back MEDIUM-1/LOW-1 (INSPECT): the prior per-file helpers each built
// their own env-override literal, and install.test.mjs's own harness-proof TEST built
// a THIRD, separate literal that merely agreed with `runInstall`'s by coincidence --
// deleting `env:` from `runInstall` left that probe green, because the probe never
// called `runInstall` at all. Every sandboxed spawn in this room's suite -- the
// installer, the configurator, AND their own harness-proof probes -- now goes through
// THIS one function, so a regression anywhere is a regression the probe can see.
//
// sandboxDir is EXPLICIT and separate from cwd (LOW-1): a test whose SUBJECT is "what
// does the installer do when cwd is the live repo" (the self-pollution guard) still
// needs HOME/TEMP to resolve OUTSIDE that repo -- folding sandboxDir into cwd, as the
// pre-fix per-file helpers did, made that impossible to express for exactly that test.
import { spawnSync } from 'node:child_process';

export function spawnSandboxed(command, args, { cwd, sandboxDir, timeout = 60_000 } = {}) {
  if (!sandboxDir) {
    throw new Error('spawnSandboxed: sandboxDir is required and explicit -- never inferred from cwd');
  }
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, TEMP: sandboxDir, TMP: sandboxDir, TMPDIR: sandboxDir, USERPROFILE: sandboxDir, HOME: sandboxDir },
  });
}
