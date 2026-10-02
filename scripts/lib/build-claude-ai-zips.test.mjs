import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.join(repo, 'dist-claude-ai');
const script = path.join(repo, 'scripts', 'build-claude-ai-zips.mjs');

test('build-claude-ai-zips: stages every plugin skill with a trimmed, valid description', () => {
  fs.rmSync(outDir, { recursive: true, force: true });
  try {
    const r = spawnSync(process.execPath, [script], { cwd: repo, encoding: 'utf8' });
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /^Done: \d+\/\d+ skill\(s\) staged/m, 'summary line present');
    assert.doesNotMatch(r.stdout, /FAIL/, 'no per-skill failures');

    assert.ok(fs.existsSync(outDir), 'dist-claude-ai/ was created');
    const staged = fs.readdirSync(outDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    const pluginSkillCount = fs.readdirSync(path.join(repo, 'plugin', 'skills'), { withFileTypes: true })
      .filter((e) => e.isDirectory()).length;
    assert.equal(staged.length, pluginSkillCount, 'one staged dir per plugin skill, none missing/extra');

    for (const s of staged) {
      const skillMd = path.join(outDir, s.name, 'SKILL.md');
      assert.ok(fs.existsSync(skillMd), `${s.name}/SKILL.md exists in the staged copy`);
      const text = fs.readFileSync(skillMd, 'utf8');
      const m = text.match(/^description:\s*"((?:[^"\\]|\\.)*)"/m);
      assert.ok(m, `${s.name}: description rewritten as a single-line quoted value`);
      const unescaped = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      assert.ok(unescaped.length <= 200, `${s.name}: staged description (${unescaped.length} chars) must be <= 200`);
      assert.ok(unescaped.length > 0, `${s.name}: staged description is non-empty`);
    }

    // The SOURCE files are never touched by this build — only the staged copy.
    const sourceSkillMd = path.join(repo, 'skills', 'rot-canary', 'SKILL.md');
    const sourceText = fs.readFileSync(sourceSkillMd, 'utf8');
    assert.ok(sourceText.includes('description: >-'), 'source SKILL.md frontmatter shape is untouched (block scalar, not rewritten to a quoted line)');
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('build-claude-ai-zips: fails loud when plugin/ has not been built', () => {
  // Point HOME/cwd trick is unnecessary -- simulate by running against a copied
  // script whose sibling plugin/ dir is absent: use a throwaway repo skeleton.
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cm-claude-ai-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts', 'lib'), { recursive: true });
    fs.cpSync(script, path.join(tmp, 'scripts', 'build-claude-ai-zips.mjs'));
    fs.cpSync(path.join(repo, 'scripts', 'lib', 'desc-cap.mjs'), path.join(tmp, 'scripts', 'lib', 'desc-cap.mjs'));
    fs.cpSync(path.join(repo, 'scripts', 'lib', 'claude-ai-trim.mjs'), path.join(tmp, 'scripts', 'lib', 'claude-ai-trim.mjs'));
    // No plugin/ dir at all under tmp.
    const r = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'build-claude-ai-zips.mjs')], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, 'exits non-zero when plugin/skills is missing');
    assert.match(r.stderr, /does not exist/, 'names the missing dist as the reason');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
