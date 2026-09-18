// Self-consistency checks — the "don't trust your own non-code artifacts" layer.
//
// CoalMine already byte-verifies the code it ships (verify.mjs). These checks
// extend that discipline to the things an agent TRUSTS but never verifies:
// cross-document facts that can silently drift apart, and the doctrine mirrors
// that live in three places and must stay identical. A divergence here is the
// mechanical signature of staleness or tampering (e.g. a poisoned rules copy).
//
// Memory poisoning that is purely semantic (a prescription that contradicts a
// Commandment) has no canonical baseline to diff against — that is caught by the
// gold-standard RE-VALIDATE pass, not here. These functions are the mechanical,
// zero-false-positive half.
//
// Each returns an array of { level, msg }. Pure, Node built-ins only.

import fs from 'node:fs';
import path from 'node:path';
import { listSkills } from './render.mjs';

// The two doctrine rule homes. `.claude/rules/ecc/` is what Claude reads;
// `.agents/rules/ecc/` is what the non-Claude agents (Antigravity, Codex, Cursor)
// read. Neither population can see the other's tree, so a divergence is invisible
// from both sides and the two run different rulebooks — which is why this is a
// mechanical check and not a review item. The canonical copy lives in a SEPARATE
// repo (the org TheColliery/.github) that this check CANNOT reach at runtime — a
// stranger's CoalMine clone has no path to it — so the org copy is OUT OF SCOPE by
// construction; keeping the local homes in sync with it is a release-time concern.
//
// ENUMERATED, never a hard-coded pair list. A list rots on every rule added: the
// list this replaced named 2 files, so 19 of the 21 rules in a populated home were
// never compared at all and the check reported agreement over them.
//
// THE TWO ABSENCES ARE DIFFERENT THINGS, and conflating them is what made the old
// carve-out ("a missing mirror is fine") swallow real drift:
//   - the whole counterpart TREE absent  → SILENT (the legitimate case: a clone that
//     never installed that rule home — this repo itself has neither tree today)
//   - the tree PRESENT but a file missing from it → FAIL (drift wearing the costume
//     of the carve-out)
// Comparison is RAW BYTES (board #125 — this comment said the opposite until 2026-08-22,
// and the code it described was the defect): AGENTS.md's two-way-mirror rule calls the two
// trees "byte-identical" and names this gate as its machine, so normalizing CRLF before the
// compare made an EOL divergence invisible BY CONSTRUCTION. An EOL-only difference is still
// reported, under its own EOL-DIVERGED classification with its own remedy (normalize the
// line endings, do not touch content) — see the compare site below.
//
// THE TOMBSTONE LEDGER IS NOT A RULE and must not live in either tree — reversing this
// file's own earlier "RETIRED.md mirrors like every other rule, deliberately NO
// exception". That rested on "it is never `@imported`", which is true and IRRELEVANT:
// `.claude/rules/**` is auto-loaded as a DIRECTORY, so the ledger was paid for in every
// session and grew forever, collapsing skill-authoring.md §6's entire point — retiring a
// dead rule must cost nothing. Since 2026-07-27 it is a SINGLE un-mirrored copy outside
// both trees, and that LOCATION is the mechanism: one copy cannot diverge from itself,
// which is exactly the property this check had to enforce while two copies existed.
//
// A tombstone found INSIDE a tree therefore FAILS, and neither existing verdict would
// have said so: mirrored into both trees it agrees with itself and passes SILENTLY (an
// invisible regression), and one-sided it reads as UNMIRRORED — whose remedy, "add it to
// the other tree", is now precisely the wrong move. Scope limit, stated rather than
// implied: this only sees a tombstone that came BACK inside a tree. Nothing here checks
// that the ledger still exists at its new home — that lives outside the trees, and §6
// accepts it as unguarded.
//
// NAMED ASYMMETRY (legitimate, not drift): `.agents/rules/coalmine-trigger.md` has no
// `.claude` counterpart — it is the trigger table for agents that do not receive
// triggers from the plugin, and Claude does. It sits OUTSIDE `ecc/`, so this
// ecc-scoped walk never sees it; that placement IS the mechanism, not an oversight.
const MIRROR_ROOTS = ['.claude/rules/ecc', '.agents/rules/ecc'];
const TOMBSTONE = 'RETIRED.md';

// WHERE the two doctrine rule homes actually live is NOT always `repo`. CoalMine
// itself carries neither tree — its own rules load via the up-tree `@import` walk
// from the UMBRELLA (`TheColliery/`), CoalMine's *parent* directory on the layout
// this repo is developed from (a plain subdirectory, not a git submodule — the
// umbrella carries no `.git`, no CI, no gate of its own). Handed `repo` alone,
// `checkDoctrineMirrors(repo)` always hit CoalMine's own absent trees and took the
// legitimate-absence carve-out on EVERY run — 0 findings whether the umbrella's real
// trees agreed or diverged, because it never looked at them (2026-07-31 umbrella
// governance audit, finding "C1").
//
// Resolve the base to compare BEFORE calling checkDoctrineMirrors, so the pure
// comparison function keeps its simple, fully-tested contract (compare these two
// tree roots under a base) — the topology decision lives here, once:
//   1. `repo` itself, if it carries BOTH trees (a room that mirrors org rules
//      locally — the design this file's checks were originally written for).
//   2. `repo`'s parent, if it carries EITHER tree (this dev layout: CoalMine as a
//      plain child directory of TheColliery). Widens coverage only, never narrows it.
//   3. Otherwise `repo` — a published, standalone CoalMine clone with no umbrella
//      sibling genuinely has nothing to compare, and stays on the tri-state's honest
//      "absent" path rather than reporting false coverage.
//
// RULED (M2, 2026-07-31 INSPECT): step 1 requires BOTH trees, not "either", and this
// is a deliberate answer to a real ambiguity — "one tree present here, its counterpart
// missing" is NOT the legitimate whole-tree-absence case for THIS decision (which base
// to trust as authoritative). A single stray tree (e.g. a gitignored `mkdir` under
// `.claude/` — the phantom-slug class, hooks-safety.md §8) is not evidence of a genuine
// local mirror adoption; trusting it here would PIN the base to `repo` and suppress
// the parent-widen, silently re-creating the exact C1 vacuity through an accidental
// path instead of the direct one already fixed. A genuine local adoption has both
// sides by construction (that is the whole point of a mirror pair) — only that
// qualifies as "repo is authoritative". This does NOT reclassify anything inside
// checkDoctrineMirrors itself: once a base IS chosen, a whole counterpart tree absent
// under THAT base is still the legitimate silent case its own tri-state already
// grants — that classification is unchanged and correct on its own terms.
export function resolveMirrorBase(repo) {
  // isDirectory, not bare existsSync (L1, 2026-07-31 INSPECT): existsSync is true for
  // a plain FILE too, which would widen candidacy to a base that cannot possibly hold
  // a rule tree. isDirectory follows a symlink (same as the historical `statSync`
  // behavior) — a symlink-only "tree" can still be picked as a candidate base here,
  // but checkDoctrineMirrors's own `kind()` refuses to walk through it (lstat-based,
  // 'notdir') and reports a FAIL rather than silently trusting it, so this stays safe.
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  const hasTree = (base, r) => isDir(path.join(base, r));
  const hasBoth = (base) => MIRROR_ROOTS.every((r) => hasTree(base, r));
  const hasEither = (base) => MIRROR_ROOTS.some((r) => hasTree(base, r));
  if (hasBoth(repo)) return repo;
  const parent = path.dirname(repo);
  if (parent !== repo && hasEither(parent)) return parent;
  return repo;
}

// Recursive .md walk yielding { abs, rel } with a POSIX-style rel key so the two
// trees compare on the same spelling on Windows. Symlinked directories are not
// followed (`isDirectory()` is false for a link) — no cycle risk, and a rule home
// is a plain directory.
//
// THROWS on an unreadable directory, and that is the point. A guard rests on TWO
// capability checks — the stat PROBE (`kind()` below) and this ENUMERATION — and
// hardening one leaves the other. Swallowing a readdir failure yields an EMPTY tree,
// so two genuinely diverged rule homes report agreement over zero files compared:
// the same fail-OPEN hole as the probe's, one level down. POSIX `chmod 0100` is
// exactly that state — stat succeeds, readdir does not. Same tri-state rule:
// ENOENT/ENOTDIR = the directory really is not there; anything else (EACCES, EPERM,
// EIO) = could not enumerate, which is not the same as knowing it is empty. Every
// caller turns the throw into its own FAIL finding, so one guard here covers both.
function* walkMd(dir, rel = '') {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return; throw e; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* walkMd(abs, r);
    else if (e.name.endsWith('.md')) yield { abs, rel: r };
  }
}

// 1. The shipped skill count must agree across every place that states it.
// Source of truth = the skills/ directory; plugin.json must not drift from it
// (this is the "About said 5 canaries for four versions" class, mechanized).
export function checkCanaryCount(repo) {
  const out = [];
  let actual;
  try {
    actual = listSkills(path.join(repo, 'skills')).length;
  } catch (e) {
    return [{ level: 'FAIL', msg: `consistency: cannot count skills/: ${e.message}` }];
  }
  try {
    const desc = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8').replace(/^\uFEFF/, '')).description || '';
    const m = desc.match(/(\d+)\s+quality-canary/);
    if (!m) {
      out.push({ level: 'FAIL', msg: `consistency: plugin.json description has no "<N> quality-canary" count to cross-check` });
    } else if (Number(m[1]) !== actual) {
      out.push({ level: 'FAIL', msg: `consistency: plugin.json says ${m[1]} quality-canary skills but skills/ has ${actual}` });
    }
  } catch (e) {
    out.push({ level: 'FAIL', msg: `consistency: plugin.json unreadable: ${e.message}` });
  }
  return out;
}

// 1e. The conductor hook's own "N quality canaries installed" string — the
// FIRST thing injected into every session, so a drift here is the highest-
// exposure instance of the same class as #1 above (which checks plugin.json vs
// skills/ only). Still not every surface that states the count (~11 known,
// per the audit) — this + #1 are the two the commit-gate can mechanically
// reach without a browser-rendered check; the rest are markdown prose swept
// manually on release (scripts-quality.md's per-version doc-spot checklist).
export function checkConductorCanaryCount(repo) {
  const out = [];
  let actual;
  try {
    actual = listSkills(path.join(repo, 'skills')).length;
  } catch (e) {
    return [{ level: 'FAIL', msg: `consistency: cannot count skills/: ${e.message}` }];
  }
  const p = path.join(repo, 'hooks', 'coalmine-conductor.js');
  let src;
  try {
    src = fs.readFileSync(p, 'utf8');
  } catch (e) {
    return [{ level: 'FAIL', msg: `consistency: hooks/coalmine-conductor.js unreadable: ${e.message}` }];
  }
  const m = src.match(/\[CoalMine\]\s+(\d+)\s+quality canaries installed/);
  if (!m) {
    out.push({ level: 'FAIL', msg: 'consistency: hooks/coalmine-conductor.js has no "<N> quality canaries installed" string to cross-check' });
  } else if (Number(m[1]) !== actual) {
    out.push({ level: 'FAIL', msg: `consistency: conductor hook says ${m[1]} quality canaries but skills/ has ${actual}` });
  }
  return out;
}

// 1b. The supported-agent count must agree between targets.mjs (the source of
// truth for install targets) and the README's agent table. This is the
// "badge/table still said 12 agents after a target was dropped" class,
// mechanized: the count lives in exactly one place (table rows == targets.mjs),
// so a stale "N agents" can never ship. Prose elsewhere is kept number-free.
export function checkAgentCount(repo) {
  const out = [];
  let defined;
  try {
    const tsrc = fs.readFileSync(path.join(repo, 'scripts', 'lib', 'targets.mjs'), 'utf8');
    defined = (tsrc.match(/^\s+[a-zA-Z]+:\s+path\./gm) || []).length;
    if (defined === 0) return [{ level: 'FAIL', msg: 'consistency: no agent targets found in scripts/lib/targets.mjs' }];
  } catch (e) {
    return [{ level: 'FAIL', msg: `consistency: targets.mjs unreadable: ${e.message}` }];
  }
  const readmePath = path.join(repo, 'README.md');
  if (!fs.existsSync(readmePath)) return out; // partial copy without README (e.g. test fixture) — nothing to cross-check
  try {
    const lines = fs.readFileSync(readmePath, 'utf8').replace(/\r\n/g, '\n').split('\n');
    const hdr = lines.findIndex((l) => l.includes('Target Skills Folder'));
    if (hdr < 0) {
      out.push({ level: 'FAIL', msg: 'consistency: README agent table ("Target Skills Folder" header) not found' });
      return out;
    }
    let rows = 0; // hdr+1 is the |---| separator; data rows start at hdr+2
    for (let i = hdr + 2; i < lines.length && lines[i].trimStart().startsWith('|'); i++) rows++;
    if (rows !== defined) {
      out.push({ level: 'FAIL', msg: `consistency: README agent table has ${rows} rows but targets.mjs defines ${defined} agents — update whichever is stale` });
    }
  } catch (e) {
    out.push({ level: 'FAIL', msg: `consistency: README.md unreadable: ${e.message}` });
  }
  return out;
}

// 1c. Any issue-template line carrying a `version-pin:` marker must quote the
// current plugin.json version, or the gate fails — the "stale v2.4.0 shipped in
// a docs example" class, mechanized — while a concrete version can still serve
// as a form placeholder. Scope is the issue templates ONLY: that is where a
// literal version legitimately lives. Narrative docs (README, CHANGELOG) and the
// machine-local governance files describe this feature and cite old versions, so
// scanning them would self-trip; a .md doc should drop the version entirely
// instead (e.g. SECURITY.md verifies via `git describe`). The colon form means a
// mention of the word without the colon is never treated as a pin.
const VERSION_PIN_MARKER = 'version-pin:';
export function checkVersionPins(repo) {
  const out = [];
  let version;
  try {
    version = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8').replace(/^\uFEFF/, '')).version;
  } catch (e) {
    return [{ level: 'FAIL', msg: `consistency: plugin.json unreadable for version-pin check: ${e.message}` }];
  }
  const tplDir = path.join(repo, '.github', 'ISSUE_TEMPLATE');
  let names = [];
  // The same two-absences split as the doctrine mirror, and the stakes are higher: this
  // check rides checkTracked = the COMMIT GATE. A repo with no `.github/ISSUE_TEMPLATE`
  // is the COMMON case (a fresh clone, a partial copy, a test fixture) and must never
  // start blocking commits — so ENOENT/ENOTDIR stays silent. But a directory we could
  // not READ is not a directory with no templates: swallowing that passed the pin gate
  // over templates never opened.
  try { names = fs.readdirSync(tplDir).filter((f) => /\.ya?ml$/.test(f)); }
  catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return out;
    out.push({ level: 'FAIL', msg: `consistency: .github/ISSUE_TEMPLATE could not be enumerated (${e.code || e.message}) — cannot prove the version pins are current` });
    return out;
  }
  for (const name of names) {
    const file = path.join(tplDir, name);
    let lines;
    try { lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n'); } catch { continue; }
    lines.forEach((line, i) => {
      if (!line.includes(VERSION_PIN_MARKER)) return;
      const at = `${path.relative(repo, file)}:${i + 1}`;
      const m = line.match(/v(\d+\.\d+\.\d+)/);
      if (!m) out.push({ level: 'FAIL', msg: `consistency: ${at} is marked version-pin but has no vX.Y.Z to check` });
      else if (m[1] !== version) out.push({ level: 'FAIL', msg: `consistency: ${at} pins v${m[1]} but plugin.json is v${version} — bump the pin` });
    });
  }
  return out;
}

// 1d. The JSONC comment-stripper regex is hand-duplicated in jsonc.mjs (ESM) and
// hooks/_shared/node-config.js (CJS — Phoenix self-contained, can't require()).
// Each has its own test, but no test reads BOTH; a divergence in one would not be
// mechanically caught. This extracts the regex literal from each and fails if they
// differ — the "two copies silently drift" class, mechanized (no runtime change).
//
// THIRD COPY (PS, deliberately NOT in this literal compare): hooks/_shared/ps-config.ps1
// Remove-JsoncComments is a hand-written character state machine, not a regex, so it has
// no equivalent literal to diff against the two JS copies — a cross-language literal
// compare is infeasible, not omitted by oversight. Its parity is guarded BEHAVIORALLY
// instead: the cross-stripper equivalence fixtures in scripts/lib/jsonc.test.mjs are
// mirrored by scripts/lib/ps-config.test.ps1 (H4), so the PS port must produce identical
// parse results on the same inputs. Do NOT fake a literal compare here.
const JSONC_REGEX_RE = /\.replace\((\/"\(\?:[\s\S]*?\/g),/;
export function checkJsoncRegexSync(repo) {
  const out = [];
  const sources = [
    'scripts/lib/jsonc.mjs',
    'hooks/_shared/node-config.js',
  ];
  const literals = [];
  for (const rel of sources) {
    const p = path.join(repo, rel);
    let body;
    try { body = fs.readFileSync(p, 'utf8'); } catch (e) {
      out.push({ level: 'FAIL', msg: `consistency: ${rel} unreadable for jsonc-regex sync: ${e.message}` });
      return out;
    }
    const m = body.match(JSONC_REGEX_RE);
    if (!m) {
      out.push({ level: 'FAIL', msg: `consistency: could not locate the JSONC stripper regex in ${rel}` });
      return out;
    }
    literals.push({ rel, lit: m[1] });
  }
  if (literals[0].lit !== literals[1].lit) {
    out.push({ level: 'FAIL', msg: `consistency: JSONC stripper regex DIVERGED — ${literals[1].rel} differs from ${literals[0].rel} (keep the two copies in sync)` });
  }
  return out;
}

// 2. Every rule in one doctrine home must exist, and agree, in the other. A missing
// counterpart or a diverging copy is the mechanical fingerprint of a stale sync, a
// half-finished rule addition, or a tampered rule file.
export function checkDoctrineMirrors(repo) {
  const out = [];
  const [claudeRoot, agentsRoot] = MIRROR_ROOTS.map((r) => path.join(repo, r));
  // Tri-state, NOT a boolean: the carve-out below is "this clone does not keep that
  // rule home", and ONLY a genuinely absent path can claim it. Collapsing every other
  // outcome into "absent" made the one fail-OPEN hole in this guard — a regular FILE
  // at .agents/rules/ecc silently bypassed the whole check while .claude held rules.
  // ENOENT/ENOTDIR = the home really is not there. Anything else (EACCES, EPERM, EIO)
  // means we could not TELL, which is not the same as knowing it is absent.
  //
  // lstat FIRST, never stat — a rule home must be a PLAIN directory, never a link, so
  // ANY symlink/junction at this exact path is 'notdir' regardless of what it points
  // to. This subsumes the old dangling-link handling (lstat succeeds on a dangling
  // link too) and additionally closes a hole `statSync` left open: a LIVE symlink
  // resolving to a real directory used to be FOLLOWED and reported as a legitimate
  // 'dir', so its target's `.md` files — possibly outside both `repo` and the
  // resolved parent (see resolveMirrorBase) — were read and reported as doctrine.
  // `walkMd` already refuses to follow a symlinked directory NESTED inside the tree
  // (Dirent#isDirectory() does not follow links); this gives the ROOT the same
  // refusal, so the whole walk is symlink-free by one consistent rule, not two.
  const kind = (p) => {
    let st;
    try { st = fs.lstatSync(p); }
    catch (e) { return (e.code === 'ENOENT' || e.code === 'ENOTDIR') ? 'absent' : 'unreadable'; }
    if (st.isSymbolicLink()) return 'notdir';
    return st.isDirectory() ? 'dir' : 'notdir';
  };
  const kinds = [kind(claudeRoot), kind(agentsRoot)];
  for (const [i, k] of kinds.entries()) {
    if (k === 'notdir') out.push({ level: 'FAIL', msg: `consistency: ${MIRROR_ROOTS[i]} exists but is NOT a directory — the doctrine-mirror carve-out covers an ABSENT rule home, never a malformed one` });
    else if (k === 'unreadable') out.push({ level: 'FAIL', msg: `consistency: ${MIRROR_ROOTS[i]} could not be inspected — cannot prove the two rule homes agree` });
  }
  if (out.length) return out; // malformed on either side: fail CLOSED, never silent
  // Whole tree absent on either side = this clone does not keep that rule home.
  if (kinds.includes('absent')) return out;

  // TRUE BYTE-COMPARE (board #125). This read used to strip CRLF→LF BEFORE the compare —
  // so an EOL-only divergence between the two trees was invisible BY CONSTRUCTION, while
  // AGENTS.md's two-way-mirror rule says the trees are "byte-identical" and names THIS
  // function as the machine that keeps them so. The gate enforced a weaker standard than
  // the constitution it implements. Read raw bytes; the CRLF strip survives below only to
  // CLASSIFY a mismatch, never to hide one.
  const read = (abs) => { try { return fs.readFileSync(abs); } catch (e) { return e; } };
  const side = (root) => { try { return new Map([...walkMd(root)].map((f) => [f.rel, f.abs])); } catch (e) { return e; } };
  const a = side(claudeRoot);
  const b = side(agentsRoot);
  // A home we could not enumerate is not an empty one — reporting agreement over
  // files never opened is the same false all-clear the pair list used to produce.
  for (const [m, root] of [[a, MIRROR_ROOTS[0]], [b, MIRROR_ROOTS[1]]]) {
    if (m instanceof Error) out.push({ level: 'FAIL', msg: `consistency: ${root} could not be enumerated (${m.code || m.message}) — cannot prove the two rule homes agree` });
  }
  if (out.length) return out; // blind on either side: fail CLOSED, never silent

  // Union, both directions: a rule only Claude sees and a rule only the other agents
  // see are the SAME defect (two populations, two rulebooks) pointed opposite ways.
  // Sorted so the gate's output is deterministic across platforms (Phoenix #8).
  for (const rel of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    if (rel === TOMBSTONE || rel.endsWith(`/${TOMBSTONE}`)) {
      const at = [[a, MIRROR_ROOTS[0]], [b, MIRROR_ROOTS[1]]].filter(([m]) => m.has(rel)).map(([, r]) => `${r}/${rel}`);
      out.push({ level: 'FAIL', msg: `consistency: ${at.join(' + ')} — a tombstone ledger must NOT live inside a rule tree (the whole tree is always-loaded, so retiring a rule would cost tokens forever). DELETE it here; its home is the single un-mirrored copy outside both trees.` });
      continue;
    }
    const [pa, pb] = [a.get(rel), b.get(rel)];
    if (!pa || !pb) {
      const [have, missing] = pa ? [MIRROR_ROOTS[0], MIRROR_ROOTS[1]] : [MIRROR_ROOTS[1], MIRROR_ROOTS[0]];
      out.push({ level: 'FAIL', msg: `consistency: doctrine '${rel}' UNMIRRORED — present in ${have}/ but MISSING from ${missing}/ (the two agent populations would read different rulebooks)` });
      continue;
    }
    const [ba, bb] = [read(pa), read(pb)];
    for (const [body, root] of [[ba, MIRROR_ROOTS[0]], [bb, MIRROR_ROOTS[1]]]) {
      if (body instanceof Error) out.push({ level: 'FAIL', msg: `consistency: ${root}/${rel} unreadable: ${body.message}` });
    }
    if (ba instanceof Error || bb instanceof Error) continue;
    if (Buffer.compare(ba, bb) !== 0) {
      // Classify before reporting: an EOL-only divergence and a CONTENT divergence need
      // OPPOSITE remedies, and the room has already paid once for a gate that fired with
      // the wrong fix attached (the tombstone check's backwards "copy it to the other
      // tree" message, `cedb19e`). Same bytes modulo line endings => the rulebooks agree
      // and only the encoding drifted; anything else is a real text difference.
      // The discriminator must be LOSSLESS, or it mislabels the dangerous case as the
      // benign one (INSPECT MEDIUM, board #125). `toString('utf8')` maps EVERY invalid
      // byte sequence to U+FFFD, so two genuinely different files can decode to one
      // identical string — measured: <61 C3 28 62> vs <61 C0 28 62> both decode "a�(b",
      // which classified a real byte divergence as EOL-only and handed the operator the
      // remedy "do NOT rewrite either file's content" for a possible tampering. `latin1`
      // is a total byte<->code-unit bijection (verified across all 256 values), so nothing
      // can collapse; the strip stays a pure byte operation.
      const stripCR = (buf) => Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
      const eolOnly = Buffer.compare(stripCR(ba), stripCR(bb)) === 0;
      out.push(eolOnly
        ? { level: 'FAIL', msg: `consistency: doctrine '${rel}' EOL-DIVERGED — same text, different line endings (${MIRROR_ROOTS[0]}/${rel} vs ${MIRROR_ROOTS[1]}/${rel}). The trees are byte-identical by rule; normalize both to CRLF (this flock's dominant convention), do NOT rewrite either file's content.` }
        : { level: 'FAIL', msg: `consistency: doctrine '${rel}' DIVERGED — ${MIRROR_ROOTS[1]}/${rel} differs from ${MIRROR_ROOTS[0]}/${rel} (stale mirror or tampering)` });
    }
  }
  return out;
}

// 3. Every CoalMine stamp in the rule home must be well-formed, so a malformed or
// truncated stamp can't silently disable freshness tracking. (Past-due dates are
// /coalmine:stats' job; this only checks the shape.)
//
// A real stamp is an HTML comment: `<!-- coalmine: verified <date> · ... ·
// revalidate <N>d -->`. The opener identifies a stamp; the full pattern validates
// it. Both are case-sensitive and require the comment form, so prose that merely
// MENTIONS the phrase (the conductor's "no `coalmine: verified` stamp") and the
// uppercase COALMINE:START/END install markers are never mistaken for stamps.
// `g` so a malformed opener early in the file doesn't mask a well-formed stamp
// later — every opener is located and validated against a bounded window.
const STAMP_OPEN = /<!--\s*coalmine:\s*verified/g;
const STAMP_RE = /<!--\s*coalmine:\s*verified\s+\d{4}-\d{2}-\d{2}[\s\S]*?revalidate\s+\d+d[\s\S]*?-->/;
// A real stamp is ~80-150 chars; cap the window the full pattern ever sees. The
// pattern has two lazy [\s\S]*? that backtrack O(n^2) on a poisoned .md (many
// `revalidate Nd` hits with no closing `-->`), so feeding it a whole megabyte was a
// quadratic DoS reachable via `node scripts/consistency.mjs` on a poisoned rule
// file. Bounding the input to a constant makes the per-file cost O(1) in the regex
// (so O(n) over the file): even worst-case backtracking is over <= STAMP_WINDOW chars.
const STAMP_WINDOW = 2048;

// 3b. `paths:` frontmatter glob SHAPE (gold-standard 2026-08-18/19, adjudication
// A14/F5). A `paths:`-gated rule file only loads when its glob matches something —
// a malformed pattern doesn't error, it silently matches nothing, forever, with no
// signal anywhere. FAIL is the correct level (unlike the stamp/marker checks that
// fail closed on un-committable state): a malformed glob sits in a TRACKED file a
// commit can fix. SCOPE GUARD, deliberately narrow: this validates that a pattern
// PARSES (non-empty, balanced brackets, a bounded brace expansion) — it never asks
// whether the glob matches the RIGHT files, which needs a live loader to answer
// (InstructionsLoaded, routed elsewhere) and is a different question entirely.
const BRACE_EXPANSION_BUDGET = 1000; // see checkBraceBudget — a defensible constant, not a spec citation
const MAX_BRACE_NESTING = 8; // matches the STAMP_WINDOW idiom: bound the work, not trust the input

// Extract a YAML list field from frontmatter: `key:` on its own line, followed by
// `- item` lines. frontmatterField (desc-cap.mjs) only reads scalars; paths: is a
// sequence, so this is a sibling extractor, not a duplicate.
function frontmatterListField(text, key) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex((l) => l.trim() === key + ':');
  if (i === -1) return null;
  const items = [];
  for (let j = i + 1; j < lines.length; j++) {
    const lm = lines[j].match(/^\s*-\s*(.*)\s*$/);
    if (!lm) break;
    let v = lm[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    items.push(v);
  }
  return items;
}

// Brace-expansion budget — CORRECTED after INSPECT F5-1 (gold-standard round):
// the first version discarded a closed TOP-LEVEL group's count instead of folding
// it into anything, so N SIBLING groups at the top level (`{a,b}{c,d}{e,f}...`,
// which concatenate and multiply in real brace expansion) evaded the budget
// entirely — a 100-char pattern computed 10^6 real alternatives and PASSed. Fixed
// with `topProduct`: every group that closes back to depth 0 multiplies into a
// persistent running product, checked against the budget after every multiply
// (not just once at the very end) and again at EOF for a pattern with no closing
// brace at all reachable from the loop.
//
// This is DELIBERATELY NOT a precise brace-expansion calculator — computing the
// exact count needs the full recursive sum-within-alternatives / product-of-
// concatenated-siblings grammar. What is required is a SAFE UPPER BOUND: never
// silently PASS a pattern whose real expansion is pathological. `topProduct`
// therefore multiplies in every closed group's own local count regardless of
// whether that group nests inside a single alternative (where real semantics
// would only SUM it) or sits alongside a sibling (where real semantics DOES
// multiply it) — over-counting the nested-alternation case is the safe
// direction (it can only make the check MORE conservative, never less), and it
// is cheap: one multiply per closed brace, still O(n) over the pattern.
function checkBraceBudget(pattern) {
  const stack = [];
  let topProduct = 1;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '{') {
      if (stack.length >= MAX_BRACE_NESTING) return `brace nesting exceeds ${MAX_BRACE_NESTING} at index ${i}`;
      stack.push(1);
    } else if (c === ',' && stack.length > 0) {
      stack[stack.length - 1]++;
    } else if (c === '}') {
      if (stack.length === 0) continue; // a bare '}' with no opener is a literal char to most glob engines, not an error
      const count = stack.pop();
      if (stack.length > 0) {
        stack[stack.length - 1] *= count;
      } else {
        topProduct *= count;
        if (topProduct > BRACE_EXPANSION_BUDGET) return `brace expansion (>= ${topProduct} alternatives) exceeds the ${BRACE_EXPANSION_BUDGET}-alternative budget`;
      }
    }
  }
  if (stack.length > 0) return `unclosed '{' (${stack.length} deep)`;
  return null;
}

// SHAPE only — non-empty, every UNESCAPED `[` finds a matching `]` (an unclosed
// bracket expression matches nothing in most glob engines, which is the defect
// this exists to catch), and a bounded brace expansion. Never asks whether the
// pattern matches the intended files.
//
// INSPECT F5-3 (gold-standard round): a backslash-escaped `[` (`\[`, a literal
// bracket character, not a bracket-expression opener) was flagged as "unclosed" —
// a false positive on a syntactically valid AND matching glob. Fixed: a `[`
// preceded by an odd number of backslashes is a literal, skipped without
// requiring a `]`. (Deliberately simple, stated as a simplification rather than a
// full engine: this counts only the immediately-preceding run of backslashes,
// which is the standard shell/glob escaping convention — `\[` literal, `\\[`
// literal backslash then a real bracket opener, etc.)
function isEscaped(pattern, i) {
  let backslashes = 0;
  for (let j = i - 1; j >= 0 && pattern[j] === '\\'; j--) backslashes++;
  return backslashes % 2 === 1;
}
function validateGlobShape(pattern) {
  if (typeof pattern !== 'string' || pattern.trim() === '') return 'empty pattern';
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '[' && !isEscaped(pattern, i)) {
      const close = pattern.indexOf(']', i + 1);
      if (close === -1) return `unclosed '[' at index ${i}`;
      i = close;
    }
  }
  return checkBraceBudget(pattern);
}

export function checkRuleStamps(repo) {
  const out = [];
  // Scope is the whole rules home (not just ecc/) — a stamp is well-formed or not
  // wherever it sits. Shares walkMd with the mirror check above: one walker, so a
  // future change to what counts as a rule file cannot apply to only one of them.
  const roots = ['.claude/rules', '.agents/rules'].map((r) => path.join(repo, r));
  for (const root of roots) {
    let files;
    try { files = [...walkMd(root)]; }
    catch (e) {
      out.push({ level: 'FAIL', msg: `consistency: ${path.relative(repo, root)} could not be enumerated (${e.code || e.message}) — cannot prove its stamps are well-formed` });
      continue;
    }
    for (const { abs: p } of files) {
      let body;
      try { body = fs.readFileSync(p, 'utf8'); } catch { continue; }
      STAMP_OPEN.lastIndex = 0;
      let m;
      let bad = false;
      let any = false;
      while ((m = STAMP_OPEN.exec(body)) !== null) {
        any = true;
        // Validate only a bounded slice anchored at this opener — a well-formed
        // stamp fits easily; a poisoned blob can never grow the regex's work.
        if (STAMP_RE.test(body.slice(m.index, m.index + STAMP_WINDOW))) { bad = false; break; }
        bad = true;
      }
      if (any && bad) {
        out.push({ level: 'FAIL', msg: `consistency: ${path.relative(repo, p)} has a malformed coalmine stamp (expected "verified <YYYY-MM-DD> ... revalidate <N>d")` });
      }
      // 3b. paths: glob shape — same walk, same file, no second pass over disk.
      const globs = frontmatterListField(body, 'paths');
      if (globs) {
        for (const g of globs) {
          const reason = validateGlobShape(g);
          if (reason) {
            out.push({ level: 'FAIL', msg: `consistency: ${path.relative(repo, p)} has a malformed paths: glob "${g}" (${reason}) — a malformed glob silently un-loads this file forever` });
          }
        }
      }
    }
  }
  return out;
}

// Tracked-file checks safe to run in the commit gate (no machine-local rule home
// required). Returns findings[]; empty = consistent.
export function checkTracked(repo) {
  return [...checkCanaryCount(repo), ...checkConductorCanaryCount(repo), ...checkAgentCount(repo), ...checkVersionPins(repo), ...checkJsoncRegexSync(repo)];
}

// Every check, for the on-demand consistency CLI (includes machine-local rule home).
// checkDoctrineMirrors runs against resolveMirrorBase(repo), NOT repo directly — see
// the C1 comment above resolveMirrorBase. checkRuleStamps still reads `repo` as-is:
// it has the identical vacuity (scans repo/.claude/rules + repo/.agents/rules, both
// absent for CoalMine) but that is a separate, unreported-here finding — not fixed
// in this pass, out of the C1 scope this function's other half addresses.
//
// M1 (2026-07-31 INSPECT): when the base widened to the parent, every mirror finding
// gets the resolved base appended. The PASS-side message already names the base (see
// scripts/consistency.mjs); a FAIL is the one that actually blocks a commit, and the
// person being blocked needs to know WHERE the diverged file lives more than the
// person seeing PASS needs to know nothing diverged — a bare relative fragment like
// ".agents/rules/ecc/x.md" points nowhere inside CoalMine once the real check ran one
// directory up. checkDoctrineMirrors itself stays untouched (still just "compare two
// roots"); the disclosure lives here, next to the topology decision that makes it necessary.
export function checkAll(repo) {
  const mirrorBase = resolveMirrorBase(repo);
  const mirrorFindings = checkDoctrineMirrors(mirrorBase).map((f) => (
    mirrorBase === repo ? f : { ...f, msg: `${f.msg} [checked at ${mirrorBase}]` }
  ));
  return [...checkCanaryCount(repo), ...checkConductorCanaryCount(repo), ...checkAgentCount(repo), ...checkVersionPins(repo), ...checkJsoncRegexSync(repo), ...mirrorFindings, ...checkRuleStamps(repo)];
}
