#!/usr/bin/env node
// CoalMine installer — copy ALL skills/<name>/ into a target agent's skills dir.
// Performs build-time injection of shared sections from skills/_shared/.
// Generates platform-specific auto-trigger config files (idempotent append).
// Cross-platform (Windows + Unix).
//
// Usage (run from YOUR project root — project targets resolve against cwd):
//   Claude Code users: prefer the plugin (/plugin install coalmine@coalmine) —
//   it serves the same conformed skills and auto-wires hooks. The claude target
//   below is for setups that can't use the plugin.
//   node scripts/install.mjs claude        → ~/.claude/skills/        (global)
//   node scripts/install.mjs antigravity   → ./.agents/skills/        (project, cwd)
//   node scripts/install.mjs copilot       → ./.github/skills/        (project, cwd)
//   node scripts/install.mjs codex         → ./.agents/skills/        (project, cwd)
//   node scripts/install.mjs <PATH>        → <PATH>/                  (any dir)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadShared as loadSharedFrom, listSkills, installSkillDir } from './lib/render.mjs';
import { TARGETS, detectPresentAgents } from './lib/targets.mjs';
import { MANIFEST_NAME, hashInstalledTree } from './lib/manifest.mjs';
import { projectConfigCandidates, ownDirDefault } from './lib/config-paths.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsSrc = path.join(repo, 'skills');
const sharedDir = path.join(skillsSrc, '_shared');
const platformDir = path.join(repo, 'platform-configs');

// Platform config output paths (relative to cwd) and their templates
const PLATFORM_CONFIGS = {
  cursor:   { dest: path.join(process.cwd(), '.cursor', 'rules', 'coalmine-trigger.mdc'),        tpl: 'cursor.mdc.template' },
  windsurf: { dest: path.join(process.cwd(), '.windsurf', 'rules', 'coalmine-trigger.md'),       tpl: 'windsurf.md.template' },
  cline:    { dest: path.join(process.cwd(), '.clinerules'),                                     tpl: 'clinerules.template' },
  copilot:  { dest: path.join(process.cwd(), '.github', 'copilot-instructions.md'),              tpl: 'copilot-instructions.template' },
  antigravity: { dest: path.join(process.cwd(), '.agents', 'rules', 'coalmine-trigger.md'),     tpl: 'windsurf.md.template' },
  amp:      { dest: path.join(process.cwd(), '.agents', 'rules', 'coalmine-trigger.md'),        tpl: 'windsurf.md.template' },
  goose:    { dest: path.join(process.cwd(), '.agents', 'rules', 'coalmine-trigger.md'),        tpl: 'windsurf.md.template' },
  junie:    { dest: path.join(process.cwd(), '.agents', 'rules', 'coalmine-trigger.md'),        tpl: 'windsurf.md.template' },
  gemini:   { dest: path.join(process.cwd(), '.gemini', 'rules', 'coalmine-trigger.md'),        tpl: 'windsurf.md.template' },
};

// ─── Load shared sections (render core lives in lib/render.mjs) ────────────
// CWK-071: returns null on failure (instead of exiting) -- every caller below
// checks for null and returns from main() itself, which is the only thing that
// can actually stop the remaining work from this helper's own frame.
function loadShared() {
  try {
    return loadSharedFrom(sharedDir);
  } catch (e) {
    console.error(`Failed to load shared sections: ${e.message}`);
    process.exitCode = 1;
    return null;
  }
}

// ─── Idempotent append of platform config ──────────────────────────────────
const CM_START = '<!-- COALMINE:START -->';
const CM_END   = '<!-- COALMINE:END -->';
// For clinerules (# style comments):
const CM_START_HASH = '# COALMINE:START';
const CM_END_HASH   = '# COALMINE:END';

function upsertConfig(destFile, tplFile) {
  try {
    const tplPath = path.join(platformDir, tplFile);
    if (!fs.existsSync(tplPath)) { console.warn(`  [warn] template not found: ${tplFile}`); return; }
    const tplContent = fs.readFileSync(tplPath, 'utf8').trim();

    const isHash = tplFile.includes('clinerules');
    const start  = isHash ? CM_START_HASH : CM_START;
    const end    = isHash ? CM_END_HASH   : CM_END;

    fs.mkdirSync(path.dirname(destFile), { recursive: true });

    // Read-then-handle-ENOENT (no existsSync precheck) so there is no check-to-use gap.
    let existing;
    try {
      existing = fs.readFileSync(destFile, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e; // a real read error surfaces to the outer catch
      // New file
      fs.writeFileSync(destFile, tplContent + '\n', 'utf8');
      console.log(`  created ${path.relative(process.cwd(), destFile)}`);
      return;
    }
    const si = existing.indexOf(start);
    const ei = existing.indexOf(end);

    if (si !== -1 && ei !== -1 && ei > si) {
      // Update existing CoalMine section — splice in only the marker-delimited
      // block, so template content outside the markers (e.g. cursor.mdc YAML
      // frontmatter) is not duplicated on every re-run.
      const ts = tplContent.indexOf(start);
      const te = tplContent.indexOf(end);
      const block = ts !== -1 && te !== -1 && te > ts ? tplContent.slice(ts, te + end.length) : tplContent;
      existing = existing.slice(0, si) + block + existing.slice(ei + end.length);
      fs.writeFileSync(destFile, existing, 'utf8');
      console.log(`  updated ${path.relative(process.cwd(), destFile)}`);
    } else {
      // Append new CoalMine section
      const sep = existing.trim().length === 0 ? '' : (existing.endsWith('\n') ? '\n' : '\n\n');
      fs.writeFileSync(destFile, existing + sep + tplContent + '\n', 'utf8');
      console.log(`  appended ${path.relative(process.cwd(), destFile)}`);
    }
  } catch (e) {
    console.warn(`  [warn] could not write config ${destFile}: ${e.message}`);
    process.exitCode = 1;
  }
}

function resolveGitDir(repoDir) {
  const gitPath = path.join(repoDir, '.git');
  if (!fs.existsSync(gitPath)) return null;
  const stat = fs.statSync(gitPath);
  if (stat.isDirectory()) return gitPath;
  if (stat.isFile()) {
    try {
      const content = fs.readFileSync(gitPath, 'utf8').trim();
      const match = content.match(/^gitdir:\s*(.+)$/);
      if (match) {
        return path.resolve(repoDir, match[1].trim());
      }
    } catch {}
  }
  return null;
}

// Where git will ACTUALLY look for hooks. `core.hooksPath` (husky v9+, lefthook,
// the pre-commit framework, our own .githooks/) moves that directory, and writing
// to <gitDir>/hooks anyway installs an inert gate under a success message.
// A relative value resolves against the worktree root — the directory git runs
// hooks from (githooks(5)) and the one where we just found `.git`.
// No git binary / not set / any failure → the historical <gitDir>/hooks.
function resolveHooksDir(repoDir, gitDir) {
  try {
    const r = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: repoDir, encoding: 'utf8' });
    const configured = r.status === 0 && r.stdout ? r.stdout.trim() : '';
    if (configured) return path.resolve(repoDir, configured);
  } catch {}
  return path.join(gitDir, 'hooks');
}

// Is this hook one WE generated? Every version has carried a `# CoalMine <name>
// hook` header; `# Generated by CoalMine` only since v2.4.0, so keying on that
// alone files a pre-v2.4.0 CoalMine hook as the user's. Header-bounded on
// purpose: a user hook that merely mentions CoalMine stays theirs.
const OWN_HOOK_RE = /^#\s*(?:CoalMine\b|Generated by CoalMine\b)/;
function isOwnHook(content) {
  return content.split('\n', 5).some((line) => OWN_HOOK_RE.test(line));
}

// CWK-096 -- tracked-ness is asked of git, never inferred from a path. `resolveHooksDir`
// honours `core.hooksPath`, which can point INSIDE the worktree (this repo's own
// `.githooks/`) -- a Coal* uninstall must never delete a file the repo's own maintainer
// versions. `git ls-files --error-unmatch` is the oracle: exit 0 = tracked, exit 1 =
// genuinely untracked, ANYTHING ELSE means the question could not be answered -- and
// "could not tell" is not "it is untracked" (the same `isDir` tri-state lesson from
// d65ae5c, applied here to a delete instead of a carve-out). `hookPath` is absolute;
// `git ls-files` resolves it against `repoDir` fine.
//
// LOW-1 (r33 INSPECT) -- "no git binary" is NOT a reachable producer of the `unknown`
// verdict this function returns, despite what an earlier version of this comment (and
// the refusal message, and the CHANGELOG) claimed: with no git binary, `resolveHooksDir`
// never learns a configured `core.hooksPath` and always falls back to `<gitDir>/hooks`,
// which is outside the worktree by construction and never reaches this function at all
// (see `insideWorktree` at the call site below) -- measured directly, including against
// a `.git` FILE pointing a gitdir INSIDE the worktree with no git binary present. The
// one REACHABLE producer of `unknown` is a git process that started (so `r.error` is
// unset and a `configured` path DID put us inside the worktree) but was killed or
// otherwise failed mid-run, returning neither 0 nor 1.
function trackedStatus(hookPath, repoDir) {
  const r = spawnSync('git', ['ls-files', '--error-unmatch', hookPath], { cwd: repoDir, encoding: 'utf8' });
  if (r.error) return 'unknown';
  if (r.status === 0) return 'tracked';
  if (r.status === 1) return 'untracked';
  return 'unknown';
}

// Lexical containment for a SCOPE decision (never a security boundary -- node/runtime.md
// section 4's realpath rule binds an ownership/allowlist check, not this): is `childPath`
// on or under `parentPath`?
function isUnderDir(childPath, parentPath) {
  const rel = path.relative(parentPath, childPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// ─── Git Hooks Installation ──────────────────────────────────────────────────
function installGitHooks() {
  try {
    const gitDir = resolveGitDir(process.cwd());
    if (!gitDir) {
      console.log('\nGit repository not detected at current directory — skipping git hooks installation.');
      return;
    }

    const hooksDir = resolveHooksDir(process.cwd(), gitDir);
    fs.mkdirSync(hooksDir, { recursive: true });

    // Single source of truth: install the repo's hook scripts verbatim so the
    // installed copies can never drift from .githooks/{pre-commit,pre-push}.
    const hooks = {
      'pre-commit': fs.readFileSync(path.join(repo, '.githooks', 'pre-commit'), 'utf8'),
      'pre-push': fs.readFileSync(path.join(repo, '.githooks', 'pre-push'), 'utf8'),
    };

    for (const [hookName, hookContent] of Object.entries(hooks)) {
      const hookPath = path.join(hooksDir, hookName);
      // Back up a pre-existing hook that isn't ours instead of clobbering it. If the
      // backup slot is already taken, REFUSE rather than destroy the only copy —
      // the same rule as the foreign-skill-dir guard.
      try {
        if (fs.existsSync(hookPath) && !isOwnHook(fs.readFileSync(hookPath, 'utf8'))) {
          const backup = hookPath + '.pre-coalmine';
          if (fs.existsSync(backup)) {
            console.warn(`  [warn] refused to overwrite ${hookName}: a backup already exists at ${backup} — remove or rename it to proceed`);
            process.exitCode = 1;
            continue;
          }
          fs.copyFileSync(hookPath, backup);
          console.log(`  backed up existing ${hookName} → ${backup}`);
        }
      } catch (err) {
        console.warn(`  [warn] failed to check or create hook backup: ${err.message}`);
      }
      fs.writeFileSync(hookPath, hookContent);
      // mode option only applies on file creation — set it explicitly so an
      // overwritten hook is executable on Unix too.
      try { fs.chmodSync(hookPath, 0o755); } catch {}
      console.log(`  installed git hook: ${hookName} → ${hookPath}`);
    }
  } catch (e) {
    console.warn(`  [warn] failed to install git hooks: ${e.message}`);
    process.exitCode = 1;
  }
}

// ─── Git Hooks Uninstallation ────────────────────────────────────────────────
function uninstallGitHooks() {
  try {
    const gitDir = resolveGitDir(process.cwd());
    if (!gitDir) return;

    const hooksDir = resolveHooksDir(process.cwd(), gitDir);
    if (!fs.existsSync(hooksDir)) return;

    const hookNames = ['pre-commit', 'pre-push'];
    for (const hookName of hookNames) {
      const hookPath = path.join(hooksDir, hookName);
      const backupPath = hookPath + '.pre-coalmine';

      // A backup written before the ownership check was fixed can itself be an OLD
      // CoalMine hook filed as foreign — restoring it hands the user back an
      // obsolete CoalMine gate as if it were theirs. Discard, never restore.
      if (fs.existsSync(backupPath) && isOwnHook(fs.readFileSync(backupPath, 'utf8'))) {
        fs.unlinkSync(backupPath);
        console.log(`  discarded stale CoalMine backup: ${hookName}.pre-coalmine`);
      }

      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, hookPath);
        fs.unlinkSync(backupPath);
        console.log(`  restored backed-up git hook: ${hookName}`);
      } else if (fs.existsSync(hookPath) && isOwnHook(fs.readFileSync(hookPath, 'utf8'))) {
        // CWK-096 -- a Coal* uninstall NEVER destroys a tracked file. `resolveHooksDir`
        // CAN point at a directory the repo itself versions (this room's own
        // `.githooks/`); deleting there deletes the maintainer's tracked hook, not a
        // CoalMine leftover. REFUSE rather than trash-or-back-up it: the file already
        // has a recovery net the user knows (`git checkout --`), a second bin would be
        // a worse copy of one that exists, and the file is not ours to remove even with
        // a bin.
        //
        // SCOPE (r33 MEDIUM-1, CONFIRMED end-to-end by INSPECT): the first pass computed
        // `insideWorktree` as "not under gitDir", which is NOT the same predicate as
        // "inside the worktree" -- an ABSOLUTE core.hooksPath OUTSIDE the repo entirely
        // is also "not under gitDir", so it took the git-ask branch too. Git then answers
        // "outside repository" (exit 128, neither 0 nor 1), so `unknown` refused --
        // PERMANENTLY, since nothing about the repo ever changes to make git able to
        // answer, and the printed `git rm` remedy cannot succeed on a path git has just
        // said is outside the repository. Fixed to the predicate the name actually
        // claims: the git question is asked ONLY when the resolved hooks dir sits INSIDE
        // the worktree AND outside `.git/` -- exactly the `core.hooksPath` shape this
        // ticket is about. A hooks dir outside the worktree entirely is untracked BY
        // CONSTRUCTION for the identical reason `<gitDir>/hooks` is: git can only ever
        // track a path under the worktree it is answering for, so nothing outside it can
        // be `tracked`, and defaulting it to `untracked` is not a guess.
        const worktreeRoot = process.cwd();
        const insideWorktree = isUnderDir(hooksDir, worktreeRoot) && !isUnderDir(hooksDir, gitDir);
        const status = insideWorktree ? trackedStatus(hookPath, worktreeRoot) : 'untracked';
        if (status !== 'untracked') {
          // `tracked` and `unknown` (could-not-tell) both refuse -- only a confirmed
          // `untracked` answer deletes. Two different sentences for two different
          // states: `unknown` must never assert the very fact it could not establish.
          const why = status === 'tracked'
            ? 'core.hooksPath points at a versioned directory'
            : 'its tracked-ness could not be confirmed (the git process was interrupted or failed) -- "could not tell" is not "untracked"';
          console.warn(`  [refused] ${hookName}: ${why} — CoalMine does not delete a file it cannot confirm is untracked. Remove it yourself with your normal git workflow (e.g. \`git rm ${hookName}\` inside the hooks directory) if you want it gone.`);
          process.exitCode = 1;
          continue;
        }
        fs.unlinkSync(hookPath);
        console.log(`  removed git hook: ${hookName}`);
      }
    }
  } catch (e) {
    console.warn(`  [warn] failed to uninstall git hooks: ${e.message}`);
  }
}

// ─── Config Uninstallation ───────────────────────────────────────────────────
function uninstallConfig(arg) {
  try {
    const cfg = PLATFORM_CONFIGS[arg];
    if (!cfg) return;

    const destFile = cfg.dest;

    // Read-then-handle-ENOENT (no existsSync precheck): absent/unreadable = nothing to uninstall.
    let content;
    try {
      content = fs.readFileSync(destFile, 'utf8');
    } catch { return; }

    const isHash = cfg.tpl.includes('clinerules');
    const start  = isHash ? CM_START_HASH : CM_START;
    const end    = isHash ? CM_END_HASH   : CM_END;
    const si = content.indexOf(start);
    const ei = content.indexOf(end);

    if (si !== -1 && ei !== -1 && ei > si) {
      const before = content.slice(0, si);
      const after = content.slice(ei + end.length);
      content = (before.trimEnd() + '\n\n' + after.trimStart()).trim();

      if (!content) {
        fs.unlinkSync(destFile);
        console.log(`  removed empty trigger config: ${path.relative(process.cwd(), destFile)}`);
      } else {
        fs.writeFileSync(destFile, content + '\n', 'utf8');
        console.log(`  removed trigger config block from ${path.relative(process.cwd(), destFile)}`);
      }
    }
  } catch (e) {
    console.warn(`  [warn] failed to uninstall config: ${e.message}`);
  }
}

// ─── Skills Uninstallation ───────────────────────────────────────────────────
function uninstallSkills(destDir, skillsList) {
  try {
    if (!fs.existsSync(destDir)) return 0;
    let removed = 0;
    for (const s of skillsList) {
      const targetDir = path.join(destDir, s);
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
        console.log(`  removed skill: ${s} from ${targetDir}`);
        removed++;
      }
    }
    return removed;
  } catch (e) {
    console.warn(`  [warn] failed to uninstall skills: ${e.message}`);
    return 0;
  }
}

// ─── Install Manifest (clean version transitions) ────────────────────────────
// Records exactly what CoalMine installed at a target so the next install can
// remove it first — like a package manager's file list. Renamed or removed
// skills can never leave orphan copies behind. Only manifest-listed dirs are
// ever touched; other skills sharing the target dir are never affected.
// MANIFEST_NAME + the per-file integrity hashes live in lib/manifest.mjs so the
// installer (writes) and verify.mjs (checks) share one source.

function readManifest(destDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(destDir, MANIFEST_NAME), 'utf8'));
    return m && Array.isArray(m.skills) ? m : null;
  } catch { return null; }
}

// Defense against corrupt or hand-edited manifests: every name we are about to
// rm must be a plain directory basename — no separators, no '.'/'..', no
// dotfiles, no absolute/drive paths. Anything else is dropped, never deleted.
function safeSkillNames(names) {
  return names.filter((s) =>
    // Allowlist: a non-empty alphanumeric/hyphen/underscore basename. Subsumes the old
    // length/basename/dotfile checks AND rejects whitespace-only names (' ', '\t') that
    // path.basename() let through before — those reached fs.rmSync.
    typeof s === 'string' && /^[A-Za-z0-9_-]+$/.test(s) && s === path.basename(s)
  );
}

// The installer writes into the USER's directory — a trust boundary. A target
// skill dir is safe for CoalMine to delete/overwrite ONLY when we can PROVE we own
// it; a blind name match is banned (resilience-audit/checks.md:15, "never
// delete-then-write"). Ownership proofs, cheapest first:
//   • the dir is absent or empty        → no user data to lose;
//   • the destDir manifest lists it      → it is in our package file-list;
//   • it carries our own skill-meta.json → a pre-manifest CoalMine install.
// Anything else is a FOREIGN dir that merely shares a skill's name — refuse it, so
// a name collision can never cost the user their files (the H12 root cause).
function isForeignSkillDir(destDir, skillName, manifestSkills) {
  let entries;
  try { entries = fs.readdirSync(path.join(destDir, skillName)); }
  catch { return false; }                                        // absent/unreadable → nothing to protect
  if (entries.length === 0) return false;                        // empty dir → no user data
  if (manifestSkills && manifestSkills.includes(skillName)) return false; // our package file-list
  if (entries.includes('skill-meta.json')) return false;         // our own pre-manifest marker
  return true;                                                   // has content, none of it ours → foreign
}

// Skill dirs an earlier CoalMine installed under a now-retired name. A very old
// install (pre-rename / pre-manifest) leaves these behind: they are in neither the
// manifest nor the current skill set, so the manifest sweep never reaches them and
// an upgrade keeps showing the stale command. Swept on every install.
// (rotcanary -> rot-canary, renamed in v3.0.0.)
const RETIRED_SKILL_NAMES = ['rotcanary'];

function cleanPreviousInstall(destDir, manifest) {
  // Orphan sweep ONLY — remove skill dirs a PREVIOUS CoalMine install left that the
  // current set no longer has (renamed/removed). Ownership is PROVEN, never guessed:
  //   • manifest.skills is our package file-list — every dir it names, we wrote;
  //   • RETIRED_SKILL_NAMES is our tombstone of names only CoalMine ever coined
  //     (rotcanary), for installs predating the manifest (15-Jun lesson) — the single
  //     named exception to "no name-match delete", bounded to CoalMine-only coinages.
  // Current-set dirs are cleared+rewritten by installSkillDir, and a foreign collision
  // on a current name is refused upstream in installSkills — so there is NEVER a blind
  // name-match delete of a live skill name here (the H12 data-loss root cause). The old
  // `: currentSkills` fallback did exactly that and is gone.
  const owned = safeSkillNames(manifest ? manifest.skills : []);
  let cleaned = 0;
  for (const s of [...owned, ...RETIRED_SKILL_NAMES]) {
    const dir = path.join(destDir, s);
    try {
      if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); cleaned++; }
    } catch (e) {
      console.warn(`  [warn] could not remove previous ${s}: ${e.message}`);
      process.exitCode = 1;
    }
  }
  if (manifest) console.log(`  cleaned previous install v${manifest.version ?? '?'} (${cleaned} skill dir(s))`);
}

function writeManifest(destDir, installedSkills) {
  try {
    let version = '0.0.0';
    try { version = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? version; } catch {}
    // Per-file SHA-256 of everything we just wrote — the SFC-lite baseline that
    // `verify.mjs <target>` checks for post-install tampering.
    const hashes = hashInstalledTree(destDir, installedSkills);
    const manifest = { version, installedAt: new Date().toISOString(), skills: installedSkills, hashes };
    fs.writeFileSync(path.join(destDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  } catch (e) {
    console.warn(`  [warn] could not write install manifest: ${e.message}`);
    process.exitCode = 1;
  }
}

// ─── Reusable install steps (shared by single-agent and `all`) ──────────────
function installSkills(dest, skills, shared) {
  console.log(`\nInstalling ${skills.length} skill(s) → ${dest}`);
  const manifest = readManifest(dest);
  const manifestSkills = manifest ? manifest.skills : null;
  // Trust boundary: the target is the user's dir. Refuse any skill whose target dir
  // already holds FOREIGN files (a name collision we don't own) — installSkillDir would
  // otherwise clear-and-write it, destroying the user's data (checks.md:15).
  const toInstall = [];
  for (const s of skills) {
    if (isForeignSkillDir(dest, s, manifestSkills)) {
      console.warn(`  [refused] ${path.join(dest, s)} holds non-CoalMine files — skipped to protect it (remove it or install elsewhere)`);
      process.exitCode = 1;
    } else {
      toInstall.push(s);
    }
  }
  // Program-style version transition: remove what the PREVIOUS install owned
  // (manifest orphans + retired tombstone), then write the new set fresh.
  cleanPreviousInstall(dest, manifest);
  let n = 0;
  const installed = [];
  for (const s of toInstall) {
    try {
      const to = path.join(dest, s);
      installSkillDir(path.join(skillsSrc, s), to, shared);
      console.log(`  installed ${s} → ${to}`);
      installed.push(s);
      n++;
    } catch (e) {
      console.warn(`  [warn] failed to install ${s}: ${e.message}`);
      process.exitCode = 1;
    }
  }
  writeManifest(dest, installed);
  return { installed: n, failed: skills.length - n };
}

function applyConfig(targetKey, label) {
  console.log(`\nConfiguring auto-trigger for: ${label}`);
  const cfg = PLATFORM_CONFIGS[targetKey];
  if (cfg) upsertConfig(cfg.dest, cfg.tpl);
  else console.log(`  (no platform config template for "${label}" — skills only)`);
}

function copyDefaultConfig() {
  // Copy default config to the project if not already present anywhere in the
  // read order (namespace campaign #69+#39, owner-designated 2026-08-08) —
  // see projectConfigPath's own header in hooks/_shared/node-config.js for the
  // full rail. Anchored at process.cwd() directly, matching this function's
  // pre-migration behavior (never findGitRoot) — only the candidate SET
  // (existence check + fresh-install write target) changed: a project already
  // configured anywhere (own-dir, another known agent dir, or the LEGACY root
  // dotfile) is left alone; a never-configured project now gets the NEW shape
  // instead of the retired root dotfile, so a fresh install stops
  // perpetuating the shape this campaign is migrating off. The write target
  // is ownDirDefault (INSPECT MEDIUM 2, 2026-08-08), not a bare candidates[0]
  // — a project that already has `.agents/`/`.gemini/` on disk gets its
  // config there, never a foreign `.claude/`; only a project with NO agent
  // dir at all gets `.claude/coal/coalmine.json`.
  console.log('\nConfiguring settings...');
  // Self-pollution guard: running the installer from the CoalMine source repo itself
  // (cwd === repo) would drop an untracked-but-not-ignored config at the repo
  // root — the exact stray-config incident removed in v3.7.8. The source repo ships
  // platform-configs/.coalmine.json as the template, never an active project config.
  if (path.resolve(process.cwd()) === repo) {
    console.log('  (running from the CoalMine source repo — skipping the project config to avoid self-pollution)');
    return;
  }
  try {
    const candidates = projectConfigCandidates(process.cwd());
    const existing = candidates.find((c) => fs.existsSync(c));
    if (existing) {
      console.log(`  settings file already exists at ${existing}`);
      return;
    }
    const configDest = ownDirDefault(process.cwd()); // whichever agent dir the project already has — new installs get the new shape
    fs.mkdirSync(path.dirname(configDest), { recursive: true });
    fs.copyFileSync(path.join(repo, 'platform-configs', '.coalmine.json'), configDest);
    console.log(`  created default settings → ${configDest}`);
  } catch (err) {
    console.warn(`  [warn] failed to copy settings: ${err.message}`);
    process.exitCode = 1;
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────
// CWK-071: wrapped in main() so every former process.exit() site can `return`
// instead -- `process.exitCode = N` alone does not halt execution, and `return`
// needs a function body. Body kept at its original (flat) indentation
// deliberately: this wrapper is the whole structural change, and reindenting
// the rest would make a mechanical, behaviour-preserving refactor hard to audit
// against the original file.
function main() {
const args = process.argv.slice(2);
const isUninstall = args.includes('--uninstall') || args.includes('-u');
const targetArg = args.filter(x => x !== '--uninstall' && x !== '-u')[0];

if (!targetArg) {
  console.error(`Usage: node scripts/install.mjs [--uninstall | -u] <${Object.keys(TARGETS).join('|')}|all|PATH>`);
  console.error(`  all  → auto-detect every agent already configured in this project and install to each`);
  process.exitCode = 2;
  return;
}
const targetKey = targetArg.toLowerCase();

if (!fs.existsSync(skillsSrc)) {
  console.error(`No skills/ dir at ${skillsSrc}`);
  process.exitCode = 1;
  return;
}

// Get skill dirs (exclude _shared)
let skills = [];
try {
  skills = listSkills(skillsSrc);
} catch (e) {
  console.error(`Error listing skills at ${skillsSrc}: ${e.message}`);
  process.exitCode = 1;
  return;
}

// ─── `all`: auto-detect every present project agent and install to each ──────
// "Works in every mine" — one command covers each agent already configured in
// this repo (detected by its .agent-dir marker), with no clutter for absent
// agents and a loud report of what was skipped. The long tail / unknown agents
// route to platform-report (Issues), not a silently-stale path map.
if (targetKey === 'all') {
  if (isUninstall) {
    console.error("Uninstall does not support 'all' — name the agent explicitly (destructive op, no guessing).");
    process.exitCode = 2;
    return;
  }
  const { present, absent } = detectPresentAgents(process.cwd());
  if (present.length === 0) {
    console.log(`\nCoalMine 'all': no auto-detectable agent config found under ${process.cwd()}.`);
    console.log(`  Install explicitly instead: node scripts/install.mjs <${Object.keys(TARGETS).join('|')}|PATH>`);
    process.exitCode = 0;
    return;
  }
  const shared = loadShared();
  if (shared === null) return;
  console.log(`\nCoalMine 'all' — detected: ${present.join(', ')}${absent.length ? `  ·  skipped (not present): ${absent.join(', ')}` : ''}`);
  const seenDest = new Set();
  const seenCfg = new Set();
  let installs = 0, fails = 0, dirs = 0;
  for (const key of present) {
    const d = TARGETS[key];
    if (!seenDest.has(d)) {            // several agents can share one dir (.agents/skills)
      seenDest.add(d); dirs++;
      const r = installSkills(d, skills, shared);
      installs += r.installed; fails += r.failed;
    }
    const pc = PLATFORM_CONFIGS[key];
    if (pc && !seenCfg.has(pc.dest)) {
      seenCfg.add(pc.dest);
      console.log(`\nConfiguring auto-trigger: ${path.relative(process.cwd(), pc.dest)}`);
      upsertConfig(pc.dest, pc.tpl);
    }
  }
  console.log('\nConfiguring git hooks...');
  installGitHooks();
  copyDefaultConfig();
  console.log(`\nDone: ${present.length} agent(s) → ${dirs} skills dir(s), ${installs} skill install(s)${fails ? `, ${fails} failed` : ''}.`);
  console.log(`  Not auto-covered (run explicitly): claude (prefer the plugin), cline. Agent still missing? Open a platform-report so we can pin it.`);
  console.log(`Verify: node scripts/verify.mjs`);
  // CWK-071: this was `process.exit(process.exitCode || 0)` -- a no-op around the
  // code (exitCode is already whatever the loop above left it at), kept only for
  // its SIDE EFFECT of stopping here so the single-target path below never runs
  // for the 'all' branch. `return` is that stop; no exitCode line is needed.
  return;
}

const dest = TARGETS[targetKey] ?? path.resolve(targetArg);

if (path.resolve(dest) === path.resolve(skillsSrc)) {
  console.error('Target directory cannot be the source skills directory.');
  process.exitCode = 1;
  return;
}

if (isUninstall) {
  console.log(`\nUninstalling CoalMine from target: ${targetArg}`);
  // Manifest is our package file-list (owned — safe to remove). Without one, fall back
  // to current names but ONLY the dirs we can prove we own — a foreign dir that merely
  // shares a skill's name is left in place (same H12 guard as install). Retired
  // tombstone names are swept regardless (the one named exception).
  const previous = readManifest(dest);
  const ownedNames = previous
    ? previous.skills
    : skills.filter((s) => !isForeignSkillDir(dest, s, null));
  const removedCount = uninstallSkills(dest, [...safeSkillNames(ownedNames), ...RETIRED_SKILL_NAMES]);
  try { fs.rmSync(path.join(dest, MANIFEST_NAME), { force: true }); } catch {}
  uninstallConfig(targetKey);
  uninstallGitHooks();
  console.log(`\nDone: Uninstalled ${removedCount} skill(s) and cleared configs.`);
  // CWK-096: this was an UNCONDITIONAL `process.exitCode = 0` -- it clobbered any
  // exitCode = 1 a step above (uninstallGitHooks's tracked-file REFUSAL included) with
  // a hardcoded success. `process.exitCode` defaults to 0 when nothing sets it, so
  // deleting the line changes nothing on the clean path and stops silencing the dirty
  // one. Same class as the install.mjs:540 no-op wrapper CWK-071 already closed.
  return;
}

const shared = loadShared();
if (shared === null) return;
const { installed: n, failed } = installSkills(dest, skills, shared);
applyConfig(targetKey, targetArg);
console.log('\nConfiguring git hooks...');
installGitHooks();
copyDefaultConfig();
console.log(`\nDone: ${n}/${skills.length} skill(s) → ${dest}${failed ? ` (${failed} failed)` : ''}`);
console.log(`Verify: node scripts/verify.mjs`);
}

main();

