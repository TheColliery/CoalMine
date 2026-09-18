// CoalMine render core unit tests — node:test built-in, zero dependencies.
// Run: node --test scripts/lib/render.test.mjs
// Covers: marker injection, intent placeholders, missing-meta fallback,
// recursive skill-dir copy, and the verify.mjs stale-dist negative path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inject, renderSkillMd, installSkillDir, listSkills, SHARED_REFERENCES } from './render.mjs';

const NL = String.fromCharCode(10);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SHARED = {
  languageHeader: 'LANG-HEADER',
  orchestration: 'ORCH {{LIGHT_INTENT}}|{{STANDARD_INTENT}}|{{HEAVY_INTENT}}',
  escalationFooter: 'ESC-FOOTER',
  reportingFooter: 'REPORT-FOOTER',
};

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('inject replaces every SHARED marker', () => {
  const src = [
    '<!-- SHARED:LANGUAGE_HEADER -->',
    'body',
    '<!-- SHARED:ORCHESTRATION -->',
    '<!-- SHARED:ESCALATION_FOOTER -->',
    '<!-- SHARED:REPORTING_FOOTER -->',
  ].join('\n');
  const out = inject(src, SHARED, { lightIntent: 'L', standardIntent: 'S', heavyIntent: 'H' });
  assert.ok(!out.includes('<!-- SHARED:'), 'no unresolved markers may remain');
  assert.ok(out.includes('LANG-HEADER'));
  assert.ok(out.includes('ESC-FOOTER'));
  assert.ok(out.includes('REPORT-FOOTER'));
});

test('inject fills intent placeholders from meta', () => {
  const out = inject('<!-- SHARED:ORCHESTRATION -->', SHARED, {
    lightIntent: 'quick check',
    standardIntent: 'balanced',
    heavyIntent: 'full fan-out',
  });
  assert.equal(out, 'ORCH quick check|balanced|full fan-out');
});

test('inject defaults missing intents to empty string', () => {
  const out = inject('<!-- SHARED:ORCHESTRATION -->', SHARED, {});
  assert.equal(out, 'ORCH ||');
});

test('renderSkillMd works without skill-meta.json', () => {
  const dir = mkTmp('cm-render-');
  try {
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '<!-- SHARED:LANGUAGE_HEADER -->\nhello', 'utf8');
    const out = renderSkillMd(dir, SHARED);
    assert.equal(out, 'LANG-HEADER\nhello');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('installSkillDir copies nested subdirectories recursively', () => {
  const src = mkTmp('cm-src-');
  const dst = mkTmp('cm-dst-');
  try {
    fs.writeFileSync(path.join(src, 'SKILL.md'), '<!-- SHARED:LANGUAGE_HEADER -->', 'utf8');
    fs.writeFileSync(path.join(src, 'skill-meta.json'), '{}', 'utf8');
    fs.mkdirSync(path.join(src, 'references', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(src, 'references', 'a.md'), 'ref-a', 'utf8');
    fs.writeFileSync(path.join(src, 'references', 'deep', 'b.md'), 'ref-b', 'utf8');

    const to = path.join(dst, 'myskill');
    installSkillDir(src, to, SHARED);

    assert.equal(fs.readFileSync(path.join(to, 'SKILL.md'), 'utf8'), 'LANG-HEADER');
    assert.equal(fs.readFileSync(path.join(to, 'references', 'a.md'), 'utf8'), 'ref-a');
    assert.equal(fs.readFileSync(path.join(to, 'references', 'deep', 'b.md'), 'utf8'), 'ref-b');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
});

test('installSkillDir writes shared references verbatim, alongside a skill that has none of its own', () => {
  const src = mkTmp('cm-src-');
  const dst = mkTmp('cm-dst-');
  try {
    // A skill with NO references/ dir of its own — the shared ref must still land.
    fs.writeFileSync(path.join(src, 'SKILL.md'), '<!-- SHARED:LANGUAGE_HEADER -->', 'utf8');
    const shared = { ...SHARED, sharedReferences: { 'escalation.md': 'SHARED-REF-BODY\n' } };

    const to = path.join(dst, 'myskill');
    installSkillDir(src, to, shared);

    assert.equal(fs.readFileSync(path.join(to, 'references', 'escalation.md'), 'utf8'), 'SHARED-REF-BODY\n');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
});

test('installSkillDir injects shared references without clobbering the skill\'s own references', () => {
  const src = mkTmp('cm-src-');
  const dst = mkTmp('cm-dst-');
  try {
    fs.writeFileSync(path.join(src, 'SKILL.md'), '<!-- SHARED:LANGUAGE_HEADER -->', 'utf8');
    fs.mkdirSync(path.join(src, 'references'), { recursive: true });
    fs.writeFileSync(path.join(src, 'references', 'own.md'), 'own-ref', 'utf8');
    const shared = { ...SHARED, sharedReferences: { 'escalation.md': 'SHARED-REF' } };

    const to = path.join(dst, 'myskill');
    installSkillDir(src, to, shared);

    assert.equal(fs.readFileSync(path.join(to, 'references', 'own.md'), 'utf8'), 'own-ref');
    assert.equal(fs.readFileSync(path.join(to, 'references', 'escalation.md'), 'utf8'), 'SHARED-REF');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
});

test('SHARED_REFERENCES is a non-empty list of {name, src} entries', () => {
  assert.ok(Array.isArray(SHARED_REFERENCES) && SHARED_REFERENCES.length >= 1);
  for (const r of SHARED_REFERENCES) {
    assert.equal(typeof r.name, 'string');
    assert.ok(r.name.length > 0);
    assert.ok(r.src.endsWith(r.name), `src ${r.src} should end with name ${r.name}`);
  }
});

test('verify.mjs negative path: stale dist fails, clean copy passes', () => {
  const tmp = mkTmp('cm-verify-');
  try {
    for (const d of ['skills', 'plugin', 'scripts', '.claude-plugin', 'hooks', 'agents', 'commands', 'alt']) {
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
    for (const d of ['skills', 'plugin', 'scripts', '.claude-plugin', 'hooks', 'agents', 'commands', 'alt']) {
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
    for (const d of ['skills', 'plugin', 'scripts', '.claude-plugin', 'hooks', 'agents', 'commands', 'alt']) {
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
      const r = spawnSync('git', args, { cwd: tmp, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.error?.message}`);
      return r.stdout;
    };
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@test.invalid']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'commit.gpgsign', 'false']);
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
test('verify.mjs 2.11 pointers: a dead pointer and a gitignored citation each fail the WHOLE gate -- proves the wiring, not just the module', () => {
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
      const r = spawnSync('git', args, { cwd: tmp, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.error?.message}`);
      return r.stdout;
    };
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@test.invalid']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'baseline']);

    const run = () => spawnSync(process.execPath, [path.join(tmp, 'scripts', 'verify.mjs')], { encoding: 'utf8' });

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
    fs.rmSync(tmp, { recursive: true, force: true });
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
test('verify.mjs 2.11 pointers: MEDIUM-2 -- an extensionless citation under a gitignored root is checked non-locally, not exempt', () => {
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
      const r = spawnSync('git', args, { cwd: tmp, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.error?.message}`);
      return r.stdout;
    };
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@test.invalid']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'baseline']);

    const run = () => spawnSync(process.execPath, [path.join(tmp, 'scripts', 'verify.mjs')], { encoding: 'utf8' });

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
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

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
test('verify.mjs 2.11 pointers: FIX 2 -- the lone-CR .gitignore line false-matches an absent root under the bare feed; the injection-site feed and the real gate are immune', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-pointer-lonecr-'));
  try {
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
      NL + 'See `totally-fake-root/notes.md` for details.' + NL);

    const git = (args, opts = {}) => {
      const r = spawnSync('git', args, { cwd: tmp, encoding: 'utf8', ...opts });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.error?.message}`);
      return r.stdout;
    };
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@test.invalid']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['config', 'core.autocrlf', 'true']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'baseline']);
    assert.ok(fs.readFileSync(path.join(tmp, '.gitignore'), 'utf8').includes('\r\n\r\n'),
      'the working-tree .gitignore must actually carry the lone-CR blank line -- the shape this fixture exists to test');
    assert.ok(!fs.existsSync(path.join(tmp, 'totally-fake-root')),
      'the probed root must be genuinely absent -- that absence is what the false match depends on');

    // THE DISCRIMINATING PAIR, at the git level, on the SAME real fixture -- no
    // source-code substitution needed, since the bare feed and the probe feed are
    // both real, independent git invocations.
    const bare = spawnSync('git', ['check-ignore', '--stdin'], { cwd: tmp, encoding: 'utf8', input: 'totally-fake-root/\n' });
    assert.equal(bare.status, 0,
      'RED: the bare feed must reproduce the false match on THIS fixture -- an absent, un-patterned root reported ignored');
    const probed = spawnSync('git', ['check-ignore', '--stdin'], { cwd: tmp, encoding: 'utf8', input: 'totally-fake-root/.pointer-check-probe\n' });
    assert.equal(probed.status, 1,
      'the injection-site feed correctly reports the SAME root as NOT ignored');
    const verbose = spawnSync('git', ['check-ignore', '-v', '--stdin'], { cwd: tmp, encoding: 'utf8', input: 'totally-fake-root/\n' });
    assert.match(verbose.stdout, /\.gitignore:2:/,
      'the matching pattern must be the lone-CR line (line 2), naming the source unambiguously');

    // CONTROL: a genuinely-ignored root still matches under BOTH feeds -- the probe
    // loses no true positive.
    assert.equal(spawnSync('git', ['check-ignore', '--stdin'], { cwd: tmp, encoding: 'utf8', input: 'dist/\n' }).status, 0);
    assert.equal(spawnSync('git', ['check-ignore', '--stdin'], { cwd: tmp, encoding: 'utf8', input: 'dist/.pointer-check-probe\n' }).status, 0);

    // A MERELY-CRLF pattern line (the old fixture's own shape) does NOT reproduce it
    // on this box/git version -- kept as the honest, re-aimed sentence (see the header
    // comment); not re-asserted as a second fixture here, since this box's own real
    // lone-CR fixture already proves the point it stands beside.

    // END-TO-END: the real gate, as fixed, must not be fooled by this fixture -- the
    // absent-root citation is silently out of scope (never even resolves), never the
    // false "gitignored" FAIL the bare feed would have produced.
    const run = () => spawnSync(process.execPath, [path.join(tmp, 'scripts', 'verify.mjs')], { encoding: 'utf8' });
    const r = run();
    assert.doesNotMatch(r.stdout, /totally-fake-root.*gitignored/i,
      'the gate must never report the absent-root citation as gitignored -- the exact false FAIL the bare feed would have produced');
    assert.doesNotMatch(r.stdout, /FAIL.*totally-fake-root/,
      'the absent-root citation must not FAIL at all -- it is silently out of scope, not "gitignored" and not "does not resolve"');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
test('verify.mjs 2.11 pointers: git unavailable degrades to a NAMED SKIP, never a FAIL -- proven with a capability probe, not a name filter', () => {
  const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-emptypath-'));
  try {
    const r = spawnSync(process.execPath, [path.join(repo, 'scripts', 'verify.mjs')],
      { env: { ...process.env, PATH: emptyPath }, encoding: 'utf8' });
    assert.equal(r.status, 0, `git-unavailable must still exit 0 (nothing else in this repo depends on git), got:${NL}${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /pointers:\n\s+--\s+pointer check: git unavailable.*skipped/,
      'the pointers block must print a visible, named SKIP -- never a silent carve-out and never a FAIL');
    const pointersBlock = r.stdout.slice(r.stdout.indexOf('pointers:'), r.stdout.indexOf('hooks:'));
    assert.doesNotMatch(pointersBlock, /FAIL/,
      'a question only git can answer must never redden the gate for a non-git user');
  } finally {
    fs.rmSync(emptyPath, { recursive: true, force: true });
  }
});
