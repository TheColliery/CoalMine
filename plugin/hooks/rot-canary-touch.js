#!/usr/bin/env node
// Code-Health Tier 1 (PostToolUse: Write|Edit|MultiEdit) — cross-platform (Node).
// Records touched code files for the session + flags unambiguous tripwires. Always non-blocking (exit 0).
const fs = require('fs');
const os = require('os');
const path = require('path');

// Mode: ~/.claude/.rot-canary-mode = auto|manual|off (absent = auto). .rot-canary-off = off (back-compat).
// off → record nothing. auto & manual → record touched files (the tripwire).
function rcMode() {
  try {
    const dir = path.join(os.homedir(), '.claude');
    if (fs.existsSync(path.join(dir, '.rot-canary-off')) || fs.existsSync(path.join(dir, '.rotcanary-off'))) return 'off'; // legacy name honored
    let f = path.join(dir, '.rot-canary-mode');
    if (!fs.existsSync(f)) f = path.join(dir, '.rotcanary-mode'); // legacy name honored
    if (fs.existsSync(f)) {
      const v = fs.readFileSync(f, 'utf8').trim().toLowerCase();
      if (v === 'off' || v === 'manual' || v === 'auto') return v;
    }
  } catch {}
  return 'auto';
}

// <coalmine-shared: node-config> — synced from hooks/_shared/node-config.js by build-plugin; edit the partial, not this block
// The three per-agent-dir shapes were added by the namespace campaign
// (#69+#39, owner-designated 2026-08-08) alongside the LEGACY dotfile: a
// project configured ONLY through the new shape (no `.git` present) would
// otherwise match nothing and fall through to the raw `startDir` fallback —
// the exact per-subdir-scatter class hooks-safety.md §8 (the phantom-slug
// law) already names for a wrongly-anchored state root. Additive-only: each
// new marker can only make the walk stop LOWER/narrower, `.git` is checked
// first and still wins wherever it is present.
const ROOT_MARKERS = [
  '.git',
  '.claude/coal/coalmine.json', '.agents/coal/coalmine.json', '.gemini/coal/coalmine.json',
  '.coalmine.json',
];

function findGitRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (ROOT_MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return startDir;
}

// Namespace campaign (#69+#39, owner-designated 2026-08-08). Per-project
// config lives under an agent dir, never bare at the project root any more.
// THE READ ORDER IS A RAIL — identical wording in every room's readCfg
// comment and README Configure section, one flock:
//   1. <project>/.<the running agent's OWN dir>/coal/<skill>.json — the dir
//      of the agent actually executing. CoalMine activates ONLY through
//      Claude Code's own hook system (SessionStart/PostToolUse/Stop, plus the
//      AG/Gemini/FileCopy adapters riding these SAME files); it has no other
//      running-agent identity to branch on, so for THIS room "own dir" is
//      always `.claude` and collapses onto the first entry of step 2 below
//      rather than needing a separate check.
//   2. Other known agent dirs, fixed order: `.claude` -> `.agents` ->
//      `.gemini` (first FOUND wins).
//   3. LEGACY: <project>/.<skill-dotfile>.json at the project root (today's
//      shape) — read normally, no breakage for an existing user.
// WRITE target = where the config was found; absent everywhere, the FIRST
// agent dir the project already has ON DISK (`.claude` -> `.agents` ->
// `.gemini`), never a bare "own dir" default — a project that only uses
// `.agents`/`.gemini` must not get a foreign `.claude/` planted into it. No
// agent dir present at all -> the running agent's own dir (`.claude`), same
// as before this fix. Hooks never perform this move on a READ (Phoenix #5,
// no side effects) — the move-on-CONFIG-WRITE half lives in configure.mjs
// and install.mjs (scripts/lib/config-paths.mjs), which are the only writers.
const AGENT_DIR_ORDER = ['.claude', '.agents', '.gemini'];
function projectConfigCandidates(root) {
  const candidates = AGENT_DIR_ORDER.map((d) => path.join(root, d, 'coal', 'coalmine.json'));
  candidates.push(path.join(root, '.coalmine.json')); // LEGACY, always last
  return candidates;
}
// Fresh-default path when NO config exists anywhere (kept in sync by hand
// with scripts/lib/config-paths.mjs's own copy, INSPECT MEDIUM 2, 2026-08-08):
// the first AGENT_DIR_ORDER entry that already exists as a directory on
// disk, else `.claude` -- never a bare candidates[0], which would plant a
// foreign `.claude/` into a project that only uses `.agents`/`.gemini`. This
// hook never WRITES the project config (Phoenix #5) -- projectConfigPath
// below calls this only to know what a fresh-install READ resolves to (a
// missing file there is treated as absent, same as any other candidate).
function isDirMarker(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
function ownDirDefault(root) {
  const dir = AGENT_DIR_ORDER.find((d) => isDirMarker(path.join(root, d))) ?? AGENT_DIR_ORDER[0];
  return path.join(root, dir, 'coal', 'coalmine.json');
}
function projectConfigPath(root) {
  const candidates = projectConfigCandidates(root);
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  return ownDirDefault(root); // nothing found anywhere -- own-dir is both the read and write target
}

// One BOM- and comment-tolerant JSONC read. Strips // and /* */ comments outside
// strings: the string alternative consumes an escaped char (\\.) or any
// non-quote/non-backslash char, so a value ending in \\ terminates the string
// correctly instead of leaking escape state into the next token (which would
// mis-strip a later //-containing string → silent revert).
function readCfgFile(file) {
  try {
    const content = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const cleanJson = content.replace(/"(?:\\.|[^"\\])*"|\/\/.*|\/\*[\s\S]*?\*\//g, (m) => (m[0] === '"' ? m : ''));
    const parsed = JSON.parse(cleanJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  return null;
}

// Two-level cached read of .coalmine.json: the global ~/.claude/.coalmine.json
// overlaid per key by the project config (project wins). Per-project config
// now lives under an agent dir (namespace campaign #69+#39, owner-designated
// 2026-08-08) — see `projectConfigPath`'s own header above for the full read
// order and the LEGACY root-dotfile fallback it still honors.
// __proto__/constructor/prototype keys are dropped at merge (an untrusted
// project config must not pollute the prototype). Cached — one disk pass per
// invocation (Phoenix #3: budget the work, not the process).
// SAFER-VALUE-WINS GUARD (corrected 2026-07-09 — the old blanket "no guard
// needed, unlike CoalWash" verdict was HALF-WRONG): `updateMode` IS read by a
// hook (the conductor) and drives a real consent escalation (an 'auto' check
// spends tokens + networks unsolicited) — an untrusted project config must not
// be able to flip an explicit global 'off' up to 'auto'. Guarded below,
// mirroring CoalWash's mergeSafety (config-load.mjs). `autoFixMode` is the one
// true exception: it is read by the AGENT from the raw file, never by any hook
// via this merge, so a hook-side guard for IT would protect nothing — that half
// of the old verdict stands.
// TWO DEFECTS CLOSED (board #112, 2026-08-13 — audited CoalWash's current
// `mergeSafety`/config-load.mjs and CoalBoard's current
// hooks/coalboard-conductor.js SAFER_ENUM before writing this, per
// hooks-safety.md §9's own warning that its exemplar shipped this exact hole):
// (1) an ABSENT global was treated as "project free" (`!globalCfg` skipped the
// clamp entirely) — the common case, since most users never write a global
// config — so a project-only .coalmine.json could set 'auto' unchallenged.
// Fixed: an absent/unset global now reads as its SCHEMA DEFAULT
// (scripts/lib/config-schema.mjs — not imported here, Phoenix #2 zero-dep,
// mirrored the same way CoalBoard's own SAFER_ENUM carries its `default`
// inline), never "anything goes". (2) CW H5 case-fold bug: `order.indexOf`
// compared raw case, so a project value in a different case than the
// lowercase enum (e.g. 'AUTO') missed the lookup (-1), fell through `continue`,
// and won through the earlier shallow-merge unclamped. Fixed: both sides are
// lowercased before the lookup.
// THREE MORE KEYS CLOSED (board #113, 2026-08-13 — board #112's own named
// next-touch set): `enableConductor`/`rotCanaryMode`/`disabledCanaries` were
// entirely unclamped — a project config could silently re-enable a
// globally-disabled canary or the whole conductor. `enableConductor` is a
// boolean-as-enum-of-two (`[false, true]`, false = safest); `fold()` below
// passes a non-string through unchanged instead of stringifying it, so a
// boolean pair compares correctly (a raw `.toLowerCase()` on `false` would
// still technically work via implicit String() coercion, but the OLD
// `order.indexOf(String(v).toLowerCase())` shape compared a STRING against
// an array of actual booleans and would silently never match — this is the
// bug the dispatch warned about, not a hypothetical). `rotCanaryMode` is a
// plain 3-value string enum, same shape as `updateMode`.
// LEGACY-ALIAS ESCALATION (found auditing the read sites, not assumed):
// `enableConductor`/`rotCanaryMode`/`disabledCanaries` each have a legacy
// alias (`conductor`/`mode`/`disable`) read independently at every call
// site. A clamp that only ever writes the NEW key name leaves the legacy
// field exactly as the plain shallow-merge left it — unclamped — so a
// project expressing its escalation through the OLD key name alone sails
// through untouched, regardless of what the new-key clamp does. Two
// different read-site shapes need two different closes:
//   - rotCanaryMode/mode and disabledCanaries/disable read as "prefer the
//     new key if defined, else the legacy one" (`cfg.X !== undefined ? cfg.X
//     : cfg.legacyX`) — so the clamp resolves EACH SIDE's effective value
//     through that same fallback (via/viaArr below) before comparing, and
//     writes the clamped result into the CANONICAL (new) key name only; the
//     read site's own preference-for-new-when-defined then makes the legacy
//     field's stale content moot.
//   - enableConductor/conductor reads as `cfg.enableConductor === false ||
//     cfg.conductor === false` — an OR over BOTH raw fields independently,
//     not a preference chain. Writing only the new key would leave a
//     project's raw `conductor: true` unclamped and able to flip the OR
//     back to false=false=not-disabled when global's actual stance (via
//     either name) was false. So this key's clamp result is mirrored into
//     BOTH `merged.enableConductor` and `merged.conductor`. NOT blanket
//     harmless for the preference-chain keys too, one named shape (INSPECT,
//     board #113 findings-back): a SINGLE project object setting BOTH names
//     to OPPOSITE values (`{enableConductor:true, conductor:false}`, no
//     global) had the legacy `conductor:false` win pre-clamp (OR sees a
//     literal false, disables) and now sees the mirror's `true` instead
//     (OR sees two trues, enables) — the mirror overwrites the user's own
//     self-contradictory legacy value with the canonical field's winning
//     result. No security consequence (the no-config baseline is already
//     enabled; nothing escalates past an explicit GLOBAL choice, which is
//     what this guard exists to defend), but "harmless" overstated this one
//     self-contradictory-input shape.
function fold(v) { return typeof v === 'string' ? v.toLowerCase() : v; } // pass booleans through unchanged
function via(obj, key, legacyKey) { // effective scalar value for `key`, preferring the new name (matches every read site's own `!== undefined` chain)
  if (!obj) return undefined;
  if (obj[key] !== undefined) return obj[key];
  return legacyKey ? obj[legacyKey] : undefined;
}
function viaArr(obj, key, legacyKey) { // same preference, array-shaped (for UNION keys)
  if (!obj) return undefined;
  if (Array.isArray(obj[key])) return obj[key];
  if (legacyKey && Array.isArray(obj[legacyKey])) return obj[legacyKey];
  return undefined;
}
const SAFER_ENUM = {
  updateMode: { order: ['off', 'remind', 'ask', 'auto'], default: 'ask' },
  enableConductor: { order: [false, true], default: true, legacy: 'conductor' }, // index 0 = safest; default = config-schema.mjs's declared factory default (README Configure table)
  rotCanaryMode: { order: ['off', 'manual', 'auto'], default: 'auto', legacy: 'mode' },
  // scanEverything (CWK-057): boolean-as-enum-of-two, same shape as enableConductor but the
  // OPPOSITE polarity — here `true` is the LOUDER side (every scope cut off = more files
  // scanned = more tokens), so index 0 is `false`. §9's blast test decides the direction, not
  // the key's name: a clone-borne project config forcing a full scan is exactly the escalation
  // the clamp exists to stop. The owner's own GLOBAL `true` is UNAFFECTED — the loop below
  // `continue`s when the project expressed no opinion, so a project file's SILENCE can never
  // clamp a global away; only a project that sets the key is constrained, and it may still
  // QUIETEN (`true`→`false`). No legacy alias: the key is new, it has never shipped under
  // another name.
  scanEverything: { order: [false, true], default: false },
};
// UNION-MERGE KEYS (hooks-safety.md section 9): a strArr key here is QUIETEN-only —
// more entries can only REDUCE what a hook acts on, never escalate spend/consent — so
// the project layer may ADD to the global layer's list, never silently drop an entry
// from it by replacing the whole array. scanExcludePaths is a scan-scope exclude: a
// project adding its own lab-tooling fragment must not erase a global one.
// PRECONDITION for any key added here: its factory default must be the EMPTY array.
// disabledCanaries (board #113): more entries = more disabled = quieter, the same
// QUIETEN-only direction — a project clearing the array must not silently re-enable
// what an explicit global disabled. `lower: true` here mirrors config-schema.mjs's own
// declared normalization for this key (enforced by the CLI on write, NOT by a
// hand-edited JSON file) — folded here so the read sites' `disabled.includes('rot-canary')`
// (a raw, case-sensitive check) can't be defeated by a stray "ROT-CANARY" in either layer.
const UNION_ARRAY_KEYS = {
  scanExcludePaths: { default: [] },
  disabledCanaries: { default: [], lower: true, legacy: 'disable' },
};
let _cfg;
function loadCfg() {
  if (_cfg !== undefined) return _cfg;
  _cfg = null;
  try {
    const globalCfg = readCfgFile(path.join(os.homedir(), '.claude', '.coalmine.json'));
    const projectCfg = readCfgFile(projectConfigPath(findGitRoot(process.cwd())));
    if (globalCfg || projectCfg) {
      const merged = {};
      for (const src of [globalCfg, projectCfg]) {
        if (!src) continue;
        for (const key of Object.keys(src)) {
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
          merged[key] = src[key];
        }
      }
      // Constrain whenever the PROJECT sets the key (via either name) — an
      // absent global is its schema default, never "no preference to
      // defend" (board #112). Case-fold both sides before the ordered
      // lookup so a differently-cased project value cannot dodge the clamp
      // (the CW H5 shape); fold() passes non-strings through, so a boolean
      // enum compares correctly too (board #113).
      for (const [key, { order, default: def, legacy }] of Object.entries(SAFER_ENUM)) {
        const projectVal = via(projectCfg, key, legacy);
        if (projectVal === undefined) continue; // project expressed no opinion via either name
        const globalVal = via(globalCfg, key, legacy);
        const globalValue = globalVal !== undefined ? globalVal : def;
        const gi = order.indexOf(fold(globalValue));
        const pi = order.indexOf(fold(projectVal));
        if (gi === -1 || pi === -1) continue; // unknown value: leave the shallow-merge result
        // Store the CANONICAL member (order[i]), never the raw-cased winner: a
        // consumer that trusts the merge output and compares with strict === --
        // rotCanaryMode's `mode === 'off' || mode === 'manual'` in rot-canary-stop.js/
        // touch.js does exactly this, unlike updateMode's own consumer, which
        // happens to .toLowerCase() defensively -- would silently fail to
        // recognize a legitimately-entered 'OFF' as 'off', the same storage trap
        // CoalWash's own K1 finding already named ("compared the folded spelling
        // but stored the RAW one"). Caught here before this shipped (board #113).
        const result = order[pi <= gi ? pi : gi]; // project may not be LOUDER than the (explicit-or-default) global
        merged[key] = result;
        if (legacy) merged[legacy] = result; // mirror so an OR-shaped read site (enableConductor/conductor) can't be fooled by a stale legacy field
      }
      // Same effective-value resolution as SAFER_ENUM above (via either the
      // new or legacy key name), but the safer direction for an array is
      // UNION (dedup), not "pick one side" — either side may add.
      for (const [key, { default: def, lower, legacy }] of Object.entries(UNION_ARRAY_KEYS)) {
        const projectArr = viaArr(projectCfg, key, legacy);
        if (projectArr === undefined) continue; // project expressed no opinion via either name
        const globalArr = viaArr(globalCfg, key, legacy) ?? def; // absent global = its schema default ([]), never "nothing to union"
        const foldFn = lower ? fold : (v) => v;
        const result = [...new Set([...globalArr, ...projectArr].map(foldFn))];
        merged[key] = result;
        if (legacy) merged[legacy] = result;
      }
      // Unconditional normalization, independent of the union branch above:
      // a global-only or project-only disabledCanaries/disable array (the
      // OTHER side never touched it, so the union guard's `continue` never
      // ran) still needs case-folding — config-schema.mjs's `lower: true`
      // is enforced by the CLI on write, not by a hand-edited file, and the
      // read sites' `.includes('rot-canary')` checks are case-sensitive.
      for (const k of ['disabledCanaries', 'disable']) {
        if (Array.isArray(merged[k])) merged[k] = merged[k].map(fold);
      }
      _cfg = merged;
    }
  } catch {}
  return _cfg;
}
// </coalmine-shared: node-config>

// Defensive edited-file-path extraction across hook payload shapes so the SAME
// hook serves both Claude Code and Antigravity (one core, no fork):
//   Claude Code:  input.tool_input.file_path
//   Antigravity:  input.toolCall.args.<name> (camelCase toolCall) — the AG
//                 PostToolUse payload is not fully documented, so try the common
//                 field names and skip silently when none is present (Phoenix #12).
// The AG PostToolUse matcher gates on edit tools (like CC's Write|Edit|MultiEdit),
// so a read tool's path arg does not reach here in practice; CC shape is tried
// first, keeping CC behavior byte-identical.
function extractEditedPath(input) {
  if (!input || typeof input !== 'object') return null;
  const bags = [input.tool_input, input.toolInput, input.toolCall && input.toolCall.args];
  for (const bag of bags) {
    if (bag && typeof bag === 'object') {
      for (const k of ['file_path', 'filePath', 'path', 'filename', 'file']) {
        if (typeof bag[k] === 'string' && bag[k]) return bag[k];
      }
    }
  }
  return null;
}

// Per-project calibration: .coalmine.json at root may disable this canary or
// override the mode for the project (principle 9 - calibrate, never assume).
function projectOverride() {
  try {
    const cfg = loadCfg();
    if (!cfg) return null;
    const disabled = cfg.disabledCanaries !== undefined ? cfg.disabledCanaries : cfg.disable; // legacy key honored
    if (Array.isArray(disabled) && (disabled.includes('rot-canary') || disabled.includes('all'))) return 'off';
    const mode = cfg.rotCanaryMode !== undefined ? cfg.rotCanaryMode : cfg.mode; // legacy key honored
    if (mode === 'off' || mode === 'manual') return mode;
  } catch {}
  return null;
}
function getTripwireMaxFileSizeKb() {
  try {
    const cfg = loadCfg();
    // clamp: a raw project value of 0 / negative / NaN would break the size gate
    // (same class as the tempSweepStaleDays clamp). Floor to a positive integer.
    if (cfg && Number.isFinite(cfg.tripwireMaxFileSizeKb)) {
      return Math.max(1, Math.floor(cfg.tripwireMaxFileSizeKb));
    }
  } catch {}
  return 100;
}
function getTripwireMaxLines() {
  try {
    const cfg = loadCfg();
    if (cfg && Number.isFinite(cfg.tripwireMaxLines)) {
      return Math.max(1, Math.floor(cfg.tripwireMaxLines));
    }
  } catch {}
  return 800;
}
function getWatchedExtensions() {
  const defaultExts = [
    '.cs', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go',
    '.java', '.kt', '.kts', '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.rb',
    '.php', '.swift', '.dart', '.fs', '.vb', '.scala', '.m', '.mm',
  ];
  try {
    const cfg = loadCfg();
    if (cfg && Array.isArray(cfg.watchedExtensions) && cfg.watchedExtensions.length > 0) {
      return new Set(cfg.watchedExtensions.map((x) => x.startsWith('.') ? x.toLowerCase() : '.' + x.toLowerCase()));
    }
  } catch {}
  return new Set(defaultExts);
}

// Scratch-space exclude (2026-07-25, dogfood-found): os.tmpdir() is where THIS hook
// keeps its OWN session state (rot-canary-<sid>.*) and where an agent's own throwaway
// scratchpad/harness files live (e.g. a long IC campaign's one-shot harness .mjs under
// the session scratchpad, which sits INSIDE os.tmpdir()) — never ship code, so it must
// never enter the touched/memmoved set. This is a scan-SCOPE exclude, not a security
// boundary: a lexical resolve-and-contain is correct (a missed symlinked-temp edge just
// means the file gets scanned — harmless), no realpath/fail-closed needed. This is the
// SAME asymmetric-derivation shape as isTestFile below and is deliberately NOT
// canonicalized here (ruling 2026-07-26): the miss direction is EXTRA SCANNING (noise),
// never a wrong exemption and never a safety hole, so the lexical compare stays rather
// than hardening a guard with no reachable defect. Boundary-safe
// (a trailing path.sep — "<tmp>X" must never match "<tmp>"); case-insensitive on win32,
// mirroring the isWin precedent used for the .touched dedup below.
function isUnderTmpdir(absPath) {
  const tmp = path.resolve(os.tmpdir());
  let p = path.resolve(absPath);
  let t = tmp;
  if (process.platform === 'win32') { p = p.toLowerCase(); t = t.toLowerCase(); }
  return p === t || p.startsWith(t + path.sep);
}

// Size-tripwire exemptions (coding-style.md amended 2026-07-26): 800 is a review
// SIGNAL, not a cap — the finding is an UNDECLARED over-run. A source file
// crossing tripwireMaxLines with a top-of-file declaration comment is compliant,
// and test files are out of scope entirely (their cohesion unit is the module
// under test). Neither exemption touches the merge-conflict tripwire or the
// .touched recording — the stop-scan still sees the file.
//
// A declaration = a head-of-file comment naming a marker + a line count:
//   // ponytail: <N> lines at declaration — <why splitting would reduce cohesion>
// `waiver:` is accepted alongside `ponytail:` — the tree reached for that word
// independently before the rule existed (scripts/lib/hooks.test.mjs:6). The N is
// HISTORY, not a live claim — deliberately NOT compared to the current count (a
// drifted number must not reopen the finding; that re-sync churn is what the
// amendment killed). Head-bounded: "top-of-file" per the rule, and a mid-file
// ponytail comment that happens to say "<N> lines" about something else must not
// silence the tripwire (deepest real declaration in the flock sits at the end of
// a header block — CoalLedger md-ast.mjs; re-derive with grep, don't trust a
// pinned line number here).
//
// LOOSE ON PURPOSE, and the boundary is measured, not assumed: this pattern also
// matches prose that merely mentions a line count (`/* ponytail: dropped 900
// lines of dead code */`, or that text inside a string literal) — both silence
// the tripwire, verified by probe. Tightening to the rule's literal
// `<N> lines at declaration` form would re-break every declaration the flock
// already wrote, INCLUDING hooks.test.mjs:6, which is the exact cry-wolf case
// this exemption exists to fix — so the looseness is accepted, not overlooked.
// The property that holds instead, and is designed for: the literal `<N>` form
// carries no digits, so the feature's OWN documentation cannot self-silence —
// this comment, config-schema.mjs, the .coalmine.json template and the PS twin's
// comment all still FLAG if they ever cross the cap (probe-verified).
//
// The 2048 slice is the ReDoS bound (mirrors STAMP_WINDOW in coalmine-conductor.js,
// v3.7.9 CM-1): lazy `.*?` before `\d+` backtracks quadratically in LINE LENGTH, and
// a poison line is reachable at shipped defaults — 100k digits + 801 short lines is
// 99.2 KB, under the 100 KB tripwireMaxFileSizeKb cap. Measured through this hook:
// 5424 ms unbounded vs 57 ms control; ~3 ms sliced. Phoenix #3 is ≤100 ms WITH a scan,
// and this is a PostToolUse hook that re-runs on every edit to that file.
const SIZE_DECLARATION_RE = /(?:ponytail|waiver):.*?\d+\s*lines/i;
const SIZE_DECLARATION_HEAD = 30;
const SIZE_DECLARATION_WINDOW = 2048; // no real declaration puts its digits past column 2048
function hasSizeDeclaration(lines) {
  const head = Math.min(lines.length, SIZE_DECLARATION_HEAD);
  for (let i = 0; i < head; i++) {
    if (SIZE_DECLARATION_RE.test(lines[i].slice(0, SIZE_DECLARATION_WINDOW))) return true;
  }
  return false;
}

// Test-file classifier — naming CONVENTIONS, not path identity: basename markers
// (.test./.spec./test_/_test. and friends, delimiter-anchored so contest.js never
// matches) plus test-directory segments, compared case-insensitively on every
// platform (a convention check, not the volume case-folding trap). Segments are
// consulted only BELOW the project root (findGitRoot of the resolution base) so
// an unlucky ancestor like /home/test cannot classify a whole tree as tests and
// silently retire the tripwire for that user.
// ponytail: delimiter-less suffix names (FooTests.cs, FooTest.java) are missed
// unless a test dir places them — extend the basename regex if that class shows
// up flagged in practice.
// NAMED RESIDUAL (the ancestor guard leaks in one config): findGitRoot CLIMBS PAST a
// non-git workspace, so when an OUTER repo owns the .git, a workspace dir merely
// NAMED test/spec becomes an in-root segment — <outer>/test/proj/src/big.js is then
// silently exempt for that whole subtree. Narrow config, silent-miss failure mode.
// Deliberately not "fixed" by anchoring on baseDir instead: that only trades this
// miss for a different one (a hook launched with cwd below the real root).
const TEST_DIR_SEGMENTS = new Set(['test', 'tests', '__tests__', 'spec', 'specs']);
// The two sides of the segment compare are derived INDEPENDENTLY — the root from
// process.cwd(), the file from the tool payload — so they can be two different
// SPELLINGS of one directory and the `..` guard below then rejects a path that is
// really inside the root. Measured: macOS CI went red here while ubuntu+windows
// passed, because process.cwd() is kernel-resolved to /private/var/... while the
// payload still says /var/... (.native also expands a Windows 8.3 alias, per
// node/runtime.md section 4). Canonicalize BOTH sides — never one — and never key
// this on a platform name: a symlinked tmpdir is a VOLUME property, and a
// platform test would be wrong on a symlinked-tmp Linux box in the other direction.
// Unresolvable (file already gone) degrades to the lexical compare, which fails
// CLOSED in the exemption sense: no exemption, the tripwire still fires.
//
// DELIBERATE, CONSIDERED INVERSION of node/runtime.md §4 ("fail closed on an
// unresolvable path, never fall back to a lexical resolve") — named here so a future
// §4 audit grepping realpathSync+catch finds a marker instead of a defect. §4 governs
// a CONTAINMENT/authorization compare, where the privileged outcome is "proceed", so a
// lexical fallback there could let something through. Here the privileged outcome is
// the EXEMPTION, so the same fallback DENIES it — the closed direction. The inversion
// is safe because of THIS call site, not because of the helper.
// ponytail: `physical()` is deliberately general-purpose but is NOT safe for a
// containment compare — its catch is fail-OPEN for anything whose privileged outcome
// is "proceed". Reusing it to guard a write/delete needs §4's fail-closed catch
// (rethrow / refuse), not this one.
// Nuance, NOT a defect: if BOTH sides fall back, the compare succeeds lexically and an
// exemption can be granted — unreachable on the live path (the only caller runs after
// the file was opened and read, so its dirname provably exists) and the blast radius is
// one un-emitted advisory line.
function physical(p) {
  try { return fs.realpathSync.native(p); } catch { return path.resolve(p); }
}
function isTestFile(absPath, baseDir) {
  const bn = path.basename(absPath).toLowerCase();
  if (/(^|[._-])(test|spec)s?[._-]/.test(bn)) return true;
  const rel = path.relative(physical(findGitRoot(baseDir)), physical(path.dirname(absPath)));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false; // at/outside the root: basename verdict only
  return rel.split(path.sep).some((s) => TEST_DIR_SEGMENTS.has(s.toLowerCase()));
}

function main() {
  const ov = projectOverride();
  if (ov === 'off') return;
  if (rcMode() === 'off') return;
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { return; }
  if (!raw) return;

  let input;
  // trim() also strips a leading BOM some shells prepend when piping stdin.
  try { input = JSON.parse(raw.trim()); } catch { return; }

  const f = extractEditedPath(input);
  if (!f) return;
  // Resolve a relative path against the payload's workspace when provided (AG launches
  // the hook with its own cwd = the hooks.json dir; CC's payload cwd equals
  // process.cwd(), so this is a no-op on CC — an absolute file_path ignores the base
  // either way). workspacePaths[0] = the current AG spec's field (re-derived
  // 2026-07-23); cwd stays as the CC + legacy fallback.
  const wsBase = Array.isArray(input.workspacePaths) ? input.workspacePaths[0] : undefined;
  const baseDir = (typeof wsBase === 'string' && wsBase)
    || ((typeof input.cwd === 'string' && input.cwd) ? input.cwd : process.cwd());
  const normF = path.resolve(baseDir, f);

  // Never record a file living under the hook's own os.tmpdir() — throwaway lab/scratch
  // (the session scratchpad, a one-shot harness), never ship code. Checked BEFORE
  // anything is recorded, ahead of the MEMORY.md marker branch below (a temp-resident
  // MEMORY.md must not set .memmoved either — temp files count for nothing) and ahead
  // of the watched-extension gate.
  if (isUnderTmpdir(normF)) return;

  // No session key → no consumer (the stop hook bails without one). Record nothing.
  // conversationId = the CURRENT AG spec's session field (re-derived 2026-07-23);
  // session_id (CC's documented core field) + camelCase sessionId stay as fallbacks.
  // MUST match the stop hook's chain — it reads the rot-canary-<sid> state keyed here.
  // (Parsed BEFORE the code-extension gate since the memory-drift marker below
  // needs it for non-code files too; a non-conforming sid still records nothing.)
  const sid = input.conversationId || input.session_id || input.sessionId;
  // Phoenix #10 (sandbox): allowlist the session_id so a traversal-shaped sid (e.g.
  // ../../etc/x) cannot escape os.tmpdir() via path.join. Non-conforming -> bail (fail-silent).
  // AG constraint: Antigravity's session_id format is undocumented — a sid outside this
  // allowlist records nothing there (safe degrade; fail-closed over widening without
  // evidence. The 2026-07-12 AG pilot's cadence DID fire, so real AG sids passed it).
  if (!sid || typeof sid !== 'string' || !/^[A-Za-z0-9_-]+$/.test(sid)) return;
  const base = path.join(os.tmpdir(), `rot-canary-${sid}`);

  // Memory-drift exit-gate marker (2026-07-24): a MEMORY.md edit (any directory) is
  // not a watched code extension, so record it as a 0-byte .memmoved marker BEFORE
  // the extension gate returns — the stop hook's drift check reads it to decide
  // "code moved but MEMORY did not". Swept with the other rot-canary-* temp.
  if (path.basename(normF).toLowerCase() === 'memory.md') {
    // Atomic wx create (O_CREAT|O_EXCL): EEXIST = already recorded this session —
    // swallowed by the catch. No existsSync pre-check (that was a TOCTOU window,
    // js/insecure-temporary-file); wx also refuses to write through a pre-planted
    // symlink. Name stays sid-scoped flat tmp like the sibling .touched/.smells
    // state (the session-UUID makes it unpredictable — the dismissed-FP class).
    // `mode: 0o600` — flat os.tmpdir(), no private subdir, so on a shared Unix /tmp this
    // file's own mode is the only thing scoping it to this user. Same CodeQL sink class as
    // #66/#67 (a temp-dir write with no `mode`); found by the CWK-043 batch sweep, never
    // itself reported. The sid in the name is unpredictability, which that rule does not read.
    try { fs.writeFileSync(base + '.memmoved', '', { flag: 'wx', mode: 0o600 }); } catch {}
    return; // .md is never in the watched code-extension set — nothing else to record
  }

  const watchedExts = getWatchedExtensions();
  if (!watchedExts.has(path.extname(normF).toLowerCase())) return;
  const touched = base + '.touched';

  let existing = [];
  try { existing = fs.readFileSync(touched, 'utf8').split('\n').filter(Boolean).map((x) => path.normalize(x)); } catch {}
  const isWin = process.platform === 'win32';
  const fCompare = isWin ? normF.toLowerCase() : normF;
  const existingCompare = isWin ? existing.map((x) => x.toLowerCase()) : existing;
  // `mode: 0o600` for the same threat reason as the sibling markers, NOT because a scanner
  // asked: `appendFileSync` is genuinely not one of js/insecure-temporary-file's 14 modelled
  // sinks, so nothing flags this line — but it is a FLAT os.tmpdir() write in the same
  // directory as `.memmoved`, and it carries MORE than that empty stamp does: the user's
  // edited file paths. Letting the scanner's sink list draw our threat boundary would be the
  // tail wagging the dog (CWK-043 INSPECT M1). `mode` applies at CREATE only — the first
  // append makes the file 0o600, later appends leave it alone, which is what we want.
  if (!existingCompare.includes(fCompare)) { try { fs.appendFileSync(touched, normF + '\n', { mode: 0o600 }); } catch {} }

  // Tripwire scan — skip very large files to stay inside the latency budget
  // (Phoenix #3: ≤100ms with scan). Default cap 100KB (tripwireMaxFileSizeKb) to
  // prevent CPU lock and token bloat.
  let lines;
  try {
    const fd = fs.openSync(normF, 'r');
    try {
      // statSync->readFileSync on a path is a TOCTOU; fstat + read on one fd is not,
      // and still skips large files before reading (Phoenix #3 latency budget).
      const size = fs.fstatSync(fd).size;
      if (size > getTripwireMaxFileSizeKb() * 1024) return;
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, 0);
      lines = buf.toString('utf8').split(/\r?\n/);
    } finally {
      fs.closeSync(fd);
    }
  } catch { return; }

  const smells = [];
  // A real merge conflict always has an angle-bracket opener/closer. Key the tripwire
  // on those: a bare '=======' line is a common ASCII section banner in source comments,
  // so flag only when a '<<<<<<< '/'>>>>>>> ' line is present (the bracket IS the signal;
  // the '=======' divider alone never fires, so it needs no separate test).
  if (lines.some((l) => /^(<<<<<<< |>>>>>>> )/.test(l))) smells.push('merge-conflict markers');
  const maxLines = getTripwireMaxLines();
  // A file with exactly maxLines content lines + a trailing newline splits to maxLines+1
  // elements; drop that single trailing empty element so a file AT the cap is not flagged.
  const lineCount = lines.length - (lines[lines.length - 1] === '' ? 1 : 0);
  // Exemption order: the cheap count check short-circuits first (happy path pays
  // nothing); the classifier + declaration scan run only on an over-run.
  if (lineCount > maxLines && !isTestFile(normF, baseDir) && !hasSizeDeclaration(lines)) {
    smells.push(`file >${maxLines} lines (${lineCount})`);
  }
  if (smells.length) {
    // One line per file — the stop hook reports each .smells line verbatim.
    // `mode: 0o600` on the same threat grounds as `.touched` above (CWK-043 INSPECT M1):
    // flat os.tmpdir(), and this one carries the user's paths PLUS the findings against
    // them. Unmodelled by the query (appendFileSync is not one of its 14 sinks) and
    // hardened anyway — the threat, not the sink list, is the boundary.
    try { fs.appendFileSync(base + '.smells', `${normF}: ${smells.join('; ')}\n`, { mode: 0o600 }); } catch {}
  }
}

try { main(); } catch {}
