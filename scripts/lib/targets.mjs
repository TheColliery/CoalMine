// CoalMine agent install targets — the single source of truth for the
// agent → skills-dir map. Shared by install.mjs and verify.mjs so the two
// can never drift. Node built-ins only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Paths verified against vendor docs (Jun 2026):
//   codex → $CWD/.agents/skills per developers.openai.com/codex/skills.md
//   (NOT ~/.codex/skills); junie → .junie/skills per junie.jetbrains.com/docs/agent-skills.html.
//   cline → .claude/skills (Cline reads .claude/.cline, NOT .agents — docs.cline.bot).
//   roocode REMOVED 2026-06: Roo Code archived 2026-05-15 (team → Roomote); dead vendor = drop support.
//   kiro → .kiro/skills (does NOT read .agents/skills); augment → .augment/skills.
//   Both verified 2026-07-15 (platform-wave pass; exact doc URL not captured).
export const TARGETS = {
  claude:      path.join(os.homedir(), '.claude', 'skills'),
  antigravity: path.join(process.cwd(), '.agents', 'skills'),
  copilot:     path.join(process.cwd(), '.github', 'skills'),
  codex:       path.join(process.cwd(), '.agents', 'skills'),
  cursor:      path.join(process.cwd(), '.cursor', 'skills'),
  windsurf:    path.join(process.cwd(), '.windsurf', 'skills'),
  cline:       path.join(process.cwd(), '.claude', 'skills'),
  amp:         path.join(process.cwd(), '.agents', 'skills'),
  goose:       path.join(process.cwd(), '.agents', 'skills'),
  junie:       path.join(process.cwd(), '.junie', 'skills'),
  gemini:      path.join(process.cwd(), '.gemini', 'skills'),
  kiro:        path.join(process.cwd(), '.kiro', 'skills'),
  augment:     path.join(process.cwd(), '.augment', 'skills'),
};

// Agents NOT auto-detected by `install.mjs all`. Their skills dir is ambiguous
// with a global/plugin install, so auto-seeding it risks duplicate skills:
//   claude → global ~/.claude/skills (use the plugin, or `install.mjs claude`)
//   cline  → project .claude/skills, which Claude Code itself also reads, so
//            auto-installing there could double a plugin user's skill list.
// Both stay installable explicitly by name. Other agents read .agents/skills
// (Copilot/Cursor/Windsurf read it AND their vendor dir), so `all` reaches them.
export const ALL_EXCLUDE = new Set(['claude', 'cline']);

// The project cwd baked into the TARGETS literals above (evaluated at import).
const IMPORT_CWD = process.cwd();

// Presence detection for `install.mjs all`: an agent is "present" when its
// config home (the parent of its skills dir — e.g. .cursor/ or .agents/)
// already exists under `cwd`. Each project target is re-rooted onto the passed
// cwd so the logic stays unit-testable against a sandbox dir. Home/global
// targets (Claude's ~/.claude) and ALL_EXCLUDE agents are never auto-detected.
// Deterministic: same tree → same split, no time/random branching.
export function detectPresentAgents(cwd = process.cwd()) {
  const present = [];
  const absent = [];
  for (const k of Object.keys(TARGETS)) {
    if (ALL_EXCLUDE.has(k)) continue;
    const rel = path.relative(IMPORT_CWD, TARGETS[k]);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue; // not a project target
    const marker = path.dirname(path.join(cwd, rel)); // <cwd>/.cursor, <cwd>/.agents, ...
    (fs.existsSync(marker) ? present : absent).push(k);
  }
  return { present, absent };
}
