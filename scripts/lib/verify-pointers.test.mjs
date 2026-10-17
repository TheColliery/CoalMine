// CoalMine verify.mjs 2.11 POINTER gate tests (CWK-075, R19, R20, MEDIUM-2; FIX 2 and git-unavailable are in verify-pointers-git.test.mjs) — node:test, zero dependencies.
// Run: node --test scripts/lib/verify-pointers.test.mjs
// 15b5b (CI red fix): split out of render.test.mjs, tests verbatim, so no one file nears the per-file clock on node 22 (testing.md finite-clock MUST).

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

// verify.mjs 2.11 POINTER gate (CWK-075). Task #38's H1 for the FOURTH time, applied on
// the same pass rather than a later one: pointer-check.test.mjs is fully non-vacuous on
// its own and proves nothing about whether block 2.11 is WIRED. Reverting the block's
// call to `const findings = [];` leaves the whole suite green with nothing to catch it.
//
// Needs a REAL git repo, unlike the 2.9/2.10 fixtures above: the pointer gate asks git
// which paths are TRACKED and which roots are IGNORED, so a plain fs.cpSync copy with no
// .git would only ever hit its own "git unavailable" SKIP and the assertion would pass
// for the wrong reason. Verified by building it both ways during RED-first.
//
// TWO plants, because the gate has two independently-reachable FAIL branches and one
// plant would leave the other unguarded:
//   (a) a citation that does not resolve at all;
//   (b) a citation under a GITIGNORED root -- the sharp case, decided WITHOUT resolving,
//       and the one the chair's ruling is actually about.
test('verify.mjs 2.11 pointers: a dead pointer and a gitignored citation each fail the WHOLE gate -- proves the wiring, not just the module', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-pointer-'));
  try {
    for (const d of ['scripts', 'skills', 'hooks', 'plugin', '.claude-plugin', 'commands', 'agents', 'platform-configs', 'alt']) {
      const src = path.join(repo, d);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, d), { recursive: true });
    }
    for (const d of ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'PRIVACY.md', 'CHANGELOG.md']) {
      fs.copyFileSync(path.join(repo, d), path.join(tmp, d));
    }
    // The fixture must gitignore scratchpad/ for plant (b) to be reachable at all -- the
    // gate derives ignored roots from git, never from a hardcoded name.
    // A gitignored DIR and a gitignored FILE. The file is CWK-078: the enumeration fed to
    // git check-ignore used to be dirs-only-non-hidden, so a top-level gitignored FILE was
    // never probed and a citation into one fell out of scope silently.
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'scratchpad/' + NL + 'LOCAL-NOTES.md' + NL);
    fs.mkdirSync(path.join(tmp, 'scratchpad'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'scratchpad', 'probe.md'), 'a throwaway probe' + NL);
    fs.writeFileSync(path.join(tmp, 'LOCAL-NOTES.md'), 'machine-local' + NL);

    const git = (args) => {
      const r = spawnSync('git', args, { cwd: tmp, env: gitEnv(path.dirname(tmp)), encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.error?.message}`);
      return r.stdout;
    };
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@test.invalid']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'commit.gpgsign', 'false']);
    // R14: `git commit` starts `git maintenance run --auto` as its own process (b4194b3, measured); it races this fixture's cleanup, so the fixture turns it off.
    git(['config', 'maintenance.auto', 'false']);
    git(['config', 'gc.auto', '0']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'baseline']);

    const run = verifyRun(t, tmp);

    // The clean copy must reach the gate and be GREEN -- otherwise the FAILs below could
    // be this fixture's own noise rather than the plants.
    const clean = run();
    assert.match(clean.stdout, /pointers:\s*\n\s*ok/,
      `the 2.11 block must be present and green on a clean copy, got:${NL}${clean.stdout}${clean.stderr}`);

    // (a) a pointer into OUR OWN tree that resolves to nothing.
    fs.appendFileSync(path.join(tmp, 'commands', 'stats.md'),
      NL + 'See `scripts/lib/no-such-module.mjs` for the details.' + NL);
    // (b) a citation under the gitignored root -- the file EXISTS on this disk, which is
    // exactly why the resolution check alone would miss it.
    fs.appendFileSync(path.join(tmp, 'agents', 'coalmine-scanner.md'),
      NL + 'Full record: `scratchpad/probe.md`.' + NL);
    // (c) a citation into a gitignored FILE -- the CWK-078 plant. Only construction that
    // exists: a token needs a directory component to survive the shape layer, so reaching
    // a top-level FILE means descending into it. Unrealistic as prose, and exactly why
    // the live exposure measured zero -- but the enumeration hole is real either way, and
    // an adopting room's tree may differ. The descended-into segment carries an extension
    // (CWK-079 findings-back MEDIUM-1's `looksPathShaped` shape test) -- an extensionless
    // final segment would now be excluded from the ignore-probe by design, a different
    // and unrelated class from the one this plant exists to prove.
    fs.appendFileSync(path.join(tmp, 'commands', 'update.md'),
      NL + 'Full reasoning: `LOCAL-NOTES.md/decision.txt`.' + NL);
    // (d) CWK-078 LOW-1: a TRACKED file in NEITHER the walked nor the declared-out list.
    // The CoalWash defect -- the pass line reads as coverage while a surface goes unread.
    // It must FAIL by name, independent of whether it carries a bad pointer at all.
    fs.writeFileSync(path.join(tmp, 'UNCLASSIFIED.txt'), 'no gate owns me' + NL);
    git(['add', '-A']);

    const r = run();
    // NOT `assert.equal(r.status, 1)`: measured during RED-first, an unwired 2.11 still
    // exits 1 because the plants make plugin/ stale, so a status assertion passes for a
    // reason that has nothing to do with this gate -- the exact trap the 2.10 test above
    // records. Assert a FAIL line INSIDE the pointers block, which only this gate can
    // produce. This was a doesNotMatch on "pointers: then ok" until CWK-078 made the
    // probe-reach line print on EVERY run, green or red -- so the block now opens with an
    // ok line even when it fails, and the old form asserted a shape that had moved.
    assert.match(r.stdout, /pointers:\n(?:  (?:ok|--) .*\n)*  FAIL /,
      'the pointers block itself must go red, not merely the run');
    assert.match(r.stdout, /FAIL commands[\/]stats\.md cites `scripts\/lib\/no-such-module\.mjs`/,
      'the gate must name the citing surface AND the pointer it could not resolve');
    assert.match(r.stdout, /FAIL agents[\/]coalmine-scanner\.md cites `scratchpad\/probe\.md`.*gitignored/,
      'and an EXISTING file under a gitignored root must fail as undurable, not pass as present');
    assert.match(r.stdout, /FAIL commands[\/]update\.md cites `LOCAL-NOTES\.md\/decision\.txt`.*gitignored/,
      'a gitignored top-level FILE must be probed too -- dirs-only-non-hidden was the CWK-078 hole');
    assert.match(r.stdout, /gitignored-root citations: \d+ distinct first segment/,
      'and the probe reach must be PRINTED, so a short enumeration is visible not discoverable');
    assert.match(r.stdout, /FAIL surface accounting: 1 tracked file\(s\) in NEITHER.*UNCLASSIFIED\.txt/,
      'a tracked file owned by no list must FAIL by name -- exhaustive by construction, not by luck');
  } finally {
    removeTree(tmp);
  }
});

// The CHANGELOG's TOP entry is its first "## [" heading, whatever it is called: [Unreleased] between releases, a dated version from a release commit until the next
// [Unreleased] opens. A fixture that plants into "## [Unreleased]" by name plants nothing on a released tree and its assertion fails (09a bounce 2: no release could
// be committed). So R19 and R20 find the top entry by structure and run under BOTH headings.
const TOP_HEADINGS = ['## [Unreleased]', '## [99.0.0] - 2026-01-01'];
const topEntryEnd = (text) => text.indexOf(NL, text.search(/^## \[/m)) + NL.length;
const withTopHeading = (text, heading) => text.slice(0, text.search(/^## \[/m)) + heading + NL + text.slice(topEntryEnd(text));
const plantInTop = (text, plant) => { const end = topEntryEnd(text); return text.slice(0, end) + plant + text.slice(end); };

// R19: the CHANGELOG's TOP entry is checked in full by the REAL gate (ONE FLOCK ONE COLOR with CoalFace 586e0cd). Two
// shapes, and only the second passed before: a new [Unreleased] entry citing a gitignored scratchpad/ path (the gitignored-root
// check already covered every entry) and one citing a path that resolves to nothing (the resolve check was skipped for the
// whole file). A released entry citing the same dead path stays exempt -- history is never fixed forward.
test('verify.mjs 2.11 pointers: R19 -- a dead path in the CHANGELOG top entry FAILs the real gate, the same path in a released entry does not', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-pointer-chlog-'));
  const TICK = String.fromCharCode(96);
  try {
    for (const d of ['scripts', 'skills', 'hooks', 'plugin', '.claude-plugin', 'commands', 'agents', 'platform-configs', 'alt']) {
      const src = path.join(repo, d);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, d), { recursive: true });
    }
    for (const d of ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'PRIVACY.md', 'CHANGELOG.md']) {
      fs.copyFileSync(path.join(repo, d), path.join(tmp, d));
    }
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'scratchpad/' + NL);
    fs.mkdirSync(path.join(tmp, 'scratchpad'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'scratchpad', 'probe.md'), 'a throwaway probe' + NL);
    const git = (args) => {
      const r = spawnSync('git', args, { cwd: tmp, env: gitEnv(path.dirname(tmp)), encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.error?.message}`);
      return r.stdout;
    };
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@test.invalid']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['config', 'maintenance.auto', 'false']);
    git(['config', 'gc.auto', '0']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'baseline']);
    const run = verifyRun(t, tmp);
    const chlog = path.join(tmp, 'CHANGELOG.md');
    const live = fs.readFileSync(chlog, 'utf8');
    for (const heading of TOP_HEADINGS) {
      const base = withTopHeading(live, heading);
      const second = base.indexOf(NL + '## [', base.search(/^## \[/m) + 1);
      assert.ok(second > 0, heading + ': the CHANGELOG has a top entry and at least one released entry');
      fs.writeFileSync(chlog, base);
      git(['add', '-A']);
      const lines = (r) => (r.stdout.match(/^\s*FAIL CHANGELOG\.md.*$/gm) || []);
      assert.deepEqual(lines(run()), [], heading + ': a clean copy has no CHANGELOG finding -- otherwise the plants below prove nothing');

      const cite = (p) => NL + 'Planted: see ' + TICK + p + TICK + '.' + NL;
      const withTop = (p) => plantInTop(base, cite(p));
      const afterHeading = base.indexOf(NL, second + 1); // end of the SECOND heading line: the plant lands INSIDE the released entry
      const withReleased = (p) => base.slice(0, afterHeading) + NL + cite(p) + base.slice(afterHeading);

      // shape 2: the dead path, top entry. Red before R19.
      fs.writeFileSync(chlog, withTop('scripts/lib/no-such-module.mjs'));
      git(['add', '-A']);
      const top = lines(run());
      assert.equal(top.length, 1, heading + ': the top entry citing a path that resolves to nothing must FAIL, got: ' + JSON.stringify(top));
      assert.ok(top[0].includes('scripts/lib/no-such-module.mjs') && top[0].includes('does not resolve'));

      // shape 1: a gitignored scratchpad path, top entry. Held before R19 too.
      fs.writeFileSync(chlog, withTop('scratchpad/probe.md'));
      git(['add', '-A']);
      const ign = lines(run());
      assert.equal(ign.length, 1, heading + ': the top entry citing a gitignored path must FAIL, got: ' + JSON.stringify(ign));
      assert.ok(ign[0].includes('gitignored'));

      // released history: the same dead path is NOT a finding.
      fs.writeFileSync(chlog, withReleased('scripts/lib/no-such-module.mjs'));
      git(['add', '-A']);
      assert.deepEqual(lines(run()), [], heading + ': a released entry citing a dead path stays exempt');
    }
  } finally {
    removeTree(tmp);
  }
});

// R20 LOW-F, through the REAL gate: a '## [' heading quoted inside a code fence of the CHANGELOG top entry must not end
// the checked span, so a dead path below the fence FAILs. It passed before the split became fence-aware.
test('verify.mjs 2.11 pointers: R20 -- a version heading quoted in a code fence of the CHANGELOG top entry does not exempt the dead path below it', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-pointer-fence-'));
  const TICK = String.fromCharCode(96);
  try {
    for (const d of ['scripts', 'skills', 'hooks', 'plugin', '.claude-plugin', 'commands', 'agents', 'platform-configs', 'alt']) {
      const src = path.join(repo, d);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, d), { recursive: true });
    }
    for (const d of ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'PRIVACY.md', 'CHANGELOG.md']) {
      fs.copyFileSync(path.join(repo, d), path.join(tmp, d));
    }
    const git = (args) => {
      const r = spawnSync('git', args, { cwd: tmp, env: gitEnv(path.dirname(tmp)), encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.error?.message}`);
      return r.stdout;
    };
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@test.invalid']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['config', 'maintenance.auto', 'false']);
    git(['config', 'gc.auto', '0']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'baseline']);
    const run = verifyRun(t, tmp);
    const lines = (r) => (r.stdout.match(/^\s*FAIL CHANGELOG\.md.*$/gm) || []);
    const chlog = path.join(tmp, 'CHANGELOG.md');
    const live = fs.readFileSync(chlog, 'utf8');
    for (const heading of TOP_HEADINGS) {
      const base = withTopHeading(live, heading);
      fs.writeFileSync(chlog, base);
      git(['add', '-A']);
      assert.deepEqual(lines(run()), [], heading + ': a clean copy has no CHANGELOG finding -- otherwise the plant below proves nothing');
      const fence = TICK + TICK + TICK;
      const plant = NL + fence + NL + '## [9.9.9] - quoted example' + NL + fence + NL + NL + 'Planted: see ' + TICK + 'scripts/lib/no-such-module.mjs' + TICK + '.' + NL;
      fs.writeFileSync(chlog, plantInTop(base, plant));
      git(['add', '-A']);
      const found = lines(run());
      assert.equal(found.length, 1, heading + ': the dead path below the fence must FAIL, got: ' + JSON.stringify(found));
      assert.ok(found[0].includes('scripts/lib/no-such-module.mjs') && found[0].includes('does not resolve'));
    }
  } finally {
    removeTree(tmp);
  }
});

// verify.mjs 2.11 pointers, MEDIUM-2 (CWK-079 findings-back round 2): `looksPathShaped`
// gates DISCOVERY only, never JUDGEMENT -- an extensionless citation under a gitignored
// root is not exempt from the check, it is exempt only from contributing its OWN root
// to the set the check runs against. Proven with a two-plant pair: the SAME
// extensionless citation, same tree, same .gitignore, alone (silent) vs. beside an
// unrelated path-shaped citation under the same root (both FAIL). Uses a fixture-only
// directory name never mentioned as a literal anywhere else in this repo's own prose --
// deliberately not the NAMED BOUND's own worked example, so this test's own comments
// stay inert against every other gitignored root this tree actually carries.
test('verify.mjs 2.11 pointers: MEDIUM-2 -- an extensionless citation under a gitignored root is checked non-locally, not exempt', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-pointer-nonlocal-'));
  try {
    for (const d of ['scripts', 'skills', 'hooks', 'plugin', '.claude-plugin', 'commands', 'agents', 'platform-configs', 'alt']) {
      const src = path.join(repo, d);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, d), { recursive: true });
    }
    for (const d of ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'PRIVACY.md', 'CHANGELOG.md']) {
      fs.copyFileSync(path.join(repo, d), path.join(tmp, d));
    }
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'throwaway-build/' + NL);

    const git = (args) => {
      const r = spawnSync('git', args, { cwd: tmp, env: gitEnv(path.dirname(tmp)), encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.error?.message}`);
      return r.stdout;
    };
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@test.invalid']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'commit.gpgsign', 'false']);
    // R14: `git commit` starts `git maintenance run --auto` as its own process (b4194b3, measured); it races this fixture's cleanup, so the fixture turns it off.
    git(['config', 'maintenance.auto', 'false']);
    git(['config', 'gc.auto', '0']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'baseline']);

    const run = verifyRun(t, tmp);

    // PLANT A alone: an extensionless citation under the gitignored root. Shape-rejected
    // at discovery, so the fixture's own live gate must not FAIL it while nothing else
    // shares the root.
    fs.appendFileSync(path.join(tmp, 'commands', 'stats.md'),
      NL + 'Notes: `throwaway-build/notes`.' + NL);
    git(['add', '-A']);
    const alone = run();
    assert.doesNotMatch(alone.stdout, /throwaway-build/,
      `plant A alone must stay silent -- extensionless, discovery-rejected, got:${NL}${alone.stdout}`);

    // PLANT B, same tree, unrelated file: a path-shaped citation under the SAME root.
    // This one alone is enough to put the root in `ignoredRoots` -- and once it is
    // there, `checkPointers` judges EVERY token sharing that root, including plant A's.
    fs.appendFileSync(path.join(tmp, 'commands', 'update.md'),
      NL + 'Reference: `throwaway-build/readme.md`.' + NL);
    git(['add', '-A']);
    const both = run();
    assert.match(both.stdout, /FAIL commands[\/]stats\.md cites `throwaway-build\/notes`.*gitignored/,
      'plant A must now FAIL -- the extensionless citation was never exempt from the check, only from discovering its own root');
    assert.match(both.stdout, /FAIL commands[\/]update\.md cites `throwaway-build\/readme\.md`.*gitignored/,
      'plant B, the path-shaped citation that armed the root, must FAIL too');
  } finally {
    removeTree(tmp);
  }
});
