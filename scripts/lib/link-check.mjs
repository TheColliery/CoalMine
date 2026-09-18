// CW-017 — a small zero-dep walker for CoalMine's own tracked markdown: internal relative
// links and in-doc anchors, per .github/SKILL-REPO-PATTERN.md:91's canon DEFAULT ("a small
// scripts/lib/link-check.mjs walking the repo's own tracked .md files"). Deliberately NOT an
// AST engine -- CoalLedger's scripts/lib/md-checks.mjs already is one (CoalLedger's own
// CWK-092 unit measured it already satisfies the canon -- CoalLedger holds that measurement,
// not this room), and vendoring a copy here would be the duplicate-ownership defect ONE
// FLOCK ONE COLOR bans (AGENTS.md).
//
// SCOPE: INTERNAL links only -- a relative path to another tracked file, optionally followed
// by a #anchor, or a bare #anchor into the CITING file itself. An external http(s)/mailto/ftp
// target or a site-root `/absolute` path is OUT OF SCOPE by design (Phoenix #7,
// no-external-assumption -- reachability of an external URL needs a network call this room
// does not make; a site-root path needs a hosting root this walker cannot know).
//
// NAMED RESIDUE -- stated rather than implied complete, this room's own habit. The slugifier
// below approximates GitHub's own heading-anchor algorithm (lowercase, punctuation dropped,
// spaces to hyphens, duplicate headings suffixed -1/-2/...) and does NOT special-case:
// non-ASCII (CJK/Thai) headings, inline HTML surviving inside a heading beyond a plain tag
// strip, or reference-style links (`[text][ref]` + a separate `[ref]: target` definition) --
// only INLINE links `[text](target)` are extracted. A doc that exercises just one of these is
// invisible to this walker; the residue is named here so it is never mistaken for coverage.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Strip FENCED code blocks only -- a line matching `^#{1,6} ...` INSIDE a fenced
// example is not a real heading. Replaced with the same number of newlines so
// line-based heading matching downstream is unaffected by the removal.
function stripFencedBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, (m) => '\n'.repeat((m.match(/\n/g) || []).length));
}

// Strip fenced blocks AND inline code spans -- for LINK extraction, where a
// documentation EXAMPLE showing markdown link syntax inside a code span is not a real
// link to check. NEVER used for heading slugging (see headingSlugs below) -- GitHub
// renders an inline code span's CONTENT as plain text in a heading, only the backtick
// MARKUP is dropped, and slugify's own disallowed-char filter already does that.
function stripCode(text) {
  return stripFencedBlocks(text).replace(/`[^`\n]*`/g, '');
}

const HEADING_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
const LINK_RE = /\[([^\]]*)\]\(([^)\s]+)(?:[ \t]+"[^"]*")?\)/g;
const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i; // a scheme: or a protocol-relative //
// CodeQL #68 (js/incomplete-multi-character-sanitization, HIGH) fires here: a single
// PASS of a paired-delimiter tag-strip could in general leave a re-formed tag behind
// (`<<a>b>` stripped once -> `<b>`). DISMISSED, not fixed -- the slug rule is held
// (main's ruling, CWK-098) and this line is not a sanitiser in the sense the query
// assumes. Two properties make the alert's threat (a re-formed `<script>` surviving
// into a renderer) unreachable by construction, both true of every call site: (1) the
// very next filter in this same function, `.replace(/[^\w -]/g, '')`, strips EVERY `<`
// and `>` unconditionally, regardless of what this line's single pass left behind --
// so even a re-formed tag never survives slugify() at all, proven by
// link-check.test.mjs's adversarial pin (`<<a>b>`, `<scr<script>ipt>`, `<<<x>>>`); (2)
// slugify()'s return value is NEVER used as markup, a shell argument, or a filesystem
// path -- headingSlugs() only ever inserts it into a Set, and checkFile() only ever
// calls Set.has() on it. There is no reachable interpreter downstream for a tag to
// re-form INTO. Both are re-verifiable at source: grep this file for `slugify(` (one
// caller) and for `headingSlugs(` (two callers, both `.has(...)`, neither an HTML
// context). Sibling walkers (CoalFace, CoalTipple) use an allowlist keep-filter
// instead of a paired-delimiter strip and never hit this query at all -- a different
// mechanism, not a scan gap this room's shape happens to dodge.
const HTML_TAG_RE = /<\/?[a-z][^>]*>/gi;

// GitHub's own algorithm (documented behaviour of github-slugger, its reference
// implementation): strip a surviving HTML tag, lowercase, drop anything that is not a
// word char / SPACE / hyphen (github-slugger's disallowed class includes the C0
// control range \0-\x1F, which a TAB falls in -- so a tab is DROPPED here, not kept and
// later hyphenated; r33 RE-INSPECT LOW-A, `## a<TAB>b` -> ours previously `a-b`,
// GitHub's real `ab` -- this class no longer keeps `\t` at all), each SPACE to a hyphen
// INDIVIDUALLY -- DELIBERATELY NO trim step and DELIBERATELY NO run-collapsing. Two
// live, measured consequences: (1) a heading starting with an emoji (common in this
// repo's own headings, e.g. "## 🔌 Universal Agent Support") strips to a LEADING space
// that GitHub turns into a LEADING hyphen (`-universal-agent-support`), never trimmed
// away -- confirmed against this repo's own shipped README/CONTRIBUTING anchors, which
// is what caught this walker's first-draft false-positive (it trimmed, GitHub does
// not); (2) an em dash flanked by two spaces (`text — text`) strips the dash but keeps
// BOTH flanking spaces, which a COLLAPSING replace would fold into one hyphen and a
// non-collapsing one (this) turns into TWO -- confirmed against evals/README.md's own
// live heading, "# CoalMine evals — `rot-canary` pilot" -> GitHub's real anchor is
// `coalmine-evals--rot-canary-pilot` (double hyphen), reproduced only by NOT
// collapsing runs.
function slugify(heading) {
  return heading
    .replace(HTML_TAG_RE, '')
    .toLowerCase()
    .replace(/[^\w -]/g, '')
    .replace(/ /g, '-');
}

// Every heading's slug, duplicates suffixed -1, -2, ... in document order (GitHub's
// rule). Only FENCED blocks are stripped before extraction -- an inline code span
// WITHIN a real heading (`` `rot-canary` `` above) is markup GitHub renders as plain
// text, so its CONTENT belongs in the slug; slugify's own disallowed-char filter
// strips just the backtick markers, matching GitHub's real anchor rather than
// erasing the whole span (the LOW-5 defect this comment replaces: the walker's
// first-draft `headingSlugs` ran the LINK-extraction `stripCode` -- which removes an
// inline span's content, not just its markers -- over headings too, so a doc linking
// its own real, working GitHub anchor for a code-spanned heading was reported DEAD).
export function headingSlugs(text) {
  const seen = new Map();
  const slugs = new Set();
  const stripped = stripFencedBlocks(text);
  let m;
  HEADING_RE.lastIndex = 0;
  while ((m = HEADING_RE.exec(stripped))) {
    const base = slugify(m[2]);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
}

export function extractLinks(text) {
  const links = [];
  const stripped = stripCode(text);
  let m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(stripped))) {
    links.push({ text: m[1], target: m[2] });
  }
  return links;
}

// One file's findings. `readFile` is injected so a unit test can drive this against an
// in-memory fixture set without touching a real filesystem.
export function checkFile(filePath, repoRoot, readFile = (p) => fs.readFileSync(p, 'utf8')) {
  const findings = [];
  const raw = readFile(filePath);
  const ownSlugs = headingSlugs(raw);

  for (const { target } of extractLinks(raw)) {
    if (!target || target.startsWith('mailto:') || EXTERNAL_RE.test(target)) continue;

    const hashIdx = target.indexOf('#');
    const filePart = hashIdx === -1 ? target : target.slice(0, hashIdx);
    const anchorPart = hashIdx === -1 ? '' : decodeURIComponent(target.slice(hashIdx + 1));

    if (!filePart) {
      // A bare `#anchor` targets a heading in THIS file.
      if (anchorPart && !ownSlugs.has(anchorPart)) {
        findings.push(`${filePath}: dead anchor #${anchorPart} — no matching heading in this file`);
      }
      continue;
    }
    if (filePart.startsWith('/')) continue; // site-root-relative — out of scope, named above.

    const targetAbs = path.resolve(path.dirname(filePath), filePart);
    if (!fs.existsSync(targetAbs)) {
      findings.push(`${filePath}: dead link -> ${target} (not found: ${path.relative(repoRoot, targetAbs)})`);
      continue;
    }
    if (anchorPart && targetAbs.toLowerCase().endsWith('.md')) {
      const targetSlugs = headingSlugs(readFile(targetAbs));
      if (!targetSlugs.has(anchorPart)) {
        findings.push(`${filePath}: dead anchor -> ${target} (no matching heading in ${path.relative(repoRoot, targetAbs)})`);
      }
    }
  }
  return findings;
}

export function checkFiles(filePaths, repoRoot) {
  const findings = [];
  for (const f of filePaths) findings.push(...checkFile(f, repoRoot));
  return findings;
}

// ─── CLI ────────────────────────────────────────────────────────────────────
// `node scripts/lib/link-check.mjs <file> [<file> ...]` — every argument is a path,
// resolved relative to CWD. Prints each finding, then a summary line
// (`N finding(s) across M file(s)`), and sets process.exitCode = 1 on any finding — this
// walker has exactly one consumer (its own workflow step) and no reason to stay exit-0
// on a findings run the way a skill-shared engine would.
function main() {
  const files = process.argv.slice(2).map((f) => path.resolve(f));
  // repoRoot is ONLY used to render a finding's "not found:" path -- cwd, not this
  // script's own location, since the real workflow invokes `node scripts/lib/
  // link-check.mjs $files` FROM the checked-out repo root (matching where its
  // `git ls-files` scope was computed). Head finding HF-2: the prior "two dirs up
  // from this file" derivation was correct only for a caller whose files live inside
  // THIS repo -- a throwaway fixture elsewhere rendered a long unreadable `..` ladder.
  const repoRoot = process.cwd();
  const findings = checkFiles(files, repoRoot);
  for (const f of findings) console.log(f);
  console.log(`${findings.length} finding(s) across ${files.length} file(s)`);
  if (findings.length > 0) process.exitCode = 1;
}

// Windows-safe entry-point check: compare RESOLVED PATHS, not raw URL strings --
// `file://C:/...` vs a bare `C:\...` argv never string-match, per node/runtime.md
// section 6's own drive-letter warning.
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? '')) {
  main();
}
