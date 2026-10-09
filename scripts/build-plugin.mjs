#!/usr/bin/env node
// CoalMine plugin-dist builder — regenerates the committed plugin/ directory
// that .claude-plugin/marketplace.json serves (plugins[0].source = "./plugin").
//
// Why a committed dist: the Claude Code plugin marketplace serves files
// straight from git, with no build step — so the conformed copies (shared
// sections injected) must live in the repo. Raw skills/ templates stay the
// authoring source; plugin/ is generated output. Never hand-edit plugin/.
//
// Re-run after editing skills/, skills/_shared/, hooks/, or
// .claude-plugin/plugin.json:
//   node scripts/build-plugin.mjs
// verify.mjs FAILs (and the pre-commit hook blocks) while plugin/ is stale.
// Cross-platform, Node built-ins only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadShared, listSkills, installSkillDir } from './lib/render.mjs';
import { REGION_TARGETS, syncRegion } from './lib/shared-regions.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsSrc = path.join(repo, 'skills');
const pluginDir = path.join(repo, 'plugin');

// CWK-071: wrapped in main() so a failed loadShared() can `return` and stop the
// rebuild -- `process.exitCode = 1` alone does not halt execution the way
// `process.exit()` did, and `return` needs a function body to return from. Body
// kept at its original (flat) indentation deliberately: this wrapper is the whole
// change, and reindenting the rest would make a mechanical, behaviour-preserving
// refactor hard to audit against the original.
function main() {
let shared;
try {
  shared = loadShared(path.join(skillsSrc, '_shared'));
} catch (e) {
  console.error(`Failed to load shared sections: ${e.message}`);
  process.exitCode = 1;
  return;
}

// Deterministic rebuild: wipe, then regenerate everything.
fs.rmSync(pluginDir, { recursive: true, force: true });

const skills = listSkills(skillsSrc);
console.log(`\nBuilding plugin dist (${skills.length} skills) → ${pluginDir}`);
let n = 0;
for (const s of skills) {
  try {
    installSkillDir(path.join(skillsSrc, s), path.join(pluginDir, 'skills', s), shared);
    console.log(`  rendered ${s}`);
    n++;
  } catch (e) {
    console.error(`  [fail] ${s}: ${e.message}`);
    process.exitCode = 1;
  }
}

// Shared regions inside standalone hooks — synced from hooks/_shared so the
// duplicated config plumbing has one source while each hook file stays
// copy-one-file portable (Phoenix #9). Sync runs BEFORE the dist copy.
for (const t of REGION_TARGETS) {
  try {
    const p = path.join(repo, t.file);
    const partial = fs.readFileSync(path.join(repo, t.partial), 'utf8');
    const cur = fs.readFileSync(p, 'utf8');
    const synced = syncRegion(cur, t.name, t.comment, partial);
    if (synced === null) {
      console.error(`  [fail] ${t.file}: shared region '${t.name}' markers missing`);
      process.exitCode = 1;
      continue;
    }
    if (synced !== cur) {
      fs.writeFileSync(p, synced);
      console.log(`  synced shared region '${t.name}' in ${t.file}`);
    }
  } catch (e) {
    console.error(`  [fail] ${t.file}: region sync failed: ${e.message}`);
    process.exitCode = 1;
  }
}

// Hooks — hooks.json references ${CLAUDE_PLUGIN_ROOT}/hooks/*.js, which
// resolves inside the dist once it is the plugin root.
fs.mkdirSync(path.join(pluginDir, 'hooks'), { recursive: true });
for (const f of ['hooks.json', 'rot-canary-touch.js', 'rot-canary-stop.js', 'coalmine-conductor.js']) {
  fs.copyFileSync(path.join(repo, 'hooks', f), path.join(pluginDir, 'hooks', f));
}
console.log('  copied hooks/ (hooks.json + rot-canary touch/stop + coalmine-conductor)');

// R14 / CWK-180: the plugin folder's own README (the directory listing's text) is authored at plugin-src/README.md.
fs.copyFileSync(path.join(repo, 'plugin-src', 'README.md'), path.join(pluginDir, 'README.md'));
console.log('  copied plugin-src/README.md -> plugin/README.md');

// CWK-202 (09b): the native Antigravity plugin. AG registers a FOLDER holding plugin.json (+ hooks.json) at its root (agy-customizations/docs/plugins.md) and runs a
// hook command from the directory holding hooks.json (docs/hooks.md), so plugin/ IS that folder: the two files sit beside the rendered skills/ and the hooks/ the
// commands run. They are authored at plugin-src/, never at the repo root, whose skills/ are the UNRENDERED templates (an AG plugin rooted there would load them raw).
// Claude Code reads .claude-plugin/plugin.json and hooks/hooks.json, never these two paths.
for (const f of ['plugin.json', 'hooks.json']) {
  fs.copyFileSync(path.join(repo, 'plugin-src', f), path.join(pluginDir, f));
  console.log(`  copied plugin-src/${f} -> plugin/${f}`);
}

// Bundled extras Claude Code auto-discovers at plugin root. Recursive copy:
// same EISDIR class as installSkillDir — never assume flat.
for (const extra of ['agents', 'commands']) {
  const src = path.join(repo, extra);
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(pluginDir, extra), { recursive: true });
    console.log(`  copied ${extra}/`);
  }
}

// Plugin manifest — authored once at .claude-plugin/plugin.json, copied in.
fs.mkdirSync(path.join(pluginDir, '.claude-plugin'), { recursive: true });
fs.copyFileSync(
  path.join(repo, '.claude-plugin', 'plugin.json'),
  path.join(pluginDir, '.claude-plugin', 'plugin.json'),
);
console.log('  copied .claude-plugin/plugin.json');

console.log(`\nDone: ${n}/${skills.length} skill(s) rendered into plugin/`);
console.log('Verify: node scripts/verify.mjs');
}

main();
