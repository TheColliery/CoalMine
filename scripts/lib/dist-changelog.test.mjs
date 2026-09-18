// Unit tests for the CHANGELOG-vs-dist gate (task #38). Zero-dep (node:test + built-ins +
// a real `git` binary — spawned directly, same precedent as install.test.mjs's git-hook
// tests), per scripts-quality.md section 2. Every fixture is a throwaway repo built under
// os.tmpdir(), never inside the live CoalMine tree (hooks-safety.md section 8's lesson:
// a leaked fixture under a project path is invisible to git status and can re-poison a
// live check — this room paid for that once already in the consistency.mjs C1 unit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkDistChangelog, resolveLastTag } from './dist-changelog.mjs';

function git(args, repo) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.error?.message}`);
  return r.stdout;
}

// A minimal but real repo: plugin/ + .claude-plugin/plugin.json (the two DIST_PATHS) +
// CHANGELOG.md with a [1.0.0] heading, committed and tagged v1.0.0 — the baseline every
// test starts from, matching this room's live shape (a version heading, a prior tag).
function mkTaggedRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-distchangelog-'));
  git(['init', '-q', '-b', 'main'], dir);
  git(['config', 'user.email', 'test@test.invalid'], dir);
  git(['config', 'user.name', 'Test'], dir);
  git(['config', 'commit.gpgsign', 'false'], dir);
  // A machine-global tag.gpgSign / tag.forceSignAnnotated would force `git tag <name>` (no
  // -a/-m) into an ANNOTATED, signed tag needing a message — non-interactive spawnSync then
  // fails with "fatal: no tag message?". Local overrides make the fixture's tags lightweight
  // regardless of the host's global config (the fixture defect the round-2 RED-first run
  // actually found — a fixture bug, not a bug in checkDistChangelog itself).
  git(['config', 'tag.gpgSign', 'false'], dir);
  git(['config', 'tag.forceSignAnnotated', 'false'], dir);
  fs.mkdirSync(path.join(dir, 'plugin', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin', 'skills', 'a.md'), 'skill A\n');
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), '{"version":"1.0.0"}\n');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [1.0.0] - 2026-01-01\n\n### Added\n- first release\n');
  git(['add', '-A'], dir);
  git(['commit', '-q', '-m', 'initial'], dir);
  git(['tag', 'v1.0.0'], dir);
  return dir;
}

test('resolveLastTag: null when the tag list is empty, the highest tag when several exist regardless of creation order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-distchangelog-tags-'));
  try {
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.email', 'test@test.invalid'], dir);
    git(['config', 'user.name', 'Test'], dir);
    git(['config', 'tag.gpgSign', 'false'], dir);
    git(['config', 'tag.forceSignAnnotated', 'false'], dir);
    fs.writeFileSync(path.join(dir, 'f.txt'), 'x\n');
    git(['add', '-A'], dir);
    git(['commit', '-q', '-m', 'c1'], dir);
    assert.equal(resolveLastTag(dir), null, 'zero tags is not an error — null, not a thrown exception');

    git(['tag', 'v1.2.0'], dir);
    git(['tag', 'v1.10.0'], dir); // created AFTER v1.2.0, but sorts HIGHER by version
    assert.equal(resolveLastTag(dir), 'v1.10.0', 'sorted by version (--sort=-v:refname), not by tag-creation order');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('checkDistChangelog: not a git repository degrades to a visible SKIP, never a crash or a false clean bill', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-distchangelog-nogit-'));
  try {
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n');
    const found = checkDistChangelog(dir);
    assert.equal(found.length, 1);
    assert.equal(found[0].level, 'SKIP');
    assert.match(found[0].msg, /not a git repository/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('checkDistChangelog: a git repo with NO tags degrades to a visible SKIP naming why (the no-tag-reachable case, e.g. a shallow checkout)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-distchangelog-notag-'));
  try {
    git(['init', '-q', '-b', 'main'], dir);
    git(['config', 'user.email', 'test@test.invalid'], dir);
    git(['config', 'user.name', 'Test'], dir);
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n');
    git(['add', '-A'], dir);
    git(['commit', '-q', '-m', 'c1'], dir);
    const found = checkDistChangelog(dir);
    assert.equal(found.length, 1);
    assert.equal(found[0].level, 'SKIP');
    assert.match(found[0].msg, /no version tag reachable/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('checkDistChangelog: dist unchanged vs the last tag is silent, regardless of what CHANGELOG says', () => {
  const dir = mkTaggedRepo();
  try {
    assert.deepEqual(checkDistChangelog(dir), [], 'clean worktree, nothing to document');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('checkDistChangelog: a DOC-ONLY change (outside plugin/ and .claude-plugin/plugin.json) stays silent — never cry-wolf', () => {
  const dir = mkTaggedRepo();
  try {
    fs.writeFileSync(path.join(dir, 'README.md'), 'unrelated doc edit\n');
    assert.deepEqual(checkDistChangelog(dir), [], 'a doc-only worktree change must never trip this gate');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('checkDistChangelog: dist CHANGED with no CHANGELOG update FAILs (RED case)', () => {
  const dir = mkTaggedRepo();
  try {
    fs.writeFileSync(path.join(dir, 'plugin', 'skills', 'a.md'), 'skill A, EDITED\n');
    const found = checkDistChangelog(dir);
    assert.equal(found.length, 1);
    assert.equal(found[0].level, 'FAIL');
    assert.match(found[0].msg, /plugin\/ dist differs from v1\.0\.0 .*CHANGELOG\.md's top heading is still \[1\.0\.0\]/);
    assert.match(found[0].msg, /plugin\/skills\/a\.md/, 'the FAIL must name the actual changed path, not just "something differs" (INSPECT cry-wolf follow-up)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('checkDistChangelog: dist changed + a non-empty [Unreleased] section documents it (GREEN case)', () => {
  const dir = mkTaggedRepo();
  try {
    fs.writeFileSync(path.join(dir, 'plugin', 'skills', 'a.md'), 'skill A, EDITED\n');
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n### Fixed\n- documented the edit\n\n## [1.0.0] - 2026-01-01\n\n### Added\n- first release\n');
    assert.deepEqual(checkDistChangelog(dir), [], 'a real Unreleased entry documents the dist change');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('checkDistChangelog: dist changed + an EMPTY [Unreleased] heading (no body) still FAILs', () => {
  const dir = mkTaggedRepo();
  try {
    fs.writeFileSync(path.join(dir, 'plugin', 'skills', 'a.md'), 'skill A, EDITED\n');
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n### Added\n- first release\n');
    const found = checkDistChangelog(dir);
    assert.equal(found.length, 1);
    assert.equal(found[0].level, 'FAIL');
    assert.match(found[0].msg, /the \[Unreleased\] section is empty/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('checkDistChangelog: dist changed + a NEW version heading (not Unreleased, not the tag version) also documents it', () => {
  const dir = mkTaggedRepo();
  try {
    fs.writeFileSync(path.join(dir, 'plugin', 'skills', 'a.md'), 'skill A, EDITED\n');
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [1.1.0] - 2026-02-01\n\n### Fixed\n- documented the edit\n\n## [1.0.0] - 2026-01-01\n\n### Added\n- first release\n');
    assert.deepEqual(checkDistChangelog(dir), [], 'a bumped version heading ahead of tagging counts as documented');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// INSPECT MEDIUM (2026-08-04): the final branch trusted ANY non-Unreleased, non-tag
// heading unconditionally — an EMPTY newer heading and a non-empty OLDER heading both
// passed silently. Split into the two probes the reviewer actually ran (Q1, Q2).
test('checkDistChangelog: a non-tag version heading with an EMPTY body still FAILs (INSPECT Q1)', () => {
  const dir = mkTaggedRepo();
  try {
    fs.writeFileSync(path.join(dir, 'plugin', 'skills', 'a.md'), 'skill A, EDITED\n');
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [1.1.0] - 2026-02-01\n\n## [1.0.0] - 2026-01-01\n\n### Added\n- first release\n');
    const found = checkDistChangelog(dir);
    assert.equal(found.length, 1);
    assert.equal(found[0].level, 'FAIL');
    assert.match(found[0].msg, /the top heading \[1\.1\.0\] has no content/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('checkDistChangelog: a non-tag version heading that is OLDER than the tag still FAILs even with a real body (INSPECT Q2)', () => {
  const dir = mkTaggedRepo();
  try {
    fs.writeFileSync(path.join(dir, 'plugin', 'skills', 'a.md'), 'skill A, EDITED\n');
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [0.9.0] - 2025-12-01\n\n### Fixed\n- an old, unrelated entry\n\n## [1.0.0] - 2026-01-01\n\n### Added\n- first release\n');
    const found = checkDistChangelog(dir);
    assert.equal(found.length, 1);
    assert.equal(found[0].level, 'FAIL');
    assert.match(found[0].msg, /the top heading \[0\.9\.0\] is not newer than the last tag/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// INSPECT MEDIUM (2026-08-04): `git diff` never sees a file with no INDEX entry — an
// UNTRACKED new file under plugin/ (the shape build-plugin.mjs produces for a brand-new
// skill directory) was silently invisible. `git add` makes it tracked, which was already
// correctly caught — this probes the gap BEFORE that point.
test('checkDistChangelog: an UNTRACKED new file under plugin/ is caught, not silently invisible (INSPECT MEDIUM)', () => {
  const dir = mkTaggedRepo();
  try {
    fs.mkdirSync(path.join(dir, 'plugin', 'skills', 'brand-new-canary'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'plugin', 'skills', 'brand-new-canary', 'SKILL.md'), 'a whole new skill\n');
    // Deliberately NOT `git add`-ed — this is the exact untracked shape `git commit -a`
    // walks straight past (it stages tracked modifications only, never new files).
    const found = checkDistChangelog(dir);
    assert.equal(found.length, 1, 'an untracked new dist file must not be a silent clean bill');
    assert.equal(found[0].level, 'FAIL');
    assert.match(found[0].msg, /brand-new-canary\/SKILL\.md/, 'the FAIL must name the actual untracked path, not just "something differs"');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// INSPECT cry-wolf follow-up (2026-08-04): naming every changed path is only safe if a
// legitimate large rebuild (many real dist files at once) cannot print a wall of them.
test('checkDistChangelog: a FAIL message with more than the cap of changed paths shows "+N more", never an unbounded wall', () => {
  const dir = mkTaggedRepo();
  try {
    for (let i = 0; i < 7; i++) {
      fs.writeFileSync(path.join(dir, 'plugin', 'skills', `new-${i}.md`), `skill ${i}\n`);
    }
    const found = checkDistChangelog(dir);
    assert.equal(found.length, 1);
    assert.match(found[0].msg, /\+2 more/, '7 changed paths, cap 5, must show exactly "+2 more"');
    assert.equal((found[0].msg.match(/new-\d\.md/g) || []).length, 5, 'exactly 5 paths are named, not all 7');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('checkDistChangelog: a version bump to the repo-root plugin.json ALONE (before any dist rebuild) is caught too', () => {
  const dir = mkTaggedRepo();
  try {
    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), '{"version":"1.1.0"}\n');
    const found = checkDistChangelog(dir);
    assert.equal(found.length, 1);
    assert.equal(found[0].level, 'FAIL');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('checkDistChangelog: CHANGELOG.md missing entirely FAILs with a clear reason (dist changed, nothing to check)', () => {
  const dir = mkTaggedRepo();
  try {
    fs.writeFileSync(path.join(dir, 'plugin', 'skills', 'a.md'), 'skill A, EDITED\n');
    fs.rmSync(path.join(dir, 'CHANGELOG.md'));
    const found = checkDistChangelog(dir);
    assert.equal(found.length, 1);
    assert.equal(found[0].level, 'FAIL');
    assert.match(found[0].msg, /CHANGELOG\.md is unreadable/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
