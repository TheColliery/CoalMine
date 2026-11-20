// 29kk B1 (T-29jw-1, HIGH): configure.mjs moves a legacy project config to its new home, then removes the legacy file. A change to the legacy file between
// its seeding read and that removal is the user's edit: the legacy file is KEPT with the changed bytes, the new config is still written, the run exits 1,
// and the Migrated line does not print. The no-change leg proves the ordinary migration still removes the legacy file and exits 0.
// The witness is scripts/lib/read-window.mjs (a real child, a --require preload, the change injected before the re-check's read).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeTree } from './test-sandbox.mjs';
import { makeRoot, runScript, gitInit } from './read-window.mjs';

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
  return { root, proj, legacy };
}

// The file configure reports it wrote (the success line names it), parsed back.
function writtenCap(stdout) {
  const m = /Successfully updated configuration in: (.+)/.exec(stdout);
  assert.ok(m, `the success line names the written config: ${stdout}`);
  return JSON.parse(fs.readFileSync(m[1].trim(), 'utf8')).autoScanFileCap;
}

function changeLeg(t, injected) {
  const { root, proj, legacy } = legacyProject(t);
  const r = runScript(root, proj, CONFIGURE, ['--autoScanFileCap', '9'], { target: legacy, bytes: injected, act: legacy });
  assert.ok(r.injected, 'the change was written between the seeding read and the re-check (the leg is not vacuous)');
  assert.equal(r.status, 1, `a changed legacy file exits 1, stderr: ${r.stderr}`);
  assert.deepEqual(fs.readFileSync(legacy), injected, 'the legacy file is kept with the changed bytes');
  assert.match(r.stderr, /Kept .*\.coalmine\.json/, 'the kept line names the legacy file');
  assert.doesNotMatch(r.stdout, /Migrated the project config/, 'no Migrated line for a file that is still there');
  assert.equal(writtenCap(r.stdout), 9, 'the new config is still written with the new value');
}

test('configure: a legacy config changed after its read (an appended line) is kept, the new config is still written, and the run exits 1', (t) => {
  changeLeg(t, Buffer.from(ORIG + '// the user added this line\n'));
});

test('configure: a legacy config changed after its read (a same-size replace) is kept, the new config is still written, and the run exits 1', (t) => {
  changeLeg(t, Buffer.from(ORIG.replace('7', '5')));
});

test('configure: a legacy config that does not change is migrated as before: removed, the Migrated line printed, exit 0', (t) => {
  const { root, proj, legacy } = legacyProject(t);
  const r = runScript(root, proj, CONFIGURE, ['--autoScanFileCap', '9'], null);
  assert.equal(r.status, 0, `an unchanged legacy file migrates, stderr: ${r.stderr}`);
  assert.equal(fs.existsSync(legacy), false, 'the legacy file is removed');
  assert.match(r.stdout, /Migrated the project config from .*\.coalmine\.json/);
  assert.equal(writtenCap(r.stdout), 9);
});
