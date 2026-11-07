// 3.26.2 (c69): the Stop hook's temp-sweep age is set by the GLOBAL config; a project file may only RAISE it (hooks-safety.md §9, a removal edge).
// Spawns the BUILT copy (plugin/hooks/rot-canary-stop.js), hermetic per hooks-safety.md §7: TEMP/TMP/TMPDIR, HOME and USERPROFILE point at a
// throwaway root torn down by t.after; the CLAUDE_* keys and COALMINE_DEBUG are cleared. Every delete must stay inside that root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STOP = path.join(repo, 'plugin', 'hooks', 'rot-canary-stop.js');
const CLEAR = ['CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_DATA', 'COALMINE_DEBUG'];
const DAY_MS = 24 * 60 * 60 * 1000;

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-sweepdays-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const sb = { root, home: path.join(root, 'home'), tmp: path.join(root, 'tmp'), proj: path.join(root, 'proj') };
  for (const d of [sb.home, sb.tmp, sb.proj]) fs.mkdirSync(d);
  fs.mkdirSync(path.join(sb.proj, '.git')); // the project root the hook walks up to
  fs.mkdirSync(path.join(sb.tmp, 'coalmine'), { mode: 0o700 });
  return sb;
}

// `global` (or null for no global file) goes in HOME/.claude; `project` (or null) goes in the project root.
function setConfigs(sb, { global, project }) {
  if (global !== null) {
    fs.mkdirSync(path.join(sb.home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(sb.home, '.claude', '.coalmine.json'), JSON.stringify(global), 'utf8');
  }
  if (project !== null) fs.writeFileSync(path.join(sb.proj, '.coalmine.json'), JSON.stringify(project), 'utf8');
}

// Two session markers in the owner-only coalmine/ folder: one 2 days old (the subject), one fresh (a control that must always survive).
function plantMarkers(sb) {
  const dir = path.join(sb.tmp, 'coalmine');
  const old = path.join(dir, 'rot-canary-OLDSID1.touched');
  const fresh = path.join(dir, 'rot-canary-NEWSID1.touched');
  fs.writeFileSync(old, 'x\n', 'utf8');
  fs.writeFileSync(fresh, 'x\n', 'utf8');
  const twoDaysAgo = new Date(Date.now() - 2 * DAY_MS);
  fs.utimesSync(old, twoDaysAgo, twoDaysAgo);
  return { old, fresh };
}

function runStop(sb) {
  const env = { ...process.env, TEMP: sb.tmp, TMP: sb.tmp, TMPDIR: sb.tmp, HOME: sb.home, USERPROFILE: sb.home };
  for (const k of CLEAR) delete env[k];
  return spawnSync(process.execPath, [STOP], { input: '{}', encoding: 'utf8', cwd: sb.proj, env, timeout: 60000 });
}

// Runs one leg: plants, runs the stop hook once, asserts the subject's fate and that the control and the sandbox stayed in place.
function leg(t, { global, project, expectSubjectKept, label }) {
  const sb = sandbox(t);
  setConfigs(sb, { global, project });
  const { old, fresh } = plantMarkers(sb);
  const r = runStop(sb);
  assert.equal(r.status, 0, `${label}: exit ${r.status}: ${r.stderr}`);
  assert.equal(fs.existsSync(fresh), true, `${label}: the fresh control marker was removed`);
  assert.equal(fs.existsSync(old), expectSubjectKept, `${label}: the 2-day-old marker was ${expectSubjectKept ? 'deleted' : 'kept'}`);
  assert.ok(fs.existsSync(path.join(sb.proj, '.git')), `${label}: the project root was touched`);
}

test('temp sweep leg A: with no global config, a project 1-day value does not delete a 2-day-old marker (the 7-day factory applies)', (t) => {
  leg(t, { global: null, project: { tempSweepStaleDays: 1 }, expectSubjectKept: true, label: 'leg A' });
});

test('temp sweep leg B: a global 7-day value keeps a 2-day-old marker against a project 1-day value', (t) => {
  leg(t, { global: { tempSweepStaleDays: 7 }, project: { tempSweepStaleDays: 1 }, expectSubjectKept: true, label: 'leg B' });
});

test('temp sweep leg C: a global 1-day value and no project value still deletes a 2-day-old marker (the user\'s own choice works)', (t) => {
  leg(t, { global: { tempSweepStaleDays: 1 }, project: null, expectSubjectKept: false, label: 'leg C' });
});

test('temp sweep leg D: a project 30-day value raises a global 1-day value, so a 2-day-old marker is kept (a project may raise)', (t) => {
  leg(t, { global: { tempSweepStaleDays: 1 }, project: { tempSweepStaleDays: 30 }, expectSubjectKept: true, label: 'leg D' });
});
