// c36 item 6: inject refuses an expansion whose output would pass MAX_RENDERED_CHARS, and checks the size BEFORE each stage (intent
// substitution, then fragment insertion), so the refusal happens before the expansion, never after. The bound is well above every
// rendered SKILL.md the repo carries today: the test reads the live tree and asserts the margin, so the bound cannot quietly shrink
// to the current size. Zero-dep (node:test); hermetic: inject is pure, and the live-tree leg reads the repo, never writes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as render from './render.mjs';
const { inject, loadShared, renderSkillMd } = render;

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const shared = (orchestration) => ({
  languageHeader: 'LANG',
  orchestration,
  escalationFooter: 'ESC',
  reportingFooter: 'REP',
  classifyBlock: 'CLS',
  sharedReferences: {},
});

test('a fragment insertion that would pass the bound is refused before it runs', () => {
  const big = 'O'.repeat(4000);
  const content = '<!-- SHARED:ORCHESTRATION -->\n'.repeat(200); // 200 x 4,000 characters, well over the bound
  assert.throws(() => inject(content, shared(big), {}), /refused before fragment insertion.*characters, over the/);
});

test('an intent substitution that would pass the bound is refused before it runs', () => {
  const orchestration = '{{LIGHT_INTENT}}'.repeat(2000); // 2,000 markers x a 300-character intent
  assert.throws(
    () => inject('<!-- SHARED:ORCHESTRATION -->', shared(orchestration), { lightIntent: 'L'.repeat(300) }),
    /refused before intent substitution.*characters, over the/,
  );
});

test('a small render is unchanged by the bound (control)', () => {
  const out = inject('a <!-- SHARED:LANGUAGE_HEADER --> b <!-- SHARED:ORCHESTRATION --> c', shared('ORCH {{LIGHT_INTENT}}'), { lightIntent: 'lite' });
  assert.equal(out, 'a LANG b ORCH lite c');
});

test('the bound is well above every rendered SKILL.md the repo carries (a margin, read live, not pinned)', () => {
  const sharedDir = path.join(repo, 'skills', '_shared');
  const sh = loadShared(sharedDir);
  let largest = 0;
  const skillsDir = path.join(repo, 'skills');
  for (const name of fs.readdirSync(skillsDir).filter((n) => !n.startsWith('_'))) {
    if (!fs.existsSync(path.join(skillsDir, name, 'SKILL.md'))) continue;
    largest = Math.max(largest, renderSkillMd(path.join(skillsDir, name), sh).length);
  }
  assert.ok(largest > 0, 'the live tree renders at least one SKILL.md');
  const bound = render.MAX_RENDERED_CHARS;
  assert.ok(Number.isFinite(bound) && bound >= 16 * largest, `bound ${bound} is at least 16x the largest render (${largest})`);
});
