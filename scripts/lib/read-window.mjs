// The read-window witness for the seed-and-act tests (configure-migrate.test.mjs, install-window.test.mjs, move-aside.test.mjs). A test runs the REAL
// script with a --require preload that changes the user's file in the window before a destructive step. Triggers, whichever comes first:
//  - the nth openSync of the target (openNth; 2 = the re-check's read after the seeding read, 1 = the first read, 0 = never);
//  - the first call of rmSync, unlinkSync or renameSync naming the act path (the destroying call itself).
// Modes: 'replace' (default) writes the bytes over the target; 'append' appends them; 'throw' makes any renameSync naming the act path fail with EBUSY
// (nothing is injected); 'throw-into' makes a renameSync whose DESTINATION is the act path, and whose source is not, fail with EBUSY.
// Injecting at the act with a re-check in place lands after the re-check, so a test that must meet the re-check sets openNth; a test that must meet the
// destroying call alone sets openNth 0. Test-only; nothing in the product imports this file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitEnv } from './git-env.mjs';

const PRELOAD = String.raw`'use strict';
const fs = require('node:fs');
const path = require('node:path');
const target = process.env.SPY_TARGET;
const actPath = process.env.SPY_ACT_PATH;
const nth = Number(process.env.SPY_OPEN_NTH || 0);
const mode = process.env.SPY_MODE || 'replace';
const norm = (p) => path.resolve(String(p)).toLowerCase();
const isAct = (p) => typeof p === 'string' && !!actPath && norm(p) === norm(actPath);
let opens = 0;
let done = false;
const inject = (why) => {
  if (done) return;
  done = true;
  const bytes = Buffer.from(process.env.SPY_BYTES, 'base64');
  if (mode === 'append') fs.appendFileSync(process.env.SPY_WRITE_FILE, bytes);
  else fs.writeFileSync(process.env.SPY_WRITE_FILE, bytes);
  fs.writeFileSync(process.env.SPY_LOG, 'INJECT ' + why + '\n');
};
const busy = () => { const e = new Error('EBUSY: resource busy or locked (read-window)'); e.code = 'EBUSY'; return e; };
const orig = fs.openSync;
fs.openSync = function (p, ...rest) {
  if (!done && target && typeof p === 'string' && norm(p) === norm(target)) {
    opens += 1;
    if (nth > 0 && opens === nth) inject('open ' + opens);
  }
  return orig.call(this, p, ...rest);
};
for (const name of ['rmSync', 'unlinkSync']) {
  const o = fs[name];
  fs[name] = function (p, ...rest) { if (isAct(p)) inject(name); return o.call(this, p, ...rest); };
}
const oRename = fs.renameSync;
fs.renameSync = function (a, b, ...rest) {
  if (mode === 'throw' && (isAct(a) || isAct(b))) throw busy();
  if (mode === 'throw-into' && isAct(b) && !isAct(a)) throw busy();
  if ((mode === 'replace' || mode === 'append') && (isAct(a) || isAct(b))) inject('renameSync');
  return oRename.call(this, a, b, ...rest);
};
`;

// A fresh temp root of the test's own making, removed by the test's teardown.
export function makeRoot(prefix, removeTree, t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), prefix));
  t.after(() => removeTree(root));
  fs.mkdirSync(path.join(root, 'home'));
  fs.mkdirSync(path.join(root, 'tmp'));
  return root;
}

// The child's environment: no GIT_* key from the operator, HOME and the temp folders inside the root, and the host's Claude Code variables removed.
export function sandboxEnv(root) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  const home = path.join(root, 'home');
  const tmp = path.join(root, 'tmp');
  Object.assign(env, { HOME: home, USERPROFILE: home, TEMP: tmp, TMP: tmp, TMPDIR: tmp, NODE_OPTIONS: '--max-old-space-size=2048' });
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CLAUDE_PLUGIN_ROOT;
  delete env.CLAUDE_PLUGIN_DATA;
  return env;
}

// Runs the real script from cwd. `inject` = { target, bytes, act, mode?, openNth? } changes `target` at the first trigger (see the header); null runs
// with no change. `injected` is true when the preload fired (its log file exists), so a leg can prove it was not vacuous.
export function runScript(root, cwd, script, args, inject) {
  const preload = path.join(root, 'read-window-preload.cjs');
  fs.writeFileSync(preload, PRELOAD);
  const log = path.join(root, 'spy.log');
  const env = sandboxEnv(root);
  env.SPY_LOG = log;
  env.SPY_TARGET = '';
  env.SPY_ACT_PATH = '';
  if (inject) {
    env.SPY_TARGET = inject.target;
    env.SPY_ACT_PATH = inject.act;
    env.SPY_WRITE_FILE = inject.target;
    env.SPY_BYTES = Buffer.from(inject.bytes ?? '').toString('base64');
    env.SPY_MODE = inject.mode ?? 'replace';
    env.SPY_OPEN_NTH = String(inject.openNth ?? 2);
  }
  const r = spawnSync(process.execPath, ['--require', preload, script, ...args], { cwd, env, encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', injected: fs.existsSync(log) };
}

// A git repository of the test's own, made with the room's git env (never the operator's config).
export function gitInit(dir, root) {
  const r = spawnSync('git', ['init', '-q'], { cwd: dir, env: { ...gitEnv(root), HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home') }, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error(`git init failed: ${r.stderr}`);
}

// Stages one path in a test repository (the git index is what `git ls-files` reads back as tracked).
export function gitAdd(dir, root, rel) {
  const r = spawnSync('git', ['add', '--', rel], { cwd: dir, env: { ...gitEnv(root), HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home') }, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error(`git add failed: ${r.stderr}`);
}

// True when a git binary answers on this box (a tracked-status leg needs one; without it the leg skips visibly).
export function gitAvailable() {
  const r = spawnSync('git', ['--version'], { env: gitEnv(os.tmpdir()), encoding: 'utf8', timeout: 20000 });
  return r.status === 0;
}
