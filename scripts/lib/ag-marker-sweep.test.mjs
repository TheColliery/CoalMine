// c98 (CW-055 witness): does a user who runs ONLY Antigravity reach a sweep that removes the stale AG conductor markers?
// The conductor's Antigravity branch writes one `ag-conductor-<djb2>.marker` per conversation into <os.tmpdir()>/coalmine. Its only collector is
// sweepStale() in rot-canary-stop.js, which the Stop hook calls before any mode gate. The Antigravity route runs that Stop hook from plugin/hooks.json
// (the AG manifest the plugin folder carries); the Claude Code route runs it from plugin/hooks/hooks.json with no argv. This file runs both, on the same
// planted folder, and asserts the same result, so a NO on the Antigravity side is the route's and not the fixture's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTree } from './test-sandbox.mjs';

const ROOM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN = path.join(ROOM, 'plugin');
const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 7; // the factory tempSweepStaleDays: rot-canary-stop.js getTempSweepStaleDays(), no global config in the sandbox
const STALE_AGE_DAYS = 30; // well past the cutoff, so the planted staleness is not a near-miss
const STEP_TIMEOUT_MS = 60_000;
const N_STALE = 4;
const M_FRESH = 3;
const SENTINEL = 'ag-conductor-sentinel.marker'; // a stale marker OUTSIDE coalmine/: no pass in the hooks names it, so it must survive
const CLEAR_KEYS = ['CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_DATA', 'CLAUDE_CODE_SESSION_ATTENDED'];

// djb2, copied from coalmine-conductor.js (not exported there): the conductor's own marker name shape.
function djb2(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
const markerName = (key) => `ag-conductor-${djb2(key)}.marker`;

// Every hook child: TEMP/TMP/TMPDIR and USERPROFILE/HOME at the sandbox, the project and plugin variables deleted (hooks.test.mjs rails).
function sandboxEnv(sb) {
  const env = { ...process.env };
  for (const k of CLEAR_KEYS) delete env[k];
  return { ...env, TEMP: sb, TMP: sb, TMPDIR: sb, USERPROFILE: sb, HOME: sb };
}

function mkSandbox(t) {
  const sb = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-agsweep-'));
  t.after(() => removeTree(sb));
  const ws = path.join(sb, 'ws');
  fs.mkdirSync(ws);
  // The copied plugin folder: the hooks and the AG manifest, as a user's installed copy carries them.
  const plugin = path.join(sb, 'plugin');
  fs.mkdirSync(plugin);
  fs.cpSync(path.join(PLUGIN, 'hooks'), path.join(plugin, 'hooks'), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN, 'hooks.json'), path.join(plugin, 'hooks.json'));
  return { sb, ws, plugin };
}

// The planted folder: N stale and M fresh conductor markers in <sb>/coalmine, one stale sentinel outside it.
function plant(sb) {
  const dir = path.join(sb, 'coalmine');
  fs.mkdirSync(dir, { mode: 0o700 });
  const old = new Date(Date.now() - STALE_AGE_DAYS * DAY_MS);
  const stale = [];
  const fresh = [];
  for (let i = 0; i < N_STALE; i++) {
    const name = markerName(`stale-session-${i}`);
    fs.writeFileSync(path.join(dir, name), '');
    fs.utimesSync(path.join(dir, name), old, old);
    stale.push(name);
  }
  for (let i = 0; i < M_FRESH; i++) {
    const name = markerName(`fresh-session-${i}`);
    fs.writeFileSync(path.join(dir, name), '');
    fresh.push(name);
  }
  const sentinel = path.join(sb, SENTINEL);
  fs.writeFileSync(sentinel, '');
  fs.utimesSync(sentinel, old, old);
  return { dir, stale, fresh, sentinel };
}

const snapshot = (dir) => fs.readdirSync(dir).sort();

// The AG manifest, read from the copied folder: every hook step with its file, its argv and its timeout. Asserts the wiring shape it relies on.
function agSteps(plugin) {
  const manifest = JSON.parse(fs.readFileSync(path.join(plugin, 'hooks.json'), 'utf8').replace(/^﻿/, ''));
  assert.deepEqual(Object.keys(manifest), ['coalmine'], 'the AG manifest has one named group');
  const steps = [];
  for (const event of ['PreInvocation', 'PostToolUse', 'Stop']) {
    for (const entry of manifest.coalmine[event]) {
      for (const h of entry.hooks ?? [entry]) {
        const [bin, script, ...argv] = h.command.split(' ');
        assert.equal(bin, 'node', `${event}: an external node command`);
        steps.push({ event, script: path.join(plugin, script), argv, timeout: h.timeout });
      }
    }
  }
  return steps;
}

// The Antigravity payloads: camelCase protojson, workspacePaths[0] is the sandbox workspace, never the repository.
function agPayload(event, ws) {
  const base = { conversationId: 'ag-fixture-conversation', workspacePaths: [ws] };
  // A tool name the PostToolUse matcher does not name: the touch hook records nothing, so no fixture file is needed.
  return event === 'PostToolUse' ? { ...base, toolName: 'run_command', toolInput: {} } : base;
}

function run(script, args, cwd, env, payload) {
  return spawnSync(process.execPath, [script, ...args], { cwd, env, input: JSON.stringify(payload), encoding: 'utf8', timeout: STEP_TIMEOUT_MS });
}

function assertOutcome(t, p, after, label) {
  const newNames = after.filter((n) => !p.before.includes(n));
  const staleLeft = p.stale.filter((n) => after.includes(n));
  const freshKept = p.fresh.filter((n) => after.includes(n));
  t.diagnostic(`${label}: stale ${p.stale.length} -> ${staleLeft.length} left; fresh ${p.fresh.length} -> ${freshKept.length} kept; new this run: ${newNames.length} (${newNames.join(', ') || 'none'})`);
  assert.deepEqual(staleLeft, [], `${label}: every stale conductor marker is removed`);
  assert.deepEqual(freshKept, p.fresh, `${label}: every fresh conductor marker is kept`);
  assert.ok(fs.existsSync(p.sentinel), `${label}: a stale marker outside coalmine/ is untouched`);
}

test('the Antigravity route (PreInvocation, PostToolUse, Stop from plugin/hooks.json) removes every stale conductor marker and keeps every fresh one', (t) => {
  const { sb, ws, plugin } = mkSandbox(t);
  const planted = plant(sb);
  const p = { ...planted, before: snapshot(planted.dir) };
  assert.equal(fs.existsSync(path.join(planted.dir, 'rot-canary-sweep.marker')), false, 'no 24-hour throttle gate exists, so the first Stop sweeps');
  const env = sandboxEnv(sb);
  for (const step of agSteps(plugin)) {
    const r = run(step.script, step.argv, plugin, env, agPayload(step.event, ws));
    assert.equal(r.error, undefined, `${step.event}: ran without timing out or failing to start`);
    assert.equal(r.status, 0, `${step.event}: exits 0 (${r.stderr.slice(0, 200)})`);
  }
  assertOutcome(t, p, snapshot(planted.dir), 'AG route');
});

test('control: the Claude Code Stop route (no argv, plugin/hooks/hooks.json) removes the same stale markers and keeps the fresh ones', (t) => {
  const { sb, ws, plugin } = mkSandbox(t);
  const planted = plant(sb);
  const p = { ...planted, before: snapshot(planted.dir) };
  const payload = { session_id: 'cc-fixture-session', transcript_path: path.join(sb, 'transcript.jsonl'), hook_event_name: 'Stop', cwd: ws, stop_hook_active: false };
  const r = run(path.join(plugin, 'hooks', 'rot-canary-stop.js'), [], ws, sandboxEnv(sb), payload);
  assert.equal(r.error, undefined, 'Stop: ran without timing out or failing to start');
  assert.equal(r.status, 0, `Stop: exits 0 (${r.stderr.slice(0, 200)})`);
  assertOutcome(t, p, snapshot(planted.dir), 'CC route control');
});
