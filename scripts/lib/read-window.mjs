// The read-window witness for the 29kk seed-and-act tests (configure-migrate.test.mjs, install-window.test.mjs). A test runs the REAL script
// with a --require preload that writes a change into the user's file in the window between the seed and the act. Two triggers, whichever comes first:
//  - the SECOND openSync of the target (the re-check's read, when the code has one: the seed is the first read);
//  - the first call of rmSync, unlinkSync or renameSync naming the act path (the destructive act itself, when the code has no re-check: the unfixed code).
// Injecting at the act itself with a re-check in place would land after the re-check and prove nothing, so the re-check trigger is the one a fixed
// step must meet. Test-only; nothing in the product imports this file.
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
const nth = Number(process.env.SPY_OPEN_NTH || 2);
const norm = (p) => path.resolve(String(p)).toLowerCase();
const isAct = (p) => typeof p === 'string' && !!actPath && norm(p) === norm(actPath);
let opens = 0;
let done = false;
const inject = (why) => {
  if (done) return;
  done = true;
  fs.writeFileSync(process.env.SPY_WRITE_FILE, Buffer.from(process.env.SPY_BYTES, 'base64'));
  fs.writeFileSync(process.env.SPY_LOG, 'INJECT ' + why + '\n');
};
const orig = fs.openSync;
fs.openSync = function (p, ...rest) {
  if (!done && target && typeof p === 'string' && norm(p) === norm(target)) {
    opens += 1;
    if (opens === nth) inject('open ' + opens);
  }
  return orig.call(this, p, ...rest);
};
for (const name of ['rmSync', 'unlinkSync']) {
  const o = fs[name];
  fs[name] = function (p, ...rest) { if (isAct(p)) inject(name); return o.call(this, p, ...rest); };
}
const oRename = fs.renameSync;
fs.renameSync = function (a, b, ...rest) { if (isAct(a) || isAct(b)) inject('renameSync'); return oRename.call(this, a, b, ...rest); };
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

// Runs the real script from cwd. `inject` = { target, bytes, act } writes `bytes` into `target` at the first trigger, where `act` is the path the
// destructive step names; null runs with no change.
export function runScript(root, cwd, script, args, inject) {
  const preload = path.join(root, 'read-window-preload.cjs');
  fs.writeFileSync(preload, PRELOAD);
  // The log file exists only once the preload has injected: its presence is the answer, so no read of it is needed.
  const log = path.join(root, 'spy.log');
  const env = sandboxEnv(root);
  env.SPY_LOG = log;
  env.SPY_TARGET = '';
  env.SPY_ACT_PATH = '';
  if (inject) {
    env.SPY_TARGET = inject.target;
    env.SPY_ACT_PATH = inject.act;
    env.SPY_WRITE_FILE = inject.target;
    env.SPY_BYTES = Buffer.from(inject.bytes).toString('base64');
    env.SPY_OPEN_NTH = '2';
  }
  const r = spawnSync(process.execPath, ['--require', preload, script, ...args], { cwd, env, encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', injected: fs.existsSync(log) };
}

// A git repository of the test's own, made with the room's git env (never the operator's config).
export function gitInit(dir, root) {
  const r = spawnSync('git', ['init', '-q'], { cwd: dir, env: { ...gitEnv(root), HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home') }, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error(`git init failed: ${r.stderr}`);
}
