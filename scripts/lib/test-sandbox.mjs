// Shared spawn-sandbox helper for this room's OWN test files (scripts/lib/*.test.mjs).
// NOT shipped -- outside build-plugin.mjs's copy list, so Phoenix #9's copy-one-file
// rule (which binds a shipped hook, never a dev-only test harness) does not apply: ONE
// shared implementation is correct here, not a per-file duplicate.
//
// r34 findings-back MEDIUM-1/LOW-1 (INSPECT): the prior per-file helpers each built
// their own env-override literal, and install.test.mjs's own harness-proof TEST built
// a THIRD, separate literal that merely agreed with `runInstall`'s by coincidence --
// deleting `env:` from `runInstall` left that probe green, because the probe never
// called `runInstall` at all. install.test.mjs's `runInstall` and configure.test.mjs's
// `runConfigure` -- and their own harness-proof probes -- now go through THIS one
// function, so a regression in either helper is a regression a probe can see.
//
// SCOPE, named rather than implied (round 2 LOW-B): three OTHER sandboxed spawns in
// this room's suite still build their own env literal and do NOT go through this
// function -- hooks.test.mjs:33, hooks.test.mjs:1616, and conductor-update.test.mjs:39.
// Each spawns a different entry file (a hook, not install.mjs/configure.mjs) with its
// own fixture shape (a stdin payload, a pre-created unwritable path); migrating them is
// not asked for and is not done here. A change to THEIR literals is caught by nothing
// in this file -- only install.test.mjs and configure.test.mjs share this helper.
//
// sandboxDir is EXPLICIT and separate from cwd (LOW-1): a test whose SUBJECT is "what
// does the installer do when cwd is the live repo" (the self-pollution guard) still
// needs HOME/TEMP to resolve OUTSIDE that repo -- folding sandboxDir into cwd, as the
// pre-fix per-file helpers did, made that impossible to express for exactly that test.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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

// r34 findings-back round 2 (LOW-C): MEDIUM-1's probes prove `spawnSandboxed` itself,
// never the WRAPPER's own use of it -- `runInstall`/`runConfigure` reverting to a raw
// `spawnSync` with no env stays fully green under those probes (INSPECT Mutations
// B/C/D), because the probe never spawns through the wrapper at all. These two
// helpers let a caller drive the proof through the ACTUAL wrapper call instead: write a
// tiny `--require` preload that reports the CHILD's own os.homedir()/os.tmpdir() to
// stderr before the wrapper's target script (install.mjs/configure.mjs) runs one line
// of its own code, then read that report back. Nothing is written outside `dir`.
export function writeHomeReporter(dir) {
  const reporterPath = path.join(dir, 'home-reporter.cjs');
  fs.writeFileSync(
    reporterPath,
    "const os = require('node:os'); console.error(JSON.stringify({ home: os.homedir(), tmp: os.tmpdir() }));",
    'utf8',
  );
  return reporterPath;
}

// Runs `fn` with NODE_OPTIONS carrying `--require <reporterPath>` for the DURATION of
// the call only -- restored (or deleted) in `finally`, never left mutated for a later
// test in the same process. `fn` is expected to make exactly one wrapper call
// (runInstall/runConfigure); `spawnSandboxed` spreads `process.env` at call time, so the
// temporary NODE_OPTIONS reaches the child exactly like every other inherited var.
export function withHomeReporter(reporterPath, fn) {
  const prev = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = prev ? `${prev} --require ${reporterPath}` : `--require ${reporterPath}`;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = prev;
  }
}
