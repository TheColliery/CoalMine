// c37 item 3.4 (hook): the conductor's rule-document walk reads each REAL document once, and stops silently past a cumulative byte budget.
// Witnesses are counts, never a clock: a preload (--import) wraps fs.openSync and fs.readdirSync and writes what the conductor opened
// on exit, so the test counts the document opens the walk makes. Hermetic: every fixture is a temp folder under os.tmpdir().
// The hook stays fail-silent (exit 0, empty stderr). The dedupe leg needs file symlinks; it probes for them and skips visibly when the
// volume refuses (Windows without Developer Mode); the budget leg needs nothing and runs everywhere. Zero-dep (node:test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONDUCTOR = path.join(repo, 'hooks', 'coalmine-conductor.js');
const MIB = 1024 * 1024;

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-walk-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  fs.mkdirSync(path.join(dir, '.git')); // anchors the walk inside the sandbox (the conductor's project root)
  return dir;
}

// The preload counts the document opens and the rules-folder listings the conductor makes, and writes them on exit.
function preload(dir) {
  const file = path.join(dir, 'count-preload.mjs');
  const log = path.join(dir, 'walk-log.json');
  fs.writeFileSync(file, [
    "import fs from 'node:fs';",
    'const opens = [];',
    'const dirs = [];',
    'const realOpen = fs.openSync;',
    'fs.openSync = function (p, ...rest) { opens.push(String(p)); return realOpen.call(this, p, ...rest); };',
    'const realReaddir = fs.readdirSync;',
    'fs.readdirSync = function (p, ...rest) { dirs.push(String(p)); return realReaddir.call(this, p, ...rest); };',
    `process.on('exit', () => { realOpen; fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ opens, dirs })); });`,
    '',
  ].join('\n'));
  return { url: pathToFileURL(file).href, log };
}

// Runs the conductor once (CC path: no argv, empty stdin) and returns its exit status, stderr and the document opens under rules/.
function runConductor(dir) {
  const pre = preload(dir);
  const r = spawnSync(process.execPath, ['--import', pre.url, CONDUCTOR], {
    input: '', encoding: 'utf8', cwd: dir, timeout: 60000,
    env: { ...process.env, TEMP: dir, TMP: dir, TMPDIR: dir, USERPROFILE: dir, HOME: dir },
  });
  const log = JSON.parse(fs.readFileSync(pre.log, 'utf8'));
  const ruleOpens = log.opens.filter((p) => /[\\/]rules[\\/]/.test(p));
  const ruleListings = log.dirs.filter((p) => /[\\/]rules$/.test(p));
  return { status: r.status, stderr: r.stderr, ruleOpens, ruleListings };
}

test('the conductor opens each rule document once per run, and stops at a cumulative byte budget without a word', (t) => {
  const dir = sandbox(t);
  const rules = path.join(dir, '.claude', 'rules');
  fs.mkdirSync(rules, { recursive: true });
  // Three 3 MiB documents: each is under the per-document bound, and together they pass the 8 MiB walk budget.
  for (const name of ['one.md', 'two.md', 'three.md']) fs.writeFileSync(path.join(rules, name), 'x'.repeat(3 * MIB), 'utf8');
  const r = runConductor(dir);
  assert.equal(r.status, 0, 'fail-silent: exit 0 (Phoenix #4)');
  assert.equal(r.stderr, '', 'no stderr past the budget (Phoenix #13)');
  assert.equal(r.ruleListings.length, 1, 'the rules folder is listed once per run');
  assert.equal(r.ruleOpens.length, 2, 'two documents fit the 8 MiB walk budget; the third is never opened');
});

test('the conductor reads a document reached through several links once, not once per link', (t) => {
  const dir = sandbox(t);
  const real = path.join(dir, 'docs', 'real.md');
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.writeFileSync(real, '# shared rule\n', 'utf8');
  const rules = path.join(dir, '.claude', 'rules');
  fs.mkdirSync(rules, { recursive: true });
  try {
    for (const name of ['a.md', 'b.md', 'c.md']) fs.symlinkSync(real, path.join(rules, name), 'file');
  } catch (e) {
    t.skip(`this volume refuses file symbolic links (${e.code}): the dedupe leg needs Developer Mode or a Unix runner, so it is not run here`);
    return;
  }
  const r = runConductor(dir);
  assert.equal(r.status, 0, 'fail-silent: exit 0 (Phoenix #4)');
  assert.equal(r.ruleOpens.length, 1, 'three links to one real document: one open, the other two are skipped by the real path');
});
