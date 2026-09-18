// CWK-075 — pointer gate unit tests. Zero-dep, node:test only (scripts-quality.md
// section 2). The WIRING is proven separately in render.test.mjs: a module can be fully
// non-vacuous while its verify.mjs block is dead, which this room has now paid for three
// times, so a unit suite alone is never the proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { checkPointers, pointerCandidates, looksPathShaped, PENDING_POINTERS, classifyCheckIgnoreResult, applyCheckIgnoreProbe, PROBE_SUFFIX, DEFAULT_SURFACE_PLAN, collectSurfaces } from './pointer-check.mjs';

const NL = String.fromCharCode(10);
// A resolver standing in for git + the filesystem. Each fixture names its own tree, so no
// test depends on the live repo's layout.
const resolverFor = (tracked = [], untracked = []) => (p) =>
  tracked.includes(p) ? 'tracked' : untracked.includes(p) ? 'untracked' : 'missing';

const base = {
  ourRoots: new Set(['scripts', 'skills', 'scratchpad']),
  ignoredRoots: new Set(['scratchpad']),
  pending: [],
};

test('candidate extraction drops every class the measured funnel drops', () => {
  const text = [
    'a command: `node scripts/install.mjs cursor`',        // whitespace
    'a template: `plugin/skills/<name>/SKILL.md`',          // <placeholder>
    'a glob: `skills/*/SKILL.md`',                          // glob metachar
    'a bare filename: `package-lock.json`',                 // the USER's repo, no dir
    'absolute: `/etc/hosts` and home: `~/.claude/x.json`',  // outside this repo
    'a url: `https://example.invalid/a/b.md`',              // outside this repo
    'an agent home: `.cursor/skills/`',                     // survives HERE, dropped downstream
    'a real one: `scripts/lib/render.mjs`',
  ].join(NL);
  // `.cursor/skills/` SURVIVES the extractor as of CWK-075 r2: whether a dot-dir is ours
  // or the scanned project's is TREE knowledge, so the checker decides it, not the shape
  // rules. The next assertion is where it actually goes out of scope.
  assert.deepEqual(pointerCandidates(text), ['.cursor/skills/', 'scripts/lib/render.mjs']);
  const f = checkPointers({
    ...base,
    surfaces: [{ label: 'README.md', text: 'an agent home: `.cursor/skills/`' }],
    resolve: resolverFor([]),
  });
  assert.deepEqual(f.filter((x) => x.level !== 'SKIP'), [],
    '.cursor is not in ourRoots, so it is out of scope -- no finding, and none needed');
  assert.equal(f.checked, 0);
});

test('a fenced code block is an EXAMPLE, not a claim about this tree', () => {
  const text = ['```', 'see `scripts/lib/ghost.mjs`', '```', 'and `scripts/lib/real.mjs`'].join(NL);
  assert.deepEqual(pointerCandidates(text), ['scripts/lib/real.mjs']);
});

test('a path that resolves to a TRACKED file is clean', () => {
  const f = checkPointers({
    ...base,
    surfaces: [{ label: 'README.md', text: 'see `scripts/lib/render.mjs`' }],
    resolve: resolverFor(['scripts/lib/render.mjs']),
  });
  assert.deepEqual(f.filter((x) => x.level !== 'SKIP'), []);
  assert.equal(f.checked, 1);
});

test('a path that does not resolve at all FAILs and is named', () => {
  const f = checkPointers({
    ...base,
    surfaces: [{ label: 'README.md', text: 'see `scripts/lib/ghost.mjs`' }],
    resolve: resolverFor([]),
  });
  assert.equal(f.length, 1);
  assert.equal(f[0].level, 'FAIL');
  assert.match(f[0].msg, /scripts\/lib\/ghost\.mjs/);
});

test('EXISTS BUT UNTRACKED is a FAIL with its own message -- a clone does not have it', () => {
  const f = checkPointers({
    ...base,
    surfaces: [{ label: 'README.md', text: 'see `scripts/probe.mjs`' }],
    resolve: resolverFor([], ['scripts/probe.mjs']),
  });
  assert.equal(f.length, 1);
  assert.match(f[0].msg, /UNTRACKED/);
});

test('a citation under a GITIGNORED root FAILs without ever resolving it', () => {
  // The sharp case, and the chair's ruling in one assertion: from any other machine
  // "gitignored" and "does not exist" are indistinguishable, so the file being right
  // there on this disk changes nothing.
  const f = checkPointers({
    ...base,
    surfaces: [{ label: 'CONTRIBUTING.md', text: 'full record: `scratchpad/dispatch/x.md`' }],
    resolve: resolverFor([], ['scratchpad/dispatch/x.md']),
  });
  assert.equal(f.length, 1);
  assert.match(f[0].msg, /gitignored/);
});

test('historyOnly skips ordinary resolution but STILL fails a gitignored citation', () => {
  // Published history is never fixed forward -- a renamed file was a correct citation on
  // the day it was written. A scratchpad path never was, on any day.
  const f = checkPointers({
    ...base,
    surfaces: [{
      label: 'CHANGELOG.md',
      historyOnly: true,
      text: 'moved `scripts/old-name.mjs` -- record: `scratchpad/dispatch/y.md`',
    }],
    resolve: resolverFor([]),
  });
  assert.equal(f.length, 1, 'the renamed file must NOT fire');
  assert.match(f[0].msg, /scratchpad\/dispatch\/y\.md/);
  assert.equal(f.checked, 1, 'and the history surface contributes only its gitignored citation');
});

test('a first segment outside this repo is not this repo to be wrong about', () => {
  const f = checkPointers({
    ...base,
    surfaces: [{ label: 'README.md', text: 'upstream `actions/runner/src/Foo.cs` and `TheColliery/AGENTS.md`' }],
    resolve: resolverFor([]),
  });
  assert.deepEqual(f.filter((x) => x.level !== 'SKIP'), []);
  assert.equal(f.checked, 0);
});

test('a :LINE suffix and a trailing slash are punctuation, not part of the path', () => {
  const f = checkPointers({
    ...base,
    surfaces: [{ label: 'SECURITY.md', text: 'at `scripts/verify.mjs:158` in `scripts/lib/`' }],
    resolve: resolverFor(['scripts/verify.mjs', 'scripts/lib']),
  });
  assert.deepEqual(f.filter((x) => x.level !== 'SKIP'), []);
  assert.equal(f.checked, 2);
});

test('an unreadable surface is a NAMED skip, never a silent narrowing', () => {
  const f = checkPointers({
    ...base,
    surfaces: [{ label: 'gone.md', text: null }],
    resolve: resolverFor([]),
  });
  assert.equal(f.length, 1);
  assert.equal(f[0].level, 'SKIP');
  assert.match(f[0].msg, /gone\.md/);
});

test('no resolve() is a FAIL, never a silent pass -- the gate cannot answer its own question', () => {
  const f = checkPointers({ ...base, surfaces: [{ label: 'x.md', text: '`scripts/a.mjs`' }] });
  assert.equal(f.length, 1);
  assert.equal(f[0].level, 'FAIL');
});

test('PENDING_POINTERS suppresses a declared forward pointer', () => {
  const f = checkPointers({
    ...base,
    pending: [{ path: 'scripts/lib/later.mjs', reason: 'CWK-000 lands next unit' }],
    surfaces: [{ label: 'README.md', text: 'see `scripts/lib/later.mjs`' }],
    resolve: resolverFor([]),
  });
  assert.deepEqual(f.filter((x) => x.level !== 'SKIP'), []);
});

test('PENDING_POINTERS expires on the EVENT, both directions', () => {
  // now-resolves -> delete the entry
  const a = checkPointers({
    ...base,
    pending: [{ path: 'scripts/lib/later.mjs', reason: 'r' }],
    surfaces: [{ label: 'README.md', text: 'see `scripts/lib/later.mjs`' }],
    resolve: resolverFor(['scripts/lib/later.mjs']),
  });
  assert.equal(a.length, 1);
  assert.match(a[0].msg, /now resolves/);
  // nobody cites it -> delete the entry
  const b = checkPointers({
    ...base,
    pending: [{ path: 'scripts/lib/later.mjs', reason: 'r' }],
    surfaces: [{ label: 'README.md', text: 'nothing here' }],
    resolve: resolverFor([]),
  });
  assert.equal(b.length, 1);
  assert.match(b[0].msg, /no in-scope surface cites it/);
});

test('a PENDING_POINTERS entry with no reason is a bypass with no author', () => {
  const f = checkPointers({
    ...base,
    pending: [{ path: 'scripts/lib/later.mjs' }],
    surfaces: [{ label: 'README.md', text: 'see `scripts/lib/later.mjs`' }],
    resolve: resolverFor([]),
  });
  assert.ok(f.some((x) => /no reason/.test(x.msg)));
});

test('the shipped PENDING_POINTERS list is EMPTY, and that is a measurement', () => {
  // Every in-scope pointer resolves (67 of 67 at the CWK-075 r2 re-measurement), so
  // nothing has needed a declaration yet. If this grows, each entry carries its reason.
  assert.deepEqual(PENDING_POINTERS, []);
});

// ---------------------------------------------------------------------------
// CWK-075 round 2 — the two gaps the adopters' sweep surfaced, and the
// disambiguation that keeps closing them from raising noise.

test('a dot-dir that is OURS is checked; the dot-dir drop was a silent scope hole', () => {
  // `.claude-plugin/plugin.json` and `.github/workflows/ci.yml` are real TRACKED files of
  // ours, and the extractor used to drop every dot-first token before the checker ever saw
  // one. The decision is TREE knowledge, not text shape, so it lives here now.
  assert.deepEqual(
    pointerCandidates('see `.claude-plugin/plugin.json` and `.github/workflows/ci.yml`'),
    ['.claude-plugin/plugin.json', '.github/workflows/ci.yml'],
  );
  const f = checkPointers({
    ...base,
    ourRoots: new Set(['.claude-plugin']),
    surfaces: [{ label: 'README.md', text: 'see `.claude-plugin/no-such.json`' }],
    resolve: resolverFor([]),
  });
  assert.equal(f.length, 1);
  assert.match(f[0].msg, /\.claude-plugin\/no-such\.json/);
});

test('an AGENT INSTALL HOME is the scanned project tree, even when its root is ours', () => {
  // The live collision: `.github/skills` is Copilot's install home, `.github/workflows` is
  // ours. Same root, opposite owner, and nothing in the token says which — so the set is
  // supplied as DATA derived from the tool's own TARGETS map.
  const f = checkPointers({
    ...base,
    ourRoots: new Set(['.github']),
    agentHomes: new Set(['.github/skills']),
    surfaces: [{ label: 'README.md', text: 'copilot reads `.github/skills/`, we ship `.github/workflows/ci.yml`' }],
    resolve: resolverFor(['.github/workflows/ci.yml']),
  });
  assert.deepEqual(f.filter((x) => x.level !== 'SKIP'), [], 'the install home must not be flagged');
  assert.equal(f.checked, 1, 'and only the path that is actually ours is counted');
});

test('a token resolving BESIDE its citing file is in scope -- the silent-skip gap', () => {
  // `references/checks.md` cited from skills/drift-canary/SKILL.md was never checked at
  // all: `references` is not a repo top-level dir, so the repo-root-only test dropped it
  // without a word. A skipped citation is quieter than a wrongly-flagged one, and quieter
  // is what this whole class is about.
  const near = (dir, name) => dir === 'skills/drift-canary' && name === 'references';
  const good = checkPointers({
    ...base,
    hasEntry: near,
    surfaces: [{ label: 'skills/drift-canary/SKILL.md', text: 'see `references/checks.md`' }],
    resolve: resolverFor(['skills/drift-canary/references/checks.md']),
  });
  assert.deepEqual(good.filter((x) => x.level !== 'SKIP'), []);
  assert.equal(good.checked, 1, 'it must be CHECKED, not skipped');

  const bad = checkPointers({
    ...base,
    hasEntry: near,
    surfaces: [{ label: 'skills/drift-canary/SKILL.md', text: 'see `references/ghost.md`' }],
    resolve: resolverFor([]),
  });
  assert.equal(bad.length, 1);
  assert.match(bad[0].msg, /references\/ghost\.md/);
});

test('the citer-relative test is STRUCTURAL, so a foreign name stays out of scope', () => {
  // `log/slog` is a Go stdlib package named in canary prose. Nothing called `log` sits
  // beside the citer, so it is not in scope — the in-scope test never asks "does the whole
  // path resolve", which would make the gate unable to fire at all.
  const f = checkPointers({
    ...base,
    hasEntry: () => false,
    surfaces: [{ label: 'skills/telemetry-canary/references/checks.md', text: 'prefer `log/slog`' }],
    resolve: resolverFor([]),
  });
  assert.deepEqual(f.filter((x) => x.level !== 'SKIP'), []);
  assert.equal(f.checked, 0);
});

test('a `.` or `..` SEGMENT navigates and is not a pointer; a dot-DIR still is', () => {
  // Found by running the fix: `../` reached hasEntry(citerDir, '..'), which is always true,
  // and would have resolved OUT of the repo. Rejecting the segment closes the containment
  // hole and the false positive in one test.
  assert.deepEqual(
    pointerCandidates('`../` `../lib/x.mjs` `a/../b` `./x/y.md` `.github/workflows/ci.yml`'),
    ['.github/workflows/ci.yml'],
  );
});

test('a BACKSLASH is not a separator this gate reads -- the traversal DOTSEG could not see', () => {
  // CWK-075 r2 LOW-1. DOTSEG is segment-whole for `/`-delimited tokens, which left a
  // BACKSLASH-delimited segment invisible: the first case below survived every shape test,
  // took the ourRoots branch on its first segment, and under the WIN32 resolve algorithm
  // landed outside the repo. Naming the algorithm matters -- the imprecise version of
  // this sentence is what produced a test asserting a Windows fact as a universal, red
  // on all four Unix CI legs. Rejecting the character makes the invariant unconditional
  // instead of patching one miss into a scan that misses `\` by construction.
  const B = String.fromCharCode(92);
  const escape = 'scripts/..' + B + '..' + B + 'escape.md';
  assert.deepEqual(pointerCandidates('`' + escape + '`'), [],
    'a backslash-delimited traversal must not survive extraction');
  assert.deepEqual(pointerCandidates('`scripts' + B + 'lib' + B + 'x.mjs`'), []);
  assert.deepEqual(pointerCandidates('`a' + B + '..' + B + 'b`'), []);

  // And DOTSEG's own segment-whole property is UNTOUCHED: `..b` is a NAME, not a segment.
  assert.deepEqual(
    pointerCandidates('`a/..b/c.md` `.github/workflows/ci.yml` `scripts/lib/a.mjs`'),
    ['a/..b/c.md', '.github/workflows/ci.yml', 'scripts/lib/a.mjs'],
  );

  // WHY THE REJECTION MUST BE UNCONDITIONAL, asserted rather than argued -- and asserted
  // through BOTH named algorithms rather than the ambient one. Node ships path.win32 and
  // path.posix on every OS, so these two lines mean the same thing on ubuntu, macos and
  // windows alike; reading `path.resolve` instead makes the assertion say whatever the
  // RUNNER happens to be, which is exactly the platform-conditional shape LOW-1 exists to
  // remove. An absolute win32 root is used so neither line depends on the cwd.
  const W = path.win32, P = path.posix;
  assert.equal(W.resolve('C:' + B + 'repo', escape), 'C:' + B + 'escape.md',
    'where the backslash IS a separator, the token ESCAPES -- to the drive root, no less');
  assert.equal(P.resolve('/repo', escape), '/repo/scripts/..' + B + '..' + B + 'escape.md',
    'where it is a legal FILENAME character, the same token stays inside and is merely odd');
  // The two disagree, and that disagreement is the whole argument: a gate whose verdict
  // followed the host would be right on one and wrong on the other. The invariant the
  // shipped rule actually holds is the assertion at the top of this test -- REJECTED, on
  // every OS -- and it is reached by a regex over a string, touching no fs and no
  // process.platform. On POSIX that rejection is DEFENSIVE rather than necessary; refusing
  // to encode which one you are on is the point.
});

test('a gitignored top-level FILE is an ignored ROOT like any other (CWK-078)', () => {
  // The enumeration feeding ignoredRoots used to be dirs-only-non-hidden, so a gitignored
  // FILE never reached this branch and a citation into one fell out of scope SILENTLY.
  // The module was always able to answer; it was never asked. This pins the module half so
  // a future caller that narrows the enumeration again fails a test rather than going quiet.
  const f = checkPointers({
    ...base,
    ignoredRoots: new Set(['scratchpad', 'MEMORY.md']),
    surfaces: [{ label: 'README.md', text: 'see `MEMORY.md/some-section`' }],
    resolve: resolverFor([]),
  });
  assert.equal(f.length, 1);
  assert.match(f[0].msg, /gitignored/);
  assert.equal(f.checked, 1);
});

test('an agent-home ROOT must stay out of ignoredRoots, or correct ship-text FAILs', () => {
  // Measured on the live tree: feeding `.claude` and `.agents` to git check-ignore turns
  // TEN correct ship-text citations into FAILs -- gold-standard/SKILL.md, both commands,
  // README and CONTRIBUTING all name the USER's agent homes, which are gitignored HERE and
  // say nothing about the user's tree. The caller holds them out; this is the assertion
  // that says why, so the exclusion cannot be "cleaned up" as an oversight.
  const asIfFed = checkPointers({
    ...base,
    ignoredRoots: new Set(['.claude']),
    surfaces: [{ label: 'commands/stats.md', text: 'stamps live in `.claude/rules/`' }],
    resolve: resolverFor([]),
  });
  assert.equal(asIfFed.length, 1, 'feeding an agent-home root produces a FALSE positive');
  assert.match(asIfFed[0].msg, /gitignored/);

  const heldOut = checkPointers({
    ...base,
    ignoredRoots: new Set([]),
    surfaces: [{ label: 'commands/stats.md', text: 'stamps live in `.claude/rules/`' }],
    resolve: resolverFor([]),
  });
  assert.deepEqual(heldOut.filter((x) => x.level !== 'SKIP'), [],
    'held out, the same correct citation is simply out of scope');
});

// looksPathShaped (CWK-079 findings-back MEDIUM-1) -- feeds ONLY verify.mjs's
// ignore-probe candidate-root derivation. Measured against the gate's own live surface
// walk: 36 of a 51-segment population were not a directory or a file in ANY namespace
// (the false-proof "every candidate's first segment IS a directory by construction"
// this test replaces); appending one such name to .gitignore FAILed the shipped gate
// on a CHANGELOG arithmetic citation with an incoherent remedy.
test('looksPathShaped rejects the reviewer\'s own non-path exhibits', () => {
  for (const tok of ['chars/4', 'prefer/should', 'try/finally', 'js/insecure-temporary-file', 'js/file-system-race', 'log/slog']) {
    assert.equal(looksPathShaped(tok), false, `${tok} is not a path and must not reach the probe`);
  }
});

test('looksPathShaped accepts a filename-shaped path, incl. one with a :line ref', () => {
  for (const tok of ['dist-claude-ai/probe-target.md', 'scripts/lib/render.mjs', 'docs/x.md:12', 'commands/stats.md:12']) {
    assert.equal(looksPathShaped(tok), true, `${tok} is filename-shaped and must still reach the probe`);
  }
});

test('looksPathShaped accepts an explicit trailing-slash directory reference', () => {
  for (const tok of ['dist-claude-ai/', '.claude/rules/ecc/', 'scripts/lib/']) {
    assert.equal(looksPathShaped(tok), true, `${tok} ends in / and must still reach the probe`);
  }
});

// THE RESIDUE, both directions, pinned so a future edit cannot silently narrow or
// widen it without this test noticing -- named, not hidden, per the ruling that
// required it.
test('looksPathShaped residue: a trailing-slash token is accepted with no check on what precedes it', () => {
  assert.equal(looksPathShaped('os.tmpdir()/coalmine/'), true,
    'a function call ending in / still passes -- harmless in practice, named as residue');
});

test('looksPathShaped residue: an extensionless real path with no trailing slash no longer contributes its OWN root to discovery', () => {
  assert.equal(looksPathShaped('scripts/lib'), false,
    'excluded from DISCOVERY only -- see the two-plant pair below for why this is not the same as excluded from the CHECK');
});

// classifyCheckIgnoreResult (CWK-090 fix 1) -- the batched `git check-ignore --stdin`
// spawn's classification, pulled out pure so it is testable without fighting the OS to
// force a specific exit code through verify.mjs's own hardcoded args (a PATH-shim
// reproduction attempt did not even reach the shim on this box -- Node's spawnSync
// resolved straight past it to the real git.exe, despite `where.exe` confirming the
// identical PATH string finds the shim first; four malformed-input fixture shapes
// tried directly against a real repo -- `.gitignore` as a directory, `core.excludesFile`
// pointing at a directory or an EPERM'd symlink loop, a malformed glob, `.git/info/
// exclude` as a directory -- all degrade to exit 1, not a failure, on this git version).
// Every non-synthetic case below feeds the function a `ci` object taken from a REAL
// `git check-ignore --stdin` child process, not a hand-typed fake -- only the
// spawn-error case (git missing entirely) has no real subprocess to source from, since
// a missing git never reaches this call in production (verify.mjs's own `ls-files`
// pre-gate already SKIPs before this spawn fires).
function mkGitRepoForIgnoreProbe() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-ci-classify-'));
  const g = (args) => spawnSync('git', args, { cwd: tmp, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 'test@test.invalid']);
  g(['config', 'user.name', 'Test']);
  g(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(tmp, 'x.txt'), 'x');
  fs.writeFileSync(path.join(tmp, '.gitignore'), 'ignored-dir/' + NL);
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'baseline']);
  return tmp;
}

// THE PRE-FIX LOGIC, byte-copied from `git show HEAD:scripts/verify.mjs` at the moment
// this fix started (only `!ci.error` gated the "read stdout" branch). Replayed against a
// REAL non-0/1 result below to show what it actually did on that run: nothing -- any
// status other than a spawn error fell through and silently produced zero ignored roots.
function preFixLogic(ci) {
  const ignored = new Set();
  if (!ci.error && typeof ci.stdout === 'string') {
    for (const line of ci.stdout.split('\n')) {
      const t = line.trim();
      if (t) ignored.add(t.replace(/\/$/, ''));
    }
  }
  return ignored;
}

test('classifyCheckIgnoreResult: a REAL git check-ignore --stdin exit other than 0/1 (an unknown-option 129) is a FAIL, naming the status', () => {
  const tmp = mkGitRepoForIgnoreProbe();
  try {
    // CI-RED FIX (CWK-092): the original fixture passed `input:` alongside the bad
    // flag -- git rejects `--bogus-flag-xyz` and can exit BEFORE `spawnSync` finishes
    // writing that input to its stdin pipe, so on a slow/loaded runner the write loses
    // the race and Node reports a spawn-level EPIPE (`ci.error`) instead of delivering
    // the clean 129 exit this test wants. Measured on `ubuntu-latest node 24` CI: the
    // identical fixture passed at `210dd96` and failed here with EPIPE, on a commit
    // that never touched this test -- a flaky fixture, not a regression.
    //
    // Cure chosen: DETERMINISTIC, not tolerant of both doors. This spawn never needed
    // stdin content in the first place -- it exercises the non-0/1 EXIT-CODE branch of
    // classifyCheckIgnoreResult, not the stdout-parsing branch, so dropping `input:`
    // removes the write entirely: no write, no race, no EPIPE possible regardless of
    // runner speed. Verified locally, 10/10 runs: status 129, `ci.error` undefined,
    // every time (`ci.stdout` still comes back `''`, a string, not `undefined` --
    // `preFixLogic` below still runs its loop and still reproduces the bug on this
    // shape).
    const ci = spawnSync('git', ['check-ignore', '--stdin', '--bogus-flag-xyz'],
      { cwd: tmp, encoding: 'utf8' });
    assert.equal(ci.error, undefined,
      'this fixture is chosen to never race a stdin write -- an error here means the determinism assumption above no longer holds and needs re-checking, not silencing');
    assert.notEqual(ci.status, 0, 'this probe only proves anything if git actually took a non-0/1 exit');
    assert.notEqual(ci.status, 1, 'this probe only proves anything if git actually took a non-0/1 exit');

    // RED, against the pre-fix logic, replayed on this real failing run: it answers
    // "nothing is ignored" -- exactly the fail-open bug this fix closes, reproduced with
    // a genuine git process rather than asserted from a synthetic object.
    assert.deepEqual([...preFixLogic(ci)], [],
      'the pre-fix logic (only checking ci.error) silently produces an empty ignoredRoots on a real non-0/1 exit -- this IS the bug');

    // GREEN, against the fix: the same real result is classified as a failure by name.
    const verdict = classifyCheckIgnoreResult(ci);
    assert.equal(verdict.ok, false);
    assert.match(verdict.message, new RegExp(`exited ${ci.status}`));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('classifyCheckIgnoreResult: a REAL exit 0 (a fed path IS ignored) succeeds, stdout carries the match', () => {
  const tmp = mkGitRepoForIgnoreProbe();
  try {
    const ci = spawnSync('git', ['check-ignore', '--stdin'],
      { cwd: tmp, encoding: 'utf8', input: 'ignored-dir/probe\n' });
    assert.equal(ci.status, 0);
    const verdict = classifyCheckIgnoreResult(ci);
    assert.equal(verdict.ok, true);
    assert.match(verdict.stdout, /ignored-dir/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('classifyCheckIgnoreResult: a REAL exit 1 (nothing fed is ignored) succeeds -- 1 is not an error', () => {
  const tmp = mkGitRepoForIgnoreProbe();
  try {
    const ci = spawnSync('git', ['check-ignore', '--stdin'],
      { cwd: tmp, encoding: 'utf8', input: 'not-ignored-at-all/probe\n' });
    assert.equal(ci.status, 1);
    const verdict = classifyCheckIgnoreResult(ci);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.stdout.trim(), '');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('classifyCheckIgnoreResult: a genuine spawn error (git missing) is a FAIL naming the error message', () => {
  const verdict = classifyCheckIgnoreResult({ error: new Error('spawn git ENOENT'), status: null, stdout: null, stderr: null });
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /failed to spawn: spawn git ENOENT/);
});

// applyCheckIgnoreProbe (CWK-090 findings-back HIGH-1) -- the WIRING between
// classifyCheckIgnoreResult and the gate's own fail()/ignoredRoots. INSPECT mutated
// verify.mjs's old inline `if (!verdict.ok)` to `if (false)` -- behaviourally the
// pre-fix fail-open -- and the whole suite stayed byte-identically green, because
// nothing exercised that branch. This function is the EXACT code verify.mjs now
// calls (no duplicate), driven here with an injected `runCheckIgnore` so the
// status-128 branch is reachable without a real git process.
//
// THE PIN, MEASURED IN THIS ROOM ONLY (CWK-092 flow-back 1) -- a claim about THIS
// ROOM'S COVERAGE, never about the fix; re-derive rather than trust the numbers
// below, this room's own suite drifts. (INSPECT caught these rows shipped at
// `c6f0108` carrying the PARENT `210dd96`'s numbers under a label that claimed
// them as HEAD's -- the mechanism was sound, the transcription was not; re-derived
// in a throwaway clone at THIS commit before writing them here, not carried
// forward from a prior measurement):
//   run                                             tests / pass / fail / skipped
//   baseline (this file's HEAD)                        313  /  308 /   0  /   5
//   `if (!verdict.ok)` -> `if (false)`, whole suite     313  /  306 /   2  /   5
//   same mutation, all 5 tests driving applyCheckIgnoreProbe DELETED first
//                                                        308  /  303 /   0  /   5
// Row 2's TWO rednesses are the wiring test right below AND the failing-shapes
// loop test further down -- both drive `applyCheckIgnoreProbe` directly; row 3
// goes GREEN -- delete the five tests that drive the extraction and the mutation
// stops being caught AT ALL -- so in THIS repo the extraction, not merely the
// classification, is what closes the class. (Row 3's fail=0 is what proves it;
// its PASS count is not a cross-reference to anything -- an earlier version of
// this comment compared it to the pre-fix suite's own pass count, which coincided
// only until this unit's later tests broke the coincidence. Never re-add that
// cross-reference.) CoalTipple ran the IDENTICAL mutation in its own tree and it
// reddened through two pre-existing CWK-079-class integration tests instead,
// never touching its own DI'd extraction at all -- for THEIR tree the extraction
// was not the mechanism that closed it. An adopter re-runs this mutation in ITS
// OWN tree and states what reddens there; CoalTipple's non-reproduction is the
// measured counter-example this pin predicts, not an exception to explain away.
test('applyCheckIgnoreProbe: a non-0/1 verdict calls fail() and returns an empty Set -- WIRING, not just classification', () => {
  const failed = [];
  const fail = (msg) => failed.push(msg);
  const ignored = applyCheckIgnoreProbe({
    toProbe: ['totally-fake-root'],
    fail,
    runCheckIgnore: () => ({ status: 128, stderr: 'fatal: bad pattern', stdout: '' }),
  });
  assert.equal(failed.length, 1, 'fail() must be called exactly once');
  assert.match(failed[0], /exited 128/);
  assert.equal(ignored.size, 0, 'a run that answered nothing must record zero ignored roots');
});

test('applyCheckIgnoreProbe: an ok verdict returns the recovered root, stripped of its probe suffix', () => {
  const fail = () => { throw new Error('fail() must not be called on an ok verdict'); };
  const ignored = applyCheckIgnoreProbe({
    toProbe: ['dist'],
    fail,
    runCheckIgnore: () => ({ status: 0, stdout: `dist${PROBE_SUFFIX}\n`, stderr: '' }),
  });
  assert.deepEqual([...ignored], ['dist']);
});

test('applyCheckIgnoreProbe: an empty toProbe list never spawns, never fails, returns an empty Set', () => {
  const fail = () => { throw new Error('fail() must not be called'); };
  let spawned = false;
  const ignored = applyCheckIgnoreProbe({
    toProbe: [],
    fail,
    runCheckIgnore: () => { spawned = true; return { status: 0, stdout: '', stderr: '' }; },
  });
  assert.equal(spawned, false);
  assert.equal(ignored.size, 0);
});

test('applyCheckIgnoreProbe: probeSuffix DEFAULTS to the exported PROBE_SUFFIX (CWK-092 flow-back 3)', () => {
  const fail = () => { throw new Error('fail() must not be called on an ok verdict'); };
  let sentInput = null;
  const ignored = applyCheckIgnoreProbe({
    toProbe: ['dist'],
    fail,
    runCheckIgnore: (input) => { sentInput = input; return { status: 0, stdout: `dist${PROBE_SUFFIX}\n`, stderr: '' }; },
  });
  assert.equal(sentInput, `dist${PROBE_SUFFIX}\n`, 'with no probeSuffix override, the probe must be built from the exported constant');
  assert.deepEqual([...ignored], ['dist']);
});

// TEN SHAPES (CWK-092 flow-back 2 -- CoalFace's reviewer's table, adopted; the
// `ci.error`-FIRST ordering was ALREADY true here before this unit, per
// pointer-check.mjs's own `classifyCheckIgnoreResult` -- this is a TEST unit, not
// a code unit. The classifier tests above already cover three of these shapes with
// REAL git subprocesses, plus the spawn-error shape synthetically; the table below
// adds the six CoalFace found we lacked, synthetic because a real `error`-carrying
// spawn result never also carries a real
// `status: 0` -- Node's own child_process contract does not produce that pairing,
// so the only way to test the ORDERING is to construct the shape by hand.
const TEN_SHAPES = [
  { name: 'status 0, clean stdout', ci: { status: 0, stdout: 'dist/probe\n', stderr: '' }, ok: true },
  { name: 'status 1 (nothing ignored)', ci: { status: 1, stdout: '', stderr: '' }, ok: true },
  { name: 'status 128 + stderr', ci: { status: 128, stdout: '', stderr: 'fatal: bad pattern' }, ok: false },
  { name: 'status 128 WITH a string stdout', ci: { status: 128, stdout: 'dist/probe\n', stderr: 'fatal: bad pattern' }, ok: false },
  { name: 'status 2', ci: { status: 2, stdout: '', stderr: '' }, ok: false },
  { name: 'status null (killed by signal)', ci: { status: null, stdout: null, stderr: null }, ok: false },
  { name: 'status undefined', ci: { status: undefined, stdout: undefined, stderr: undefined }, ok: false },
  { name: 'ci.error ENOENT (git absent)', ci: { error: new Error('spawn git ENOENT'), status: null, stdout: null, stderr: null }, ok: false },
  // THE ROW THAT PROVES ORDER MATTERS -- error carried ALONGSIDE status: 0.
  { name: 'ci.error WITH status: 0 set -- error checked FIRST', ci: { error: new Error('spawn git EACCES'), status: 0, stdout: '', stderr: '' }, ok: false },
  { name: 'status 0, stdout not a string', ci: { status: 0, stdout: null, stderr: '' }, ok: true },
];

test('classifyCheckIgnoreResult: the ten-shape table -- ok verdict per shape, and a failing shape names what went wrong', () => {
  for (const { name, ci, ok } of TEN_SHAPES) {
    const verdict = classifyCheckIgnoreResult(ci);
    assert.equal(verdict.ok, ok, `shape "${name}" expected ok=${ok}, got ok=${verdict.ok}`);
    if (!ok) {
      assert.equal(typeof verdict.message, 'string', `shape "${name}" must name what went wrong`);
      assert.ok(verdict.message.length > 0, `shape "${name}"'s message must not be empty`);
    }
  }
});

// RED-FIRST, via an inline counterfactual (not a source mutation): a STATUS-FIRST
// predicate -- the shape a room could plausibly write, checking `ci.status`
// before ever looking at `ci.error` -- reads the error+status:0 fixture as
// SUCCESS. This is what proves the ORDERING matters, not merely the classifier's
// existing behaviour: our real function already answers `ok: false` on this row
// (asserted above), and a status-first sibling would have answered `ok: true` on
// the identical input.
function statusFirstClassify(ci) {
  if (ci.status === 0 || ci.status === 1) {
    return { ok: true, stdout: typeof ci.stdout === 'string' ? ci.stdout : '' };
  }
  const stderrLine = typeof ci.stderr === 'string' ? ci.stderr.split('\n')[0].trim() : '';
  return { ok: false, message: `git check-ignore --stdin exited ${ci.status}${stderrLine ? ` -- ${stderrLine}` : ''}` };
}

test('classifyCheckIgnoreResult: the error+status:0 row -- a status-first predicate reads it as SUCCESS; ours does not', () => {
  const row = TEN_SHAPES.find((s) => s.name.startsWith('ci.error WITH status: 0'));
  assert.equal(classifyCheckIgnoreResult(row.ci).ok, false, 'the real, error-first classifier must reject this shape');
  assert.equal(statusFirstClassify(row.ci).ok, true,
    'a status-first predicate reads the identical shape as ok -- this is the class the ordering guards against, not a hypothetical');
});

test('applyCheckIgnoreProbe: on every FAILING shape of the ten, fail() fires exactly once and the returned Set is empty', () => {
  for (const { name, ci, ok } of TEN_SHAPES) {
    if (ok) continue;
    const failed = [];
    const ignored = applyCheckIgnoreProbe({
      toProbe: ['totally-fake-root'],
      fail: (msg) => failed.push(msg),
      runCheckIgnore: () => ci,
    });
    assert.equal(failed.length, 1, `shape "${name}": fail() must be called exactly once`);
    assert.equal(ignored.size, 0, `shape "${name}": a failing verdict must record zero ignored roots`);
  }
});

// DEFAULT_SURFACE_PLAN + collectSurfaces (CWK-090 fix 3) -- the walked-surface
// assembly, DECLARED as data instead of five hardcoded verify.mjs for-loops
// (CoalHearth's finding: "scripts/ comments are a walked surface" is THIS room's own
// variable, not the flock's). Tested purely, with a fake in-memory `io` -- no real
// filesystem, so this exercises the plan/collector contract directly rather than
// re-proving verify.mjs's own wiring (render.test.mjs already does that for the
// byte-identical-behaviour half).
test('DEFAULT_SURFACE_PLAN: the shipped default declares the scripts comments row with a non-empty why', () => {
  const row = DEFAULT_SURFACE_PLAN.find((r) => r.kind === 'comments' && r.root === 'scripts');
  assert.ok(row, 'the scripts comments row must exist in the shipped default plan');
  assert.equal(typeof row.why, 'string');
  assert.ok(row.why.length > 0, 'a declared row without a why is the same defect as no declaration at all');
});

function fakeIo(files) {
  const commentLines = (src) => src.split('\n').filter((l) => /^\s*(\/\/|\*)/.test(l)).join('\n');
  const hashComments = (src) => src.split('\n').filter((l) => /^\s*#/.test(l)).join('\n');
  return {
    join: (a, b) => `${a}/${b}`,
    read: (p) => (files.has(p) ? files.get(p) : null),
    rel: (p) => p.replace(/^REPO\//, ''),
    commentLines,
    hashComments,
    walkMd: (dir) => [...files.keys()].filter((p) => p.startsWith(dir + '/') && p.endsWith('.md')),
    walkSrc: (dir, keep) => [...files.keys()].filter((p) => p.startsWith(dir + '/') && keep(p.slice(p.lastIndexOf('/') + 1))),
  };
}

test('collectSurfaces + checkPointers: a citation reachable ONLY through the scripts comments row FAILs under the default plan and is unseen -- not just un-failing -- once that row is narrowed away', () => {
  const files = new Map([
    // The ghost citation lives ONLY inside a `//` comment, in a file the `scripts`
    // comments row is the sole reader of (the sibling `hash-comments` row over the
    // same `scripts` root filters on `.ps1`, so it never sees a `.mjs` file).
    ['REPO/scripts/foo.mjs', '// see `scripts/ghost-target.md` for the real shape\nconst x = 1;\n'],
  ]);
  const io = fakeIo(files);
  const resolveAlwaysMissing = () => 'missing';
  const opts = { ourRoots: new Set(['scripts']), agentHomes: new Set(), ignoredRoots: new Set(), hasEntry: () => false, resolve: resolveAlwaysMissing };

  // RED against the DEFAULT plan first: the citation is read and genuinely FAILs.
  const defaultSurfaces = collectSurfaces('REPO', DEFAULT_SURFACE_PLAN, io);
  const scriptsSurface = defaultSurfaces.find((s) => s.label === 'scripts/foo.mjs');
  assert.ok(scriptsSurface, 'the scripts comments row must have surfaced scripts/foo.mjs under the default plan');
  assert.match(scriptsSurface.text, /ghost-target\.md/, 'the comment line carrying the citation must be included, not stripped');
  const defaultFindings = checkPointers({ surfaces: defaultSurfaces, ...opts });
  assert.ok(defaultFindings.some((f) => f.level === 'FAIL' && f.msg.includes('ghost-target.md')),
    'the default plan must catch the dead citation -- this is the RED case, proven before narrowing');

  // Now narrow: delete the scripts comments row, per the module's own narrowing form
  // ("a room that walks fewer surfaces deletes the row ... never by editing the walk").
  const narrowed = DEFAULT_SURFACE_PLAN.filter((r) => !(r.kind === 'comments' && r.root === 'scripts'));
  const narrowedSurfaces = collectSurfaces('REPO', narrowed, io);
  assert.ok(!narrowedSurfaces.some((s) => s.label === 'scripts/foo.mjs'),
    'scripts/foo.mjs must not be surfaced at all once its only reading row is deleted -- narrowing stops the READ, not merely the verdict');
  const narrowedFindings = checkPointers({ surfaces: narrowedSurfaces, ...opts });
  assert.ok(!narrowedFindings.some((f) => f.msg.includes('ghost-target.md')),
    'the same citation that FAILed under the default plan must produce no finding at all under the narrowed one');
});
