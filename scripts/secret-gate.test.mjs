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

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv() }).trim();
}

// A throwaway repository holding the gate and its scanner, with one commit per entry of `commits` ({ file: text } maps;
// a null text deletes the file).
function repo(commits, { withLib = true } = {}) {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'secret-gate-'));
  made.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'commit.gpgsign', 'false');
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
  "process.stdout.write(out, () => { process.exitCode = mode === 'exit1' ? 1 : 0; });",
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

// 15i V1: the cost of decoding is bounded. A 32 MiB file of 16-bit samples, which the rule reads as UTF-16 (each sample's high byte is NUL), was
// decoded whole: 8.1 s and 1.19 GB (the reviewer's measure). Past WIDE_DECODE_MAX_BYTES it is not decoded: the scan fails by name with a hit of its
// own whose fingerprint the acks file can carry, and the gate's peak memory grows by a few times the blob, never by the dozens decoding costs.
const SAMPLES_BYTES = 32 << 20;
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
    for (let i = 0; i < chunk.length; i += 2) chunk[i] = ((i >> 1) * 7) & 0x7f;
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
  const wide = (fill) => { const b = Buffer.alloc(WIDE_DECODE_MAX_BYTES + 2); for (let i = 0; i < b.length; i += 2) b[i] = i % 64 === 0 ? 0x0a : fill; return b; };
  const one = scanBytes(wide(0x61), 'w.bin');
  const two = scanBytes(wide(0x62), 'w.bin');
  assert.deepStrictEqual(one.map((h) => [h.line, h.pattern]), [[1, WIDE_TOO_LARGE]]);
  assert.notStrictEqual(one[0].fp, two[0].fp, 'other bytes ask again');
  assert.notStrictEqual(scanBytes(wide(0x61), 'v.bin')[0].fp, one[0].fp, 'the same bytes at another path ask again');
  const plain = Buffer.alloc(WIDE_DECODE_MAX_BYTES + 2, 0x61);
  for (let i = 0; i < plain.length; i += 64) plain[i] = 0x0a;
  assert.deepStrictEqual(scanBytes(plain, 'a.txt'), []);
  assert.strictEqual(wideTexts(utf32le('x'.repeat(200000)))[0], 'x'.repeat(200000));
});

// 16a (15i NIT-2, the c175 item): the bound itself. Wide text of exactly WIDE_DECODE_MAX_BYTES is still decoded and scanned; one byte more is not
// (the bound unit test above). The key at the end is found, and no too-large hit is given.
test('wide text of exactly the decode bound is still scanned, with no too-large hit', async () => {
  const { scanBytes, WIDE_DECODE_MAX_BYTES } = await import(pathToFileURL(LIB).href);
  const b = Buffer.alloc(WIDE_DECODE_MAX_BYTES);
  for (let i = 0; i < b.length; i += 2) b[i] = i % 64 === 0 ? 0x0a : 0x61;
  const key = Buffer.from(`\nid ${KEY}\n`, 'utf16le');
  key.copy(b, b.length - key.length);
  assert.deepStrictEqual(scanBytes(b, 'edge.bin').map((h) => h.pattern), ['aws-access-key-id']);
});

// t340 (CodeRabbit, on CoalWash's copy): the NUL-removed reading de-duplicated each hit by scanning every hit before it, so one line of many
// distinct key-shaped tokens with NULs between their characters cost the square of their count (20,000 tokens: 11.8 s on one machine; 40,000:
// 41.6 s). With a Set it is linear (20,000: about 0.1 s). The bound below sits between the two by two orders of magnitude.
test('one line of 20,000 distinct key-shaped tokens with NULs between their characters is read in linear time, every token once', async () => {
  const { scanText } = await import(pathToFileURL(LIB).href);
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const tok = (i) => { let s = ''; for (let k = 0; k < 16; k++) { s += A[i % 32]; i = Math.floor(i / 32); } return 'AKIA' + s; };
  const line = Array.from({ length: 20000 }, (_, i) => tok(i)).join(' ').split('').join(String.fromCharCode(0));
  const start = Date.now();
  const hits = scanText(line, 'f.txt');
  const ms = Date.now() - start;
  assert.strictEqual(hits.length, 20000);
  assert.ok(ms < 2000, `20,000 tokens took ${ms} ms`);
  const spaced = (s) => s.split('').join(String.fromCharCode(0));
  assert.strictEqual(scanText(`${spaced(KEY)} ${spaced(KEY)}`, 'f.txt').length, 1, 'the same token twice on one line is one hit');
});
