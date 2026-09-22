// Per-project .coalmine.json config-path resolution — shared by every CLI
// script that reads or writes the project config (configure.mjs, install.mjs).
// Hooks carry their OWN copy of this same logic in hooks/_shared/node-config.js
// (Phoenix #9: hooks stay copy-one-file portable, they cannot import a
// scripts/lib module) — keep the two in sync by hand if the read order itself
// ever changes.
import fs from 'fs';
import os from 'os';
import path from 'path';

export const AGENT_DIR_ORDER = ['.claude', '.agents', '.gemini'];

// UMB-133 (2026-09-21) — the two LEGACY shapes, in read order, first existing
// wins, both AFTER the canonical three. The hooks' own copy is
// hooks/_shared/node-config.js (LEGACY_CONFIGS + isGlobalCfgFile): keep the
// three in step by hand. CLI writers matter here more than the hooks do: a
// writer that did not see `.claude/.coalmine.json` would write a fresh
// canonical file that then SHADOWS it, silently dropping the user's settings.
export const LEGACY_CONFIGS = ['.claude/.coalmine.json', '.coalmine.json'];

// `<root>/.claude/.coalmine.json` IS the GLOBAL config when root is the home
// dir (a dotfiles repo at `~`). Never a project config: configure.mjs migrates
// a "legacy project config" by moving + deleting it, which would move the
// user's GLOBAL file out from under the hooks. Identity compare, both sides
// through realpathSync.native (node/runtime.md §4). Unresolvable = "not the same file": the
// PERMISSIVE answer, and on this WRITE side (the move + delete) the destructive one — unreachable,
// because every caller runs `existsSync(p)` first and the global side must exist for a collision.
export function isGlobalCfgFile(p) {
  try {
    return fs.realpathSync.native(p) === fs.realpathSync.native(path.join(os.homedir(), '.claude', '.coalmine.json'));
  } catch { return false; }
}

// Namespace campaign (#69+#39, owner-designated 2026-08-08). Per-project
// config lives under an agent dir, never bare at the project root any more.
// THE READ ORDER IS A RAIL — identical wording in every room's readCfg
// comment and README Configure section, one flock:
//   1. <project>/.<the running agent's OWN dir>/coal/coalmine.json — the dir
//      of the agent actually executing. CoalMine activates ONLY through
//      Claude Code's own hook system; it has no other running-agent identity
//      to branch on, so "own dir" is always `.claude` and collapses onto the
//      first entry of step 2 below rather than needing a separate check.
//   2. Other known agent dirs, fixed order: `.claude` -> `.agents` ->
//      `.gemini` (first FOUND wins).
//   3. LEGACY, in this order, first FOUND wins (UMB-133): <project>/.claude/.coalmine.json,
//      then <project>/.coalmine.json (the pre-2026-08-08 root shape) — read
//      normally, no breakage for an existing user.
// WRITE target = where the config was found; absent everywhere, the FIRST
// agent dir the project already has ON DISK (`.claude` -> `.agents` ->
// `.gemini`), never a bare "own dir" default — a project that only uses
// `.agents`/`.gemini` must not get a foreign `.claude/` planted into it. No
// agent dir present at all -> the running agent's own dir (`.claude`), same
// as before this fix. See ownDirDefault() below.
export function projectConfigCandidates(root) {
  const candidates = AGENT_DIR_ORDER.map((d) => path.join(root, d, 'coal', 'coalmine.json'));
  for (const l of LEGACY_CONFIGS) candidates.push(path.join(root, l)); // LEGACY, always last, in order
  return candidates;
}

// Fresh-default / migration write target when NO config exists anywhere yet
// (INSPECT MEDIUM 2, 2026-08-08): the design doc's own intent is "nests under
// whichever agent config dir the project ALREADY HAS" -- candidates[0] alone
// always means `.claude`, which plants a foreign `.claude/` into a project
// that only uses `.agents`/`.gemini` and has never touched Claude Code. Pick
// the first AGENT_DIR_ORDER entry that already exists as a directory on disk
// (the agent dir itself, not the config file inside it); none present ->
// `.claude` (AGENT_DIR_ORDER[0]), the same default a never-configured project
// got before this fix.
function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
export function ownDirDefault(root) {
  const dir = AGENT_DIR_ORDER.find((d) => isDir(path.join(root, d))) ?? AGENT_DIR_ORDER[0];
  return path.join(root, dir, 'coal', 'coalmine.json');
}

export function projectConfigPath(root) {
  const candidates = projectConfigCandidates(root);
  for (const c of candidates) { if (fs.existsSync(c) && !isGlobalCfgFile(c)) return c; }
  return ownDirDefault(root); // nothing found anywhere -- own-dir is both the read and write target
}
