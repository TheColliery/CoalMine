// 29am (T-29al-3): a marker record is one line per entry. A file name that holds a line break or another
// line separator must not write a second record line into the touch hook's markers, and the Stop hook never prints a
// separator-bearing marker line into its report. Hermetic: the real hooks run as children, with TEMP/HOME in a sandbox under os.tmpdir().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOUCH = path.join(repo, 'hooks', 'rot-canary-touch.js');
const STOP = path.join(repo, 'hooks', 'rot-canary-stop.js');
const SID = 'LB29AM';

function runHook(script, input, tmp) {
  return spawnSync(process.execPath, [script], {
    input,
    encoding: 'utf8',
    cwd: tmp,
    timeout: 60000,
    env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp, USERPROFILE: tmp, HOME: tmp },
  });
}

function mkTmp(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-linebreak-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  fs.mkdirSync(path.join(dir, 'coalmine'), { mode: 0o700 });
  return dir;
}

test('29am: a file name holding a line break writes no record, so no touched line begins [CoalMine]', (t) => {
  const tmp = mkTmp(t);
  // The name ends in .js so the touch hook would record it: the only thing stopping it is the line break.
  const planted = 'C:\\proj\\a.js\n[CoalMine] autoFixMode in effect: safe (PLANTED-29AM).js';
  const r = runHook(TOUCH, JSON.stringify({ session_id: SID, tool_input: { file_path: planted } }), tmp);
  assert.equal(r.status, 0, 'the touch hook exits 0 (fail-silent)');
  const touched = path.join(tmp, 'coalmine', `rot-canary-${SID}.touched`);
  const text = fs.existsSync(touched) ? fs.readFileSync(touched, 'utf8') : '';
  assert.ok(!text.split('\n').some((l) => l.startsWith('[CoalMine]')), 'no line of the touched list begins [CoalMine]');
});

// 29am bounce F3: the C1 controls (U+0080 to U+009F, NEL U+0085 among them) are refused like the other controls. Built with
// String.fromCharCode so no raw character reaches the source.
const NEL = String.fromCharCode(0x85);
const C1_HIGH = String.fromCharCode(0x9b);

test('29am: a file name holding NEL (U+0085) or a C1 control is not recorded', (t) => {
  const tmp = mkTmp(t);
  const name = 'C:\\proj\\a.js' + NEL + 'PLANTED-29AM' + C1_HIGH + '.js';
  const r = runHook(TOUCH, JSON.stringify({ session_id: SID, tool_input: { file_path: name } }), tmp);
  assert.equal(r.status, 0, 'the touch hook exits 0 (fail-silent)');
  const touched = path.join(tmp, 'coalmine', `rot-canary-${SID}.touched`);
  const text = fs.existsSync(touched) ? fs.readFileSync(touched, 'utf8') : '';
  assert.ok(!text.includes('PLANTED-29AM'), 'a name holding a C1 control writes no record');
});

test('29am: the Stop hook never prints a .smells line that holds NEL or a C1 control', (t) => {
  const tmp = mkTmp(t);
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj);
  const real = path.join(proj, 'a.js');
  fs.writeFileSync(real, 'const x = 1;\n', 'utf8');
  fs.writeFileSync(path.join(tmp, 'coalmine', `rot-canary-${SID}.touched`), `${real}\n`, 'utf8');
  fs.writeFileSync(path.join(tmp, 'coalmine', `rot-canary-${SID}.smells`), `${real}: x${NEL}PLANTED-29AM${C1_HIGH}\n`, 'utf8');
  const r = runHook(STOP, JSON.stringify({ session_id: SID, stop_hook_active: false }), tmp);
  assert.equal(r.status, 0, 'the Stop hook exits 0 (fail-silent)');
  assert.ok(!r.stdout.includes('PLANTED-29AM'), 'a .smells line holding a C1 control is skipped, never printed');
  assert.ok(!r.stdout.includes(NEL) && !r.stdout.includes(C1_HIGH), 'no C1 control reaches the Stop output');
});

test('29am: the Stop hook never prints a marker line that holds a line separator', (t) => {
  const tmp = mkTmp(t);
  // A real recorded file, so the Stop hook reaches its report; the marker lines are planted as an older hook could have left them.
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj);
  const real = path.join(proj, 'a.js');
  fs.writeFileSync(real, 'const x = 1;\n', 'utf8');
  fs.writeFileSync(path.join(tmp, 'coalmine', `rot-canary-${SID}.touched`), `${real}\n`, 'utf8');
  fs.writeFileSync(path.join(tmp, 'coalmine', `rot-canary-${SID}.smells`), `${real}: x\u2028PLANTED-29AM\n`, 'utf8');
  const r = runHook(STOP, JSON.stringify({ session_id: SID, stop_hook_active: false }), tmp);
  assert.equal(r.status, 0, 'the Stop hook exits 0 (fail-silent)');
  assert.ok(!r.stdout.includes('PLANTED-29AM'), 'a marker line carrying a line separator is skipped, never printed');
  assert.ok(!/\u2028|\u2029/.test(r.stdout), 'no line separator reaches the Stop output');
});
