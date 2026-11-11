// UMB-162 (a) — "WRITE ONCE, DERIVE EVERYTHING" (owner-proposed, main-confirmed 2026-09-21).
// Parses a CHANGELOG.md's version entry (the top one; with a package, that package's first; with `exact`, the heading of one named version) into the pieces a GitHub Release's title and body
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

// UMB3-193 (2026-11-09): the multi-package form (RELEASE-PATTERN.md, "The multi-package form"). A repository that ships more than one package on
// independent version lines tags each line `<pkg>-vX.Y.Z` and heads each entry `## [<pkg> X.Y.Z] - YYYY-MM-DD`. The package name is lower-case letters
// and digits opening with a letter: a hyphen inside it would read as the pre-release marker (the gate's `*-*`, the previous-stable walk's strict grammar), a capital,
// a dot or an underscore would let one package be spelled two ways between its tag and its heading. A single-package repository's tags are bare, pkg ''.
const TAG_FORM = /^(?:([a-z][a-z0-9]*)-)?v(\d+\.\d+\.\d+)(-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;
// { pkg, version, pre } for a tag of the form (pre '' on a stable tag), null for anything else: the one grammar every caller reads a tag by.
export function parseReleaseTag(tag) {
  const m = typeof tag === 'string' ? tag.match(TAG_FORM) : null;
  return m ? { pkg: m[1] ?? '', version: m[2], pre: m[3] ?? '' } : null;
}
// The tag of a version on a package line, and the label its CHANGELOG heading carries.
export const tagOf = (pkg, version) => `${pkg ? pkg + '-' : ''}v${version}`;
const labelOf = (pkg, version) => (pkg ? `${pkg} ${version}` : version);

// UMB-182 default-Latest. GitHub marks a new Release "Latest" unless the create call says otherwise
// (measured on CoalFace's rehearsal: a throw-away v0.0.2 took Latest from v0.11.0). A Release for a
// version OLDER than the current Latest -- a patch on an older line, or a back-fill (UMB-189) -- must be created with
// make_latest "false". Returns the string the workflow hands to `gh release create/edit --latest=`.
// `latestTag` is '' when the repo has no Latest yet. With a package (UMB3-193), Latest moves only within the package line: a Latest on another
// line (another package's, or a bare tag) is left standing with "false", never compared, so a back-fill on one line never displaces another line's badge.
export function makeLatestFlag(tagVersion, latestTag, pkg = '') {
  if (!latestTag) return 'true';
  let latestVersion = latestTag;
  if (pkg) {
    const p = parseReleaseTag(latestTag);
    if (!p || p.pre) throw new ReleaseRefError(`the current Latest release is tagged "${latestTag}", not a bare vX.Y.Z or <pkg>-vX.Y.Z -- refusing to guess whether ${pkg}-v${tagVersion} should take Latest`);
    if (p.pkg !== pkg) return 'false';
    latestVersion = `v${p.version}`;
  }
  const l = latestVersion.match(BARE_TAG);
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
// of the previous stable tag (the nearest reachable tag in the strict stable grammar of the line, found by the workflow's walk). When given, the first STABLE
// `## [X.Y.Z]` heading after the released entry must be that version -- pre-release headings in
// between are skipped. This catches the class the byte re-read cannot see: a heading REPLACED instead
// of inserted above, which silently publishes the older entry's sections as the new release's notes.
//
// UMB3-193: with `pkg` (the multi-package form) the entry is the FIRST heading of THAT package (`## [<pkg> ...]`), other packages' entries above it are
// skipped, the label compared is `<pkg> X.Y.Z`, and the continuity check reads the next stable heading of the same package only.
// UMB3-193 round 3: with `exact` the entry is found by its own label wherever it sits (the back-fill of a tag cut before its entry reads the default
// branch's CHANGELOG, which has newer entries above that version); without it the top (or the package's first) entry must be the one.
const headingLabel = (line) => line.match(/^##\s*\[([^\]]+)\]/)?.[1];

// true when the file has a heading for exactly this version (and package): the test that decides whether the tag's own tree can be read.
export function hasEntryHeading(changelogText, tagVersion, pkg = '') {
  const label = labelOf(pkg, tagVersion);
  return String(changelogText).split(/\r?\n/).some((l) => headingLabel(l) === label);
}

export function extractChangelogEntry(changelogText, tagVersion, { previousStable = '', pkg = '', exact = false } = {}) {
  const lines = changelogText.split(/\r?\n/);
  const label = labelOf(pkg, tagVersion);
  const headingRe = pkg ? new RegExp(`^##\\s*\\[${pkg} `) : /^##\s*\[/;
  const headingIdx = exact ? lines.findIndex((l) => headingLabel(l) === label) : lines.findIndex((l) => headingRe.test(l));
  if (headingIdx === -1) {
    if (exact) throw new ChangelogShapeError(`CHANGELOG.md has no [${label}] heading ("## [${label}] - YYYY-MM-DD")`);
    throw new ChangelogShapeError(pkg ? `CHANGELOG.md has no [${pkg} X.Y.Z] heading ("## [${pkg} X.Y.Z] - YYYY-MM-DD")` : 'CHANGELOG.md has no version heading ("## [X.Y.Z] - YYYY-MM-DD")');
  }

  // the unfinished entry is named before the date is read: the standard `## [Unreleased]` carries no date, so reaching the date check first reported it as a malformed heading (14h, CoalLedger #8)
  if ((pkg ? new RegExp(`^##\\s*\\[${pkg}\\s+unreleased\\s*\\]`, 'i') : /^##\s*\[\s*unreleased\s*\]/i).test(lines[headingIdx])) {
    throw new ChangelogShapeError('top entry is still [Unreleased] -- the CHANGELOG entry is written and finalized BEFORE the tag (RELEASE-PATTERN.md "The chain around the press", step 1)');
  }
  const m = lines[headingIdx].match(/^##\s*\[([^\]]+)\]\s*-\s*(\d{4}-\d{2}-\d{2})\s*$/);
  if (!m) throw new ChangelogShapeError(`top heading "${lines[headingIdx].trim()}" is not "## [X.Y.Z] - YYYY-MM-DD"`);
  const [, found, date] = m;
  if (found !== label) {
    throw new ChangelogShapeError(`${pkg ? `first [${pkg}] entry` : 'top entry'} is [${found}] but the pushed tag is ${tagOf(pkg, tagVersion)} -- the CHANGELOG entry must match the tag it is cut for`);
  }
  const version = tagVersion;

  const rest = lines.slice(headingIdx + 1);
  if (previousStable) {
    const stableRe = pkg ? new RegExp(`^##\\s*\\[${pkg} (\\d+\\.\\d+\\.\\d+)\\]`) : /^##\s*\[(\d+\.\d+\.\d+)\]/;
    const nextStable = rest.map((l) => l.match(stableRe)).find(Boolean)?.[1];
    if (nextStable !== previousStable) {
      throw new ChangelogShapeError(`the [${label}] entry is followed by ${nextStable ? `[${labelOf(pkg, nextStable)}]` : 'no stable heading'}, but the previous stable tag is ${tagOf(pkg, previousStable)} -- an entry heading was replaced instead of inserted above, or the previous release's entry is missing`);
    }
  }
  const nextHeadingIdx = rest.findIndex((l) => /^##\s/.test(l));
  const body = nextHeadingIdx === -1 ? rest : rest.slice(0, nextHeadingIdx);

  const firstContentIdx = body.findIndex((l) => l.trim() !== '');
  if (firstContentIdx === -1) throw new ChangelogShapeError(`the [${label}] entry is empty`);
  if (/^###\s/.test(body[firstContentIdx])) {
    throw new ChangelogShapeError(`the [${label}] entry has no one-line summary before its first "### " section -- add one sentence stating what changed and why it matters (this becomes the Release's title and Lead)`);
  }
  const summary = body[firstContentIdx].trim();
  // The summary becomes the Release title, the announcement and every log line that prints them, so a control character in it (C0, DEL or C1:
  // an escape sequence, a lone carriage return) refuses the entry by name, and only its code point is echoed, never the character (CWE-117).
  for (const ch of summary) {
    const c = ch.codePointAt(0);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) throw new ChangelogShapeError(`the [${label}] summary line carries a control character (code point ${c}) -- remove it; the summary becomes the Release title`);
  }

  const afterSummary = body.slice(firstContentIdx + 1);
  const sectionsStart = afterSummary.findIndex((l) => /^###\s/.test(l));
  const sectionsBody = sectionsStart === -1 ? '' : afterSummary.slice(sectionsStart).join('\n').trim();
  // The lead paragraph: whatever sits between the summary line and the first "### " heading. It is where a longer explanation goes, so the
  // summary (the title) can stay short; it rides into the body right after the Lead.
  const lead = (sectionsStart === -1 ? afterSummary : afterSummary.slice(0, sectionsStart)).join('\n').trim();

  return { version, date, summary, lead, sectionsBody };
}

// The title's summary length is a SIGNAL with a band, never a hard cap (RELEASE-PATTERN.md "The title", BA-14): aim 60 characters, 45 to 75
// passes clean, outside the band a named warning that passes. The numbers are the house's own; no formal standard sets one.
export const SUMMARY_AIM = 60;
export const SUMMARY_BAND = [45, 75];

// null when the summary part of a "vX.Y.Z - <summary>" title is inside the band (or there is no summary to measure); else the warning text.
export function titleBandWarning(title) {
  const at = String(title).indexOf(' - ');
  if (at === -1) return null;
  const n = Array.from(String(title).slice(at + 3).trim()).length;
  if (n >= SUMMARY_BAND[0] && n <= SUMMARY_BAND[1]) return null;
  return `release-title-band: the summary in the title is ${n} characters, outside the band ${SUMMARY_BAND[0]} to ${SUMMARY_BAND[1]} (aim ${SUMMARY_AIM}). Shorten the CHANGELOG summary line and put the longer explanation in a lead paragraph under it (it rides into the body), or keep it and state the reason in the checker's return.`;
}

// UMB-433: the organisation's Announcements discussion mirrors a Release as "<Repo> <Release title>", and GitHub's discussion-title
// ceiling is a hard 200 (it stored a 211-character title as 199, n = 1). A title that fits is mirrored whole; one that does not is never cut
// by a machine and never posted bare: the DRAFTER re-composes the summary BEFORE the tag (release-notes.mjs --check fails it by name), and
// the announcer holds a post that still overflows. One definition here, used by both. Counted in UTF-16 units, the conservative count.
export const MIRROR_TITLE_CAP = 200;

export function mirroredTitle(repo, tag, releaseName) {
  const name = String(releaseName || '').trim();
  // The tag is the name's own prefix only at a boundary: "v2.7.0" is not the prefix of "v2.7.01" or "v2.7.0-rc1" (UMB-456 (1) iv). A multi-package
  // tag `py-v0.0.1` opens its title as `py v0.0.1` (UMB3-193), so that spelling is the one looked for.
  const opening = tag.replace(/^([a-z][a-z0-9]*)-v/, '$1 v');
  const named = name.startsWith(opening) && /^(\s|$)/.test(name.slice(opening.length));
  return name ? (named ? `${repo} ${name}` : `${repo} ${tag} - ${name}`) : `${repo} ${tag}`;
}

// null when the mirrored title fits; else the named message the pre-tag check prints (and the announcer's run summary repeats).
export function mirroredTitleOverflow(repo, tag, releaseName) {
  const title = mirroredTitle(repo, tag, releaseName);
  if (title.length <= MIRROR_TITLE_CAP) return null;
  return `release-title-cap: the announcement title "${title}" is ${title.length} characters, over GitHub's ${MIRROR_TITLE_CAP}-character title ceiling. Re-compose the CHANGELOG summary line shorter (aim ${SUMMARY_AIM}) and move the longer explanation to a lead paragraph under it, before the tag.`;
}

// "vX.Y.Z - <summary>" per RELEASE-PATTERN.md "The title": bare version, spaced hyphen,
// lower-case sentence style, no trailing period. The summary text itself is the CHANGELOG
// author's own words, used near-verbatim (only the leading letter is case-adjusted, and only
// when it looks like an ordinary sentence start rather than an acronym/identifier) -- a
// machine composes the SHAPE, never the WORDING. With a package (UMB3-193) the title opens `<pkg> vX.Y.Z - <summary>`.
export function buildReleaseTitle(version, summary, pkg = '') {
  let s = summary.replace(/\.\s*$/, '');
  // Lower-case the leading letter of an ordinary sentence opener ("A project..." -> "a project..."). Only an ORDINARY opener lowers:
  // ONE capital followed by lower-case letters (with an optional contraction, hyphenated lower-case compound or closing punctuation:
  // "Fixed,", "It's", "Two-phase"). Every other opener is left as written: "CoalFace", "McKinsey", "SHA256SUMS.txt", "CI", "V8",
  // "Node.js", "Python3" (UMB-417, pass 14 A-2).
  // THE CEILING, named (pass 15 A-2): a proper noun with ONE leading capital ("Windows", "Linux", "Cloudflare", "Thai") has the shape of an
  // ordinary word, and no shape test can tell it from "Fixed", so it lowers ("windows paths ..."). The DRAFTER words such a summary verb
  // first, or accepts the lowered name; the CHECKER looks for it (RELEASE-PATTERN.md, "The title", Summary row).
  const firstWord = s.match(/^\S+/)?.[0] ?? '';
  const ordinaryOpener = /^[A-Z][a-z]*(?:['\u2019][a-z]+)?(?:-[a-z]+)*[.,;:!?)]*$/.test(firstWord);
  if (ordinaryOpener) s = s[0].toLowerCase() + s.slice(1);
  return `${pkg ? pkg + ' ' : ''}v${version} - ${s}`;
}

// Part 1 (Lead) + Part 2 (What changed) per RELEASE-PATTERN.md "The body". The summary line IS
// the Lead, exactly as written in the CHANGELOG (a body sentence keeps its own capitalization,
// unlike the title). Parts 3-5 (What you need to do / Gate / Provenance) are NOT derived here
// -- each needs judgement this function has no way to supply (an action item, a figure
// verified at press, back-fill provenance); a room wanting one writes it into the CHANGELOG
// entry itself, inside the entry's own body, before the tag, and it rides through as part of
// sectionsBody like any other line.
export function buildReleaseBody(summary, sectionsBody, lead = '') {
  return `${[summary, lead, sectionsBody].filter(Boolean).join('\n\n')}\n`;
}
