// UMB-133 — the project-config path unification, proven through the REAL conductor.
// node:test built-in, zero dependencies. Run: node --test scripts/lib/conductor-config-path.test.mjs
//
// Spawns hooks/coalmine-conductor.js with a sandboxed TEMP + HOME (so the real
// ~/.claude, its global config and its update stamp can never leak in) and a
// project dir carrying a .git anchor. Every assertion reads a STATE EFFECT of
// the config actually being read (the onboarding line dropped by
// `skipOnboarding`, the whole emit silenced by `enableConductor:false`) or the
// emitted report line — never `exit 0` alone (Phoenix #4 guarantees exit 0 on
// every bail path, so exit 0 proves the hook ran to no particular end).
//
// The DISCRIMINATOR: the conductor emits an onboarding line ("gold-standard
// (important)") unless the project config says `skipOnboarding: true`. So
//   onboarding line ABSENT + conductor still speaking  => that config WAS READ
//   onboarding line PRESENT                             => it was NOT read
// and `enableConductor:false` is the "this file must not win" decoy: reading it
// silences the whole emit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONDUCTOR = path.join(repo, 'hooks', 'coalmine-conductor.js');

const ONBOARDING = 'gold-standard (important)';
const CANON = '.claude/coal/coalmine.json';
const ignored = (p) => `IGNORED: ${p} is not a config path; canonical = ${CANON}`;

function run(cwd, home, { args = [], input = '' } = {}) {
  return spawnSync(process.execPath, [CONDUCTOR, ...args], {
    input, encoding: 'utf8', cwd,
    env: { ...process.env, TEMP: home, TMP: home, TMPDIR: home, USERPROFILE: home, HOME: home },
  });
}

// A project with its own .git anchor, and a SEPARATE sandbox home, both cleaned
// on pass AND fail (t.after registered the line after allocation).
function sandbox(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cfgpath-home-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cfgpath-proj-'));
  t.after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(proj, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(proj, '.git'));
  return { home, proj };
}
function put(proj, rel, obj) {
  const p = path.join(proj, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
}
const QUIET = { updateMode: 'off' }; // keeps the self-update directive + stamp out of the picture
const reads = (r) => r.stdout.includes('[CoalMine]') && !r.stdout.includes(ONBOARDING);
const ignoredNotes = (r) => r.stdout.split('\n').filter((l) => l.includes('IGNORED:'));
const migrationNotes = (r) => r.stdout.split('\n').filter((l) => l.includes('config migration notice'));

// --- property 1: hole (2) — the nested legacy shape is FOUND ----------------------------------

test('UMB-133 (1): a config at <root>/.claude/.coalmine.json is READ (it was silently ignored)', (t) => {
  const { home, proj } = sandbox(t);
  put(proj, '.claude/.coalmine.json', { ...QUIET, skipOnboarding: true });
  const r = run(proj, home);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '', 'no stderr (Phoenix #13)');
  assert.ok(reads(r), `the nested legacy config must take effect (onboarding line dropped), got:\n${r.stdout}`);
});

// --- property 2: no regression — the root legacy is still FOUND -------------------------------

test('UMB-133 (2): a config at <root>/.coalmine.json is still READ', (t) => {
  const { home, proj } = sandbox(t);
  put(proj, '.coalmine.json', { ...QUIET, skipOnboarding: true });
  const r = run(proj, home);
  assert.equal(r.status, 0);
  assert.ok(reads(r), `the root legacy config must still take effect, got:\n${r.stdout}`);
});

// --- property 3: precedence — canonical wins over both, nested wins over root -----------------

test('UMB-133 (3a): the canonical .claude/coal/coalmine.json WINS over both legacy shapes', (t) => {
  const { home, proj } = sandbox(t);
  put(proj, '.claude/coal/coalmine.json', { ...QUIET, skipOnboarding: true });
  put(proj, '.claude/.coalmine.json', { enableConductor: false });   // decoy: reading it silences the whole emit
  put(proj, '.coalmine.json', { enableConductor: false });           // decoy
  const r = run(proj, home);
  assert.ok(reads(r), `canonical must be the one read (decoys would silence the emit), got:\n${r.stdout}`);
});

test('UMB-133 (3b): the nested legacy WINS over the root legacy', (t) => {
  const { home, proj } = sandbox(t);
  put(proj, '.claude/.coalmine.json', { ...QUIET, skipOnboarding: true });
  put(proj, '.coalmine.json', { enableConductor: false });           // decoy
  const r = run(proj, home);
  assert.ok(reads(r), `nested before root, got:\n${r.stdout}`);
});

// --- property 4: hole (1) — a config at a NON-candidate path is REPORTED by name --------------

for (const p of ['.agents/.coalmine.json', '.gemini/.coalmine.json', 'coal/coalmine.json', '.claude/coalmine.json']) {
  test(`UMB-133 (4): a config at the non-candidate ${p} is REPORTED by name, not silently skipped`, (t) => {
    const { home, proj } = sandbox(t);
    put(proj, p, { ...QUIET, skipOnboarding: true });
    const r = run(proj, home);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.deepEqual(ignoredNotes(r).length, 1, `exactly one IGNORED line, got:\n${r.stdout}`);
    assert.ok(r.stdout.includes(ignored(p)), `the line must carry the exact shape, got:\n${r.stdout}`);
    assert.ok(r.stdout.includes(ONBOARDING), 'and the file was NOT read (onboarding line still present) — reported, never honoured');
  });
}

test('UMB-133 (4): no stray file -> no IGNORED line and no migration notice (the report is silent on a clean project)', (t) => {
  const { home, proj } = sandbox(t);
  put(proj, '.claude/coal/coalmine.json', { ...QUIET });
  const r = run(proj, home);
  assert.ok(r.stdout.includes('[CoalMine]'));
  assert.equal(ignoredNotes(r).length, 0);
  assert.equal(migrationNotes(r).length, 0);
});

test('UMB-133 (4): several strays -> each is named on its own line', (t) => {
  const { home, proj } = sandbox(t);
  put(proj, '.agents/.coalmine.json', { ...QUIET });
  put(proj, 'coal/coalmine.json', { ...QUIET });
  const r = run(proj, home);
  assert.equal(ignoredNotes(r).length, 2);
  assert.ok(r.stdout.includes(ignored('.agents/.coalmine.json')));
  assert.ok(r.stdout.includes(ignored('coal/coalmine.json')));
});

// --- the legacy migration notice --------------------------------------------------------------

for (const p of ['.claude/.coalmine.json', '.coalmine.json']) {
  test(`UMB-133: a LEGACY hit at ${p} emits ONE migration notice naming the canonical path`, (t) => {
    const { home, proj } = sandbox(t);
    put(proj, p, { ...QUIET, skipOnboarding: true });
    const r = run(proj, home);
    const notes = migrationNotes(r);
    assert.equal(notes.length, 1, `exactly one notice, got:\n${r.stdout}`);
    assert.ok(notes[0].includes(p) && notes[0].includes(CANON), notes[0]);
    assert.equal(ignoredNotes(r).length, 0, 'a legacy candidate is READ, so it is never also reported as ignored');
  });
}

test('UMB-133: a canonical config -> no migration notice, even with a legacy file beside it that is not the one read', (t) => {
  const { home, proj } = sandbox(t);
  put(proj, '.claude/coal/coalmine.json', { ...QUIET });
  put(proj, '.coalmine.json', { ...QUIET });
  assert.equal(migrationNotes(run(proj, home)).length, 0, 'the file actually read is canonical — nothing to migrate');
});

// --- the three channels: one buildLines site, each mode on its own sanctioned surface ---------

test('UMB-133: the Gemini adapter carries the IGNORED line on hookSpecificOutput.additionalContext', (t) => {
  const { home, proj } = sandbox(t);
  put(proj, '.gemini/.coalmine.json', { ...QUIET });
  const r = run(proj, home, { args: ['SessionStart'], input: JSON.stringify({ cwd: proj }) });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  const out = JSON.parse(r.stdout.trim());
  assert.ok(out.hookSpecificOutput.additionalContext.includes(ignored('.gemini/.coalmine.json')), r.stdout);
});

test('UMB-133: the Antigravity adapter carries the IGNORED line on injectSteps[].ephemeralMessage', (t) => {
  const { home, proj } = sandbox(t);
  put(proj, '.agents/.coalmine.json', { ...QUIET });
  const r = run(proj, home, { args: ['PreInvocation'], input: JSON.stringify({ conversationId: 'umb133-ag', workspacePaths: [proj] }) });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  const out = JSON.parse(r.stdout.trim());
  assert.ok(out.injectSteps[0].ephemeralMessage.includes(ignored('.agents/.coalmine.json')), r.stdout);
});

// --- the global-file guard: at root == home, .claude/.coalmine.json IS the global -------------

// The walk must not STOP at the home dir merely because the global config lives under it
// (that would anchor a non-git dir at `~`, WIDER than startDir — the opposite of "additive,
// only narrower"). Layout: <base>/.git and a stamped rule file at <base>/.claude/rules, with
// HOME = <base>/home holding the global file. cwd = <base>/home/sub (no .git anywhere between).
//   guarded  : the walk skips home's marker, continues, stops at <base> -> stamp seen -> onboarding SUPPRESSED
//   unguarded: the walk stops at home -> home has no rule roots -> onboarding PRESENT
test('UMB-133: the walk does NOT anchor at the home dir just because the GLOBAL config sits under it', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cfgpath-base-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(base, '.git'));
  fs.mkdirSync(path.join(base, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(base, '.claude', 'rules', 'gold.md'), '<!-- coalmine: verified 2026-07-01 revalidate 90d -->\n', 'utf8');
  const home = path.join(base, 'home');
  put(home, '.claude/.coalmine.json', { updateMode: 'off' });       // the GLOBAL file
  const cwd = path.join(home, 'sub');
  fs.mkdirSync(cwd, { recursive: true });
  const r = run(cwd, home);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('[CoalMine]'), 'the conductor still runs');
  assert.ok(!r.stdout.includes(ONBOARDING),
    `the walk must reach <base> (its stamped rule root suppresses onboarding), not stop at the home dir, got:\n${r.stdout}`);
});

test('UMB-133: at root == home the nested legacy path is the GLOBAL config, never reported or read as a project one', (t) => {
  const { home } = sandbox(t);
  fs.mkdirSync(path.join(home, '.git'));                                  // the home dir is the git root (a dotfiles repo)
  put(home, '.claude/.coalmine.json', { updateMode: 'off' });              // the GLOBAL file
  const r = run(home, home);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('[CoalMine]'), 'the conductor still runs');
  assert.equal(migrationNotes(r).length, 0, `the global file must not be called a legacy PROJECT config, got:\n${r.stdout}`);
});

// --- INSPECT MEDIUM-1 (findings-back): on AG and Gemini the hook process does NOT run in the
// workspace, so the config that takes effect must be the WORKSPACE's — the same root the adapter
// already hands to buildLines and the rule-root scan. Every AG/Gemini test above passes a payload
// path EQUAL to the spawn cwd, which is exactly why the divergence had no coverage; here they differ.
// `elsewhere` = the directory the hook process is spawned in (a git dir, no config of its own).
function split(t) {
  const { home, proj: ws } = sandbox(t);
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cfgpath-else-'));
  t.after(() => fs.rmSync(elsewhere, { recursive: true, force: true }));
  fs.mkdirSync(path.join(elsewhere, '.git'));
  return { home, ws, elsewhere };
}
const agRun = (cwd, home, ws) => run(cwd, home, { args: ['PreInvocation'], input: JSON.stringify({ conversationId: `umb133-${path.basename(ws)}`, workspacePaths: [ws] }) });
const gemRun = (cwd, home, ws) => run(cwd, home, { args: ['SessionStart'], input: JSON.stringify({ cwd: ws }) });
const agText = (r) => JSON.parse(r.stdout.trim()).injectSteps[0].ephemeralMessage;
const gemText = (r) => JSON.parse(r.stdout.trim()).hookSpecificOutput.additionalContext;

for (const [name, runIt, text] of [['Antigravity', agRun, agText], ['Gemini', gemRun, gemText]]) {
  test(`UMB-133 (split root) ${name}: a nested legacy config in the WORKSPACE is READ when the hook process runs elsewhere — and the notice is then true`, (t) => {
    const { home, ws, elsewhere } = split(t);
    put(ws, '.claude/.coalmine.json', { ...QUIET, skipOnboarding: true });
    const r = runIt(elsewhere, home, ws);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    const msg = text(r);
    assert.ok(msg.includes('[CoalMine]'));
    assert.ok(!msg.includes(ONBOARDING), `the workspace config must take effect (onboarding dropped), got:\n${msg}`);
    assert.ok(msg.includes('config migration notice') && msg.includes('.claude/.coalmine.json'), 'and the notice that says "still read" is TRUE');
  });

  test(`UMB-133 (split root) ${name}: the hook process's own cwd config NEVER bleeds into a different workspace`, (t) => {
    const { home, ws, elsewhere } = split(t);
    put(elsewhere, '.coalmine.json', { enableConductor: false });   // decoy at the PROCESS cwd: reading it would silence the emit
    const r = runIt(elsewhere, home, ws);
    assert.ok(r.stdout.includes('[CoalMine]'), `the workspace has no config, so the conductor must speak, got:\n${r.stdout}`);
  });

  test(`UMB-133 (split root) ${name}: a workspace config gate (enableConductor:false) silences it — the gates follow the workspace too`, (t) => {
    const { home, ws, elsewhere } = split(t);
    put(ws, '.claude/coal/coalmine.json', { enableConductor: false });
    const r = runIt(elsewhere, home, ws);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'a workspace that opted out of the conductor stays opted out on every adapter');
  });
}

// --- the cache: loadCfg(base) is keyed to the base (one entry), so a second base can never be
// served the first base's config, and the no-arg default is still the process cwd — the
// rot-canary-touch/-stop call shape. Exercises the PARTIAL itself (the source of truth all three
// hooks are synced from), in-process, with HOME and cwd sandboxed and restored.
test('UMB-133: loadCfg(base) never returns another base\'s config, and loadCfg() still reads the process cwd', (t) => {
  const src = fs.readFileSync(path.join(repo, 'hooks', '_shared', 'node-config.js'), 'utf8');
  const { loadCfg } = new Function('fs', 'os', 'path', `${src}\nreturn { loadCfg };`)(fs, os, path);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cfgpath-lc-home-'));
  const A = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cfgpath-lc-a-'));
  const B = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cfgpath-lc-b-'));
  const saved = { cwd: process.cwd(), HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  t.after(() => {
    process.chdir(saved.cwd);
    for (const k of ['HOME', 'USERPROFILE']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    for (const d of [home, A, B]) fs.rmSync(d, { recursive: true, force: true });
  });
  process.env.HOME = home; process.env.USERPROFILE = home;
  for (const [d, lang] of [[A, 'A'], [B, 'B']]) { fs.mkdirSync(path.join(d, '.git')); put(d, '.coalmine.json', { language: lang }); }
  process.chdir(A);
  assert.equal(loadCfg().language, 'A', 'no arg = the process cwd (unchanged for the touch/stop hooks)');
  assert.equal(loadCfg(B).language, 'B', 'an explicit base reads THAT base');
  assert.equal(loadCfg().language, 'A', 'and the default afterwards is still the process cwd, never the last explicit base');
  assert.equal(loadCfg(B).language, 'B');
  assert.equal(loadCfg(A).language, 'A');
});
