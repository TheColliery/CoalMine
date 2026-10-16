// 15b5 CWK2-039: scripts/verify.mjs holds the Claude Code hook manifests (hooks/hooks.json and its plugin/ twin) to the exec form, INCLUDING
// type === 'command' -- a missing type or a prompt/agent hook FAILs (CoalFace 0cbce52 is the exemplar). Before this the exec-form shape lived only in
// hooks-exec-form.test.mjs; the gate itself read no `type`. Each case copies the tree (no .git, no scratch), breaks ONE thing in ONE manifest, runs
// the real verify.mjs capped and timed, and asserts a named FAIL line plus a non-zero exit. HOME and USERPROFILE are sandboxed with TEMP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function copy(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-vhm-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const skip = new Set(['.git', 'scratchpad', '.claude', 'node_modules', 'dist-claude-ai']);
  fs.cpSync(repo, dir, { recursive: true, filter: (src) => !skip.has(path.basename(src)) });
  const run = () => spawnSync(process.execPath, [path.join(dir, 'scripts', 'verify.mjs')], {
    cwd: dir, encoding: 'utf8', timeout: 100000, killSignal: 'SIGKILL',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048', TEMP: dir, TMP: dir, TMPDIR: dir, HOME: dir, USERPROFILE: dir },
  });
  return { dir, run };
}
const edit = (file, fn) => { const j = JSON.parse(fs.readFileSync(file, 'utf8')); fn(j.hooks.SessionStart[0].hooks[0]); fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n'); };

test('verify.mjs passes the shipped manifests and names the exec-form block (control)', (t) => {
  const { run } = copy(t);
  const r = run();
  assert.equal(r.status, 0, r.stdout.slice(-600) + r.stderr.slice(-300));
  assert.match(r.stdout, /Claude Code hook manifests \(exec form\):/);
  assert.match(r.stdout, /hooks\/hooks\.json SessionStart -> \$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/coalmine-conductor\.js/);
  assert.match(r.stdout, /plugin\/hooks\/hooks\.json SessionStart -> /);
});

const CASES = [
  ['a hook with no type', (h) => { delete h.type; }, /hooks\/hooks\.json SessionStart: type is undefined/],
  ['a prompt hook', (h) => { h.type = 'prompt'; delete h.command; delete h.args; h.prompt = 'x'; }, /hooks\/hooks\.json SessionStart: type is "prompt"/],
  ['an agent hook', (h) => { h.type = 'agent'; }, /hooks\/hooks\.json SessionStart: type is "agent"/],
  ['a shell-string command', (h) => { h.command = 'node "${CLAUDE_PLUGIN_ROOT}/hooks/coalmine-conductor.js"'; delete h.args; }, /hooks\/hooks\.json SessionStart: command is /],
  ['args that name a script outside the plugin root placeholder', (h) => { h.args = ['hooks/coalmine-conductor.js']; }, /hooks\/hooks\.json SessionStart: args must be/],
  ['a stray onFailure field', (h) => { h.onFailure = 'block'; }, /hooks\/hooks\.json SessionStart: no "shell" or "onFailure"/],
];
for (const [label, mutate, want] of CASES) {
  test(`verify.mjs FAILs ${label} in hooks/hooks.json`, (t) => {
    const { dir, run } = copy(t);
    edit(path.join(dir, 'hooks', 'hooks.json'), mutate);
    const r = run();
    assert.notEqual(r.status, 0, 'a broken manifest must fail the gate');
    assert.match(r.stdout, want);
  });
}

test('verify.mjs FAILs a hook with no type in the plugin/ twin as well', (t) => {
  const { dir, run } = copy(t);
  edit(path.join(dir, 'plugin', 'hooks', 'hooks.json'), (h) => { delete h.type; });
  const r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /plugin\/hooks\/hooks\.json SessionStart: type is undefined/);
});
