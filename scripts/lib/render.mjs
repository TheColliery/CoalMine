// CoalMine render core — the ONLY place that knows how SKILL.md templates,
// skills/_shared/ partials, and skill-meta.json intents combine into a
// conformed skill. Shared by install.mjs (agent targets), build-plugin.mjs
// (committed plugin/ dist), and verify.mjs (drift detection) so every route
// ships byte-identical content. Node built-ins only.

import fs from 'node:fs';
import path from 'node:path';
import { MAX_CONFIG_BYTES, MAX_DOC_BYTES, readRepoFileBounded } from './repo-fs.mjs';

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
  // R14 / CSV-5: bounded, regular-file-only reads (a checkout of this repo may be untrusted input to a build).
  const mdPath = path.join(skillDir, 'SKILL.md');
  const raw = readRepoFileBounded(mdPath, skillDir, MAX_DOC_BYTES);
  if (raw === null) throw new Error(`${mdPath}: unreadable, not a regular file, or over ${MAX_DOC_BYTES} bytes`);
  const metaPath = path.join(skillDir, 'skill-meta.json');
  let meta = {};
  if (fs.existsSync(metaPath)) {
    const metaRaw = readRepoFileBounded(metaPath, skillDir, MAX_CONFIG_BYTES);
    if (metaRaw === null) throw new Error(`${metaPath}: unreadable, not a regular file, or over ${MAX_CONFIG_BYTES} bytes`);
    meta = JSON.parse(metaRaw.replace(/^\uFEFF/, ''));
  }
  return inject(raw, shared, meta);
}

// Materialize one conformed skill dir: aux files copied, SKILL.md rendered.
// Nested dirs (references/, scripts/) copy recursively — anthropics/skills-style
// skill bundles must not break the installer. The target skill dir is replaced
// whole, so files deleted/renamed in source can't linger at install targets.
//
// 14a LOW-3: the folder is never written in place. A kill mid-copy of a FIRST install left a partial skill
// folder with no skill-meta.json and no manifest, which every later install refused and uninstall left behind
// (09b INSPECT unit 2). The copy now goes into a WORK folder beside the target, `.<skill>.coalmine-tmp-<pid>`,
// holding a marker file, the new tree (`new/`) and, during a reinstall, the folder it replaces (`old/`). The new
// tree is proven complete, the old folder is moved aside, the new one renamed in (both renames stay inside one
// parent, so never across devices), and the work folder is removed. A kill at any point leaves either the old
// folder whole or no folder, plus a marked work folder the next install sweeps (sweepInstallLeftovers).
// A rename that fails (EPERM/EBUSY on Windows: a process holds the folder) puts the old folder back, removes the
// work folder, and throws; it NEVER falls back to an in-place copy (node/runtime.md section 5).
const WORK_MARK = '.coalmine-installing';
const WORK_RE = /^\.(.+)\.coalmine-tmp-(\d+)$/;

const lexists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

// A work folder is removed only when it is a real directory (never a link) that carries the marker file.
function removeWork(work) {
  try {
    if (!fs.lstatSync(work).isDirectory()) return false;
    if (!fs.lstatSync(path.join(work, WORK_MARK)).isFile()) return false;
    fs.rmSync(work, { recursive: true, force: true });
    return true;
  } catch { return false; }
}

// The relative file set a finished skill folder must hold: every source file except SKILL.md (rendered, so it is
// listed by name), the shared references, and SKILL.md itself when the source has one.
function expectedFiles(from, shared) {
  const out = [];
  const walk = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (rel === '' && e.name === 'SKILL.md') continue;
      if (e.isDirectory()) walk(path.join(abs, e.name), rel + e.name + '/');
      else out.push(rel + e.name);
    }
  };
  walk(from, '');
  for (const name of Object.keys(shared.sharedReferences ?? {})) out.push('references/' + name);
  if (fs.existsSync(path.join(from, 'SKILL.md'))) out.push('SKILL.md');
  return [...new Set(out)].sort();
}
function assertComplete(from, fresh, shared) {
  const want = expectedFiles(from, shared);
  const have = [];
  const walk = (abs, rel) => { for (const e of fs.readdirSync(abs, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(abs, e.name), rel + e.name + '/'); else have.push(rel + e.name); } };
  walk(fresh, '');
  have.sort();
  if (want.length !== have.length || want.some((f, i) => f !== have[i])) {
    const missing = want.filter((f) => !have.includes(f));
    throw new Error(`the new skill folder is incomplete (missing: ${missing.slice(0, 5).join(', ') || 'none; extra files present'}); nothing was changed`);
  }
}

export function installSkillDir(from, to, shared) {
  const work = path.join(path.dirname(to), `.${path.basename(to)}.coalmine-tmp-${process.pid}`);
  const fresh = path.join(work, 'new');
  const aside = path.join(work, 'old');
  // A work folder with this very name is an earlier run's (pid reuse): replace it only if it is provably ours.
  if (lexists(work) && !removeWork(work)) throw new Error(`${work} exists and is not an installer work folder; nothing was changed`);
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, WORK_MARK), String(process.pid), 'utf8');
  let keep = false;
  try {
    fs.mkdirSync(fresh);
    buildSkillTree(from, fresh, shared);
    assertComplete(from, fresh, shared);
    const had = lexists(to);
    if (had) fs.renameSync(to, aside);
    try {
      fs.renameSync(fresh, to);
    } catch (e) {
      if (had) {
        try { fs.renameSync(aside, to); }
        catch { keep = true; e.message += ` (the previous copy could not be put back and is kept in ${work}${path.sep}old)`; }
      }
      throw e;
    }
  } finally {
    if (!keep) removeWork(work);
  }
}

// What the next install does with a leftover work folder (a killed installer's): remove it ONLY when it is a real
// directory (a link named like one is never followed), its realpath is a direct child of the destination's realpath,
// it carries the installer's marker file, and the pid in its name is not a live process. One marked directory per
// delete, never a glob or a wider target (AGENTS.md, A DELETE IS NARROW). An alive pid, or a pid we cannot probe,
// keeps the folder: the other installer may still be writing to it. Returns the names removed.
export function sweepInstallLeftovers(parent) {
  const removed = [];
  let entries;
  let parentReal;
  try { entries = fs.readdirSync(parent, { withFileTypes: true }); parentReal = fs.realpathSync.native(parent); } catch { return removed; }
  for (const e of entries) {
    const m = WORK_RE.exec(e.name);
    if (!m || !e.isDirectory()) continue; // a link reads isSymbolicLink, not isDirectory
    const pid = Number(m[2]);
    if (pid === process.pid || pidMayBeAlive(pid)) continue;
    const p = path.join(parent, e.name);
    try {
      const real = fs.realpathSync.native(p);
      if (path.dirname(real) !== parentReal) continue;
      if (removeWork(p)) removed.push(e.name);
    } catch { /* unreadable: left alone */ }
  }
  return removed;
}
function pidMayBeAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return !(e && e.code === 'ESRCH'); }
}

function buildSkillTree(from, to, shared) {
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
