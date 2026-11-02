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
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadShared as loadSharedFrom, listSkills, installSkillDir, sweepInstallLeftovers, expectedSkillFiles } from './lib/render.mjs';
import { loadInstallRecord, saveInstallRecord, folderHashes, sameHashes } from './lib/install-record.mjs';
import { TARGETS, detectPresentAgents } from './lib/targets.mjs';
import { gitEnv } from './lib/git-env.mjs';
import { MANIFEST_NAME, hashInstalledTree } from './lib/manifest.mjs';
import { projectConfigCandidates, ownDirDefault, isGlobalCfgFile } from './lib/config-paths.mjs';
import { FOLDER_FIX, MAX_CONFIG_BYTES, MAX_DOC_BYTES, repoEntryKind, readRepoFileBounded, readRepoBytesBounded, checkRepoDirTarget, checkRepoWriteTarget, writeRepoFile } from './lib/repo-fs.mjs';

// CWK-137 -- every path below cwd is REPO-DERIVED, i.e. untrusted: a cloned repository can
// plant `.github/copilot-instructions.md -> ~/.bashrc`, a junction on `.agents`, or a FIFO
// at `.git`. Reads go through readRepoFileBounded, writes through writeRepoFile, and a
// refusal is LOUD (a message naming the path and what to do, and exitCode 1) -- never a
// silent skip, never a write through the link.
// A refused FOLDER (a link, junction or file on the chain) already carries its own instruction (FOLDER_FIX); a refused FILE gets the file instruction (17a INSPECT LOW-1).
const refuseMsg = (what, why) => why.includes(FOLDER_FIX) ? `  [refused] ${what}: ${why}.` : `  [refused] ${what}: ${why} -- CoalMine will not write through a link or outside this project. Replace it with a regular file inside the project (or remove it) and re-run.`;
function lexists(p) {
  try { fs.lstatSync(p); return true; } catch { return false; }
}
// The containment root for a skills target: a PROJECT target (under cwd) must stay inside
// cwd; the global `claude` target and an explicit PATH are the user's own choice of
// directory, so the root is the target itself (a symlinked file inside it is still refused).
function skillsRootFor(targetKey, dest) {
  return Object.hasOwn(TARGETS, targetKey) && targetKey !== 'claude' ? process.cwd() : dest;
}

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

    // CWK-137: the destination is repo-derived. Check it BEFORE reading or writing, so a
    // `-> ~/.bashrc` link is refused instead of appended to (PoC-2, measured on 59ee1e7).
    const root = process.cwd();
    const why = checkRepoWriteTarget(destFile, root);
    if (why) { console.warn(refuseMsg(path.relative(root, destFile), why)); process.exitCode = 1; return; }

    let existing;
    if (!lexists(destFile)) {
      writeRepoFile(destFile, tplContent + '\n', root);
      console.log(`  created ${path.relative(root, destFile)}`);
      return;
    }
    existing = readRepoFileBounded(destFile, root, MAX_DOC_BYTES);
    if (existing === null) {
      console.warn(refuseMsg(path.relative(root, destFile), `unreadable or larger than ${MAX_DOC_BYTES} bytes`));
      process.exitCode = 1;
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
      writeRepoFile(destFile, existing, root);
      console.log(`  updated ${path.relative(process.cwd(), destFile)}`);
    } else {
      // Append new CoalMine section
      const sep = existing.trim().length === 0 ? '' : (existing.endsWith('\n') ? '\n' : '\n\n');
      writeRepoFile(destFile, existing + sep + tplContent + '\n', root);
      console.log(`  appended ${path.relative(process.cwd(), destFile)}`);
    }
  } catch (e) {
    console.warn(`  [warn] could not write config ${destFile}: ${e.message}`);
    process.exitCode = 1;
  }
}

function resolveGitDir(repoDir) {
  // CWK-137: `.git` is repo-derived -- lstat + containment before any open (a FIFO at
  // `.git` blocked the old readFileSync forever). A worktree/submodule `.git` FILE is a
  // few dozen bytes; its gitdir target may legitimately lie outside the worktree.
  const gitPath = path.join(repoDir, '.git');
  const kind = repoEntryKind(gitPath, repoDir);
  if (kind === 'dir') return gitPath;
  if (kind === 'file') {
    const raw = readRepoFileBounded(gitPath, repoDir, MAX_CONFIG_BYTES);
    const match = raw === null ? null : raw.trim().match(/^gitdir:\s*(.+)$/);
    if (match) return path.resolve(repoDir, match[1].trim());
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
    // R13 / CWK-158 item 4 (B-u2-5a): read it as a PATH (`--type=path`), the way git itself does, so a
    // leading `~` or `~user` expands. The untyped read returned the literal `~/hooks`, which
    // path.resolve then joined under the project (<project>/~/hooks) while git ran $HOME/hooks.
    const r = spawnSync('git', ['config', '--type=path', '--get', 'core.hooksPath'], { cwd: repoDir, env: gitEnv(path.dirname(repoDir), { keepUserConfig: true }), encoding: 'utf8' }); // R14-N1: the user's git config selection
    const configured = r.status === 0 && r.stdout ? r.stdout.trim() : '';
    if (configured) return path.resolve(repoDir, configured);
    if (r.status !== 0 && r.status !== 1) {
      // A git too old for --type (or any other failure of the typed read): ask the untyped way, and
      // refuse to guess at a value git would expand -- a "~" left unexpanded is exactly the bug.
      const u = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: repoDir, env: gitEnv(path.dirname(repoDir), { keepUserConfig: true }), encoding: 'utf8' });
      const raw = u.status === 0 && u.stdout ? u.stdout.trim() : '';
      if (raw && !raw.startsWith('~')) return path.resolve(repoDir, raw);
      if (raw) throw new Error('core.hooksPath starts with "~" and this git cannot expand it');
    }
  } catch (e) {
    if (/cannot expand it/.test(e.message)) throw e; // surfaces as the caller's "failed to install git hooks" warning
  }
  return path.join(gitDir, 'hooks');
}

// R14 / B-u2-5b: an absolute core.hooksPath outside this project (and not this repo's own git dir) is a folder every repo
// that uses it shares; one repo's install or uninstall changes it for all of them. Say so, in one line. No refusal: since
// the chain-only hook (R13 item 2) the owner's own hook still runs.
function sharedHooksNote(hooksDir, gitDir) {
  if (isUnderDir(hooksDir, process.cwd()) || isUnderDir(hooksDir, gitDir)) return '';
  return `  NOTE: core.hooksPath points outside this project (${hooksDir}). That folder is shared by every repo that uses it, so installing or uninstalling CoalMine's hooks here changes them for all of those repos.`;
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
  const r = spawnSync('git', ['ls-files', '--error-unmatch', hookPath], { cwd: repoDir, env: gitEnv(path.dirname(repoDir)), encoding: 'utf8' });
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

// The hook CoalMine installs into a user's repo (R13 / CWK-158 item 2). It runs the hook it replaced
// (kept beside it as <hook>.pre-coalmine, exit status and stdin/args passed through) and nothing
// else, so installing CoalMine never turns a user's gate off and never runs code from the project.
// 29q (a): the backup runs only when it is the file this install recorded (its git blob id, embedded as `want`). A backup a repo or a
// later edit put there is refused loudly, never run and never activated. `backupHash` is '' when no backup of ours exists.
function genericHook(name, backupHash = '') {
  return [
    '#!/bin/sh',
    `# CoalMine ${name} hook`,
    '# Generated by CoalMine',
    '# Runs the hook this one replaced (kept beside it as <hook>.pre-coalmine) when CoalMine recorded that backup, and nothing else.',
    "# CoalMine's own repo gate belongs to CoalMine's repo and is never copied into yours.",
    'prev="$0.pre-coalmine"',
    `want='${backupHash}'`,
    'if [ -e "$prev" ] || [ -L "$prev" ]; then',
    '  if [ -n "$want" ] && [ -f "$prev" ] && [ ! -L "$prev" ] && [ -x "$prev" ] && [ "$(git hash-object --no-filters -- "$prev" 2>/dev/null)" = "$want" ]; then exec "$prev" "$@"; fi',
    `  echo "CoalMine ${name}: $prev is not the backup CoalMine recorded, so it is not run. Review it and restore it by hand." >&2`,
    '  exit 1',
    'fi',
    'exit 0',
    '',
  ].join('\n');
}

// The git blob id of a text: the value the wrapper's `git hash-object` gives for the same bytes (29q (a)). null when git cannot answer.
function gitBlobHash(text) {
  const r = spawnSync('git', ['hash-object', '--stdin'], { input: text, encoding: 'utf8', env: gitEnv(process.cwd()) });
  if (r.error || r.status !== 0) return null;
  const h = String(r.stdout).trim();
  return /^[0-9a-f]{40,64}$/.test(h) ? h : null;
}

// The backup id an installed CoalMine wrapper recorded, or '' (no backup of ours).
// 29am (T-29al-5): null when the wrapper has no want= line (an old wrapper, which may adopt a backup beside it); '' when it recorded no backup.
function parseBackupHash(content) {
  const m = /^want='([0-9a-f]*)'$/m.exec(content);
  return m ? m[1] : null;
}

// Tracked-ness of a hook file, asked of git only where git can answer: a hooks dir INSIDE the
// worktree and outside .git/ (the core.hooksPath-at-a-versioned-dir shape). Anywhere else the file
// is untracked by construction (CWK-096 r33 MEDIUM-1 -- git answers exit 128 for a path outside the
// repository, which is neither tracked nor untracked and must not be read as "could not tell").
function hookTrackedStatus(hookPath, hooksDir, gitDir) {
  const worktreeRoot = process.cwd();
  const insideWorktree = isUnderDir(hooksDir, worktreeRoot) && !isUnderDir(hooksDir, gitDir);
  return insideWorktree ? trackedStatus(hookPath, worktreeRoot) : 'untracked';
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
    // CWK-137: a hooks dir inside the worktree (`.git/hooks`, a tracked `.githooks/`)
    // must resolve inside it -- a `.git/hooks -> elsewhere` junction is refused. A hooks
    // dir OUTSIDE the worktree (a linked worktree's gitdir, an absolute core.hooksPath)
    // was chosen by git config, not by a file the repo planted; it is its own root.
    const hooksRoot = isUnderDir(hooksDir, process.cwd()) ? process.cwd() : hooksDir;
    const sharedNote = sharedHooksNote(hooksDir, gitDir);
    // R14 / R13 INSPECT LOW-3: a hooks folder OUTSIDE the project that does not exist yet used to be refused with advice
    // for a different problem ("replace it with a regular file"). Say what is true and what to do.
    if (hooksRoot === hooksDir && !fs.existsSync(hooksDir)) {
      console.warn(`  [refused] git hooks: core.hooksPath names ${hooksDir}, which does not exist yet and is outside this project, so CoalMine will not create it. Create that folder and re-run, or unset core.hooksPath.`);
      process.exitCode = 1;
      return;
    }
    const dirWhy = checkRepoDirTarget(hooksDir, hooksRoot);
    if (dirWhy) { console.warn(refuseMsg('git hooks', dirWhy)); process.exitCode = 1; return; }
    if (sharedNote) console.log(sharedNote);
    fs.mkdirSync(hooksDir, { recursive: true });

    // R13 / CWK-158 item 2 (B-u2-1, CSV-8): what lands in a USER's repo is a generic chain-only
    // hook (genericHook), never CoalMine's own repo gate. The old "single source of truth" copied
    // .githooks/{pre-commit,pre-push} verbatim, which runs the project's own scripts/verify.mjs and
    // scripts/test.mjs -- a no-op in most projects and a surprise blocker in the one that has them --
    // and the user's own hook was renamed aside and never run again.
    for (const hookName of ['pre-commit', 'pre-push']) {
      const hookPath = path.join(hooksDir, hookName);
      let backupHash = ''; // the blob id of the backup this install made or recorded; '' = no backup of ours (29q (a))
      // Back up a pre-existing hook that isn't ours instead of clobbering it. If the
      // backup slot is already taken, REFUSE rather than destroy the only copy —
      // the same rule as the foreign-skill-dir guard.
      // CWK-120 row 4: a failure INSIDE this block (the ownership read, or the backup
      // copy itself) used to be swallowed and execution fell through to the write below
      // anyway -- so a foreign hook we could not verify, or could not back up, still got
      // overwritten. The block must be able to BLOCK the write, not merely log past it.
      let backupFailed = false;
      try {
        // CWK-137: an existing hook that is a symlink (or anything but a regular file
        // inside hooksRoot) is REFUSED -- writing it used to go THROUGH the link, and a
        // copy of it would carry the link's target bytes into the backup slot.
        const hookWhy = checkRepoWriteTarget(hookPath, hooksRoot);
        if (hookWhy) { console.warn(refuseMsg(`git hook ${hookName}`, hookWhy)); process.exitCode = 1; continue; }
        const current = lexists(hookPath) ? readRepoFileBounded(hookPath, hooksRoot, MAX_DOC_BYTES) : '';
        if (current === null) throw new Error(`${hookPath} is unreadable or larger than ${MAX_DOC_BYTES} bytes`);
        // R13 / CWK-158 item 2: a hook the repo TRACKS (core.hooksPath at a versioned directory) is the maintainer's file, not ours to
        // rewrite: that would leave a modified tracked file that, once committed, replaces the team's hook with a stub. Same refusal as
        // uninstall (CWK-096); "could not tell" is not "untracked". 29am (T-29al-8): this covers a hook that carries our own header too.
        if (lexists(hookPath)) {
          const tracked = hookTrackedStatus(hookPath, hooksDir, gitDir);
          if (tracked !== 'untracked') {
            console.warn(`  [refused] ${hookName}: ${tracked === 'tracked' ? 'core.hooksPath points at a versioned directory and this hook is tracked' : 'its tracked-ness could not be confirmed'} -- CoalMine does not rewrite a file it cannot confirm is untracked. Add CoalMine to that hook yourself, or point core.hooksPath at an untracked directory.`);
            process.exitCode = 1;
            continue;
          }
        }
        if (lexists(hookPath) && !isOwnHook(current)) {
          const backup = hookPath + '.pre-coalmine';
          // lexists, not existsSync: a DANGLING link in the backup slot reads as absent to
          // existsSync and a copy would then write through it.
          if (lexists(backup)) {
            console.warn(`  [warn] refused to overwrite ${hookName}: a backup already exists at ${backup} — remove or rename it to proceed`);
            process.exitCode = 1;
            continue;
          }
          writeRepoFile(backup, current, hooksRoot);
          try { fs.chmodSync(backup, fs.lstatSync(hookPath).mode & 0o777); } catch {}
          backupHash = gitBlobHash(current);
          if (!backupHash) throw new Error(`could not record the hash of the backup at ${backup}, so the backup would not be trusted`);
          console.log(`  backed up existing ${hookName} → ${backup}`);
        } else if (lexists(hookPath)) {
          backupHash = parseBackupHash(current); // our own wrapper: it recorded the backup it was made with
          const legacyBackup = hookPath + '.pre-coalmine';
          // 29q c36 item 1: an OLD CoalMine wrapper (no want= line) beside a backup. That backup was made by an earlier CoalMine
          // install, so it is adopted and its blob id recorded; a backup beside any other active hook is never adopted.
          if (backupHash === null && isOwnHook(current) && lexists(legacyBackup)) {
            const legacyBytes = readRepoBytesBounded(legacyBackup, hooksRoot, MAX_DOC_BYTES);
            if (legacyBytes === null) throw new Error(`${legacyBackup} is unreadable or larger than ${MAX_DOC_BYTES} bytes`);
            backupHash = gitBlobHash(legacyBytes);
            if (!backupHash) throw new Error(`could not record the hash of ${legacyBackup}, so the backup would not be trusted`);
            console.log(`  adopted ${legacyBackup}`);
          }
          if (backupHash === null) backupHash = ''; // no want= line and nothing adopted: no backup of ours
        }
        const backupPath = hookPath + '.pre-coalmine';
        if (!backupHash && lexists(backupPath)) {
          console.warn(`  [kept] ${hookName}: ${backupPath} is not a backup this install recorded, so it is left in place and will not run. Review it, then restore it by hand if you want it run.`);
          process.exitCode = 1;
        }
      } catch (err) {
        console.warn(`  [warn] refused to overwrite ${hookName}: could not verify or back it up (${err.message})`);
        process.exitCode = 1;
        backupFailed = true;
      }
      if (backupFailed) continue;
      writeRepoFile(hookPath, genericHook(hookName, backupHash), hooksRoot);
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
    const hooksRoot = isUnderDir(hooksDir, process.cwd()) ? process.cwd() : hooksDir; // CWK-137, same rule as install
    const dirWhy = checkRepoDirTarget(hooksDir, hooksRoot);
    if (dirWhy) { console.warn(refuseMsg('git hooks', dirWhy)); process.exitCode = 1; return; }
    const sharedNoteU = sharedHooksNote(hooksDir, gitDir);
    if (sharedNoteU) console.log(sharedNoteU);
    const readHook = (p) => (lexists(p) ? readRepoFileBounded(p, hooksRoot, MAX_DOC_BYTES) : null);

    const hookNames = ['pre-commit', 'pre-push'];
    for (const hookName of hookNames) {
      const hookPath = path.join(hooksDir, hookName);
      const backupPath = hookPath + '.pre-coalmine';

      // A backup written before the ownership check was fixed can itself be an OLD
      // CoalMine hook filed as foreign — restoring it hands the user back an
      // obsolete CoalMine gate as if it were theirs. Discard, never restore.
      const backupBody = readHook(backupPath);
      if (backupBody !== null && isOwnHook(backupBody)) {
        fs.unlinkSync(backupPath);
        console.log(`  discarded stale CoalMine backup: ${hookName}.pre-coalmine`);
      }

      if (lexists(backupPath) && lexists(hookPath)) {
        // R13 / CWK-158 item 3 (B-u2-4, data loss): the backup goes back only over a hook that is
        // OURS. A hook the user wrote AFTER install (or one we cannot read) is theirs: restoring over it
        // destroyed it. Both files stay; the user merges them.
        const cur = readHook(hookPath);
        if (cur === null || !isOwnHook(cur)) {
          console.warn(`  [kept] ${hookName}: the hook there now is not CoalMine's -- left untouched, and your backed-up hook stays at ${backupPath}. Merge them yourself, then delete the backup.`);
          process.exitCode = 1;
          continue;
        }
      }
      if (lexists(backupPath)) {
        // CWK-137: restore by content, through the contained writer -- never a copy that
        // follows a link at either end. An unreadable/linked backup is left in place.
        const why = backupBody === null ? `${backupPath} is not a readable regular file inside the hooks dir` : checkRepoWriteTarget(hookPath, hooksRoot);
        if (why) { console.warn(refuseMsg(`git hook ${hookName}`, why)); process.exitCode = 1; continue; }
        // 29q (a): restore only the backup the installed wrapper recorded (its blob id). A backup that does not match stays where it is.
        const recorded = parseBackupHash(readHook(hookPath) ?? '');
        if (!recorded || gitBlobHash(backupBody) !== recorded) {
          console.warn(`  [kept] ${hookName}: ${backupPath} is not the backup CoalMine recorded, so it is not restored. Review it, then restore it by hand if you want it.`);
          process.exitCode = 1;
          continue;
        }
        const mode = fs.lstatSync(backupPath).mode & 0o777;
        writeRepoFile(hookPath, backupBody, hooksRoot);
        try { fs.chmodSync(hookPath, mode); } catch {}
        fs.unlinkSync(backupPath);
        console.log(`  restored backed-up git hook: ${hookName}`);
      } else if ((() => { const b = readHook(hookPath); return b !== null && isOwnHook(b); })()) {
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
    const cfg = Object.hasOwn(PLATFORM_CONFIGS, arg) ? PLATFORM_CONFIGS[arg] : undefined; // R14 B-u2-7: own-key only
    if (!cfg) return;

    const destFile = cfg.dest;

    // Read-then-handle-ENOENT (no existsSync precheck): absent/unreadable = nothing to uninstall.
    // CWK-137: absent = nothing to uninstall; present but a link / oversized / not a
    // regular file = REFUSED loudly (the edit would otherwise go through the link).
    if (!lexists(destFile)) return;
    const root = process.cwd();
    const why = checkRepoWriteTarget(destFile, root);
    let content = why ? null : readRepoFileBounded(destFile, root, MAX_DOC_BYTES);
    if (content === null) {
      console.warn(refuseMsg(path.relative(root, destFile), why || `unreadable or larger than ${MAX_DOC_BYTES} bytes`));
      process.exitCode = 1;
      return;
    }

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
        writeRepoFile(destFile, content + '\n', root);
        console.log(`  removed trigger config block from ${path.relative(process.cwd(), destFile)}`);
      }
    }
  } catch (e) {
    console.warn(`  [warn] failed to uninstall config: ${e.message}`);
  }
}

// ─── Skill folder ownership (29ae) ───────────────────────────────────────────
// The installer writes or removes a skill folder only when it can prove CoalMine installed it. The proof is the install record
// (lib/install-record.mjs), keyed by the target's real path: a folder the record names is ours when its files are exactly the
// recorded files (record). A target with no record entry at all adopts a folder whose files are byte-equal to what this installer
// renders from its own source (adopt), but only to INSTALL over it: identical bytes change nothing when written again. A DELETE never
// adopts (29ag): two byte-equal copies cannot say whose they are, and a project may keep its own copy. An absent or empty folder has
// nothing to protect. Everything else is KEPT: never removed or overwritten, one [kept] line says why, exit 1. Only the record and
// the byte match authorize anything: a project manifest or a skill-meta.json marker does not. The manifest is the post-install
// integrity baseline verify.mjs reads.
// Scope: the installer only considers folders it ships or the record names, plus the retired names below (kept and named, exit 1,
// unless proven). An unshipped, unrecorded folder in a shared target is never touched and never named.

function keepMessage(p, reason) {
  return `  [kept] ${p}: not removed or overwritten, because ${reason}. CoalMine cannot prove it installed this folder. Remove the whole folder, or move the whole folder aside, then re-run; an absent folder is installed fresh.`;
}

// Skill folders CoalMine itself coined under a name it later retired (a pre-rename install left them). Nothing records them and no
// shipped source renders them, so they are never removed without proof: they are kept and named, exit 1, unless empty.
const RETIRED_SKILL_NAMES = ['rotcanary'];

// The verdict for one skill folder under `dest`: { owned: true, via } or { owned: false, reason }.
// `entry` is this target's record entry, or undefined when the target has none. `purpose` is 'install' or 'delete': a byte match
// (adopt) authorizes an install only, never a delete.
function ownership(dest, name, entry, shared, purpose = 'install') {
  const p = path.join(dest, name);
  let st;
  try { st = fs.lstatSync(p); }
  catch (e) { return e && e.code === 'ENOENT' ? { owned: true, via: 'absent' } : { owned: false, reason: 'it could not be read' }; }
  if (st.isSymbolicLink() || !st.isDirectory()) return { owned: false, reason: 'it is a link or a file, not a folder CoalMine wrote' };
  let entries;
  try { entries = fs.readdirSync(p); }
  catch { return { owned: false, reason: 'it could not be read' }; }
  if (entries.length === 0) return { owned: true, via: 'empty' };
  const have = folderHashes(p);
  if (have === null) return { owned: false, reason: 'it holds a link, a non-file, or a file that could not be read' };
  if (entry && entry.skills && Object.hasOwn(entry.skills, name)) {
    return sameHashes(have, entry.skills[name]) ? { owned: true, via: 'record' } : { owned: false, reason: 'its contents differ from what CoalMine recorded (undo your change inside it, or remove the folder)' };
  }
  if (!entry) {
    const want = expectedHashes(name, shared);
    if (want && sameHashes(have, want)) {
      if (purpose === 'install') return { owned: true, via: 'adopt' };
      // 29ag: identical bytes do not show whose copy this is, so they never authorize a delete.
      return { owned: false, reason: 'the record does not name it, and identical bytes do not show whose copy it is' };
    }
  }
  return { owned: false, reason: 'the record does not name it, and its contents are not the shipped files' };
}

// The sha256 of every file the installer would write for `name`, from its source and the shared sections; nothing is written.
// null when the source has no such skill (a retired or foreign name).
function expectedHashes(name, shared) {
  try {
    const out = {};
    for (const [rel, bytes] of expectedSkillFiles(path.join(skillsSrc, name), shared)) out[rel] = createHash('sha256').update(bytes).digest('hex');
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}

// Removes one folder the verdict proved ours. Its containment under the root is checked first (CWK-137).
function removeSkillFolder(dest, name, root) {
  const p = path.join(dest, name);
  const why = checkRepoDirTarget(p, root);
  if (why) throw new Error(why);
  fs.rmSync(p, { recursive: true, force: true });
}

// Removes what is proven ours among `names`, keeps (and names) the rest. Returns the names removed.
function removeOwnedSkills(dest, names, entry, shared, root) {
  const removed = [];
  for (const name of names) {
    const v = ownership(dest, name, entry, shared, 'delete');
    if (!v.owned) { console.warn(keepMessage(path.join(dest, name), v.reason)); process.exitCode = 1; continue; }
    if (v.via === 'absent') continue;
    try {
      removeSkillFolder(dest, name, root);
      removed.push(name);
      console.log(`  removed skill: ${name} from ${path.join(dest, name)}`);
    } catch (e) {
      console.warn(keepMessage(path.join(dest, name), `it could not be removed safely (${e.message})`));
      process.exitCode = 1;
    }
  }
  return removed;
}

// This target's record, read once per run. `key` is the target's real path, null while the folder does not exist yet.
// A record this CoalMine cannot use (newer, or unreadable) gives the target no entry: every folder is judged by its contents.
function targetRecord(dest) {
  const loaded = loadInstallRecord(os.homedir());
  if (loaded.state === 'newer') console.warn('  [CoalMine] the install record was written by a newer CoalMine and was left alone; this run judges every folder by its contents and does not record what it installs.');
  let key = null;
  try { key = fs.realpathSync.native(dest); } catch { /* not created yet: nothing is recorded for it */ }
  const raw = loaded.state === 'ok' && key !== null && Object.hasOwn(loaded.record.targets, key) ? loaded.record.targets[key] : undefined;
  const entry = raw && isRecordEntry(raw) ? raw : undefined;
  return { state: loaded.state, record: loaded.record, key, entry };
}
function isRecordEntry(e) { return e !== null && typeof e === 'object' && e.skills !== null && typeof e.skills === 'object' && !Array.isArray(e.skills); }

// Writes this target's entry: the skills this run wrote, with the hashes they now have, plus each skill the entry already named that
// this run kept (29ag: it keeps its OLD hashes, which still prove what CoalMine wrote; a recomputed hash would bless the very edit
// that made the run keep it). A kept folder that is gone is dropped. A newer record is left alone.
function recordInstall(dest, installed, tr) {
  if (tr.state === 'newer') return;
  let key;
  try { key = fs.realpathSync.native(dest); } catch { return; }
  const skills = {};
  for (const s of installed) {
    const h = folderHashes(path.join(dest, s));
    if (h) skills[s] = h;
  }
  const prior = tr.entry ? tr.entry.skills : {};
  for (const s of safeSkillNames(Object.keys(prior))) {
    const old = prior[s];
    if (Object.hasOwn(skills, s) || !old || typeof old !== 'object' || !lexists(path.join(dest, s))) continue;
    skills[s] = old;
  }
  const next = tr.record;
  if (Object.keys(skills).length) {
    const version = installed.length || !tr.entry || typeof tr.entry.version !== 'string' ? pluginVersion() : tr.entry.version;
    next.targets[key] = { version, skills };
  } else delete next.targets[key];
  try { saveInstallRecord(os.homedir(), next); }
  catch (e) { console.warn(`  [warn] could not write the install record: ${e.message}`); process.exitCode = 1; }
}

function pluginVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? '0.0.0'; }
  catch { return '0.0.0'; }
}

function readManifest(destDir, root = destDir) {
  try {
    const raw = readRepoFileBounded(path.join(destDir, MANIFEST_NAME), root, MAX_CONFIG_BYTES); // CWK-137
    if (raw === null) return null;
    const m = JSON.parse(raw);
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


// The install manifest: the per-file hashes of what this run wrote, the baseline `verify.mjs <target>` checks for tampering. It
// authorizes nothing (see the ownership section above).
function writeManifest(destDir, installedSkills, root = destDir) {
  try {
    // Per-file SHA-256 of everything we just wrote — the SFC-lite baseline that `verify.mjs <target>` checks for post-install tampering.
    const hashes = hashInstalledTree(destDir, installedSkills);
    const manifest = { version: pluginVersion(), installedAt: new Date().toISOString(), skills: installedSkills, hashes };
    writeRepoFile(path.join(destDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n', root); // CWK-137
  } catch (e) {
    console.warn(`  [warn] could not write install manifest: ${e.message}`);
    process.exitCode = 1;
  }
}

// 14a LOW-3: remove a dead installer's work folder (a marked directory, directly inside `dest`, whose pid is not alive);
// the conditions live in sweepInstallLeftovers (lib/render.mjs). Say what was removed, never fail the run over it.
function sweepLeftovers(dest) {
  try { for (const n of sweepInstallLeftovers(dest)) console.log(`  removed the leftover of a killed install: ${n}`); } catch { /* the sweep is best effort */ }
}

// ─── Reusable install steps (shared by single-agent and `all`) ──────────────
function installSkills(dest, skills, shared, root = dest) {
  console.log(`\nInstalling ${skills.length} skill(s) → ${dest}`);
  // CWK-137: a project target (`.github/skills`, `.agents/skills`, ...) must resolve inside the project; a user-chosen target is its own root.
  if (root === dest) { try { fs.mkdirSync(dest, { recursive: true }); } catch { /* the check below reports it */ } }
  const destWhy = checkRepoDirTarget(dest, root);
  if (destWhy) {
    console.warn(refuseMsg(dest, destWhy));
    process.exitCode = 1;
    return { installed: 0, failed: skills.length };
  }
  sweepLeftovers(dest); // 14a LOW-3: a killed earlier install's work folder goes first, so it never reads as a stuck skill
  const tr = targetRecord(dest);
  // A shipped skill is written only when its folder is provably ours; otherwise it is kept, named, and the run exits 1.
  const toInstall = [];
  for (const s of skills) {
    const v = ownership(dest, s, tr.entry, shared, 'install');
    if (v.owned) { toInstall.push(s); continue; }
    console.warn(keepMessage(path.join(dest, s), v.reason));
    process.exitCode = 1;
  }
  // A skill the record names that this CoalMine no longer ships: removed only on the record's own proof.
  const orphans = safeSkillNames(Object.keys((tr.entry && tr.entry.skills) || {})).filter((n) => !skills.includes(n));
  removeOwnedSkills(dest, [...orphans, ...RETIRED_SKILL_NAMES.filter((n) => !skills.includes(n))], tr.entry, shared, root);
  const installed = [];
  for (const s of toInstall) {
    try {
      const to = path.join(dest, s);
      installSkillDir(path.join(skillsSrc, s), to, shared);
      console.log(`  installed ${s} → ${to}`);
      installed.push(s);
    } catch (e) {
      console.warn(`  [warn] failed to install ${s}: ${e.message}`);
      process.exitCode = 1;
    }
  }
  writeManifest(dest, installed, root);
  recordInstall(dest, installed, tr);
  return { installed: installed.length, failed: skills.length - installed.length };
}

function applyConfig(targetKey, label) {
  console.log(`\nConfiguring auto-trigger for: ${label}`);
  const cfg = Object.hasOwn(PLATFORM_CONFIGS, targetKey) ? PLATFORM_CONFIGS[targetKey] : undefined; // R14 B-u2-7: own-key only
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
  // configured anywhere (own-dir, another known agent dir, or either LEGACY
  // shape) is left alone; a never-configured project now gets the NEW shape
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
    const existing = candidates.find((c) => fs.existsSync(c) && !isGlobalCfgFile(c)); // UMB-133: at cwd == home the nested legacy path is the GLOBAL file, not a project config
    if (existing) {
      console.log(`  settings file already exists at ${existing}`);
      return;
    }
    const configDest = ownDirDefault(process.cwd()); // whichever agent dir the project already has — new installs get the new shape
    // CWK-137: through the contained writer -- a junction on `.claude`/`.agents` or a
    // dangling link at the config path is refused, never written through.
    const cfgWhy = checkRepoWriteTarget(configDest, process.cwd());
    if (cfgWhy) { console.warn(refuseMsg(path.relative(process.cwd(), configDest), cfgWhy)); process.exitCode = 1; return; }
    writeRepoFile(configDest, fs.readFileSync(path.join(repo, 'platform-configs', '.coalmine.json'), 'utf8'), process.cwd());
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
// R14 / B-u2-6: validate argv BEFORE anything resolves a path. `--help` used to be taken for a
// PATH and installed nine skills into ./--help/; any other flag-shaped word is an error too.
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node scripts/install.mjs [--uninstall | -u] <${Object.keys(TARGETS).join('|')}|all|PATH>`);
  console.log('Example: node scripts/install.mjs claude   (installs the nine skills; --uninstall removes them)');
  return;
}
const unknownFlag = args.find((x) => x.startsWith('-') && x !== '--uninstall' && x !== '-u');
if (unknownFlag !== undefined) {
  console.error(`Unknown option: ${unknownFlag}`);
  console.error(`Usage: node scripts/install.mjs [--uninstall | -u] <${Object.keys(TARGETS).join('|')}|all|PATH>`);
  process.exitCode = 2;
  return;
}
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
      const r = installSkills(d, skills, shared, process.cwd());
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

// R14 / B-u2-7: an own-key lookup. `TARGETS['constructor']` is Object, not a path, and crashed the next line.
const dest = Object.hasOwn(TARGETS, targetKey) ? TARGETS[targetKey] : path.resolve(targetArg);

if (path.resolve(dest) === path.resolve(skillsSrc)) {
  console.error('Target directory cannot be the source skills directory.');
  process.exitCode = 1;
  return;
}

if (isUninstall) {
  console.log(`\nUninstalling CoalMine from target: ${targetArg}`);
  // 29ae/29ag: a folder is removed only when the install record names it and its files match what was recorded (see the ownership
  // section). A byte match never authorizes a removal, with or without a record. Retired names are kept and named unless proven.
  // The manifest supplies only the hashes a kept folder keeps, below.
  const uninstallRoot = skillsRootFor(targetKey, dest);
  const destWhy = lexists(dest) ? checkRepoDirTarget(dest, uninstallRoot) : null;
  if (destWhy) { console.warn(refuseMsg(dest, destWhy)); process.exitCode = 1; return; } // CWK-137: never rm through a junction
  if (lexists(dest)) sweepLeftovers(dest); // 14a LOW-3: the same narrow sweep, so an uninstall after a killed install leaves nothing
  const previous = readManifest(dest, uninstallRoot);
  const uninstallShared = loadShared();
  if (uninstallShared === null) return;
  const tr = targetRecord(dest);
  const names = [...new Set(safeSkillNames([...Object.keys((tr.entry && tr.entry.skills) || {}), ...skills, ...RETIRED_SKILL_NAMES]))];
  const removed = removeOwnedSkills(dest, names, tr.entry, uninstallShared, uninstallRoot);
  const kept = names.filter((n) => lexists(path.join(dest, n)));
  const removedCount = removed.length;
  if (tr.state !== 'newer' && tr.key !== null && tr.entry) {
    for (const n of removed) delete tr.entry.skills[n];
    if (Object.keys(tr.entry.skills).length === 0) delete tr.record.targets[tr.key];
    try { saveInstallRecord(os.homedir(), tr.record); }
    catch (e) { console.warn(`  [warn] could not write the install record: ${e.message}`); process.exitCode = 1; }
  }
  if (previous && kept.length) {
    // HIGH-2: a kept folder must stay provable on the next run, so the manifest survives with ONLY the kept skills
    // and their old hashes (the one-shot-guard lesson, applied to uninstall). Nothing kept -> the manifest goes.
    try {
      const hashes = {};
      for (const [k, v] of Object.entries(previous.hashes || {})) if (kept.some((n) => k.startsWith(n + '/'))) hashes[k] = v;
      const rest = { version: previous.version, installedAt: previous.installedAt, skills: kept };
      if (previous.hashes && typeof previous.hashes === 'object') rest.hashes = hashes; // a hashless manifest stays hashless: an empty object would claim a proof it cannot give
      writeRepoFile(path.join(dest, MANIFEST_NAME), JSON.stringify(rest, null, 2) + '\n', uninstallRoot); // CWK-137
    } catch (e) { console.warn(`  [warn] could not keep the install manifest: ${e.message}`); process.exitCode = 1; }
  } else {
    try { fs.rmSync(path.join(dest, MANIFEST_NAME), { force: true }); } catch {}
  }
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
const { installed: n, failed } = installSkills(dest, skills, shared, skillsRootFor(targetKey, dest));
applyConfig(targetKey, targetArg);
console.log('\nConfiguring git hooks...');
installGitHooks();
copyDefaultConfig();
console.log(`\nDone: ${n}/${skills.length} skill(s) → ${dest}${failed ? ` (${failed} failed)` : ''}`);
console.log(`Verify: node scripts/verify.mjs`);
}

main();

