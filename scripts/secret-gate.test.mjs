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
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, 'secret-gate.mjs');
const LIB = path.join(HERE, 'lib', 'secret-scan.mjs');
const KEY = ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join(''); // an access-key-id shape, assembled so this file never carries one
const ZERO = '0'.repeat(40);
const made = [];
// UMB-439 ruling 3 (a): ONE sandbox of the test's own. Every fixture folder, every child's TEMP, TMP, TMPDIR, HOME and USERPROFILE live in it, and the
// developer's global git configuration never applies (GIT_CONFIG_GLOBAL is an empty file of the sandbox, the system config is off).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-gate-sandbox-'));
const EMPTY_GLOBAL = path.join(SANDBOX, 'empty-global-gitconfig');
fs.writeFileSync(EMPTY_GLOBAL, '');
// A hook runs with GIT_DIR, GIT_INDEX_FILE and friends set; a fixture that inherited them would write into the repository
// the hook runs for. Every fixture git call, and the gate under test, gets an environment without them.
const gitEnv = () => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k))),
  TEMP: SANDBOX, TMP: SANDBOX, TMPDIR: SANDBOX, HOME: SANDBOX, USERPROFILE: SANDBOX,
  GIT_CONFIG_GLOBAL: EMPTY_GLOBAL, GIT_CONFIG_NOSYSTEM: '1',
  // git stops searching for a repository at the sandbox's parent: a temp folder that sits inside a repository must not make a fixture look like part of it (UMB-456 (1) vi)
  GIT_CEILING_DIRECTORIES: path.dirname(SANDBOX),
});

function git(dir, ...args) {
  return gitWith({}, dir, ...args);
}
function gitWith(extra, dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...gitEnv(), ...extra } }).trim();
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

function run(dir, args = [], input = '', extraEnv = {}) {
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'secret-gate.mjs'), ...args], {
    cwd: dir, input, encoding: 'utf8', timeout: 60000,
    env: { ...gitEnv(), HOME: dir, USERPROFILE: dir, ...extraEnv },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

test.after(() => { for (const d of [...made, SANDBOX]) fs.rmSync(d, { recursive: true, force: true }); });

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
  fs.copyFileSync(path.join(dir, '.git', 'index'), idx);
  const withKey = execFileSync('git', ['-C', dir, 'hash-object', '-w', '--stdin'], { input: `${KEY}\n`, encoding: 'utf8', timeout: 60000, env: gitEnv() }).trim();
  gitWith({ GIT_INDEX_FILE: idx }, dir, 'update-index', '--add', '--cacheinfo', `100644,${withKey},k.txt`);
  const r = run(dir, [], '', { GIT_INDEX_FILE: idx });
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /tree "k\.txt":1 aws-access-key-id/);
  assert.strictEqual(run(dir).code, 0, 'without the variable the real index is clean');
});

test('a staged entry whose blob cannot be read fails the scan by count, never passes as scanned', () => {
  const dir = repo([{ 'a.txt': 'clean\n' }]);
  gitWith({}, dir, 'update-index', '--add', '--info-only', '--cacheinfo', `100644,${'1'.repeat(40)},ghost.txt`);
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
  gitWith({}, dir, 'update-index', '--add', '--cacheinfo', `100644,${sha},damaged.txt`);
  const r = run(dir);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /FAIL SECRETS: 1 tracked file\(s\) could not be read, so were NOT scanned: "damaged\.txt"/);
});

// UMB-439 ruling 3 (a), from the LLM zone's patrol: the fixtures must not depend on, or write into, the developer's own machine. Every fixture
// folder lives in ONE sandbox of the test's own, the children's TEMP, TMP and TMPDIR point at it, and the developer's global git configuration
// (a hooks path, a signing rule, a template directory) never applies: GIT_CONFIG_GLOBAL is an empty file inside the sandbox and the system
// config is switched off. The witness below plants a hostile global config and a hostile HOME; the fixture commits must still work.
test('the fixtures run in the test\'s own sandbox: a hostile global git config and HOME never reach them, and the fixture folders live inside the sandbox -- RED before UMB-439', () => {
  const hostile = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-gate-hostile-'));
  made.push(hostile);
  const hooks = path.join(hostile, 'hooks');
  fs.mkdirSync(hooks);
  fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho hostile global hook >&2\nexit 1\n', { mode: 0o755 });
  const hostileConfig = '[core]\n\thooksPath = ' + hooks.replace(/\\/g, '/') + '\n';
  fs.writeFileSync(path.join(hostile, '.gitconfig'), hostileConfig); // read through HOME
  fs.mkdirSync(path.join(hostile, 'git'));
  fs.writeFileSync(path.join(hostile, 'git', 'config'), hostileConfig); // read through XDG_CONFIG_HOME (UMB-456 (1) v: it was planted at hostile/.gitconfig, a path XDG never reads)
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.HOME = hostile; process.env.USERPROFILE = hostile; process.env.XDG_CONFIG_HOME = hostile;
  try {
    const dir = repo([{ 'a.txt': 'x\n' }]); // a commit under the hostile global hook would fail with exit 1
    assert.ok(path.resolve(dir).startsWith(path.resolve(SANDBOX) + path.sep), 'the fixture folder is inside the sandbox: ' + dir);
    const probe = execFileSync(process.execPath, ['-e', 'const e = process.env; console.log(JSON.stringify([e.TEMP, e.TMP, e.TMPDIR, e.GIT_CONFIG_GLOBAL, e.GIT_CONFIG_NOSYSTEM]))'], { encoding: 'utf8', timeout: 60000, env: gitEnv() });
    const [tmp, tmp2, tmpdir, global, nosys] = JSON.parse(probe);
    assert.deepEqual([tmp, tmp2, tmpdir], [SANDBOX, SANDBOX, SANDBOX]);
    assert.equal(path.dirname(global), SANDBOX);
    assert.equal(fs.readFileSync(global, 'utf8'), '', 'the global config is an empty file of the sandbox');
    assert.equal(nosys, '1');
  } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
});

// UMB-456 (1) vi (CoalGob N1): when the machine's temp folder sits inside a git repository, the sandbox sits inside it too, and a fixture folder that is
// NOT a repository would find that outer repository. The sandbox's git calls carry a ceiling at the sandbox's parent so the search stops there.
// The witness runs the test that needs "not inside a git repository" in a child whose TEMP, TMP and TMPDIR are a folder inside a real repository.
// The child's reporter is PINNED to tap: left to its default it is spec on Node 24 (measured, stdout a pipe or a file) and tap on Node 22 when stdout is not a TTY
// (nodejs.org v22 test docs), so a count read from the default was right on a developer's Node 24 and wrong on CI's Node 22 (run 37722574073).
test('the sandbox is closed against a repository ABOVE the temp folder: a non-repository fixture is still not inside one -- RED before UMB-456 (1) vi', { skip: process.env.SECRET_GATE_NESTED ? 'this is the nested run' : false }, () => {
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
