// Integration tests for scripts/configure.mjs — the .coalmine.json configurator CLI.
// Zero-dep (node:test + built-ins), per scripts-quality.md section 2.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_SCHEMA } from './config-schema.mjs';
import { spawnSandboxed, writeHomeReporter, withHomeReporter } from './test-sandbox.mjs';

const CONFIGURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'configure.mjs');

function freshProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cfg-'));
  fs.mkdirSync(path.join(dir, '.git')); // findGitRoot anchor
  return dir;
}

// r34 ITEM 2, rewritten at findings-back (INSPECT MEDIUM-1) -- an installer/
// configurator test NEVER runs against the operator's real HOME. Every CONFIGURE
// spawn below goes through the ONE shared `spawnSandboxed` helper (scripts/lib/
// test-sandbox.mjs) -- the same function install.test.mjs's `runInstall` calls -- so
// a regression in that helper is caught by BOTH files' own harness-proof probes, not
// by a per-file literal that merely agreed with it. Nothing in configure.mjs's
// non-`--global` path reads os.homedir() TODAY, but the property this room wants is
// structural, not "safe because nothing currently resolves there".
function runConfigure(args, cwd) {
  return spawnSandboxed(process.execPath, [CONFIGURE, ...args], { cwd, sandboxDir: cwd });
}

// The read order (namespace campaign #69+#39, owner-designated 2026-08-08):
// own-dir (.claude/coal/coalmine.json) is where a never-configured project's
// config lands, and where a config found at the LEGACY root dotfile migrates
// TO on the next configure.mjs write.
const NEW_REL = path.join('.claude', 'coal', 'coalmine.json');
const LEGACY_REL = '.coalmine.json';

test('configure writes values, migrates legacy/retired keys, and MOVES a legacy-location config to the new own-dir home', () => {
  const dir = freshProject();
  try {
    fs.writeFileSync(path.join(dir, LEGACY_REL),
      JSON.stringify({ disable: ['rot-canary'], conductor: false, tempSweepProbability: 0.5 }), 'utf8');
    const r = runConfigure(['--language', 'th'], dir);
    assert.strictEqual(r.status, 0, r.stderr);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, NEW_REL), 'utf8'));
    assert.strictEqual(cfg.language, 'th');
    assert.deepStrictEqual(cfg.disabledCanaries, ['rot-canary']); // legacy disable → disabledCanaries
    assert.strictEqual(cfg.enableConductor, false);               // legacy conductor → enableConductor
    assert.ok(!('disable' in cfg) && !('conductor' in cfg) && !('tempSweepProbability' in cfg),
      'legacy and retired keys must be removed');
    // move-on-CONFIG-WRITE-only (no-old-version-leftover): the legacy file is
    // gone once the new home holds the migrated config.
    assert.ok(!fs.existsSync(path.join(dir, LEGACY_REL)), 'the legacy root config is removed after the migrating write');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// UMB-133: the nested legacy shape is a READ candidate, so the CLI writer must see it too — a
// writer that did not would write a fresh canonical file that then SHADOWS it, silently
// dropping every setting the user had. Found -> merged into -> migrated -> old file removed.
// (HOME is a SEPARATE sandbox here: runConfigure() folds HOME into the project dir, and at
// project == home the nested path IS the global config — that case is the next test.)
test('UMB-133 configure finds a config at <root>/.claude/.coalmine.json, keeps its settings, and MOVES it to the canonical home', (t) => {
  const dir = freshProject();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cfg-home-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); });
  const nested = path.join(dir, '.claude', '.coalmine.json');
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.writeFileSync(nested, JSON.stringify({ skipOnboarding: true, updateCheckDays: 30 }), 'utf8');
  const r = spawnSandboxed(process.execPath, [CONFIGURE, '--language', 'th'], { cwd: dir, sandboxDir: home });
  assert.strictEqual(r.status, 0, r.stderr);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, NEW_REL), 'utf8'));
  assert.strictEqual(cfg.language, 'th', 'the requested change is applied');
  assert.strictEqual(cfg.skipOnboarding, true, 'the user\'s existing settings SURVIVE the migration (not shadowed by a fresh file)');
  assert.strictEqual(cfg.updateCheckDays, 30);
  assert.ok(!fs.existsSync(nested), 'the nested legacy file is removed once the canonical home holds the migrated config');
  assert.match(r.stdout, /Migrated the project config from .*\.coalmine\.json to /);
});

// The destructive edge the guard exists for: at project == home the nested path is the GLOBAL
// config, and the migration is move + DELETE. Here runConfigure() puts HOME on the project dir,
// which is exactly that layout.
test('UMB-133 configure at project == home never migrates the GLOBAL config out from under the hooks', (t) => {
  const dir = freshProject(); // HOME == this dir under runConfigure()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const global = path.join(dir, '.claude', '.coalmine.json');
  fs.mkdirSync(path.dirname(global), { recursive: true });
  fs.writeFileSync(global, JSON.stringify({ updateMode: 'off' }), 'utf8');
  const r = runConfigure(['--language', 'th'], dir);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(global), 'the global config file is still exactly where the hooks read it');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(global, 'utf8')), { updateMode: 'off' }, 'and untouched');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, NEW_REL), 'utf8')).language, 'th', 'the project write landed at the canonical home instead');
});

test('configure fails loud (exit 1) when the existing legacy config is malformed, backs it up NEXT TO where it was found, migrates the rebuild, and still removes the legacy file', () => {
  const dir = freshProject();
  try {
    // A truly unparseable config (a bare word, not JSON, no rescuable comments).
    fs.writeFileSync(path.join(dir, LEGACY_REL), 'this is not json at all', 'utf8');
    const r = runConfigure(['--language', 'en'], dir);
    // scripts-quality §1: a malformed config silently overwritten is a partial failure → non-zero exit.
    assert.strictEqual(r.status, 1, 'a malformed existing config must fail loud (exit 1)');
    assert.match(r.stderr + r.stdout, /malformed/i, 'the user is warned the config was malformed');
    // The run still completes the requested write (rebuilt from defaults), migrated to the new home.
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, NEW_REL), 'utf8'));
    assert.strictEqual(cfg.language, 'en', 'the requested change is still applied on a rebuild');
    // The backup sits next to where the malformed file was actually found (the legacy root).
    assert.ok(fs.existsSync(path.join(dir, LEGACY_REL + '.bak')), 'the malformed config is backed up, never lost');
    assert.strictEqual(fs.readFileSync(path.join(dir, LEGACY_REL + '.bak'), 'utf8'), 'this is not json at all');
    // The plain (non-.bak) legacy file is still removed once the rebuilt config lands at the new home.
    assert.ok(!fs.existsSync(path.join(dir, LEGACY_REL)), 'the legacy root config itself is gone after migration, only the .bak remains');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('configure migrating a LEGACY config in a project that already has .agents/ (no .claude) lands the migration at .agents, never a foreign .claude (INSPECT MEDIUM 2, 2026-08-08)', () => {
  const dir = freshProject();
  try {
    fs.mkdirSync(path.join(dir, '.agents')); // the project already uses this agent dir, never Claude Code
    fs.writeFileSync(path.join(dir, LEGACY_REL), JSON.stringify({ language: 'en' }), 'utf8');
    const r = runConfigure(['--language', 'th'], dir);
    assert.strictEqual(r.status, 0, r.stderr);
    const migrated = path.join(dir, '.agents', 'coal', 'coalmine.json');
    assert.ok(fs.existsSync(migrated), 'the legacy config migrates under the agent dir the project ALREADY has');
    assert.strictEqual(JSON.parse(fs.readFileSync(migrated, 'utf8')).language, 'th');
    assert.ok(!fs.existsSync(path.join(dir, NEW_REL)), 'no foreign .claude/ is planted into a project that only ever used .agents');
    assert.ok(!fs.existsSync(path.join(dir, LEGACY_REL)), 'the legacy root config is removed after the migrating write');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('configure found at another new-shape candidate (.agents) writes back THERE, never force-migrated to .claude', () => {
  const dir = freshProject();
  try {
    fs.mkdirSync(path.join(dir, '.agents', 'coal'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agents', 'coal', 'coalmine.json'), JSON.stringify({ language: 'auto' }), 'utf8');
    const r = runConfigure(['--language', 'ja'], dir);
    assert.strictEqual(r.status, 0, r.stderr);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'coal', 'coalmine.json'), 'utf8'));
    assert.strictEqual(cfg.language, 'ja');
    assert.ok(!fs.existsSync(path.join(dir, NEW_REL)), 'never force-migrated to .claude — the .agents home is not the LEGACY location');
    assert.ok(!fs.existsSync(path.join(dir, LEGACY_REL)), 'no legacy root file was ever created');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// r34 findings-back MEDIUM-1 -- the same harness-proof probe install.test.mjs carries,
// so `runConfigure`'s only guard is no longer the destructive `--global` test alone
// (that test's own green depended on configure.mjs's write succeeding, so deleting
// the sandbox turned it red only by first overwriting the operator's real global
// config -- INSPECT, measured). This probe proves the shared helper directly and
// writes nothing anywhere, pass or fail.
test('the shared sandbox helper resolves os.homedir() and os.tmpdir() inside the fixture, never the real machine (configure side)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cfg-sandbox-probe-'));
  try {
    const probe = spawnSandboxed(
      process.execPath,
      ['-e', 'console.log(JSON.stringify({home: require("node:os").homedir(), tmp: require("node:os").tmpdir()}))'],
      { cwd: tmp, sandboxDir: tmp },
    );
    assert.strictEqual(probe.status, 0, probe.stderr);
    const reported = JSON.parse(probe.stdout);
    assert.strictEqual(reported.home, tmp, 'os.homedir() must resolve inside the fixture, never the operator\'s real home');
    assert.strictEqual(reported.tmp, tmp, 'os.tmpdir() must resolve inside the fixture, never the operator\'s real temp dir');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// r34 findings-back round 2 (LOW-C): the probe above proves `spawnSandboxed`; it
// cannot see a regression in `runConfigure`'s OWN wiring to that helper (INSPECT
// Mutation C: reverting `runConfigure`'s body to a raw `spawnSync` with no env made
// this file 9/10 pass, with `--global` as the ONLY red -- and only after it had
// already overwritten the sandbox's own global config file first). This drives the
// proof through `runConfigure` itself with `--help`, which writes NOTHING anywhere,
// pass or fail -- so `runConfigure`'s wiring gets a non-destructive guard instead of
// depending on `--global`'s side effect to notice.
test('runConfigure wires the sandbox through to the CHILD it actually spawns -- proof rides the wrapper, not spawnSandboxed directly', () => {
  const dir = freshProject();
  try {
    const reporter = writeHomeReporter(dir);
    const r = withHomeReporter(reporter, () => runConfigure(['--help'], dir));
    assert.strictEqual(r.status, 0, r.stderr);
    const reported = JSON.parse(r.stderr.trim().split('\n')[0]);
    assert.strictEqual(reported.home, dir, 'the real configure CHILD must resolve os.homedir() inside the sandbox `runConfigure` was given');
    assert.strictEqual(reported.tmp, dir, 'the real configure CHILD must resolve os.tmpdir() inside the same sandbox');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('help documents every schema key — drift between table and help is impossible to ship', () => {
  const dir = freshProject();
  try {
    const r = runConfigure(['--help'], dir);
    assert.strictEqual(r.status, 0);
    for (const spec of CONFIG_SCHEMA) {
      assert.ok(r.stdout.includes(`--${spec.key}`), `help is missing --${spec.key}`);
    }
    assert.ok(r.stdout.includes('--global'), 'help is missing the --global target flag');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('--global writes ~/.claude/.coalmine.json, never the project file (v3.9.0 two-level)', () => {
  const dir = freshProject();
  try {
    // runConfigure already sandboxes USERPROFILE/HOME into `dir` so the real
    // ~/.claude is never touched -- this test's own point (--global targets "home")
    // is exactly why it was the one call site that already did this by hand.
    const r = runConfigure(['--global', '--language', 'th'], dir);
    assert.strictEqual(r.status, 0, r.stderr);
    const globalPath = path.join(dir, '.claude', '.coalmine.json');
    assert.ok(fs.existsSync(globalPath), '--global must create/write the global-layer file (mkdir included)');
    assert.strictEqual(JSON.parse(fs.readFileSync(globalPath, 'utf8')).language, 'th');
    assert.ok(!fs.existsSync(path.join(dir, '.coalmine.json')), '--global must not touch the project file');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('configure writes a valid updateMode and rejects an out-of-enum value', () => {
  const dir = freshProject();
  try {
    const ok = runConfigure(['--updateMode', 'auto'], dir);
    assert.strictEqual(ok.status, 0, ok.stderr);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, NEW_REL), 'utf8')).updateMode, 'auto');

    const bad = runConfigure(['--updateMode', 'sometimes'], dir);
    assert.notStrictEqual(bad.status, 0, 'an out-of-enum updateMode must fail loud');
    assert.match(bad.stderr, /updateMode/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('configure enforces the updateCheckDays minimum (≥ 1)', () => {
  const dir = freshProject();
  try {
    const bad = runConfigure(['--updateCheckDays', '0'], dir);
    assert.notStrictEqual(bad.status, 0, 'updateCheckDays below the minimum must fail loud');
    assert.match(bad.stderr, /updateCheckDays/);
    assert.ok(!fs.existsSync(path.join(dir, NEW_REL)) && !fs.existsSync(path.join(dir, LEGACY_REL)), 'no config may be written anywhere on a min violation');

    const ok = runConfigure(['--updateCheckDays', '7'], dir);
    assert.strictEqual(ok.status, 0, ok.stderr);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, NEW_REL), 'utf8')).updateCheckDays, 7);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('configure fails loud on an invalid value and writes nothing', () => {
  const dir = freshProject();
  try {
    const r = runConfigure(['--defaultTier', 'mega'], dir);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /defaultTier/);
    assert.ok(!fs.existsSync(path.join(dir, NEW_REL)) && !fs.existsSync(path.join(dir, LEGACY_REL)), 'no config may be written anywhere on failure');

    // A trailing list flag with no value must error, not silently clear the list.
    const r2 = runConfigure(['--disable'], dir);
    assert.notStrictEqual(r2.status, 0);
    assert.match(r2.stderr, /disabledCanaries/);
    assert.ok(!fs.existsSync(path.join(dir, NEW_REL)) && !fs.existsSync(path.join(dir, LEGACY_REL)), 'no config may be written anywhere on failure');

    // A bool flag with no value (or a non-boolean word) must error, not silently write false.
    const r3 = runConfigure(['--skipOnboarding'], dir);
    assert.notStrictEqual(r3.status, 0);
    assert.match(r3.stderr, /skipOnboarding/);
    assert.ok(!fs.existsSync(path.join(dir, NEW_REL)) && !fs.existsSync(path.join(dir, LEGACY_REL)), 'no config may be written anywhere on failure');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
