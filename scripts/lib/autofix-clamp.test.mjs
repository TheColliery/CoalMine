// 16f row 17 (CWK2-044, the chief's ruling (a)): `autoFixMode` from a project config may only LOWER it (safe -> interactive -> off), `safe` counts only from the user's global config,
// and an absent global is the schema default `interactive` (hooks-safety.md section 9: the clamp must not skip the factory default). The agent still reads the key itself, so the hooks
// EMIT the effective value on the channels they already own: the conductor's SessionStart context and the rot-canary Stop hook's scan report (the block `reason`).
// Hermetic spawn tests (hooks-safety section 7): the real hook files, HOME/USERPROFILE/TEMP in a throwaway folder, the project a throwaway git root, children heap-capped and timed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTree } from './test-sandbox.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SURFACES = ['hooks', 'plugin/hooks'];
const NAMES = { conductor: 'coalmine-conductor.js', stop: 'rot-canary-stop.js' };
const LINE = /^(?:- )?\[CoalMine\] autoFixMode in effect: (\w+) \((.*)\)$/m;

function fixture(t, { global, project }) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-autofix-'));
  t.after(() => removeTree(root));
  const home = path.join(root, 'home');
  const proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(home, 'coalmine'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  if (global !== undefined) fs.writeFileSync(path.join(home, '.claude', '.coalmine.json'), JSON.stringify(global));
  if (project !== undefined) {
    fs.mkdirSync(path.join(proj, '.claude', 'coal'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.claude', 'coal', 'coalmine.json'), JSON.stringify(project));
  }
  return { home, proj };
}

function run(surface, which, { home, proj }) {
  const script = path.join(repo, surface, NAMES[which]);
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: home, TMP: home, TMPDIR: home, USERPROFILE: home, HOME: home };
  let input = '';
  if (which === 'stop') {
    const f = path.join(proj, 'edited.js');
    fs.writeFileSync(f, 'x\n');
    fs.writeFileSync(path.join(home, 'coalmine', 'rot-canary-AF1.touched'), `${f}\n`);
    input = JSON.stringify({ session_id: 'AF1', cwd: proj, stop_hook_active: false });
  }
  const r = spawnSync(process.execPath, ['--max-old-space-size=512', script], { cwd: proj, input, encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', env });
  assert.equal(r.status, 0, `${which}: exit 0 (${r.stderr.slice(0, 200)})`);
  assert.equal(r.stderr, '', `${which}: no stderr`);
  return r.stdout;
}

// What the agent is told, per surface: the effective mode and the why. null = no line at all.
function effective(surface, which, cfgs, t) {
  const out = run(surface, which, fixture(t, cfgs));
  const text = which === 'stop' ? (JSON.parse(out).reason || '') : out;
  const m = LINE.exec(text);
  return m ? { mode: m[1], why: m[2] } : null;
}

const LEGS = [
  ['a project "safe" with NO global is lowered to the factory default interactive', { project: { autoFixMode: 'safe' } }, 'interactive', /lowered/],
  ['a project "safe" over a global "interactive" is lowered to interactive', { global: { autoFixMode: 'interactive' }, project: { autoFixMode: 'safe' } }, 'interactive', /lowered/],
  ['a project "SAFE" in another case is still lowered (case-folded before the lookup)', { project: { autoFixMode: 'SAFE' } }, 'interactive', /lowered/],
  ['a project "OFF" in upper case over a global "safe" is off (the safer value is honoured when case-folded)', { global: { autoFixMode: 'safe' }, project: { autoFixMode: 'OFF' } }, 'off', /project config/],
  ['a global "safe" with no project config stays safe', { global: { autoFixMode: 'safe' } }, 'safe', /from the global config/],
  ['a global "safe" and a project "safe" stays safe', { global: { autoFixMode: 'safe' }, project: { autoFixMode: 'safe' } }, 'safe', /project config/],
  ['a global "safe" and a project "off" is off (a project may lower)', { global: { autoFixMode: 'safe' }, project: { autoFixMode: 'off' } }, 'off', /project config/],
  ['a project "off" with no global is off', { project: { autoFixMode: 'off' } }, 'off', /project config/],
  ['a global "off" and a project "safe" stays off', { global: { autoFixMode: 'off' }, project: { autoFixMode: 'safe' } }, 'off', /lowered/],
  ['a junk project value is ignored: no global reads interactive', { project: { autoFixMode: 'ultra' } }, 'interactive', /ignored/],
  ['a junk project value is ignored: a global "safe" still decides', { global: { autoFixMode: 'safe' }, project: { autoFixMode: 'ultra' } }, 'safe', /ignored/],
  ['a null project value is ignored like any other junk', { global: { autoFixMode: 'off' }, project: { autoFixMode: null } }, 'off', /ignored/],
  ['a junk GLOBAL value reads as the factory default', { global: { autoFixMode: 'bogus' } }, 'interactive', /factory default/],
];

for (const surface of SURFACES) {
  for (const which of ['conductor', 'stop']) {
    for (const [name, cfgs, mode, why] of LEGS) {
      test(`${surface} ${which}: ${name}`, (t) => {
        const got = effective(surface, which, cfgs, t);
        assert.ok(got, 'the hook emits the autoFixMode line when a config sets the key');
        assert.equal(got.mode, mode);
        assert.match(got.why, why);
      });
    }
    test(`${surface} ${which}: with no config setting the key there is NO autoFixMode line (nothing to say, Phoenix #13)`, (t) => {
      assert.equal(effective(surface, which, { project: { skipOnboarding: true } }, t), null);
      assert.equal(effective(surface, which, {}, t), null);
    });
  }
}

test('hooks/ and plugin/hooks/ carry the same autoFixMode behaviour (the plugin twins are rebuilt, not hand-edited)', () => {
  for (const n of Object.values(NAMES)) {
    const a = fs.readFileSync(path.join(repo, 'hooks', n), 'utf8');
    const b = fs.readFileSync(path.join(repo, 'plugin', 'hooks', n), 'utf8');
    assert.equal(a, b, `${n} is byte-identical in hooks/ and plugin/hooks/`);
  }
});

test('the touch hook carries the merge clamp but not the emit (it never reads the value)', () => {
  const touch = fs.readFileSync(path.join(repo, 'hooks', 'rot-canary-touch.js'), 'utf8');
  assert.match(touch, /autoFixMode: \{ order: \['off', 'interactive', 'safe'\], default: 'interactive' \}/);
  assert.ok(!/function autoFixLine/.test(touch), 'no unused autoFixLine in the touch hook (a CodeQL unused-function finding)');
});
