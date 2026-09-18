// The CHANGELOG-vs-dist gate (task #38) — three consecutive rounds shipped changes that
// reached the published plugin/ dist with NO CHANGELOG entry, caught by hand each time
// after the fact. This makes it mechanical.
//
// Keys on "did the DIST change vs the last tag", never "did any file change" — a doc-only
// commit must stay silent (scripts-quality.md section 3: a change that never reaches the
// shipped dist earns no version and no [Unreleased] entry; a gate that fires on one is a
// cry-wolf gate and worse than none).
//
// Baseline = the last version tag, compared against the WORKTREE (not HEAD) — at
// pre-commit time the dist change is staged/unstaged and not yet committed, so this is
// the one comparison shape that agrees at pre-commit, pre-push and CI alike.
//
// Two absences are POSSIBLE and both degrade to a visible, non-blocking SKIP — never a
// silent carve-out, and never a false "nothing changed": not a git repo (or git absent),
// and no tag reachable (the common CI shape: actions/checkout defaults to a shallow,
// single-commit fetch with no tag history unless fetch-depth:0/fetch-tags is set — see
// .github/workflows/ci.yml, which as of 940a0f9 sets fetch-depth: 0 so a tag IS reachable
// there. That is a fact about the checkout step's inputs, not a measured CI result — this
// repo does not push on every change, so whether the SKIP still fires in practice is
// unconfirmed until a real CI run is read; do not read this comment as proof either way).
// "Could not tell" is not "clean" — this room already paid for that conflation twice in
// consistency.mjs (`isDir`, `walkMd`); the miss direction here is a missed CHANGELOG entry,
// not a false clean bill, so a visible skip is the correct degrade, not a defect to eliminate.
//
// Pure error handling only: every git invocation is wrapped so a corrupt or absent
// binary/repo never crashes the gate — it becomes one of the two named SKIPs above, or a
// FAIL with a reason, per scripts-quality.md section 1.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// The two paths a version bump actually touches: the committed dist directory itself,
// and the repo-root plugin.json (the version SOURCE — copied into plugin/.claude-plugin/
// by build-plugin.mjs, but diffed here too so a version bump is caught the instant it is
// written, even in the intermediate state before a rebuild has run).
const DIST_PATHS = ['plugin/', '.claude-plugin/plugin.json'];

function git(args, repo) {
  return spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
}

function isGitRepo(repo) {
  const r = git(['rev-parse', '--is-inside-work-tree'], repo);
  return r.status === 0 && r.stdout.trim() === 'true';
}

// Exported for its own unit test — the empty-tags case (status 0, empty stdout) is not
// an error and must not be confused with "git failed".
export function resolveLastTag(repo) {
  const r = git(['tag', '--sort=-v:refname'], repo);
  if (r.status !== 0) return null;
  const tags = r.stdout.split(/\r?\n/).filter(Boolean);
  return tags[0] ?? null;
}

// `git diff` (any form) is blind to files with no INDEX entry at all — a brand-new,
// never-`git add`-ed file under plugin/ is invisible to it, not just "shows as unchanged"
// but genuinely never inspected (INSPECT MEDIUM, 2026-08-04: measured silent before this
// fix, the exact shape `build-plugin.mjs` produces the moment a NEW skill directory is
// added — the single most common reason plugin/ ever grows a file). `git status
// --porcelain`/`ls-files --others` DO see it. Returns the raw spawn result rather than a
// boolean, so a git error can carry the same error detail the tracked-diff check below
// already surfaces, instead of a generic "unknown git error" the caller cannot improve on.
function checkUntracked(repo) {
  return git(['ls-files', '--others', '--exclude-standard', '--', ...DIST_PATHS], repo);
}

// Non-empty section body between a top "## [...]" heading and the next "## " heading (or
// EOF). Heading-agnostic by design — used for BOTH "[Unreleased]" and a sibling version
// heading (INSPECT MEDIUM, 2026-08-04): a bare heading with nothing under it does not
// count as documented, regardless of which of the two shapes it is.
function sectionBody(lines, headingIdx) {
  const rest = lines.slice(headingIdx + 1);
  const nextIdx = rest.findIndex((l) => /^##\s/.test(l));
  const body = nextIdx === -1 ? rest : rest.slice(0, nextIdx);
  return body.join('\n').trim();
}

// Plain dotted-numeric compare (X.Y.Z) — this room's own tags are always bare SemVer with
// no pre-release/build suffix, so a full SemVer parser would be solving a problem that
// does not exist here. `Number.parseInt` reads as far as it can (`'1-rc1'` -> 1, not 0 —
// it does NOT reject a non-numeric TAIL, only a segment with no leading digit at all, e.g.
// 'rc1' -> NaN -> 0), so a malformed heading degrades to whatever leading digits it has,
// or to 0 if it has none — either way it fails the "newer" test rather than crashing the
// gate. Returns >0 if a is newer, <0 if older, 0 if equal.
function compareVersions(a, b) {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Caps the FAIL message's path list so a legitimate large rebuild (many real dist files)
// never prints a wall — but always names at least the first few, because the reader who
// needs to tell "editor junk" from "a real dist change" needs the ACTUAL paths, not just
// "plugin/ differs" (INSPECT MEDIUM cry-wolf follow-up, 2026-08-04).
function formatPaths(paths, cap = 5) {
  const shown = paths.slice(0, cap).join(', ');
  const rest = paths.length - cap;
  return rest > 0 ? `${shown}, +${rest} more` : shown;
}

export function checkDistChangelog(repo) {
  if (!isGitRepo(repo)) {
    return [{ level: 'SKIP', msg: 'dist-changelog: not a git repository (or git is unavailable) — cannot establish a tag baseline; skipped (a missed CHANGELOG entry, never a false clean bill)' }];
  }

  const tag = resolveLastTag(repo);
  if (!tag) {
    return [{ level: 'SKIP', msg: 'dist-changelog: no version tag reachable (e.g. a shallow CI checkout with no tag history — actions/checkout fetches neither by default) — cannot establish a baseline; skipped (a missed CHANGELOG entry, never a false clean bill)' }];
  }

  // `git diff --name-only <tag> -- <paths>` — exit 0 always (unlike `--quiet`, this form
  // signals via STDOUT, not the exit code); a non-zero status is a genuine error (bad
  // revision, corrupt repo) this check must not swallow as "clean". `--name-only` doubles
  // as the path list every FAIL message below names, per INSPECT's cry-wolf follow-up
  // (2026-08-04): detecting "something differs" is not enough, the reader needs to see
  // WHAT, or a real dist change and a stray editor-junk file read identically.
  const diff = git(['diff', '--name-only', tag, '--', ...DIST_PATHS], repo);
  if (diff.status !== 0) {
    return [{ level: 'FAIL', msg: `dist-changelog: could not diff the dist against ${tag}: ${(diff.stderr || diff.error?.message || 'unknown git error').trim()}` }];
  }
  let changedPaths = diff.stdout.split(/\r?\n/).filter(Boolean);

  // `git diff` alone is blind to untracked new files (see checkUntracked above) — check
  // separately, but only when the tracked diff itself found nothing, so a genuine tracked
  // change never depends on this second call succeeding.
  if (changedPaths.length === 0) {
    const untracked = checkUntracked(repo);
    if (untracked.status !== 0) {
      return [{ level: 'FAIL', msg: `dist-changelog: could not check for untracked dist files: ${(untracked.stderr || untracked.error?.message || 'unknown git error').trim()}` }];
    }
    changedPaths = untracked.stdout.split(/\r?\n/).filter(Boolean);
  }
  if (changedPaths.length === 0) return [];
  const paths = formatPaths(changedPaths);

  let changelog;
  try {
    changelog = fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8');
  } catch (e) {
    return [{ level: 'FAIL', msg: `dist-changelog: plugin/ dist differs from ${tag} (${paths}) but CHANGELOG.md is unreadable: ${e.message}` }];
  }

  const lines = changelog.split(/\r?\n/);
  const headingIdx = lines.findIndex((l) => /^##\s*\[/.test(l));
  if (headingIdx === -1) {
    return [{ level: 'FAIL', msg: `dist-changelog: plugin/ dist differs from ${tag} (${paths}) but CHANGELOG.md has no version heading — add an [Unreleased] section documenting the change` }];
  }
  const heading = lines[headingIdx].match(/^##\s*\[([^\]]+)\]/)[1].trim();
  const tagVersion = tag.replace(/^v/, '');

  if (heading.toLowerCase() === 'unreleased') {
    if (sectionBody(lines, headingIdx).length === 0) {
      return [{ level: 'FAIL', msg: `dist-changelog: plugin/ dist differs from ${tag} (${paths}) but the [Unreleased] section is empty — add an entry documenting the change` }];
    }
    return [];
  }

  if (heading === tagVersion) {
    return [{ level: 'FAIL', msg: `dist-changelog: plugin/ dist differs from ${tag} (${paths}) but CHANGELOG.md's top heading is still [${heading}] — add an [Unreleased] entry (or a new version heading) documenting the change` }];
  }

  // A version heading OTHER than the tag's own only counts as documentation if it is
  // BOTH non-empty and genuinely newer (INSPECT MEDIUM, 2026-08-04) — the comment this
  // replaces said "presumably newer" and never checked either half. An empty `## [1.1.0]`
  // or an OLDER `## [0.9.0]` must not silently pass just because the string differs from
  // the tag's own.
  if (sectionBody(lines, headingIdx).length === 0) {
    return [{ level: 'FAIL', msg: `dist-changelog: plugin/ dist differs from ${tag} (${paths}) but the top heading [${heading}] has no content — add an entry documenting the change` }];
  }
  if (compareVersions(heading, tagVersion) <= 0) {
    return [{ level: 'FAIL', msg: `dist-changelog: plugin/ dist differs from ${tag} (${paths}) but the top heading [${heading}] is not newer than the last tag — add an [Unreleased] entry (or a version above ${tagVersion}) documenting the change` }];
  }

  // Non-empty and genuinely newer than the last tag — a release in progress that updated
  // CHANGELOG ahead of tagging.
  return [];
}
