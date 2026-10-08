#!/usr/bin/env node
// CoalMine test runner — the canonical node-test gate. Enumerates EVERY node test
// file explicitly and FAILS LOUD on drift in BOTH directions:
//   listed-but-missing — `node --test` silently ignores missing file args (and on
//     Node 24 a missing arg alongside a present one is reinterpreted as a
//     zero-match name filter → the run exits 0 with the test silently dropped);
//   on-disk-but-unlisted — an orphan *.test.mjs would silently never run.
// The local pre-commit/pre-push hooks already guard with `[ -f "$t" ]`; CI passed
// the raw list unguarded, so a renamed/deleted test could green the main gate.
// This is the single guarded source both CI and the hooks can call. Fail-loud CLI
// (not a hook) — mirrors CoalTipple's scripts/test.mjs.
//
// PowerShell parity tests (scripts/lib/*.test.ps1) are run separately by the caller
// (a `pwsh` step in ci.yml / the hooks) — a cross-language runner is out of scope here.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The complete node suite — keep in sync when adding a test (the orphan check
// below fails the gate if you forget).
const TESTS = [
  'scripts/lib/render.test.mjs',
  'scripts/lib/hooks.test.mjs',
  'scripts/lib/install.test.mjs',
  'scripts/lib/configure.test.mjs',
  'scripts/lib/regions.test.mjs',
  'scripts/lib/consistency.test.mjs',
  'scripts/lib/jsonc.test.mjs',
  'scripts/lib/conductor-update.test.mjs',
  'scripts/lib/conductor-config-path.test.mjs',
  'scripts/lib/desc-cap.test.mjs',
  'scripts/lib/dist-changelog.test.mjs',
  'scripts/lib/config-keys.test.mjs',
  'scripts/lib/pointer-check.test.mjs',
  'scripts/lib/config-paths.test.mjs',
  'scripts/lib/claude-ai-trim.test.mjs',
  'scripts/lib/build-claude-ai-zips.test.mjs',
  'scripts/lib/publish-release.test.mjs',
  'scripts/lib/link-check.test.mjs',
  'scripts/lib/repo-fs.test.mjs',
  'scripts/lib/git-env.test.mjs',
  'scripts/lib/git-env-census.test.mjs',
  'scripts/lib/markers.test.mjs',
  'scripts/lib/r14-fixes.test.mjs',
  'scripts/lib/r14-low.test.mjs',
  'scripts/lib/r14-install.test.mjs',
  'scripts/lib/plugin-readme.test.mjs',
  // CWK-199's class: the child spawn plan (heap cap in the env, files serial, a finite per-test clock).
  'scripts/lib/test-spawn.test.mjs',
  // CWK-174 (THE HOUSE SECRET SCAN, SERIES-CANON 'Secret scan'): byte-equal copies of the published-code template's scanner and caller tests.
  'scripts/secret-scan.test.mjs',
  'scripts/secret-gate.test.mjs',
  // CWK-124: the sole-creator release workflow's scripts, pulled byte-identical from the
  // .github overlay (templates/overlay-coal-skill), never edited here.
  'scripts/lib/release-shape.test.mjs',
  'scripts/lib/release-prune.test.mjs',
  'scripts/lib/asset-upload-mode.test.mjs',
  'scripts/release-notes.test.mjs',
  'scripts/verify-release-shape.test.mjs',
  'scripts/decide-upload.test.mjs',
  'scripts/prune-release-zips.test.mjs',
];

// CWK-071: wrapped in main() so a missing/orphan check can `return` and skip the
// spawnSync entirely -- `process.exitCode = 1` alone does not stop execution the
// way `process.exit()` did.
async function main() {
  const missing = TESTS.filter((t) => !fs.existsSync(path.join(repo, t)));
  if (missing.length) {
    console.error(`test runner: ${missing.length} listed test file(s) MISSING — ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const onDisk = [];
  for (const dir of ['scripts', 'scripts/lib']) {
    for (const f of fs.readdirSync(path.join(repo, dir))) if (f.endsWith('.test.mjs')) onDisk.push(`${dir}/${f}`);
  }
  const orphans = onDisk.filter((f) => !TESTS.includes(f));
  if (orphans.length) {
    console.error(`test runner: ${orphans.length} on-disk test(s) NOT in the suite — ${orphans.join(', ')}. Add to scripts/test.mjs.`);
    process.exitCode = 1;
    return;
  }

  // CWK-199's class: the plan lives in scripts/lib/test-spawn.mjs (heap cap in the env, files serial, finite clock).
  // Dynamic and inside the step that needs it, per node/runtime.md section 1 (a gate entry imports node builtins only at the top).
  const { testSpawnPlan } = await import(pathToFileURL(path.join(repo, 'scripts', 'lib', 'test-spawn.mjs')).href);
  const plan = testSpawnPlan(TESTS, process.env);
  const r = spawnSync(process.execPath, plan.args, { cwd: repo, stdio: 'inherit', env: plan.env, timeout: plan.timeout, killSignal: plan.killSignal });
  // 08b INSPECT M-1: a whole-run deadline is a LOUD failure (a named FAIL line, non-zero), never a silent pass or an unbounded wait.
  if (r.error) {
    console.error(`FAIL test runner: the run did not finish (${r.error.code || r.error.message}); the whole-run deadline is ${plan.timeout} ms (scripts/lib/test-spawn.mjs RUN_TIMEOUT_MS)`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = r.status ?? 1;
}

await main();
