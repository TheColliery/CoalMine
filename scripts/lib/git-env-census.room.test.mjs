// git-env-census.room.test.mjs -- THIS room's use of the canon git-spawn census (scripts/lib/git-env-census.mjs, adopted by blob id; its own
// witness list runs in git-env-census.test.mjs). The canon ships NO pin and no path: the room passes its files and its pins, and this is where they live.
// FILE SET: collectScriptsMjs(repo) = every scripts/**/*.mjs, the same set the room's own census walked before 09a. hooks/*.js are CJS and spawn no
// child (Phoenix #5), .githooks/* are shell, and plugin/ holds the built copies of the hooks, so scripts/ is where a git child can be spawned.
// PINS: scripts/lib/git-env-census.pins.mjs, shared with verify.mjs. A pin is { rel, blob, why }: the file at `rel` is exempt only while its content hashes to `blob`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanGitSpawns, collectScriptsMjs, gitBlobId } from './git-env-census.mjs';
import { ROOM_PINS } from './git-env-census.pins.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// The fixtures are assembled from pieces so this file never holds a literal git spawn itself: the census scans scripts/**, this file included.
const SG = 'spawn' + "Sync('git'";
const INHERITING = "import { spawnSync } from 'node:child_process';\n" + SG + ", ['status'], { cwd: process.cwd() });\n";

test('room census: every git spawn across scripts/**/*.mjs takes a safe environment, with the room pins as given', () => {
  const files = collectScriptsMjs(repo);
  const r = scanGitSpawns(files, ROOM_PINS);
  assert.deepEqual(r.findings, [], 'the room census found a git spawn that inherits the ambient environment');
  assert.ok(files.length > 20, 'the census walked ' + files.length + ' files: the file set is not the room');
  assert.ok(r.calls >= 1, 'the room spawns git (git-env.mjs users exist), so zero counted spawns means the census read nothing');
  assert.equal(r.safe, r.calls, 'every counted spawn is safe');
  assert.equal(r.exempted, ROOM_PINS.length, 'every pin exempted its file: a pin that matched nothing is dead weight');
});

test('room census RED-FIRST: a planted git spawn that inherits the environment is a finding, alone and added to the live file set', () => {
  const planted = { rel: 'scripts/lib/zz-planted.mjs', text: INHERITING };
  const alone = scanGitSpawns([planted], ROOM_PINS);
  assert.equal(alone.calls, 1, 'the planted spawn was not even counted');
  assert.ok(alone.findings.length >= 1, 'a planted inheriting git spawn passed the room census');
  const live = scanGitSpawns([...collectScriptsMjs(repo), planted], ROOM_PINS);
  assert.ok(live.findings.length >= 1, 'a planted inheriting git spawn in the room file set passed the room census');
  assert.ok(live.findings.some((f) => f.includes('zz-planted.mjs')), 'the finding names the planted file');
});

test('room census: every pin is a { rel, blob, why } row, holds the file byte for byte, and is load-bearing (without it the file is a finding)', () => {
  const files = collectScriptsMjs(repo);
  for (const p of ROOM_PINS) {
    const f = files.find((x) => x.rel === p.rel);
    assert.ok(f, 'a pinned file is gone: ' + p.rel);
    assert.equal(gitBlobId(f.text), p.blob, 'the pinned file changed, so its pin is dead: ' + p.rel);
    assert.ok(scanGitSpawns([f], []).findings.length >= 1, 'the file passes with no pin, so the pin is not needed: ' + p.rel);
    assert.match(p.blob, /^[0-9a-f]{40}$/, 'a pin carries a full blob id: ' + p.rel);
    assert.ok(typeof p.why === 'string' && p.why.length > 20, 'a pin states why, with the finding quoted: ' + p.rel);
  }
});

// The room's wider rule, kept from the retired room census (R14 LOW-1, git-env.mjs header): gitEnv(..., { keepUserConfig: true }) lets the child read the
// user's global and system git config, so ONLY the installer's core.hooksPath read may pass it. The canon trusts any gitEnv( call by its name, so it cannot see this.
test('room rule (R14 LOW-1): keepUserConfig appears only in the installer and in git-env.mjs with its test', () => {
  const allowed = new Set(['scripts/install.mjs', 'scripts/lib/git-env.mjs', 'scripts/lib/git-env.test.mjs', 'scripts/lib/git-env-census.room.test.mjs']);
  const users = collectScriptsMjs(repo).filter((f) => f.text.includes('keep' + 'UserConfig')).map((f) => f.rel).filter((rel) => !allowed.has(rel));
  assert.deepEqual(users, [], 'keepUserConfig reached a file that may not use it');
  const planted = "import { spawnSync } from 'node:child_process';\nimport { gitEnv } from './git-env.mjs';\n" + SG + ", ['config'], { env: gitEnv('/', { keepUserConfig: true }) });\n";
  const hits = [{ rel: 'scripts/lib/zz-planted.mjs', text: planted }].filter((f) => f.text.includes('keep' + 'UserConfig')).map((f) => f.rel).filter((rel) => !allowed.has(rel));
  assert.deepEqual(hits, ['scripts/lib/zz-planted.mjs'], 'control: the same check flags a planted use');
});

// The room's second wider rule (09a INSPECT MEDIUM-1): the canon census reads spawnSync and execFileSync only (its SPAWNERS set), so a git child started by
// async spawn, execFile, exec or execSync (a string, a template literal or a shell string such as 'git init -q') passes it unseen with `calls 0`, where the
// retired room census refused all of them. None exists in scripts/ today, and this rule keeps it so: it refuses ANY of the four whose first argument begins
// `git`, in the same file set the census walks. LIMIT, named (09a RE-INSPECT LOW-A): it sees the CALLEE NAME as written, so two things are outside its sight: a RENAMED or WRAPPED spawner (import { spawn as run },
// const { exec: sh } = cp, promisify(exec)), and a first argument that is not a git literal (a variable, a ternary, 'git.exe'). None exists in scripts/ today (reachability 0); the
// census cannot judge such a call by text either, and a git child belongs on spawnSync/execFileSync with gitEnv() (git-env.mjs).
const ASYNC_GIT = /\b(spawn|execFile|exec|execSync)\s*\(\s*(['"`])git\b/;
function asyncGitSpawns(files) {
  return files.filter((f) => ASYNC_GIT.test(f.text)).map((f) => f.rel);
}

test('room rule (09a MEDIUM-1): no scripts/**/*.mjs file starts a git child with spawn, execFile, exec or execSync', () => {
  const files = collectScriptsMjs(repo);
  assert.ok(files.length > 20, 'the rule walked ' + files.length + ' files: the file set is not the room');
  assert.deepEqual(asyncGitSpawns(files), [], 'a git child is started by an async or shell spawner the canon census cannot read: use spawnSync/execFileSync with gitEnv()');
});

// RED-FIRST, one control leg per spawner: each planted shape is a git child the canon census passes with calls 0, and this rule must flag it. The calls are
// assembled from pieces so this file holds no literal shape itself (it is inside the walked set).
const IMP = "import { spawn, execFile, exec, execSync } from 'node:child_process';\n";
const SHAPES = [
  ['spawn, string', 'spawn' + "('git', ['fetch'], { cwd: '.' });\n"],
  ['execFile, string', 'execFile' + "('git', ['status'], { env: process.env }, () => {});\n"],
  ['exec, template literal', 'exec' + '(`git status`, { env: process.env }, () => {});\n'],
  ['execSync, shell string', 'execSync' + "('git init -q');\n"],
  ['execSync, double quotes', 'execSync' + '("git log");\n'],
  ['spawn, argument on the next line', 'spawn' + "(\n  'git',\n  ['fetch'],\n);\n"],
];
for (const [name, call] of SHAPES) {
  test('room rule (09a MEDIUM-1) RED-FIRST: a planted ' + name + ' git child is flagged, and the canon census alone does not see it', () => {
    const planted = { rel: 'scripts/lib/zz-planted.mjs', text: IMP + call };
    assert.deepEqual(asyncGitSpawns([planted]), ['scripts/lib/zz-planted.mjs'], 'the room rule passed a planted ' + name + ' git child');
    assert.deepEqual(asyncGitSpawns([...collectScriptsMjs(repo).filter((f) => !f.rel.startsWith('scripts/lib/zz-planted')), planted]), ['scripts/lib/zz-planted.mjs'], 'the planted file, added to the live set, is the only hit');
    const canon = scanGitSpawns([planted], ROOM_PINS);
    assert.equal(canon.calls, 0, 'the canon census now reads this spawner: the room rule is redundant for ' + name + ' and should be retired');
  });
}

test('room rule (09a MEDIUM-1): the sync spawners and non-git children are not flagged (no false positive)', () => {
  const ok = [
    { rel: 'a.mjs', text: SG + ", ['status'], { env: gitEnv('/') });\n" },
    { rel: 'b.mjs', text: 'spawn' + "('node', ['x.js']);\nexec" + "('gitk');\nexecFile" + "('npm', ['git']);\n" },
    { rel: 'c.mjs', text: 'const execution = 1; // exec' + " git spawn(s) are counted\n" },
  ];
  assert.deepEqual(asyncGitSpawns(ok), [], 'sync spawns and non-git first arguments stay clean');
});
