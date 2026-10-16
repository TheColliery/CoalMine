// CoalMine render core unit tests — node:test built-in, zero dependencies.
// Run: node --test scripts/lib/render.test.mjs
// Covers: marker injection, intent placeholders, missing-meta fallback and recursive skill-dir copy.
// 15b5b (CI red fix): split out of render.test.mjs, tests verbatim, so no one file nears the per-file clock on node 22 (testing.md finite-clock MUST).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inject, renderSkillMd, installSkillDir, SHARED_REFERENCES } from './render.mjs';

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
const SHARED = {
  languageHeader: 'LANG-HEADER',
  orchestration: 'ORCH {{LIGHT_INTENT}}|{{STANDARD_INTENT}}|{{HEAVY_INTENT}}',
  escalationFooter: 'ESC-FOOTER',
  reportingFooter: 'REPORT-FOOTER',
};

test('inject replaces every SHARED marker', () => {
  const src = [
    '<!-- SHARED:LANGUAGE_HEADER -->',
    'body',
    '<!-- SHARED:ORCHESTRATION -->',
    '<!-- SHARED:ESCALATION_FOOTER -->',
    '<!-- SHARED:REPORTING_FOOTER -->',
  ].join('\n');
  const out = inject(src, SHARED, { lightIntent: 'L', standardIntent: 'S', heavyIntent: 'H' });
  assert.ok(!out.includes('<!-- SHARED:'), 'no unresolved markers may remain');
  assert.ok(out.includes('LANG-HEADER'));
  assert.ok(out.includes('ESC-FOOTER'));
  assert.ok(out.includes('REPORT-FOOTER'));
});

test('inject fills intent placeholders from meta', () => {
  const out = inject('<!-- SHARED:ORCHESTRATION -->', SHARED, {
    lightIntent: 'quick check',
    standardIntent: 'balanced',
    heavyIntent: 'full fan-out',
  });
  assert.equal(out, 'ORCH quick check|balanced|full fan-out');
});

test('inject defaults missing intents to empty string', () => {
  const out = inject('<!-- SHARED:ORCHESTRATION -->', SHARED, {});
  assert.equal(out, 'ORCH ||');
});

test('renderSkillMd works without skill-meta.json', () => {
  const dir = mkTmp('cm-render-');
  try {
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '<!-- SHARED:LANGUAGE_HEADER -->\nhello', 'utf8');
    const out = renderSkillMd(dir, SHARED);
    assert.equal(out, 'LANG-HEADER\nhello');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('installSkillDir copies nested subdirectories recursively', () => {
  const src = mkTmp('cm-src-');
  const dst = mkTmp('cm-dst-');
  try {
    fs.writeFileSync(path.join(src, 'SKILL.md'), '<!-- SHARED:LANGUAGE_HEADER -->', 'utf8');
    fs.writeFileSync(path.join(src, 'skill-meta.json'), '{}', 'utf8');
    fs.mkdirSync(path.join(src, 'references', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(src, 'references', 'a.md'), 'ref-a', 'utf8');
    fs.writeFileSync(path.join(src, 'references', 'deep', 'b.md'), 'ref-b', 'utf8');

    const to = path.join(dst, 'myskill');
    installSkillDir(src, to, SHARED);

    assert.equal(fs.readFileSync(path.join(to, 'SKILL.md'), 'utf8'), 'LANG-HEADER');
    assert.equal(fs.readFileSync(path.join(to, 'references', 'a.md'), 'utf8'), 'ref-a');
    assert.equal(fs.readFileSync(path.join(to, 'references', 'deep', 'b.md'), 'utf8'), 'ref-b');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
});

test('installSkillDir writes shared references verbatim, alongside a skill that has none of its own', () => {
  const src = mkTmp('cm-src-');
  const dst = mkTmp('cm-dst-');
  try {
    // A skill with NO references/ dir of its own — the shared ref must still land.
    fs.writeFileSync(path.join(src, 'SKILL.md'), '<!-- SHARED:LANGUAGE_HEADER -->', 'utf8');
    const shared = { ...SHARED, sharedReferences: { 'escalation.md': 'SHARED-REF-BODY\n' } };

    const to = path.join(dst, 'myskill');
    installSkillDir(src, to, shared);

    assert.equal(fs.readFileSync(path.join(to, 'references', 'escalation.md'), 'utf8'), 'SHARED-REF-BODY\n');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
});

test('installSkillDir injects shared references without clobbering the skill\'s own references', () => {
  const src = mkTmp('cm-src-');
  const dst = mkTmp('cm-dst-');
  try {
    fs.writeFileSync(path.join(src, 'SKILL.md'), '<!-- SHARED:LANGUAGE_HEADER -->', 'utf8');
    fs.mkdirSync(path.join(src, 'references'), { recursive: true });
    fs.writeFileSync(path.join(src, 'references', 'own.md'), 'own-ref', 'utf8');
    const shared = { ...SHARED, sharedReferences: { 'escalation.md': 'SHARED-REF' } };

    const to = path.join(dst, 'myskill');
    installSkillDir(src, to, shared);

    assert.equal(fs.readFileSync(path.join(to, 'references', 'own.md'), 'utf8'), 'own-ref');
    assert.equal(fs.readFileSync(path.join(to, 'references', 'escalation.md'), 'utf8'), 'SHARED-REF');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
});

test('SHARED_REFERENCES is a non-empty list of {name, src} entries', () => {
  assert.ok(Array.isArray(SHARED_REFERENCES) && SHARED_REFERENCES.length >= 1);
  for (const r of SHARED_REFERENCES) {
    assert.equal(typeof r.name, 'string');
    assert.ok(r.name.length > 0);
    assert.ok(r.src.endsWith(r.name), `src ${r.src} should end with name ${r.name}`);
  }
});

