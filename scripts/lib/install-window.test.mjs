// 29kk B2 and B3 (install.mjs uninstall, HIGH), moved aside under BB-533 (T-29jw-5, T-29jw-7, T-29lk-1). A user's file is moved aside by ONE rename to
// <file>.bak; the moved file is read back and compared with the bytes read before the move. A change in between is kept in the backup and named.
//  B2: the backed-up git hook (`<hook>.pre-coalmine`) is renamed over CoalMine's wrapper. A change to the backup in between is the hook now, and the
//      read-back names both the hook and the backup, exit 1. A refused rename keeps the backup and the wrapper.
//  B3: the user's config file (the cursor rule file, with the user's notes above the CoalMine block) moves aside to <file>.bak and is rewritten from the
//      bytes read. A change in between is named (both files), exit 1. A failed rewrite says the file is in <file>.bak.
// Witness: scripts/lib/read-window.mjs (a real child, a --require preload). The "destroying call alone" legs use openNth 0 (the rename is the first
// touch after the seed). Test-only; the product does not import this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeTree } from './test-sandbox.mjs';
import { makeRoot, runScript, gitInit } from './read-window.mjs';

const ROOM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALL = path.join(ROOM, 'scripts', 'install.mjs');
const USER_HOOK = '#!/bin/sh\necho user-hook\n';
const CURSOR_CFG = path.join('.cursor', 'rules', 'coalmine-trigger.mdc');
const CM_BLOCK = '<!-- COALMINE:START -->\nx\n<!-- COALMINE:END -->\n';

// A git repository whose user hook is backed up by a real install (cursor target), so the hook is CoalMine's wrapper and the backup is the user's.
function hookProject(t) {
  const root = makeRoot('cm-hookwin-', removeTree, t);
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  gitInit(proj, root);
  const hook = path.join(proj, '.git', 'hooks', 'pre-commit');
  const backup = hook + '.pre-coalmine';
  fs.writeFileSync(hook, USER_HOOK);
  const inst = runScript(root, proj, INSTALL, ['cursor'], null);
  assert.equal(inst.status, 0, `install ran: ${inst.stderr}`);
  assert.equal(fs.readFileSync(backup, 'utf8'), USER_HOOK, 'install backed the user hook up');
  return { root, proj, hook, backup, wrapper: fs.readFileSync(hook) };
}

// B2, the backup changes after its read and before the rename (the destroying call). The changed backup is what the hook becomes; the read-back names both.
function hookChangeLeg(t, shape) {
  const { root, proj, hook, backup, wrapper } = hookProject(t);
  const injected = Buffer.from(shape === 'append' ? USER_HOOK + 'echo added-by-user\n' : USER_HOOK.replace('user-hook', 'user-HOOK'));
  const r = runScript(root, proj, INSTALL, ['--uninstall', 'cursor'], { target: backup, bytes: injected, act: hook, openNth: 0 });
  assert.ok(r.injected, 'the change was written before the rename (the leg is not vacuous)');
  assert.equal(r.status, 1, `a changed backup exits 1: ${r.stdout}${r.stderr}`);
  assert.equal(fs.existsSync(backup), false, 'the backup was moved over the hook, not left behind');
  assert.deepEqual(fs.readFileSync(hook), injected, 'the hook holds the backup as it was on disk when it moved');
  assert.notDeepEqual(fs.readFileSync(hook), wrapper, 'the wrapper was replaced by the moved backup');
  const text = r.stdout + r.stderr;
  assert.match(text, /pre-commit/, 'the warning names the hook');
  assert.match(text, /changed while it was restored over/, 'the warning says the backup changed during the restore');
  assert.ok(text.includes(backup), 'the warning names the backup');
  assert.doesNotMatch(r.stdout, /restored backed-up git hook/, 'no clean-restore line for a restore that found a change');
}

test('install uninstall (B2): a backed-up hook changed after its read (an appended line) is moved over the hook with the change, the warning names both, and the run exits 1', (t) => {
  hookChangeLeg(t, 'append');
});

test('install uninstall (B2): a backed-up hook changed after its read (a same-size replace) is moved over the hook with the change, the warning names both, and the run exits 1', (t) => {
  hookChangeLeg(t, 'same-size');
});

test('install uninstall (B2): a backed-up hook whose rename is refused is kept with the wrapper, and the run exits 1', (t) => {
  const { root, proj, hook, backup, wrapper } = hookProject(t);
  const r = runScript(root, proj, INSTALL, ['--uninstall', 'cursor'], { target: backup, bytes: '', act: hook, mode: 'throw', openNth: 0 });
  assert.equal(r.status, 1, `a refused restore exits 1: ${r.stdout}${r.stderr}`);
  assert.deepEqual(fs.readFileSync(backup), Buffer.from(USER_HOOK), 'the backup keeps the user bytes');
  assert.deepEqual(fs.readFileSync(hook), wrapper, 'the wrapper stays in place');
  const text = r.stdout + r.stderr;
  assert.match(text, /could not be moved over the hook/, 'the line says the restore failed');
  assert.match(text, /pre-commit/, 'the line names the hook');
  assert.doesNotMatch(r.stdout, /restored backed-up git hook/);
});

test('install uninstall (B2): a backed-up hook that does not change is restored as before, the backup gone, exit 0', (t) => {
  const { root, proj, hook, backup } = hookProject(t);
  const r = runScript(root, proj, INSTALL, ['--uninstall', 'cursor'], null);
  assert.equal(r.status, 0, `an unchanged backup restores, stderr: ${r.stderr}`);
  assert.equal(fs.readFileSync(hook, 'utf8'), USER_HOOK, 'the user hook is back');
  assert.equal(fs.existsSync(backup), false, 'the backup is no longer at its path');
  assert.match(r.stdout, /restored backed-up git hook: pre-commit/);
});

// B3: the cursor rule file with the user's own notes above the CoalMine block.
function configProject(t) {
  const root = makeRoot('cm-cfgwin-', removeTree, t);
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const inst = runScript(root, proj, INSTALL, ['cursor'], null);
  assert.equal(inst.status, 0, `install ran: ${inst.stderr}`);
  const dest = path.join(proj, CURSOR_CFG);
  fs.writeFileSync(dest, 'USER NOTES\n\n' + fs.readFileSync(dest, 'utf8'));
  return { root, proj, dest, bak: dest + '.bak' };
}

// B3, the file changes after its read and before the move (the destroying call). The backup holds the change; the file is rewritten from the bytes read.
function configChangeLeg(t, shape) {
  const { root, proj, dest, bak } = configProject(t);
  const current = fs.readFileSync(dest, 'utf8');
  const injected = Buffer.from(shape === 'append' ? current + 'more notes\n' : current.replace('USER NOTES', 'USER notes'));
  const r = runScript(root, proj, INSTALL, ['--uninstall', 'cursor'], { target: dest, bytes: injected, act: dest, openNth: 0 });
  assert.ok(r.injected, 'the change was written before the move (the leg is not vacuous)');
  assert.equal(r.status, 1, `a changed config exits 1: ${r.stdout}${r.stderr}`);
  assert.deepEqual(fs.readFileSync(bak), injected, 'the backup holds the file as it was on disk when it moved');
  const after = fs.readFileSync(dest, 'utf8');
  assert.match(after, /^USER NOTES/, 'the rewritten file keeps the user notes, from the bytes read');
  assert.doesNotMatch(after, /COALMINE:START|COALMINE:END/, 'the rewritten file has no CoalMine block');
  const text = r.stdout + r.stderr;
  assert.ok(text.includes(dest) && text.includes(bak), 'the warning names both the file and its backup');
  assert.match(text, /changed while it was moved aside/, 'the warning says the file changed during the move');
}

test('install uninstall (B3): a config changed after its read (an appended line) is moved aside with the change, the file is rewritten from the bytes read, the warning names both, and the run exits 1', (t) => {
  configChangeLeg(t, 'append');
});

test('install uninstall (B3): a config changed after its read (a same-size replace) is moved aside with the change, the file is rewritten from the bytes read, the warning names both, and the run exits 1', (t) => {
  configChangeLeg(t, 'same-size');
});

test('install uninstall (B3): a config that does not change loses its CoalMine block, keeps the user notes, keeps the file as <file>.bak, and exits 0', (t) => {
  const { root, proj, dest, bak } = configProject(t);
  const before = fs.readFileSync(dest);
  const r = runScript(root, proj, INSTALL, ['--uninstall', 'cursor'], null);
  assert.equal(r.status, 0, `an unchanged config is rewritten, stderr: ${r.stderr}`);
  assert.match(r.stdout, /removed trigger config block from/);
  assert.match(r.stdout, /your file as it was is kept at .*\.bak \(no earlier backup\)/, 'the line names the backup');
  assert.deepEqual(fs.readFileSync(bak), before, 'the backup holds the file as it was read');
  const after = fs.readFileSync(dest, 'utf8');
  assert.match(after, /^USER NOTES/, 'the user notes stay');
  assert.doesNotMatch(after, /COALMINE:START|COALMINE:END/, 'the CoalMine block is gone');
});

test('install uninstall (B3): an earlier backup of the config is replaced by the move, and the line says so', (t) => {
  const { root, proj, dest, bak } = configProject(t);
  fs.writeFileSync(bak, 'OLD BACKUP\n');
  const before = fs.readFileSync(dest);
  const r = runScript(root, proj, INSTALL, ['--uninstall', 'cursor'], null);
  assert.equal(r.status, 0, `an unchanged config is rewritten, stderr: ${r.stderr}`);
  assert.deepEqual(fs.readFileSync(bak), before, 'the backup is now the file as it was read');
  assert.match(r.stdout, /replaced an earlier backup/);
});

test('install uninstall (B3): a config that is only the CoalMine block moves aside, leaves no file in its place, and exits 0', (t) => {
  const { root, proj, dest, bak } = configProject(t);
  fs.writeFileSync(dest, CM_BLOCK);
  const r = runScript(root, proj, INSTALL, ['--uninstall', 'cursor'], null);
  assert.equal(r.status, 0, `an empty result removes nothing it does not own, stderr: ${r.stderr}`);
  assert.equal(fs.existsSync(dest), false, 'no file is written in place of an empty result');
  assert.deepEqual(fs.readFileSync(bak), Buffer.from(CM_BLOCK), 'the backup holds the block as it was read');
  assert.match(r.stdout, /removed empty trigger config: .*coalmine-trigger\.mdc \(your file is kept at .*\.bak, no earlier backup\)/);
});

test('install uninstall (B3): a rewrite that fails after the move says the file is in its backup, and exits 1', (t) => {
  const { root, proj, dest, bak } = configProject(t);
  const before = fs.readFileSync(dest);
  const r = runScript(root, proj, INSTALL, ['--uninstall', 'cursor'], { target: dest, bytes: '', act: dest, mode: 'throw-into', openNth: 0 });
  assert.equal(r.status, 1, `a failed rewrite exits 1: ${r.stdout}${r.stderr}`);
  assert.equal(fs.existsSync(dest), false, 'the file was moved aside and not rewritten');
  assert.deepEqual(fs.readFileSync(bak), before, 'the backup holds the file as it was read');
  const text = r.stdout + r.stderr;
  assert.match(text, /could not be written/, 'the line says the rewrite failed');
  assert.match(text, /rename it back/, 'the line tells the user how to recover the file');
  assert.doesNotMatch(r.stdout, /removed trigger config block/);
});
