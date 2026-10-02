// R14 BUILD part A, ruling item 10 (the code halves of the LOW pointers): CSV-3, CSV-5, CSV-10, B-u1-4a,
// B-u1-20b, B-u1-L4, B-u1-L18, B-u3-5. Each test goes red against the pre-R14 code (scratchpad/r14/red-item3.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyAgainstManifest } from './manifest.mjs';
import { renderSkillMd } from './render.mjs';
import { MAX_DOC_BYTES } from './repo-fs.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOUCH = path.join(repo, 'hooks', 'rot-canary-touch.js');
const STOP = path.join(repo, 'hooks', 'rot-canary-stop.js');
const CONDUCTOR = path.join(repo, 'hooks', 'coalmine-conductor.js');

function mkDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function runNode(script, input, cwd, tmp) {
  return spawnSync(process.execPath, [script], {
    input, encoding: 'utf8', cwd, timeout: 60000, killSignal: 'SIGKILL',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048', TEMP: tmp, TMP: tmp, TMPDIR: tmp, USERPROFILE: tmp, HOME: tmp },
  });
}

test('manifest verification reads and hashes a file once however many alias keys name it (CSV-3)', (t) => {
  const dir = mkDir(t, 'cm-r14-man-');
  fs.mkdirSync(path.join(dir, 'a'));
  const file = path.join(dir, 'a', 'SKILL.md');
  fs.writeFileSync(file, 'body\n');
  const h = createHash('sha256').update('body\n').digest('hex');
  fs.writeFileSync(path.join(dir, '.coalmine-manifest.json'), JSON.stringify({
    hashes: { 'a/SKILL.md': h, 'a/./SKILL.md': h, 'a/../a/SKILL.md': h, 'a//SKILL.md': h },
  }));
  const realOpen = fs.openSync;
  let opens = 0;
  fs.openSync = function patched(p, ...rest) { if (path.resolve(String(p)) === path.resolve(file)) opens++; return realOpen.call(this, p, ...rest); };
  let res;
  try { res = verifyAgainstManifest(dir); } finally { fs.openSync = realOpen; }
  assert.equal(res.ok, true, JSON.stringify(res.findings));
  assert.equal(opens, 1, 'one open for four alias keys');
});

test('renderSkillMd refuses an over-bound SKILL.md instead of slurping it (CSV-5)', (t) => {
  const dir = mkDir(t, 'cm-r14-render-');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), Buffer.alloc(MAX_DOC_BYTES + 1, 0x61));
  assert.throws(() => renderSkillMd(dir, {}), /unreadable, not a regular file, or over/);
});

test('the touch hook reads a top-level file_path, toolArgs and TargetFile (B-u1-4a)', (t) => {
  const sandbox = mkDir(t, 'cm-r14-sbx-');
  const proj = mkDir(t, 'cm-r14-proj-');
  const code = path.join(proj, 'x.js');
  fs.writeFileSync(code, 'const x = 1;\n');
  const shapes = {
    TOP: { file_path: code },
    TARGS: { toolArgs: { path: code } },
    TARGET: { toolCall: { args: { TargetFile: code } } },
  };
  for (const [sid, shape] of Object.entries(shapes)) {
    const r = runNode(TOUCH, JSON.stringify({ session_id: sid, ...shape }), proj, sandbox);
    assert.equal(r.status, 0);
    const rec = path.join(sandbox, 'coalmine', `rot-canary-${sid}.touched`);
    assert.ok(fs.existsSync(rec), `${sid}: the edit was recorded`);
    assert.ok(fs.readFileSync(rec, 'utf8').includes('x.js'));
  }
});

test('a language named like an Object.prototype member does not kill the Stop hook (B-u1-L4)', (t) => {
  const sandbox = mkDir(t, 'cm-r14-lang-');
  const proj = path.join(sandbox, 'proj');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'coalmine'), { mode: 0o700 });
  fs.writeFileSync(path.join(proj, '.coalmine.json'), JSON.stringify({ language: 'constructor' }));
  const code = path.join(proj, 'a.js');
  fs.writeFileSync(code, 'x');
  fs.writeFileSync(path.join(sandbox, 'coalmine', 'rot-canary-LANG.touched'), code + '\n');
  const r = runNode(STOP, JSON.stringify({ session_id: 'LANG', stop_hook_active: false }), proj, sandbox);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout || '{}');
  assert.equal(out.decision, 'block', 'the scan request still reaches the model');
  assert.ok(out.reason.includes('a.js'));
});

test('the conductor examines at most 200 stamp openers per document (CSV-10)', (t) => {
  const dir = mkDir(t, 'cm-r14-stamps-');
  fs.mkdirSync(path.join(dir, '.git'));
  const stamp = '<!-- coalmine: verified 2020-01-01 revalidate 30d -->\n';
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), stamp.repeat(300));
  const r = runNode(CONDUCTOR, '', dir, dir);
  assert.equal(r.status, 0);
  const m = /(\d+) gold-standard rule\(s\) are past their revalidate date/.exec(r.stdout);
  assert.ok(m, `the past-due directive fired: ${r.stdout.slice(0, 300)}`);
  assert.equal(Number(m[1]), 200, 'bounded at the declared cap, not 300');
});

test('every shipped command hook declares a timeout (B-u1-L18)', () => {
  for (const f of ['hooks/hooks.json', 'plugin/hooks/hooks.json']) {
    const cfg = JSON.parse(fs.readFileSync(path.join(repo, f), 'utf8'));
    let n = 0;
    for (const groups of Object.values(cfg.hooks)) {
      for (const g of groups) {
        for (const h of g.hooks) {
          n++;
          assert.ok(Number.isInteger(h.timeout) && h.timeout > 0 && h.timeout <= 60, `${f}: ${h.command} has a bounded timeout`);
        }
      }
    }
    assert.equal(n, 3, `${f}: the three hooks`);
  }
});

test('dependabot auto-merge enables only on an explicit patch or minor update-type (B-u1-20b)', () => {
  const wf = fs.readFileSync(path.join(repo, '.github', 'workflows', 'dependabot-auto-merge.yml'), 'utf8');
  const cond = /if: \$\{\{ (.*) \}\}/.exec(wf.split('Enable auto-merge')[1] || '');
  assert.ok(cond, 'the merge step has an if');
  assert.ok(cond[1].includes('version-update:semver-patch') && cond[1].includes('version-update:semver-minor'), 'allow-list of the two types');
  assert.ok(!cond[1].includes('!='), 'not a deny-list on major');
});

test('the eval-06 lexical grader flags an asserted-dead collect and passes the negated, correct statements (B-u3-5)', () => {
  const md = fs.readFileSync(path.join(repo, 'evals', '06-neg-clean-lookalike', 'graders', 'does-not-call-collect-dead.md'), 'utf8');
  const pattern = md.split('\n---\n')[1].trim();
  const re = new RegExp(pattern, 'i');
  for (const bad of ['collect appears dead.', 'The function collect is unused.', 'collect is never called anywhere']) {
    assert.ok(re.test(bad), `flagged: ${bad}`);
  }
  for (const good of ['collect has no caller here, but it is not dead.', 'collect is exported, so it isn\'t unused.', 'No: collect is not never-called code.']) {
    assert.ok(!re.test(good), `not flagged (a correct answer): ${good}`);
  }
});
