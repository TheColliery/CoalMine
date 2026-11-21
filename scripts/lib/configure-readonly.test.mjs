// T-29mk-D2 (card, LOW, ruled once for the flock): a config or user file CoalMine would write, replace or move aside that EXISTS with no write bit is refused
// by name. It is never chmodded and never replaced; the run prints one sentence naming the file (`read-only; nothing was written`) with the fix, writes NOTHING and
// exits 1. The assertions read the MODE and the BYTES, never EACCES (a POSIX root ignores the write bit, so a root run skips visibly).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTree } from './test-sandbox.mjs';
import { makeRoot } from './read-window.mjs';

const ROOM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIGURE = path.join(ROOM, 'scripts', 'configure.mjs');
const INSTALL = path.join(ROOM, 'scripts', 'install.mjs');
const ORIG = '{ "autoScanFileCap": 7 }\n';
const READONLY = 0o444;
const ROOT_USER = typeof process.getuid === 'function' && process.getuid() === 0;
const SKIP_ROOT = 'running as root: a root process ignores the write bit, so the refusal cannot be seen on this run (skipped visibly)';

// A project with a git root marker (the .git folder is only an anchor here; no git command runs on the refused path).
function project(root) {
  const proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  return proj;
}

// The child's environment: HOME, USERPROFILE and XDG_CONFIG_HOME inside the root (the room's git-sandbox lesson), temp folders inside the root.
function sandboxEnv(root) {
  const home = path.join(root, 'home');
  const tmp = path.join(root, 'tmp');
  const env = { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), TEMP: tmp, TMP: tmp, TMPDIR: tmp };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return env;
}

function runNode(script, args, cwd, root) {
  return spawnSync(process.execPath, [script, ...args], { cwd, env: sandboxEnv(root), encoding: 'utf8', timeout: 60000 });
}

const bytesOf = (p) => fs.readFileSync(p);
const modeOf = (p) => fs.statSync(p).mode & 0o777;
const namesIn = (dir) => fs.readdirSync(dir).sort();

// The file is read-only for the body only. Its write bit comes back in a finally path, so the sandbox can always be removed.
function withReadOnly(p, body) {
  fs.chmodSync(p, READONLY);
  try { return body(); } finally { fs.chmodSync(p, 0o644); }
}

function assertRefusedByName(r, file) {
  const text = r.stdout + r.stderr;
  assert.match(text, /read-only; nothing was written/, `the run says the file is read-only and nothing was written: ${text}`);
  assert.ok(text.includes(file), `the run names the file ${file}: ${text}`);
  assert.match(text, /make the file writable if you mean to change it/, 'the run gives the fix');
  assert.doesNotMatch(text, /will not read, back up, or write a config through a link/, 'a read-only file gets no link advice');
}

test('configure: a project config with no write bit is refused by name, its bytes and mode kept, and nothing new written (exit 1)', (t) => {
  if (ROOT_USER) { t.skip(SKIP_ROOT); return; }
  const root = makeRoot('cm-ro-proj-', removeTree, t);
  const proj = project(root);
  const dir = path.join(proj, '.claude', 'coal');
  fs.mkdirSync(dir, { recursive: true });
  const cfg = path.join(dir, 'coalmine.json');
  fs.writeFileSync(cfg, ORIG);
  const before = namesIn(dir);
  withReadOnly(cfg, () => {
    const r = runNode(CONFIGURE, ['--autoScanFileCap', '9'], proj, root);
    assert.equal(r.status, 1, `a read-only project config exits 1: ${r.stdout}${r.stderr}`);
    assert.deepEqual(bytesOf(cfg), Buffer.from(ORIG), 'the config keeps its bytes');
    assert.equal(modeOf(cfg), READONLY, 'the config keeps its mode: never chmodded');
    assert.deepEqual(namesIn(dir), before, 'nothing new was written beside it: no temp, no backup');
    assertRefusedByName(r, cfg);
  });
});

test('configure: a legacy migration whose backup is read-only is refused before the new home is written, and the legacy file is unchanged', (t) => {
  if (ROOT_USER) { t.skip(SKIP_ROOT); return; }
  const root = makeRoot('cm-ro-bak-', removeTree, t);
  const proj = project(root);
  const legacy = path.join(proj, '.coalmine.json');
  fs.writeFileSync(legacy, ORIG);
  const bak = legacy + '.bak';
  fs.writeFileSync(bak, 'OLD BACKUP\n');
  const newHome = path.join(proj, '.claude', 'coal', 'coalmine.json');
  withReadOnly(bak, () => {
    const r = runNode(CONFIGURE, ['--autoScanFileCap', '9'], proj, root);
    assert.equal(r.status, 1, `a read-only migration backup exits 1: ${r.stdout}${r.stderr}`);
    assert.deepEqual(bytesOf(legacy), Buffer.from(ORIG), 'the legacy file keeps its bytes');
    assert.equal(fs.existsSync(newHome), false, 'no new home is written: the backup is refused before the first write');
    assert.deepEqual(bytesOf(bak), Buffer.from('OLD BACKUP\n'), 'the read-only backup keeps its bytes');
    assert.equal(modeOf(bak), READONLY, 'the backup keeps its mode');
    assertRefusedByName(r, bak);
  });
});

test('configure: a malformed project config whose backup is read-only is refused before anything is written, and the config is unchanged', (t) => {
  if (ROOT_USER) { t.skip(SKIP_ROOT); return; }
  const root = makeRoot('cm-ro-malf-', removeTree, t);
  const proj = project(root);
  const dir = path.join(proj, '.claude', 'coal');
  fs.mkdirSync(dir, { recursive: true });
  const cfg = path.join(dir, 'coalmine.json');
  const malformed = '{ "autoScanFileCap": 7 ';
  fs.writeFileSync(cfg, malformed);
  const bak = cfg + '.bak';
  fs.writeFileSync(bak, 'OLD BACKUP\n');
  withReadOnly(bak, () => {
    const r = runNode(CONFIGURE, ['--autoScanFileCap', '9'], proj, root);
    assert.equal(r.status, 1, `a malformed config with a read-only backup exits 1: ${r.stdout}${r.stderr}`);
    assert.deepEqual(bytesOf(cfg), Buffer.from(malformed), 'the malformed config is not rebuilt over: it keeps its bytes');
    assert.deepEqual(bytesOf(bak), Buffer.from('OLD BACKUP\n'), 'the read-only backup keeps its bytes');
    assert.equal(modeOf(bak), READONLY, 'the backup keeps its mode');
    assertRefusedByName(r, bak);
  });
});

test('configure --global: a global config with no write bit is refused by name, its bytes and mode kept (HOME sandboxed)', (t) => {
  if (ROOT_USER) { t.skip(SKIP_ROOT); return; }
  const root = makeRoot('cm-ro-glob-', removeTree, t);
  const proj = project(root);
  const gdir = path.join(root, 'home', '.claude');
  fs.mkdirSync(gdir, { recursive: true });
  const gcfg = path.join(gdir, '.coalmine.json');
  fs.writeFileSync(gcfg, ORIG);
  withReadOnly(gcfg, () => {
    const r = runNode(CONFIGURE, ['--global', '--autoScanFileCap', '9'], proj, root);
    assert.equal(r.status, 1, `a read-only global config exits 1: ${r.stdout}${r.stderr}`);
    assert.deepEqual(bytesOf(gcfg), Buffer.from(ORIG), 'the global config keeps its bytes');
    assert.equal(modeOf(gcfg), READONLY, 'the global config keeps its mode: never chmodded');
    assertRefusedByName(r, gcfg);
  });
});

test('install --uninstall cline: a read-only .clinerules is refused, untouched, and no backup is made', (t) => {
  if (ROOT_USER) { t.skip(SKIP_ROOT); return; }
  const root = makeRoot('cm-ro-cline-', removeTree, t);
  const proj = project(root);
  const rules = path.join(proj, '.clinerules');
  const content = 'user rule\n\n# COALMINE:START\nblock\n# COALMINE:END\n';
  fs.writeFileSync(rules, content);
  withReadOnly(rules, () => {
    const r = runNode(INSTALL, ['--uninstall', 'cline'], proj, root);
    assert.equal(r.status, 1, `a read-only trigger config exits 1: ${r.stdout}${r.stderr}`);
    assert.deepEqual(bytesOf(rules), Buffer.from(content), 'the trigger config keeps its bytes');
    assert.equal(modeOf(rules), READONLY, 'the trigger config keeps its mode');
    assert.equal(fs.existsSync(rules + '.bak'), false, 'no backup is made beside it');
    assertRefusedByName(r, rules);
  });
});
