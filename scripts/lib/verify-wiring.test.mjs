// CoalMine verify.mjs gate wiring tests (stale dist, description cap, 2.10 config read-path, 2.9 config-keys, 2.8 dist-changelog) — node:test, zero dependencies.
// Run: node --test scripts/lib/verify-wiring.test.mjs
// 15b5b (CI red fix): split out of render.test.mjs, tests verbatim, so no one file nears the per-file clock on node 22 (testing.md finite-clock MUST).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listSkills } from './render.mjs';
import { gitEnv } from './git-env.mjs';

const NL = String.fromCharCode(10);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
test('verify.mjs negative path: stale dist fails, clean copy passes', () => {
  const tmp = mkTmp('cm-verify-');
  try {
    for (const d of ['skills', 'plugin', 'scripts', '.claude-plugin', 'hooks', 'agents', 'commands', 'alt', 'plugin-src']) {
      fs.cpSync(path.join(repo, d), path.join(tmp, d), { recursive: true });
    }
    const run = () => spawnSync(process.execPath, [path.join(tmp, 'scripts', 'verify.mjs')], { encoding: 'utf8' });

    const clean = run();
    assert.equal(clean.status, 0, `pristine copy must PASS, got:\n${clean.stdout}${clean.stderr}`);

    const firstSkill = listSkills(path.join(tmp, 'skills'))[0];
    fs.appendFileSync(path.join(tmp, 'skills', firstSkill, 'SKILL.md'), '\nstale-byte\n');
    const stale = run();
    assert.equal(stale.status, 1, 'stale dist must FAIL with exit 1');
    assert.ok(stale.stdout.includes('STALE'), 'failure output names the stale skill');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// board #64: the DESC_CAP gate (section 1.5) walked skills/*/SKILL.md + commands/*.md
// frontmatter only — .claude-plugin/plugin.json's OWN description field was unchecked,
// so it could silently exceed 1024 chars (CoalLedger shipped one at 1067 before a human
// caught it). Section 1.6 closes that; this proves it fires, same tmp-copy pattern as
// the stale-dist test above.
test('verify.mjs negative path: an over-cap .claude-plugin/plugin.json description FAILs the gate', () => {
  const tmp = mkTmp('cm-verify-');
  try {
    for (const d of ['skills', 'plugin', 'scripts', '.claude-plugin', 'hooks', 'agents', 'commands', 'alt', 'plugin-src']) {
      fs.cpSync(path.join(repo, d), path.join(tmp, d), { recursive: true });
    }
    const run = () => spawnSync(process.execPath, [path.join(tmp, 'scripts', 'verify.mjs')], { encoding: 'utf8' });

    const clean = run();
    assert.equal(clean.status, 0, `pristine copy must PASS, got:\n${clean.stdout}${clean.stderr}`);

    const pluginJsonPath = path.join(tmp, '.claude-plugin', 'plugin.json');
    const pj = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
    pj.description = 'x'.repeat(1025);
    fs.writeFileSync(pluginJsonPath, JSON.stringify(pj, null, 2) + '\n', 'utf8');

    const over = run();
    assert.equal(over.status, 1, 'a plugin.json description over 1024 chars must FAIL with exit 1');
    assert.match(over.stdout, /\.claude-plugin\/plugin\.json: description 1025 chars exceeds the 1024-char cap/,
      'the FAIL line names the file, the exact length, and the cap');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// INSPECT task #38, HIGH: dist-changelog's own 11 unit tests all call checkDistChangelog
// directly — none of them proves it is actually WIRED into verify.mjs. Reverting the 2.8
// block to `const findings = [];` left the whole suite green (167/165/0/2) with nothing to
// catch it. This asserts the COMPOSITION, the same way the stale-dist test above asserts
// verify.mjs's dist-sync composition rather than just render.mjs's own rendering logic.
//
// Needs a REAL git repo with a real tag (the plain fs.cpSync copy above has no .git at
// all, so checkDistChangelog would only ever hit the "not a git repository" SKIP there) —
// a second, separate tmp fixture, git-initialized and tagged to match the copied
// CHANGELOG.md's own top heading (`v3.14.0`, this room's real last tag at fixture-build
// time) so the heading-vs-tag compare exercises the same real branch it does live.
//
// The dist mutation bumps `version` in BOTH `.claude-plugin/plugin.json` and its
// `plugin/` copy identically — keeps verify.mjs's own source-vs-dist sync check green
// (same technique proven clean at the live tree during this task's manual RED-first
// probe) so only checkDistChangelog's tag-diff fires, isolating the wiring assertion
// from every OTHER thing verify.mjs checks.
test('verify.mjs 2.10 config read-path: a bare-read line fails the WHOLE gate -- proves the wiring, not just the module', () => {
  // INSPECT MEDIUM-3: task #38's H1 for the THIRD time. Unwiring block 2.10's call left the
  // suite fully green -- a module can be non-vacuous while its wiring is dead. Block 2.9's own
  // wiring test is the shape copied here.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-readpath-'));
  try {
    for (const d of ['scripts', 'scripts/lib', 'skills', 'hooks', '.claude-plugin']) {
      fs.mkdirSync(path.join(tmp, d), { recursive: true });
    }
    for (const d of ['scripts', 'skills', 'hooks', 'plugin', '.claude-plugin', 'commands', 'platform-configs']) {
      const src = path.join(repo, d);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, d), { recursive: true });
    }
    fs.copyFileSync(path.join(repo, 'README.md'), path.join(tmp, 'README.md'));
    // Plant the DEFECT in a NEW command with NO rail of its own. Appending to stats.md would
    // NOT be a defect and the first draft of this test wrongly expected it to be: that file
    // carries a UNIVERSAL rail, which by design vouches for every mention in it. The gate was
    // right and the test was wrong -- caught by reading the gate's own `ok` line rather than
    // trusting the non-zero exit, which unrelated fixture FAILs were supplying anyway.
    fs.writeFileSync(path.join(tmp, 'commands', 'planted.md'),
      '---' + NL + 'description: planted' + NL + '---' + NL + 'honor `.coalmine.json` `noSuchRail` if set.' + NL);
    // Second plant, in the FOURTH surface class -- these ship into other agents' config homes,
    // so a bare read here reaches an agent we never see.
    fs.mkdirSync(path.join(tmp, 'platform-configs'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'platform-configs', 'planted.template'),
      'honor `.coalmine.json` at the project root if present' + NL);

    const r = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'verify.mjs')], { encoding: 'utf8' });
    assert.equal(r.status, 1, 'a bare-read line must fail the whole gate, not just a module');
    assert.match(r.stdout, /FAIL commands[\/]planted\.md:\d+/,
      'the gate must name the file AND THE LINE -- per-mention granularity, not per-file');
    assert.match(r.stdout, /FAIL platform-configs[\/]planted\.template:\d+/,
      'and platform-configs/ must be IN the surface set -- the class both sweeps missed (MEDIUM-1)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('verify.mjs 2.9 config-keys: an undeclared key named in a SKILL.md fails the WHOLE gate -- proves the wiring, not just the module', () => {
  // Task #38's H1, applied on the same pass rather than a later one: a module can be fully
  // green while its verify.mjs block is not wired at all, and no unit test can tell.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cfgkeys-'));
  try {
    for (const d of ['scripts', 'scripts/lib', 'skills', 'hooks', '.claude-plugin']) {
      fs.mkdirSync(path.join(tmp, d), { recursive: true });
    }
    fs.cpSync(path.join(repo, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
    fs.cpSync(path.join(repo, 'skills'), path.join(tmp, 'skills'), { recursive: true });
    fs.cpSync(path.join(repo, 'hooks'), path.join(tmp, 'hooks'), { recursive: true });
    fs.cpSync(path.join(repo, 'plugin'), path.join(tmp, 'plugin'), { recursive: true });
    fs.cpSync(path.join(repo, '.claude-plugin'), path.join(tmp, '.claude-plugin'), { recursive: true });
    fs.copyFileSync(path.join(repo, 'README.md'), path.join(tmp, 'README.md'));
    // Plant the DEFECT: a key named in a doc that the schema does not carry.
    const sk = path.join(tmp, 'skills', 'rot-canary', 'SKILL.md');
    fs.appendFileSync(sk, String.fromCharCode(10) + 'Set `noSuchTunable` to true.' + String.fromCharCode(10));

    const r = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'verify.mjs')], { encoding: 'utf8' });
    assert.equal(r.status, 1, 'the planted key must fail the whole gate, not just a module');
    assert.match(r.stdout, /noSuchTunable/, 'and the gate must name the key it caught');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('verify.mjs 2.8 dist-changelog: a dist change with no CHANGELOG entry fails the WHOLE gate — proves the wiring, not just the module', () => {
  const tmp = mkTmp('cm-verify-distchangelog-');
  try {
    for (const d of ['skills', 'plugin', 'scripts', '.claude-plugin', 'hooks', 'agents', 'commands', 'alt', 'plugin-src']) {
      fs.cpSync(path.join(repo, d), path.join(tmp, d), { recursive: true });
    }
    // A SELF-CONTAINED fixture CHANGELOG — not copied from the live repo. Copying it
    // silently coupled this test to the live CHANGELOG.md's own top heading staying
    // "## [3.14.0]" forever; the moment a real [Unreleased] section is opened for
    // legitimate work (exactly what this gate tells a developer to do), the fixture's
    // planted dist change takes the legitimate-pass branch and this assertion breaks —
    // the first person who follows the gate's own prescribed remedy breaks the suite.
    fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), '# Changelog\n\n## [3.14.0] - 2026-01-01\n\n### Added\n- baseline\n');

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
    // A machine-global tag.gpgSign/tag.forceSignAnnotated would force a bare `git tag
    // <name>` into an annotated, signed tag needing a message, failing non-interactively
    // with "fatal: no tag message?" — the exact fixture defect INSPECT's own RED-first
    // run hit in dist-changelog.test.mjs before it was fixed there. Same guard here.
    git(['config', 'tag.gpgSign', 'false']);
    git(['config', 'tag.forceSignAnnotated', 'false']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'baseline']);
    git(['tag', 'v3.14.0']);

    const run = () => spawnSync(process.execPath, [path.join(tmp, 'scripts', 'verify.mjs')], { encoding: 'utf8' });

    const clean = run();
    assert.equal(clean.status, 0, `freshly-tagged copy must PASS, got:\n${clean.stdout}${clean.stderr}`);
    assert.match(clean.stdout, /dist-changelog:\s*\n\s*ok/, 'the 2.8 block must be present and green on a clean copy');

    // Derive the version to mutate from the FIXTURE'S OWN copied plugin.json rather than a
    // hardcoded literal — a literal must coincidentally match whatever the live repo currently
    // ships, and it silently no-ops (0 replacements, no dist change planted) the moment the
    // live version moves past it. Reading it back at fixture-build time keeps this test correct
    // at any live version, forever.
    const liveVersion = JSON.parse(fs.readFileSync(path.join(tmp, '.claude-plugin', 'plugin.json'), 'utf8')).version;
    const marker = `"${liveVersion}"`;
    const bump = (p) => {
      const content = fs.readFileSync(p, 'utf8');
      assert.ok(content.includes(marker), `expected ${p} to contain ${marker} before bumping`);
      fs.writeFileSync(p, content.replace(marker, `"${liveVersion}-redprobe"`));
    };
    bump(path.join(tmp, '.claude-plugin', 'plugin.json'));
    bump(path.join(tmp, 'plugin', '.claude-plugin', 'plugin.json'));

    const withoutEntry = run();
    assert.equal(withoutEntry.status, 1, 'a dist change with no CHANGELOG entry must fail the WHOLE gate, not just the module in isolation');
    assert.match(withoutEntry.stdout, /FAIL dist-changelog: plugin\/ dist differs from v3\.14\.0 .*CHANGELOG\.md's top heading is still \[3\.14\.0\]/);

    const changelog = fs.readFileSync(path.join(tmp, 'CHANGELOG.md'), 'utf8');
    fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), changelog.replace('## [3.14.0]', '## [Unreleased]\n\n### Fixed\n- test entry\n\n## [3.14.0]'));
    const withEntry = run();
    assert.match(withEntry.stdout, /dist-changelog:\s*\n\s*ok/, 'documenting it in [Unreleased] clears the SAME composition-level check');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

