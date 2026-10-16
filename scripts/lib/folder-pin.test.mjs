// 15b5 CWK2-037: a read under a root refuses ANY link in the folder chain between the root and the entry, wherever the link points (a
// target INSIDE the project included), and the entry's own realpath must stay inside its own folder (hooks-safety.md section 6 row 10 as
// amended 2026-10-04; node/runtime.md section 4: an allowlist pins the literal expected location). Before this, repoEntryKind only asked
// whether the realpath lay inside the ROOT, so a junction at `.claude` or `.claude/coal` pointing at a folder inside the project was followed.
// Exemplar: CoalLedger scripts/lib/repo-fs.mjs (folderChainIsPlain / entryInsideItsFolder, 9f48634).
// Windows junction legs run here; POSIX symlink legs and the file-symlink leg are capability-probed (t.skip with a reason, ONE skippable leg
// per test) and run on CI. Every fixture lives under os.tmpdir(); every hook child is heap-capped and timed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { repoEntryKind, readRepoFileBounded, readRepoBytesBounded } from './repo-fs.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CFG = path.join('.claude', 'coal', 'coalmine.json');

function fixture(t, label = 'pin') {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `cm-${label}-`)));
  t.after(() => {
    // junctions first: a recursive remove must never walk into a link target
    const unlink = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); try { if (fs.lstatSync(p).isSymbolicLink()) { try { fs.unlinkSync(p); } catch { fs.rmdirSync(p); } } else if (e.isDirectory()) unlink(p); } catch { /* gone */ } } };
    try { unlink(base); } catch { /* gone */ }
    fs.rmSync(base, { recursive: true, force: true });
  });
  const root = path.join(base, 'proj'); fs.mkdirSync(root);
  const wr = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
  return { base, root, wr };
}
const jn = (target, at) => { fs.mkdirSync(path.dirname(at), { recursive: true }); fs.symlinkSync(target, at, 'junction'); };

test('a plain tree is still read: .claude/coal/coalmine.json under the root', (t) => {
  const { root, wr } = fixture(t);
  wr(path.join(root, CFG), '{"a":1}');
  assert.equal(repoEntryKind(path.join(root, CFG), root), 'file');
  assert.equal(readRepoFileBounded(path.join(root, CFG), root, 64), '{"a":1}');
  assert.deepEqual(readRepoBytesBounded(path.join(root, CFG), root, 64), Buffer.from('{"a":1}'));
  assert.equal(repoEntryKind(path.join(root, '.claude', 'coal'), root), 'dir', 'a real directory entry is still a dir');
});

test('a junction at .claude pointing at a folder INSIDE the project is refused, not followed', (t) => {
  const { root, wr } = fixture(t);
  wr(path.join(root, 'idir', 'coal', 'coalmine.json'), '{"planted":true}');
  jn(path.join(root, 'idir'), path.join(root, '.claude'));
  assert.equal(repoEntryKind(path.join(root, CFG), root), null);
  assert.equal(readRepoFileBounded(path.join(root, CFG), root, 64), null, 'the planted text is not returned');
});

test('a junction at .claude/coal pointing at a folder INSIDE the project is refused, not followed', (t) => {
  const { root, wr } = fixture(t);
  wr(path.join(root, 'idir', 'coalmine.json'), '{"planted":true}');
  jn(path.join(root, 'idir'), path.join(root, '.claude', 'coal'));
  assert.equal(readRepoFileBounded(path.join(root, CFG), root, 64), null);
});

test('a link to a DIRECTORY as the entry itself is refused when it leaves its folder (even inside the project)', (t) => {
  const { root, wr } = fixture(t);
  wr(path.join(root, 'idir', 'x.md'), 'x');
  jn(path.join(root, 'idir'), path.join(root, '.claude', 'rules'));
  assert.equal(repoEntryKind(path.join(root, '.claude', 'rules'), root), null);
});

test('a link that points at its OWN containing folder is refused (an entry may not resolve to the folder it sits in)', (t) => {
  const { root, wr } = fixture(t);
  wr(path.join(root, '.claude', 'x.md'), 'x');
  jn(path.join(root, '.claude'), path.join(root, '.claude', 'loop'));
  assert.equal(repoEntryKind(path.join(root, '.claude', 'loop'), root), null);
});

test('a junction escaping the project is still refused, at any depth of the chain', (t) => {
  const { base, root, wr } = fixture(t);
  wr(path.join(base, 'outside', 'coal', 'coalmine.json'), 'OUT');
  jn(path.join(base, 'outside'), path.join(root, '.claude'));
  assert.equal(readRepoFileBounded(path.join(root, CFG), root, 64), null);
});

test('a path with a ".." segment is refused even when it resolves to a plain file inside the root', (t) => {
  const { root, wr } = fixture(t);
  wr(path.join(root, CFG), '{"a":1}');
  const dotted = [root, '.claude', 'coal', '..', 'coal', 'coalmine.json'].join(path.sep);
  assert.equal(fs.readFileSync(dotted, 'utf8'), '{"a":1}', 'control: the dotted spelling does resolve');
  assert.equal(readRepoFileBounded(dotted, root, 64), null);
});

test('a ".." that would climb out of a planted link is refused (the lexical walk never sees the link)', (t) => {
  const { root, wr } = fixture(t);
  wr(path.join(root, 'idir', 'sub', 'keep.txt'), 'k');
  wr(path.join(root, 'idir', 'coalmine.json'), '{"planted":true}');
  jn(path.join(root, 'idir', 'sub'), path.join(root, '.claude'));
  const dotted = [root, '.claude', '..', 'coalmine.json'].join(path.sep);
  assert.equal(readRepoFileBounded(dotted, root, 64), null);
});

test('the ROOT itself reached through a link is still read (root is not walked)', (t) => {
  const { base, root, wr } = fixture(t);
  wr(path.join(root, CFG), '{"a":1}');
  const linkRoot = path.join(base, 'linked-root');
  jn(root, linkRoot);
  assert.equal(readRepoFileBounded(path.join(linkRoot, CFG), linkRoot, 64), '{"a":1}');
});

test('root null (the user home files) keeps its no-containment contract through a link', (t) => {
  const { base, root, wr } = fixture(t);
  wr(path.join(root, 'real', 'f.json'), '{"home":1}');
  jn(path.join(root, 'real'), path.join(base, 'dotlink'));
  assert.equal(readRepoFileBounded(path.join(base, 'dotlink', 'f.json'), null, 64), '{"home":1}');
});

test('a FILE symlink that leaves its folder but stays inside the project is refused (POSIX, or Windows with symlink privilege)', (t) => {
  const { root, wr } = fixture(t);
  wr(path.join(root, 'decoy.json'), '{"decoy":1}');
  fs.mkdirSync(path.join(root, '.claude', 'coal'), { recursive: true });
  try { fs.symlinkSync(path.join(root, 'decoy.json'), path.join(root, CFG), 'file'); } catch { t.skip('file symlinks need privilege on this volume'); return; }
  assert.equal(repoEntryKind(path.join(root, CFG), root), null);
  assert.equal(readRepoFileBounded(path.join(root, CFG), root, 64), null);
});

test('a FILE symlink that stays inside its OWN folder is still read (POSIX, or Windows with symlink privilege)', (t) => {
  const { root, wr } = fixture(t);
  wr(path.join(root, '.claude', 'coal', 'real.json'), '{"ok":1}');
  try { fs.symlinkSync(path.join(root, '.claude', 'coal', 'real.json'), path.join(root, CFG), 'file'); } catch { t.skip('file symlinks need privilege on this volume'); return; }
  assert.equal(readRepoFileBounded(path.join(root, CFG), root, 64), '{"ok":1}');
});

// ---- the hooks: the SAME rule, spawned hermetically (the config read through a planted junction is NOT honoured) ----
const HOOKS = ['coalmine-conductor.js', 'rot-canary-stop.js', 'rot-canary-touch.js'].map((f) => path.join(repo, 'hooks', f));

test('the hook copies and scripts/lib/repo-fs.mjs carry byte-identical folderChainIsPlain / entryInsideItsFolder / repoEntryKind (kept identical by hand, now enforced)', () => {
  const grab = (file) => {
    const s = fs.readFileSync(file, 'utf8');
    const m = /\/\/ 15b5 \(CWK2-037[^\n]*\n(?:\/\/ [^\n]*\n)*function folderChainIsPlain[\s\S]*?\n(?:export )?function repoEntryKind[\s\S]*?\n}\n/.exec(s);
    assert.ok(m, `${path.basename(file)}: folderChainIsPlain + entryInsideItsFolder + repoEntryKind found`);
    return m[0];
  };
  const want = grab(path.join(repo, 'hooks', '_shared', 'node-config.js'));
  for (const h of HOOKS) assert.equal(grab(h), want, `${path.basename(h)} carries the partial's copy`);
  assert.match(want, /entryInsideItsFolder/);
  assert.equal(grab(path.join(repo, 'scripts', 'lib', 'repo-fs.mjs')).replace('export function repoEntryKind', 'function repoEntryKind'), want, 'scripts/lib/repo-fs.mjs carries the same three functions');
});

function runConductor(t, plant) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cm-pinhook-')));
  t.after(() => {
    const unlink = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); try { if (fs.lstatSync(p).isSymbolicLink()) { try { fs.unlinkSync(p); } catch { fs.rmdirSync(p); } } else if (e.isDirectory()) unlink(p); } catch { /* gone */ } } };
    try { unlink(base); } catch { /* gone */ }
    fs.rmSync(base, { recursive: true, force: true });
  });
  const proj = path.join(base, 'proj'); fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  fs.mkdirSync(path.join(base, 'home', 'coalmine'), { recursive: true, mode: 0o700 });
  plant(proj);
  const home = path.join(base, 'home');
  return spawnSync(process.execPath, ['--max-old-space-size=512', HOOKS[0]], {
    cwd: proj, input: '', encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL',
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home },
  });
}
const SILENCE = '{"enableConductor":false}';
const put = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

test('hook: a plain .claude/coal/coalmine.json IS honoured (control: enableConductor false silences the conductor)', (t) => {
  const r = runConductor(t, (proj) => put(path.join(proj, CFG), SILENCE));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', 'the plain config was read');
});

test('hook: a junction at .claude to a folder inside the project is NOT honoured (the conductor still speaks)', (t) => {
  const r = runConductor(t, (proj) => { put(path.join(proj, 'idir', 'coal', 'coalmine.json'), SILENCE); jn(path.join(proj, 'idir'), path.join(proj, '.claude')); });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('[CoalMine]'), 'the planted config was not read, so the conductor emitted its context');
});

test('hook: a junction at .claude/coal to a folder inside the project is NOT honoured', (t) => {
  const r = runConductor(t, (proj) => { put(path.join(proj, 'idir', 'coalmine.json'), SILENCE); jn(path.join(proj, 'idir'), path.join(proj, '.claude', 'coal')); });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('[CoalMine]'));
});
