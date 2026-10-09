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
