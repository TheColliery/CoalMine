// CoalMine verify.mjs 2.11 POINTER gate tests, the git half (FIX 2 lone-CR .gitignore pair, git-unavailable) — node:test, zero dependencies.
// Run: node --test scripts/lib/verify-pointers-git.test.mjs
// 17e BUILD 2 (CI red on node 22, per-FILE clock): split out of verify-pointers.test.mjs, tests verbatim, so neither file nears the 120 s clock. The small spawn helpers below are
// duplicated from that file on purpose (a test file imports no other test file).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitEnv } from './git-env.mjs';
import { removeTree } from './test-sandbox.mjs';

const NL = String.fromCharCode(10);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// 16e (CR PRRT_kwDOSxeWG86oZt-g and PRRT_kwDOSxeWG86rMDJ9, rows 4 and 24): every verify.mjs spawn of this file runs in a sandboxed environment (HOME, USERPROFILE, TEMP, TMP and
// TMPDIR in a throwaway folder, never the operator's) and under a finite clock (testing.md: every spawnSync in a test passes `timeout`). 100 s, not the reviewer's 300 s: the
// room's per-test clock is 120 s (and node 22 bounds the whole FILE), so a longer bound could never fire; the slowest verify.mjs run here is about 13 s alone.
const VERIFY_TIMEOUT_MS = 100000;
function sandboxEnv(dir, extra = {}) {
  return { ...process.env, HOME: dir, USERPROFILE: dir, TEMP: dir, TMP: dir, TMPDIR: dir, ...extra };
}
function verifyRun(t, tmp) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-pointer-home-'));
  t.after(() => removeTree(home));
  return () => spawnSync(process.execPath, ['--max-old-space-size=2048', path.join(tmp, 'scripts', 'verify.mjs')],
    { encoding: 'utf8', env: sandboxEnv(home), timeout: VERIFY_TIMEOUT_MS, killSignal: 'SIGKILL' });
}

// verify.mjs 2.11 pointers, CWK-090 fix 1: the batched `git check-ignore --stdin` call
// treated ONLY a spawn error as failure -- any other non-0/1 exit (128 included: a bad
// pattern, an unreadable .gitignore, a broken worktree) fell through to "read stdout",
// got an empty ignoredRoots, and printed a git-derived count over a run that derived
// nothing. The classification itself is now `classifyCheckIgnoreResult`
// (pointer-check.mjs), pure, and its own unit suite (pointer-check.test.mjs) is where
// this fix is actually red-first proven -- against a REAL non-0/1 git result (a
// 129-exit from an unknown option), replaying the byte-copied pre-fix logic to show it
// silently answers "nothing is ignored" on that exact run.
//
// AN END-TO-END proof through THIS file -- driving verify.mjs's own hardcoded
// `spawnSync('git', ['check-ignore', '--stdin'])` call to a non-0/1 exit while its
// `ls-files` pre-gate (same cwd) still succeeds -- was attempted and DOES NOT
// REPRODUCE on this box/git version, stated honestly rather than hidden or
// manufactured: four malformed-input fixture shapes (`.gitignore` as a directory,
// `core.excludesFile` pointing at a directory or a symlink loop, a malformed glob,
// `.git/info/exclude` as a directory) all degrade to exit 1, not a failure, under git
// 2.55.0.windows.5 -- this version's `check-ignore` is deliberately tolerant of
// malformed input. A `.cmd` shim placed first on a custom PATH was also tried, to
// intercept the real subprocess verify.mjs spawns: `where.exe` confirmed the identical
// PATH string resolves the shim first, but Node's own `spawnSync('git', ...)` on this
// Windows/Node build resolved straight past it to the real `git.exe` found later on
// PATH, reproduced with the minimal possible shim (no logic, just a debug-file write)
// and never observed to invoke it -- a platform/runtime discrepancy this fix does not
// depend on being explained. The one REAL non-0/1 exit found (129, an unknown option,
// pinned in pointer-check.test.mjs) needs a flag verify.mjs never passes, so it proves
// the branch is reachable BY GIT, not that verify.mjs's own hardcoded call can be
// driven there today. What the classifier's own unit tests prove instead, and it is
// real: the fix correctly rejects the exact real-git failure shape found, correctly
// keeps accepting the ordinary 0/1 successes (no regression), and the pre-fix logic
// demonstrably does not.

// verify.mjs 2.11 pointers, CWK-090 fix 2 -- RE-AIMED (CWK-090 findings-back, r31
// build #2, item C): the FIRST version of this test used a .gitignore whose PATTERN
// LINES merely end CRLF (`crlf-ignored-dir\r\n`) and, on that shape, the false match
// genuinely does not reproduce on this box/git version (2.55.0.windows.5) -- that half
// of the old sentence stays true, kept below re-aimed rather than deleted. What was
// WRONG is treating that as "the bug does not reproduce here": it reproduces, on a
// DIFFERENT shape the old test never tried. The head reproduced it (a scratchpad
// measurement record, deliberately not backticked here -- gitignored, so the pointer
// gate this test itself proves would FAIL on citing it): a line whose ENTIRE CONTENT
// is a lone CR -- a "blank" line carrying a stray carriage return -- false-matches a
// probed root under the bare `first + '/'` feed. **Independently re-measured here, sharper than
// the head's own record: the false match additionally requires the probed root to be
// GENUINELY ABSENT from disk** -- `scripts/` (a real directory in the fixture) does
// NOT false-match under this exact fixture, while `totally-fake-root/` (nothing on
// disk, no pattern names it) does. That is exactly the shape CWK-090's own motivating
// case is: a citation to a path that does not exist, gitignored or not, which is why
// the pointer gate probes it at all. `git check-ignore -v --stdin` names the lone-CR
// line as the matching pattern (`.gitignore:2:<TAB>root/`, rendered invisibly), so the
// source is unambiguous, not a fluke of this one fixture.
// 16e (CR PRRT_kwDOSxeWG86kpnrR, row 2): the fixture of the lone-CR tests, shared by the two tests below. The one test this was used to be reported a PASS on a Git that does
// not reproduce the quirk, because the quirk legs were skipped inside it by a `t.diagnostic`; the quirk legs are now their own test, which ends in a real `t.skip`.
function loneCrFixture(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-pointer-lonecr-'));
  t.after(() => removeTree(tmp));
  for (const d of ['scripts', 'skills', 'hooks', 'plugin', '.claude-plugin', 'commands', 'agents', 'platform-configs', 'alt']) {
    const src = path.join(repo, d);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, d), { recursive: true });
  }
  for (const d of ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'PRIVACY.md', 'CHANGELOG.md']) {
    fs.copyFileSync(path.join(repo, d), path.join(tmp, d));
  }
  // A real pattern (`dist/`) so a genuine ignore still exists to control against,
  // PLUS a lone-CR blank line -- the shape that actually false-matches. Written as
  // raw bytes (not a JS template string) so the CR survives untouched through
  // core.autocrlf's smudge filter on checkout, matching the head's own fixture.
  fs.writeFileSync(path.join(tmp, '.gitignore'), Buffer.from('dist/\r\n\r\n', 'binary'));
  // A citation to a root that is ABSENT from disk and named by no pattern -- the
  // shape that reproduces (see the header comment). Under the bug this token would
  // be swallowed into a FALSE "gitignored" FAIL instead of the silent out-of-scope
  // skip it correctly gets when `totally-fake-root` is neither an ourRoot nor
  // resolvable beside its citer -- CoalFace's "bogus FAIL" shape, reproduced here.
  fs.appendFileSync(path.join(tmp, 'commands', 'stats.md'),
    NL + 'See `totally-fake-root/notes.md` for details.' + NL +
    // 18a (E1 t171): a SENTINEL citation, in scope (`commands/` is a tracked root) and dead, so the gate prints a FAIL line that NAMES this citing file. verify.mjs prints no per-file
    // or scanned-count line for a clean file, so a finding is the smallest real signal that commands/stats.md was scanned at all.
    'And see `commands/sentinel-18a-missing.md` as the in-scope sentinel.' + NL);

  const git = (args) => {
    const r = spawnSync('git', args, { cwd: tmp, encoding: 'utf8', env: gitEnv(path.dirname(tmp)) });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.error?.message}`);
    return r.stdout;
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@test.invalid']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'core.autocrlf', 'true']);
  // `git commit` starts `git maintenance run --auto` as its own process (measured with
  // GIT_TRACE2_EVENT: cmd_name "maintenance" follows "commit"); it is not ours to wait on,
  // and a CI leg (ubuntu node 22, git 2.55) failed this test's cleanup with ENOTEMPTY on
  // .git. The fixture never wants it.
  git(['config', 'maintenance.auto', 'false']);
  git(['config', 'gc.auto', '0']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'baseline']);
  assert.ok(fs.readFileSync(path.join(tmp, '.gitignore'), 'utf8').includes('\r\n\r\n'),
    'the working-tree .gitignore must actually carry the lone-CR blank line -- the shape this fixture exists to test');
  assert.ok(!fs.existsSync(path.join(tmp, 'totally-fake-root')),
    'the probed root must be genuinely absent -- that absence is what the false match depends on');
  return { tmp, git };
}

// THE QUIRK LEGS, their own test (row 2). CWK-120 row 21: this repo's CI matrix does not pin a Git version, and lone-CR .gitignore parsing is not a documented,
// universal Git contract -- a different runner's Git can legitimately answer status 1 here (correctly NOT ignored, i.e. this quirk simply does not reproduce on that
// Git). That is an ENVIRONMENT difference, not a CoalMine defect, so it is a VISIBLE SKIP of these quirk-specific assertions only (a real `t.skip`, reported as a
// skip, never as a pass) -- any OTHER non-zero status is still a real fixture failure (git missing, the .gitignore fixture itself broken) and stays fatal.
test('verify.mjs 2.11 pointers: FIX 2 (git quirk) -- the lone-CR .gitignore line false-matches an absent root under the bare feed; the injection-site feed is immune', (t) => {
  const { tmp } = loneCrFixture(t);
  // THE DISCRIMINATING PAIR, at the git level, on the SAME real fixture -- no source-code substitution needed, since the bare feed and the probe feed are both real,
  // independent git invocations.
  const check = (input, extra = []) => spawnSync('git', ['check-ignore', ...extra, '--stdin'], { cwd: tmp, env: gitEnv(path.dirname(tmp)), encoding: 'utf8', input, timeout: 60000, killSignal: 'SIGKILL' });
  const bare = check('totally-fake-root/\n');
  if (bare.status === 1) {
    t.skip('this Git does not reproduce the lone-CR false-match (bare.status === 1); the control and end-to-end legs run in the next test');
    return;
  }
  assert.equal(bare.status, 0,
    `RED: the bare feed must reproduce the false match on THIS fixture (or answer 1 if this Git version does not) -- got status ${bare.status}, a genuine fixture failure`);
  const probed = check('totally-fake-root/.pointer-check-probe\n');
  assert.equal(probed.status, 1,
    'the injection-site feed correctly reports the SAME root as NOT ignored');
  const verbose = check('totally-fake-root/\n', ['-v']);
  assert.match(verbose.stdout, /\.gitignore:2:/,
    'the matching pattern must be the lone-CR line (line 2), naming the source unambiguously');
});

// CONTROL and END-TO-END, which run on every Git. CONTROL: a genuinely-ignored root still matches under BOTH feeds -- the probe loses no true positive. END-TO-END: the
// real gate, as fixed, must not be fooled by this fixture -- the absent-root citation is silently out of scope (never even resolves), never the false "gitignored"
// FAIL the bare feed would have produced.
test('verify.mjs 2.11 pointers: FIX 2 (control, end to end) -- a genuinely ignored root still matches under both feeds, and the real gate is immune to the lone-CR line', (t) => {
  const { tmp } = loneCrFixture(t);
  const check = (input) => spawnSync('git', ['check-ignore', '--stdin'], { cwd: tmp, env: gitEnv(path.dirname(tmp)), encoding: 'utf8', input, timeout: 60000, killSignal: 'SIGKILL' });
  assert.equal(check('dist/\n').status, 0);
  assert.equal(check('dist/.pointer-check-probe\n').status, 0);

  // A MERELY-CRLF pattern line (the old fixture's own shape) does NOT reproduce it
  // on this box/git version -- kept as the honest, re-aimed sentence (see the header
  // comment); not re-asserted as a second fixture here, since this box's own real
  // lone-CR fixture already proves the point it stands beside.
  const r = verifyRun(t, tmp)();
  // 17e BUILD 3 (E1 t169): the doesNotMatch asserts below are vacuous on a run that never reached the pointers gate (a crash at import, a timeout, an earlier gate exiting first).
  // So assert the run finished and printed the pointers block, then judge the WHOLE stdout (a slice between 'hooks:' substrings can be cut short by a line that merely holds one; INSPECT bounce 1). Status 0 is NOT asserted: the trimmed fixture may fail unrelated gates.
  assert.ok(!r.error, `verify.mjs ran to the end (no spawn error, no timeout): ${r.error && r.error.message}`);
  const out = String(r.stdout);
  const start = out.indexOf('pointers:');
  const end = out.indexOf('hooks:');
  assert.ok(start !== -1 && end > start, `the pointers block was printed, followed by hooks:, got:${NL}${out}${r.stderr}`);
  assert.match(out, /FAIL commands\/stats\.md cites `commands\/sentinel-18a-missing\.md`, which does not resolve/,
    'POSITIVE: the citing file commands/stats.md was scanned (its in-scope sentinel citation is reported by name), so the doesNotMatch asserts below judged a real scan');
  assert.doesNotMatch(out, /totally-fake-root.*gitignored/i,
    'the gate must never report the absent-root citation as gitignored -- the exact false FAIL the bare feed would have produced');
  assert.doesNotMatch(out, /FAIL.*totally-fake-root/,
    'the absent-root citation must not FAIL at all -- it is silently out of scope, not "gitignored" and not "does not resolve"');
});

// verify.mjs 2.11 POINTER gate degrade path (CWK-079): git unavailable must SKIP, never
// FAIL. CoalBoard's own trap is the rail here -- it hid git by filtering PATH entries
// whose NAME contains "git", which passed on Windows and failed all four Unix legs
// (a name filter proves nothing about whether git is actually reachable). The real
// capability probe is an EMPTY temp dir as the entire PATH.
//
// An emptied PATH also removes `sh`, so the probe cannot be applied through a shell --
// `PATH=$EMPTY sh -c '...'` dies with "sh: command not found" before it ever reaches
// verify.mjs. Spawn via `process.execPath` (an ABSOLUTE path, so no PATH lookup is
// needed to launch node itself) with the CHILD's own `env.PATH` overridden to the empty
// dir -- verified separately that a bare `spawnSync('node', ...)` under the same
// override fails with ENOENT on this platform too, which is why the outer command must
// be the absolute path and not the bare name.
test('verify.mjs 2.11 pointers: git unavailable degrades to a NAMED SKIP, never a FAIL -- proven with a capability probe, not a name filter', (t) => {
  const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-emptypath-'));
  try {
    const r = spawnSync(process.execPath, [path.join(repo, 'scripts', 'verify.mjs')],
      { env: sandboxEnv(emptyPath, { PATH: emptyPath }), encoding: 'utf8', timeout: VERIFY_TIMEOUT_MS, killSignal: 'SIGKILL' });
    assert.equal(r.status, 0, `git-unavailable must still exit 0 (nothing else in this repo depends on git), got:${NL}${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /pointers:\n\s+--\s+pointer check: git unavailable.*skipped/,
      'the pointers block must print a visible, named SKIP -- never a silent carve-out and never a FAIL');
    // CWK-120 row 20: `indexOf('hooks:')` returning -1 (a rename, a reorder) makes
    // `slice(start, -1)` truncate the string instead of delimiting a block -- the
    // doesNotMatch below would then pass having checked something other than the
    // pointers section. This is the exact vacuity class this file exists to guard
    // against; assert both markers exist and are correctly ordered BEFORE slicing.
    const start = r.stdout.indexOf('pointers:');
    const end = r.stdout.indexOf('hooks:');
    assert.ok(start !== -1 && end > start,
      `the pointers block must be delimited by a following hooks: block, got:${NL}${r.stdout}`);
    const pointersBlock = r.stdout.slice(start, end);
    assert.doesNotMatch(pointersBlock, /FAIL/,
      'a question only git can answer must never redden the gate for a non-git user');
  } finally {
    removeTree(emptyPath);
  }
});

