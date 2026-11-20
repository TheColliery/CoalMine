// 29kk B2 and B3 (install.mjs uninstall, HIGH). A user's file that changes between the read that seeds a destructive step and the act is the user's edit.
//  B2 (T-29jw-5): the backed-up git hook (`<hook>.pre-coalmine`) is restored over CoalMine's wrapper and then removed. A change to the backup in between
//      keeps the backup, leaves the hook as CoalMine's wrapper, prints the [kept] line and exits 1.
//  B3 (T-29jw-7): the user's config file (here the cursor rule file, with the user's own notes above the CoalMine block) is rewritten without the block.
//      A change to it in between is kept, the block is not removed, and the run exits 1.
// Each change leg has an append and a same-size replace; each site has a no-change leg that still does the act. The witness is scripts/lib/read-window.mjs.
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

function hookChangeLeg(t, shape) {
  const { root, proj, hook, backup, wrapper } = hookProject(t);
  const injected = Buffer.from(shape === 'append' ? USER_HOOK + 'echo added-by-user\n' : USER_HOOK.replace('user-hook', 'user-HOOK'));
  const r = runScript(root, proj, INSTALL, ['--uninstall', 'cursor'], { target: backup, bytes: injected, act: hook });
  assert.ok(r.injected, 'the change was written between the seeding read and the re-check (the leg is not vacuous)');
  assert.equal(r.status, 1, `a changed backup exits 1: ${r.stdout}${r.stderr}`);
  assert.deepEqual(fs.readFileSync(backup), injected, 'the backup is kept with the changed bytes');
  assert.deepEqual(fs.readFileSync(hook), wrapper, 'nothing was written over CoalMine\'s hook');
  assert.match(r.stdout + r.stderr, /\[kept\] pre-commit/, 'the kept line names the hook');
  assert.doesNotMatch(r.stdout, /restored backed-up git hook/);
}

test('install uninstall (B2): a backed-up hook changed after its read (an appended line) is kept, the hook is not written over, and the run exits 1', (t) => {
  hookChangeLeg(t, 'append');
});

test('install uninstall (B2): a backed-up hook changed after its read (a same-size replace) is kept, the hook is not written over, and the run exits 1', (t) => {
  hookChangeLeg(t, 'same-size');
});

test('install uninstall (B2): a backed-up hook that does not change is restored as before, the backup removed, exit 0', (t) => {
  const { root, proj, hook, backup } = hookProject(t);
  const r = runScript(root, proj, INSTALL, ['--uninstall', 'cursor'], null);
  assert.equal(r.status, 0, `an unchanged backup restores, stderr: ${r.stderr}`);
  assert.equal(fs.readFileSync(hook, 'utf8'), USER_HOOK, 'the user hook is back');
  assert.equal(fs.existsSync(backup), false, 'the backup is removed');
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
  return { root, proj, dest };
}

function configChangeLeg(t, shape) {
  const { root, proj, dest } = configProject(t);
  const current = fs.readFileSync(dest, 'utf8');
  const injected = Buffer.from(shape === 'append' ? current + 'more notes\n' : current.replace('USER NOTES', 'USER notes'));
  const r = runScript(root, proj, INSTALL, ['--uninstall', 'cursor'], { target: dest, bytes: injected, act: dest });
  assert.ok(r.injected, 'the change was written between the seeding read and the re-check (the leg is not vacuous)');
  assert.equal(r.status, 1, `a changed config exits 1: ${r.stdout}${r.stderr}`);
  assert.deepEqual(fs.readFileSync(dest), injected, 'the config is kept with the changed bytes');
  assert.match(r.stdout + r.stderr, /\[kept\] .*coalmine-trigger\.mdc/, 'the kept line names the file');
  assert.doesNotMatch(r.stdout, /removed trigger config block/);
}

test('install uninstall (B3): a config changed after its read (an appended line) is kept, the block is not removed, and the run exits 1', (t) => {
  configChangeLeg(t, 'append');
});

test('install uninstall (B3): a config changed after its read (a same-size replace) is kept, the block is not removed, and the run exits 1', (t) => {
  configChangeLeg(t, 'same-size');
});

test('install uninstall (B3): a config that does not change loses its CoalMine block, keeps the user notes, and exits 0', (t) => {
  const { root, proj, dest } = configProject(t);
  const r = runScript(root, proj, INSTALL, ['--uninstall', 'cursor'], null);
  assert.equal(r.status, 0, `an unchanged config is rewritten, stderr: ${r.stderr}`);
  assert.match(r.stdout, /removed trigger config block from/);
  const after = fs.readFileSync(dest, 'utf8');
  assert.match(after, /^USER NOTES/, 'the user notes stay');
  assert.doesNotMatch(after, /COALMINE:START|COALMINE:END/, 'the CoalMine block is gone');
});
