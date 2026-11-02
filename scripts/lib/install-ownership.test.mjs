// 29ae: the installer writes or removes a skill folder only when it can prove CoalMine installed it. The proof is the install
// record under the user's home (`.claude/coal/coalmine/install-record.json`), which names each target's skills with the sha256 of
// every file it wrote; a folder with no record for its target is CoalMine's only when its files are byte-equal to what this
// installer renders from its own source (adopted). Everything else is kept, named to the user with one [kept] line, exit 1.
// A project manifest (`.coalmine-manifest.json`) and a skill-meta.json marker authorize nothing.
// Hermetic: every installer child runs with HOME, USERPROFILE, TEMP, TMP and TMPDIR in a sandbox under os.tmpdir(), a heap cap and
// a timeout. No git child is spawned: the sandbox project has no git ancestor. Zero-dep (node:test + built-ins).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALL = path.join(repo, 'scripts', 'install.mjs');
const SKILLS_SRC = path.join(repo, 'skills');
const TIMEOUT = 100000;
const SHIPPED = fs.readdirSync(SKILLS_SRC).filter((n) => !n.startsWith('_') && fs.statSync(path.join(SKILLS_SRC, n)).isDirectory()).sort();
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-own-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const proj = path.join(dir, 'proj');
  fs.mkdirSync(proj);
  return { dir, home: dir, proj };
}

function childEnv(sb) {
  return { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: sb.home, USERPROFILE: sb.home, TEMP: sb.home, TMP: sb.home, TMPDIR: sb.home };
}

function installer(sb, args) {
  return spawnSync(process.execPath, ['--max-old-space-size=512', INSTALL, ...args], {
    cwd: sb.proj, encoding: 'utf8', timeout: TIMEOUT, killSignal: 'SIGKILL', env: childEnv(sb),
  });
}

const recordFile = (sb) => path.join(sb.home, '.claude', 'coal', 'coalmine', 'install-record.json');
const readRecord = (sb) => JSON.parse(fs.readFileSync(recordFile(sb), 'utf8'));

// The shipped installer's own output: a clean install into a reference folder, the source of byte-identical copies.
function referenceInstall(sb) {
  const ref = path.join(sb.dir, 'reference');
  const r = installer(sb, [ref]);
  assert.equal(r.status, 0, `control: the reference install succeeds (${r.stdout}${r.stderr})`);
  return ref;
}

function copyFolders(from, to, names) {
  fs.mkdirSync(to, { recursive: true });
  for (const s of names) fs.cpSync(path.join(from, s), path.join(to, s), { recursive: true });
}

function plantManifest(dest, names, hashesFor) {
  const hashes = {};
  for (const [rel, text] of Object.entries(hashesFor)) hashes[rel] = sha(Buffer.from(text, 'utf8'));
  fs.writeFileSync(path.join(dest, '.coalmine-manifest.json'), JSON.stringify({ version: '9.9.9', installedAt: 'x', skills: names, hashes }, null, 2));
}

test('a folder the record names is replaced, a folder the record does not name is kept, even with a planted manifest that lists it', (t) => {
  const sb = sandbox(t);
  const dest = path.join(sb.dir, 'target');
  const first = installer(sb, [dest]);
  assert.equal(first.status, 0, `control: the first install succeeds (${first.stdout}${first.stderr})`);

  // A folder the record names, whose bytes are the recorded ones: CoalMine installed it earlier, so it is removed.
  const stale = path.join(dest, 'old-skill');
  fs.mkdirSync(stale);
  fs.writeFileSync(path.join(stale, 'SKILL.md'), 'stale\n', 'utf8');
  const rec = readRecord(sb);
  const key = fs.realpathSync.native(dest);
  rec.targets[key].skills['old-skill'] = { 'SKILL.md': sha(Buffer.from('stale\n', 'utf8')) };
  fs.writeFileSync(recordFile(sb), JSON.stringify(rec, null, 2));

  // A folder the installer neither ships nor records, named by a planted project manifest with its true hash: a clone can plant exactly this. It is outside the installer's scope and stays.
  const foreign = path.join(dest, 'foreign-orphan');
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, 'SKILL.md'), 'not ours\n', 'utf8');
  plantManifest(dest, ['foreign-orphan'], { 'foreign-orphan/SKILL.md': 'not ours\n' });

  const second = installer(sb, [dest]);
  assert.equal(second.status, 0, `nothing the installer ships or records fails its proof, so nothing is kept (${second.stdout}${second.stderr})`);
  assert.ok(!fs.existsSync(stale), 'the folder the record names, with its recorded bytes, is removed');
  assert.equal(fs.readFileSync(path.join(foreign, 'SKILL.md'), 'utf8'), 'not ours\n', 'the folder nothing records is untouched');
  assert.ok(!readRecord(sb).targets[key].skills['foreign-orphan'], 'a kept folder never enters the record');
  for (const s of SHIPPED) assert.ok(readRecord(sb).targets[key].skills[s], `the record names the shipped skill ${s}`);
});

test('a target with no record whose folders are byte-equal to the shipped files is adopted, and the record names it', (t) => {
  const sb = sandbox(t);
  const ref = referenceInstall(sb);
  const dest = path.join(sb.dir, 'installed-before');
  copyFolders(ref, dest, SHIPPED); // the installed-before-this-version shape: the shipped bytes, no record for this target
  const r = installer(sb, [dest]);
  assert.equal(r.status, 0, `byte-equal folders are adopted, nothing kept (${r.stdout}${r.stderr})`);
  const key = fs.realpathSync.native(dest);
  const entry = readRecord(sb).targets[key];
  assert.ok(entry, 'the record gains an entry for the target');
  for (const s of SHIPPED) {
    assert.ok(entry.skills[s], `the record names the adopted skill ${s}`);
    for (const [rel, want] of Object.entries(entry.skills[s])) {
      assert.equal(sha(fs.readFileSync(path.join(dest, s, rel))), want, `the recorded hash of ${s}/${rel} is the file's hash now`);
    }
  }
});

test('a folder with no record whose bytes differ by one byte is kept: named, exit 1, and its bytes are unchanged', (t) => {
  const sb = sandbox(t);
  const ref = referenceInstall(sb);
  const dest = path.join(sb.dir, 'changed');
  copyFolders(ref, dest, SHIPPED);
  const changed = SHIPPED[0];
  const skillMd = path.join(dest, changed, 'SKILL.md');
  const edited = fs.readFileSync(skillMd, 'utf8') + 'x';
  fs.writeFileSync(skillMd, edited, 'utf8');
  const r = installer(sb, [dest]);
  assert.equal(r.status, 1, `the kept folder makes the run exit 1 (${r.stdout}${r.stderr})`);
  assert.equal(fs.readFileSync(skillMd, 'utf8'), edited, 'the one-byte-changed folder is not overwritten');
  assert.match(r.stdout + r.stderr, new RegExp(`\\[kept\\][^\\n]*${changed}`), 'one [kept] line names the folder');
});

test('uninstall leaves a folder the record does not name in place, even when a planted manifest lists it', (t) => {
  const sb = sandbox(t);
  const dest = path.join(sb.dir, 'target');
  const first = installer(sb, [dest]);
  assert.equal(first.status, 0, `control: the install succeeds (${first.stdout}${first.stderr})`);
  const foreign = path.join(dest, 'foreign');
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, 'SKILL.md'), 'mine\n', 'utf8');
  plantManifest(dest, ['foreign'], { 'foreign/SKILL.md': 'mine\n' });
  const r = installer(sb, ['--uninstall', dest]);
  assert.equal(r.status, 0, `the unrecorded folder is not named, so uninstall exits 0 (${r.stdout}${r.stderr})`);
  assert.equal(fs.readFileSync(path.join(foreign, 'SKILL.md'), 'utf8'), 'mine\n', 'the unrecorded folder survives uninstall');
  assert.ok(!fs.existsSync(path.join(dest, SHIPPED[0])), 'control: the recorded shipped skills are removed');
});

test('uninstall keeps a byte-identical folder that no record names: a byte match authorizes an install, never a delete', (t) => {
  const sb = sandbox(t);
  const ref = referenceInstall(sb);
  const dest = path.join(sb.dir, 'kept-copy');
  copyFolders(ref, dest, SHIPPED); // a project's own copies, byte-equal to the shipped files, with no record for this target
  const r = installer(sb, ['--uninstall', dest]);
  assert.equal(r.status, 1, `the unrecorded folders are kept, so the run exits 1 (${r.stdout}${r.stderr})`);
  assert.match(r.stdout + r.stderr, new RegExp(`\\[kept\\][^\\n]*${SHIPPED[0]}`), 'a [kept] line names the folder');
  for (const s of SHIPPED) {
    assert.equal(fs.readFileSync(path.join(dest, s, 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(ref, s, 'SKILL.md'), 'utf8'), `the bytes of ${s} survive uninstall`);
  }
});

test('a folder the record names that a run keeps keeps its OLD hashes in the record', (t) => {
  const sb = sandbox(t);
  const dest = path.join(sb.dir, 'carried');
  const first = installer(sb, [dest]);
  assert.equal(first.status, 0, `control: the install succeeds (${first.stdout}${first.stderr})`);
  const key = fs.realpathSync.native(dest);
  const before = readRecord(sb).targets[key].skills[SHIPPED[0]];
  const skillMd = path.join(dest, SHIPPED[0], 'SKILL.md');
  fs.writeFileSync(skillMd, fs.readFileSync(skillMd, 'utf8') + 'edited\n', 'utf8');
  const second = installer(sb, [dest]);
  assert.equal(second.status, 1, `the edited folder is kept (${second.stdout}${second.stderr})`);
  const after = readRecord(sb).targets[key].skills[SHIPPED[0]];
  assert.ok(after, 'the record still names the kept folder');
  assert.deepEqual(after, before, 'the kept folder keeps its OLD recorded hashes, not the edited ones');
});

test('a planted manifest that lists a shipped skill does not authorize writing over a folder with foreign bytes', (t) => {
  const sb = sandbox(t);
  const dest = path.join(sb.dir, 'planted-over');
  const foreign = path.join(dest, SHIPPED[0]);
  fs.mkdirSync(foreign, { recursive: true });
  fs.writeFileSync(path.join(foreign, 'SKILL.md'), 'foreign bytes\n', 'utf8');
  plantManifest(dest, [SHIPPED[0]], { [`${SHIPPED[0]}/SKILL.md`]: 'foreign bytes\n' });
  const r = installer(sb, [dest]);
  assert.equal(r.status, 1, `the foreign folder is kept (${r.stdout}${r.stderr})`);
  assert.equal(fs.readFileSync(path.join(foreign, 'SKILL.md'), 'utf8'), 'foreign bytes\n', 'its bytes are unchanged by install');
  const u = installer(sb, ['--uninstall', dest]);
  assert.equal(u.status, 1, `the foreign folder is kept by uninstall too (${u.stdout}${u.stderr})`);
  assert.equal(fs.readFileSync(path.join(foreign, 'SKILL.md'), 'utf8'), 'foreign bytes\n', 'its bytes are unchanged by uninstall');
});

test('a record written by a newer CoalMine is left byte-identical, and this run takes the byte-match path', (t) => {
  const sb = sandbox(t);
  const ref = referenceInstall(sb);
  const dest = path.join(sb.dir, 'newer');
  copyFolders(ref, dest, SHIPPED);
  const changed = SHIPPED[SHIPPED.length - 1];
  const changedFile = path.join(dest, changed, 'SKILL.md');
  fs.writeFileSync(changedFile, fs.readFileSync(changedFile, 'utf8') + 'y', 'utf8');
  fs.mkdirSync(path.dirname(recordFile(sb)), { recursive: true });
  const newer = JSON.stringify({ stateSchema: 2, targets: { [path.join(sb.dir, 'elsewhere')]: { version: '99.0.0', skills: {} } }, future: 'field' }, null, 2) + '\n';
  fs.writeFileSync(recordFile(sb), newer, 'utf8');
  const r = installer(sb, [dest]);
  assert.equal(fs.readFileSync(recordFile(sb), 'utf8'), newer, 'the newer record is not rewritten');
  assert.match(r.stdout + r.stderr, /newer CoalMine[^\n]*left alone/, 'one line says the record was left alone');
  assert.equal(r.status, 1, 'the byte-changed folder is kept under the byte-match path');
  assert.equal(fs.readFileSync(changedFile, 'utf8'), fs.readFileSync(path.join(ref, changed, 'SKILL.md'), 'utf8') + 'y', 'the changed folder is not overwritten');
  assert.equal(((r.stdout + r.stderr).match(/\[kept\]/g) || []).length, 1, 'only the byte-changed folder is kept; every byte-equal folder is adopted');
});
