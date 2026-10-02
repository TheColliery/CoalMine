#!/usr/bin/env node
// Stages one directory per skill under dist-claude-ai/<name>/, copied from
// plugin/skills/<name>/ with ONLY the SKILL.md frontmatter `description`
// field rewritten to a 200-char skill-listing cap (our own cross-platform cap
// is 1024, desc-cap.mjs). claude.ai's skills page, read 2026-10-02, states a
// 1,024-char limit, so the 200 trim is conservative: a description that is too
// short still uploads, one that is too long may not. It stays until one real
// upload at the longer length is on record (UMB-333). A DERIVED artifact;
// skills/*/SKILL.md and plugin/skills/*/SKILL.md are never touched. The
// claude-ai-zips workflow zips each staged directory and attaches it to
// the GitHub Release as an asset. The workflow zips each staged FOLDER from its
// parent, so an archive holds <name>/SKILL.md (a SKILL.md at the archive root is
// not recognized as a skill) and checks every archive's layout before upload.
// Canonical exemplar: CoalMine (board #40).
//
// Entry-point imports node builtins only at the top level (node/runtime.md
// §1) — local libs are dynamic, inside main().
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(scriptDir, '..');
const pluginSkills = path.join(repo, 'plugin', 'skills');
const outDir = path.join(repo, 'dist-claude-ai');

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Replace the frontmatter `description:` field (bare/quoted single-line, or
// a block scalar with indented continuation lines) with a single-line
// quoted value — the trimmed description is always <= the platform cap and
// never needs the block-scalar form.
function replaceDescriptionField(text, newValue) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error('no frontmatter block found');
  const lines = m[1].split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith('description:'));
  if (i === -1) throw new Error('no description key in frontmatter');
  let end = i + 1;
  const v = lines[i].slice('description:'.length).trim();
  if (/^[>|][-+]?$/.test(v)) {
    while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
  }
  const escaped = newValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const newLines = [...lines.slice(0, i), `description: "${escaped}"`, ...lines.slice(end)];
  return text.slice(0, m.index) + '---\n' + newLines.join('\n') + '\n---' + text.slice(m.index + m[0].length);
}

async function main() {
  const { frontmatterField } = await import('./lib/desc-cap.mjs');
  const { trimDescription, CLAUDE_AI_DESC_CAP } = await import('./lib/claude-ai-trim.mjs');

  if (!fs.existsSync(pluginSkills)) {
    console.error(`FAIL: ${pluginSkills} does not exist — run node scripts/build-plugin.mjs first.`);
    process.exitCode = 1;
    return;
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  const skills = fs.readdirSync(pluginSkills, { withFileTypes: true }).filter((e) => e.isDirectory());
  let failed = 0;
  for (const skill of skills) {
    try {
      const srcDir = path.join(pluginSkills, skill.name);
      const destDir = path.join(outDir, skill.name);
      copyDirRecursive(srcDir, destDir);
      const skillMdPath = path.join(destDir, 'SKILL.md');
      const text = fs.readFileSync(skillMdPath, 'utf8');
      const description = frontmatterField(text, 'description');
      if (description == null) throw new Error('no description field found');
      const trimmed = trimDescription(description, CLAUDE_AI_DESC_CAP);
      fs.writeFileSync(skillMdPath, replaceDescriptionField(text, trimmed), 'utf8');
      console.log(`staged ${skill.name} (description ${description.length} -> ${trimmed.length} chars)`);
    } catch (e) {
      console.error(`FAIL ${skill.name}: ${e.message}`);
      failed++;
      process.exitCode = 1;
    }
  }
  console.log(`Done: ${skills.length - failed}/${skills.length} skill(s) staged into ${outDir}, ${failed} failed`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
