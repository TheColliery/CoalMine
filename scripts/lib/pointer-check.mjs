// CWK-075 — POINTER gate. Ship-text names something that cannot be reached.
//
// WHY THIS IS NOT CWK-060's GATE. That one resolves KEYS against config-schema.mjs.
// These are POINTERS — to a file, a directory, a section, a symbol — and nothing
// resolved them. Same family, different resolver: the key gate asks "is this name in
// the schema", this one asks "is the thing this name points at REACHABLE FROM A CLONE".
//
// THE CHAIR'S RULING THIS ENFORCES (settled; this module does not re-decide it):
// a probe cited as proof is not a throwaway. Cite the DURABLE artefact — a commit SHA,
// a reviewer return, a lab record — and recycle the probe; if the probe file is the only
// evidence, it has stopped being a throwaway, so commit it or restate the claim. A
// GITIGNORED PATH IS NOT A DURABLE CITATION. The gate enforces that distinction. It does
// NOT ban citations, and the shape of that restraint is the whole detection rule below.
//
// ============================================================================
// DETECTION RULE — every step MEASURED on this repo's own shipped surfaces (re-derive
// with `node scripts/verify.mjs`'s own 2.11 pass line, never quote a number here
// forward -- the same rule the MEASURED-on-this-repo snapshot below already states for
// itself) before it was chosen, because cry-wolf is the failure mode this room has
// already paid for once (the tripwireMaxLines gate firing on compliant code).
//
// r33 INSPECT LOW-6: this sentence previously cited that snapshot BY LINE NUMBER
// (":40") -- a locator transcribed into the SAME commit that moved it, the identical
// shape as r32's own MEDIUM-1. Per this room's own r32 convention, a CONTENT anchor
// only, never a line number, from here on.
//
//   The rule is TWO layers, and which layer a test belongs to is not cosmetic:
//   SHAPE tests live in pointerCandidates (text only, no tree knowledge); SCOPE tests
//   live in checkPointers (ourRoots, agentHomes, hasEntry). A shape rule that needs the
//   tree is a rule in the wrong place, and CWK-075 r2 moved one back after it silently
//   excluded four of our own tracked files.
//
//   SHAPE (pointerCandidates)                          drops
//     - whitespace                a command or a Markdown table row, not a pointer
//     - <placeholder>             the author already said "not a literal path"
//     - glob metacharacter        a glob names a SET, not a file
//     - no `/`                    a bare filename is the SCANNED user's repo's
//     - absolute / `~` / URL      not this repo's to resolve
//     - a `.` or `..` SEGMENT     navigates, does not NAME; and would escape the repo
//
//   SCOPE (checkPointers)                              decides
//     - an agent install home     the SCANNED project's tree, even where the root is ours
//     - first segment in ourRoots resolve from the repo root
//     - first segment beside the  resolve from the citing file's own directory (or its
//       citer (or its parent)     parent) -- structural, so it is never circular
//
//   MEASURED on this repo, 84 surfaces: 1,510 backticked tokens with fenced code
//   stripped -> 131 survive the shape funnel -> 71 IN SCOPE -> 71 resolve, 0
//   non-resolving, 0.0% noise. A DATED SNAPSHOT, and it drifts as this very header
//   gains citations -- it read 67 while the breakdown below already said 71, the two
//   halves of one comment disagreeing. Re-derive with the walk in verify.mjs 2.11 and
//   read the gate's own pass line; never quote these numbers forward.
//
//   THE TWO SCOPE TESTS ARE CWK-075 ROUND 2, AND BOTH CLOSED A SILENT HOLE, which is the
//   quieter failure and the one this whole class is about. Before them the gate was
//   repo-root-anchored and dropped every dot-first token, so 40 citations were checked
//   where 67 were checkable:
//     +15  citer-relative -- `references/checks.md` cited from its own skill dir was
//          never checked at all. A sibling room's gate called such a path NON-RESOLVING
//          (a loud false positive); ours dropped it from coverage without a word.
//     +16  dot-dir -- `.claude-plugin/plugin.json`, `.githooks/`, `.github/workflows/ci.yml`
//          are real TRACKED files of ours that the extractor discarded on sight. TWELVE
//          were in the surfaces as they stood; the other four are dot-dir citations this
//          very header adds while explaining the fix, and they are dot-dir citations like
//          any other -- an earlier wording counted them as a separate "+4 new header"
//          term, which double-counts the same tokens under two labels. 15 + 16 = 31, and
//          40 + 31 = 71, the number the pass line reports.
//   Noise stayed 0.0% across both, which is the number that had to hold.
//
// THE INSIGHT THAT MAKES THE RULE WORK, and a naive rule unusable: a shipped skill's
// prose names files in the SCANNED USER's repo — `package-lock.json`, `STANDARDS.md`,
// a bare `SKILL.md` — which by construction do not exist in ours. Those are not
// pointers into our tree at all. Steps 5-8 are four different ways of saying the same
// thing: only a path ROOTED IN OUR OWN TREE is a claim this repo can be wrong about.
//
// Steps 2, 3, 6 and 7 were NOT in the rule as first sketched, and each removed a whole
// class of false positive that a directory-component rule alone leaves standing:
//   2  shell commands and Markdown table rows are path-shaped (`node scripts/install.mjs
//      cursor`, `| package | direct/transitive | ... |`) — a SPACE is what separates a
//      command from a pointer.
//   3  `<gitroot>/.coalmine.json`, `plugin/skills/<name>/SKILL.md` are TEMPLATES; the
//      angle bracket is the author already saying "this is not a literal path".
//   6  a URL or an absolute path is not this repo's to resolve.
//   7  `.cursor/skills/`, `.gemini/skills/`, `.claude/rules/`, `.git/hooks` — a DOT-DIR
//      is an agent or tool HOME, and shipped prose names those in the USER's project.
//      This is step 8's insight one level up, and without it the residue is 15.9% noise
//      of which every single flag is wrong.
//
// NAMED BLIND SPOTS — stated as what is UNCOVERED, with its measured cost, never as a
// denial. A reader who is only told what the gate is NOT learns nothing about what is
// exposed; this room's own flock rail, applied to this gate first.
//
//   1. AN UNBACKTICKED PATH IS INVISIBLE. Extraction keys on backticks, so a path named
//      in plain prose is never a candidate — it cannot fail, and it cannot be counted in
//      the pass line either. MEASURED, fenced code stripped FIRST (a sibling room's own
//      count moved 6 -> 7 -> 2 the moment fences were stripped, so the order is part of
//      the measurement): 2 unbackticked path-shaped tokens rooted in our own tree, and
//      BOTH are grep artefacts rather than citations — "skills/_shared" is a Markdown H1
//      that happens to be a directory name, and "hooks/scripts" in README is English
//      prose meaning "hooks and scripts". They are quoted here WITHOUT backticks on
//      purpose: backticking them makes them real citations, and when this paragraph was
//      first written the gate FAILED on this very comment, naming the second token as a
//      citation that does not resolve. The documentation of a blind spot must not
//      manufacture one — twice over, since the first reword quoted the FAIL message
//      verbatim and re-introduced the backticks it was reporting. So the uncovered
//      population is 2 tokens and 0 real citations today. That is the cost, and it is
//      small because the house style already backticks paths — not because the gate
//      reaches them.
//
//   2. A SECTION AND A SYMBOL ARE NOT RESOLVED AT ALL. Not "the gate is path-only" — the
//      uncovered things are: a `file.md` §Heading whose heading has moved, and a
//      backticked identifier in a comment whose symbol has been renamed. Both were
//      measured and both flood (below); nothing checks them, and the pass line says so.
//
// ============================================================================
// WHAT IS NOT SHIPPED, AND THE MEASUREMENT THAT DECIDED IT. The dispatch asked for
// three resolvers — path, section, symbol. PATH is shipped. The other two were measured
// FIRST and both flood; shipping them would have been the cry-wolf gate this rule's own
// step-by-step exists to avoid.
//
//   SECTION ("the X section below", `file.md` §Heading):
//     - SELF-REFERENTIAL pointers are a population of FOUR across every .md and .mjs in
//       the tree, and all four resolve. A gate over four passing candidates buys nothing.
//     - Worse, the matcher cannot be made honest: run against CWK-059's own history
//       (`config-keys.mjs` at 04116d1 and 209689b) a "<token> ... below" rule reports
//       8 candidates and 6 DANGLING — and all six are false, because natural language
//       puts the wrong word next to "below" (`matches KEY_SHAPE below` is read as
//       "matches ... below"). 75% noise, 100% of it wrong.
//     - CROSS-FILE section refs are ~55 and the overwhelming majority target files that
//       do not exist here at all (`hooks-safety.md` §9, `skill-authoring.md` §3b live in
//       the umbrella). Resolving them is not this repo's job.
//
//   SYMBOL (a backticked identifier in our own code comments):
//     - 45 candidates, 37 resolve, 8 do not — 17.8% noise, AND ALL EIGHT FLAGS ARE
//       FALSE. Every one is a symbol named as a REJECTED ALTERNATIVE or an external
//       stdlib name the comment says we do NOT call (`renameSync`, `statSync`,
//       `appendFileSync`, `ignoreExclusions`, `disableFilters`). Discriminating "named
//       as the thing we use" from "named as the thing we rejected" is prose parsing, and
//       after such a filter the surviving population is all-resolving — a gate that
//       catches nothing.
//
//   So: partial coverage, STATED. Path is machine-checked; section and symbol are not
//   checked at all, by these numbers, and nobody should read this gate's green as
//   covering them.
//
// ============================================================================
// ADOPTER CONTRACT — DATA, never LOGIC. Six rooms reached six different verdicts on
// CWK-060's filter and this rule will fare no better, so nothing below hardcodes
// CoalMine's layout. A room supplies: its own surfaces (walked -- `DEFAULT_SURFACE_PLAN`
// below is this room's DEFAULT declaration of that supply, not a hardcoded fact about
// every room), its own ourRoots and ignoredRoots (derived from ITS tree), its own
// agentHomes (derived from whatever map that tool uses to write into a USER's tree —
// ours is scripts/lib/targets.mjs), its own hasEntry() and resolve(), and its own
// pending list. Every one of those is DATA read out of the adopting tree; none of them
// is a decision this module makes for a room.

// SURFACE PLAN, DECLARED (CWK-090 fix 3, CoalHearth's finding). "scripts/ comments are a
// walked surface" was CODE in `verify.mjs` -- five hardcoded for-loops with no countable
// home, so a room copying the shape had to READ the driver to know what it walks. That
// is THIS room's own variable, not the flock's: CoalHearth's own ship-text names eight
// walked surfaces, none under scripts/. Now it is DATA, one row per walked surface, each
// carrying its own `why` -- the same reason `DECLARED_OUT` (verify.mjs) is data and not a
// comment: a prose list restating a table is a second source of truth that drifts.
//
// THE NARROWING FORM, one sentence an adopter copies rather than guesses: a room that
// walks fewer surfaces DELETES the row and states its reason in the row's own `why`,
// never by editing `collectSurfaces` or leaving the row in place unused.
//
// `kind` is one of four: `md` (a directory of markdown files, walked recursively, whole
// text) · `raw` (a single file's whole text, OR a directory walk with an extension
// filter and no comment-line stripping) · `comments` (a directory walk, `//`/`*`-prefixed
// lines only) · `hash-comments` (a directory walk, `#`-prefixed lines only). `dir: true`
// means `root` is a directory to walk; its absence means `root` is one exact file.
// `historyOnly: true` marks a surface `checkPointers` binds to the gitignored-root case
// only, never the ordinary resolve check (CHANGELOG.md — published history is never
// fixed forward).
export const DEFAULT_SURFACE_PLAN = [
  { kind: 'md', root: 'skills', dir: true,
    why: 'every canary body is ship-text a user reads' },
  { kind: 'md', root: 'commands', dir: true,
    why: 'command docs are ship-text a user reads' },
  { kind: 'md', root: 'agents', dir: true,
    why: 'the fan-out worker doc is ship-text a user reads' },
  { kind: 'raw', root: 'README.md',
    why: 'the front door -- every install/config claim starts here' },
  { kind: 'raw', root: 'CONTRIBUTING.md',
    why: 'the dev-facing surface, and it cites internal paths' },
  { kind: 'raw', root: 'SECURITY.md',
    why: 'the disclosure surface, and it cites internal paths (e.g. a hook line ref)' },
  { kind: 'raw', root: 'PRIVACY.md',
    why: 'the privacy surface, and it cites internal paths' },
  { kind: 'comments', root: 'scripts', dir: true, ext: /\.(mjs|js)$/,
    why: 'a path inside CODE is exercised by the tests; a path inside a COMMENT is exercised by nothing at all -- CoalHearth\'s own finding: this row is CoalMine\'s own variable, not the flock\'s' },
  { kind: 'comments', root: 'hooks', dir: true, ext: /\.(mjs|js)$/,
    why: 'same class as the scripts/ row, hooks/ side' },
  { kind: 'hash-comments', root: '.githooks', dir: true,
    why: '.githooks/ and hooks/ are physically separate directories (AGENTS.md) -- a glob scoped to hooks/** never reaches these' },
  { kind: 'hash-comments', root: 'scripts', dir: true, ext: /[.]ps1$/,
    why: 'a PowerShell fallback can live outside alt/, which is declared out at its own source' },
  { kind: 'hash-comments', root: 'hooks', dir: true, ext: /[.]ps1$/,
    why: 'same PS-outside-alt/ exposure, hooks/ side' },
  { kind: 'raw', root: '.github/ISSUE_TEMPLATE', dir: true, ext: /[.]yml$/,
    why: 'user-facing prose, unlike workflows/, which is CI machinery and stays declared out' },
  { kind: 'raw', root: 'CHANGELOG.md', historyOnly: true,
    why: 'published history is never fixed forward -- a path correct when the entry was written is not a defect now, but a gitignored citation was never correct on any day' },
];

// COLLECT — plan-driven, DI'd fs so this module stays pure (it imports nothing today and
// must not start). `io.join`/`io.walkMd`/`io.walkSrc`/`io.read`/`io.rel` are the SAME
// filesystem primitives the caller already owns; `io.commentLines`/`io.hashComments` are
// the two comment-line filters. `io.walkMd(dir)` returns absolute `.md` paths recursively;
// `io.walkSrc(dir, keep)` returns absolute paths whose basename passes `keep(name)`.
// Runs the plan in ORDER, so a room's own surface count/order is exactly its plan's —
// no hidden reordering.
export function collectSurfaces(repo, plan, io) {
  const surfaces = [];
  for (const row of plan) {
    if (row.dir) {
      const abs = io.join(repo, row.root);
      if (row.kind === 'md') {
        for (const f of io.walkMd(abs)) surfaces.push({ label: io.rel(f), text: io.read(f) });
      } else {
        const keep = row.ext ? (n) => row.ext.test(n) : () => true;
        for (const f of io.walkSrc(abs, keep)) {
          const src = io.read(f);
          let text;
          if (row.kind === 'comments') text = src === null ? null : io.commentLines(src);
          else if (row.kind === 'hash-comments') text = src === null ? null : io.hashComments(src);
          else text = src; // 'raw' dir-walk: whole file, no comment-line filter
          surfaces.push({ label: io.rel(f), text });
        }
      }
    } else {
      const s = { label: row.root, text: io.read(io.join(repo, row.root)) };
      if (row.historyOnly) s.historyOnly = true;
      surfaces.push(s);
    }
  }
  return surfaces;
}

// A path this room deliberately points at BEFORE it exists. Ships EMPTY, and the empty
// list is a MEASUREMENT, not an omission: every in-scope pointer resolves (67 of 67 at
// the CWK-075 r2 re-measurement), so nothing here has needed a declaration yet.
//
// The mechanism exists anyway, and that is a decision with a reason rather than padding:
// without an escape hatch the first legitimate forward pointer hard-FAILs, and the
// cheapest way to make a FAIL go away is to delete the gate. Same EVENT-based expiry as
// PENDING_KEYS/NOT_CONFIG — a declaration is pruned by what BECOMES TRUE, never by a
// date nobody re-reads.
export const PENDING_POINTERS = [
  // { path: 'scripts/lib/thing.mjs', reason: 'CWK-000 — landing next unit' },
];

// CHECK-IGNORE CLASSIFIER (CWK-090 fix 1), pure -- takes the exact shape a
// `spawnSync('git', ['check-ignore', '--stdin'], {...})` result carries and answers
// ONE question: did this run actually tell us anything? Exit 0 and exit 1 both
// SUCCEED (1 = "none of the fed paths are ignored", not an error); a spawn error or
// any OTHER status (128 included -- a bad pattern, an unreadable `.gitignore`, a
// broken worktree) means the run answered NOTHING, and the caller must not treat an
// empty stdout as "zero ignored". The PRE-FIX code (still `git show HEAD` at the time
// this was written) checked only `!ci.error` -- any non-0 status short of a spawn
// error fell through to "read stdout", silently produced an empty `ignoredRoots`, and
// printed a git-derived count over a run that derived no facts at all.
//
// Exported and kept pure so this classification is unit-testable without a real git
// child: CoalMine measured no reliable way to force git's own `check-ignore --stdin`
// to a non-0/1 exit while `ls-files` (verify.mjs's own pre-gate, same cwd) still
// succeeds -- every malformed-input shape tried (`.gitignore` as a directory,
// `core.excludesFile` pointing at a directory or a symlink loop, a malformed glob,
// `.git/info/exclude` as a directory, a non-repo cwd once `ls-files` no longer
// gates it) either degrades to exit 1 or is unreachable through verify.mjs's own
// hardcoded args. The one REAL non-0/1 exit reproduced on this box (129, an unknown
// option) needed a flag verify.mjs never passes -- proving the branch is possible
// for git to take, not that verify.mjs's own call can be driven there today.
export function classifyCheckIgnoreResult(ci) {
  if (ci.error) {
    return { ok: false, message: `git check-ignore --stdin failed to spawn: ${ci.error.message}` };
  }
  if (ci.status !== 0 && ci.status !== 1) {
    const stderrLine = typeof ci.stderr === 'string' ? ci.stderr.split('\n')[0].trim() : '';
    return {
      ok: false,
      message: `git check-ignore --stdin exited ${ci.status}${stderrLine ? ` -- ${stderrLine}` : ''} -- cannot tell which cited roots are gitignored`,
    };
  }
  // NAMED BOUND (CWK-090 findings-back LOW-1) -- exit 0 means AT LEAST ONE fed path
  // matched, but a non-string or empty-of-content stdout here would still answer
  // ok with zero recovered roots: git said something matched, this classifier would
  // conclude nothing did. UNREACHABLE today, on both halves -- `encoding: 'utf8'`
  // makes `ci.stdout` a string whenever the spawn itself did not error (caught by the
  // branch above), and verify.mjs never passes `-q` (the one flag that pairs a
  // silent, empty stdout with exit 0). A stated bound, not a guard: adding a branch
  // for a case nothing can reach is the over-hardening this room's own rules ban,
  // the same register as the two NAMED BOUNDs already carrying that exact phrase --
  // ROOT-LEVEL MASKING, `checkPointers` below in this file (CWK-078), and the
  // WIDENED bound in verify.mjs (CWK-079 findings-back MEDIUM-1).
  return { ok: true, stdout: typeof ci.stdout === 'string' ? ci.stdout : '' };
}

// THE PROBE SUFFIX -- a path UNDER a candidate root, never the bare root (CWK-090
// fix 2; see the TRAILING SLASH comment near the call site for why a bare-root feed
// false-matches). EXPORTED (CWK-092 flow-back 3, adopted UPWARD from CoalFace
// `d882832`) so no consumer can hold a hand-copied literal that drifts from the
// constant this module actually probes with.
export const PROBE_SUFFIX = '/.pointer-check-probe';

// APPLY the check-ignore probe's verdict onto a fresh Set, or FAIL loudly (CWK-090
// findings-back HIGH-1). `classifyCheckIgnoreResult` above is pure and well
// unit-tested; nothing tied THAT classification to the gate's own `fail()` --
// verify.mjs's own call site was an inline `if (!verdict.ok) { fail(...) } else
// {...}`, and mutating that one condition to `if (false)` left the whole suite
// byte-identically green (306/301/0/5), because nothing exercised the branch. Moved
// out of verify.mjs into this exported function so a unit test can drive the EXACT
// code verify.mjs runs, with an injected `runCheckIgnore` in place of a real
// `spawnSync` -- the same DI shape `collectSurfaces(repo, plan, io)` already uses
// for the surface walk, applied to the sibling spawn site. `runCheckIgnore(input)`
// takes the newline-joined probe input and returns the same `{status, stdout,
// stderr, error}` shape a real `spawnSync` result carries.
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
// Row 2's TWO rednesses are the wiring test AND the failing-shapes loop test below
// -- both drive `applyCheckIgnoreProbe` directly; row 3 goes GREEN -- delete the
// five tests that drive the extraction and the mutation stops being caught AT ALL
// -- so in THIS repo the extraction, not merely the classification, is what
// closes the class. (Row 3's fail=0 is what proves it; its PASS count is not a
// cross-reference to anything -- an earlier version of this comment compared it to
// the pre-fix suite's own pass count, which coincided only until this unit's later
// tests broke the coincidence. Never re-add that cross-reference.) CoalTipple ran
// the IDENTICAL mutation
// in its own tree and it reddened through two pre-existing CWK-079-class
// integration tests instead, never touching its own DI'd extraction at all -- for
// THEIR tree the extraction was not the mechanism. An adopter re-runs this mutation
// in ITS OWN tree and states what reddens there; CoalTipple's non-reproduction is
// the measured counter-example this pin predicts, not an exception to explain away.
//
// PLUMBING CONTRACT (CWK-092 flow-back 3, adopted UPWARD from CoalFace `d882832`
// rather than reconciled downward -- ship-text an adopter may lift verbatim):
// `probeSuffix` DEFAULTS to the exported `PROBE_SUFFIX`, so there is no wrong value
// a caller can fall into by omission -- only a caller that deliberately overrides
// it can diverge, and that is visible at the call site. The function RETURNS the
// recovered Set rather than mutating one the caller owns -- this function owns only
// the probe, never the caller's state.
export function applyCheckIgnoreProbe({ toProbe, probeSuffix = PROBE_SUFFIX, fail, runCheckIgnore }) {
  const ignored = new Set();
  if (!toProbe.length) return ignored;
  const ci = runCheckIgnore(toProbe.map((n) => n + probeSuffix).join('\n') + '\n');
  const verdict = classifyCheckIgnoreResult(ci);
  if (!verdict.ok) {
    fail(verdict.message);
    return ignored;
  }
  for (const line of verdict.stdout.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    ignored.add(t.endsWith(probeSuffix) ? t.slice(0, -probeSuffix.length) : t.replace(/\/$/, ''));
  }
  return ignored;
}

const GLOB = /[*?[\]{}|]/;
const OUTSIDE = /^([~/]|[A-Za-z]:|[a-z][a-z0-9+.-]*:\/\/)/;
// A `.` or `..` SEGMENT -- never a dot-DIR like `.github`, which is a real name.
const DOTSEG = /(^|\/)\.\.?(\/|$)/;
// A BACKSLASH is not a separator this gate reads (CWK-075 r2 LOW-1). DOTSEG is
// segment-whole for `/`-delimited tokens and that property is untouched -- but it does
// not see a BACKSLASH-delimited segment, so `scripts/..\..\escape.md` survived every
// shape test, took the ourRoots branch on `scripts`, and path.resolve landed OUTSIDE
// the repo (measured). That is this room's own recorded lesson -- resolve-and-contain,
// not segment-scan, because a scan misses `\` on Windows -- reappearing inside the fix
// written to close a traversal hole.
//
// REJECTION rather than a wider separator class, and the reason is the lesson itself:
// widening DOTSEG keeps the segment-scan SHAPE and patches one miss, leaving the
// invariant platform-conditional. Rejecting the character makes it unconditional --
// A CITATION IN OUR SURFACES IS `/`-DELIMITED, on every platform, full stop -- and it
// closes more than the traversal case: `scripts\lib/x.mjs` (mixed) yields a first
// segment nothing matches, so it was SILENTLY skipped rather than dangerous. Half the
// class was quiet and half was live; now the whole class is out of scope uniformly.
//
// MEASURED before choosing: 9 backticked tokens contained a backslash and ZERO were
// path-shaped -- every one already dropped by another shape rule (whitespace, a glob
// metacharacter, or no `/` at all). So the rejection removed nothing that reaches the
// scope tests.
//   RE-MEASURED after this very paragraph was written: 13 tokens, of which TWO ARE
//   path-shaped -- and both are the worked examples two lines above, in this file. The
//   rule now has documentation, and its documentation is written in the syntax the rule
//   rejects. They are dropped by the BACKSLASH guard itself, so the conclusion is
//   unchanged and the population is self-referential; the numbers are re-derived rather
//   than left reading as a claim about ship-text they no longer describe.
//
// NAMED BLIND SPOT, not a denial: a legitimate WINDOWS-STYLE citation is now dropped,
// unchecked and unannounced. Measured population today: zero. If that ever stops being
// zero the right answer is to normalise separators at the boundary, never to re-admit
// the character into a segment scan.
const BACKSLASH = /\\/;

// Candidate extraction. Exported so an adopter can measure its OWN funnel with the
// same instrument rather than re-implementing it and getting different numbers.
export function pointerCandidates(text) {
  const out = [];
  // Fenced code blocks are EXAMPLES, not prose claims about this tree.
  const prose = String(text).replace(/^```[\s\S]*?^```/gm, '');
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) {
    const tok = m[1];
    if (/\s/.test(tok)) continue;          // a command or a table row, not a pointer
    if (/[<>]/.test(tok)) continue;        // <placeholder>
    if (GLOB.test(tok)) continue;          // a glob names a SET, not a file
    if (!tok.includes('/')) continue;      // a bare filename is the USER's repo's
    if (OUTSIDE.test(tok)) continue;       // absolute, home-relative, or a URL
    if (DOTSEG.test(tok)) continue;        // `../` navigates, it does not NAME a path,
                                           // and it would also escape the repo on resolve
    if (BACKSLASH.test(tok)) continue;     // not a separator this gate reads -- see above
    // A DOT-DIR IS NO LONGER DROPPED HERE. It was, and that silently excluded four real
    // tracked files of ours (.claude-plugin/plugin.json, .githooks/, .github/workflows/ci.yml).
    // Whether a dot-dir is OURS or the scanned project's is TREE knowledge, not text shape,
    // so the decision moved to checkPointers where ourRoots and agentHomes exist.
    out.push(tok);
  }
  return out;
}

// LAST-SEGMENT SHAPE TEST (CWK-079 findings-back MEDIUM-1) -- feeds ONLY the
// ignore-probe's candidate-root derivation in verify.mjs, NEVER pointerCandidates'
// own resolve-path population. Kept OUT of pointerCandidates deliberately: a token
// this test rejects may still be a real, existing, TRACKED citation
// (`.githooks/pre-commit`, `.github/workflows`) that the ordinary resolve() check must
// keep seeing -- narrowing pointerCandidates itself would silently drop those from
// resolution checking too, a different and unrelated regression from the one this test
// exists to fix.
//
// THE DEFECT THIS CLOSES: a token containing a `/` is not necessarily a path -- the
// no-`/` drop above (:209) proves the token HAS a slash, never what the slash
// SEPARATES. Measured over this repo's own candidate tokens: a backticked ratio like
// N-over-4 (arithmetic), `prefer/should` (two rule-force words), `try/finally` (a
// language construct), `js/insecure-temporary-file` (a CodeQL query id), `log/slog` (a
// Go package pair) all reach the ignore-probe's first-segment derivation with no path
// in them at all. REPRODUCED LIVE: appending that ratio's own first segment plus a
// slash to `.gitignore` makes the shipped gate FAIL the CHANGELOG's citation of the
// ratio, with the remedy "commit the file" -- incoherent for arithmetic, and the only
// way to silence it is editing published CHANGELOG history. (Deliberately not
// backticking the ratio itself anywhere in this comment -- this file's own comment
// lines are a WALKED surface, and a backticked mention would manufacture the exact
// citation it is describing.)
//
// THE TEST: strip a trailing `:line(-line)?` ref (the same suffix `normalise()`
// strips for resolution below), then either the token ends in `/` (an explicit
// directory reference) or its LAST segment carries a `.ext`-shaped suffix (a
// filename). Both are the deliberate, common path conventions this house's own prose
// already uses; arithmetic, rule-force pairs, and language constructs carry neither.
//
// THIS GATES DISCOVERY ONLY, NOT JUDGEMENT (CWK-079 findings-back round 2, MEDIUM-2) --
// stated because the residue below was FIRST written as "excluded" and that word is
// false. This test decides which ROOTS `verify.mjs` adds to `candidateRoots`; it is
// never consulted by `checkPointers`' own `ignoredRoots.has(first)` branch, which
// judges EVERY token reaching it regardless of shape. So a rejected token is NOT
// excluded from the check -- it is excluded only from CONTRIBUTING ITS OWN ROOT to the
// set the check runs against. The true property is NON-LOCAL: a citation this test
// rejects (an extensionless path, `scripts/lib` say) is checked IF AND ONLY IF some
// OTHER, unrelated, path-shaped citation anywhere in the surface set shares its first
// segment. PROVEN LIVE in `pointer-check.test.mjs` with a two-plant pair -- an
// extensionless file under the same gitignored directory this file already uses as
// its worked example, planted alone (silent) and then again beside a second,
// path-shaped citation under that same directory (both FAIL). Deliberately not
// spelling either plant out as a literal here: this comment is itself a WALKED
// surface, and citing the real gitignored directory by name a second time in this
// file would manufacture the exact FAIL it is describing -- measured live while
// drafting this very paragraph. Reword this test's own behaviour before "fixing" the
// sentence -- making the check local would mean applying this shape test inside
// `checkPointers` too, which would silently stop FAILing a real gitignored citation
// that happens to be extensionless. Keep the wider catch; state the residue honestly
// instead.
//
// THE RESIDUE, both directions, named rather than hidden:
//   - STILL LETS THROUGH: a token ending `/` is accepted with no check on what
//     precedes it -- `os.tmpdir()/coalmine/` (a function call, not a directory) still
//     reaches the probe. Harmless in practice (no real `.gitignore` pattern is named
//     that), named here rather than papered over with a further heuristic. A latent
//     accept-side case nobody has hit: the LAST-segment test accepts an ALL-DIGIT
//     "extension" (`.[A-Za-z0-9]{1,10}` matches digits too), so a slash-separated
//     version-shaped token would pass as filename-shaped. Measured population on this
//     tree today: ZERO.
//   - DISCOVERY-EXCLUDED, but NOT check-exempt per the non-locality above: an
//     extensionless real path with no trailing slash is no longer a source of its own
//     root. Five such paths are real, cited, tracked citations on this tree today --
//     `.agents/skills`, `.git/hooks`, `.githooks/pre-commit`, `.githooks/pre-push`,
//     `.github/ISSUE_TEMPLATE`. Live cost on THIS tree is zero regardless of the
//     non-locality above -- not because they are covered by some other citation, but
//     because none of their roots (`.agents`, `.git`, `.githooks`, `.github`) can ever
//     BE gitignored here: `.agents`/`.github` are agent-homes and held out before the
//     probe runs at all; `.git`/`.githooks` are themselves tracked. `scripts/lib` is
//     the sixth, cited only by this comment and the pin below, not by any pre-existing
//     doc -- and it IS exposed to the non-locality above the moment a sibling,
//     path-shaped citation under the same root is ever gitignored.
export function looksPathShaped(tok) {
  const t = tok.replace(/:\d+(-\d+)?$/, '');
  if (t.endsWith('/')) return true;
  return /\.[A-Za-z0-9]{1,10}$/.test(t.split('/').pop());
}

// `docs/x.md:12` and `scripts/` both name a real thing; the suffix and the trailing
// slash are punctuation, not part of the path.
function normalise(tok) {
  return tok.replace(/:\d+(-\d+)?$/, '').replace(/\/+$/, '');
}

export function checkPointers({
  surfaces = [],          // [{ label, text, historyOnly? }]
  ourRoots = new Set(),   // top-level names that belong to THIS repo
  ignoredRoots = new Set(), // first segments of CITED paths that .gitignore matches (CWK-079: existence-independent -- not a listing of dirs the caller has on disk)
  agentHomes = new Set(), // repo-relative install homes this tool writes INTO A USER's tree
  hasEntry = () => false, // (relDir, name) => boolean -- does `name` exist directly in relDir
  resolve,                // (relPath) => 'tracked' | 'untracked' | 'missing'
  pending = PENDING_POINTERS,
} = {}) {
  const findings = [];
  if (typeof resolve !== 'function') {
    findings.push({ level: 'FAIL', msg: 'pointer check: no resolve() supplied — the gate cannot answer its own question' });
    return findings;
  }

  const cited = new Set();
  let checked = 0;

  for (const s of surfaces) {
    if (typeof s.text !== 'string') {
      // NAME what could not be read. A caller that filters unreadable surfaces out
      // first hides its own scope gap — the silent narrowing this family of gates
      // exists to catch, committed by the gate's own wiring.
      findings.push({ level: 'SKIP', msg: `pointer check could not read ${s.label}` });
      continue;
    }
    const seen = new Set();
    for (const tok of pointerCandidates(s.text)) {
      if (seen.has(tok)) continue;
      seen.add(tok);
      const first = tok.split('/')[0];

      // A GITIGNORED ROOT IS THE SHARP CASE, and it is decided WITHOUT resolving:
      // from any other machine "gitignored" and "does not exist" are indistinguishable,
      // so such a path was never durable — not even on the day it was written. That is
      // why this branch also binds a history-only surface, where the ordinary
      // resolution check does not: a renamed file was a correct citation once, a
      // scratchpad path never was.
      // NOTE this branch runs BEFORE `pending` is consulted, deliberately: a declaration
      // can excuse a path that does not exist YET, never one that exists and is
      // unreachable from a clone. A gitignored citation cannot be declared durable.
      if (ignoredRoots.has(first)) {
        cited.add(normalise(tok));
        checked++;
        findings.push({
          level: 'FAIL',
          msg: `${s.label} cites \`${tok}\`, which lives under the gitignored \`${first}/\` — not reachable from a clone. Cite the durable artefact (a commit SHA, a shipped doc) or commit the file.`,
        });
        continue;
      }

      // AN AGENT INSTALL HOME NAMES THE SCANNED PROJECT'S TREE, NEVER OURS -- and the two
      // genuinely collide: `.github/skills/` is Copilot's home while `.github/workflows/`
      // is ours, same root, opposite owner, indistinguishable from the token alone. The
      // set is DERIVED from the tool's own TARGETS map, never enumerated here, so it
      // cannot rot the day a vendor path changes.
      //
      // NAMED BOUND -- ROOT-LEVEL MASKING (CWK-078). This check matches on the FULL
      // path, but the caller's ignore probe holds out the agent-home ROOT, so a root
      // that is BOTH agent-home-named AND genuinely gitignored-and-ours would never be
      // probed, and a dead citation under it would go silently unchecked rather than
      // FAIL. Cost here is ZERO and the reason is structural, not luck: `.github` is
      // exactly that shape and it is TRACKED, so it never enters ignoredRoots by any
      // path. A room whose tree gitignores an agent-home root inherits the mask; that
      // is the bound, stated so the next reader does not have to rediscover it.
      const norm = normalise(tok);
      if (agentHomes.has(norm) || [...agentHomes].some((h) => norm.startsWith(h + '/'))) continue;

      // SCOPE, two independent tests, either sufficient -- and BOTH are structural, so
      // neither is circular. The old rule was repo-root only, which SILENTLY SKIPPED any
      // token whose first segment is not a top-level dir: `references/checks.md` cited
      // from its own skill dir was never checked at all. A skipped citation is the
      // quieter failure than a wrongly-flagged one, and it is the failure this whole
      // class is about.
      const citerDir = s.label.includes('/') ? s.label.slice(0, s.label.lastIndexOf('/')) : '';
      const parentDir = citerDir.includes('/') ? citerDir.slice(0, citerDir.lastIndexOf('/')) : '';
      let base = null;
      if (ourRoots.has(first)) base = '';
      else if (citerDir && hasEntry(citerDir, first)) base = citerDir;
      else if (parentDir && hasEntry(parentDir, first)) base = parentDir;
      if (base === null) continue;  // a path into someone else's tree
      cited.add(norm);

      // Published history is never fixed forward: a path that was correct when the
      // entry was written is not a defect now. Such a surface is checked for the
      // gitignored case above and nothing else.
      if (s.historyOnly) continue;

      checked++;
      const rel = base ? base + '/' + norm : norm;
      const state = resolve(rel);
      if (state === 'tracked') continue;
      if (pending.some((p) => p && p.path === rel)) continue;
      if (state === 'untracked') {
        findings.push({ level: 'FAIL', msg: `${s.label} cites \`${tok}\`, which exists here but is UNTRACKED — a clone does not have it. Commit it, or cite the durable artefact.` });
      } else {
        findings.push({ level: 'FAIL', msg: `${s.label} cites \`${tok}\`, which does not resolve in this repo` });
      }
    }
  }

  // EVENT-based expiry, both directions. A declaration list nobody prunes becomes a
  // permanent hole with an author's name on it.
  for (const p of pending) {
    if (!p || !p.path) { findings.push({ level: 'FAIL', msg: 'PENDING_POINTERS entry has no path' }); continue; }
    if (!p.reason) { findings.push({ level: 'FAIL', msg: `PENDING_POINTERS declares ${p.path} with no reason — an allowlist of bare strings is a bypass with no author` }); }
    if (resolve(p.path) === 'tracked') {
      findings.push({ level: 'FAIL', msg: `PENDING_POINTERS declares ${p.path} as not-yet-existing, but it now resolves — delete the entry` });
    } else if (!cited.has(p.path)) {
      findings.push({ level: 'FAIL', msg: `PENDING_POINTERS declares ${p.path}, but no in-scope surface cites it — delete the entry` });
    }
  }

  findings.checked = checked;
  return findings;
}
