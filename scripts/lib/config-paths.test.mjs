// Unit tests for scripts/lib/config-paths.mjs — the per-project config
// read-order shared by configure.mjs and install.mjs (namespace campaign
// #69+#39, owner-designated 2026-08-08). Zero-dep (node:test + built-ins).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGENT_DIR_ORDER, projectConfigCandidates, projectConfigPath, ownDirDefault } from './config-paths.mjs';

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cfgpaths-'));
}
function clean(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
}

test('AGENT_DIR_ORDER is .claude -> .agents -> .gemini, fixed', () => {
  assert.deepStrictEqual(AGENT_DIR_ORDER, ['.claude', '.agents', '.gemini']);
});

test('projectConfigCandidates: the rail order is .claude -> .agents -> .gemini -> LEGACY (nested, then root), always relative to root', () => {
  const root = sandbox();
  try {
    assert.deepStrictEqual(projectConfigCandidates(root), [
      path.join(root, '.claude', 'coal', 'coalmine.json'),
      path.join(root, '.agents', 'coal', 'coalmine.json'),
      path.join(root, '.gemini', 'coal', 'coalmine.json'),
      path.join(root, '.claude', '.coalmine.json'), // UMB-133: the nested legacy shape
      path.join(root, '.coalmine.json'),            // today's legacy stays LAST
    ]);
  } finally { clean(root); }
});

// UMB-133: hole (2). The nested legacy shape is a candidate, and it outranks the
// root dotfile but never a canonical shape.
test('UMB-133 projectConfigPath: a config at <root>/.claude/.coalmine.json is FOUND (it was silently ignored before)', () => {
  const root = sandbox();
  try {
    writeJson(path.join(root, '.claude', '.coalmine.json'), { language: 'nested-legacy' });
    assert.strictEqual(projectConfigPath(root), path.join(root, '.claude', '.coalmine.json'));
  } finally { clean(root); }
});

test('UMB-133 projectConfigPath: the nested legacy wins over the root legacy, and a canonical shape wins over both', () => {
  const root = sandbox();
  try {
    writeJson(path.join(root, '.claude', '.coalmine.json'), { language: 'nested-legacy' });
    writeJson(path.join(root, '.coalmine.json'), { language: 'root-legacy' });
    assert.strictEqual(projectConfigPath(root), path.join(root, '.claude', '.coalmine.json'), 'nested before root');
    writeJson(path.join(root, '.gemini', 'coal', 'coalmine.json'), { language: 'canonical' });
    assert.strictEqual(projectConfigPath(root), path.join(root, '.gemini', 'coal', 'coalmine.json'), 'any canonical shape before either legacy');
  } finally { clean(root); }
});

// The nested legacy path IS the global config when root is the home dir. Read
// as a project config it must never be one: configure.mjs migrates a legacy
// project config by MOVING + DELETING it, which would take the global file.
test('UMB-133 projectConfigPath: a candidate that IS the global ~/.claude/.coalmine.json is never a project config', (t) => {
  const home = sandbox();
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home; process.env.USERPROFILE = home;
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    clean(home);
  });
  writeJson(path.join(home, '.claude', '.coalmine.json'), { language: 'GLOBAL' });
  assert.strictEqual(os.homedir(), home, 'precondition: the sandbox is the home dir');
  assert.strictEqual(projectConfigPath(home), path.join(home, '.claude', 'coal', 'coalmine.json'),
    'root == home: the global file is skipped, so the resolver falls to the own-dir default');
  // ...and a REAL project elsewhere with the same shape is still found.
  const proj = sandbox();
  t.after(() => clean(proj));
  writeJson(path.join(proj, '.claude', '.coalmine.json'), { language: 'project' });
  assert.strictEqual(projectConfigPath(proj), path.join(proj, '.claude', '.coalmine.json'));
});

test('projectConfigPath precedence 1/3: own-dir (.claude) wins even when every other candidate, including LEGACY, also exists', () => {
  const root = sandbox();
  try {
    writeJson(path.join(root, '.claude', 'coal', 'coalmine.json'), { language: 'own-dir' });
    writeJson(path.join(root, '.agents', 'coal', 'coalmine.json'), { language: 'other-dir' });
    writeJson(path.join(root, '.coalmine.json'), { language: 'legacy' });
    assert.strictEqual(projectConfigPath(root), path.join(root, '.claude', 'coal', 'coalmine.json'));
  } finally { clean(root); }
});

test('projectConfigPath precedence 2/3: .claude absent, .agents present -> the other-known-dir entry wins over LEGACY', () => {
  const root = sandbox();
  try {
    writeJson(path.join(root, '.agents', 'coal', 'coalmine.json'), { language: 'other-dir' });
    writeJson(path.join(root, '.coalmine.json'), { language: 'legacy' });
    assert.strictEqual(projectConfigPath(root), path.join(root, '.agents', 'coal', 'coalmine.json'));
  } finally { clean(root); }
});

test('projectConfigPath precedence 3/3: no new-shape candidate exists anywhere -> the LEGACY root dotfile is read, no breakage for an existing user', () => {
  const root = sandbox();
  try {
    writeJson(path.join(root, '.coalmine.json'), { language: 'legacy' });
    assert.strictEqual(projectConfigPath(root), path.join(root, '.coalmine.json'));
  } finally { clean(root); }
});

test('projectConfigPath: nothing exists anywhere -> the own-dir (.claude) path is the read AND write target, matching a never-configured project', () => {
  const root = sandbox();
  try {
    assert.strictEqual(projectConfigPath(root), path.join(root, '.claude', 'coal', 'coalmine.json'));
  } finally { clean(root); }
});

// ownDirDefault (INSPECT MEDIUM 2, 2026-08-08): the fresh-default / migration
// write target must not always be `.claude` — it must nest under whichever
// agent dir the PROJECT already has on disk.
test('ownDirDefault: no agent dir exists at all -> .claude (unchanged default for a never-configured project)', () => {
  const root = sandbox();
  try {
    assert.strictEqual(ownDirDefault(root), path.join(root, '.claude', 'coal', 'coalmine.json'));
  } finally { clean(root); }
});

test('ownDirDefault: only .gemini/ exists on disk -> the config nests under .gemini, never a foreign .claude', () => {
  const root = sandbox();
  try {
    fs.mkdirSync(path.join(root, '.gemini'), { recursive: true });
    assert.strictEqual(ownDirDefault(root), path.join(root, '.gemini', 'coal', 'coalmine.json'));
  } finally { clean(root); }
});

test('ownDirDefault: only .agents/ exists (no .claude) -> the config nests under .agents', () => {
  const root = sandbox();
  try {
    fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
    assert.strictEqual(ownDirDefault(root), path.join(root, '.agents', 'coal', 'coalmine.json'));
  } finally { clean(root); }
});

test('ownDirDefault: a FILE named .gemini (not a directory) does not count as the agent dir existing', () => {
  const root = sandbox();
  try {
    fs.writeFileSync(path.join(root, '.gemini'), 'not a directory', 'utf8');
    assert.strictEqual(ownDirDefault(root), path.join(root, '.claude', 'coal', 'coalmine.json'));
  } finally { clean(root); }
});

test('projectConfigPath: nothing found anywhere but the project already has a .gemini/ dir -> falls back to .gemini, not .claude', () => {
  const root = sandbox();
  try {
    fs.mkdirSync(path.join(root, '.gemini'), { recursive: true });
    assert.strictEqual(projectConfigPath(root), path.join(root, '.gemini', 'coal', 'coalmine.json'));
  } finally { clean(root); }
});

test('a plain FILE (not a dir) at a candidate position never matches an unrelated sibling with the same prefix', () => {
  // Regression guard for the candidate list being derived by path.join, not
  // string-prefix matching — a project named e.g. ".claude-extra" must never
  // satisfy the .claude candidate.
  const root = sandbox();
  try {
    writeJson(path.join(root, '.claude-extra', 'coal', 'coalmine.json'), { language: 'decoy' });
    assert.strictEqual(projectConfigPath(root), path.join(root, '.claude', 'coal', 'coalmine.json'), 'still the own-dir default, the decoy sibling never matches');
  } finally { clean(root); }
});
