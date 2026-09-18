// CoalMine render core — the ONLY place that knows how SKILL.md templates,
// skills/_shared/ partials, and skill-meta.json intents combine into a
// conformed skill. Shared by install.mjs (agent targets), build-plugin.mjs
// (committed plugin/ dist), and verify.mjs (drift detection) so every route
// ships byte-identical content. Node built-ins only.

import fs from 'node:fs';
import path from 'node:path';

// The single shared reference every skill ships in references/escalation.md.
// It holds the on-demand Heavy-tier detail (per-platform levers + durability)
// moved out of the always-resident footer — stored ONCE here, written into each
// skill's references/ at build/install so the auto/Light path never pays for it.
export const SHARED_REFERENCES = [
  { name: 'escalation.md', src: 'references/escalation.md' },
];

export function loadShared(sharedDir) {
  return {
    languageHeader:   fs.readFileSync(path.join(sharedDir, 'language-header.md'),   'utf8').trimEnd(),
    orchestration:    fs.readFileSync(path.join(sharedDir, 'orchestration.md'),      'utf8').trimEnd(),
    escalationFooter: fs.readFileSync(path.join(sharedDir, 'escalation-footer.md'),  'utf8').trimEnd(),
    reportingFooter:  fs.readFileSync(path.join(sharedDir, 'reporting-footer.md'),   'utf8').trimEnd(),
    classifyBlock:    fs.readFileSync(path.join(sharedDir, 'classify-block.md'),     'utf8').trimEnd(),
    // Verbatim (no trimEnd): the body must land byte-identical at every target so
    // verify.mjs can byte-compare each skill's references/escalation.md to it.
    sharedReferences: Object.fromEntries(
      SHARED_REFERENCES.map((r) => [r.name, fs.readFileSync(path.join(sharedDir, r.src), 'utf8')]),
    ),
  };
}

export function inject(content, shared, meta = {}) {
  // Replacement values go through arrow functions so `$&`/`$'`-style patterns
  // in partials or intents can never be interpreted as replacement directives.
  const orchestration = shared.orchestration
    .replace(/\{\{LIGHT_INTENT\}\}/g,    () => meta.lightIntent    ?? '')
    .replace(/\{\{STANDARD_INTENT\}\}/g, () => meta.standardIntent ?? '')
    .replace(/\{\{HEAVY_INTENT\}\}/g,    () => meta.heavyIntent    ?? '');

  return content
    .replace(/<!-- SHARED:LANGUAGE_HEADER -->/g,   () => shared.languageHeader)
    .replace(/<!-- SHARED:ORCHESTRATION -->/g,       () => orchestration)
    .replace(/<!-- SHARED:ESCALATION_FOOTER -->/g,   () => shared.escalationFooter)
    .replace(/<!-- SHARED:REPORTING_FOOTER -->/g,    () => shared.reportingFooter)
    .replace(/<!-- SHARED:CLASSIFY_BLOCK -->/g,      () => shared.classifyBlock);
}

export function listSkills(skillsSrc) {
  return fs.readdirSync(skillsSrc, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name);
}

// Render one skill's SKILL.md template (with its skill-meta.json intents) to a string.
export function renderSkillMd(skillDir, shared) {
  const raw = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const metaPath = path.join(skillDir, 'skill-meta.json');
  const meta = fs.existsSync(metaPath)
    ? JSON.parse(fs.readFileSync(metaPath, 'utf8').replace(/^\uFEFF/, ''))
    : {};
  return inject(raw, shared, meta);
}

// Materialize one conformed skill dir: aux files copied, SKILL.md rendered.
// Nested dirs (references/, scripts/) copy recursively — anthropics/skills-style
// skill bundles must not break the installer. The target skill dir is cleared
// first so files deleted/renamed in source can't linger at install targets.
export function installSkillDir(from, to, shared) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from, { withFileTypes: true })) {
    if (f.name === 'SKILL.md') continue;
    const src = path.join(from, f.name);
    const dst = path.join(to, f.name);
    if (f.isDirectory()) fs.cpSync(src, dst, { recursive: true });
    else fs.copyFileSync(src, dst);
  }
  // Inject the shared reference(s) into references/ AFTER the per-skill copy, so
  // the always-resident footer can point here instead of inlining the detail ×9.
  const refs = shared.sharedReferences ?? {};
  if (Object.keys(refs).length > 0) {
    const refDir = path.join(to, 'references');
    fs.mkdirSync(refDir, { recursive: true });
    for (const [name, body] of Object.entries(refs)) {
      fs.writeFileSync(path.join(refDir, name), body, 'utf8');
    }
  }
  if (fs.existsSync(path.join(from, 'SKILL.md'))) {
    fs.writeFileSync(path.join(to, 'SKILL.md'), renderSkillMd(from, shared), 'utf8');
  }
}
