// The autoFixMode line the conductor prints must come from the MERGED autoFixMode, never from a
// config field. A project config may carry an `autoFixNote` object, and the merge copies every
// project key, so the derive block (which runs only when a config sets autoFixMode) must not be
// the only writer of that field. 28c round 2, fix 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONDUCTOR = path.join(repo, 'hooks', 'coalmine-conductor.js');
const LINE = 'autoFixMode in effect';

function runConductor(tmp) {
  return spawnSync(process.execPath, [CONDUCTOR], {
    input: '',
    encoding: 'utf8',
    cwd: tmp,
    env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp, USERPROFILE: tmp, HOME: tmp },
  });
}

function mkTmp(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-autofixnote-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'coalmine'), { mode: 0o700 });
  return dir;
}

test('a project config that carries an autoFixNote object prints no autoFixMode line', (t) => {
  const tmp = mkTmp(t);
  fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ autoFixNote: { mode: 'safe', from: 'global', lowered: '', ignored: false } }), 'utf8');
  const r = runConductor(tmp);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('[CoalMine]'), 'the conductor still emits its offer rules');
  assert.ok(!r.stdout.includes(LINE), `a config field must not print the effective mode: ${r.stdout}`);
});

test('a project config that sets autoFixMode still prints the line from the merged value', (t) => {
  const tmp = mkTmp(t);
  fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ autoFixMode: 'off' }), 'utf8');
  const r = runConductor(tmp);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes(`${LINE}: off`), `the merged mode must be printed: ${r.stdout}`);
});
