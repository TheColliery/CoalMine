// UMB-162 (a) — "WRITE ONCE, DERIVE EVERYTHING" (owner-proposed, main-confirmed 2026-09-21).
// Parses a CHANGELOG.md's TOP version entry into the pieces a GitHub Release's title and body
// are DERIVED from, per RELEASE-PATTERN.md "The title" / "The body": the entry's own ONE-LINE
// SUMMARY -- the line immediately below the version heading, before any Keep-a-Changelog
// `### ` subsection -- becomes both the title's `<summary>` segment and the body's Part 1
// Lead; the Keep-a-Changelog subsections become the body's Part 2, verbatim. This is the ONE
// place that text is composed; the tag-push workflow is the only Release creator from here on
// (a head no longer POSTs a Release by hand -- the race that produced bare-titled Releases,
// UMB-162's own root cause, disappears by construction, not by discipline).
//
// Pure text in, structured data out -- no network, no filesystem, no side effects, so the
// derivation rules are unit-testable without touching the GitHub API (node/runtime.md's own
// "out of scope: a plain CLI tool" carve-out does not even apply here -- this file has no
// entry point at all, and its one caller, release-notes.mjs, is the plain CLI that reads
// CHANGELOG.md and writes the derived files for the workflow's next step to consume).

export class ChangelogShapeError extends Error {}

// A ref handed in by the workflow (the previous stable tag, the repo's current Latest) that is not
// a bare vX.Y.Z -- a derivation never guesses around it.
export class ReleaseRefError extends Error {}

const BARE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

// UMB-182 default-Latest. GitHub marks a new Release "Latest" unless the create call says otherwise
// (measured on CoalFace's rehearsal: a throw-away v0.0.2 took Latest from v0.11.0). A Release for a
// version OLDER than the current Latest -- a patch on an older line, or a back-fill (UMB-189) -- must be created with
// make_latest "false". Returns the string the workflow hands to `gh release create/edit --latest=`.
// `latestTag` is '' when the repo has no Latest yet.
export function makeLatestFlag(tagVersion, latestTag) {
  if (!latestTag) return 'true';
  const l = latestTag.match(BARE_TAG);
  if (!l) throw new ReleaseRefError(`the current Latest release is tagged "${latestTag}", not a bare vX.Y.Z -- refusing to guess whether v${tagVersion} should take Latest`);
  const t = `v${tagVersion}`.match(BARE_TAG);
  if (!t) throw new ReleaseRefError(`v${tagVersion} is not a bare vX.Y.Z`);
  for (let i = 1; i <= 3; i++) {
    const d = Number(t[i]) - Number(l[i]);
    if (d !== 0) return d > 0 ? 'true' : 'false';
  }
  return 'true'; // the same tag as Latest (a re-run): keep it Latest
}

// Returns { version, date, summary, sectionsBody } for the tag's own entry. Throws
// ChangelogShapeError with a human-readable reason on any shape violation -- never guesses,
// per the fail-loud CLI discipline (scripts-quality.md sec 1): a malformed or stale CHANGELOG
// must stop the release, not ship a Release titled from a fallback.
//
// UMB-182 / courier C-2: `previousStable` ('X.Y.Z', or '' for a first stable release) is the version
// of the previous stable tag (`git describe --exclude='*-*'`). When given, the first STABLE
// `## [X.Y.Z]` heading after the released entry must be that version -- pre-release headings in
// between are skipped. This catches the class the byte re-read cannot see: a heading REPLACED instead
// of inserted above, which silently publishes the older entry's sections as the new release's notes.
export function extractChangelogEntry(changelogText, tagVersion, { previousStable = '' } = {}) {
  const lines = changelogText.split(/\r?\n/);
  const headingIdx = lines.findIndex((l) => /^##\s*\[/.test(l));
  if (headingIdx === -1) throw new ChangelogShapeError('CHANGELOG.md has no version heading ("## [X.Y.Z] - YYYY-MM-DD")');

  const m = lines[headingIdx].match(/^##\s*\[([^\]]+)\]\s*-\s*(\d{4}-\d{2}-\d{2})\s*$/);
  if (!m) throw new ChangelogShapeError(`top heading "${lines[headingIdx].trim()}" is not "## [X.Y.Z] - YYYY-MM-DD"`);
  const [, version, date] = m;
  if (version.toLowerCase() === 'unreleased') {
    throw new ChangelogShapeError('top entry is still [Unreleased] -- the CHANGELOG entry is written and finalized BEFORE the tag (RELEASE-PATTERN.md "The chain around the press", step 1)');
  }
  if (version !== tagVersion) {
    throw new ChangelogShapeError(`top entry is [${version}] but the pushed tag is v${tagVersion} -- the CHANGELOG entry must match the tag it is cut for`);
  }

  const rest = lines.slice(headingIdx + 1);
  if (previousStable) {
    const nextStable = rest.map((l) => l.match(/^##\s*\[(\d+\.\d+\.\d+)\]/)).find(Boolean)?.[1];
    if (nextStable !== previousStable) {
      throw new ChangelogShapeError(`the [${version}] entry is followed by ${nextStable ? `[${nextStable}]` : 'no stable heading'}, but the previous stable tag is v${previousStable} -- an entry heading was replaced instead of inserted above, or the previous release's entry is missing`);
    }
  }
  const nextHeadingIdx = rest.findIndex((l) => /^##\s/.test(l));
  const body = nextHeadingIdx === -1 ? rest : rest.slice(0, nextHeadingIdx);

  const firstContentIdx = body.findIndex((l) => l.trim() !== '');
  if (firstContentIdx === -1) throw new ChangelogShapeError(`the [${version}] entry is empty`);
  if (/^###\s/.test(body[firstContentIdx])) {
    throw new ChangelogShapeError(`the [${version}] entry has no one-line summary before its first "### " section -- add one sentence stating what changed and why it matters (this becomes the Release's title and Lead)`);
  }
  const summary = body[firstContentIdx].trim();

  const afterSummary = body.slice(firstContentIdx + 1);
  const sectionsStart = afterSummary.findIndex((l) => /^###\s/.test(l));
  const sectionsBody = sectionsStart === -1 ? '' : afterSummary.slice(sectionsStart).join('\n').trim();

  return { version, date, summary, sectionsBody };
}

// "vX.Y.Z - <summary>" per RELEASE-PATTERN.md "The title": bare version, spaced hyphen,
// lower-case sentence style, no trailing period. The summary text itself is the CHANGELOG
// author's own words, used near-verbatim (only the leading letter is case-adjusted, and only
// when it looks like an ordinary sentence start rather than an acronym/identifier) -- a
// machine composes the SHAPE, never the WORDING.
export function buildReleaseTitle(version, summary) {
  let s = summary.replace(/\.\s*$/, '');
  // Lower-case the leading letter of an ordinary sentence opener ("A project..." -> "a
  // project..."), but leave an acronym/identifier-shaped first word alone -- one whose first
  // TWO characters are both capitals ("SHA256SUMS.txt", "CI") reads as an acronym or a file
  // name, never an ordinary sentence opener; an ordinary word has at most one leading capital.
  const firstWord = s.match(/^\S+/)?.[0] ?? '';
  const looksLikeIdentifier = /^[A-Z]{2}/.test(firstWord);
  if (!looksLikeIdentifier && /^[A-Z]/.test(s)) s = s[0].toLowerCase() + s.slice(1);
  return `v${version} - ${s}`;
}

// Part 1 (Lead) + Part 2 (What changed) per RELEASE-PATTERN.md "The body". The summary line IS
// the Lead, exactly as written in the CHANGELOG (a body sentence keeps its own capitalization,
// unlike the title). Parts 3-5 (What you need to do / Gate / Provenance) are NOT derived here
// -- each needs judgement this function has no way to supply (an action item, a figure
// verified at press, back-fill provenance); a room wanting one writes it into the CHANGELOG
// entry itself, inside the entry's own body, before the tag, and it rides through as part of
// sectionsBody like any other line.
export function buildReleaseBody(summary, sectionsBody) {
  return sectionsBody ? `${summary}\n\n${sectionsBody}\n` : `${summary}\n`;
}
