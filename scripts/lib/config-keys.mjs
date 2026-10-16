// CWK-059 — documentation-vs-schema drift gate. Every config key NAMED on a
// user-facing surface must RESOLVE in config-schema.mjs, or be declared.
//
// WHY: CWK-054's own MEDIUM was the fix over-claiming inside the fix — `693931b`
// shipped six sites promising `scanEverything` while the key was measured
// unimplemented. Three more instances landed the same night in sibling rooms. One
// class: documentation-vs-code divergence, invisible to every gate we had.
//
// DETECTION RULE, and its false-positive behaviour is MEASURED, not asserted.
// A candidate is a token that (a) is backticked in Markdown, or is inside the
// CONTENTS of a string literal in a hook, and (b) matches KEY_SHAPE below:
// camelCase with AT LEAST ONE internal capital.
//
//   Measured on this repo before the rule was chosen (skills/*/SKILL.md):
//     - a naive "any backticked token" rule flags 22 distinct tokens, 12 of them
//       NOT keys — 55% noise. A gate that cries wolf is a dead gate, and this room
//       has already paid for one (the tripwireMaxLines gate firing on compliant
//       code, AGENTS.md's own recorded cry-wolf failure).
//     - requiring an internal capital drops 10 of those 12: it excludes enum VALUES
//       (`off`, `safe`, `interactive`, `true`, `false`) and lowercase prose words
//       (`file`, `line`, `finally`, `fs`, `revalidate`).
//     - a further "config marker on the same line" filter was TESTED and REJECTED:
//       it removed zero additional false positives and added a miss risk for free.
//   Residue after the rule: 4 tokens across all in-scope surfaces, every one a real
//   code identifier, all four declared in NOT_CONFIG below with a reason.
//
// UNDER-FIRES BY DESIGN — a miss is a bug, a flood is a dead gate, so the rule is
// chosen to miss rather than to shout. A single-word lowercase key or a snake_case key
// does not match KEY_SHAPE and is invisible to this gate.
//
// THAT BLIND SPOT IS LIVE, NOT HYPOTHETICAL, and this comment used to say the opposite
// (INSPECT MEDIUM-1). It read "this flock has no such key today; the day one is added,
// this rule must be revisited" — measured FALSE against the very schema this module
// consumes: of 26 keys, `language` fails KEY_SHAPE, and it is backticked in README.md,
// an IN-SCOPE surface. The gate has been reading that line and discarding it since the
// day it shipped, and the revisit trigger the sentence named had already passed and
// could never fire. A claim about the repo, parked in a comment, is exactly the
// documentation-vs-code divergence this gate exists to catch, committed inside the gate.
//
// SO THE CLAIM IS NOW A MACHINE: checkConfigKeys asserts its OWN precondition against
// the schemaKeys it is handed and emits a visible SKIP naming every key KEY_SHAPE
// cannot see. A comment rots silently; a SKIP that reads the live schema on every run
// cannot. This also travels: AGENTS.md's 5 Standard Systems mandates `language` in
// EVERY room, so an adopting room inherits the disclosure rather than the false claim.
//
// WIDENING KEY_SHAPE WAS CONSIDERED AND REJECTED, measured rather than argued: allowing
// any lowercase identifier takes the residue on this repo's own surfaces from 4 to 37
// (+33 false positives) — platform names (`claude`, `cursor`, `codex`, `windsurf`, ...),
// language codes (`en`, `th`, `ja`, `zh`, `es`), enum values (`off`, `safe`, `auto`,
// `manual`, `true`, `false`) and prose (`file`, `line`, `fs`). Closing a one-key blind
// spot by requiring a 33-entry hand-kept NOT_CONFIG roster trades a named gap for the
// exact allowlist rot this design refuses.
//
// A SCHEMA-TO-DOCS *LITERAL* PASS WAS ALSO CONSIDERED AND REJECTED (CWK-061), and this is
// the sharper rejection because it looks like it should work: a schema key is a KNOWN
// LITERAL, and matching a literal needs no heuristic, so why not search the surfaces for
// each blind key by exact name?
//   Because it answers the WRONG QUESTION. This gate asks "is a key NAMED in the docs
//   REAL?". A literal built FROM the schema can only ever find keys that are already in
//   the schema — i.e. keys that are real by construction — so on the drift axis it is
//   structurally incapable of producing a finding. MEASURED on this repo: the pass returns
//   exactly one hit for `language` (README.md:178) and zero findings, because that hit
//   resolves. It answers "is this key DOCUMENTED?", a coverage question nobody asked.
//   And it would import the noise the capital rule exists to remove: MEASURED, if an
//   adopting room's schema carried the ordinary-word keys rooms plausibly have, a
//   backticked-literal pass would have to adjudicate `auto` 6 times, `off` twice, and
//   `safe`/`all`/`file`/`line`/`description` once each on THIS repo's surfaces alone —
//   every one an English word or an enum value, none of them a key mention.
//   Zero detection gain on the axis that matters, real false-positive cost. Rejected.
//
// SO THE CLASS IS CLOSED FROM THE OTHER END — not by detecting better, but by making the
// blind spot IMPOSSIBLE TO CREATE SILENTLY. See BLIND_KEYS below.
const KEY_SHAPE = /^[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*$/;

// A key that is NAMED but not yet IMPLEMENTED. CWK-054's whole point is that naming
// an unimplemented key HONESTLY, with its status, is CORRECT behaviour — a gate that
// forbade it would forbid the disclosure this flock just shipped. So the honest case
// is cheap (one line, here) and the dishonest case is loud (a FAIL naming the file).
// An entry MUST carry a ticket or a reason: an allowlist of bare strings is a bypass
// with no author.
//
// EXPIRY — the decision and its reason. An entry does NOT carry a date; it expires on
// the EVENT that actually matters. Two self-cleaning rules below make the list prune
// itself rather than rot:
//   1. a PENDING key that NOW resolves in the schema is a FAIL ("implemented, delete
//      this entry"). A calendar date would expire on a day unrelated to the work; this
//      expires exactly when the entry stops being true.
//   2. an entry NO SURFACE mentions is a FAIL ("nothing references this, delete it").
//      An allowlist entry protecting nothing is dead weight, and dead weight is how an
//      allowlist becomes the stale exclusion nobody reads — the same shape as the
//      permanent scan exclusion scanEverything exists to override.
export const PENDING_KEYS = {
  // (empty today: scanEverything landed in CWK-057, so its entry was removed by rule 1
  // — the mechanism demonstrated on its own originating defect.)
};

// NOT a config key and never will be — a code identifier that happens to be
// camelCase in prose. DELIBERATELY A SEPARATE LIST FROM PENDING_KEYS: these are
// different KINDS of claim, and merging them would let "planned" and "not a key"
// hide in one bucket, which is precisely the escape-hatch rot this gate is against.
// Inert forever BY DESIGN — "this is an internal identifier" is not a fact that
// expires — but rule 1 still applies in reverse: if one of these ever BECOMES a real
// schema key, the entry is now a lie and FAILs.
// A schema key this gate's detection rule CANNOT SEE, declared with the reason it is
// accepted. THE POINT OF THIS LIST IS THAT IT IS MANDATORY, NOT OPTIONAL (CWK-061):
// any key in the schema that fails KEY_SHAPE and is NOT declared here is a hard FAIL.
//
// WHY A FAIL AND NOT THE SKIP IT REPLACED. The previous fix PRINTED the blind spot every
// run. That is disclosure, and disclosure is not closure: a printed line is read by nobody
// after the third run, and the next room to add a lowercase key inherits the same silent
// discard with only that line between it and a gate that quietly checks less than it
// claims. A FAIL cannot be read past. The gate is now structurally incapable of ACQUIRING
// a blind spot without a human writing down that they accepted one — which is the actual
// requirement; "warns loudly" was never it.
//
// EVERY ADOPTING ROOM HAS AT LEAST ONE ENTRY BY CONSTRUCTION. AGENTS.md's 5 Standard
// Systems mandates `language` in every room, and `language` fails KEY_SHAPE. So this list
// is not an edge case a room might never meet; it is the first thing a port collides with,
// and colliding is the design working.
//
// HONEST RESIDUE, stated because a closure claim must be exact — AND NARROWED (INSPECT
// LOW-1), because the first version of this sentence claimed one notch too much. It said a
// lowercase key named in a doc while absent from the schema is undetectable by ANY mechanism
// here. That is TRUE OF FREE PROSE and irreducibly so: shape cannot separate `language` from
// the English word, and a literal pass has nothing to match because a key absent from the
// schema contributes no literal. It is NOT true of a STRUCTURED surface — in a key table the
// first cell is a key BY THE TABLE'S OWN CONTRACT, so position supplies the signal shape
// cannot, and the structured pass above catches exactly that case on the canonical key list
// where this defect class actually appears.
// So the residue is: a lowercase key named in FREE PROSE while absent from the schema. That
// half is irreducible with this design; the FAIL above is what stops it growing quietly.
export const BLIND_KEYS = {
  language: 'AGENTS.md 5 Standard Systems #2 mandates it flock-wide; a single lowercase word is indistinguishable from prose, and widening the rule to catch it was measured at +33 false positives',
};

export const NOT_CONFIG = {
  capNotice: 'rot-canary-stop.js translation key for the auto-scan cap notice',
  scanExcludeNotice: 'rot-canary-stop.js translation key for the skip-count notice',
  askQuestions: 'a GitHub Copilot platform capability, named in the install matrix',
  systemMessage: 'the Claude Code hook OUTPUT field, not a config input',
  emDash: "CoalLedger's own config key (doc-quality canary) -- README names it as a cross-ref only (CWK-092 flow-back 4), never ours to implement",
};

// SURFACES — chosen by MEASUREMENT, each in/out with its reason.
//   IN  skills/<any>/SKILL.md   the agent-facing contract; where CWK-054's M1 lived.
//   IN  README.md               the Configure table is the most user-visible key list.
//   IN  hooks/*.js STRING CONTENTS  the runtime notices a user actually reads.
//   OUT CHANGELOG.md            MEASURED: 63 flags — function names, Node APIs,
//       translation keys, and, decisively, RETIRED and PLANNED keys named BY DESIGN.
//       A gate that reddens on accurate history is a gate nobody keeps, so it is not
//       merely noisy here, it is WRONG: the CHANGELOG's job is to record what a key
//       once was.
//   OUT CONTRIBUTING.md / SECURITY.md  measured: zero candidates. Including them buys
//       nothing today and grows the surface a future room must reason about.
//   OUT platform-configs/.coalmine.json  it IS config, not prose about config: every
//       key there is real by construction and verify.mjs already validates it against
//       the schema. Scanning it would double-report a key the schema check owns.
//
// SOURCE ONLY, never the plugin/ twins. The twins are byte-identical copies enforced
// by verify.mjs's own parity check — proven live, not assumed: CWK-057's sabotage of an
// inlined copy reddened 3 parity tests. Scanning both sides would double every finding
// and make the count meaningless without adding one bit of coverage.
//
// PORTABILITY — the flock exemplar. An adopting room supplies exactly four things and
// changes no logic: schemaKeys (its own schema module's key list), mdFiles, hookFiles,
// and its own two declarations. Nothing below hardcodes CoalMine's layout.

const NL = String.fromCharCode(10);
const BS = String.fromCharCode(92); // a literal backslash, built not typed
const TICK = new RegExp('`([^`' + BS + 'n]+)`', 'g');
// A JS single-quoted string literal, escape-aware so a value ending in a backslash
// cannot leak escape state into the next token.
const JS_STRING = new RegExp("'((?:" + BS + BS + ".|[^'" + BS + BS + "])*)'", 'g');
// Blank out escape sequences BEFORE scanning a literal's contents. Without this the
// two characters of an escape fuse with the following word and manufacture a phantom
// identifier -- MEASURED: nReport, nMemory, nTripwires, nAlertas, nInforme, five false
// positives from five languages, every one of them the same newline escape.
const JS_ESCAPE = new RegExp(BS + BS + '[a-zA-Z]', 'g');
const IDENT = new RegExp(BS + 'b([a-z][a-z0-9]*[A-Z][A-Za-z0-9]*)' + BS + 'b', 'g');
// A markdown table row whose FIRST cell is a single backticked token.
// The pipe is written as the character class [|] rather than an escape: a hand-built
// backslash-pipe is one keystroke from meaning ALTERNATION instead of a literal, which is
// exactly the bug this line shipped with for one run (the group never participated, so the
// finding read `documents undefined`). A class cannot be misread that way.
const ROW_KEY = new RegExp('^' + BS + 's*[|]' + BS + 's*`([^`|]+)`' + BS + 's*[|]');

function candidatesInMarkdown(text) {
  const out = new Set();
  for (const m of text.matchAll(TICK)) if (KEY_SHAPE.test(m[1])) out.add(m[1]);
  return out;
}

// SCOPE INSIDE A HOOK: the USER-FACING notice block only, never the whole file.
// This is the correction that measurement forced, and it is worth recording because the
// mistake is the one AGENTS.md's THE MEASUREMENT'S OWN FOURTH TENSE names: I measured the
// false-positive rate on the TRANSLATIONS block and then built a checker that scanned every
// string literal in the file. Running it returned 110 findings -- every local variable,
// Node API and helper name in three hooks. A rule validated on one scope and shipped at a
// wider one is not a validated rule; the red-first proof would have been just as green.
// So the scan is bounded to the notice block by NAME (`noticeBlock`, default TRANSLATIONS),
// which is also what makes the surface honest: a code identifier in a comment or an internal
// string is not something a user ever reads.
function noticeRegion(text, blockName) {
  const start = text.indexOf('const ' + blockName);
  if (start === -1) return '';
  const end = text.indexOf(NL + '};', start);
  return end === -1 ? text.slice(start) : text.slice(start, end);
}

// STRUCTURED SURFACE (CWK-061 LOW-1) — the one place the shape rule's blindness is NOT
// irreducible. In free prose a lowercase key is indistinguishable from an English word, and
// that stays true. But a KEY TABLE is structured: the first cell of a row IS a key by the
// table's own contract, so POSITION supplies the signal SHAPE cannot, and no heuristic is
// needed at all — every backticked first cell must resolve, whatever its shape.
//
// REGION-BOUNDED by the same technique noticeRegion already uses on hooks, and the bound is
// what makes it clean rather than a second cry-wolf path. MEASURED on this repo: README has
// 10 backticked first-cell table rows; unbounded, the rule would fire on 2 of them
// (`/coalmine:stats`, `/coalmine:update` — the Commands table, L148-149), which are not keys
// and never will be. Bounded to the Configure section it sees 8 rows, 8/8 schema keys,
// ZERO false positives — and the 2 fall outside by CONSTRUCTION, not by an exclusion rule
// that would need maintaining. A room supplies its own {file, heading}; nothing here assumes
// CoalMine's README.
function tableRegion(text, heading) {
  const lines = text.split(NL);
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.includes(heading));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,6}\s/.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

function keysInTable(text, heading) {
  const out = new Set();
  for (const ln of tableRegion(text, heading)) {
    const m = ROW_KEY.exec(ln);
    if (m) out.add(m[1]);
  }
  return out;
}

function candidatesInHookStrings(text, blockName) {
  const out = new Set();
  const region = noticeRegion(text, blockName);
  if (!region) return out; // a hook with no notice block contributes nothing, silently
  for (const lit of region.matchAll(JS_STRING)) {
    const clean = lit[1].replace(JS_ESCAPE, ' ');
    for (const id of clean.matchAll(IDENT)) if (KEY_SHAPE.test(id[1])) out.add(id[1]);
  }
  return out;
}

// findings: [{ level, msg }] — same shape every other verify.mjs check returns.
// `read` is injected so the caller owns file IO (and a test can drive it in-memory).
// PORTABILITY: an adopting room supplies its own schemaKeys, surfaces and DECLARATIONS.
// The two lists are parameters with this room's as defaults, so a sibling copies the file
// and passes its own rather than editing shared logic -- and a test can drive the checker
// with empty declarations to isolate one rule at a time.
export function checkConfigKeys({
  schemaKeys, mdFiles = [], hookFiles = [], read,
  noticeBlock = 'TRANSLATIONS',
  keyTables = [], // [{ file, heading }] — a room's own key table(s); see tableRegion above
  pending = PENDING_KEYS,
  notConfig = NOT_CONFIG,
  blind = BLIND_KEYS,
}) {
  const findings = [];
  const known = new Set(schemaKeys);

  // PRECONDITION — a HARD GATE, not a printed note (CWK-061). Any key the schema declares
  // that KEY_SHAPE cannot see must be DECLARED in BLIND_KEYS with its reason. Undeclared,
  // it FAILs: the gate refuses to run while silently checking less than it claims. This is
  // what makes acquiring a blind spot structurally impossible rather than merely visible —
  // a room adding a lowercase key hits a red gate, not a line it can scroll past.
  //
  // AND THE DECLARED CASE STILL DISCLOSES (INSPECT MEDIUM-1). The first cut of this took
  // `continue` on a declared key and printed nothing, which BOUGHT THE STOP BY SPENDING THE
  // DISCLOSURE the previous fix existed to provide -- so `verify` printed only its ok line
  // while `language` was read and discarded, making that line false as written. A stop and a
  // disclosure are not a trade; this unit owes both. Declared keys now emit a SKIP, which
  // verify.mjs filters out of its failure set, so the disclosure cannot redden the gate.
  const invisible = [...known].filter((k) => !KEY_SHAPE.test(k)).sort();
  const accepted = invisible.filter((k) => Object.hasOwn(blind, k));
  if (accepted.length) {
    findings.push({
      level: 'SKIP',
      msg: 'blind to ' + accepted.length + ' DECLARED schema key(s) this gate cannot detect: '
        + accepted.join(', ') + ' — named on any surface they are read and discarded, so the '
        + 'pass line above does not cover them (accepted in BLIND_KEYS)',
    });
  }
  for (const k of invisible) {
    if (Object.hasOwn(blind, k)) continue;
    findings.push({
      level: 'FAIL',
      msg: 'schema key ' + k + ' cannot be detected by this gate (it does not match the '
        + 'camelCase-with-an-internal-capital shape), so any mention of it in docs is read and '
        + 'discarded. Declare it in BLIND_KEYS with the reason it is accepted, or rename the key. '
        + 'Widening the shape rule to catch it was measured at +33 false positives on this repo, '
        + 'and a schema-to-docs literal pass was measured at zero findings, so neither is the fix',
    });
  }
  const seen = new Map(); // candidate -> Set(file)
  const unreadable = [];  // a surface the caller named but we could not read
  const tableReported = new Set(); // already reported by the structured pass; do not double-report

  const note = (tok, file) => {
    if (!seen.has(tok)) seen.set(tok, new Set());
    seen.get(tok).add(file);
  };

  for (const f of mdFiles) {
    let text;
    try { text = read(f); } catch { unreadable.push(f); continue; } // absent surface is not a finding
    for (const tok of candidatesInMarkdown(text)) note(tok, f);
  }
  for (const f of hookFiles) {
    let text;
    try { text = read(f); } catch { unreadable.push(f); continue; }
    for (const tok of candidatesInHookStrings(text, noticeBlock)) note(tok, f);
  }

  // STRUCTURED PASS (LOW-1) — shape-FREE, and that is the whole point: inside a declared key
  // table the first cell is a key by the table's own contract, so a lowercase key that free
  // prose can never expose is caught here. Same declarations apply, so an honestly-planned key
  // documented in the table is still cheap.
  for (const { file, heading } of keyTables) {
    let text;
    try { text = read(file); } catch { unreadable.push(file); continue; }
    for (const tok of keysInTable(text, heading)) {
      // A table row IS a mention, so a declaration covering it is not dead weight (rule 2).
      // But `note` is shape-free here, so the token would also reach THE CHECK below and be
      // reported a SECOND time -- `tableReported` keeps one defect to one finding.
      note(tok, file);
      if (known.has(tok) || Object.hasOwn(notConfig, tok) || Object.hasOwn(pending, tok)) continue;
      tableReported.add(tok);
      findings.push({
        level: 'FAIL',
        msg: 'key table ' + file + ' (under "' + heading + '") documents ' + tok
          + ', which does not resolve in the schema — a table row IS a key claim whatever its shape, '
          + 'so this is caught even where the prose rule is blind. Implement it, or declare it in '
          + 'PENDING_KEYS / NOT_CONFIG',
      });
    }
  }

  // THE CHECK. A named token must resolve, or be declared.
  for (const [tok, files] of [...seen].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (known.has(tok)) continue;
    if (tableReported.has(tok)) continue; // the structured pass already named it
    if (Object.hasOwn(notConfig, tok)) continue;
    if (Object.hasOwn(pending, tok)) continue;
    findings.push({
      level: 'FAIL',
      msg: 'config key ' + tok + ' is named in ' + [...files].sort().join(', ') + ' but does not resolve in the schema '
        + '— implement it, or declare it in PENDING_KEYS (planned, with its ticket) or NOT_CONFIG (never a key, with its reason)',
    });
  }

  // SELF-CLEANING RULE 1 — a declaration that is no longer true.
  for (const tok of Object.keys(pending)) {
    if (known.has(tok)) findings.push({ level: 'FAIL', msg: 'PENDING_KEYS lists ' + tok + ', but it now resolves in the schema — implemented, so delete the entry' });
  }
  for (const tok of Object.keys(notConfig)) {
    if (known.has(tok)) findings.push({ level: 'FAIL', msg: 'NOT_CONFIG lists ' + tok + ' as never-a-config-key, but it now resolves in the schema — the entry is a lie, delete it' });
  }
  // BLIND_KEYS expires on the same EVENT principle as the two lists above: an entry is
  // true only while the key is BOTH in the schema AND undetectable. Either half changing
  // makes the declaration a lie, so it FAILs rather than sitting there accepted forever.
  for (const tok of Object.keys(blind)) {
    if (!known.has(tok)) {
      findings.push({ level: 'FAIL', msg: 'BLIND_KEYS declares ' + tok + ', but it is not in the schema at all — the key is gone, delete the entry' });
    } else if (KEY_SHAPE.test(tok)) {
      findings.push({ level: 'FAIL', msg: 'BLIND_KEYS declares ' + tok + ' as undetectable, but it now matches the shape rule — the gate can see it, delete the entry' });
    }
  }

  // SELF-CLEANING RULE 2 — a declaration protecting nothing is dead weight, and dead
  // weight is how an allowlist rots into a bypass nobody reads.
  //
  // GATED ON A COMPLETE SCAN, and the suite is what taught me: this rule first fired
  // unconditionally, which reddened three unrelated verify.mjs fixture tests. Those
  // fixtures copy part of the repo and omit README.md, so the two README-sourced
  // declarations looked dead when the truth was that nobody had looked. That is this
  // room's own recorded lesson exactly — a 0-hit proves nothing when the scope was
  // incomplete — so a PARTIAL scan may not convict a declaration. It degrades to a
  // visible SKIP, never a silent pass and never a false accusation.
  if (unreadable.length) {
    findings.push({ level: 'SKIP', msg: 'declaration-pruning not checked: ' + unreadable.length + ' named surface(s) unreadable (' + unreadable.slice(0, 3).sort().join(', ') + (unreadable.length > 3 ? ', ...' : '') + ') — a partial scan cannot prove a declaration is dead' });
  } else {
    for (const [tok, why] of [...Object.entries(pending), ...Object.entries(notConfig)]) {
      if (!seen.has(tok)) findings.push({ level: 'FAIL', msg: 'no scanned surface names ' + tok + ' (' + why + ') — the declaration protects nothing, delete it' });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// ONE CONFIG-READ PATH PER ROOM (CWK-064) -- the owner's improve-and-unify ruling.
// No key is read from a bare project file, by hook or by agent instruction.
//
// The HOOK side is machine-enforced already: every hook reads through loadCfg's cascade,
// and CWK-064's hermetic probe confirmed the global tier reaches with no project file
// present (with a non-vacuous control). What has no machine is the SECOND read path -- an
// agent following ship-text. A skill that says "honor `.coalmine.json` <key>" with no
// cascade named sends the agent to `<gitroot>/.coalmine.json`, which on a machine whose
// user configured only the GLOBAL tier is ABSENT: the agent reads nothing and silently
// uses defaults. That is a live failure today, not a hypothetical -- the owner has the
// house switched on globally.
//
// THE CHECK: a surface that NAMES the config must also NAME the global tier. Deliberately
// coarse -- it does not try to tell "instructs an agent read" from "describes hook
// behaviour", because that distinction is a judgment a regex cannot make and getting it
// wrong in the permissive direction is exactly the defect. The cost of the coarse rule is
// one rail sentence on a surface that arguably did not need one; the cost of a clever rule
// is a silent miss. Cheap side chosen deliberately.
//
// SKILLS ARE CHECKED RENDERED, NOT RAW, and this is load-bearing rather than incidental:
// the rail lives in the SHARED escalation footer, so it reaches all nine skills by
// construction and appears in NO skill's own source. A source-side check would red-flag
// every skill that correctly inherits it -- a cry-wolf path created by the gate itself.
// verify.mjs already imports renderSkillMd for its dist comparison, so the rendered text
// costs nothing new. Commands receive no shared partial and are checked raw.
//
// HONEST BOUND, and this room states it every time: a hook-side clamp is enforced with
// probability 1; an instruction an agent follows is enforced below that. This gate makes
// the INSTRUCTION's presence machine-checked. It does NOT make the agent obey it. What is
// CLOSED is "a surface can silently lack the rail"; what stays PROSE-STRENGTH is the
// agent's compliance with the rail once it is there.
// GRANULARITY (INSPECT MEDIUM-2). The first cut matched PER FILE, so ONE compliant line
// immunised every bare read in the same file -- a per-file check on a per-line defect, and the
// reviewer measured it live. Fixed WITHOUT going strictly per-line, which was measured too:
// 23 mention lines across the 11 surfaces, 11 of them lacking the global tier on the line, so
// strict per-line would demand the ~40-word rail eleven times over. That is not rigour, it is
// ship-text bloat that gets deleted later.
//
// THE UNIT THAT IS ACTUALLY RIGHT: a mention is governed by a rail that CLAIMS to govern it.
//   - A UNIVERSAL RAIL -- one line naming the global tier AND explicitly scoping itself to
//     EVERY key (UNIVERSAL_MARKER) -- covers the whole surface, because that is precisely what
//     it says it does.
//   - Anything else is LOCAL: a line naming the global tier while discussing one key governs
//     that line and nothing else.
// So an incidental compliant line no longer immunises a file. rot-canary's correct fix-mode
// sentence is exactly such a local statement, and under the old rule it silently vouched for
// two unrelated mentions further down; it no longer does.
const UNIVERSAL_MARKER = 'every config key';

export function checkConfigReadPath({ surfaces = [], configName = '.coalmine.json', globalHome = '~/.claude/' }) {
  const findings = [];
  const globalToken = globalHome + configName;
  for (const { label, text } of surfaces) {
    if (typeof text !== 'string' || !text.includes(configName)) continue;
    const lines = text.split(NL);
    // A universal rail vouches for the whole surface; nothing else does.
    if (lines.some((l) => l.includes(globalToken) && l.includes(UNIVERSAL_MARKER))) continue;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes(configName)) continue;
      if (lines[i].includes(globalToken)) continue; // a LOCAL rail governs its own line
      findings.push({
        level: 'FAIL',
        label,
        line: i + 1,
        msg: label + ':' + (i + 1) + ' names ' + configName + ' with no rail governing it -- an agent '
          + 'following it reads the bare project file, which is ABSENT on a machine configured only '
          + 'globally, and silently falls back to defaults. Either name ' + globalToken + ' on this line, '
          + 'or give the surface a UNIVERSAL rail (one line naming ' + globalToken + ' and the words "'
          + UNIVERSAL_MARKER + '")',
      });
    }
  }
  return findings;
}
