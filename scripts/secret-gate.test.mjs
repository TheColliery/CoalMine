#!/usr/bin/env node
// Hermetic spawn tests for scripts/secret-gate.mjs: the real entry file is run against a throwaway git
// repository, and the exit code, the sanctioned output and the effect are asserted. PORTABLE like the gate: node builtins
// only, no repository path or name, so a sibling repo copies it beside the gate unchanged.
//
// NO SECRET-SHAPED LITERAL APPEARS IN THIS FILE. The sample key is assembled at runtime from fragments.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, 'secret-gate.mjs');
const LIB = path.join(HERE, 'lib', 'secret-scan.mjs');
const KEY = ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join(''); // an access-key-id shape, assembled so this file never carries one
const ZERO = '0'.repeat(40);
const made = [];
// ONE sandbox of the test's own. Every fixture folder, every child's TEMP, TMP, TMPDIR, HOME and USERPROFILE live in it, and the
// developer's global git configuration never applies (HOME and XDG_CONFIG_HOME are the sandbox, whose own global configuration is an empty file, and the system config is off).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-gate-sandbox-'));
fs.writeFileSync(path.join(SANDBOX, '.gitconfig'), '');
// A hook runs with GIT_DIR, GIT_INDEX_FILE and friends set; a fixture that inherited them would write into the repository
// the hook runs for. So every fixture git call, and the gate under test, is handed an environment BUILT FROM NAMES, never a copy of the process's own: nothing the process
// inherited (a GIT_ name, a token, a proxy setting) can reach it, because only the keys written out below exist in it. They are the sandbox in place of the box (TEMP, TMP,
// TMPDIR, HOME, USERPROFILE and XDG_CONFIG_HOME point at it, so the global git config is the sandbox's own and holds none), the names git and node need to start (PATH everywhere;
// SystemRoot, windir, ComSpec and PATHEXT on Windows, read by name and undefined, so left out of the child's environment, elsewhere) and the GIT_ names the flock allows in a
// child git environment: GIT_CONFIG_NOSYSTEM and GIT_CEILING_DIRECTORIES.
const gitEnv = () => ({
  PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, windir: process.env.windir, ComSpec: process.env.ComSpec, PATHEXT: process.env.PATHEXT,
  TEMP: SANDBOX, TMP: SANDBOX, TMPDIR: SANDBOX, HOME: SANDBOX, USERPROFILE: SANDBOX, XDG_CONFIG_HOME: SANDBOX,
  GIT_CONFIG_NOSYSTEM: '1',
  // git stops searching for a repository at the sandbox's parent: a temp folder that sits inside a repository must not make a fixture look like part of it
  GIT_CEILING_DIRECTORIES: path.dirname(SANDBOX),
});

// The identity and the no-signing switch ride on every call, never into the fixture's config: three `git config` spawns per repository cost about
// 0.5 s each fixture on Windows (measured 2026-11-16), a quarter of a fixture, and this file builds some 60.
const GIT_IDENTITY = ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test', '-c', 'commit.gpgsign=false'];
function git(dir, ...args) {
  return execFileSync('git', [...GIT_IDENTITY, '-C', dir, ...args], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv() }).trim();
}

// One `git init`, made once: every fixture starts as a copy of this empty repository (a copy of five small entries is milliseconds, an init is
// about a quarter of a second on Windows, measured 2026-11-16). `--template=` leaves out the sample hooks, so there is nothing to copy but the skeleton.
const INIT_TEMPLATE = path.join(SANDBOX, 'init-template');
fs.mkdirSync(INIT_TEMPLATE);
execFileSync('git', ['init', '-q', '-b', 'main', '--template=', INIT_TEMPLATE], { timeout: 60000, stdio: 'ignore', env: gitEnv() });

// A throwaway repository holding the gate and its scanner, with one commit per entry of `commits` ({ file: text } maps;
// a null text deletes the file).
function repo(commits, { withLib = true } = {}) {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'secret-gate-'));
  made.push(dir);
  fs.cpSync(INIT_TEMPLATE, dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(GATE, path.join(dir, 'scripts', 'secret-gate.mjs'));
  if (withLib) fs.copyFileSync(LIB, path.join(dir, 'scripts', 'lib', 'secret-scan.mjs'));
  commits.forEach((files, i) => {
    for (const [f, text] of Object.entries(files)) {
      const p = path.join(dir, f);
      if (text === null) fs.rmSync(p, { force: true });
      else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text, 'utf8'); }
    }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', `commit ${i + 1}`);
  });
  return dir;
}

// The environment of the gate under test, a NODE child and not a git call: the sandbox environment, NODE_OPTIONS by name (a heap cap and a preload of the runner must reach it), a
// HOME of its own, and whatever the test plants on top (a GIT_DIR a hook inherited).
const gateEnv = (dir, extraEnv = {}) => ({ ...gitEnv(), NODE_OPTIONS: process.env.NODE_OPTIONS, HOME: dir, USERPROFILE: dir, ...extraEnv });

function run(dir, args = [], input = '', extraEnv = {}, timeout = 60000) {
  const r = spawnSync(process.execPath, ['--max-old-space-size=512', path.join(dir, 'scripts', 'secret-gate.mjs'), ...args], {
    cwd: dir, input, encoding: 'utf8', timeout,
    env: gateEnv(dir, extraEnv),
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// Teardown of a tree git children just used: on Windows a git.exe that outlives its launcher by a few seconds still holds the tree, and one plain rmSync
// answers EBUSY, EPERM or ENOTEMPTY, failing the test for a reason that is not the test's (measured: a loop of fresh calls clears it, the
// retry options of one call do not). A tree still held past the budget throws: a real leak stays loud.
function removeTree(dir, budgetMs = 30000) {
  const until = Date.now() + budgetMs;
  for (;;) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch (e) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(e && e.code) || Date.now() >= until) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}
test.after(() => { for (const d of [...made, SANDBOX]) removeTree(d); });
// test.after is skipped when the run ends early (an uncaught error, a call to process.exit); 'exit' still runs, so the sandbox goes then too. A
// process killed from outside (a runner's timeout) runs neither, and its sandbox stays in the temp folder.
process.once('exit', () => removeTree(SANDBOX, 5000));

test('a clean tree passes: exit 0 and a PASS SECRETS line naming the files scanned', () => {
  const r = run(repo([{ 'README.md': 'hello\n' }]));
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /^PASS SECRETS: tree scan of \d+ tracked text file\(s\) clean/m);
});

test('a tracked file carrying a key shape fails: exit 1, file, line and pattern named, the value never printed', () => {
  const r = run(repo([{ 'notes.txt': `a\nb ${KEY} c\n` }]));
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /FAIL SECRETS: 1 secret-shaped match\(es\)/);
  assert.match(r.out, /tree "notes\.txt":2 aws-access-key-id \(fp [0-9a-f]{16}\)/);
  assert.ok(!r.out.includes(KEY) && !r.err.includes(KEY), 'the matched value must never be printed');
});

test('an ack silences a hit only when it is committed: the fingerprint in a committed secret-scan.acks passes, an uncommitted one does not', () => {
  const dir = repo([{ 'notes.txt': `x ${KEY}\n` }]);
  const fp = run(dir).out.match(/fp ([0-9a-f]{16})/)[1];
  fs.writeFileSync(path.join(dir, 'secret-scan.acks'), `${fp}  # a known public value\n`, 'utf8');
  assert.strictEqual(run(dir).code, 1, 'an ack that is only in the working tree silences nothing');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'ack');
  const r = run(dir);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /1 acknowledged hit\(s\) via secret-scan\.acks/);
});

test('a line of secret-scan.acks that is not a 16-hex fingerprint fails loud instead of guessing', () => {
  const r = run(repo([{ 'secret-scan.acks': 'not-a-fingerprint\n', 'a.txt': 'x\n' }]));
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /FAIL SECRETS: secret-scan\.acks line\(s\) .* are not a 16-hex fingerprint/);
});

test('--pre-push scans the added lines of every pushed commit: a key added and deleted inside the range is still found', () => {
  const dir = repo([{ 'a.txt': 'one\n' }, { 'k.txt': `${KEY}\n` }, { 'k.txt': null }]);
  assert.strictEqual(run(dir).code, 0, 'the tree at HEAD is clean');
  const tip = git(dir, 'rev-parse', 'HEAD');
  const r = run(dir, ['--pre-push'], `refs/heads/main ${tip} refs/heads/main ${ZERO}\n`);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /pushed [0-9a-f]{12} "k\.txt":1 aws-access-key-id/);
});

test('--pre-push with a clean range passes and says what it read; with no refs on stdin it says there is nothing to scan', () => {
  const dir = repo([{ 'a.txt': 'one\n' }, { 'b.txt': 'two\n' }]);
  const tip = git(dir, 'rev-parse', 'HEAD');
  const r = run(dir, ['--pre-push'], `refs/heads/main ${tip} refs/heads/main ${ZERO}\n`);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /pushed range: 1 ref\(s\), 2 commit\(s\)/);
  assert.match(run(dir, ['--pre-push'], '').out, /no refs on stdin, nothing to scan/);
});

// --remote=<name> names the PUSH remote, so a commit held only by ANOTHER remote still counts as unpushed. Nothing exercised the flag.
// The fixture: three commits, the middle one adds a key and the last deletes it (the tree at HEAD is clean), the tip sits on the remote-tracking ref of `other` only, and the push is a new branch to `origin`.
test('--pre-push --remote=<name>: a commit held only by another remote is scanned for the named push remote, and is skipped when the named remote already holds it or no remote is named', () => {
  const dir = repo([{ 'a.txt': 'one\n' }, { 'k.txt': `${KEY}\n` }, { 'k.txt': null }]);
  git(dir, 'remote', 'add', 'origin', 'https://example.invalid/o.git');
  git(dir, 'remote', 'add', 'other', 'https://example.invalid/p.git');
  const tip = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'update-ref', 'refs/remotes/other/main', tip);
  const stdin = `refs/heads/main ${tip} refs/heads/main ${ZERO}\n`;
  const toOrigin = run(dir, ['--pre-push', '--remote=origin'], stdin);
  assert.strictEqual(toOrigin.code, 1, toOrigin.out + toOrigin.err);
  assert.match(toOrigin.out, /pushed [0-9a-f]{12} "k\.txt":1 aws-access-key-id/);
  for (const flags of [['--remote=other'], [], ['--remote=nosuchremote']]) {
    const r = run(dir, ['--pre-push', ...flags], stdin);
    assert.strictEqual(r.code, 0, `${flags.join(' ') || '(no --remote)'}: ${r.out}${r.err}`);
    assert.match(r.out, /pushed range: 1 ref\(s\), 0 commit\(s\)/);
  }
});

test('--pre-push --remote=<name> with a value that is not the name of a remote of this repository (a glob, a dash-led value, empty) is ignored and the scan falls back to every remote', () => {
  const dir = repo([{ 'a.txt': 'one\n' }, { 'k.txt': `${KEY}\n` }, { 'k.txt': null }]);
  git(dir, 'remote', 'add', 'other', 'https://example.invalid/p.git');
  const tip = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'update-ref', 'refs/remotes/other/main', tip);
  const stdin = `refs/heads/main ${tip} refs/heads/main ${ZERO}\n`;
  for (const bad of ['--remote=*', '--remote=--all', '--remote=ot*', '--remote=']) {
    const r = run(dir, ['--pre-push', bad], stdin);
    assert.strictEqual(r.code, 0, `${bad}: ${r.out}${r.err}`);
    assert.match(r.out, /pushed range: 1 ref\(s\), 0 commit\(s\)/, bad);
  }
});

test('a pushed tag whose target is not a commit is refused by name, never scanned unread', () => {
  const dir = repo([{ 'a.txt': 'one\n' }]);
  const blob = git(dir, 'hash-object', '-w', 'a.txt');
  const r = run(dir, ['--pre-push'], `refs/tags/x ${blob} refs/tags/x ${ZERO}\n`);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /FAIL SECRETS: .*pushes a non-commit object \(blob\)/);
});

test('a scan that cannot run fails: a missing scanner and a directory that is not a repository both exit 1 with a FAIL line', () => {
  const noLib = run(repo([{ 'a.txt': 'x\n' }], { withLib: false }));
  assert.strictEqual(noLib.code, 1);
  assert.match(noLib.out, /FAIL SECRETS: scripts\/lib\/secret-scan\.mjs could not load/);
  assert.ok(!/at .*:\d+:\d+/.test(noLib.out + noLib.err), 'no stack frame');
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'secret-gate-nogit-'));
  made.push(dir);
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(GATE, path.join(dir, 'scripts', 'secret-gate.mjs'));
  fs.copyFileSync(LIB, path.join(dir, 'scripts', 'lib', 'secret-scan.mjs'));
  const r = run(dir);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /FAIL SECRETS: .*not inside a git repository/);
});

test('a git that runs and refuses is reported with its own first line, never as git missing from PATH', () => {
  // a .git FILE naming a directory that is gone: git 2.56 answers "gitfile does not point to a valid repository", exit 128.
  // RED before the fix: the gate printed the cause "is git on PATH?" although git ran (git 2.56), or, on the ubuntu runner's
  // older git, which answers "not a git repository: <path>", the wrong cause "not inside a git repository" (CI, 2026-10-23).
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'secret-gate-brokenlink-'));
  made.push(dir);
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(GATE, path.join(dir, 'scripts', 'secret-gate.mjs'));
  fs.copyFileSync(LIB, path.join(dir, 'scripts', 'lib', 'secret-scan.mjs'));
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: ' + path.join(dir, 'gone-gitdir') + '\n');
  const r = run(dir);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /FAIL SECRETS: git could not list the tracked files \("fatal: /);
  assert.ok(!/is git on PATH/.test(r.out), 'git ran, so PATH is not the cause');
});

test('--help prints the usage and exits 0; an unknown flag is an error with the usage on stderr (64)', () => {
  const dir = repo([{ 'a.txt': 'x\n' }]);
  const h = run(dir, ['--help']);
  assert.strictEqual(h.code, 0);
  assert.match(h.out, /^usage: node scripts\/secret-gate\.mjs/);
  const u = run(dir, ['--bogus']);
  assert.strictEqual(u.code, 64);
  assert.match(u.err, /unknown argument "--bogus"/);
  assert.match(u.err, /usage: node scripts\/secret-gate\.mjs/);
  assert.strictEqual(u.out, '');
});

test('a file name that carries a right-to-left override is escaped in the report, never printed raw', () => {
  const rlo = String.fromCharCode(0x202e);
  const name = `evil${rlo}gnp.txt`; // category Cf: legal on every filesystem we run on, and it reorders the text a terminal shows
  const dir = repo([{ [name]: `${KEY}\n` }]);
  const r = run(dir);
  assert.strictEqual(r.code, 1);
  assert.ok(!r.out.includes(rlo), 'the override character must not reach the terminal');
  assert.ok(r.out.includes(String.fromCharCode(92) + 'u202e'), r.out);
});

test('a GIT_DIR a hook inherited is ignored: the gate scans the repository it runs in, not the one the variable names', () => {
  const dirty = repo([{ 'notes.txt': `x ${KEY}\n` }]);
  const decoy = repo([{ 'README.md': 'clean\n' }]);
  const r = run(dirty, [], '', { GIT_DIR: path.join(decoy, '.git') });
  assert.strictEqual(r.code, 1, 'the key in the repository the gate runs in must be found even when GIT_DIR names a clean one: ' + r.out + r.err);
  assert.match(r.out, /tree "notes\.txt":1 aws-access-key-id/);
});

test('commit mode scans the STAGED blobs: a key staged and then removed from the working tree is found; one only in the working tree is not committable and is not reported', () => {
  const dir = repo([{ 'a.txt': 'clean\n' }]);
  fs.writeFileSync(path.join(dir, 'a.txt'), `${KEY}\n`, 'utf8');
  git(dir, 'add', 'a.txt');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'clean\n', 'utf8'); // the working tree is clean again, the index still holds the key
  const staged = run(dir);
  assert.strictEqual(staged.code, 1, staged.out + staged.err);
  assert.match(staged.out, /tree "a\.txt":1 aws-access-key-id/);
  git(dir, 'reset', '-q', '--', 'a.txt');
  fs.writeFileSync(path.join(dir, 'a.txt'), `${KEY}\n`, 'utf8'); // only in the working tree now: nothing a commit or a push can carry
  assert.strictEqual(run(dir).code, 0, 'an unstaged edit is not what a commit records');
});

test('the commit\'s own index is the one read: a GIT_INDEX_FILE a hook sets (git commit -a) is honoured while every other GIT_* is dropped', () => {
  const dir = repo([{ 'a.txt': 'clean\n' }]);
  const idx = path.join(dir, '.git', 'commit-index');
  const withKey = execFileSync('git', ['-C', dir, 'hash-object', '-w', '--stdin'], { input: `${KEY}\n`, encoding: 'utf8', timeout: 60000, env: gitEnv() }).trim();
  // the commit's own index is made from the real one with the key staged, and the real index is then put back, so the key lives only in `idx` and no git call here is handed GIT_INDEX_FILE
  git(dir, 'update-index', '--add', '--cacheinfo', `100644,${withKey},k.txt`);
  fs.copyFileSync(path.join(dir, '.git', 'index'), idx);
  git(dir, 'update-index', '--force-remove', 'k.txt');
  const r = run(dir, [], '', { GIT_INDEX_FILE: idx });
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /tree "k\.txt":1 aws-access-key-id/);
  assert.strictEqual(run(dir).code, 0, 'without the variable the real index is clean');
});

test('a staged entry whose blob cannot be read fails the scan by count, never passes as scanned', () => {
  const dir = repo([{ 'a.txt': 'clean\n' }]);
  git(dir, 'update-index', '--add', '--info-only', '--cacheinfo', `100644,${'1'.repeat(40)},ghost.txt`);
  const r = run(dir);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /FAIL SECRETS: 1 tracked file\(s\) could not be read, so were NOT scanned: "ghost\.txt"/);
});

test('an unreadable pushed range fails: a ref line naming a commit git does not have exits 1 and says the added lines were NOT scanned', () => {
  const dir = repo([{ 'a.txt': 'one\n' }]);
  const r = run(dir, ['--pre-push'], `refs/heads/main ${'1'.repeat(40)} refs/heads/main ${ZERO}\n`);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /FAIL SECRETS: the pushed range could not be read .*; the added lines of this push were NOT scanned/);
});

test('a staged blob that is damaged on disk fails the scan by count: exit 1, named, never a clean pass', () => {
  const dir = repo([{ 'a.txt': 'clean\n' }]);
  const sha = execFileSync('git', ['-C', dir, 'hash-object', '-w', '--stdin'], { input: 'a blob that will be damaged\n', encoding: 'utf8', timeout: 60000, env: gitEnv() }).trim();
  const loose = path.join(dir, '.git', 'objects', sha.slice(0, 2), sha.slice(2));
  fs.chmodSync(loose, 0o644);
  fs.writeFileSync(loose, 'not a zlib stream');
  git(dir, 'update-index', '--add', '--cacheinfo', `100644,${sha},damaged.txt`);
  const r = run(dir);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /FAIL SECRETS: 1 tracked file\(s\) could not be read, so were NOT scanned: "damaged\.txt"/);
});

// The fixtures must not depend on, or write into, the developer's own machine. Every fixture
// folder lives in ONE sandbox of the test's own, the children's TEMP, TMP and TMPDIR point at it, and the developer's global git configuration
// (a hooks path, a signing rule, a template directory) never applies: HOME and XDG_CONFIG_HOME are the sandbox, whose global configuration is an empty file, and the system
// config is switched off. The witness below plants a hostile global config and a hostile HOME; the fixture commits must still work.
test('the fixtures run in the test\'s own sandbox: a hostile global git config and HOME never reach them, and the fixture folders live inside the sandbox', () => {
  const hostile = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-gate-hostile-'));
  made.push(hostile);
  const hooks = path.join(hostile, 'hooks');
  fs.mkdirSync(hooks);
  fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho hostile global hook >&2\nexit 1\n', { mode: 0o755 });
  const hostileConfig = '[core]\n\thooksPath = ' + hooks.replace(/\\/g, '/') + '\n';
  fs.writeFileSync(path.join(hostile, '.gitconfig'), hostileConfig); // read through HOME
  fs.mkdirSync(path.join(hostile, 'git'));
  fs.writeFileSync(path.join(hostile, 'git', 'config'), hostileConfig); // read through XDG_CONFIG_HOME (a copy at hostile/.gitconfig alone would test nothing: XDG never reads that path)
  // The hostile HOME, USERPROFILE and XDG_CONFIG_HOME are planted on THIS process (and put back): the environment of a fixture call is built from named keys, so none of them
  // reaches git. Make gitEnv() a copy of the process's own environment and the commit below fails under the hostile hook.
  // SECRET_GATE_TEST_PLANTED is no GIT_ name: a copy of the process's own environment, filtered or not, would carry it. NODE_OPTIONS is the one name the gate child is handed on purpose.
  const planted = { HOME: hostile, USERPROFILE: hostile, XDG_CONFIG_HOME: hostile, SECRET_GATE_TEST_PLANTED: 'planted', NODE_OPTIONS: '--max-old-space-size=512' };
  const saved = Object.fromEntries(Object.keys(planted).map((k) => [k, process.env[k]]));
  Object.assign(process.env, planted);
  try {
    const dir = repo([{ 'a.txt': 'x\n' }]); // a commit under the hostile global hook would fail with exit 1
    assert.equal(git(dir, 'config', '--global', '--list'), '', 'git reads no global configuration even with the hostile HOME and XDG_CONFIG_HOME in place');
    assert.ok(path.resolve(dir).startsWith(path.resolve(SANDBOX) + path.sep), 'the fixture folder is inside the sandbox: ' + dir);
    const probe = execFileSync(process.execPath, ['--max-old-space-size=256', '-e', 'const e = process.env; console.log(JSON.stringify([e.TEMP, e.TMP, e.TMPDIR, e.HOME, e.XDG_CONFIG_HOME, e.GIT_CONFIG_NOSYSTEM, e.GIT_CONFIG_GLOBAL === undefined, e.SECRET_GATE_TEST_PLANTED === undefined, e.NODE_OPTIONS === undefined]))'], { encoding: 'utf8', timeout: 60000, env: gitEnv() });
    const [tmp, tmp2, tmpdir, home, xdg, nosys, noGlobal, noMarker, noNodeOptions] = JSON.parse(probe);
    assert.deepEqual([tmp, tmp2, tmpdir, home, xdg], [SANDBOX, SANDBOX, SANDBOX, SANDBOX, SANDBOX]);
    assert.equal(fs.readFileSync(path.join(SANDBOX, '.gitconfig'), 'utf8'), '', 'the global config is an empty file of the sandbox');
    assert.equal(nosys, '1');
    assert.equal(noGlobal, true, 'no GIT_CONFIG_GLOBAL is set: the canon allows only GIT_CONFIG_NOSYSTEM, GIT_TERMINAL_PROMPT and GIT_CEILING_DIRECTORIES');
    assert.equal(noMarker, true, 'the environment is built from named keys: a name the process merely inherited is not in it');
    assert.equal(noNodeOptions, true, 'a git call is handed no NODE_OPTIONS');
    const gateProbe = execFileSync(process.execPath, ['--max-old-space-size=256', '-e', 'const e = process.env; console.log(JSON.stringify([e.NODE_OPTIONS, e.SECRET_GATE_TEST_PLANTED === undefined, e.HOME]))'], { encoding: 'utf8', timeout: 60000, env: gateEnv(SANDBOX) });
    assert.deepEqual(JSON.parse(gateProbe), ['--max-old-space-size=512', true, SANDBOX], 'the gate child is handed NODE_OPTIONS by name and nothing else the process inherited');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

// When the machine's temp folder sits inside a git repository, the sandbox sits inside it too, and a fixture folder that is
// NOT a repository would find that outer repository. The sandbox's git calls carry a ceiling at the sandbox's parent so the search stops there.
// The witness runs the test that needs "not inside a git repository" in a child whose TEMP, TMP and TMPDIR are a folder inside a real repository.
// The child's reporter is PINNED to tap: left to its default it is spec on Node 24 (measured, stdout a pipe or a file) and tap on Node 22 when stdout is not a TTY
// (nodejs.org v22 test docs), so a count read from the default was right on a developer's Node 24 and wrong on CI's Node 22.
test('the sandbox is closed against a repository ABOVE the temp folder: a non-repository fixture is still not inside one', { skip: process.env.SECRET_GATE_NESTED ? 'this is the nested run' : false }, () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-gate-outer-'));
  made.push(outer);
  git(outer, 'init', '-q', '-b', 'main');
  const tmpInside = path.join(outer, 'tmp');
  fs.mkdirSync(tmpInside);
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'WINDIR'];
  const env = { ...Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])), TEMP: tmpInside, TMP: tmpInside, TMPDIR: tmpInside, HOME: tmpInside, USERPROFILE: tmpInside, SECRET_GATE_NESTED: '1' };
  const r = spawnSync(process.execPath, ['--max-old-space-size=512', '--test', '--test-timeout=60000', '--test-reporter=tap', '--test-name-pattern=a scan that cannot run', fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 120000, env });
  assert.match(r.stdout, /^# pass 1$/m, 'the nested run really ran the test: ' + r.stdout.slice(-400));
  assert.strictEqual(r.status, 0, r.stdout.slice(-800) + r.stderr.slice(-400));
});

// ---- a binary-looking NAME no longer skips a blob before its bytes are read; a blob id shared by several paths is read once;
// git is never launched from the checkout the gate scans. Each was RED on the code before it.
test('a staged text file with a binary-looking name is still scanned: the bytes decide, never the name', () => {
  const nul = String.fromCharCode(0);
  const r = run(repo([{ 'notes.png': `id ${KEY}\n`, 'real.png': `PNG${nul}${nul} id ${KEY}\n` }]));
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /tree "notes\.png":1 /, 'the text file named .png was read and its key found');
  assert.doesNotMatch(r.out, /real\.png/, 'a blob whose first bytes hold a NUL is binary by its content and stays out of the text scan');
});

test('a blob id staged at several paths is handed to git cat-file once, and every path is still reported', () => {
  const dir = repo([{ 'a.txt': `id ${KEY}\n`, 'b.txt': `id ${KEY}\n`, 'c/d.txt': `id ${KEY}\n`, 'README.md': 'hello\n' }]);
  // A preload records what the gate hands to cat-file; the gate's own code is never changed for the test.
  const preload = path.join(SANDBOX, `catfile-probe-${made.length}.mjs`);
  const log = preload + '.log';
  fs.writeFileSync(preload, [
    "import cp from 'node:child_process';",
    "import fs from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const orig = cp.spawn;',
    "cp.spawn = function (file, args) { const c = orig.apply(this, arguments); if (Array.isArray(args) && args.includes('cat-file')) { const end = c.stdin.end.bind(c.stdin); c.stdin.end = (d, ...rest) => { if (d != null) fs.appendFileSync(process.env.GATE_PROBE_LOG, String(d)); return end(d, ...rest); }; } return c; };",
    'syncBuiltinESMExports();',
  ].join('\n'));
  const r = run(dir, [], '', { NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${pathToFileURL(preload).href}`].filter(Boolean).join(' '), GATE_PROBE_LOG: log });
  assert.strictEqual(r.code, 1, r.out + r.err);
  for (const f of ['a.txt', 'b.txt', 'c/d.txt']) assert.ok(r.out.includes(`tree "${f}":1 `), `${f} is reported: ${r.out}`);
  const ids = fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean);
  assert.ok(ids.length >= 2, 'the probe saw the cat-file input');
  assert.strictEqual(new Set(ids).size, ids.length, `every id is asked for once: ${ids.length} asked, ${new Set(ids).size} distinct`);
});

test('a git.exe planted in the scanned checkout is never run in git\'s place on Windows', (t) => {
  // Elsewhere the current folder is searched only when PATH names it, the user's own setting, so the case is Windows'.
  if (process.platform !== 'win32') { t.skip('only Windows looks for a program in the current folder first'); return; }
  const dir = repo([{ 'README.md': 'hello\n' }]);
  // any small program stands in for a planted git.exe: it cannot list the index, so a gate that ran it cannot pass
  fs.copyFileSync(path.join(process.env.SystemRoot, 'System32', 'whoami.exe'), path.join(dir, 'git.exe'));
  // the sandbox environment never carries Windows' own switch, so the gate must set it for itself
  const r = run(dir);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /^PASS SECRETS: tree scan of \d+ tracked text file\(s\) clean/m);
});

// A staged binary blob is streamed past, never held: the batch is read as a stream, and a blob whose every path has a binary-looking name is judged
// on its first bytes and dropped as it passes. The witness is the gate's PEAK memory (process.resourceUsage().maxRSS, written at exit by a preload),
// compared with the same gate on the same tree before the blob is staged: holding the blob (the whole batch in one buffer, or the blob kept whole)
// raises the peak by at least the blob's size (twice it, where the parts are joined at the end); streaming leaves only the pipe's chunks waiting for
// the collector, measured at 38 to 44 MiB for a 64 MiB blob under a loaded suite. So the bound is the blob's own size, and 128 MiB keeps that margin
// wide while the leg stays cheap (a few seconds) in every room's pre-commit and pre-push. The blob is piped into git, never written as a file or held in memory here.
const PEAK_PRELOAD = path.join(SANDBOX, 'peak-rss.preload.mjs');
fs.writeFileSync(PEAK_PRELOAD, "import fs from 'node:fs';\nprocess.on('exit', () => fs.writeFileSync(process.env.GATE_PEAK_OUT, String(process.resourceUsage().maxRSS * 1024)));\n");
const BIG_BLOB_BYTES = 128 << 20;
test('a staged binary blob is streamed past, never held: the gate passes, names it nowhere, and its peak memory grows by far less than the blob', async () => {
  const dir = repo([{ 'README.md': 'hello\n' }]);
  const count = (out) => (/^PASS SECRETS: tree scan of (\d+) tracked text file/m.exec(out) || [])[1];
  const peakOut = path.join(SANDBOX, `peak-${made.length}.txt`);
  const measured = () => {
    const r = run(dir, [], '', { NODE_OPTIONS: `--import ${pathToFileURL(PEAK_PRELOAD).href}`, GATE_PEAK_OUT: peakOut }, 120000);
    return { r, peak: Number(fs.readFileSync(peakOut, 'utf8')) };
  };
  const base = measured();
  assert.strictEqual(base.r.code, 0, base.r.out + base.r.err);
  const before = count(base.r.out);
  assert.ok(before && base.peak > 0, 'the clean tree passes and its peak is read');
  const sha = await new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', dir, 'hash-object', '-w', '--stdin'], { env: gitEnv(), timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`hash-object exit ${code}`))));
    const zeros = Buffer.alloc(1 << 20);
    let left = BIG_BLOB_BYTES;
    const pump = () => {
      while (left > 0) { left -= zeros.length; if (!child.stdin.write(zeros)) { child.stdin.once('drain', pump); return; } }
      child.stdin.end();
    };
    pump();
  });
  git(dir, 'update-index', '--add', '--cacheinfo', `100644,${sha},big.bin`);
  const big = measured();
  assert.strictEqual(big.r.code, 0, big.r.out + big.r.err);
  assert.strictEqual(count(big.r.out), before, 'the binary blob is not counted as a text file: ' + big.r.out);
  assert.doesNotMatch(big.r.out, /big\.bin/);
  const grew = big.peak - base.peak;
  assert.ok(grew < BIG_BLOB_BYTES, `the peak grew by ${(grew / 1048576).toFixed(1)} MiB for a ${BIG_BLOB_BYTES / 1048576} MiB blob: the blob was held`);
});

// git honours a replace ref when it reads an object, so a local `git replace` could show the gate a clean blob in place of the one the commit
// records and pushes. The gate reads every object with replace refs off.
test('a replace ref never changes what is scanned: a key blob replaced by a clean one is still found, in the tree and in the pushed range', () => {
  const dir = repo([{ 'a.txt': 'one\n' }, { 'k.txt': `${KEY}\n` }]);
  const keyBlob = git(dir, 'rev-parse', 'HEAD:k.txt');
  const clean = execFileSync('git', ['-C', dir, 'hash-object', '-w', '--stdin'], { input: 'clean\n', encoding: 'utf8', timeout: 60000, env: gitEnv() }).trim();
  git(dir, 'replace', keyBlob, clean);
  const tree = run(dir);
  assert.strictEqual(tree.code, 1, tree.out + tree.err);
  assert.match(tree.out, /tree "k\.txt":1 aws-access-key-id/);
  const tip = git(dir, 'rev-parse', 'HEAD');
  const pushed = run(dir, ['--pre-push'], `refs/heads/main ${tip} refs/heads/main ${ZERO}\n`);
  assert.strictEqual(pushed.code, 1, pushed.out + pushed.err);
  assert.match(pushed.out, /pushed [0-9a-f]{12} "k\.txt":1 aws-access-key-id/);
});

test('git\'s own diagnostic is escaped in the report: a path in it that carries a right-to-left override never reaches the terminal raw', () => {
  const rlo = String.fromCharCode(0x202e);
  // git names the .git file in its refusal, so the override sits in the checkout's own folder name
  const dir = fs.mkdtempSync(path.join(SANDBOX, `secret-gate-rlo${rlo}knil-`));
  made.push(dir);
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(GATE, path.join(dir, 'scripts', 'secret-gate.mjs'));
  fs.copyFileSync(LIB, path.join(dir, 'scripts', 'lib', 'secret-scan.mjs'));
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: ' + path.join(dir, 'gone-gitdir') + '\n');
  const r = run(dir);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /FAIL SECRETS: git could not list the tracked files \("fatal: /);
  assert.ok(!r.out.includes(rlo), 'the override character in git\'s message must not reach the terminal');
  assert.ok(r.out.includes(String.fromCharCode(92) + 'u202e'), r.out);
});

// A node child this file starts is capped like any harness child: a heap cap and a kill-timeout, so one runaway cannot take the machine.
test('every node child this test file starts carries a heap cap and a kill-timeout', () => {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const calls = [...src.matchAll(/(?:execFileSync|spawnSync|spawn)\(process\.execPath, /g)];
  assert.ok(calls.length >= 4, `found ${calls.length} node child calls`);
  for (const m of calls) {
    const call = src.slice(m.index, src.indexOf('});', m.index) + 3);
    const line = src.slice(0, m.index).split('\n').length;
    assert.ok(call.includes('--max-old-space-size='), `line ${line}: no heap cap`);
    assert.ok(/\btimeout\b/.test(call), `line ${line}: no kill-timeout`);
  }
});

// The stream parser's guards, each witnessed by a cat-file that answers wrongly: a preload swaps the gate's cat-file child for a node script that asks
// the real git, then cuts or bends the answer. The gate must refuse with its own named error ("git could not read the staged files"), never pass the
// tree and never throw a TypeError. early: the stream ends after the first object, exit 0 · negsize: the first header says size -1 · nonl: the newline
// after the first object's bytes is missing · exit1: a whole, correct answer with exit code 1.
const FAKE_CATFILE = path.join(SANDBOX, 'fake-catfile.mjs');
fs.writeFileSync(FAKE_CATFILE, [
  "import { execFileSync } from 'node:child_process';",
  "import fs from 'node:fs';",
  // the real git gets named keys only, never the environment the fake was handed
  "const env = { PATH: process.env.PATH, Path: process.env.Path, SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR, GIT_CONFIG_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: process.env.GIT_CEILING_DIRECTORIES };",
  "const real = execFileSync('git', ['--no-replace-objects', 'cat-file', '--batch'], { input: fs.readFileSync(0), maxBuffer: 1 << 28, timeout: 60000, env });",
  'const nl = real.indexOf(10);',
  "const head = real.toString('latin1', 0, nl).split(' ');",
  'const firstEnd = nl + 1 + Number(head[2]) + 1;',
  'const mode = process.env.FAKE_CATFILE_MODE;',
  'let out = real;',
  "if (mode === 'early') out = real.subarray(0, firstEnd);",
  "if (mode === 'negsize') out = Buffer.concat([Buffer.from(head[0] + ' ' + head[1] + ' -1' + String.fromCharCode(10, 10), 'latin1'), real.subarray(firstEnd)]);",
  "if (mode === 'nonl') out = Buffer.concat([real.subarray(0, firstEnd - 1), real.subarray(firstEnd)]);",
  // huge: the first header declares 300,000,000 bytes (past the 256 MiB ceiling) and the stream then ends: only the header check can answer it by name
  "if (mode === 'huge') out = Buffer.concat([Buffer.from(head[0] + ' blob 300000000' + String.fromCharCode(10), 'latin1'), Buffer.from('xx')]);",
  // rechunk: the whole, correct answer, handed over in pieces of FAKE_CHUNK bytes, each written when the last was accepted (no timer: a 1 ms timer is about 15 ms on Windows), so the gate sees pieces of a size git does not choose (18b: the verdict must not depend on them)
  "if (process.env.FAKE_SPAWN_LOG) fs.appendFileSync(process.env.FAKE_SPAWN_LOG, 'cat-file' + String.fromCharCode(10));",
  // second-exit1: the first run answers whole and right; every later run (a re-read) answers whole and exits 1, so the gate's re-read fails (needs FAKE_SPAWN_LOG)
  "if (mode === 'second-exit1' && fs.readFileSync(process.env.FAKE_SPAWN_LOG, 'utf8').split(String.fromCharCode(10)).filter(Boolean).length > 1) { process.stdout.write(out, () => { process.exitCode = 1; }); }",
  "if (mode === 'rechunk') { const n = Number(process.env.FAKE_CHUNK); (async () => { for (let i = 0; i < out.length; i += n) await new Promise((r) => process.stdout.write(out.subarray(i, i + n), r)); })(); }",
  "else if (mode !== 'second-exit1' || fs.readFileSync(process.env.FAKE_SPAWN_LOG, 'utf8').split(String.fromCharCode(10)).filter(Boolean).length <= 1) process.stdout.write(out, () => { process.exitCode = mode === 'exit1' ? 1 : 0; });",
].join('\n'));
const FAKE_PRELOAD = path.join(SANDBOX, 'fake-catfile.preload.mjs');
fs.writeFileSync(FAKE_PRELOAD, [
  "import cp from 'node:child_process';",
  "import { syncBuiltinESMExports } from 'node:module';",
  'const orig = cp.spawn;',
  "cp.spawn = function (file, args, opts) { return Array.isArray(args) && args.includes('cat-file') ? orig.call(this, process.execPath, ['--max-old-space-size=256', " + JSON.stringify(FAKE_CATFILE) + "], opts) : orig.apply(this, arguments); };",
  'syncBuiltinESMExports();',
].join('\n'));
test('a cat-file answer that ends early, gives a bad size, drops a newline or exits non-zero makes the gate refuse by name, never pass or throw', () => {
  const dir = repo([{ 'README.md': 'hello\n', 'a.txt': 'clean\n' }]);
  for (const [mode, why] of [['early', 'ECATFILE'], ['negsize', 'ECATFILE'], ['nonl', 'ECATFILE'], ['exit1', 'exit 1']]) {
    const r = run(dir, [], '', { NODE_OPTIONS: `--import ${pathToFileURL(FAKE_PRELOAD).href}`, FAKE_CATFILE_MODE: mode });
    assert.strictEqual(r.code, 1, `${mode}: ${r.out}${r.err}`);
    assert.ok(r.out.includes(`FAIL SECRETS: git could not read the staged files (${why}); the tree was NOT scanned`), `${mode}: ${r.out}${r.err}`);
    assert.doesNotMatch(r.err, /TypeError/, mode);
  }
});

// t342 F9 (17b): SECRET_GATE_MAX_HELD_BYTES can only LOWER the ceiling. The reviewer's mutant (a ceiling taken from any positive value) survived the 17a tests, which ran a LOWER value and a huge one only
// on a small tree. Here a cat-file that declares a 300,000,000-byte blob (past the 256 MiB ceiling) is run with the variable raised far past it: the gate must still refuse the header by name with the
// DEFAULT ceiling in the message, where a gate that obeyed the raised value would read on and end with "cat-file output ended early". A lowered value and an invalid one are checked beside it.
test('SECRET_GATE_MAX_HELD_BYTES cannot raise the held-bytes ceiling: a blob declared past 256 MiB is refused by name whatever the variable says -- RED against a gate that takes any positive value', () => {
  const dir = repo([{ 'README.md': 'hello\n' }]);
  const base = { NODE_OPTIONS: `--import ${pathToFileURL(FAKE_PRELOAD).href}`, FAKE_CATFILE_MODE: 'huge' };
  const named = /FAIL SECRETS: "README\.md" is too large to hold: more than (\d+) bytes of staged text would be held in memory at once; the tree was NOT scanned/;
  for (const value of [undefined, '999999999999', '268435456', '268435457', '0', '-5', 'abc', '1e30', '']) {
    const r = run(dir, [], '', { ...base, ...(value === undefined ? {} : { SECRET_GATE_MAX_HELD_BYTES: value }) });
    assert.strictEqual(r.code, 1, `${value}: ${r.out}${r.err}`);
    const m = named.exec(r.out);
    assert.ok(m, `${value}: the declared 300,000,000-byte blob was not refused by name: ${r.out}${r.err}`);
    assert.strictEqual(m[1], '268435456', `${value}: the ceiling in force is the default 256 MiB`);
  }
  const lowered = run(dir, [], '', { ...base, SECRET_GATE_MAX_HELD_BYTES: '1000' });
  assert.match(lowered.out, /more than 1000 bytes of staged text/, 'a lower value is obeyed');
});

// A text file in UTF-16 holds a NUL in every code unit of ASCII text, so a gate that decodes UTF-8 or tests "binary" first never sees its key.
// PowerShell 5.1's `>` writes UTF-16LE with a byte-order mark; an editor can write either order, with or without the mark. Each must be refused
// exactly as its UTF-8 copy is, whatever its name. A real binary file, with NULs on both byte parities, is still skipped.
test('a text file in UTF-16 (LE and BE, with and without a byte-order mark) that holds a key is refused like its UTF-8 copy; a binary with NULs on both parities is still skipped', () => {
  const text = `a\nb ${KEY} c\n`;
  const le = Buffer.from(text, 'utf16le');
  const be = Buffer.from(le).swap16();
  const files = {
    'le-bom.txt': Buffer.concat([Buffer.from([0xff, 0xfe]), le]),
    'le.txt': le,
    'be-bom.txt': Buffer.concat([Buffer.from([0xfe, 0xff]), be]),
    'be.txt': be,
    // a UTF-16 file with a binary-looking name and bytes of its own (no other path stages the same blob): only the stream probe's UTF-16 rule keeps it
    'ps-out.bin': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`x\nps ${KEY} out\n`, 'utf16le')]),
    'data.bin': Buffer.concat([Buffer.from([0x89, 0x50, 0x00, 0x00, 0x20]), Buffer.from(`id ${KEY}\n`, 'latin1'), Buffer.from([0x00, 0x01, 0x00])]),
  };
  const r = run(repo([files]));
  assert.strictEqual(r.code, 1, r.out + r.err);
  for (const name of ['le-bom.txt', 'le.txt', 'be-bom.txt', 'be.txt', 'ps-out.bin']) assert.ok(r.out.includes(`tree "${name}":2 aws-access-key-id`), `${name} is refused: ${r.out}`);
  assert.doesNotMatch(r.out, /data\.bin/, 'a binary with NULs on both byte parities stays out of the text scan');
  assert.ok(!r.out.includes(KEY) && !r.err.includes(KEY), 'the matched value is never printed');
});

// Wide text a byte-order mark does not announce, and wider text: UTF-16 with a non-ASCII character before the key (U+0100 little-endian, U+4E00
// big-endian, 4,000 Thai characters), and UTF-32 little-endian. The scanner's rule reads each as wide text from where its NULs fall, and decodes it, so
// the key stands whole whatever the width, order or prefix. A real binary with NULs is still never reported for noise.
const utf16be = (s) => Buffer.from(s, 'utf16le').swap16();
const utf32le = (s) => { const b = Buffer.alloc(s.length * 4); [...s].forEach((c, i) => b.writeUInt32LE(c.codePointAt(0), i * 4)); return b; };
test('wide text with no byte-order mark, a non-ASCII prefix or four bytes a character still has its key refused, in the tree and in the pushed range', () => {
  const thai = String.fromCharCode(0x0e01).repeat(4000);
  const files = {
    'u0100.txt': Buffer.from(`${String.fromCharCode(0x0100)}\nb ${KEY} c\n`, 'utf16le'),
    'u4e00.txt': utf16be(`${String.fromCharCode(0x4e00)}\nb ${KEY} c\n`),
    'thai.txt': Buffer.from(`${thai}\nb ${KEY} c\n`, 'utf16le'),
    'u32.txt': utf32le(`a\nb ${KEY} c\n`),
  };
  const r = run(repo([files]));
  assert.strictEqual(r.code, 1, r.out + r.err);
  for (const name of Object.keys(files)) assert.ok(r.out.includes(`tree "${name}":2 aws-access-key-id`), `${name} is refused in the tree: ${r.out}`);
  const dir = repo([{ 'a.txt': 'one\n' }, files, Object.fromEntries(Object.keys(files).map((n) => [n, null]))]);
  assert.strictEqual(run(dir).code, 0, 'the tree at HEAD is clean');
  const tip = git(dir, 'rev-parse', 'HEAD');
  const p = run(dir, ['--pre-push'], `refs/heads/main ${tip} refs/heads/main ${ZERO}\n`);
  assert.strictEqual(p.code, 1, p.out + p.err);
  for (const name of Object.keys(files)) assert.match(p.out, new RegExp(`pushed [0-9a-f]{12} "${name.replace('.', String.fromCharCode(92) + '.')}":2 aws-access-key-id`), name);
});

// The pushed range reads each commit's patch as bytes and decodes the hunks the rule reads as wide text. A key in a UTF-16 file (here little-endian with its mark, as PowerShell 5.1 writes it) that one
// pushed commit adds and a later one deletes never reaches the tree scan, so the range must find it, exactly as it finds the same key in UTF-8.
test('a UTF-16 key added and then deleted inside a pushed range is refused, as its UTF-8 copy is', () => {
  for (const [label, bytes] of [['utf-16le', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`a\nb ${KEY} c\n`, 'utf16le')])], ['utf-8', Buffer.from(`a\nb ${KEY} c\n`, 'utf8')]]) {
    const dir = repo([{ 'a.txt': 'one\n' }, { 'k.txt': bytes }, { 'k.txt': null }]);
    assert.strictEqual(run(dir).code, 0, `${label}: the tree at HEAD is clean`);
    const tip = git(dir, 'rev-parse', 'HEAD');
    const r = run(dir, ['--pre-push'], `refs/heads/main ${tip} refs/heads/main ${ZERO}\n`);
    assert.strictEqual(r.code, 1, `${label}: ${r.out}${r.err}`);
    assert.match(r.out, /pushed [0-9a-f]{12} "k\.txt":2 aws-access-key-id/, label);
  }
});

// Decoding noise: a file that is not text, with NUL bytes on both byte positions and no binary-looking name, is scanned and reported for nothing.
test('a NUL-bearing file of pseudo-random bytes with no binary-looking name gives no hit, in the tree and in the pushed range', () => {
  let x = 0x2545f491;
  const noise = Buffer.alloc(65536, 0).map((_, i) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return i % 3 === 0 ? 0 : (x >>> 0) & 0xff; });
  const dir = repo([{ 'a.txt': 'one\n' }, { 'noise.dat': noise }]);
  const r = run(dir);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const tip = git(dir, 'rev-parse', 'HEAD');
  const p = run(dir, ['--pre-push'], `refs/heads/main ${tip} refs/heads/main ${ZERO}\n`);
  assert.strictEqual(p.code, 0, p.out + p.err);
});

// A binary-looking name with UTF-16 bytes and no byte-order mark, in each byte order: only the NUL-parity rule tells it from a real binary, so
// each must still be scanned (and the stream probe must keep it).
// And the reverse: text mostly outside ASCII (three Thai characters to one ASCII), so its NULs fall on one parity but on fewer than half its code
// units and the parity rule cannot tell; only the byte-order mark says it is text.
test('a binary-named UTF-16 file is still scanned: with no byte-order mark in either order, and with a mark over text mostly outside ASCII', () => {
  const wide = String.fromCharCode(0x0e01, 0x0e01, 0x0e01, 0x61).repeat(1000);
  const r = run(repo([{
    'le-nobom.bin': Buffer.from(`y\nle ${KEY} nobom\n`, 'utf16le'),
    'be-nobom.bin': Buffer.from(`z\nbe ${KEY} nobom\n`, 'utf16le').swap16(),
    'le-mark.bin': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${wide}\nb ${KEY} le\n`, 'utf16le')]),
    'be-mark.bin': Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(`${wide}\nb ${KEY} be\n`, 'utf16le').swap16()]),
  }]));
  assert.strictEqual(r.code, 1, r.out + r.err);
  for (const name of ['le-nobom.bin', 'be-nobom.bin', 'le-mark.bin', 'be-mark.bin']) assert.ok(r.out.includes(`tree "${name}":2 aws-access-key-id`), `${name} is refused: ${r.out}`);
});

// The scanner's second reading adds only what the first did not find: a line that holds a key in plain ASCII and a NUL elsewhere is one hit, not two.
test('the scanner reports a key once on a line that also holds a NUL, read as it stands and with its NULs removed', async () => {
  const { scanText } = await import(pathToFileURL(LIB).href);
  const hits = scanText(`a\nb ${KEY} c${String.fromCharCode(0)}d\n`, 'f.txt');
  assert.strictEqual(hits.length, 1, JSON.stringify(hits));
  assert.strictEqual(hits[0].line, 2);
});

// A Thai character written next to a key in wide text: its code unit holds a byte that is an ASCII letter or digit (ใ is 43 0E in UTF-16LE, า is
// 32 0E, แ is 0E 41 in UTF-16BE), so any reading that only drops the NULs glues that byte onto the key and the pattern misses it. Decoded as wide
// text, the key stands alone, as it does in its UTF-8 copy. ช (U+0E0A) is 0A 0E in UTF-16LE, so git also cuts the patch line inside it.
const TH = (...cps) => String.fromCharCode(...cps);
const glued = {
  'th-chai.txt': ['le-bom', `a\nid ${KEY}${TH(0x0e43, 0x0e0a, 0x0e49)}\n`],
  'th-aa.txt': ['le-bom', `a\n${KEY}${TH(0x0e32)}\n`],
  'th-ae.txt': ['be', `a\nid${TH(0x0e41)}${KEY}\n`],
  'th-ae-bom.txt': ['be-bom', `a\nid${TH(0x0e41)}${KEY} x\n`],
};
const wideBytes = (form, s) => {
  const le = Buffer.from(s, 'utf16le');
  if (form === 'le-bom') return Buffer.concat([Buffer.from([0xff, 0xfe]), le]);
  if (form === 'be') return Buffer.from(le).swap16();
  return Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(le).swap16()]);
};
test('a key glued to a Thai character in UTF-16 (LE with a mark, BE with and without one) is refused in the tree, as its UTF-8 copy is', () => {
  for (const [label, enc] of [['utf-16', (form, s) => wideBytes(form, s)], ['utf-8', (form, s) => Buffer.from(s, 'utf8')]]) {
    const r = run(repo([Object.fromEntries(Object.entries(glued).map(([n, [form, s]]) => [n, enc(form, s)]))]));
    assert.strictEqual(r.code, 1, `${label}: ${r.out}${r.err}`);
    for (const name of Object.keys(glued)) assert.ok(r.out.includes(`tree "${name}":2 aws-access-key-id`), `${label} ${name} is refused: ${r.out}`);
  }
});
test('a key glued to a Thai character in a UTF-16 file that one pushed commit adds and a later one deletes is refused, as its UTF-8 copy is; so is one added inside an existing UTF-16 file', () => {
  const s = `a\nid ${KEY}${TH(0x0e43, 0x0e0a, 0x0e49)}\n`;
  for (const [label, bytes] of [['utf-16le', wideBytes('le-bom', s)], ['utf-8', Buffer.from(s, 'utf8')]]) {
    const dir = repo([{ 'a.txt': 'one\n' }, { 'k.txt': bytes }, { 'k.txt': null }]);
    assert.strictEqual(run(dir).code, 0, `${label}: the tree at HEAD is clean`);
    const tip = git(dir, 'rev-parse', 'HEAD');
    const r = run(dir, ['--pre-push'], `refs/heads/main ${tip} refs/heads/main ${ZERO}\n`);
    assert.strictEqual(r.code, 1, `${label}: ${r.out}${r.err}`);
    assert.match(r.out, /pushed [0-9a-f]{12} "k\.txt":2 aws-access-key-id/, label);
  }
  // the added hunk starts part-way through the file, at whatever byte git's line break left it on
  const lines = Array.from({ length: 6 }, (_, i) => `line ${TH(0x0e01 + i)} ${i}`);
  const before = wideBytes('le-bom', lines.join('\n') + '\n');
  const after = wideBytes('le-bom', [...lines.slice(0, 3), `id ${KEY}${TH(0x0e32)} x`, ...lines.slice(3)].join('\n') + '\n');
  const dir = repo([{ 'w.txt': before }, { 'w.txt': after }, { 'w.txt': before }]);
  assert.strictEqual(run(dir).code, 0, 'the tree at HEAD is clean');
  const tip = git(dir, 'rev-parse', 'HEAD');
  const r = run(dir, ['--pre-push'], `refs/heads/main ${tip} refs/heads/main ${ZERO}\n`);
  assert.strictEqual(r.code, 1, r.out + r.err);
  // the file's line breaks are its own (0A 00), so git's line 4 is the text's line 4
  assert.match(r.out, /pushed [0-9a-f]{12} "w\.txt":4 aws-access-key-id/);
});

// The rule for "these bytes are wide text", at its edges: a byte-order mark; at least WIDE_MIN_NULS (12) NULs on one byte parity and at least
// WIDE_SKEW (4) times as many as on the other; UTF-32 when three of four positions hold them. NULs spread evenly are never wide text.
test('the wide-text rule reads a byte-order mark, or enough NULs skewed onto the high bytes, and nothing else', async () => {
  const { wideKinds } = await import(pathToFileURL(LIB).href);
  const at = (len, zeros) => { const b = Buffer.alloc(len, 0x61); for (const i of zeros) b[i] = 0; return b; };
  const odd = Array.from({ length: 12 }, (_, i) => 2 * i + 1);
  assert.deepStrictEqual(wideKinds(Buffer.from('x'.repeat(12), 'utf16le')), ['utf16']);
  assert.deepStrictEqual(wideKinds(Buffer.from('x'.repeat(11), 'utf16le')), [], 'eleven NULs are too few');
  assert.deepStrictEqual(wideKinds(at(64, [...odd, 40, 42, 44])), ['utf16'], 'twelve to three is skewed enough');
  assert.deepStrictEqual(wideKinds(at(64, [...odd, 40, 42, 44, 46])), [], 'twelve to four is not');
  assert.deepStrictEqual(wideKinds(Buffer.alloc(64)), [], 'NULs on every position are not wide text');
  const two = Array.from({ length: 12 }, (_, i) => [4 * i + 2, 4 * i + 3]).flat();
  assert.deepStrictEqual(wideKinds(at(64, two)), [], 'NULs on two of four positions are not UTF-32');
  assert.deepStrictEqual(wideKinds(Buffer.from([0xff, 0xfe, 0x61])), ['utf16']);
  assert.deepStrictEqual(wideKinds(Buffer.from([0xfe, 0xff, 0x61])), ['utf16']);
  assert.deepStrictEqual(wideKinds(Buffer.from([0xff, 0xfe, 0, 0, 0x61])), ['utf32']);
  assert.deepStrictEqual(wideKinds(Buffer.from([0, 0, 0xfe, 0xff, 0x61])), ['utf32']);
  assert.deepStrictEqual(wideKinds(utf32le('x'.repeat(12))), ['utf32']);
});

// A whole blob is decoded from its first byte only, so UTF-32 that a stray byte has shifted off its four-byte grid decodes to nothing useful; the
// NUL-removed reading, run because the rule still reads the blob as wide text, finds that key.
test('a key in UTF-32 shifted off its grid by one stray byte is still refused', () => {
  const r = run(repo([{ 'shift32.txt': Buffer.concat([Buffer.from('x'), utf32le(`a\nb ${KEY} c\n`)]) }]));
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.ok(r.out.includes('tree "shift32.txt":2 aws-access-key-id'), r.out);
});

// A patch held as bytes, cut as git cuts it (at every 0x0A byte), with a UTF-16 key: several readings find the key and it is one hit, at the text's
// line. The same patch held as a string (a caller whose git() returns text) still has its NULs read away, as before. A blob's readings agree too.
test('the scanner reports a UTF-16 key once from a patch held as bytes and once from a blob; a patch held as a string still reads its NULs away', async () => {
  const { scanPatch, scanBytes } = await import(pathToFileURL(LIB).href);
  const wide = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`a\nb ${KEY} c\n`, 'utf16le')]);
  const parts = [];
  let from = 0;
  for (let i = 0; i < wide.length; i++) if (wide[i] === 0x0a) { parts.push(wide.subarray(from, i)); from = i + 1; }
  parts.push(wide.subarray(from));
  const patch = Buffer.concat([Buffer.from(`${String.fromCharCode(0)}COMMIT c1\ndiff --git a/k.txt b/k.txt\n+++ b/k.txt\n@@ -0,0 +1,3 @@\n`),
    ...parts.flatMap((p) => [Buffer.from('+'), p, Buffer.from('\n')])]);
  assert.deepStrictEqual(scanPatch(patch).map((h) => [h.file, h.line, h.pattern]), [['k.txt', 2, 'aws-access-key-id']]);
  assert.strictEqual(scanPatch(patch.toString('utf8')).length, 1, 'a string patch keeps the NUL-removed reading');
  assert.strictEqual(scanBytes(wide, 'k.txt').length, 1, 'a blob read by several readings is one hit');
});

// U3: the NUL-removed reading runs only on bytes the rule reads as wide text. A stray NUL inside a key-shaped token of ordinary text is not read
// away, so it adds no hit to such bytes (the hits a real binary gives stay those of the plain reading).
test('a stray NUL inside a key-shaped token of bytes the rule does not read as wide text gives no hit, in the tree and in the pushed range', () => {
  const dir = repo([{ 'a.txt': 'one\n' }, { 'stray.txt': `id ${KEY.slice(0, 2)}${String.fromCharCode(0)}${KEY.slice(2)}\n` }]);
  const r = run(dir);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const tip = git(dir, 'rev-parse', 'HEAD');
  const p = run(dir, ['--pre-push'], `refs/heads/main ${tip} refs/heads/main ${ZERO}\n`);
  assert.strictEqual(p.code, 0, p.out + p.err);
});

// 15i V2: a whole blob is decoded at every alignment too. One stray UTF-8 byte before UTF-16LE text shifts every unit, and reading the other byte
// order is not the same as shifting back: the shifted ใ (43 0E) glues its low byte onto the unit before it.
test('UTF-16LE text after one stray byte still has its glued key refused in the tree', () => {
  const r = run(repo([{ 'stray16.txt': Buffer.concat([Buffer.from('x'), Buffer.from(`a\nid ${KEY}${TH(0x0e43, 0x0e0a, 0x0e49)}\n`, 'utf16le')]) }]));
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.ok(r.out.includes('tree "stray16.txt":2 aws-access-key-id'), r.out);
});

// 15i V4: the rule reads a file of mostly UTF-32 text as UTF-32 only, so a UTF-16 key in it is never decoded; the NUL-removed reading of the run
// finds it. One pushed commit adds the file and a later one deletes it, so only the pushed range can see it.
test('a UTF-16 key inside a mostly UTF-32 file, added then deleted inside a pushed range, is refused', () => {
  const bytes = Buffer.concat([utf32le(`${'x'.repeat(200)}\n`), Buffer.from(`id ${KEY}\n`, 'utf16le')]);
  const dir = repo([{ 'a.txt': 'one\n' }, { 'mix.txt': bytes }, { 'mix.txt': null }]);
  assert.strictEqual(run(dir).code, 0, 'the tree at HEAD is clean');
  const tip = git(dir, 'rev-parse', 'HEAD');
  const r = run(dir, ['--pre-push'], `refs/heads/main ${tip} refs/heads/main ${ZERO}\n`);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /pushed [0-9a-f]{12} "mix\.txt":\d+ aws-access-key-id/);
});

// A line of 4 KiB, not 64 bytes: the scan costs per line, and 131,000 short lines made each 8 MiB scan in the bound tests take about a second for
// nothing they prove (16j, measured: 949 ms against 178 ms per scan).
const LINE_BYTES = 4096;
// 15i V1: the cost of decoding is bounded. A file of 16-bit samples, which the rule reads as UTF-16 (each sample's high byte is NUL), was decoded
// whole: a 32 MiB one took 8.1 s and 1.19 GB (the reviewer's measure). Past WIDE_DECODE_MAX_BYTES it is not decoded: the scan fails by name with a hit
// of its own whose fingerprint the acks file can carry, and the gate's peak memory grows by a few times the file, never by the dozens decoding costs.
// 16j: the file is 9 MiB, one MiB past the 8 MiB bound, not 32: past the bound its size changes nothing the test proves, and each gate run over it
// costs seconds. The peak assertion below is six times the file (54 MiB): the gate's peak grows by about 27 MiB over a tiny repo with the bound and by about
// 82 MiB without it (measured 2026-11-16 on this file's shape, gate and scanner as shipped against the scanner with the bound disabled; Windows 11, Node 26, n = 1 each). The 54 MiB is a
// midpoint between 27 and 82, not a derived number, and it was measured on Windows only: macOS and Linux account a process's peak differently, so the three-OS CI result of the push is read
// before any room copies this file. The 16j wording of
// this comment, a decode cost of about 240 MiB against a bound of ten times the file (90 MiB), was wrong: 240 MiB was a peak, on a file with short lines, and 82
// MiB sits under 90, so that bound told nothing apart; the exit code and the message below were what caught a scanner without the bound.
const SAMPLES_BYTES = 9 << 20;
test('wide text past the decode bound fails the scan by name, costs a few times its size in memory, and passes once its fingerprint is acknowledged', async () => {
  const dir = repo([{ 'README.md': 'hello\n' }]);
  const peakOut = path.join(SANDBOX, `peak-${made.length}.txt`);
  const measured = () => {
    const r = run(dir, [], '', { NODE_OPTIONS: `--import ${pathToFileURL(PEAK_PRELOAD).href}`, GATE_PEAK_OUT: peakOut }, 180000);
    return { r, peak: Number(fs.readFileSync(peakOut, 'utf8')) };
  };
  const base = measured();
  assert.strictEqual(base.r.code, 0, base.r.out + base.r.err);
  const sha = await new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', dir, 'hash-object', '-w', '--stdin'], { env: gitEnv(), timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`hash-object exit ${code}`))));
    const chunk = Buffer.alloc(1 << 20);
    for (let i = 0; i < chunk.length; i += 2) chunk[i] = i % LINE_BYTES === 0 ? 0x0a : 0x20 + (((i >> 1) * 7) % 0x5f); // printable 16-bit samples, a line every 4 KiB
    let left = SAMPLES_BYTES;
    const pump = () => {
      while (left > 0) { left -= chunk.length; if (!child.stdin.write(chunk)) { child.stdin.once('drain', pump); return; } }
      child.stdin.end();
    };
    pump();
  });
  git(dir, 'update-index', '--add', '--cacheinfo', `100644,${sha},samples.bin`);
  const big = measured();
  assert.strictEqual(big.r.code, 1, big.r.out + big.r.err);
  const m = /tree "samples\.bin":1 wide-text-too-large-to-decode \(fp ([0-9a-f]{16})\)/.exec(big.r.out);
  assert.ok(m, 'the file is named with its fingerprint: ' + big.r.out + big.r.err);
  assert.match(big.r.out, /secret-scan\.acks/, 'the message names the acknowledgement file');
  assert.match(big.r.out, /NOT decoded or scanned\. Check each for keys first: acknowledging its fingerprint in secret-scan\.acks lets those exact bytes pass without the wide-text scan/);
  assert.doesNotMatch(big.r.out, /secret-shaped match/, 'a file too large to decode is not called a match');
  const grew = big.peak - base.peak;
  assert.ok(grew < 6 * SAMPLES_BYTES, `the peak grew by ${(grew / 1048576).toFixed(1)} MiB for a ${SAMPLES_BYTES / 1048576} MiB file`);
  // the pushed range reads the same bytes past the bound (a new file's hunk is its whole content, its missing last line break restored): the same
  // hit, with the same fingerprint, so one acknowledgement covers both
  git(dir, 'commit', '-q', '-m', 'samples');
  const pushedBefore = run(dir, ['--pre-push'], `refs/heads/main ${git(dir, 'rev-parse', 'HEAD')} refs/heads/main ${ZERO}\n`, {}, 180000);
  assert.strictEqual(pushedBefore.code, 1, pushedBefore.out + pushedBefore.err);
  assert.match(pushedBefore.out, new RegExp(`pushed [0-9a-f]{12} "samples\\.bin":1 wide-text-too-large-to-decode \\(fp ${m[1]}\\)`));
  fs.writeFileSync(path.join(dir, 'secret-scan.acks'), `${m[1]}\n`);
  git(dir, 'add', 'secret-scan.acks');
  git(dir, 'commit', '-q', '-m', 'ack');
  const acked = run(dir, [], '', {}, 180000);
  assert.strictEqual(acked.code, 0, acked.out + acked.err);
  const tip = git(dir, 'rev-parse', 'HEAD');
  const pushed = run(dir, ['--pre-push'], `refs/heads/main ${tip} refs/heads/main ${ZERO}\n`, {}, 180000);
  assert.strictEqual(pushed.code, 0, pushed.out + pushed.err);
});

// The bound in the scanner itself: wide text past it gets one hit whose fingerprint follows its exact bytes (an acknowledgement covers those bytes
// only); bytes that are not wide text are never bounded; UTF-32 longer than one chunk of code points decodes whole.
test('the decode bound gives wide text past it one hit that follows its bytes, never bounds other text, and long UTF-32 decodes whole', async () => {
  const { scanBytes, wideTexts, WIDE_DECODE_MAX_BYTES, WIDE_TOO_LARGE } = await import(pathToFileURL(LIB).href);
  const wide = (fill) => { const b = Buffer.alloc(WIDE_DECODE_MAX_BYTES + 2); for (let i = 0; i < b.length; i += 2) b[i] = i % LINE_BYTES === 0 ? 0x0a : fill; return b; };
  const one = scanBytes(wide(0x61), 'w.bin');
  const two = scanBytes(wide(0x62), 'w.bin');
  assert.deepStrictEqual(one.map((h) => [h.line, h.pattern]), [[1, WIDE_TOO_LARGE]]);
  assert.notStrictEqual(one[0].fp, two[0].fp, 'other bytes ask again');
  assert.notStrictEqual(scanBytes(wide(0x61), 'v.bin')[0].fp, one[0].fp, 'the same bytes at another path ask again');
  const plain = Buffer.alloc(WIDE_DECODE_MAX_BYTES + 2, 0x61);
  for (let i = 0; i < plain.length; i += LINE_BYTES) plain[i] = 0x0a;
  Buffer.from('\nid ' + KEY + '\n', 'latin1').copy(plain, plain.length - 40); // t346 F7: a key near the end, so a scan that skips ordinary text past the bound cannot pass as clean
  assert.deepStrictEqual(scanBytes(plain, 'a.txt').map((h) => h.pattern), ['aws-access-key-id'], 'ordinary text past the decode bound is still scanned whole, with no too-large hit');
  assert.strictEqual(wideTexts(utf32le('x'.repeat(200000)))[0], 'x'.repeat(200000));
});

// 16a (15i NIT-2, the c175 item): the bound itself. Wide text of exactly WIDE_DECODE_MAX_BYTES is still decoded and scanned; one byte more is not
// (the bound unit test above). This file is exactly 8 MiB, AT the bound on purpose, the largest one still decoded; the unit test above holds the file that is over it. The key at the end is found, and no too-large hit is given.
test('wide text of exactly the decode bound is still scanned, with no too-large hit', async () => {
  const { scanBytes, WIDE_DECODE_MAX_BYTES } = await import(pathToFileURL(LIB).href);
  const b = Buffer.alloc(WIDE_DECODE_MAX_BYTES);
  for (let i = 0; i < b.length; i += 2) b[i] = i % LINE_BYTES === 0 ? 0x0a : 0x61;
  const key = Buffer.from(`\nid ${KEY}\n`, 'utf16le');
  key.copy(b, b.length - key.length);
  assert.deepStrictEqual(scanBytes(b, 'edge.bin').map((h) => h.pattern), ['aws-access-key-id']);
});

// t342 F5 (2026-11-17): the too-large guidance is chosen by the hit's own pattern, not by searching the text of the formatted line, which carries a file name a stranger chooses. A file NAMED like the
// marker that holds a real key is a secret-shaped match, never "not decoded or scanned" (whose guidance points at acknowledging the fingerprint).
test('a file named like the too-large marker that holds a real key is reported as a match, not as a skipped file -- RED before 2026-11-17', () => {
  const name = 'a wide-text-too-large-to-decode (fp x.txt';
  const r = run(repo([{ [name]: `k ${KEY}\n` }]));
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /FAIL SECRETS: 1 secret-shaped match\(es\)/);
  assert.doesNotMatch(r.out, /NOT decoded or scanned/, 'a real key hit was reported as a skipped file');
  assert.ok(!r.out.includes(KEY), 'the value is never printed');
});

// t342 F9 (2026-11-17): what the stream holds is bounded and a breach is a named FAIL line, never a stack trace. The ceiling is lowered by SECRET_GATE_MAX_HELD_BYTES (it can only be lowered), so no
// multi-gigabyte fixture is needed. A binary-named blob dropped as it streams is released and does not count.
test('the bytes held for staged text are bounded: a text blob past the ceiling is a named FAIL line and the tree is not scanned; a dropped binary blob counts for nothing; the variable can only lower the ceiling -- RED before 2026-11-17', () => {
  const big = 'x'.repeat(300000) + '\n';
  const dir = repo([{ 'dump.sql': big, 'README.md': 'hello\n' }]);
  const lowered = run(dir, [], '', { SECRET_GATE_MAX_HELD_BYTES: '100000' });
  assert.strictEqual(lowered.code, 1, lowered.out + lowered.err);
  assert.match(lowered.out, /FAIL SECRETS: "dump\.sql" is too large to hold: more than 100000 bytes of staged text would be held in memory at once; the tree was NOT scanned\. Keep the file out of the repository, or track it with Git LFS$/m, 'the line names the next step (19b L3)');
  assert.doesNotMatch(lowered.out + lowered.err, /\n\s+at |RangeError|ERR_/, 'no stack trace');
  assert.strictEqual(run(dir).code, 0, 'with no variable the same tree passes');
  assert.strictEqual(run(dir, [], '', { SECRET_GATE_MAX_HELD_BYTES: '999999999999' }).code, 0, 'a higher value is ignored: it cannot weaken the ceiling');
  const binary = repo([{ 'logo.png': Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.alloc(300000, 7)]).toString('latin1'), 'README.md': 'hello\n' }]);
  // 21a: the ceiling is the tree's own text (the gate and the scanner this fixture commits, and README.md) plus the 8,000-byte probe, as in the held-bytes test below,
  // never a fixed number the canon files can outgrow (100000 fell under them at 21a); a binary blob held whole would still cross it by 300 KB
  const textOnly = fs.statSync(GATE).size + fs.statSync(LIB).size + 'hello\n'.length + 8000;
  assert.strictEqual(run(binary, [], '', { SECRET_GATE_MAX_HELD_BYTES: String(textOnly) }).code, 0, 'a binary-named binary blob is dropped as it streams and holds nothing');
});

// t343 F5 (2026-11-18): a binary-looking NAME and a first 8,000 bytes without a NUL pattern read as wide were enough to skip a UTF-16 file whose wide text starts later: one ASCII character, then CJK text with no
// NUL byte, then a key. The same bytes under a text name were scanned. Now a blob dropped by its prefix is still asked, chunk by chunk as it streams, whether any later chunk reads as wide text; if one does it is read
// again and judged on its whole bytes. A real binary (NULs on both parities) is still skipped, however large; one that reads wide but cannot be held is a FAIL line (19a, below).
test('a UTF-16 file under a binary-looking name whose wide text starts after the first 8,000 bytes is scanned like its text-named twin; a real binary is still skipped -- RED before 2026-11-18', () => {
  const body = 'x' + '\u4e4e'.repeat(5000) + '\nid ' + KEY + '\n';
  const wide = Buffer.from(body, 'utf16le');
  const binary = Buffer.concat([Buffer.from([0x89, 0x50, 0x00, 0x00]), Buffer.alloc(20000, 0), Buffer.from(`id ${KEY}\n`, 'latin1'), Buffer.from([0x00, 0x01, 0x00]), Buffer.alloc(20000, 7)]);
  const r = run(repo([{ 'late.bin': wide, 'twin.txt': Buffer.concat([wide, Buffer.from([0x20, 0x00])]), 'real.png': binary }]));
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /tree "late\.bin":2 aws-access-key-id/, 'the binary-named wide file is scanned: ' + r.out);
  assert.match(r.out, /tree "twin\.txt":2 aws-access-key-id/, 'its text-named twin is, as before');
  assert.doesNotMatch(r.out, /real\.png/, 'a real binary with NULs on both parities stays out of the text scan');
  assert.ok(!r.out.includes(KEY) && !r.err.includes(KEY), 'the value is never printed');
});

// t343 F5, the 18a reviewer's surviving mutants (2026-11-18): the first test above fits in ONE chunk, so a gate that never asked the chunks after the drop (nochunk) or never read a flagged blob again
// (noreread) passed it. Two files past 64 KiB, each of which only one path can find: LATE has its only wide-reading bytes after the first chunk, FIRST has them from byte 8,000, inside the first chunk, then
// 80 KB of NUL-free CJK (a first-chunk decision judged on its first 8,000 bytes alone, "prefix", misses it). The 18b bounce replaced the per-chunk check by totals over the whole blob; the tests below it
// (the TAIL and SPLIT witnesses, the oracle, the chunk sizes) pin that. Each file here is named .bin and holds the key on line 2.
test('a binary-named UTF-16 file past 64 KiB is scanned whether its wide-reading bytes sit in a later chunk or in the first chunk past the prefix -- RED against the nochunk, noreread and prefix mutants', () => {
  const utf16 = (s) => Buffer.from(s, 'utf16le');
  const CJK = (n) => '\u4e4e'.repeat(n);
  const late = utf16('x' + CJK(36000) + '\nid ' + KEY + '\n');
  const first = utf16('x' + CJK(3999) + '\nid ' + KEY + '\n' + 'a'.repeat(80) + CJK(40000)); // the ASCII run starts at byte 8000, right after the prefix
  assert.ok(late.length > 65536 && first.length > 65536 + 8000, 'both files are past the first chunk');
  const r = run(repo([{ 'late-chunk.bin': late, 'first-chunk.bin': first }]), [], '', {}, 120000);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /tree "late-chunk\.bin":2 aws-access-key-id/, 'the key in a LATER chunk is found: ' + r.out);
  assert.match(r.out, /tree "first-chunk\.bin":2 aws-access-key-id/, 'the key in the first chunk past the prefix is found: ' + r.out);
  assert.ok(!r.out.includes(KEY) && !r.err.includes(KEY), 'the value is never printed');
});

// 18b (HIGH): the verdict on a binary-named blob must equal judging the WHOLE file, whatever the chunk sizes. The two reviewer witnesses, rebuilt here with this file's KEY, each defeat every per-piece form of the
// check: TAIL has 12 NULs on even positions and 4 on odd ones in its first 8,000 bytes (binary, and not wide on its own: the probe judges exactly those bytes since 19a) and the key line (25 odd NULs) in the first chunk past them, then one weak odd NUL every 6,200 bytes, so no piece reads wide and the whole file
// does; SPLIT has the key line cut across the 128 KiB chunk edge with each half weakened (a few NULs on each side), again wide only in total. The third test is the oracle: blobs around the rule's thresholds,
// the gate's verdict compared with scanning the whole buffer (looksBinary and wideKinds, then scanBytes), so a clever per-piece rule cannot pass by matching two shapes.
const WIT_SIZE = 400000;
const witTail = () => {
  const b = Buffer.alloc(WIT_SIZE, 0x41);
  for (let i = 1; i <= 12; i++) b[i * 100 + (i % 2) * 2] = 0;
  for (const p of [151, 351, 551, 751]) b[p] = 0; // 4 on odd positions: the 8,000-byte prefix reads binary, not wide, so the blob is dropped and judged by its totals
  Buffer.from('\nid ' + KEY + '\n', 'utf16le').copy(b, 8000);
  for (let p = 70000; p + 1 < WIT_SIZE; p += 6200) { b[p] = 0x7a; b[p + 1] = 0; }
  return b;
};
// PREDROP (18c, reshaped in 19a when the probe came to judge exactly the first 8,000 bytes): evidence that sits BEFORE the drop is needed for the verdict. The prefix holds 11 NULs on odd positions (binary, under the
// floor of 12, so dropped); the second 64 KiB piece holds the key line (25 on odd positions) and 8 on even positions beside it (25 is under 4 times 8, so it is not wide on its own). Only the totals read wide
// (36 odd against 8 even), so a gate that counts only after the drop misses it. `secret` stands in for the key in a twin that holds none.
const witPredrop = (secret = KEY) => {
  const b = Buffer.alloc(WIT_SIZE, 0x41);
  for (let k = 0; k < 11; k++) b[1001 + k * 600] = 0; // 11 NULs on odd positions, all at offset 1 mod 4, inside the prefix
  Buffer.from('\nid ' + secret + '\n', 'utf16le').copy(b, 70000); // 25 on odd positions, split between offsets 1 and 3 mod 4
  for (let k = 0; k < 8; k++) b[72000 + k * 202] = 0; // 8 on even positions, split between offsets 0 and 2 mod 4, so no UTF-32 reading either
  return b;
};
const witSplit = () => {
  const b = Buffer.alloc(WIT_SIZE, 0x41);
  b[100] = 0;
  for (const p of [130800, 130804, 130810, 130814, 131300, 131304, 131310, 131314]) b[p] = 0;
  Buffer.from('\nid ' + KEY + '\n', 'utf16le').copy(b, 131048);
  for (let p = 196608; p + 1 < 393216; p += 6000) { b[p] = 0x7a; b[p + 1] = 0; }
  return b;
};
test('a binary-named blob whose wide-text evidence is split across pieces, each piece reading as binary, is judged on the whole file: the reviewer\'s TAIL and SPLIT witnesses are found -- RED before 18b', async () => {
  const { wideKinds, looksBinary } = await import(pathToFileURL(LIB).href);
  for (const [name, blob] of [['tail.bin', witTail()], ['split.bin', witSplit()], ['predrop.bin', witPredrop()]]) {
    assert.ok(looksBinary(blob) && wideKinds(blob).length > 0, name + ': the whole file reads as wide text (the premise)');
    for (let off = 0; off < blob.length; off += 65536) assert.strictEqual(wideKinds(blob.subarray(off, off + 65536)).length, 0, name + ': no 64 KiB piece reads wide on its own');
    const r = run(repo([{ [name]: blob }]), [], '', {}, 120000);
    assert.strictEqual(r.code, 1, name + ': ' + r.out + r.err);
    assert.ok(r.out.includes('tree "' + name + '":2 aws-access-key-id'), name + ' is scanned: ' + r.out);
    assert.ok(!r.out.includes(KEY) && !r.err.includes(KEY), 'the value is never printed');
  }
});

test('the gate\'s verdict on a binary-named blob equals the whole-buffer verdict across the wide-text rule\'s thresholds and chunk edges (the oracle) -- RED before 18b', async () => {
  const { wideKinds, looksBinary, scanBytes, spelledHits } = await import(pathToFileURL(LIB).href);
  const make = (opposing, keyAt, later, secret = KEY) => {
    const b = Buffer.alloc(300000, 0x41);
    b[3] = 0; // one NUL in the prefix: git's rule calls the blob binary
    for (let i = 0; i < opposing; i++) b[200 + i * 100 + (i % 2) * 2] = 0; // even positions, split between offsets 0 and 2 mod 4
    Buffer.from('\nid ' + secret + '\n', 'utf16le').copy(b, keyAt);
    for (let k = 0; k < later; k++) { const p = 70000 + k * 6200; b[p] = 0x7a; b[p + 1] = 0; }
    return b;
  };
  const files = {};
  for (const opposing of [0, 7, 11, 12]) for (const keyAt of [8000, 131048]) for (const later of [0, 37]) files[`b-${opposing}-${keyAt}-${later}.bin`] = make(opposing, keyAt, later);
  // 20f: a binary-named blob that is binary and not wide text is still searched for keys in their wide spellings, so every keyed blob above is found; keyless
  // twins (the same bytes with a non-key in the key's place) keep the grid's other outcome
  for (const opposing of [0, 7, 11, 12]) for (const keyAt of [8000, 131048]) files[`n-${opposing}-${keyAt}.bin`] = make(opposing, keyAt, 0, 'x'.repeat(KEY.length));
  const verdict = (b) => (looksBinary(b) && !wideKinds(b).length ? spelledHits(b, 'x').length > 0 : scanBytes(b, 'x').length > 0);
  const names = Object.keys(files);
  const outs = {};
  for (let i = 0; i < names.length; i += 4) { // four blobs a run: the gate lists at most five matches
    const group = names.slice(i, i + 4);
    const out = run(repo([Object.fromEntries(group.map((n) => [n, files[n]]))]), [], '', {}, 240000).out;
    for (const n of group) outs[n] = out;
  }
  let flagged = 0;
  for (const [name, b] of Object.entries(files)) {
    const found = outs[name].includes('tree "' + name + '":');
    assert.strictEqual(found, verdict(b), name + ': the gate says ' + (found ? 'found' : 'skipped') + ', the whole-buffer verdict says ' + (verdict(b) ? 'found' : 'skipped'));
    if (verdict(b)) flagged++;
  }
  assert.ok(flagged > 0 && flagged < Object.keys(files).length, 'the grid has both outcomes, so the comparison tests something: ' + flagged);
});

// 18b: the verdict must not depend on the size of the pieces the stream arrives in. The same two witnesses, with the cat-file answer handed over in pieces of 1,001 and 4,093 bytes (neither a multiple of
// four, so a piece starts at a different position mod 4 each time): a gate that counted NULs by position inside each piece instead of by absolute offset would split the evidence between the two parities and miss it.
test('the two witnesses are found whatever size the cat-file pieces arrive in (absolute offsets, not per-piece positions) -- RED against a per-piece position count', () => {
  for (const chunk of [1001, 4093]) {
    for (const [name, blob] of [['tail.bin', witTail()], ['split.bin', witSplit()], ['predrop.bin', witPredrop()]]) {
      const r = run(repo([{ [name]: blob }]), [], '', { NODE_OPTIONS: `--import ${pathToFileURL(FAKE_PRELOAD).href}`, FAKE_CATFILE_MODE: 'rechunk', FAKE_CHUNK: String(chunk) }, 180000);
      assert.strictEqual(r.code, 1, `${name} in pieces of ${chunk}: ${r.out}${r.err}`);
      assert.ok(r.out.includes('tree "' + name + '":2 aws-access-key-id'), `${name} in pieces of ${chunk}: ${r.out}`);
    }
  }
});

// 18c (LOW): how many blobs are read AGAIN is pinned, so a rule that flags too much (a skew of 1) costs a test and not just time. Each gate run's cat-file children are counted through the fake's log: a tree of a
// real binary (NULs on both parities) is read once; a tree holding the wide-in-sum witness is read twice (the stream, then that one blob again).
test('a real binary is never read twice and a blob wide only in sum is read exactly twice (the re-read count) -- RED against a rule that flags too much', () => {
  const countReads = (files) => {
    const log = path.join(SANDBOX, 'spawn-' + Math.random().toString(36).slice(2) + '.log');
    const r = run(repo([files]), [], '', { NODE_OPTIONS: `--import ${pathToFileURL(FAKE_PRELOAD).href}`, FAKE_CATFILE_MODE: 'plain', FAKE_SPAWN_LOG: log }, 120000);
    const n = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0;
    return { r, n };
  };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x00, 0x00]), Buffer.alloc(30000, 0), Buffer.from('id ' + KEY + '\n', 'latin1'), Buffer.from([0x00, 0x01, 0x00]), Buffer.alloc(30000, 7), Buffer.from([0, 3, 0, 5, 0, 0, 0, 9])]);
  const plain = countReads({ 'real.png': png });
  assert.strictEqual(plain.r.code, 0, plain.r.out + plain.r.err);
  assert.strictEqual(plain.n, 1, 'a real binary is read once');
  const few = Buffer.alloc(20000, 0x41);
  few[3] = 0; few[10] = 0; few[20] = 0; few[30] = 0; few[40] = 0; // five NULs, all on even positions: binary by git's rule, far under the wide-text floor of 12
  const fewReads = countReads({ 'few.bin': few });
  assert.strictEqual(fewReads.r.code, 0, fewReads.r.out + fewReads.r.err);
  assert.strictEqual(fewReads.n, 1, 'five NULs on one parity are not wide text: read once (a floor of 1 would read it again)');
  const wide = countReads({ 'predrop.bin': witPredrop() });
  assert.strictEqual(wide.r.code, 1, wide.r.out + wide.r.err);
  assert.strictEqual(wide.n, 2, 'a blob wide only in sum is read twice');
});

// t340 (CodeRabbit, on CoalWash's copy): the NUL-removed reading de-duplicated each hit by scanning every hit before it, so one line of many distinct key-shaped tokens with NULs between their characters cost
// the square of their count (20,000 tokens: 11.8 s on one machine; 40,000: 41.6 s). With a Set it is linear. NO CLOCK decides it (t342 F6, then t344 F2, 2026-11-18: a kill-timeout passed a quadratic scan on a
// machine 1.4 times faster than the one that measured it): the child counts the ELEMENTS VISITED by Array's searching methods (some, find, findIndex, includes, indexOf, filter, every and their kin) while it scans,
// and the visits must stay under 20 per token. A Set costs none (0 at 4,000 tokens); the quadratic de-duplication costs n(n-1)/2 (7,998,000 at 4,000), 100 times the bound, on any machine. The timeout stays only as
// the process-safety limit. The count sees searches through those methods, not a hand-written loop: a quadratic written as a loop would pass this test and is the limit of it.
test('one line of 4,000 distinct key-shaped tokens with NULs between their characters is read in linear WORK, every token once (counted visits, no clock) -- RED against the quadratic de-duplication', async () => {
  const { scanText } = await import(pathToFileURL(LIB).href);
  const N = 4000;
  const code = [
    "let visited = 0;",
    "for (const m of ['some', 'find', 'findIndex', 'findLast', 'findLastIndex', 'includes', 'indexOf', 'lastIndexOf', 'filter', 'every']) { const orig = Array.prototype[m]; Array.prototype[m] = function (...a) { visited += this.length; return orig.apply(this, a); }; }",
    "const { scanText } = await import(" + JSON.stringify(pathToFileURL(LIB).href) + ");",
    "const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';",
    "const tok = (i) => { let s = ''; for (let k = 0; k < 16; k++) { s += A[i % 32]; i = Math.floor(i / 32); } return 'AKIA' + s; };",
    "const line = Array.from({ length: " + N + " }, (_, i) => tok(i)).join(' ').split('').join(String.fromCharCode(0));",
    "visited = 0;",
    "const hits = scanText(line, 'f.txt');",
    "console.log(JSON.stringify({ n: hits.length, distinct: new Set(hits.map((h) => h.fp)).size, visited }));",
  ].join('\n');
  const r = spawnSync(process.execPath, ['--max-old-space-size=256', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 60000, env: { PATH: process.env.PATH } });
  assert.strictEqual(r.signal, null, 'the child was killed by the safety timeout: ' + (r.error ? r.error.code : r.signal));
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.n, N);
  assert.strictEqual(out.distinct, N);
  assert.ok(out.visited < 20 * N, 'the scan of ' + N + ' tokens visited ' + out.visited + ' array elements while searching (bound ' + 20 * N + '): it is no longer linear');
  const spaced = (s) => s.split('').join(String.fromCharCode(0));
  assert.strictEqual(scanText(`${spaced(KEY)} ${spaced(KEY)}`, 'f.txt').length, 1, 'the same token twice on one line is one hit');
});

// 19a (CodeRabbit E1 t345 #5, #6, #7, #10 and t346 F8, F18, F19): what the held-bytes ceiling lets through. A binary-named blob whose NUL totals read as wide text is text by the gate's own rule, so one
// that cannot be held (alone past the ceiling, or past what the first read and earlier re-reads already hold) fails by name, as a text-named blob past the ceiling does; it is never dropped as binary
// unscanned. A failed re-read leaves no half-read map behind: the tree is reported NOT scanned and nothing of it is. A probed blob is charged only its 8,000-byte prefix before the probe decides, so
// its verdict does not depend on how large the first piece of the stream was.
const witPlain = () => witPredrop('q'.repeat(KEY.length));
test('a binary-named blob that reads as wide text but is larger than the held-bytes ceiling fails by name, never passes unscanned; a real binary of the same size still passes -- RED before 19a (t346 F18, t345 #6)', () => {
  const realBin = Buffer.alloc(WIT_SIZE, 0); // NULs on every position: binary, never wide
  realBin[1] = 7;
  const r = run(repo([{ 'predrop.bin': witPredrop(), 'real.png': realBin }]), [], '', { SECRET_GATE_MAX_HELD_BYTES: '300000' }, 120000);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /FAIL SECRETS: "predrop\.bin" reads as UTF-16 or UTF-32 text by its NUL counts, but holding its 400000 bytes would put more than 300000 bytes of staged text in memory at once, so it was NOT scanned; keep the file out of the repository, or track it with Git LFS$/m, 'the line names the next step (19b L3)');
  assert.doesNotMatch(r.out, /real\.png/, 'a real binary is still skipped');
  assert.doesNotMatch(r.out, /reached the scan as something other than its bytes/, 'the blob that cannot be held is set aside before the scan loop, never handed to it (19b)');
  assert.ok(!r.out.includes(KEY) && !r.err.includes(KEY), 'the value is never printed');
  const binOnly = run(repo([{ 'real.png': realBin }]), [], '', { SECRET_GATE_MAX_HELD_BYTES: '300000' }, 120000);
  assert.strictEqual(binOnly.code, 0, 'a real binary past the ceiling holds nothing and passes: ' + binOnly.out + binOnly.err);
});

test('the held-bytes ceiling bounds the first read and every re-read together: a wide blob that fits alone but not beside the text already held fails by name -- RED before 19a (t346 F19, t345 #5)', () => {
  const text = ('x'.repeat(99) + '\n').repeat(2000); // 200,000 bytes of ordinary text, held by the first read
  const dir = repo([{ 'data.txt': text, 'wide.bin': witPlain() }]);
  const tight = run(dir, [], '', { SECRET_GATE_MAX_HELD_BYTES: '500000' }, 120000);
  assert.strictEqual(tight.code, 1, tight.out + tight.err);
  assert.match(tight.out, /FAIL SECRETS: "wide\.bin" reads as UTF-16 or UTF-32 text by its NUL counts, but holding its 400000 bytes would put more than 500000 bytes of staged text in memory at once/);
  // 19b (L6 and the boundary): the ceilings below are derived from the fixture's own text (the gate and its scanner are tracked in it, beside data.txt), so a file that grows moves them;
  // `exact` is the first read's text plus the one wide blob, the budget to the byte: it passes, and one byte less fails (a `>=` for `>` on the budget is caught).
  const exact = fs.statSync(GATE).size + fs.statSync(LIB).size + text.length + WIT_SIZE;
  const roomy = run(dir, [], '', { SECRET_GATE_MAX_HELD_BYTES: String(exact) }, 120000);
  assert.strictEqual(roomy.code, 0, 'both fit together at exactly the budget: ' + roomy.out + roomy.err);
  const under = run(dir, [], '', { SECRET_GATE_MAX_HELD_BYTES: String(exact - 1) }, 120000);
  assert.strictEqual(under.code, 1, 'one byte under the budget fails: ' + under.out + under.err);
  assert.match(under.out, /FAIL SECRETS: "wide\.bin" reads as UTF-16 or UTF-32 text by its NUL counts/);
  const two = run(repo([{ 'data.txt': text, 'wide.bin': witPlain(), 'wide2.bin': witPredrop('r'.repeat(KEY.length)) }]), [], '', { SECRET_GATE_MAX_HELD_BYTES: String(exact) }, 120000);
  assert.strictEqual(two.code, 1, 'two wide blobs that each fit beside the text but not together: ' + two.out + two.err);
  assert.match(two.out, /FAIL SECRETS: "wide2?\.bin" reads as UTF-16 or UTF-32 text by its NUL counts/, 'an earlier re-read counts against the ceiling too');
  const keyed = run(repo([{ 'data.txt': text, 'wide.bin': witPredrop() }]), [], '', { SECRET_GATE_MAX_HELD_BYTES: String(exact) }, 120000);
  assert.ok(keyed.out.includes('tree "wide.bin":2 aws-access-key-id'), 'the wide blob is scanned when it fits: ' + keyed.out);
});

test('a re-read that fails leaves nothing half read: the tree is reported NOT scanned and no file of it is reported as scanned or matched -- RED before 19a (t345 #10)', () => {
  const log = path.join(SANDBOX, 'spawn-' + Math.random().toString(36).slice(2) + '.log');
  const r = run(repo([{ 'wide.bin': witPlain(), 'other.txt': 'id ' + KEY + '\n' }]), [], '', { NODE_OPTIONS: `--import ${pathToFileURL(FAKE_PRELOAD).href}`, FAKE_CATFILE_MODE: 'second-exit1', FAKE_SPAWN_LOG: log }, 120000);
  assert.strictEqual(r.code, 1, r.out + r.err);
  // 20a (t352): the line names the file whose re-read failed; the gate still refuses the whole tree (exit 1, nothing reported as scanned), as it did before
  assert.match(r.out, /FAIL SECRETS: git could not re-read "wide\.bin" \(exit 1\); the tree was NOT scanned/);
  assert.doesNotMatch(r.out, /tree "/, 'no file of a tree reported NOT scanned is reported as scanned or matched: ' + r.out);
  assert.doesNotMatch(r.out + r.err, /\n\s+at |TypeError/, 'no stack trace');
  assert.strictEqual(fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length, 2, 'the stream ran, then the one re-read that failed');
});

test('a probed blob is charged only its 8,000-byte prefix before the probe decides: a real binary under a lowered ceiling passes whatever size its first piece arrives in -- RED before 19a (t346 F8, t345 #7)', () => {
  const realBin = Buffer.alloc(100000, 0);
  realBin[1] = 7;
  const dir = repo([{ 'zz.png': realBin, 'README.md': 'hello\n' }]);
  // zz.png sorts after the scripts, so it streams after the fixture's own text is held (cat-file answers in path order). The ceiling leaves room for that text (the gate and its scanner are tracked in it) plus EXACTLY the 8,000-byte prefix (19b L1: with any more slack, a limit that forgot the bytes the blob already holds passed), and not for a 32 KiB first piece
  const PROBE_BYTES = 8000; // the gate's own constant: the scanner's looksBinary reads this many first bytes
  const ceiling = fs.statSync(GATE).size + fs.statSync(LIB).size + 'hello\n'.length + PROBE_BYTES;
  assert.strictEqual(run(dir, [], '', { SECRET_GATE_MAX_HELD_BYTES: String(ceiling) }, 120000).code, 0, 'pieces as git hands them');
  for (const chunk of [1001, 32768]) {
    const r = run(dir, [], '', { NODE_OPTIONS: `--import ${pathToFileURL(FAKE_PRELOAD).href}`, FAKE_CATFILE_MODE: 'rechunk', FAKE_CHUNK: String(chunk), SECRET_GATE_MAX_HELD_BYTES: String(ceiling) }, 120000);
    assert.strictEqual(r.code, 0, 'pieces of ' + chunk + ': ' + r.out + r.err);
  }
});

// 19b (L2): the scan loop treats only a Buffer as bytes. Before, a value that was neither null nor the binary marker was scanned as the text "[object Object]" and counted as a clean file;
// the F18 branch's own marker replacement was the only wall. A preload stands in for a future path that stores some other value: Map.prototype.get hands back an object in place of the one
// blob whose size is FAKE_NONBUFFER_SIZE.
const NONBUFFER_PRELOAD = path.join(SANDBOX, 'nonbuffer.preload.mjs');
fs.writeFileSync(NONBUFFER_PRELOAD, [
  'const n = Number(process.env.FAKE_NONBUFFER_SIZE);',
  'const get = Map.prototype.get;',
  'Map.prototype.get = function (k) { const v = get.call(this, k); return Buffer.isBuffer(v) && v.length === n ? { notBytes: true } : v; };',
].join('\n'));
test('a staged entry whose value reaches the scan as anything but its bytes fails by name and is never counted as scanned -- RED before 19b (L2)', () => {
  const odd = 'x'.repeat(776) + '\n'; // 777 bytes, a size no other file in the fixture has
  const r = run(repo([{ 'odd.txt': odd, 'README.md': 'hello\n' }]), [], '', { NODE_OPTIONS: `--import ${pathToFileURL(NONBUFFER_PRELOAD).href}`, FAKE_NONBUFFER_SIZE: String(odd.length) });
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /FAIL SECRETS: "odd\.txt" reached the scan as something other than its bytes \(an internal error\); it was NOT scanned/);
  assert.doesNotMatch(r.out, /PASS SECRETS/);
});

// 20a (t352, the CoalWash reviewer's witness): the raw reading and a decoded reading can find one key a different number of times. In UTF-16LE text that opens with U+4161, the raw
// reading with its NULs removed glues "aA" to the first token, which then fails its boundary: the raw reading finds only the SECOND occurrence, on line 2, and the decoded reading finds
// both. Matching by ordinal gave that one raw hit the decoded FIRST occurrence's line, 1. A raw hit now takes a decoded line only when both readings found the key equally often.
test('a raw hit keeps its own line when the decoded reading found the key a different number of times; equal counts still take the decoded lines -- RED before 20a (t352)', async () => {
  const { scanBytes } = await import(pathToFileURL(LIB).href);
  const T = 'gh' + 'p_' + 'A'.repeat(36);
  const uneven = scanBytes(Buffer.from(String.fromCharCode(0x4161) + T + '\n' + T, 'utf16le'), 'w.txt');
  assert.deepStrictEqual(uneven.map((h) => [h.line, h.pattern]), [[2, 'github-token']], 'the one raw hit is the second occurrence, on line 2');
  // the equal-count control: U+0A41 is the bytes 41 0A, a line break to the raw reading only; both readings find the key once, so the raw hit (line 2) takes the decoded line, 1
  const even = scanBytes(Buffer.from(String.fromCharCode(0x0A41) + T, 'utf16le'), 'w.txt');
  assert.deepStrictEqual(even.map((h) => [h.line, h.pattern]), [[1, 'github-token']], 'equal counts still take the decoded line');
});

// 20b (the da5b7e9 review's M1): the equal-count rule of 20a kept a RAW line wherever the counts differed, and the raw reading counts a 0x0A byte inside a wide character as a line break,
// so a key after such a character was named one line too low. A reported line is now the line in the DECODED text where that occurrence's bytes sit, by position: every decoded newline
// holds a 0x0A byte the raw reading also breaks on, so each raw line lies inside one decoded line, and the merge maps a raw hit's line to it. The reviewer's two cases (U+0A41, the bytes
// 41 0A, on line 1), the t352 case and the equal-count control above stay green. A FAKE token, built in code.
test('a reported line is the decoded line where the occurrence sits, whatever the two readings count -- the da5b7e9 review\'s two cases, RED before 20b', async () => {
  const { scanBytes } = await import(pathToFileURL(LIB).href);
  const TOK = 'g' + 'hp_' + 'Zx9Q'.repeat(9);
  const BOM = Buffer.from([0xff, 0xfe]);
  const w = (s) => Buffer.from(s, 'utf16le');
  const fakeFromBytes = Buffer.from(TOK, 'latin1'); // the raw reading reads these bytes as the token; the decoded reading reads CJK, on line 4
  const NL = String.fromCharCode(0x0a41);
  const lines = (b) => scanBytes(b, 'f.txt').map((h) => [h.line, h.pattern]);
  // raw 2, wide 1: the real token on decoded line 2, the token-shaped bytes on decoded line 4 (raw lines 3 and 5)
  assert.deepStrictEqual(lines(Buffer.concat([BOM, w('x' + NL + 'y\nreal ' + TOK + '\nmid\n '), fakeFromBytes, w('\nend\n')])), [[2, 'github-token'], [4, 'github-token']]);
  // raw 1, wide 2: the raw reading finds the first occurrence (decoded line 2, raw line 3); the second is glued in the raw reading
  assert.deepStrictEqual(lines(Buffer.concat([BOM, w('x' + NL + 'y\nreal ' + TOK + '\nmid\n' + String.fromCharCode(0x4e2d) + TOK + '\nend\n')])), [[2, 'github-token']]);
  // a 0x0A byte that is the LOW byte of a unit that is not a newline (U+410A, the bytes 0A 41) breaks only the raw line: the key stays on decoded line 2
  assert.deepStrictEqual(lines(Buffer.concat([BOM, w('x' + String.fromCharCode(0x410a) + 'y\nreal ' + TOK + '\n')])), [[2, 'github-token']]);
  // a 0A 00 pair that straddles two units (U+0A41 then U+4100, the bytes 41 0A 00 41) is no decoded newline: only an aligned unit counts
  assert.deepStrictEqual(lines(Buffer.concat([BOM, w('x' + String.fromCharCode(0x0a41, 0x4100) + 'y\nreal ' + TOK + '\n')])), [[2, 'github-token']]);
  // 20c (the re-check's N1): a key no decoded reading holds (token-shaped bytes that decode as CJK) is mapped through the reading that fits the file: its byte-order mark's, so a
  // UTF-16BE file names line 3 where the bytes sit (A7; reading 0, little-endian, saw no newline and named line 1); the same shape in UTF-16LE stays on line 3 (A6)
  assert.deepStrictEqual(lines(Buffer.concat([BOM, w('x' + NL + 'y\nm\n '), fakeFromBytes, w('\nend')])), [[3, 'github-token']], 'A6, little-endian');
  assert.deepStrictEqual(lines(Buffer.concat([Buffer.from([0xfe, 0xff]), w('x' + String.fromCharCode(0x410a) + 'y\nm\n ').swap16(), fakeFromBytes, w('\nend').swap16()])), [[3, 'github-token']], 'A7, big-endian');
  // with no byte-order mark, the reading that decodes the most newlines: the same big-endian bytes without their mark still name line 3
  // the mark wins over a newline count: in this big-endian file four U+0A00 (the bytes 0A 00) would be newlines to a little-endian reading, which would then decode the most
  assert.deepStrictEqual(lines(Buffer.concat([Buffer.from([0xfe, 0xff]), w('x' + String.fromCharCode(0x0a00).repeat(4) + 'y\nm\n ').swap16(), fakeFromBytes, w('\nend').swap16()])), [[3, 'github-token']], 'the mark decides');
  // (sixteen more letters on line 2, so the rule reads it as wide text by its NULs alone; the readings at offset 1 would count the 0x0A inside U+410A as a newline)
  assert.deepStrictEqual(lines(Buffer.concat([w('x' + String.fromCharCode(0x410a) + 'y\n' + 'm'.repeat(17) + '\n ').swap16(), fakeFromBytes, w('\nend').swap16()])), [[3, 'github-token']], 'A7 without a mark');
  // 20d (CodeRabbit on Kolwen PR 197, thread 4642988514): a key held by a reading that does NOT fit the file (little-endian bytes appended to a big-endian file, which the
  // little-endian reading, first in order, decodes) took that reading's line map, which counts none of the file's newlines: both occurrences were named line 1. Every raw hit is now
  // mapped through the byte-order mark's reading whenever the file has one. UTF-16BE and UTF-32BE with a mark; the little-endian mirrors were already right, because a
  // little-endian reading comes first. A file with NO mark keeps its key's first reading (the UTF-32 file shifted off its grid needs it), a named gap for mixed byte orders.
  const T2 = 'gh' + 'p_' + 'A'.repeat(36);
  const u32 = (s, little) => { const cps = [...s].map((c) => c.codePointAt(0)); const b = Buffer.alloc(cps.length * 4); cps.forEach((cp, k) => (little ? b.writeUInt32LE(cp, k * 4) : b.writeUInt32BE(cp, k * 4))); return b; };
  const MARK = String.fromCharCode(0xfeff);
  assert.deepStrictEqual(lines(Buffer.concat([Buffer.from([0xfe, 0xff]), w('\n ' + T2 + '\n ').swap16(), w(T2)])), [[2, 'github-token'], [3, 'github-token']], 'UTF-16BE with little-endian bytes appended');
  assert.deepStrictEqual(lines(Buffer.concat([u32(MARK + '\n ' + T2 + '\n ', false), u32(T2, true)])), [[2, 'github-token'], [3, 'github-token']], 'UTF-32BE with little-endian bytes appended');
  assert.deepStrictEqual(lines(Buffer.concat([BOM, w('\n ' + T2 + '\n '), w(T2).swap16()])), [[2, 'github-token'], [3, 'github-token']], 'the UTF-16LE mirror');
  assert.deepStrictEqual(lines(Buffer.concat([u32(MARK + '\n ' + T2 + '\n ', true), u32(T2, false)])), [[2, 'github-token'], [3, 'github-token']], 'the UTF-32LE mirror');
  // 20e (the 6ea2246 review's L1): the mark wins only where it fits at least as well as the key's own reading, by the newlines each decodes. A big-endian mark over a
  // little-endian body (V5), and a true mark followed by one stray byte (V9, the body at an odd offset), decode fewer newlines than the key's reading: its line stands.
  assert.deepStrictEqual(lines(Buffer.concat([Buffer.from([0xfe, 0xff]), w('top\nmid\n ' + T2 + '\nend\n')])), [[3, 'github-token']], 'V5, a mark that lies about the body');
  assert.deepStrictEqual(lines(Buffer.concat([BOM, Buffer.from([0x20]), w('top\n ' + T2 + '\nmid\n ' + T2 + '\n')])), [[2, 'github-token'], [4, 'github-token']], 'V9, a stray byte after a true mark');
  // big-endian: a decoded newline is the bytes 00 0A, its 0x0A byte LAST; U+0A41 is 0A 41 there, a raw break only
  assert.deepStrictEqual(lines(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('x' + NL + 'y\nreal ' + TOK + '\nmid\n', 'utf16le').swap16()])), [[2, 'github-token']]);
});

// 20e (the 6ea2246 review's M1, older than 6ea2246): a file with no byte-order mark whose big-endian part and appended little-endian part are near equal in size puts as many
// NULs on even positions as on odd ones, so the skew test read it as no wide text at all, the scanner read it as UTF-8 with its NULs left in, and it reported NOTHING: the gate passed
// a file that holds the key twice. 20f (the 7edf02c review's H1): such a file is NOT guessed to be wide text (a guess from NUL runs read fonts and PE files as text); its raw bytes
// are searched for the provider keys in their four wide spellings, and only the provider patterns run on what is found. Controls: random bytes, a run of zeros, a UTF-8 file with
// NULs on both parities, and the shapes that fooled 7edf02c, stay plain.
test('a key in a wide spelling is reported in a file with no mark whose NULs do not skew (both byte orders balanced, or one order beside other NULs), and the gate refuses it -- RED before 20e', async () => {
  const { scanBytes, wideKinds } = await import(pathToFileURL(LIB).href);
  const T = 'gh' + 'p_' + 'A'.repeat(36);
  const le16 = (s) => Buffer.from(s, 'utf16le');
  const be16 = (s) => Buffer.from(s, 'utf16le').swap16();
  const u32 = (s, little) => { const cps = [...s].map((c) => c.codePointAt(0)); const b = Buffer.alloc(cps.length * 4); cps.forEach((cp, k) => (little ? b.writeUInt32LE(cp, k * 4) : b.writeUInt32BE(cp, k * 4))); return b; };
  const lines = (b) => scanBytes(b, 'f.txt').map((h) => [h.line, h.pattern]);
  const mixed16 = Buffer.concat([be16('\n ' + T + '\n '), le16(T)]);
  assert.deepStrictEqual(lines(mixed16), [[2, 'github-token'], [3, 'github-token']], 'UTF-16, balanced orders: both keys, each on the raw line where it sits');
  const mixed32 = Buffer.concat([u32('\n ' + T + '\n ', false), u32(T, true)]);
  assert.deepStrictEqual(lines(mixed32), [[2, 'github-token'], [3, 'github-token']], 'UTF-32, balanced orders: both keys');
  // the reviewer's M-a (the 7edf02c review's M2): the big-endian part holds only short ASCII runs (a CJK character every 8 units), the key sits in the little-endian part
  const shortWords = (n) => Array.from({ length: n }, (_, i) => 'word' + (i % 10) + 'ab' + String.fromCharCode(0x4e2d)).join('');
  const ma = Buffer.concat([be16(shortWords(60) + '\n'), le16('\n ' + T + '\n' + 'pad '.repeat(40))]);
  assert.deepStrictEqual(wideKinds(ma), [], 'M-a: the skew test does not read it');
  assert.deepStrictEqual(lines(ma), [[3, 'github-token']], 'M-a: the key is reported');
  const N = String.fromCharCode(0);
  // one order beside other NULs: 20 even NULs (10 at offset 0 mod 4, 10 at 2) against the key's 40 odd ones, under 4 to 1, and no three of four positions full
  const oneOrder = Buffer.concat([Buffer.from((N + 'abcde' + N + 'f').repeat(10), 'latin1'), le16(T)]);
  assert.deepStrictEqual(wideKinds(oneOrder), [], 'one order whose NULs do not skew: not read as wide text');
  assert.deepStrictEqual(lines(oneOrder), [[1, 'github-token']], 'one order whose NULs do not skew: the key is reported');
  // a key glued to a word in its own spelling is not a key, here as anywhere
  // the search runs in 1 MiB windows that overlap: a key across a window edge is found once, at its line
  const { spelledHits } = await import(pathToFileURL(LIB).href);
  for (const shift of [-80, -2, 0, 2]) {
    const head = Buffer.alloc((1 << 20) + shift, 0x41);
    for (let q = 0; q < head.length; q += 2) head[q] = 0;
    assert.deepStrictEqual(spelledHits(Buffer.concat([head, le16(' ' + T + '\n')]), 'f').map((h) => [h.line, h.pattern]), [[1, 'github-token']], 'window edge, shift ' + shift);
  }
  const glued = Buffer.concat([be16('\n ' + 'pad '.repeat(10)), le16('x' + T)]); // balanced, so not read as wide text: the spelled search alone judges it
  assert.deepStrictEqual([wideKinds(glued), lines(glued)], [[], []], 'a glued key in a wide spelling is refused like a glued plain one');
  // the gate refuses the balanced file
  const r = run(repo([{ 'mixed.txt': mixed16 }]));
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.ok(r.out.includes('tree "mixed.txt"') && r.out.includes('github-token'), r.out);
  // a binary-named file whose first 8,000 bytes read as binary and not wide, with the balanced text after them: the gate drops it by its prefix and
  // judges it by the stream's counters, so those counters carry the spelled search too (RED against a gate that kept only the NUL totals)
  const head = Buffer.alloc(9000, 0x41);
  for (let q = 100; q < 9000; q += 101) head[q] = 0; // NULs on both parities: binary by the prefix, not wide
  const big = Buffer.concat([head, mixed16]);
  assert.deepStrictEqual(wideKinds(head), [], 'the prefix alone is not wide text');
  const rb = run(repo([{ 'mixed.bin': big }]));
  assert.strictEqual(rb.code, 1, rb.out + rb.err);
  assert.ok(rb.out.includes('tree "mixed.bin"') && rb.out.includes('github-token'), rb.out);
  // controls
  let seed = 7;
  const rnd = (n) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) >>> 0; b[i] = seed >>> 24; } return b; };
  const noise = rnd(200000);
  assert.deepStrictEqual([wideKinds(noise), scanBytes(noise, 'f.bin').length], [[], 0], 'pseudo-random bytes: plain, no hit');
  assert.deepStrictEqual(wideKinds(Buffer.concat([Buffer.alloc(100000, 0), Buffer.from('id ' + T + '\n')])), [], 'a run of zeros is not wide text');
  // 17-byte lines put the NULs on both parities, so the skew test is silent
  const utf8 = Buffer.from(('plain text line' + N + '\n').repeat(40), 'utf8');
  assert.deepStrictEqual([wideKinds(utf8), scanBytes(utf8, 'f.txt').length], [[], 0], 'UTF-8 with a few NULs: plain, no hit');
});

// 20f (the 7edf02c review's H1): the shapes that made 7edf02c read real binaries as wide text, built in code (the suite runs on three systems and reads no system file).
// PE-LIKE stands for kernel32.dll and shell32.dll: UTF-16LE resource strings (words with no key) beside a table of small big-endian 16-bit values, both in runs of far
// more than 12 units, in random bytes. FONT-LIKE stands for msyh.ttc: big-endian name and metric tables of small values and little-endian runs, past the 8 MiB decode
// bound. 7edf02c read both as UTF-16 and drew a "wide text too large" refusal on the second; each must stay plain, with no hit, and the gate must pass them.
test('binaries whose small 16-bit values run in both byte orders (a PE string table, a font collection) stay plain: no wide reading, no hit, no refusal -- RED against 7edf02c', async () => {
  const { scanBytes, wideKinds, WIDE_TOO_LARGE } = await import(pathToFileURL(LIB).href);
  let seed = 11;
  const rnd = (n) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) >>> 0; b[i] = seed >>> 24; } return b; };
  const smallBE = (n) => { const b = Buffer.alloc(n * 2); for (let k = 0; k < n; k++) b.writeUInt16BE(1 + (k % 200), k * 2); return b; };
  const strLE = (s) => Buffer.from(s, 'utf16le');
  const peLike = Buffer.concat([rnd(20000), strLE('FileDescriptionWindowsShellCommonDll'.repeat(4)), rnd(3000), smallBE(400), rnd(20000), strLE('CompanyNameMicrosoftCorporation'.repeat(3)), smallBE(300), rnd(9000)]);
  const fontLike = Buffer.alloc((8 << 20) + 65536);
  for (let off = 0; off + 4096 <= fontLike.length; off += 4096) {
    rnd(2048).copy(fontLike, off);
    smallBE(512).copy(fontLike, off + 2048, 0, 1024);
    strLE('Regular'.repeat(20)).copy(fontLike, off + 3072, 0, 1024);
  }
  for (const [name, b] of [['pe-like.dll', peLike], ['font-like.ttc', fontLike]]) {
    assert.deepStrictEqual(wideKinds(b), [], name + ': not read as wide text');
    const hits = scanBytes(b, name);
    assert.ok(!hits.some((h) => h.pattern === WIDE_TOO_LARGE), name + ': no "too large to decode" refusal');
    assert.strictEqual(hits.length, 0, name + ': no hit: ' + JSON.stringify(hits.map((h) => h.pattern)));
  }
  const r = run(repo([{ 'pe-like.dll': peLike }]));
  assert.strictEqual(r.code, 0, 'the gate passes the PE-shaped file: ' + r.out + r.err);
});

// 21a (a carrier's pull request: CodeRabbit Verify's "false rejection of a longer UTF-16LE word at the 1 MiB window boundary", and CodeRabbit's thread on a key cut by a
// window): the wide-spelled search runs in windows, and a window's text END satisfied a pattern's closing boundary, so a word too long to be a key, cut by the end,
// was reported; and a key across the edge was reported at its shorter first sighting, a fingerprint an acknowledgment of the whole value never matches. Each match
// now belongs to the one window that owns its first byte, and that window's text runs past it. The gate's stream probe uses the same windows.
test('a wide-spelled word cut by a scan window is judged whole: a word too long to be a key is not reported, and a key across the edge keeps its whole fingerprint -- RED before 21a', async () => {
  const { spelledHits, spelledProbe, fingerprint } = await import(pathToFileURL(LIB).href);
  let seed = 5;
  // bytes with no NUL and no character a spelling can hold, then a balanced sprinkle of NULs: not wide text, and no spelled run of their own
  const fill = (n) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) >>> 0; b[i] = 0x80 | ((seed >>> 24) & 0x7f); } for (let q = 64; q < n; q += 97) b[q] = 0; return b; };
  const le = (s) => Buffer.from(s, 'utf16le');
  const W = 1 << 20;
  const at = (chars, word) => Buffer.concat([fill(W - 2 * chars), le(word), Buffer.from([0x0a]), fill(4000)]); // the window edge falls after `chars` characters
  const probe = (b) => { const r = spelledProbe(); for (let i = 0; i < b.length; i += 65536) r.feed(b.subarray(i, i + 65536)); r.end(); return r.found(); };
  const long = 'AK' + 'IA' + 'ABCDEFGHIJKLMNOPQ'; // 17 body characters: one more than an AWS key id holds, so not a key
  for (const chars of [20, 21, 4]) {
    const b = at(chars, long);
    assert.deepStrictEqual(spelledHits(b, 'f.bin'), [], 'a word too long to be a key, cut after ' + chars + ' characters, is not reported');
    assert.strictEqual(probe(b), false, 'the gate probe agrees, cut after ' + chars);
  }
  const key = 'gl' + 'pat-' + 'aB3'.repeat(10);
  const whole = fingerprint('f.bin', 'gitlab-pat', key);
  for (const chars of [28, 30, 7]) {
    const b = at(chars, key);
    assert.deepStrictEqual(spelledHits(b, 'f.bin').map((h) => [h.line, h.pattern, h.fp]), [[1, 'gitlab-pat', whole]], 'a key across the edge after ' + chars + ' characters keeps its whole fingerprint');
    assert.strictEqual(probe(b), true, 'the gate probe finds it, cut after ' + chars);
  }
  // inside one window, and in a file of one window, nothing changes
  const small = Buffer.concat([fill(5000), le(key), Buffer.from([0x0a]), fill(4000)]);
  assert.deepStrictEqual(spelledHits(small, 'f.bin').map((h) => h.fp), [whole]);
  assert.strictEqual(probe(small), true);
});

// 21a (CodeRabbit on a carrier's pull request, on the gate's index listing): a path that is not valid UTF-8 was decoded to U+FFFD, so two such paths holding one key became one
// string, one hit and one fingerprint, and one acknowledgment cleared both; the push side's patch headers decoded the same way. Such a path now fails the gate by
// name, at commit and at push, and its hits are never given a fingerprint another path shares. A path that is valid UTF-8 keeps its fingerprint.
test('a staged or pushed path that is not valid UTF-8 fails the gate by name instead of sharing a fingerprint with another path -- RED before 21a', () => {
  const KEY2 = 'gh' + 'p_' + 'Q7w'.repeat(12);
  const dir = repo([{ 'README.md': 'plain\n' }]);
  const gitIn = (args, input) => execFileSync('git', [...GIT_IDENTITY, '-C', dir, ...args], { input, timeout: 60000, env: gitEnv() }).toString().trim();
  const sha = gitIn(['hash-object', '-w', '--stdin'], Buffer.from('token = ' + KEY2 + '\n'));
  const odd = (x) => Buffer.concat([Buffer.from('a'), Buffer.from([x]), Buffer.from('.txt')]);
  const entry = (pathBytes) => Buffer.concat([Buffer.from('100644 ' + sha + ' 0\t'), pathBytes, Buffer.from('\n')]);
  gitIn(['update-index', '--index-info'], Buffer.concat([entry(odd(0xff)), entry(odd(0xfe)), entry(Buffer.from('ok.txt'))]));
  const r = run(dir);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.ok(/2 staged path\(s\) are not valid UTF-8/.test(r.out), 'both paths named as unreadable: ' + r.out);
  assert.ok(r.out.includes('a\\xff.txt') && r.out.includes('a\\xfe.txt'), 'each named by its bytes: ' + r.out);
  assert.ok(!r.out.includes(String.fromCharCode(0xfffd)), 'no path is shown decoded to U+FFFD: ' + r.out);
  assert.ok(r.out.includes('tree "ok.txt":1 github-token'), 'a valid path beside them is still scanned: ' + r.out);
  // 21b (the 21a review's L2): the message says the refusal is about the path and gives the rename that works for such a path in the index; the commands are run
  // here as printed (a wildcard that matches only the byte that is not UTF-8, and the blob id), and the renamed index then passes the path check
  assert.ok(r.out.includes('This refusal is about the path, not about a key in it.'), r.out);
  assert.ok(r.out.includes('a\\xff.txt: git ls-files -s -- "a[^ -~].txt" ; git update-index --add --cacheinfo 100644,' + sha + ',<new name> ; git rm --cached -q -- "a[^ -~].txt"'), r.out);
  assert.strictEqual(gitIn(['ls-files', '--', 'a[^ -~].txt']).split('\n').length, 2, 'the printed wildcard matches the two such paths and not ok.txt');
  // the same two files pushed in a commit
  const tree = gitIn(['write-tree']);
  const commit = gitIn(['commit-tree', tree, '-p', 'HEAD', '-m', 'odd names']);
  gitIn(['update-ref', 'refs/heads/main', commit]);
  const pushed = run(dir, ['--pre-push'], 'refs/heads/main ' + commit + ' refs/heads/main ' + ZERO + '\n');
  assert.strictEqual(pushed.code, 1, pushed.out + pushed.err);
  assert.ok(/a pushed file's path is not valid UTF-8 \(a\\x[ef][ef]\.txt\)/.test(pushed.out), 'the push names the path: ' + pushed.out);
  assert.ok(!pushed.out.includes(String.fromCharCode(0xfffd)), 'no path is shown decoded to U+FFFD: ' + pushed.out);
});

// 21a (CodeRabbit on a carrier's pull request, on the gate's failure message): "committed on the branch you push" sent a user whose staged tree held a match to the pushed branch,
// while the tree scan reads acknowledgments from HEAD. The message now names the tree each kind of hit is acknowledged in.
test('the failure message says where each kind of hit is acknowledged: a tree hit in HEAD, a pushed hit in the pushed commit -- RED before 21a', () => {
  const r = run(repo([{ 'k.txt': 'token = ' + 'gh' + 'p_' + 'Q7w'.repeat(12) + '\n' }]));
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.ok(r.out.includes('committed where the gate reads it: for a "tree" hit in HEAD (the commit checked out), for a "pushed" hit in the pushed commit'), r.out);
  assert.ok(!r.out.includes('the branch you push'), r.out);
});

// 21b (the 21a review's M1): the test above cuts words at the OLD window edge (1 MiB), where the longer windows of 21a already save them, so a scanner that dropped the
// owner rule (every window reporting every match it sees) still passed. A window's text now ENDS at its start + 1 MiB + 16 KiB, and only the owner rule keeps a word cut
// there out: the next window owns it and sees it whole. The reviewer's vector, a 304-character word of github shape (past the pattern's 255 cap, so not a key), cut at the
// first and second windows' text ends, in all four wide spellings. RED against the owner rule dropped (newedge.mjs, the 21a review).
test('a wide-spelled word cut at a window\'s text end (1 MiB + 16 KiB past its start) is judged by the window that owns it, whole: not reported -- RED against the owner rule dropped', async () => {
  const { spelledHits, spelledProbe } = await import(pathToFileURL(LIB).href);
  const W = 1 << 20;
  const END = W + 16384; // the first window's text end; the second's is W + END
  const word = ' ' + 'g' + 'hp_' + 'aB3d'.repeat(75) + ' ';
  const u32 = (s, little) => { const b = Buffer.alloc(s.length * 4); [...s].forEach((c, k) => (little ? b.writeUInt32LE(c.charCodeAt(0), k * 4) : b.writeUInt32BE(c.charCodeAt(0), k * 4))); return b; };
  const spell = { LE16: Buffer.from(word, 'utf16le'), BE16: Buffer.from(word, 'utf16le').swap16(), LE32: u32(word, true), BE32: u32(word, false) };
  const probe = (b) => { const r = spelledProbe(); for (let i = 0; i < b.length; i += 65536) r.feed(b.subarray(i, i + 65536)); r.end(); return r.found(); };
  for (const [name, w] of Object.entries(spell)) {
    for (const end of [END, W + END]) {
      const b = Buffer.alloc(2 * W + END + 4096); // zeros: a NUL-bearing file that holds no run of its own
      w.copy(b, end - 200); // 200 bytes of the word before the text end, the rest after
      assert.deepStrictEqual(spelledHits(b, 'f.bin'), [], name + ', cut at ' + end + ': not reported');
      assert.strictEqual(probe(b), false, name + ', cut at ' + end + ': the gate probe agrees');
    }
  }
});

// 21c (the 21b re-check's N1): the wildcard printed in the refusal kept a path's valid UTF-8 characters as they were, so a path holding U+009B (an 8-bit CSI), U+2028
// (a line separator) or U+202E (a right-to-left override) sent them raw to the terminal, past the gate's own rule on escaping by category. The reviewer's path, built from
// code points: every line of the output is printable ASCII, and the printed wildcard still selects that one path and not its neighbours one ordinary character apart.
test('a path that is not valid UTF-8 and holds C1, line-separator or bidi characters prints as ASCII only, and its wildcard still selects it alone -- RED before 21c', () => {
  const dir = repo([{ 'README.md': 'plain\n' }]);
  const gitIn = (args, input) => execFileSync('git', [...GIT_IDENTITY, '-C', dir, ...args], { input, timeout: 60000, env: gitEnv() }).toString().trim();
  const sha = gitIn(['hash-object', '-w', '--stdin'], Buffer.from('nothing here\n'));
  const cp = (n) => Buffer.from(String.fromCodePoint(n), 'utf8');
  const forging = Buffer.concat([Buffer.from('x'), Buffer.from([0xff]), cp(0x9b), Buffer.from('31m'), cp(0x2028), Buffer.from('FAKE'), cp(0x202e), Buffer.from('.txt')]);
  const near = (c) => Buffer.concat([Buffer.from('x'), Buffer.from([0xff]), cp(0x9b), Buffer.from('31m'), cp(0x2028), Buffer.from('FAKE'), cp(0x202e), Buffer.from(c + '.txt')]);
  const entry = (pathBytes) => Buffer.concat([Buffer.from('100644 ' + sha + ' 0\t'), pathBytes, Buffer.from('\n')]);
  gitIn(['update-index', '--index-info'], Buffer.concat([entry(forging), entry(near('a')), entry(Buffer.concat([Buffer.from('xA'), forging.subarray(2)])), entry(Buffer.from('x1.txt'))]));
  const r = run(dir);
  assert.strictEqual(r.code, 1, r.out + r.err);
  const out = r.out + r.err;
  assert.ok(/^[\x20-\x7e\r\n]*$/.test(out), 'only printable ASCII and line ends reach the output: ' + JSON.stringify([...out].filter((c) => c < ' ' && c !== '\n' && c !== '\r' || c > '~').map((c) => 'U+' + c.codePointAt(0).toString(16))));
  assert.strictEqual(out.trim().split(/\r?\n/).length, 1, 'one line: no path splits it');
  const glob = /"(x\[\^ -~\][^"]*\.txt)"/.exec(r.out);
  assert.ok(glob, 'a wildcard is printed for the path: ' + r.out);
  const hits = gitIn(['ls-files', '-z', '--', glob[1]]).split(String.fromCharCode(0)).filter(Boolean);
  assert.strictEqual(hits.length, 1, 'the printed wildcard lists exactly one path: ' + JSON.stringify(hits));
  assert.ok(hits[0].endsWith('FAKE' + String.fromCodePoint(0x202e) + '.txt') && !hits[0].startsWith('xA'), 'and it is the forging path, not a neighbour one character apart');
});
