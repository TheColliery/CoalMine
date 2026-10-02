// R14 BUILD part A, ruling item 9 (the code lines): one red-first test per row that has an observable.
// Rows: B-u2-6/7 (install/verify argv), B-u2-8 (compareAux by path), B-u1-7 (+B-u2-15) fragments vs the
// project-relative path, B-u1-8 (STANDARDS.md scanned), B-u1-11/B-u3-7 (the ask directive names a real way
// to save), B-u1-15 (Cursor wrapper forwards systemMessage), B-u1-16 (README not in CI DOCS_GLOBS),
// B-u1-18 + B-u2-18 (help text), B-u2-16 (entry guards through a link). The dist-changelog tag filter and the
// publisher's body rule have their tests beside their modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { spawnSandboxed } from './test-sandbox.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALL = path.join(repo, 'scripts', 'install.mjs');
const VERIFY = path.join(repo, 'scripts', 'verify.mjs');
const CONFIGURE = path.join(repo, 'scripts', 'configure.mjs');
const STOP = path.join(repo, 'hooks', 'rot-canary-stop.js');
const CONDUCTOR = path.join(repo, 'hooks', 'coalmine-conductor.js');
const CAP = { NODE_OPTIONS: '--max-old-space-size=2048' };

function mkDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function runNode(script, args, input, cwd, tmp) {
  return spawnSync(process.execPath, [script, ...args], {
    input, encoding: 'utf8', cwd, timeout: 110000, killSignal: 'SIGKILL',
    env: { ...process.env, ...CAP, TEMP: tmp, TMP: tmp, TMPDIR: tmp, USERPROFILE: tmp, HOME: tmp },
  });
}

// --- B-u2-6 / B-u2-7 -------------------------------------------------------------------------------
test('install.mjs --help prints usage and exits 0 without creating a ./--help folder (B-u2-6)', (t) => {
  const dir = mkDir(t, 'cm-r14-inst-');
  const r = spawnSandboxed(process.execPath, [INSTALL, '--help'], { cwd: dir, sandboxDir: dir });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Usage: node scripts\/install\.mjs/);
  assert.deepEqual(fs.readdirSync(dir), [], 'nothing was installed anywhere');
});

test('install.mjs rejects an unknown flag with exit 2 and installs nothing (B-u2-6)', (t) => {
  const dir = mkDir(t, 'cm-r14-inst-');
  const r = spawnSandboxed(process.execPath, [INSTALL, '--bogus'], { cwd: dir, sandboxDir: dir });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown option: --bogus/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('install.mjs treats "constructor" as a folder name, not as Object (B-u2-7)', (t) => {
  const dir = mkDir(t, 'cm-r14-inst-');
  const r = spawnSandboxed(process.execPath, [INSTALL, 'constructor'], { cwd: dir, sandboxDir: dir });
  assert.ok(!/TypeError/.test(r.stderr), `no TypeError crash: ${r.stderr.slice(0, 200)}`);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'constructor')), 'the named folder received the skills');
});

test('verify.mjs: a flag-shaped word is a usage error and "constructor" is a path, never a crash (B-u2-6/7)', (t) => {
  const dir = mkDir(t, 'cm-r14-ver-');
  const help = runNode(VERIFY, ['--help'], '', dir, dir);
  assert.ok(!/target /.test(help.stdout), '--help is not resolved as a target path');
  assert.match(help.stderr, /Usage: node scripts\/verify\.mjs/);
  const bogus = runNode(VERIFY, ['--bogus'], '', dir, dir);
  assert.notEqual(bogus.status, 0, 'an unknown flag is an error');
  assert.match(bogus.stdout, /unknown option --bogus/);
  const ctor = runNode(VERIFY, ['constructor'], '', dir, dir);
  assert.ok(!/TypeError/.test(ctor.stderr), `no crash on "constructor": ${ctor.stderr.slice(0, 200)}`);
});

// --- B-u2-8 ------------------------------------------------------------------------------------------
test('verify.mjs: a build-injected shared reference name planted OUTSIDE references/ is an orphan (B-u2-8)', (t) => {
  const dir = mkDir(t, 'cm-r14-aux-');
  const skip = new Set(['.git', 'scratchpad', '.claude', 'node_modules', 'dist-claude-ai']);
  fs.cpSync(repo, dir, { recursive: true, filter: (src) => !skip.has(path.basename(src)) });
  const sharedNames = fs.readdirSync(path.join(repo, 'skills', '_shared', 'references'));
  assert.ok(sharedNames.length > 0, 'the build injects at least one shared reference');
  const control = runNode(path.join(dir, 'scripts', 'verify.mjs'), [], '', dir, dir);
  assert.equal(control.status, 0, `control: the copied tree verifies clean\n${control.stdout.slice(-400)}`);
  const skill = fs.readdirSync(path.join(dir, 'plugin', 'skills'))[0];
  fs.writeFileSync(path.join(dir, 'plugin', 'skills', skill, sharedNames[0]), 'planted\n');
  const r = runNode(path.join(dir, 'scripts', 'verify.mjs'), [], '', dir, dir);
  assert.notEqual(r.status, 0, 'the planted orphan must fail the gate');
  assert.ok(r.stdout.includes(`${sharedNames[0]} has no source`), 'named as an orphan');
});

// --- B-u1-7 (+ B-u2-15) -----------------------------------------------------------------------------
test('scanExcludePaths matches the project-relative path: an ancestor folder named like a fragment exempts nothing (B-u1-7)', (t) => {
  const sandbox = mkDir(t, 'cm-r14-frag-');
  const proj = path.join(sandbox, 'scratchpad', 'proj'); // the PROJECT sits under a folder called scratchpad
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'src'));
  fs.mkdirSync(path.join(proj, 'scratchpad'));
  fs.mkdirSync(path.join(sandbox, 'coalmine'), { mode: 0o700 });
  fs.writeFileSync(path.join(proj, '.coalmine.json'), JSON.stringify({ scanExcludePaths: ['scratchpad'] }));
  const real = path.join(proj, 'src', 'real.js');
  const lab = path.join(proj, 'scratchpad', 'lab.js');
  fs.writeFileSync(real, 'x');
  fs.writeFileSync(lab, 'x');
  fs.writeFileSync(path.join(sandbox, 'coalmine', 'rot-canary-FRAG.touched'), `${real}\n${lab}\n`);
  const r = runNode(STOP, [], JSON.stringify({ session_id: 'FRAG', stop_hook_active: false }), proj, sandbox);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.ok(out.reason.includes('real.js'), 'a real file under an ancestor named scratchpad still surfaces');
  assert.ok(!out.reason.includes('lab.js'), 'a file inside the project\'s own scratchpad folder is still excluded');
});

// --- B-u1-8 / B-u1-11 --------------------------------------------------------------------------------
test('the conductor counts a verified stamp in STANDARDS.md as the project having been audited (B-u1-8)', (t) => {
  const dir = mkDir(t, 'cm-r14-std-');
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, 'STANDARDS.md'), '<!-- coalmine: verified 2026-07-01 revalidate 90d -->\n# Standards\n');
  const r = runNode(CONDUCTOR, [], '', dir, dir);
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.includes('offer /gold-standard ONCE'), 'no first-run offer for a project whose STANDARDS.md carries a stamp');
});

test('the self-update ask directive names a way to save the choice that exists in a plugin install (B-u1-11 / B-u3-7)', (t) => {
  const dir = mkDir(t, 'cm-r14-ask-');
  fs.mkdirSync(path.join(dir, '.git'));
  const r = runNode(CONDUCTOR, [], '', dir, dir);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('How should CoalMine keep itself current'), 'the ask directive fired');
  assert.ok(!r.stdout.includes('run from the CoalMine repo'), 'it no longer sends the user to a scripts/ folder the plugin does not ship');
  assert.ok(r.stdout.includes('~/.claude/.coalmine.json'), 'it names the global config as the place to save');
});

// --- B-u1-15 -------------------------------------------------------------------------------------------
test('the Cursor stop wrapper forwards a systemMessage-only output as the follow-up (B-u1-15)', (t) => {
  const dir = mkDir(t, 'cm-r14-cursor-');
  const stub = path.join(dir, 'stop-stub.js').split(path.sep).join('/');
  fs.writeFileSync(stub, 'console.log(JSON.stringify({ systemMessage: "DRIFT-NOTE" }));\n');
  const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'platform-configs', 'hooks', 'cursor-hooks.json'), 'utf8'));
  const command = cfg.hooks.stop[0].command.replace('C:/path/to/CoalMine/hooks/rot-canary-stop.js', stub);
  assert.ok(command.includes(stub), 'the stub path replaced the placeholder');
  const r = spawnSync(command, { shell: true, input: '{}', encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).followup_message, 'DRIFT-NOTE');
});

// --- B-u1-16 / B-u1-18 / B-u2-18 -----------------------------------------------------------------------
test('ci.yml does not skip CI for a README-only change while verify.mjs reads the README (B-u1-16)', () => {
  const ci = fs.readFileSync(path.join(repo, '.github', 'workflows', 'ci.yml'), 'utf8');
  const m = /DOCS_GLOBS: "([^"]*)"/.exec(ci);
  assert.ok(m, 'DOCS_GLOBS found');
  assert.ok(!m[1].split(/\s+/).includes('README.md'), 'README.md is not a docs-only (skip) path');
});

test('configure --help: every flag its examples use is a registered flag, and updateCheckDays documents 1-365 (B-u2-18, B-u1-18)', (t) => {
  const dir = mkDir(t, 'cm-r14-help-');
  const r = runNode(CONFIGURE, ['--help'], '', dir, dir);
  assert.equal(r.status, 0, r.stderr);
  const help = r.stdout;
  const optionLines = help.split('\n').slice(0, help.split('\n').indexOf('Examples:'));
  const known = new Set(optionLines.join(' ').match(/--[a-z][a-zA-Z-]*/g));
  const examples = help.split('\n').slice(help.split('\n').indexOf('Examples:') + 1).filter((l) => l.includes('configure.mjs'));
  assert.ok(examples.length > 0);
  for (const ex of examples) {
    for (const flag of ex.match(/--[a-z][a-zA-Z-]*/g) || []) assert.ok(known.has(flag), `${flag} in "${ex.trim()}" is not a registered flag`);
  }
  assert.match(help, /1-365/, 'the allowed range is stated');
});

// --- B-u2-16 ---------------------------------------------------------------------------------------------
test('link-check still runs its CLI when started through a directory junction/symlink (B-u2-16)', (t) => {
  const dir = mkDir(t, 'cm-r14-entry-');
  const link = path.join(dir, 'lib-link');
  try { fs.symlinkSync(path.join(repo, 'scripts', 'lib'), link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { t.skip(`cannot create a directory link here (${e.code})`); return; }
  fs.writeFileSync(path.join(dir, 'a.md'), '# A\n\nSee [b](./missing.md).\n');
  const r = spawnSync(process.execPath, [path.join(link, 'link-check.mjs'), 'a.md'], { cwd: dir, encoding: 'utf8', timeout: 60000 });
  assert.match(r.stdout + r.stderr, /finding\(s\)/, 'the CLI ran (it printed its summary)');
  assert.equal(r.status, 1, 'and found the dead link');
});

// CI red at f460982 (macOS, node 22 and 24): process.cwd() is kernel-resolved (/private/var/...) while the touched list
// carries the spelling the edit tool used (/var/...), so path.relative(root, file) climbed out of the root, projectRelative
// fell back to the ABSOLUTE path, and an ancestor folder named like a fragment excluded every file. Reproduced here with a
// directory link: the touched paths use the LINK spelling, the hook runs with the REAL spelling as its cwd.
test('scanExcludePaths: the project-relative match survives two spellings of the project dir (macOS /var vs /private/var)', (t) => {
  const real = mkDir(t, 'cm-r14-spell-');
  const sandbox = path.join(real, 'scratchpad', 'sbx'); // an ancestor folder named like the fragment
  const proj = path.join(sandbox, 'proj');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'src'));
  fs.mkdirSync(path.join(proj, 'scratchpad'));
  fs.mkdirSync(path.join(sandbox, 'coalmine'), { mode: 0o700 });
  fs.writeFileSync(path.join(proj, '.coalmine.json'), JSON.stringify({ scanExcludePaths: ['scratchpad'] }));
  const linkHome = mkDir(t, 'cm-r14-spell-link-');
  const link = path.join(linkHome, 'link'); // a second spelling of `real` itself, so the ancestor folder shows in BOTH spellings
  try { fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { t.skip(`cannot create a directory link here (${e.code})`); return; }
  const keptViaLink = path.join(link, 'scratchpad', 'sbx', 'proj', 'src', 'real.js');
  const labViaLink = path.join(link, 'scratchpad', 'sbx', 'proj', 'scratchpad', 'lab.js');
  fs.writeFileSync(path.join(proj, 'src', 'real.js'), 'x');
  fs.writeFileSync(path.join(proj, 'scratchpad', 'lab.js'), 'x');
  fs.writeFileSync(path.join(sandbox, 'coalmine', 'rot-canary-SPELL.touched'), `${keptViaLink}\n${labViaLink}\n`);
  const r = runNode(STOP, [], JSON.stringify({ session_id: 'SPELL', stop_hook_active: false }), proj, sandbox);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.ok(out.reason && out.reason.includes('real.js'), 'a real file still surfaces when the touched path uses the other spelling');
  assert.ok(!out.reason.includes('lab.js'), 'the project\'s own scratchpad folder is still excluded');
});

// R14 RE-INSPECT 3 LOW-1: projectRelative must not build a MIXED pair. With the root resolved and the file left lexical (because
// realpath of the file failed), a link-spelled file climbs out of the resolved root and falls back to its absolute path, which holds the
// ancestor folder named like the fragment: everything is excluded. The pair is resolved or lexical, never half of each. Here the hook runs
// with a LINK-spelled cwd (so the lexical root matches the lexical file) and a preload makes realpath throw for the touched file only.
test('scanExcludePaths: when the touched file cannot be resolved, root and file stay a lexical pair (no mixed pair)', (t) => {
  const real = mkDir(t, 'cm-r14-mix-');
  const sandbox = path.join(real, 'scratchpad', 'sbx');
  const projReal = path.join(sandbox, 'proj');
  fs.mkdirSync(path.join(projReal, '.git'), { recursive: true });
  fs.mkdirSync(path.join(projReal, 'src'));
  fs.mkdirSync(path.join(sandbox, 'coalmine'), { mode: 0o700 });
  fs.writeFileSync(path.join(projReal, '.coalmine.json'), JSON.stringify({ scanExcludePaths: ['scratchpad'] }));
  fs.writeFileSync(path.join(projReal, 'src', 'real.js'), 'x');
  const linkHome = mkDir(t, 'cm-r14-mix-link-');
  const link = path.join(linkHome, 'link');
  try { fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { t.skip(`cannot create a directory link here (${e.code})`); return; }
  const projLink = path.join(link, 'scratchpad', 'sbx', 'proj');
  const fileLink = path.join(projLink, 'src', 'real.js');
  fs.writeFileSync(path.join(sandbox, 'coalmine', 'rot-canary-MIX.touched'), fileLink + '\n');
  const pre = path.join(sandbox, 'throw-for-real-js.cjs');
  fs.writeFileSync(pre, [
    "const fs = require('fs'); const o = fs.realpathSync.native;",
    "fs.realpathSync.native = function (p, ...a) { if (String(p).endsWith('real.js')) { const e = new Error('EACCES (injected)'); e.code = 'EACCES'; throw e; } return o.call(this, p, ...a); };",
    '',
  ].join(String.fromCharCode(10)));
  const r = spawnSync(process.execPath, [STOP], {
    cwd: projLink, encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL',
    input: JSON.stringify({ session_id: 'MIX', stop_hook_active: false }),
    env: { ...process.env, TEMP: sandbox, TMP: sandbox, TMPDIR: sandbox, USERPROFILE: sandbox, HOME: sandbox,
      NODE_OPTIONS: `--max-old-space-size=2048 --require "${pre.split(path.sep).join('/')}"` },
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(out.reason && out.reason.includes('real.js'), 'the file still surfaces: root and file are the same (lexical) spelling');
});
