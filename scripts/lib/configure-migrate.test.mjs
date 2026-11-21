// 29kk B1, moved aside under BB-533 (T-29lk-1, T-29mc-1, T-29mc-2). configure.mjs migrates a legacy root config to its new home, then MOVES the legacy file
// aside to <legacy>.bak by one rename (never removes it in place). The rename is the only destroying call. Its read-back compares the backup with the bytes
// read before the move. A change in between is kept in the backup, both files are named, the new config is still written, and the run exits 1.
// Witness: scripts/lib/read-window.mjs (a real child, a --require preload). W-c1 changes the file at the destroying call alone (openNth 0), the case the
// old re-check missed; W-b1 writes into the backup after the rename, caught by the read-back; W-b2 refuses the move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeTree } from './test-sandbox.mjs';
import { makeRoot, runScript, gitInit, gitAdd, gitAvailable } from './read-window.mjs';

const ROOM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIGURE = path.join(ROOM, 'scripts', 'configure.mjs');
const ORIG = '{ "autoScanFileCap": 7 }\n';

// A project with a git root and a LEGACY root dotfile (`.coalmine.json`), the shape configure migrates.
function legacyProject(t) {
  const root = makeRoot('cm-cfgmig-', removeTree, t);
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  gitInit(proj, root);
  const legacy = path.join(proj, '.coalmine.json');
  fs.writeFileSync(legacy, ORIG);
  return { root, proj, legacy, bak: legacy + '.bak' };
}

// The new config the success line names, parsed back.
function writtenCap(stdout) {
  const m = /Successfully updated configuration in: (.+)/.exec(stdout);
  assert.ok(m, `the success line names the written config: ${stdout}`);
  return JSON.parse(fs.readFileSync(m[1].trim(), 'utf8')).autoScanFileCap;
}

// The new config a warning names: "The new config (<path>)".
function newConfigPath(text) {
  const m = /new config \(([^)]+)\)/.exec(text);
  assert.ok(m, `a warning names the new config: ${text}`);
  return m[1];
}

// The legacy file changes after the seed and is moved aside: the backup holds the change, both files are named, the new config is written, exit 1.
function changedLeg(t, { mode, openNth, bytes, expectedBak }) {
  const { root, proj, legacy, bak } = legacyProject(t);
  const r = runScript(root, proj, CONFIGURE, ['--autoScanFileCap', '9'], { target: legacy, bytes, act: legacy, mode, openNth });
  assert.ok(r.injected, 'the change was written before the destroying call (the leg is not vacuous)');
  assert.equal(r.status, 1, `a changed legacy file exits 1: ${r.stdout}${r.stderr}`);
  assert.equal(fs.existsSync(legacy), false, 'the legacy file is moved aside, not left in place');
  assert.deepEqual(fs.readFileSync(bak), expectedBak, 'the backup holds the bytes that were on disk when the file moved');
  const text = r.stdout + r.stderr;
  assert.ok(text.includes(legacy) && text.includes(bak), 'the warning names both the legacy file and its backup');
  assert.match(text, /changed while it was moved aside/, 'the warning says the file changed during the move');
  assert.doesNotMatch(r.stdout, /Migrated the project config/, 'no Migrated line for a move that found a change');
  assert.doesNotMatch(r.stdout, /Successfully updated/, 'no success line for a move that found a change');
  assert.equal(JSON.parse(fs.readFileSync(newConfigPath(text), 'utf8')).autoScanFileCap, 9, 'the new config is still written with the new value');
}

test('configure: a legacy config changed after its read (an appended line) is moved aside with the change, the new config is still written, and the run exits 1', (t) => {
  const bytes = Buffer.from('// the user added this line\n');
  changedLeg(t, { mode: 'append', openNth: 2, bytes, expectedBak: Buffer.concat([Buffer.from(ORIG), bytes]) });
});

test('configure: a legacy config changed after its read (a same-size replace) is moved aside with the change, the new config is still written, and the run exits 1', (t) => {
  const bytes = Buffer.from(ORIG.replace('7', '5'));
  changedLeg(t, { mode: 'replace', openNth: 2, bytes, expectedBak: bytes });
});

test('configure: a legacy config that changes at the destroying call, with no read after the seed, keeps its change in the backup and exits 1 (W-c1)', (t) => {
  const bytes = Buffer.from('// the user added this line\n');
  changedLeg(t, { mode: 'append', openNth: 0, bytes, expectedBak: Buffer.concat([Buffer.from(ORIG), bytes]) });
});

test('configure: a writer that lands on the backup after the move is caught by the read-back, names both files, and exits 1 (W-b1)', (t) => {
  const { root, proj, legacy, bak } = legacyProject(t);
  const marker = Buffer.from('// written after the move\n');
  const r = runScript(root, proj, CONFIGURE, ['--autoScanFileCap', '9'], { target: bak, bytes: marker, act: path.join(proj, 'never-named.json'), mode: 'append', openNth: 1 });
  assert.ok(r.injected, 'the writer ran before the read-back (the leg is not vacuous)');
  assert.equal(r.status, 1, `a backup written after the move exits 1: ${r.stdout}${r.stderr}`);
  assert.deepEqual(fs.readFileSync(bak), Buffer.concat([Buffer.from(ORIG), marker]), 'the backup holds what it held when the read-back ran');
  const text = r.stdout + r.stderr;
  assert.ok(text.includes(legacy) && text.includes(bak), 'the warning names both files');
  assert.doesNotMatch(r.stdout, /Migrated the project config/);
});

test('configure: a legacy config that cannot be moved aside is kept with no backup, prints neither Migrated nor Successfully updated, and exits 1 (W-b2)', (t) => {
  const { root, proj, legacy, bak } = legacyProject(t);
  const r = runScript(root, proj, CONFIGURE, ['--autoScanFileCap', '9'], { target: legacy, bytes: '', act: legacy, mode: 'throw', openNth: 0 });
  assert.equal(r.status, 1, `a refused move exits 1: ${r.stdout}${r.stderr}`);
  assert.deepEqual(fs.readFileSync(legacy), Buffer.from(ORIG), 'the legacy file keeps its bytes');
  assert.equal(fs.existsSync(bak), false, 'no backup is made when the move fails');
  const text = r.stdout + r.stderr;
  assert.match(text, /Kept .*\.coalmine\.json: it could not be moved aside/, 'the kept line names the legacy file and the failed move');
  assert.match(text, /\.coalmine\.json is kept/, 'the kept line says the legacy file is kept');
  assert.doesNotMatch(r.stdout, /Migrated the project config/);
  assert.doesNotMatch(r.stdout, /Successfully updated/);
});

test('configure: an earlier legacy backup is replaced by the move, and the line says so', (t) => {
  const { root, proj, legacy, bak } = legacyProject(t);
  fs.writeFileSync(bak, 'OLD BACKUP\n');
  const r = runScript(root, proj, CONFIGURE, ['--autoScanFileCap', '9'], null);
  assert.equal(r.status, 0, `an unchanged legacy file migrates, stderr: ${r.stderr}`);
  assert.deepEqual(fs.readFileSync(bak), Buffer.from(ORIG), 'the backup is now the file as it was read');
  assert.match(r.stdout, /replaced an earlier backup/, 'the line says an earlier backup was replaced');
});

test('configure: a legacy config that does not change is moved aside to its backup, the Migrated line printed, exit 0', (t) => {
  const { root, proj, legacy, bak } = legacyProject(t);
  const r = runScript(root, proj, CONFIGURE, ['--autoScanFileCap', '9'], null);
  assert.equal(r.status, 0, `an unchanged legacy file migrates, stderr: ${r.stderr}`);
  assert.equal(fs.existsSync(legacy), false, 'the legacy file is no longer at its root path');
  assert.deepEqual(fs.readFileSync(bak), Buffer.from(ORIG), 'the backup holds the file as it was read');
  assert.match(r.stdout, /Migrated the project config from .*\.coalmine\.json to .*; the old file is kept as .*\.coalmine\.json\.bak \(no earlier backup\)/);
  assert.match(r.stdout, /It is yours to keep or delete\./);
  assert.equal(writtenCap(r.stdout), 9);
});

test('configure: a legacy config that git tracks is moved aside, and the line says to commit its removal', (t) => {
  if (!gitAvailable()) { t.skip('no git binary on this box: the tracked-status leg needs one'); return; }
  const { root, proj, legacy } = legacyProject(t);
  gitAdd(proj, root, '.coalmine.json');
  const r = runScript(root, proj, CONFIGURE, ['--autoScanFileCap', '9'], null);
  assert.equal(r.status, 0, `a tracked legacy file migrates, stderr: ${r.stderr}`);
  assert.equal(fs.existsSync(legacy), false, 'the tracked legacy file is moved aside');
  assert.ok(r.stdout.includes('was tracked by git: commit its removal'), 'the line tells the user to commit the removal');
  assert.ok(r.stdout.includes('.coalmine.json.bak is untracked'), 'the line says the backup is untracked');
});

test('configure: a malformed legacy config is moved aside whole, so its bytes survive in the backup, and the run exits 1', (t) => {
  const { root, proj, legacy, bak } = legacyProject(t);
  const malformed = '{ "autoScanFileCap": 7 ';
  fs.writeFileSync(legacy, malformed);
  const r = runScript(root, proj, CONFIGURE, ['--autoScanFileCap', '9'], null);
  assert.equal(r.status, 1, `a malformed config exits 1: ${r.stdout}${r.stderr}`);
  assert.deepEqual(fs.readFileSync(bak), Buffer.from(malformed), 'the malformed bytes survive in the backup, made by the move');
  assert.equal(fs.existsSync(legacy), false);
  const text = r.stdout + r.stderr;
  assert.match(text, /existing config is malformed\. It will be moved aside/, 'the warning says the old file moves aside with the migration');
  assert.doesNotMatch(text, /backed it up to/, 'the malformed branch does not write a backup of its own');
});
