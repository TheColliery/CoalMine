// UMB-133 (2026-09-21): the two LEGACY per-project shapes, in read order — first
// existing wins, both AFTER the canonical three. Before this the nested shape
// was no candidate at all, so a config a user reasonably wrote there was
// silently walked past (the same class as CoalTipple's `fableConsent` that sat
// dead for 14 days). The flock agrees on both shapes; the migration notice and
// the README's `### Deprecated` entry name the canonical path.
const LEGACY_CONFIGS = ['.claude/.coalmine.json', '.coalmine.json'];

// GLOBAL-FILE GUARD: `<root>/.claude/.coalmine.json` IS the global
// config when `root` is the home dir (a dotfiles repo at `~`, or a non-git dir
// under it). It must never be taken for a PROJECT config: read as one it is
// merely the global layer twice (harmless), but a writer that migrates a
// "legacy project config" would move the user's GLOBAL file. Identity compare
// (node/runtime.md §4: both sides through realpathSync.native), evaluated only
// once a candidate is known to exist, so a project with no such file pays
// nothing. An unresolvable pair means "not the same file" — the PERMISSIVE answer, and on the
// WRITE side (configure.mjs's move + delete) the destructive one; it is unreachable because
// `existsSync(p)` precedes every call and the global side must exist for the collision to arise.
function isGlobalCfgFile(p) {
  try {
    // R14 / B-u3-2b (the git-home case): os.homedir() follows HOME/USERPROFILE, which a sandboxed run moves away from
    // the real profile, so the REAL ~/.claude/.coalmine.json was taken for a project's legacy config and migrated.
    // os.userInfo().homedir reads the OS account record, which no environment variable moves. Compare against both.
    const here = fs.realpathSync.native(p);
    const homes = [os.homedir()];
    try { homes.push(os.userInfo().homedir); } catch { /* no account record: the env home alone */ }
    return homes.some((h) => {
      try { return here === fs.realpathSync.native(path.join(h, '.claude', '.coalmine.json')); } catch { return false; }
    });
  } catch { return false; }
}

// The three per-agent-dir shapes were added by the namespace campaign
// (#69+#39, owner-designated 2026-08-08) alongside the LEGACY dotfile: a
// project configured ONLY through the new shape (no `.git` present) would
// otherwise match nothing and fall through to the raw `startDir` fallback —
// the exact per-subdir-scatter class hooks-safety.md §8 (the phantom-slug
// law) already names for a wrongly-anchored state root. Additive-only: each
// new marker can only make the walk stop LOWER/narrower, `.git` is checked
// first and still wins wherever it is present.
// UMB-133 adds the nested legacy shape for the SAME reason: a project
// configured ONLY through `.claude/.coalmine.json` (no `.git`) would otherwise
// anchor nowhere. It is checked separately below, NOT in this list, because it
// is the one marker that can be the GLOBAL file (see isGlobalCfgFile) — and at
// the home dir that would make the fallback WIDER than `startDir`, the opposite
// of "only narrower".
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
    const nested = path.join(dir, LEGACY_CONFIGS[0]);
    if (fs.existsSync(nested) && !isGlobalCfgFile(nested)) {
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
//   3. LEGACY, in this order, first FOUND wins (UMB-133 — both shapes, the
//      whole flock agrees): <project>/.claude/.<skill>.json, then
//      <project>/.<skill>.json — read normally, no breakage for an existing
//      user; the conductor names the canonical path on a legacy hit and names
//      a config at a non-candidate path as IGNORED (see buildLines).
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
  for (const l of LEGACY_CONFIGS) candidates.push(path.join(root, l)); // LEGACY, always last, in order
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
  for (const c of candidates) { if (fs.existsSync(c) && !isGlobalCfgFile(c)) return c; }
  return ownDirDefault(root); // nothing found anywhere -- own-dir is both the read and write target
}

// CWK-137 -- BOUNDED READS OF REPO-DERIVED PATHS. A cloned repo is untrusted: its
// `.coalmine.json`, `AGENTS.md` and rule files can be symlinks to /dev/zero (the
// conductor allocated ~8 GB and died, std::bad_alloc, measured on 59ee1e7), FIFOs
// (open() blocks forever) or links out of the repo. Every hook read of such a path
// goes through readRepoFileBounded; a refused read is a SILENT skip (Phoenix #4/#13).
// The rules, identical to scripts/lib/repo-fs.mjs (the CLI copy -- a hook cannot
// import an ESM lib, Phoenix #9; repo-fs.test.mjs asserts both bounds match -- the
// config bound here, the document bound in coalmine-conductor.js):
//   lstat; a regular file proceeds; a symlink proceeds only when its realpath.native
//   target lies inside the root's realpath AND is a regular file; a FIFO, device,
//   socket, directory, or escaping/dangling link is skipped BEFORE open. Then open
//   (O_NONBLOCK where it exists, so a FIFO swapped in after the lstat cannot block),
//   fstat the fd, and re-check regular + size on the fd. Over the bound = SKIPPED,
//   never truncated: a truncated JSON config would parse as malformed, a truncated
//   stamp scan would miss stamps silently.
// `root` null = no containment: the user's own home files (the global config, the
// update stamp, the mode switch) are legitimately symlinked by dotfile managers, but
// still get regular-file + size, since /dev/zero there is still a hang.
// RESIDUAL, named: a regular file swapped in between the lstat and the open may lie
// outside the root; the fd check still holds it to a bounded regular-file read.
// Bound measured on this box 2026-09-24 over every repo under source/repos (27,451
// files): the largest real `.coalmine.json` is 9,114 B (the shipped commented template).
// The DOCUMENT bound (MAX_DOC_BYTES) lives in coalmine-conductor.js, its only reader:
// kept here it rode into the stop and touch hooks unused (CodeQL #70-#73).
const MAX_CONFIG_BYTES = 1024 * 1024;   // ~115x the largest config
const REPO_READ_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0);
function isContained(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}
function repoEntryKind(p, root) { // 'file' | 'dir' | null, decided WITHOUT opening p
  try {
    const lst = fs.lstatSync(p);
    if (!lst.isSymbolicLink() && !lst.isFile() && !lst.isDirectory()) return null;
    if (root != null && !isContained(fs.realpathSync.native(p), fs.realpathSync.native(root))) return null;
    const st = lst.isSymbolicLink() ? fs.statSync(p) : lst;
    if (st.isFile()) return 'file';
    if (st.isDirectory()) return 'dir';
    return null;
  } catch { return null; }
}
function readRepoFileBounded(file, root, maxBytes, prefixOnly) {
  if (repoEntryKind(file, root) !== 'file') return null;
  let fd;
  try {
    fd = fs.openSync(file, REPO_READ_FLAGS);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return null;
    if (st.size > maxBytes && !prefixOnly) return null;
    const want = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(want);
    let got = 0;
    while (got < want) {
      const n = fs.readSync(fd, buf, got, want - got, got);
      if (n === 0) break;
      got += n;
    }
    return buf.toString('utf8', 0, got);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}

// One BOM- and comment-tolerant JSONC read. Strips // and /* */ comments outside
// strings: the string alternative consumes an escaped char (\\.) or any
// non-quote/non-backslash char, so a value ending in \\ terminates the string
// correctly instead of leaking escape state into the next token (which would
// mis-strip a later //-containing string → silent revert).
// `root` = the project root for a repo-derived config, null for the global one (CWK-137).
function readCfgFile(file, root) {
  return readCfgResult(file, root).cfg;
}

// UMB-174 (b) + R6 AMENDMENT 2: the same read, plus WHY a config that exists was not
// used, so the conductor can say so on its one sanctioned SessionStart line instead of
// staying silent. `reason` is one of the flock's four, or null:
//   'malformed JSON'    -- JSON.parse threw (a leading U+FEFF is stripped BEFORE the
//                          parse, RFC 8259 §8.1; PS 5.1 writes one whenever asked for UTF-8)
//   'not a JSON object' -- valid JSON that is not a plain object ([1], "x", 3, null)
//   'a directory'       -- the candidate is a directory (or a contained link to one)
//   'unreadable'        -- the OS denied the read: EACCES, or EPERM (a Windows ACL denial)
// null = read and used, or absent, or REFUSED by the CWK-137 reader (a link out of the
// root, over MAX_CONFIG_BYTES, a FIFO or device): those stay SILENT by the head's ruling
// (a new reason for them is a flock-wide question, returned to main). The fs error is
// keyed on its CODE, never its message (node/runtime.md §7). The SELECTION is unchanged:
// every caller already skips a null cfg exactly as before.
function readCfgResult(file, root) {
  let raw;
  try { raw = readRepoFileBounded(file, root, MAX_CONFIG_BYTES); } catch { raw = null; }
  if (raw === null) return { cfg: null, reason: cfgRefusalReason(file, root) };
  let parsed;
  try {
    const content = raw.replace(/^\uFEFF/, '');
    const cleanJson = content.replace(/"(?:\\.|[^"\\])*"|\/\/.*|\/\*[\s\S]*?\*\//g, (m) => (m[0] === '"' ? m : ''));
    parsed = JSON.parse(cleanJson);
  } catch { return { cfg: null, reason: 'malformed JSON' }; }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { cfg: parsed, reason: null };
  return { cfg: null, reason: 'not a JSON object' };
}

// Why readRepoFileBounded gave nothing back -- consulted ONLY on that failure path, so a
// config that reads cleanly costs no extra syscall. A second open is made only for a
// regular, contained file, so a FIFO is still never opened.
// R12 (CodeQL #74-#79, js/file-system-race): this function holds NO fs call on `file`. The
// path checks live in cfgPlacement and the open in cfgOpenVerdict, the way readRepoFileBounded
// leans on repoEntryKind. What makes the alerts' pattern go away is that SPLIT: no path
// check shares a function with the open (by the query's source it pairs a check and an
// open of one path only inside one function). Only the next push's code-scanning list shows
// whether they clear.
function cfgRefusalReason(file, root) {
  const where = cfgPlacement(file, root);
  if (where === 'a directory' || where === 'unreadable') return where;
  return where === 'file' ? cfgOpenVerdict(file) : null;
}

// Where the config candidate sits, decided WITHOUT opening it: 'a directory' | 'unreadable'
// (lstat itself was denied) | 'file' (a regular, contained file: worth one probe open) | null.
function cfgPlacement(file, root) {
  let lst;
  try { lst = fs.lstatSync(file); } catch (e) { return cfgDenied(e) ? 'unreadable' : null; }
  const kind = repoEntryKind(file, root);
  if (kind === 'dir') return 'a directory';
  if (kind === 'file') return 'file';
  // A Windows ACL read-deny makes realpathSync.native on the FILE throw EPERM (measured:
  // lstat and stat succeed, realpath and open do not), so repoEntryKind cannot place it.
  // A plain file (never a link) lives where its parent directory does, so containment is
  // checked through the PARENT's realpath instead -- a link out of the root, a FIFO or a
  // device still falls through to silence.
  if (!lst.isFile()) return null;
  try {
    const dirReal = fs.realpathSync.native(path.dirname(file));
    if (root != null && !isContained(path.join(dirReal, path.basename(file)), fs.realpathSync.native(root))) return null;
  } catch { return null; }
  return 'file';
}
function cfgDenied(e) { return !!(e && (e.code === 'EACCES' || e.code === 'EPERM')); }

// The probe open: it exists only to learn the OS verdict (errno EACCES/EPERM); an open that
// succeeds is closed unread and the verdict is silent (the bound refused it, over
// MAX_CONFIG_BYTES). A denied open may belong to a non-file swapped in after the path checks
// (a mode-0 FIFO), so statSync decides: it follows a link, so a link to an unreadable regular
// file still reads 'unreadable', and a FIFO (swapped in, or behind a link) stays silent. The
// worst a further race can do is change one advisory line. The two R12 outcome tests in
// hooks.test.mjs (in-root link, mode-0 FIFO swap) pin this.
function cfgOpenVerdict(file) {
  let fd;
  try { fd = fs.openSync(file, REPO_READ_FLAGS); } catch (e) {
    if (!cfgDenied(e)) return null;
    try { return fs.statSync(file).isFile() ? 'unreadable' : null; } catch { return null; }
  }
  try { fs.closeSync(fd); } catch {}
  return null;
}

// Two-level cached read of .coalmine.json: the global ~/.claude/.coalmine.json
// overlaid per key by the project config (project wins). Per-project config
// now lives under an agent dir (namespace campaign #69+#39, owner-designated
// 2026-08-08) — see `projectConfigPath`'s own header above for the full read
// order and the two LEGACY fallbacks it still honors (UMB-133).
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
// The project's value for `key` (and its legacy alias) is unusable: restore what the GLOBAL layer
// said under each name, or remove the name so every read site falls to its own default.
function dropProject(merged, globalCfg, key, legacy) {
  for (const name of legacy ? [key, legacy] : [key]) {
    if (globalCfg && globalCfg[name] !== undefined) merged[name] = globalCfg[name];
    else delete merged[name];
  }
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
// UMB-133 findings-back (INSPECT MEDIUM-1): loadCfg takes an OPTIONAL base — the directory the
// project-config walk starts from. No argument = `process.cwd()`, exactly as before: that is the
// rot-canary-touch/-stop call shape (PostToolUse/Stop, whose cwd semantics are not this unit's
// subject) and it must stay behaviour-identical. Only the conductor's AG and Gemini adapters pass
// one — their hook process does NOT run in the workspace, so reading the project config from
// `process.cwd()` there read a different project than the one the adapter reports on.
// The cache is ONE entry keyed to the resolved base (`null` = the process cwd): asking for a
// different base recomputes and replaces it, so a second base is never served the first base's
// config; alternating bases thrash (one recompute each, still correct) rather than go stale.
let _cfg;
let _cfgBase;
function loadCfg(base) {
  const key = base === undefined ? null : path.resolve(base);
  if (_cfg !== undefined && _cfgBase === key) return _cfg;
  _cfgBase = key;
  _cfg = null;
  try {
    const globalCfg = readCfgFile(path.join(os.homedir(), '.claude', '.coalmine.json'), null);
    const projRoot = findGitRoot(base === undefined ? process.cwd() : base);
    const projectCfg = readCfgFile(projectConfigPath(projRoot), projRoot);
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
        const gi0 = order.indexOf(fold(globalValue));
        const gi = gi0 === -1 ? order.indexOf(def) : gi0; // an unknown GLOBAL value reads as the schema default
        const pi = order.indexOf(fold(projectVal));
        if (pi === -1) {
          // R13 / CWK-158 item 1 + CWK-141 (1): an unknown or ill-typed PROJECT value (null, a
          // string outside the enum, a number) is DROPPED -- it reads as ABSENT, so the global
          // (or the schema default) decides. It used to `continue` and leave the raw junk in the
          // shallow merge, which defeated an explicit global off/false on every consent gate.
          dropProject(merged, globalCfg, key, legacy);
          continue;
        }
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
        if (projectArr === undefined) {
          // R13 / CWK-158 item 1: a project value that is PRESENT but not an array (null, a string,
          // a number) used to survive the merge raw and replace the owner's global list; it is
          // dropped now -- the global list (or the default) stands.
          if (projectCfg && (projectCfg[key] !== undefined || (legacy && projectCfg[legacy] !== undefined))) dropProject(merged, globalCfg, key, legacy);
          continue; // otherwise the project expressed no opinion via either name
        }
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
