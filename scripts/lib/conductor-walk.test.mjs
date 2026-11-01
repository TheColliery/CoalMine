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
// The preload source is a constant: the log path reaches it through the environment (CM_WALK_LOG), never through the generated code.
function preload(dir) {
  const file = path.join(dir, 'count-preload.mjs');
  const log = path.join(dir, 'walk-log.json');
  fs.writeFileSync(file, [
    "import fs from 'node:fs';",
    'const opens = [];',
    'const reads = [];',
    'const dirs = [];',
    'const realOpen = fs.openSync;',
    'fs.openSync = function (p, ...rest) { opens.push(String(p)); return realOpen.call(this, p, ...rest); };',
    'const realRead = fs.readFileSync;',
    'fs.readFileSync = function (p, ...rest) { reads.push(String(p)); return realRead.call(this, p, ...rest); };',
    'const realReaddir = fs.readdirSync;',
    'fs.readdirSync = function (p, ...rest) { dirs.push(String(p)); return realReaddir.call(this, p, ...rest); };',
    "process.on('exit', () => { fs.writeFileSync(process.env.CM_WALK_LOG, JSON.stringify({ opens, reads, dirs })); });",
    '',
  ].join('\n'));
  return { url: pathToFileURL(file).href, log };
}

// Runs the conductor once (CC path: no argv, empty stdin) and returns its exit status, stderr and the document opens under rules/.
function runConductor(dir) {
  const pre = preload(dir);
  const r = spawnSync(process.execPath, ['--import', pre.url, CONDUCTOR], {
    input: '', encoding: 'utf8', cwd: dir, timeout: 60000,
    env: { ...process.env, TEMP: dir, TMP: dir, TMPDIR: dir, USERPROFILE: dir, HOME: dir, CM_WALK_LOG: pre.log },
  });
  const log = JSON.parse(fs.readFileSync(pre.log, 'utf8'));
  // Both primitives count: a document read through openSync (the bounded reader) and one read through readFileSync are each one event.
  const every = [...log.opens, ...log.reads];
  const ruleOpens = every.filter((p) => /[\\/]rules[\\/]/.test(p));
  const ruleListings = log.dirs.filter((p) => /[\\/]rules$/.test(p));
  return { status: r.status, stderr: r.stderr, ruleOpens, ruleListings, opens: every };
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

// A file link is judged against the folder it sits in (repo-fs entryInsideItsFolder): its real path must lie inside that folder.
// So the dedupe case is the real document in the SAME rules folder as its links, and a link into another folder is refused.
test('the conductor reads a document reached through several links in its own folder once, not once per link', (t) => {
  const dir = sandbox(t);
  const rules = path.join(dir, '.claude', 'rules');
  fs.mkdirSync(rules, { recursive: true });
  const real = path.join(rules, 'real.md');
  fs.writeFileSync(real, '# shared rule\n', 'utf8');
  try {
    for (const name of ['a.md', 'b.md', 'c.md']) fs.symlinkSync(real, path.join(rules, name), 'file');
  } catch (e) {
    t.skip(`this volume refuses file symbolic links (${e.code}): the dedupe leg needs Developer Mode or a Unix runner, so it is CI-proven only here`);
    return;
  }
  const r = runConductor(dir);
  assert.equal(r.status, 0, 'fail-silent: exit 0 (Phoenix #4)');
  assert.equal(r.ruleOpens.length, 1, 'three links and the real document share one real path: one open, the rest skipped');
  assert.equal(fs.realpathSync.native(r.ruleOpens[0]), fs.realpathSync.native(real), 'the one open is the shared document, whichever name the walk reached first');
});

test('the conductor never opens a link whose target lies outside the folder the link sits in', (t) => {
  const dir = sandbox(t);
  const outside = path.join(dir, 'docs', 'real.md');
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, '# another folder\n', 'utf8');
  const rules = path.join(dir, '.claude', 'rules');
  fs.mkdirSync(rules, { recursive: true });
  fs.writeFileSync(path.join(rules, 'keep.md'), '# kept\n', 'utf8'); // the walk's proof: an ordinary document beside the refused link
  try {
    fs.symlinkSync(outside, path.join(rules, 'escape.md'), 'file');
  } catch (e) {
    t.skip(`this volume refuses file symbolic links (${e.code}): the refusal leg needs Developer Mode or a Unix runner, so it is CI-proven only here`);
    return;
  }
  const r = runConductor(dir);
  assert.equal(r.status, 0, 'fail-silent: exit 0 (Phoenix #4)');
  assert.ok(!r.opens.some((p) => /(escape|real)\.md$/.test(p)), 'the link leaves its folder: neither the link nor its target is opened');
  assert.ok(r.ruleOpens.some((p) => /keep\.md$/.test(p)), 'the walk ran: the ordinary document beside the link is opened');
  assert.equal(r.ruleListings.length, 1, 'the rules folder was listed');
});
