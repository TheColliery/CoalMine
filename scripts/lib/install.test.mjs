// CoalMine installer integration tests — node:test built-in, zero dependencies.
// Run: node --test scripts/lib/install.test.mjs
// Covers the manifest-driven clean version transition: renamed/removed skills
// from a previous install never linger, foreign skills are never touched.
//
// r34 ITEM 2, THE RULE (rewritten at findings-back per INSPECT MEDIUM-1/LOW-1): an
// installer test in this file NEVER runs against the operator's real HOME. Every
// sandboxed spawn -- `runInstall` AND its own harness-proof probe below -- goes
// through the ONE shared `spawnSandboxed` helper (scripts/lib/test-sandbox.mjs), so a
// regression in that helper is a regression the probe can see; the pre-fix shape had
// each build a separate env literal, so the probe proved only itself. `sandboxDir` is
// EXPLICIT and separate from `cwd` on every call, defaulting to `cwd` -- a test whose
// SUBJECT is "what happens when cwd is the live repo" (the self-pollution guard,
// below) passes cwd=repo but a SEPARATE throwaway sandboxDir, so HOME/TEMP still never
// resolve into the live tree even though cwd deliberately does. A manual probe of the
// installer (outside this file, by hand) follows the same shape: an explicit fixture
// target and an explicit, separate sandbox dir, never the bare 'claude' keyword
// against a real machine and never cwd doing double duty as the sandbox -- the
// r31/r33/r34 hazard this rule exists to make structural rather than remembered.
//
// round 2, LOW-C: a probe against `spawnSandboxed` proves the HELPER; it cannot see
// `runInstall`'s own wiring to it regress. Two tests below drive the proof through
// `runInstall` itself instead, via a `--require` preload that reports the real
// installer CHILD's os.homedir()/os.tmpdir() (`writeHomeReporter`/`withHomeReporter`,
// scripts/lib/test-sandbox.mjs) -- one generic wrapper-level probe, and the
// self-pollution test's own reporter check covering the LOW-1 call site specifically.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detectPresentAgents } from './targets.mjs';
import { listSkills } from './render.mjs';
import { spawnSandboxed, writeHomeReporter, withHomeReporter } from './test-sandbox.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALL = path.join(repo, 'scripts', 'install.mjs');
const MANIFEST = '.coalmine-manifest.json';
// CWK-120 row 25: install.mjs itself enumerates skills/ with listSkills() and writes
// that dynamic list to the manifest -- a bare `9` here is a SECOND, independent
// enumeration that drifts the moment a canary is added or removed. Derived once,
// shared by every assertion below that counts the manifest's skills.
const SKILL_COUNT = listSkills(path.join(repo, 'skills')).length;

// `targets.mjs`'s `TARGETS.claude = path.join(os.homedir(), '.claude', 'skills')` is a
// module-level constant evaluated at IMPORT time INSIDE the spawned child, reading
// whatever HOME/USERPROFILE that child inherits -- one regression in `all`'s
// ALL_EXCLUDE, or one new test naming 'claude', writes into the real home with no
// signal unless the child's env is sandboxed regardless of what target it resolves.
// `sandboxDir` defaults to `cwd` for every ordinary call (the common case: the fixture
// IS the sandbox); pass it separately only when cwd must be something else (r34 LOW-1).
function runInstall(target, cwd, extra = [], sandboxDir = cwd) {
  return spawnSandboxed(process.execPath, [INSTALL, ...extra, target], { cwd, sandboxDir });
}

// r34 ITEM 2 + findings-back MEDIUM-1 -- proves the SHARED HELPER, not a parallel
// literal: spawns a plain node one-liner through `spawnSandboxed` itself (the exact
// function `runInstall` calls), and asserts the CHILD's own os.homedir()/os.tmpdir()
// resolve inside the sandbox. Deliberately does not spawn `install.mjs` here -- a red
// proof for this property must never risk writing the real home to demonstrate the
// bug; a bare `os` probe writes nothing anywhere, pass or fail. Re-proven red-first by
// deleting the `env:` line from `spawnSandboxed` in `test-sandbox.mjs` itself (never
// from a copy inside this test), in a `git clone` of the committed tree with the
// working-tree edit overlaid on top: this test goes from 17/17 to 16/17, red at
// exactly `os.homedir() must resolve inside the fixture` -- restore the line to return
// to green. This proves the HELPER; it does NOT prove `runInstall`'s own use of it --
// see the wrapper-level probe below (round 2, LOW-C) for that half.
test('the shared sandbox helper resolves os.homedir() and os.tmpdir() inside the fixture, never the real machine', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-sandbox-probe-'));
  try {
    const probe = spawnSandboxed(
      process.execPath,
      ['-e', 'console.log(JSON.stringify({home: require("node:os").homedir(), tmp: require("node:os").tmpdir()}))'],
      { cwd: tmp, sandboxDir: tmp },
    );
    assert.equal(probe.status, 0, probe.stderr);
    const reported = JSON.parse(probe.stdout);
    assert.equal(reported.home, tmp, 'os.homedir() must resolve inside the fixture, never the operator\'s real home');
    assert.equal(reported.tmp, tmp, 'os.tmpdir() must resolve inside the fixture, never the operator\'s real temp dir');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// r34 findings-back round 2 (LOW-C): the probe above proves `spawnSandboxed`; it
// cannot see a regression in `runInstall`'s OWN wiring to that helper (INSPECT
// Mutation B: reverting `runInstall`'s body to a raw `spawnSync` with no env left
// this whole file 17/17 green, because nothing here spawns `install.mjs` through the
// wrapper and checks what the CHILD resolves). This test drives the proof through
// `runInstall` itself, the exact call every other test in this file makes -- a
// `--require` preload reports the real INSTALLER child's os.homedir()/os.tmpdir()
// before install.mjs runs a line of its own code, writing only to stderr.
test('runInstall wires the sandbox through to the CHILD it actually spawns -- proof rides the wrapper, not spawnSandboxed directly', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-wrapprobe-sb-'));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-wrapprobe-tg-'));
  try {
    const reporter = writeHomeReporter(sandbox);
    const r = withHomeReporter(reporter, () => runInstall(target, target, [], sandbox));
    assert.equal(r.status, 0, `install must pass:\n${r.stdout}${r.stderr}`);
    const reported = JSON.parse(r.stderr.trim().split('\n')[0]);
    assert.equal(reported.home, sandbox, 'the real installer CHILD must resolve os.homedir() inside the sandbox `runInstall` was given');
    assert.equal(reported.tmp, sandbox, 'the real installer CHILD must resolve os.tmpdir() inside the same sandbox');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// r34 findings-back round 3 (LOW-D): RE-INSPECT measured that `withHomeReporter`'s
// NODE_OPTIONS build broke under a reporter path containing a space -- exactly what a
// Windows account name with a space in it (e.g. "C:\Users\John Smith\...") produces in
// `os.tmpdir()` for every fixture in this file. This test pins the fix directly against
// that shape: a spaced mkdtemp, no install.mjs involved, no fixture outside
// os.tmpdir(). Goes red on the pre-fix `withHomeReporter` at exactly the assertion the
// reviewer's own measurement named (`MODULE_NOT_FOUND` -> non-zero status).
test('withHomeReporter works when its reporter path contains a space (a real Windows account name)', () => {
  const spaced = fs.mkdtempSync(path.join(os.tmpdir(), 'cm lowd spaced '));
  try {
    const reporter = writeHomeReporter(spaced);
    const r = withHomeReporter(reporter, () =>
      spawnSandboxed(process.execPath, ['-e', 'console.log("ok")'], { cwd: spaced, sandboxDir: spaced }),
    );
    assert.equal(r.status, 0, `child must start despite the space in its reporter's path:\n${r.stdout}${r.stderr}`);
    const reported = JSON.parse(r.stderr.trim().split('\n')[0]);
    assert.equal(reported.home, spaced, 'the reporter must still resolve os.homedir() inside the (spaced) sandbox');
    assert.equal(reported.tmp, spaced, 'the reporter must still resolve os.tmpdir() inside the (spaced) sandbox');
  } finally {
    fs.rmSync(spaced, { recursive: true, force: true });
  }
});

test('manifest-driven reinstall removes renamed leftovers, spares foreign skills', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-install-'));
  const target = path.join(tmp, 'skills');
  try {
    // 1. Fresh install → 9 skills + manifest listing them.
    const first = runInstall(target, tmp);
    assert.equal(first.status, 0, `first install must pass:\n${first.stdout}${first.stderr}`);
    const manifest1 = JSON.parse(fs.readFileSync(path.join(target, MANIFEST), 'utf8'));
    assert.equal(manifest1.skills.length, SKILL_COUNT, `manifest records all ${SKILL_COUNT} skills`);
    assert.ok(manifest1.version, 'manifest records the version');

    // 2. Simulate a pre-rename install: plant a legacy skill dir and list it
    //    in the manifest, plus a foreign skill CoalMine never installed.
    fs.mkdirSync(path.join(target, 'old-renamed-skill'));
    fs.writeFileSync(path.join(target, 'old-renamed-skill', 'SKILL.md'), 'legacy', 'utf8');
    fs.mkdirSync(path.join(target, 'foreign-skill'));
    fs.writeFileSync(path.join(target, 'foreign-skill', 'SKILL.md'), 'not ours', 'utf8');
    manifest1.skills.push('old-renamed-skill');
    fs.writeFileSync(path.join(target, MANIFEST), JSON.stringify(manifest1), 'utf8');

    // 3. Reinstall → legacy dir cleaned via manifest, foreign dir untouched.
    const second = runInstall(target, tmp);
    assert.equal(second.status, 0, `reinstall must pass:\n${second.stdout}${second.stderr}`);
    assert.ok(!fs.existsSync(path.join(target, 'old-renamed-skill')), 'manifest-listed legacy skill removed');
    assert.ok(fs.existsSync(path.join(target, 'foreign-skill', 'SKILL.md')), 'foreign skill must never be touched');
    const manifest2 = JSON.parse(fs.readFileSync(path.join(target, MANIFEST), 'utf8'));
    assert.equal(manifest2.skills.length, SKILL_COUNT, 'new manifest lists only the current set');
    assert.ok(!manifest2.skills.includes('old-renamed-skill'), 'legacy name gone from manifest');

    // 4. Uninstall → manifest-listed skills + manifest gone, foreign survives.
    const un = runInstall(target, tmp, ['--uninstall']);
    assert.equal(un.status, 0, `uninstall must pass:\n${un.stdout}${un.stderr}`);
    assert.ok(!fs.existsSync(path.join(target, 'rot-canary')), 'installed skill removed on uninstall');
    assert.ok(!fs.existsSync(path.join(target, MANIFEST)), 'manifest removed on uninstall');
    assert.ok(fs.existsSync(path.join(target, 'foreign-skill', 'SKILL.md')), 'foreign skill survives uninstall');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('retired skill names are swept even without a manifest (rotcanary -> rot-canary)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-retired-'));
  const target = path.join(tmp, 'skills');
  try {
    // A very old install: the pre-rename `rotcanary` dir is present but is in
    // NEITHER a manifest (none here) NOR the current skill set, plus a foreign skill.
    fs.mkdirSync(path.join(target, 'rotcanary'), { recursive: true });
    fs.writeFileSync(path.join(target, 'rotcanary', 'SKILL.md'), 'name: rotcanary', 'utf8');
    fs.mkdirSync(path.join(target, 'foreign-skill'));
    fs.writeFileSync(path.join(target, 'foreign-skill', 'SKILL.md'), 'not ours', 'utf8');

    const res = runInstall(target, tmp);
    assert.equal(res.status, 0, `install must pass:\n${res.stdout}${res.stderr}`);
    assert.ok(!fs.existsSync(path.join(target, 'rotcanary')), 'retired rotcanary removed without a manifest');
    assert.ok(fs.existsSync(path.join(target, 'rot-canary', 'SKILL.md')), 'current rot-canary installed');
    assert.ok(fs.existsSync(path.join(target, 'foreign-skill', 'SKILL.md')), 'foreign skill never touched');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('H12: install into a dir with a FOREIGN colliding skill dir preserves the user data (never delete-then-write what we do not own)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-h12-'));
  const target = path.join(tmp, 'skills');
  const precious = path.join(target, 'gold-standard', 'precious.txt');
  try {
    // No manifest. A foreign dir shares a CoalMine skill's NAME but holds the user's
    // own file — a blind delete-then-write would destroy it (the H12 root cause).
    fs.mkdirSync(path.join(target, 'gold-standard'), { recursive: true });
    fs.writeFileSync(precious, 'IRREPLACEABLE', 'utf8');

    const res = runInstall(target, tmp);
    assert.notEqual(res.status, 0, 'must fail loud (non-zero) when it refuses a foreign collision');
    assert.match(res.stdout + res.stderr, /refused/i, 'the refusal is reported');
    assert.ok(fs.existsSync(precious), 'foreign user data must survive');
    assert.equal(fs.readFileSync(precious, 'utf8'), 'IRREPLACEABLE', 'foreign data is left byte-untouched');
    assert.ok(!fs.existsSync(path.join(target, 'gold-standard', 'SKILL.md')), 'the refused skill is NOT written over the foreign dir');
    // Only the collision is skipped — the non-colliding skills still install.
    assert.ok(fs.existsSync(path.join(target, 'rot-canary', 'SKILL.md')), 'other skills still install');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('H12: uninstall (no manifest) leaves a FOREIGN colliding dir in place', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-h12un-'));
  const target = path.join(tmp, 'skills');
  const precious = path.join(target, 'gold-standard', 'precious.txt');
  try {
    fs.mkdirSync(path.join(target, 'gold-standard'), { recursive: true });
    fs.writeFileSync(precious, 'IRREPLACEABLE', 'utf8');

    const res = runInstall(target, tmp, ['--uninstall']);
    assert.equal(res.status, 0, `uninstall must pass:\n${res.stdout}${res.stderr}`);
    assert.ok(fs.existsSync(precious), 'foreign user data must survive an uninstall too');
    assert.equal(fs.readFileSync(precious, 'utf8'), 'IRREPLACEABLE');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a colliding dir carrying our own skill-meta.json marker IS replaced (pre-manifest upgrade — the guard is not locked tight)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-premanifest-'));
  const target = path.join(tmp, 'skills');
  try {
    // A pre-manifest CoalMine install: no manifest, but the dir carries OUR marker
    // (skill-meta.json) — so it is owned and must upgrade cleanly, not be refused.
    fs.mkdirSync(path.join(target, 'gold-standard'), { recursive: true });
    fs.writeFileSync(path.join(target, 'gold-standard', 'skill-meta.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(target, 'gold-standard', 'stale.txt'), 'old', 'utf8');

    const res = runInstall(target, tmp);
    assert.equal(res.status, 0, `owned dir must upgrade cleanly:\n${res.stdout}${res.stderr}`);
    assert.ok(fs.existsSync(path.join(target, 'gold-standard', 'SKILL.md')), 'the owned skill is (re)installed');
    assert.ok(!fs.existsSync(path.join(target, 'gold-standard', 'stale.txt')), 'a stale file from the old owned install is cleared');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('corrupt manifest entries can never escape the target directory', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-escape-'));
  const target = path.join(tmp, 'skills');
  const sentinel = path.join(tmp, 'sentinel-dir');
  try {
    const first = runInstall(target, tmp);
    assert.equal(first.status, 0);

    // Sibling dir OUTSIDE the target — a '..' entry would wipe it (and the target).
    fs.mkdirSync(sentinel);
    fs.writeFileSync(path.join(sentinel, 'keep.txt'), 'must survive', 'utf8');

    const manifest = JSON.parse(fs.readFileSync(path.join(target, MANIFEST), 'utf8'));
    manifest.skills = ['..', '.', '../sentinel-dir', tmp, '.coalmine-manifest.json', 'rot-canary'];
    fs.writeFileSync(path.join(target, MANIFEST), JSON.stringify(manifest), 'utf8');

    const second = runInstall(target, tmp);
    assert.equal(second.status, 0, `reinstall with corrupt manifest must still pass:\n${second.stdout}${second.stderr}`);
    assert.ok(fs.existsSync(path.join(sentinel, 'keep.txt')), 'escape via .. must be impossible');
    assert.ok(fs.existsSync(path.join(target, 'rot-canary', 'SKILL.md')), 'valid entries still install');
    const after = JSON.parse(fs.readFileSync(path.join(target, MANIFEST), 'utf8'));
    assert.equal(after.skills.length, SKILL_COUNT, 'manifest rebuilt with the clean current set');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('installer run from the CoalMine source repo does NOT drop a project config anywhere (self-pollution guard)', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-selfpol-'));
  // r34 findings-back round 2, NOTE-3: sandboxDir is its OWN mkdtemp, separate from
  // `target` -- the installer's child TEMP/HOME must not double as the very directory
  // it is installing skills into (a future stray temp write there would sit exactly
  // where cleanPreviousInstall/manifest logic looks, unmeasured today but decoupled
  // for free by giving it a different fixture).
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-selfpol-sb-'));
  const rootCfg = path.join(repo, '.coalmine.json');
  // The new-shape default write target (namespace campaign #69+#39,
  // owner-designated 2026-08-08) — snapshotted too, so a regression that
  // resurrects the self-pollution one level deeper is still caught.
  const newCfg = path.join(repo, '.claude', 'coal', 'coalmine.json');
  // The full installer also rewrites the git hooks from the source copies — into
  // .githooks/ when this clone sets core.hooksPath, else .git/hooks/. Snapshot BOTH
  // configs and the hooks so the test leaves the real repo byte-identical either way.
  const snap = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);
  const restore = (p, buf) => { if (buf === null) { try { fs.rmSync(p, { force: true }); } catch {} } else fs.writeFileSync(p, buf); };
  const cfgBefore = snap(rootCfg);
  const newCfgBefore = snap(newCfg);
  const hookPaths = ['pre-commit', 'pre-push'].flatMap((h) => [
    path.join(repo, '.githooks', h),
    path.join(repo, '.git', 'hooks', h),
  ]);
  const hooksBefore = hookPaths.map(snap);
  try {
    // cwd === repo → copyDefaultConfig must skip the write entirely. r34 LOW-1: cwd
    // MUST be the live repo for this test's own subject, so the sandbox dir is passed
    // SEPARATELY (`sandbox`, its own throwaway fixture -- round 2 NOTE-3, no longer
    // `target`) -- HOME/TEMP resolve there, never into the live tree, even though cwd
    // deliberately does not.
    //
    // round 2, LOW-C Mutation D: reverting to `runInstall(target, repo)` (no explicit
    // sandboxDir) makes `sandboxDir` default back to `cwd` = `repo`, and the reporter
    // below then reports `home === repo` -- this is what makes that regression FAIL
    // rather than pass silently, the way it did before this test carried a reporter.
    const reporter = writeHomeReporter(sandbox);
    const r = withHomeReporter(reporter, () => runInstall(target, repo, [], sandbox));
    assert.equal(r.status, 0, `install from source repo must pass:\n${r.stdout}${r.stderr}`);
    if (cfgBefore === null) {
      assert.ok(!fs.existsSync(rootCfg), 'no .coalmine.json may be created at the source repo root');
    }
    if (newCfgBefore === null) {
      assert.ok(!fs.existsSync(newCfg), 'no config may be created at the new own-dir home either');
    }
    assert.match(r.stdout, /self-pollution|source repo/i, 'the skip is reported');
    const reported = JSON.parse(r.stderr.trim().split('\n')[0]);
    assert.equal(reported.home, sandbox, 'the installer child\'s HOME must be the throwaway sandbox, never the live repo');
    assert.notEqual(reported.home, repo, 'the installer child must never resolve os.homedir() to the source repo it is running from');
  } finally {
    // Leave the real repo exactly as found (both config homes + git hooks).
    restore(rootCfg, cfgBefore);
    restore(newCfg, newCfgBefore);
    hookPaths.forEach((p, i) => restore(p, hooksBefore[i]));
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('installer run from a real project (cwd ≠ source repo) creates the default config at the NEW own-dir home, never the legacy root', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-realproj-'));
  fs.mkdirSync(path.join(proj, '.git')); // a real project repo
  const target = path.join(proj, 'skills');
  try {
    const r = runInstall(target, proj);
    assert.equal(r.status, 0, `install into a real project must pass:\n${r.stdout}${r.stderr}`);
    assert.ok(fs.existsSync(path.join(proj, '.claude', 'coal', 'coalmine.json')), 'a real project still gets its default config (guard must not over-trigger) — at the new own-dir home');
    assert.ok(!fs.existsSync(path.join(proj, '.coalmine.json')), 'a fresh install must not perpetuate the legacy root shape');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('installer run from a real project that ALREADY has a legacy .coalmine.json leaves it alone (existing users are not force-migrated by install)', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-realproj-legacy-'));
  fs.mkdirSync(path.join(proj, '.git'));
  fs.writeFileSync(path.join(proj, '.coalmine.json'), JSON.stringify({ language: 'th' }), 'utf8');
  const target = path.join(proj, 'skills');
  try {
    const r = runInstall(target, proj);
    assert.equal(r.status, 0, `install into a real project must pass:\n${r.stdout}${r.stderr}`);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(proj, '.coalmine.json'), 'utf8')).language, 'th', 'the existing legacy config is left untouched by install (only configure.mjs migrates on write)');
    assert.ok(!fs.existsSync(path.join(proj, '.claude', 'coal', 'coalmine.json')), 'no NEW default is created when one already exists anywhere in the read order');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('installer run from a real project that already has a .gemini/ dir (no .claude) creates the default config UNDER .gemini, never a foreign .claude (INSPECT MEDIUM 2, 2026-08-08)', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-realproj-gemini-'));
  fs.mkdirSync(path.join(proj, '.git'));
  fs.mkdirSync(path.join(proj, '.gemini')); // the project already uses Gemini CLI, never Claude Code
  const target = path.join(proj, 'skills');
  try {
    const r = runInstall(target, proj);
    assert.equal(r.status, 0, `install into a real project must pass:\n${r.stdout}${r.stderr}`);
    assert.ok(fs.existsSync(path.join(proj, '.gemini', 'coal', 'coalmine.json')), 'the default config nests under the agent dir the project ALREADY has');
    assert.ok(!fs.existsSync(path.join(proj, '.claude')), 'no foreign .claude/ is planted into a project that never used Claude Code');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

// A CoalMine hook as it shipped BEFORE v2.4.0 added the `# Generated by CoalMine`
// line — the shape that made the ownership check file our own hook as the user's.
const LEGACY_OWN_HOOK = '#!/bin/sh\n# CoalMine pre-commit hook (Unix)\n# Exit on failure to prevent commit\nexit 0\n';
const FOREIGN_HOOK = '#!/bin/sh\n# my own gate\nexit 0\n';

// A real repo is required: `git config --get` refuses to read local config from a
// hand-made `.git` dir (probed), so the fake-.git idiom used elsewhere cannot set
// core.hooksPath. Capability-probed, never keyed on process.platform.
function gitAvailable() {
  const r = spawnSync('git', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

test('git hooks are installed where git will ACTUALLY read them (core.hooksPath honored)', (t) => {
  if (!gitAvailable()) { t.skip('git binary not available'); return; }
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-hp-plain-'));
  const moved = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-hp-moved-'));
  try {
    // Control: no core.hooksPath → the historical <gitDir>/hooks location.
    assert.equal(spawnSync('git', ['init', '-q', '.'], { cwd: plain }).status, 0);
    const a = runInstall(path.join(plain, 'skills'), plain);
    assert.equal(a.status, 0, `install must pass:\n${a.stdout}${a.stderr}`);
    assert.ok(fs.existsSync(path.join(plain, '.git', 'hooks', 'pre-commit')), 'fallback location still used when core.hooksPath is unset');

    // core.hooksPath set (husky/lefthook/our own .githooks/): git reads ONLY there,
    // so a hook written to .git/hooks is an inert gate under a success message.
    assert.equal(spawnSync('git', ['init', '-q', '.'], { cwd: moved }).status, 0);
    assert.equal(spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: moved }).status, 0);
    const b = runInstall(path.join(moved, 'skills'), moved);
    assert.equal(b.status, 0, `install must pass:\n${b.stdout}${b.stderr}`);
    assert.ok(fs.existsSync(path.join(moved, '.githooks', 'pre-commit')), 'hook lands in the configured core.hooksPath dir');
    assert.ok(fs.existsSync(path.join(moved, '.githooks', 'pre-push')), 'both hooks land there');
    assert.ok(!fs.existsSync(path.join(moved, '.git', 'hooks', 'pre-commit')), 'nothing is written to the dir git ignores');

    // Uninstall reads the same resolution, so it can find what it installed.
    const un = runInstall(path.join(moved, 'skills'), moved, ['--uninstall']);
    assert.equal(un.status, 0, `uninstall must pass:\n${un.stdout}${un.stderr}`);
    assert.ok(!fs.existsSync(path.join(moved, '.githooks', 'pre-commit')), 'uninstall removes the hook from the configured dir');
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
    fs.rmSync(moved, { recursive: true, force: true });
  }
});

test('a pre-v2.4.0 CoalMine hook is recognised as OURS — never backed up as the user\'s, never restored', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-legacy-'));
  const hookPath = path.join(proj, '.git', 'hooks', 'pre-commit');
  try {
    fs.mkdirSync(path.join(proj, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(hookPath, LEGACY_OWN_HOOK, 'utf8');

    const res = runInstall(path.join(proj, 'skills'), proj);
    assert.equal(res.status, 0, `install must pass:\n${res.stdout}${res.stderr}`);
    assert.ok(!fs.existsSync(hookPath + '.pre-coalmine'), 'our own older hook is upgraded in place, not filed as the user\'s');
    assert.match(fs.readFileSync(hookPath, 'utf8'), /scripts\/verify\.mjs/, 'the current hook replaced it');

    const un = runInstall(path.join(proj, 'skills'), proj, ['--uninstall']);
    assert.equal(un.status, 0, `uninstall must pass:\n${un.stdout}${un.stderr}`);
    assert.ok(!fs.existsSync(hookPath), 'uninstall removes our hook');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('a genuinely foreign hook is still backed up and restored (the ownership check is not over-tightened)', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-foreign-'));
  const hookPath = path.join(proj, '.git', 'hooks', 'pre-commit');
  try {
    fs.mkdirSync(path.join(proj, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(hookPath, FOREIGN_HOOK, 'utf8');

    const res = runInstall(path.join(proj, 'skills'), proj);
    assert.equal(res.status, 0, `install must pass:\n${res.stdout}${res.stderr}`);
    assert.equal(fs.readFileSync(hookPath + '.pre-coalmine', 'utf8'), FOREIGN_HOOK, 'the user\'s hook is backed up byte-exact');

    // Backup slot occupied by a DIFFERENT foreign hook → refuse, never destroy it.
    fs.writeFileSync(hookPath, '#!/bin/sh\n# a second gate\nexit 0\n', 'utf8');
    const again = runInstall(path.join(proj, 'skills'), proj);
    assert.notEqual(again.status, 0, 'must fail loud rather than clobber an un-backed-up foreign hook');
    assert.match(again.stdout + again.stderr, /refused to overwrite pre-commit/, 'the refusal is reported');
    assert.match(fs.readFileSync(hookPath, 'utf8'), /a second gate/, 'the second foreign hook survives');

    fs.writeFileSync(hookPath, FOREIGN_HOOK, 'utf8');
    const un = runInstall(path.join(proj, 'skills'), proj, ['--uninstall']);
    assert.equal(un.status, 0, `uninstall must pass:\n${un.stdout}${un.stderr}`);
    assert.equal(fs.readFileSync(hookPath, 'utf8'), FOREIGN_HOOK, 'the user\'s hook is restored');
    assert.ok(!fs.existsSync(hookPath + '.pre-coalmine'), 'the backup is consumed');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('CWK-120 row 4: a failed backup blocks the overwrite -- a foreign hook is never clobbered when it cannot be verified saved', () => {
  // A directory-permission probe (chmod the hooks dir read-only) does NOT reproduce
  // reliably: measured on this box, Windows' read-only DIRECTORY attribute does not
  // block child-file creation, so the probe always reports "not blocked" and the test
  // would only ever run on POSIX -- one platform standing in for three (node/runtime.md
  // §6). A `--require` preload monkeypatching `fs.copyFileSync` (the same NODE_OPTIONS
  // mechanism `withHomeReporter` already uses in this file) is deterministic on every
  // platform, because it never depends on the volume's own permission semantics.
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-backupfail-'));
  const hooksDir = path.join(proj, '.git', 'hooks');
  const hookPath = path.join(hooksDir, 'pre-commit');
  const preloadPath = path.join(proj, 'fail-copy.cjs');
  try {
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(hookPath, FOREIGN_HOOK, 'utf8');
    // Fails ONLY the `.pre-coalmine` backup copy -- every other fs.copyFileSync call
    // the installer makes (skill install, etc.) is untouched, so this isolates the one
    // call site row 4 is about.
    // CWK-137: the backup is now written by content through the contained writer (a temp
    // renamed into place), so the fault is planted on BOTH the old copy and the new rename
    // that land on the `.pre-coalmine` slot -- the property under test is unchanged.
    fs.writeFileSync(
      preloadPath,
      "const fs = require('node:fs'); const fail = () => { throw Object.assign(new Error('EACCES: simulated backup failure'), { code: 'EACCES' }); }; " +
      "const origCopy = fs.copyFileSync; fs.copyFileSync = (src, dest, ...rest) => { if (String(dest).endsWith('.pre-coalmine')) fail(); return origCopy(src, dest, ...rest); }; " +
      "const origRen = fs.renameSync; fs.renameSync = (src, dest) => { if (String(dest).endsWith('.pre-coalmine')) fail(); return origRen(src, dest); };",
      'utf8',
    );

    const slashed = preloadPath.split(path.sep).join('/');
    const prevOpts = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = prevOpts ? `${prevOpts} --require "${slashed}"` : `--require "${slashed}"`;
    let res;
    try {
      res = runInstall(path.join(proj, 'skills'), proj);
    } finally {
      if (prevOpts === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = prevOpts;
    }

    assert.notEqual(res.status, 0, `a backup failure must fail loud (non-zero), not report success:\n${res.stdout}${res.stderr}`);
    assert.equal(fs.readFileSync(hookPath, 'utf8'), FOREIGN_HOOK, 'the foreign hook must survive a failed backup UNCHANGED');
    assert.ok(!fs.existsSync(hookPath + '.pre-coalmine'), 'no backup exists -- the copy itself is what failed');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('CWK-096: a tracked hook (core.hooksPath at a VERSIONED directory) SURVIVES uninstall', (t) => {
  // r33 INSPECT LOW-2: a capability gate degrades to a VISIBLE skip, never a bare
  // `return` -- a bare return counts as a silent PASS, and this is the unit's own
  // headline test. A green run on a git-less box must never read as "the tracked-hook
  // guard is proven" when nothing was exercised.
  if (!gitAvailable()) { t.skip('git binary not available'); return; }
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-tracked-'));
  const hooksDir = path.join(proj, '.githooks');
  const hookPath = path.join(hooksDir, 'pre-commit');
  try {
    assert.equal(spawnSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: proj }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.email', 'test@test.invalid'], { cwd: proj }).status, 0);
    assert.equal(spawnSync('git', ['config', 'user.name', 'Test'], { cwd: proj }).status, 0);
    assert.equal(spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: proj }).status, 0);
    assert.equal(spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: proj }).status, 0);

    const install = runInstall(path.join(proj, 'skills'), proj);
    assert.equal(install.status, 0, `install must pass:\n${install.stdout}${install.stderr}`);
    assert.ok(fs.existsSync(hookPath), 'the hook was installed into the configured (tracked) dir');

    // Commit it — this is now the repo maintainer's TRACKED file, not a CoalMine leftover.
    assert.equal(spawnSync('git', ['add', '-A'], { cwd: proj }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-q', '-m', 'track the hooks'], { cwd: proj }).status, 0);
    assert.equal(spawnSync('git', ['ls-files', '--error-unmatch', hookPath], { cwd: proj }).status, 0, 'fixture sanity: git itself confirms the hook is tracked');

    const un = runInstall(path.join(proj, 'skills'), proj, ['--uninstall']);
    // THE PROPERTY, not the exit code alone (the order's own rail): the file is
    // still there. Asserted FIRST — a caller reading this test top-to-bottom sees
    // the deliverable before the supporting signal.
    assert.ok(fs.existsSync(hookPath), 'CWK-096: a tracked hook survives uninstall — CoalMine never deletes tracked files');
    assert.equal(fs.readFileSync(hookPath, 'utf8').includes('CoalMine'), true, 'and it is untouched, not silently replaced with something else');
    assert.notEqual(un.status, 0, 'the refusal is loud: uninstall exits non-zero rather than reporting quiet success');
    assert.match(un.stdout + un.stderr, /\[refused\] pre-commit: core\.hooksPath points at a versioned directory/, 'the refusal names the file and the reason');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('detectPresentAgents: only agents whose marker dir exists; claude/cline never auto-detected', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-detect-'));
  try {
    fs.mkdirSync(path.join(tmp, '.cursor'));
    fs.mkdirSync(path.join(tmp, '.github'));
    fs.mkdirSync(path.join(tmp, '.claude')); // present, but excluded from `all`
    const { present, absent } = detectPresentAgents(tmp);

    assert.ok(present.includes('cursor'), 'cursor present (.cursor exists)');
    assert.ok(present.includes('copilot'), 'copilot present (.github exists)');
    assert.ok(absent.includes('windsurf'), 'windsurf absent (no .windsurf)');
    assert.ok(absent.includes('gemini'), 'gemini absent (no .gemini)');
    assert.ok(absent.includes('antigravity'), 'antigravity absent (no .agents)');

    // The .claude-rooted agents are never auto-seeded — ambiguous with a global
    // or Claude Code plugin install — even though .claude/ exists here.
    for (const k of ['claude', 'cline']) {
      assert.ok(!present.includes(k) && !absent.includes(k), `${k} excluded from 'all'`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("`all` installs to every present agent dir, skips absent, never auto-seeds .claude", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-all-'));
  try {
    // Three present agent homes (cursor, copilot, the shared .agents group) and
    // a present-but-excluded .claude.
    fs.mkdirSync(path.join(tmp, '.cursor'));
    fs.mkdirSync(path.join(tmp, '.github'));
    fs.mkdirSync(path.join(tmp, '.agents'));
    fs.mkdirSync(path.join(tmp, '.claude'));

    const res = runInstall('all', tmp);
    assert.equal(res.status, 0, `'all' must pass:\n${res.stdout}${res.stderr}`);

    // Installed into each present agent's own dir.
    assert.ok(fs.existsSync(path.join(tmp, '.cursor', 'skills', 'rot-canary', 'SKILL.md')), 'cursor skills installed');
    assert.ok(fs.existsSync(path.join(tmp, '.github', 'skills', 'rot-canary', 'SKILL.md')), 'copilot skills installed');
    assert.ok(fs.existsSync(path.join(tmp, '.agents', 'skills', 'rot-canary', 'SKILL.md')), '.agents group skills installed');

    // Absent agents get nothing; excluded .claude is never auto-seeded.
    assert.ok(!fs.existsSync(path.join(tmp, '.windsurf')), 'absent windsurf untouched');
    assert.ok(!fs.existsSync(path.join(tmp, '.gemini')), 'absent gemini untouched');
    assert.ok(!fs.existsSync(path.join(tmp, '.claude', 'skills')), '.claude never auto-seeded by all');

    assert.match(res.stdout, /detected:/, "reports what it detected");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ─── CWK-137: the installer never writes through a repo-planted link ─────────────────
// A cloned repository can plant `.github -> <anywhere>` (a junction, unprivileged on
// Windows) or `.github/copilot-instructions.md -> ~/.bashrc` (a file symlink). On 59ee1e7
// the installer APPENDED its trigger block to the link target and reported success
// (PoC-2). The property asserted is the BYTES of the outside file, never only the exit.
function canFileSymlink(dir) {
  const probe = path.join(dir, '.probe-link');
  try { fs.symlinkSync(path.join(dir, 'x'), probe, 'file'); fs.unlinkSync(probe); return true; } catch { return false; }
}

test('CWK-137: a .github junction escaping the project is REFUSED loudly -- the outside file keeps its bytes', (t) => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-junc-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-junc-out-'));
  t.after(() => { fs.rmSync(proj, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  const SECRET = 'export SECRET_TOKEN=abc123\n';
  fs.writeFileSync(path.join(outside, 'copilot-instructions.md'), SECRET);
  fs.symlinkSync(outside, path.join(proj, '.github'), 'junction');
  const res = runInstall('copilot', proj);
  assert.notEqual(res.status, 0, `a refused write must fail loud:\n${res.stdout}${res.stderr}`);
  assert.match(res.stdout + res.stderr, /\[refused\]/);
  assert.equal(fs.readFileSync(path.join(outside, 'copilot-instructions.md'), 'utf8'), SECRET, 'the outside file is untouched');
  assert.deepEqual(fs.readdirSync(outside), ['copilot-instructions.md'], 'nothing (skills, manifest, temp) was written outside');
});

test('CWK-137: a copilot-instructions.md symlink to a home dotfile is REFUSED -- the dotfile keeps its bytes (POSIX, or privileged Windows)', (t) => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-fsl-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-fsl-home-'));
  t.after(() => { fs.rmSync(proj, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });
  if (!canFileSymlink(proj)) { t.skip('file symlinks need privilege on this volume'); return; }
  const SECRET = 'export SECRET_TOKEN=abc123\n';
  const bashrc = path.join(home, '.bashrc');
  fs.writeFileSync(bashrc, SECRET);
  fs.mkdirSync(path.join(proj, '.github'));
  fs.symlinkSync(bashrc, path.join(proj, '.github', 'copilot-instructions.md'), 'file');
  const res = runInstall('copilot', proj);
  assert.notEqual(res.status, 0, `a refused write must fail loud:\n${res.stdout}${res.stderr}`);
  assert.equal(fs.readFileSync(bashrc, 'utf8'), SECRET, 'the fake ~/.bashrc is untouched');
});
