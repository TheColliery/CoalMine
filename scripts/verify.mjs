#!/usr/bin/env node
// CoalMine verify — check repo integrity (skills, manifests, hooks), the committed
// plugin/ dist (byte-sync vs source, no unresolved markers, no orphans), and,
// optionally, an install target. Cross-platform. Exit 0 = PASS, 1 = FAIL.
//
// Usage:
//   node scripts/verify.mjs                 → verify the repo
//   node scripts/verify.mjs <agent|PATH>    → also verify skills landed at that target

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadShared, renderSkillMd, listSkills, SHARED_REFERENCES } from './lib/render.mjs';
import { TARGETS } from './lib/targets.mjs';
import { CONFIG_SCHEMA, validateValue } from './lib/config-schema.mjs';
import { stripJsonc } from './lib/jsonc.mjs';
import { REGION_TARGETS, extractRegion } from './lib/shared-regions.mjs';
import { checkTracked } from './lib/consistency.mjs';
import { checkDistChangelog } from './lib/dist-changelog.mjs';
import { checkConfigKeys, checkConfigReadPath } from './lib/config-keys.mjs';
import { checkPointers, pointerCandidates, looksPathShaped, DEFAULT_SURFACE_PLAN, collectSurfaces, applyCheckIgnoreProbe } from './lib/pointer-check.mjs';
import { verifyAgainstManifest } from './lib/manifest.mjs';
import { descriptionCapCheck, DESC_CAP } from './lib/desc-cap.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Leading-BOM strip for the new 1.6 block below, built from a char code rather than
// a hand-typed escape sequence (this file's other BOM strips elsewhere are untouched).
const BOM_RE = new RegExp('^' + String.fromCharCode(0xfeff));
let ok = true;
const pass = (m) => console.log('  ok   ' + m);
const fail = (m) => { ok = false; console.log('  FAIL ' + m); };

// 1. skills
const skillsSrc = path.join(repo, 'skills');
let skills = [];
try {
  skills = fs.existsSync(skillsSrc) ? listSkills(skillsSrc) : [];
} catch (e) {
  fail(`failed to list skills at ${skillsSrc}: ${e.message}`);
}
console.log(`skills (${skills.length} found):`);
for (const s of skills) {
  const md = path.join(skillsSrc, s, 'SKILL.md');
  if (!fs.existsSync(md)) { fail(`${s}: SKILL.md missing`); continue; }
  let src;
  try { src = fs.readFileSync(md, 'utf8'); }
  catch (e) { fail(`${s}: SKILL.md unreadable: ${e.message}`); continue; }

  // Extract YAML frontmatter (between the first two "---" delimiters)
  const parts = src.split('---');
  if (parts.length < 3 || src.trim().indexOf('---') !== 0) {
    fail(`${s}: no YAML frontmatter`);
  } else {
    const head = parts[1];
    if (!/\bname:\s*\S/.test(head)) fail(`${s}: frontmatter 'name:' missing`);
    else if (!/\bdescription:\s*\S/.test(head)) fail(`${s}: frontmatter 'description:' missing`);
    else if (!src.includes('<!-- SHARED:')) fail(`${s}: source lost its SHARED template markers (conformed in place? restore the template)`);
    // skill-authoring.md §5b CLASSIFY-BLOCK: 8 of 9 skills declare grants & denials;
    // source-grounding is the one named exclusion (read+network only, D1 already covers
    // the hot class — skills/_shared/README.md). A byte-compare alone (below, "plugin
    // dist") only checks the marker's CONTENT where present; this checks PRESENCE, closing
    // §5b's own fourth-tense gap ("no gate greps for the section") for the shared half.
    else if (s !== 'source-grounding' && !src.includes('<!-- SHARED:CLASSIFY_BLOCK -->')) fail(`${s}: missing <!-- SHARED:CLASSIFY_BLOCK --> (skill-authoring.md §5b — every skill but source-grounding declares grants & denials)`);
    else pass(`${s}`);
  }
}
if (skills.length !== 9) fail(`expected 9 skills, found ${skills.length}`);

// 1.5 description/when_to_use length cap (skill + command listings) — dynamic scan
// (skills/*/SKILL.md for any dir that has one, e.g. skips skills/_shared/) so a
// new skill/command is covered without editing this gate.
console.log('description length cap (skills + commands):');
const descTargets = [];
if (fs.existsSync(skillsSrc)) {
  for (const d of fs.readdirSync(skillsSrc, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const md = path.join(skillsSrc, d.name, 'SKILL.md');
    if (fs.existsSync(md)) descTargets.push([`skills/${d.name}/SKILL.md`, md, true]);
  }
}
const commandsDir = path.join(repo, 'commands');
if (fs.existsSync(commandsDir)) {
  for (const f of fs.readdirSync(commandsDir)) {
    if (f.endsWith('.md')) descTargets.push([`commands/${f}`, path.join(commandsDir, f), false]);
  }
}
for (const [label, p, isSkill] of descTargets) {
  try {
    const { len, over } = descriptionCapCheck(fs.readFileSync(p, 'utf8'));
    if (isSkill && len === 0) fail(`${label}: frontmatter description missing/unparsed`);
    else if (over) fail(`${label}: description+when_to_use ${len} chars exceeds the ${DESC_CAP}-char cap`);
    else pass(`${label}: ${len} chars (cap ${DESC_CAP})`);
  } catch (e) { fail(`${label} description check: ${e.message}`); }
}

// 1.6 .claude-plugin/plugin.json's OWN description field vs the same cap (board #64: this
// gate lived in 1.5 for skill/command FRONTMATTER only, so a plugin.json description could
// silently exceed 1024 — CoalLedger shipped one at 1067 before a human eye caught it).
// plugin.json is plain JSON, not YAML frontmatter, so it reads the field directly rather
// than through frontmatterField/descriptionCapCheck; the cap constant is the same import,
// never redefined.
{
  const pluginJsonPath = path.join(repo, '.claude-plugin', 'plugin.json');
  try {
    const pj = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8').replace(BOM_RE, ''));
    const len = typeof pj.description === 'string' ? pj.description.length : 0;
    if (!pj.description) fail('.claude-plugin/plugin.json: description missing');
    else if (len > DESC_CAP) fail(`.claude-plugin/plugin.json: description ${len} chars exceeds the ${DESC_CAP}-char cap`);
    else pass(`.claude-plugin/plugin.json: ${len} chars (cap ${DESC_CAP})`);
  } catch (e) { fail(`.claude-plugin/plugin.json description check: ${e.message}`); }
}

// 2. manifests (valid JSON)
console.log('manifests:');
for (const m of ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'hooks/hooks.json']) {
  const p = path.join(repo, m);
  if (!fs.existsSync(p)) { fail(`${m} missing`); continue; }
  try { JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); pass(m); } catch (e) { fail(`${m} invalid JSON: ${e.message}`); }
}

// 2.5 config (if present)
const configPath = path.join(repo, '.coalmine.json');
if (fs.existsSync(configPath)) {
  console.log('config (.coalmine.json):');
  try {
    const content = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
    const cleanJson = stripJsonc(content);
    const cfg = JSON.parse(cleanJson);
    // Keys and types come from one table — scripts/lib/config-schema.mjs —
    // shared with configure.mjs so the two can never drift apart.
    const validKeys = CONFIG_SCHEMA.map((s) => s.key);
    const invalidKeys = Object.keys(cfg).filter((k) => !validKeys.includes(k));
    if (invalidKeys.length > 0) {
      fail(`.coalmine.json has unrecognized keys: ${invalidKeys.join(', ')}`);
    } else {
      for (const spec of CONFIG_SCHEMA) {
        const v = cfg[spec.key];
        if (v === undefined) continue;
        const err = validateValue(spec, v);
        if (err) fail(`.coalmine.json ${spec.key} ${err}`);
      }
      if (ok) pass('.coalmine.json');
    }
  } catch (e) {
    fail(`.coalmine.json invalid JSON: ${e.message}`);
  }
}

// 2.7 self-consistency (tracked cross-document facts — must agree)
console.log('consistency:');
try {
  const findings = checkTracked(repo);
  if (findings.length === 0) pass('cross-document facts agree (counts + version pins)');
  else for (const f of findings) fail(f.msg);
} catch (e) { fail(`consistency check crashed: ${e.message}`); }

// 2.8 dist-vs-CHANGELOG (task #38): did the shipped dist change since the last version tag,
// and if so, does CHANGELOG.md document it? Keys on the DIST, never on "any file changed" —
// a doc-only commit must stay silent (scripts-quality.md section 3). Both named absences
// (no git repo, no tag reachable — e.g. a shallow CI checkout) degrade to a visible,
// non-blocking line, never a silent carve-out and never a false clean bill.
console.log('dist-changelog:');
try {
  const findings = checkDistChangelog(repo);
  if (findings.length === 0) pass('plugin/ dist matches the last tag, or the change is documented');
  else for (const f of findings) {
    if (f.level === 'SKIP') console.log('  --   ' + f.msg);
    else fail(f.msg);
  }
} catch (e) { fail(`dist-changelog check crashed: ${e.message}`); }

// 2.9 config-key drift (CWK-059): every config key NAMED on a user-facing surface must
// RESOLVE in config-schema.mjs, or be declared in PENDING_KEYS / NOT_CONFIG. Born from
// CWK-054's own MEDIUM -- six sites promising `scanEverything` while the key was measured
// unimplemented -- and three sibling-room instances the same night. Proven against that
// history, not a fixture: run over `693931b`'s own blobs it names the defect by key and file.
//
// SCOPE DERIVATION, stated rather than implied (AGENTS.md, THE MEASUREMENT'S OWN FOURTH
// TENSE): the surfaces are WALKED, never enumerated -- every skill dir under skills/ and
// every .js under hooks/ -- so a new skill or hook is covered the day it lands and no roster
// has to be kept complete. What the walk does NOT reach is stated in config-keys.mjs's own
// surface list, with the measurement behind each exclusion. Source only; the plugin/ twins
// are byte-identical by the parity check below, so scanning them would double every finding.
console.log('config keys:');
try {
  // NAME the intended surfaces; let the checker report what it could not read. A caller
  // that existsSync-filters first hides its own scope gap -- the exact silent narrowing
  // this gate exists to catch, committed by the gate's own wiring.
  // Derived from listSkills(), the repo's OWN answer to "what is a skill dir" -- a raw
  // readdir also returns skills/_shared/, which has no SKILL.md, and its permanent
  // unreadability would have SKIPPED the declaration-pruning rule forever. Caught by
  // running the gate and reading its own SKIP line rather than trusting the green.
  const skillMd = skills.map((d) => path.join('skills', d, 'SKILL.md'));
  skillMd.push('README.md');
  const hooksDir = path.join(repo, 'hooks');
  const hookJs = (fs.existsSync(hooksDir) ? fs.readdirSync(hooksDir) : [])
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join('hooks', f));
  const findings = checkConfigKeys({
    schemaKeys: CONFIG_SCHEMA.map((e) => e.key),
    mdFiles: skillMd,
    hookFiles: hookJs,
    read: (f) => fs.readFileSync(path.join(repo, f), 'utf8'),
    // The room's own key table: a first cell there is a key CLAIM regardless of shape, so
    // this is the one surface where a lowercase key is catchable. Region-bounded (measured:
    // unbounded it would fire on the Commands table's 2 slash-command rows; bounded, 8/8
    // rows are keys and the false-positive count is zero).
    keyTables: [{ file: 'README.md', heading: 'Configure' }],
  });
  const hard = findings.filter((f) => f.level !== 'SKIP');
  // The pass line is QUALIFIED when the gate has declared blind spots (INSPECT MEDIUM-1):
  // an unqualified "every config key ... resolves" is false while a declared key is being
  // read and discarded, and a gate whose success line overclaims is the same defect it exists
  // to catch. The SKIP below names which keys; this stops the headline asserting past them.
  const blindSkips = findings.filter((f) => f.level === 'SKIP' && f.msg.startsWith('blind to'));
  const scope = blindSkips.length ? 'every DETECTABLE config key' : 'every config key';
  if (hard.length === 0) pass(`${scope} named across ${skillMd.length} doc + ${hookJs.length} hook surfaces resolves in the schema`);
  for (const f of findings) {
    if (f.level === 'SKIP') console.log('  --   ' + f.msg);
    else fail(f.msg);
  }
} catch (e) { fail(`config-key check crashed: ${e.message}`); }

// 2.10 config READ PATH (CWK-064): a surface that names the config must name the GLOBAL tier
// too. The hook side is already machine-enforced by loadCfg's cascade; this covers the SECOND
// read path -- an agent following ship-text -- which had no machine at all. Skills are checked
// RENDERED because the rail lives in the shared escalation footer: checking raw source would
// red-flag all nine skills for correctly inheriting it. Commands get no shared partial and are
// checked raw.
console.log('config read path:');
try {
  const surfaces = [];
  let sharedForRead = null;
  try { sharedForRead = loadShared(path.join(skillsSrc, '_shared')); } catch {}
  for (const sk of skills) {
    try { surfaces.push({ label: `skills/${sk}/SKILL.md`, text: sharedForRead ? renderSkillMd(path.join(skillsSrc, sk), sharedForRead) : fs.readFileSync(path.join(skillsSrc, sk, 'SKILL.md'), 'utf8') }); }
    catch (e) { fail(`could not render skills/${sk}/SKILL.md: ${e.message}`); }
  }
  const cmdDir = path.join(repo, 'commands');
  for (const f of (fs.existsSync(cmdDir) ? fs.readdirSync(cmdDir) : []).filter((x) => x.endsWith('.md'))) {
    try { surfaces.push({ label: `commands/${f}`, text: fs.readFileSync(path.join(cmdDir, f), 'utf8') }); } catch {}
  }
  // platform-configs/*.template (INSPECT MEDIUM-1): a FOURTH surface class both sweeps missed
  // and the first cut of this gate was structurally blind to -- CoalLedger's own MED-1 shape
  // happening to us in the unit that cites it. These ship INTO other agents' config homes, so
  // a bare-read instruction here reaches an agent we never see. Walked, never enumerated.
  const pcDir = path.join(repo, 'platform-configs');
  for (const f of (fs.existsSync(pcDir) ? fs.readdirSync(pcDir) : []).filter((x) => x.endsWith('.template'))) {
    try { surfaces.push({ label: `platform-configs/${f}`, text: fs.readFileSync(path.join(pcDir, f), 'utf8') }); } catch {}
  }
  const findings = checkConfigReadPath({ surfaces });
  if (findings.length === 0) pass(`across ${surfaces.length} agent surfaces, every config mention is governed by a rail (universal, or the global tier on its own line)`);
  else for (const f of findings) fail(f.msg);
} catch (e) { fail(`config read-path check crashed: ${e.message}`); }

// 2.11 POINTER gate (CWK-075): ship-text names something that cannot be reached. The
// sibling of 2.9 — that one resolves a KEY against the schema, this one resolves a
// PATH against the tree, and the sharp case is a citation under a gitignored root,
// which from any other machine is indistinguishable from a file that never existed.
//
// SCOPE DERIVATION, stated so a clean run is never read as coverage of every surface:
//   WALKED (no roster to rot): skills/**/*.md · commands/*.md · agents/*.md ·
//     comments in scripts/**/*.mjs and hooks/**/*.js.
//   ROSTER, chosen by DECISION: the four SHIPPED root docs. AGENTS/CLAUDE/MEMORY are
//     gitignored and never ship; CHANGELOG is walked but HISTORY-ONLY (below).
//   HISTORY-ONLY: CHANGELOG.md. Published history is never fixed forward, so a path
//     that was correct when the entry was written is not a defect now — measured: 5 of
//     its 8 non-resolving citations are files since renamed or deleted (hooks/pre-commit.sh
//     -> .githooks/pre-commit at d1c917f). It IS checked for the gitignored-root case,
//     which was never correct on any day.
//   NOT WALKED: the DECLARED_OUT table below, each entry carrying its own reason. It is
//     DATA, not this comment -- a prose list restating it would be a second source of
//     truth that drifts, which is the defect this gate exists to catch. The union of the
//     walk and that table is CHECKED against every tracked file, so a surface belonging
//     to neither reddens the gate instead of going unread.
console.log('pointers:');
try {
  const lsAll = spawnSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' });
  if (lsAll.error || lsAll.status !== 0) {
    // A VISIBLE skip, never a silent carve-out: no git means no durability answer.
    console.log('  --   pointer check: git unavailable — cannot tell a tracked path from an untracked one; skipped');
  } else {
    const tracked = new Set(lsAll.stdout.split('\n').filter(Boolean));
    const trackedDirs = new Set();
    for (const f of tracked) {
      const parts = f.split('/');
      for (let i = 1; i < parts.length; i++) trackedDirs.add(parts.slice(0, i).join('/'));
    }
    // OUR ROOTS, derived from the tree, never enumerated: every tracked top-level entry,
    // plus every existing NON-HIDDEN top-level directory. The second half is what puts
    // gitignored-but-ours scratchpad/ in scope; a hidden dir counts only if it is TRACKED,
    // because .claude/ and .agents/ are the agent-home paths shipped prose names in the
    // USER's tree, not ours.
    const ourRoots = new Set();
    for (const f of tracked) ourRoots.add(f.split('/')[0]);
    for (const e of fs.readdirSync(repo, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.')) ourRoots.add(e.name);
    }
    // AGENT-HOME ROOTS, derived from the tool's own TARGETS map. Needed for the ignore
    // probe below, because a root can be BOTH gitignored in our tree and a legitimate
    // USER-tree path in ship-text -- `.claude/` and `.agents/` are exactly that, and the
    // whole `agentHomes` collision fix from CWK-075 r2 depends on them staying out of
    // scope. Feeding them to check-ignore would FAIL ten correct ship-text citations
    // (measured: gold-standard/SKILL.md, both commands, README, CONTRIBUTING).
    const agentHomeRoots = new Set();
    for (const t of Object.values(TARGETS)) {
      const r = path.relative(repo, t).split(path.sep).join('/');
      if (r && !r.startsWith('..') && !path.isAbsolute(r)) agentHomeRoots.add(r.split('/')[0]);
    }
    const walkMd = (dir, out = []) => {
      if (!fs.existsSync(dir)) return out;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walkMd(p, out);
        else if (e.name.endsWith('.md')) out.push(p);
      }
      return out;
    };
    const walkSrc = (dir, keep = (n) => /\.(mjs|js)$/.test(n), out = []) => {
      if (!fs.existsSync(dir)) return out;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walkSrc(p, keep, out);
        else if (keep(e.name)) out.push(p);
      }
      return out;
    };
    const rel = (p) => path.relative(repo, p).split(path.sep).join('/');
    // DECLARED OUT, as DATA rather than a comment nobody can check (CWK-078 LOW-1). The
    // CoalWash defect is a tracked file in NEITHER the walked nor the not-walked list:
    // the pass line then reads as coverage while a surface goes unread. Measured here
    // before the fix: 199 tracked = 76 walked + 95 declared out + 28 in NEITHER.
    // Each entry carries WHY, because an allowlist of bare prefixes is a bypass with no
    // author -- the same standard PENDING_POINTERS is held to.
    const DECLARED_OUT = [
      ['.github/workflows/', 'CI machinery; its comments cite upstream trees, not ours'],
      ['alt/', 'the PowerShell fallback mirrors hooks/ and is checked at its source'],
      ['evals/', 'eval fixtures are deliberately broken code, not ship-text'],
      ['platform-configs/', 'templates that ship INTO a user tree; their paths are the USER\'s'],
      ['plugin/', 'generated from skills/ -- a finding here duplicates its source'],
      ['.gitattributes', 'a pattern file; no prose'],
      ['.gitignore', 'a pattern file; no prose'],
      ['.markdownlint.json', 'JSON carries no comments'],
      ['.claude-plugin/', 'JSON manifests; no comments, and their paths are gate-checked elsewhere'],
      ['.github/FUNDING.yml', 'GitHub config, no prose'],
      ['.github/dependabot.yml', 'GitHub config, no prose'],
      ['LICENSE', 'legal text, not ours to edit'],
      ['NOTICE', 'legal text, not ours to edit'],
      ['hooks/hooks.json', 'JSON carries no comments'],
      ['hooks/settings.snippet.json', 'JSON carries no comments'],
      ['skill-meta.json', 'three intent strings per skill; JSON, no comments'],
    ];
    const declaredOut = (f) => DECLARED_OUT.some(([pre]) => f.startsWith(pre) || f.endsWith('/' + pre));
    const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
    // SURFACE PLAN, DECLARED (CWK-090 fix 3) -- what this block used to hard-code as five
    // separate for-loops is now DATA (`DEFAULT_SURFACE_PLAN`, pointer-check.mjs), driven
    // here with THIS room's own fs IO. CoalHearth's finding: "scripts/ comments are a
    // walked surface" is THIS room's variable, not the flock's (its own ship-text returns
    // eight surfaces, none under scripts/) -- a room that narrows the plan deletes a row
    // and states the reason in that row's own `why`, never by editing this driver.
    // Behaviour is BYTE-IDENTICAL to the five loops it replaces: same surfaces, same
    // order, same labels, same comment-line filters -- proven by the wiring test in
    // render.test.mjs, not merely asserted here.
    const commentLines = (src) => src.split('\n').filter((l) => /^\s*(\/\/|\*)/.test(l)).join('\n');
    const hashComments = (src) => src.split('\n').filter((l) => /^\s*#/.test(l)).join('\n');
    const surfaces = collectSurfaces(repo, DEFAULT_SURFACE_PLAN, {
      join: path.join, walkMd, walkSrc, read, rel, commentLines, hashComments,
    });

    // AGENT INSTALL HOMES, derived from the tool's OWN TARGETS map rather than enumerated:
    // a path this tool WRITES INTO A USER's tree is that user's, never ours, even where the
    // root collides with one of ours. `.github/skills` (Copilot) vs `.github/workflows`
    // (ours) is the live collision -- same root, opposite owner, and nothing in the token
    // says which. Only the project-relative targets qualify; a home-anchored one
    // (Claude's ~/.claude/skills) is already excluded by the OUTSIDE test upstream.
    const agentHomes = new Set();
    for (const t of Object.values(TARGETS)) {
      const r = path.relative(repo, t).split(path.sep).join('/');
      if (r && !r.startsWith('..') && !path.isAbsolute(r)) agentHomes.add(r);
    }
    // agentHomeRoots (above) is the ROOT of each of these; both are derived from the same
    // map so a vendor path change moves both at once.
    // EXHAUSTIVE BY CONSTRUCTION, not by luck: every tracked file is walked or declared
    // out, and the residue is FAILED rather than trusted to stay empty. A new tracked
    // file that fits neither list reddens this gate instead of quietly going unread.
    const walkedSet = new Set(surfaces.map((x) => x.label));
    const residue = [...tracked].filter((f) => !walkedSet.has(f) && !declaredOut(f));
    if (residue.length) {
      fail(`surface accounting: ${residue.length} tracked file(s) in NEITHER the walked nor the declared-out list — ${residue.slice(0, 5).join(', ')}${residue.length > 5 ? `, +${residue.length - 5} more` : ''}`);
    } else {
      const walkedTracked = [...walkedSet].filter((f) => tracked.has(f)).length;
      pass(`surface accounting: ${walkedTracked} walked + ${tracked.size - walkedTracked} declared out = ${tracked.size} tracked, residue 0`);
    }

    // IGNORED ROOTS, PATTERN-BASED (CWK-079) — asked of the CANDIDATES actually cited,
    // never of what exists on disk. A clean clone carries no gitignored files by
    // definition, so a disk-derived probe (`readdirSync(repo)`) ran at ZERO on every
    // clean clone and every CI leg (measured elsewhere: CoalBoard 28 fed/7 ignored on a
    // maintainer box against 21/0 in CI). `.gitignore` is TRACKED, so `git check-ignore`
    // answers for an ABSENT path exactly as it would for a present one — the pattern is
    // what matters, not the directory listing. Live exhibit on this tree: `.gitignore`
    // lists a claude.ai ZIP-packaging staging dir that does not exist here (see
    // scripts/build-claude-ai-zips.mjs), so the old readdirSync-based probe could never
    // see it; check-ignore answers for it regardless. Deliberately not backticked here —
    // this comment is itself a WALKED surface, and citing the literal name would
    // manufacture the exact finding it is describing.
    //
    // MUST run AFTER `surfaces` exists and `pointerCandidates` has run over them — the
    // candidates this probe needs are not assembled until here.
    //
    // TRAILING SLASH, half structural, half a shape choice -- CORRECTED (CWK-079
    // findings-back MEDIUM-1). The no-`/` drop in `pointerCandidates` (pointer-check.mjs
    // :209) proves a candidate token CONTAINS a slash; it proves NOTHING about what the
    // slash separates. Appending something and feeding it to check-ignore is only sound
    // for a candidate that IS a path in the first place -- `looksPathShaped()`
    // (pointer-check.mjs) decides that, below, before a first segment ever reaches
    // `candidateRoots`. The half that stays true and measured: git cannot infer that an
    // ABSENT path is a directory (measured on the claude.ai staging-dir name: queried
    // bare it reads not-ignored; queried as a directory reference, IGNORED), so a bare
    // root name is never the right feed for a query that means "is this directory
    // ignored" -- something must be appended.
    //
    // WHAT is appended CHANGED (CWK-090 fix 2, CoalFace's finding, its cure `bc4793c`
    // main's ruling, box-independent): a bare `first + '/'` false-matches a NONEXISTENT
    // root under a CRLF `.gitignore` with core.autocrlf=true (measured by CoalFace, 26
    // bogus FAILs across 8 roots on first wiring -- not reproduced on THIS box/git
    // version, and the non-reproduction is stated rather than hidden, see the test).
    // Feeding `first + '/.pointer-check-probe'` -- a path UNDER the root -- carries the
    // identical "is this a directory" information without ever matching the bare-root
    // CRLF shape. Each returned line has that fixed suffix stripped to recover the root.
    //
    // BATCHED, one process for every distinct first segment actually cited, not one per
    // candidate — the per-name spawn loop this replaces cost 462.2ms across 7 calls on
    // this tree (39% of the gate's own 1178ms wall time); one `--stdin` call measured
    // 71.3ms.
    //
    // NAMED BOUND, WIDENED (CWK-079 findings-back MEDIUM-1) -- covers TWO populations,
    // and closing one is not closing the other. Deliberately NOT backticking the two
    // real gitignored exhibit names anywhere in this comment (the claude.ai staging dir,
    // and the arithmetic ratio the reviewer used) -- this comment is itself a WALKED
    // surface, and a backticked mention of either would manufacture the exact citation
    // it is describing, exactly as happened once already this unit.
    //
    // (1) FOREIGN-NAME COLLISION, still open, still measured zero. A citation describing
    // the SCANNED USER's own tree (e.g. a doc line naming the user's `dist/build.js`)
    // still probes `dist` against OUR .gitignore, and if a future pattern of ours (or a
    // sibling room's, once this ships there per the PORT) happens to share that name, the
    // citation FAILs as "not reachable from a clone" although it was never ours to be
    // wrong about. Reproduced on a scratch fixture: a `.gitignore` containing `dist/` plus
    // a doc line reading "the scanned project ships its build to `dist/build.js`" FAILs
    // that way, though `dist/` does not exist in that fixture's tree and is cited nowhere
    // as ours. Measured population on THIS tree today: ZERO. The miss is LOUD BY DESIGN,
    // not by luck: a wrong FAIL names the file and the token, so it gets investigated
    // within the hour, unlike a dead citation silently falling out of scope -- the same
    // trade CWK-078 already made in this direction. This population is NOT narrowed --
    // any existence- or ourRoots-based test would re-open the exact vacuity this ticket
    // was built to close (it would specifically re-exclude the claude.ai staging dir
    // above, absent, untracked, and not in ourRoots -- the case that motivated CWK-079).
    //
    // (2) NOT-A-PATH-AT-ALL, was FALSE-STATED, now NARROWED at DISCOVERY by
    // `looksPathShaped()` -- discovery, not judgement; see that function's own comment
    // (pointer-check.mjs) for the non-local property this bound must not be read past.
    // The prior wording here claimed "every candidate's first segment IS a directory by
    // construction" -- that was wrong, and the reviewer proved it: 36 of a 51-segment
    // measured population were not a directory OR a file in any namespace -- a
    // backticked ratio like N-over-4 (arithmetic), `prefer/should` (two rule-force
    // words), `try/finally` (a language construct), `js/insecure-temporary-file` (a
    // CodeQL query id), `log/slog` (a Go package pair). REPRODUCED LIVE: appending the
    // ratio's own first segment plus a slash to `.gitignore` FAILed the shipped gate on
    // the CHANGELOG's citation of that ratio, with the remedy "commit the file" --
    // incoherent for arithmetic. UNLIKE population (1), this one IS narrowed at
    // discovery, by TOKEN SHAPE never existence -- `looksPathShaped()`'s own comment
    // carries its residue in both directions (a function-call token like
    // `os.tmpdir()/` still gets through; an extensionless real path like `scripts/lib`
    // is no longer a source of its OWN root, but is still checked the moment some
    // OTHER, unrelated, path-shaped citation shares that root -- non-local, proven
    // live with a two-plant pair, `pointer-check.test.mjs`). That narrowing does not
    // touch population (1): the claude.ai staging dir's own filename exhibit and the
    // `dist/build.js` exhibit above both carry a `.ext`-shaped last segment and still
    // reach the probe.
    //
    // EXPOSURE, not population -- "measured ZERO" above is zero BY CONSTRUCTION on a
    // green tree (nothing ordinary is in .gitignore today, so nothing collides); it says
    // nothing about how close this tree sits to the class firing. Measured instead by
    // appending one ordinary directory-name line to `.gitignore` (deliberately not
    // spelled out here as a literal -- appending it as a candidate to THIS comment
    // would itself widen what this comment discovers): THREE FAILs, TWO of them on
    // published `[x.y.z]` CHANGELOG history, and the exhibits are this room's OWN files
    // under abbreviated citations (a shorthand path missing its own scripts/ prefix),
    // not a foreign tree. `.gitignore` reverted immediately after the measurement,
    // byte-identical. Several other ordinary directory names commonly seen in a
    // `.gitignore` are cited first segments on this tree today the same way.
    //
    // SELF-REFERENCE, LOAD-BEARING: this comment block and `looksPathShaped()`'s own
    // (pointer-check.mjs) both cite real tracked paths (e.g. `.githooks/pre-commit`)
    // that resolve through the ORDINARY scope test above, not through this ignore
    // probe -- moving the resolve-check's own in-scope count upward each time either
    // comment gains a new real citation (71 before this population existed, still
    // climbing across the two findings-back rounds that documented it; re-derive from
    // the gate's own pass line below, never quote a number forward from here).
    // Harmless today (every one resolves tracked), but it means a later reword of
    // EITHER comment can redden the resolve gate on itself. Named so that FAIL is
    // recognised, not chased as a regression in unrelated code.
    const candidateRoots = new Set();
    for (const s of surfaces) {
      if (typeof s.text !== 'string') continue;
      for (const tok of pointerCandidates(s.text)) {
        if (!looksPathShaped(tok)) continue;
        candidateRoots.add(tok.split('/')[0]);
      }
    }
    // NOTE-1: `agentHomeRoots.size` is the DERIVED-SET size (every root TARGETS names),
    // not the number that actually held anything out of THIS run's candidates. Printing
    // the first while the sentence's other counts describe this run is the CoalHearth
    // 52-vs-51 shape, so both are printed and each means exactly one thing.
    let homesPresent = 0;
    const toProbe = [];
    for (const name of candidateRoots) {
      if (agentHomeRoots.has(name)) { homesPresent++; continue; }
      toProbe.push(name);
    }
    // PROBE SUFFIX (CWK-090 fix 2): a path UNDER the root, not the bare root -- see
    // the TRAILING SLASH comment above for why the bare-root feed is retired. Since
    // CWK-092 flow-back 3 this gate no longer declares or imports the literal --
    // `applyCheckIgnoreProbe`'s own `probeSuffix` parameter DEFAULTS to
    // pointer-check.mjs's exported `PROBE_SUFFIX`, so this call site cannot hold a
    // copy that drifts from what it actually probes with.
    //
    // FAIL-OPEN, CLOSED (CWK-090 fix 1, ported in substance from CoalTipple `3669fb5`
    // and CoalLedger `94e994f`); WIRING moved into `applyCheckIgnoreProbe`
    // (pointer-check.mjs, CWK-090 findings-back HIGH-1) so a unit test drives this
    // exact branch with an injected `runCheckIgnore`, not a duplicated copy -- the
    // classify-then-fail-or-record logic that used to sit here as an inline
    // `if (!verdict.ok)` is unit-tested directly there, never by mutating this call
    // site. Exit 0 and exit 1 both SUCCEED (1 = "none of the fed paths are ignored",
    // not an error); any OTHER status (128 included -- a bad pattern, an unreadable
    // `.gitignore`, a broken worktree) or a genuine spawn error means the run
    // answered NOTHING, and silently continuing with an empty `ignoredRoots` would
    // print a git-derived count over a run that derived no facts at all. The Set is
    // now RETURNED (CWK-092 flow-back 3) rather than mutated in place -- this call
    // site consumes it, it does not own it.
    const ignoredRoots = applyCheckIgnoreProbe({
      toProbe, fail,
      runCheckIgnore: (input) => spawnSync('git', ['check-ignore', '--stdin'], { cwd: repo, encoding: 'utf8', input }),
    });

    const findings = checkPointers({
      surfaces,
      ourRoots,
      ignoredRoots,
      agentHomes,
      // Structural, never circular: does the token's FIRST SEGMENT exist beside the citing
      // file? That is what puts `references/checks.md` in scope from its own skill dir
      // while leaving `log/slog` (a Go package named in canary prose) out.
      hasEntry: (relDir, name) => {
        try { return fs.existsSync(path.join(repo, relDir, name)); } catch { return false; }
      },
      resolve: (p) => (tracked.has(p) || trackedDirs.has(p) ? 'tracked'
        : fs.existsSync(path.join(repo, p)) ? 'untracked' : 'missing'),
    });
    const hard = findings.filter((f) => f.level !== 'SKIP');
    // NOTE-2: the pass line's own pointer is a PATH, not a bare filename -- a bare
    // `pointer-check.mjs` is exactly the shape step 5 of this gate's own funnel drops, so
    // the gate could not check the pointer inside its own stated bound. The path form is
    // checkable; this comment is what puts it IN scope, because the walk reads COMMENT
    // lines only and a template literal in code is not one -- see `scripts/lib/pointer-check.mjs`.
    // BOTH counts DERIVED, never typed, and printed on EVERY run -- green or red. CWK-078's
    // whole finding was a list that had quietly stopped covering what its own pass line
    // implied, so the probe's reach is stated rather than left discoverable only by a
    // reviewer who thinks to ask. A count that appeared only when the gate passes would be
    // that same shape again, and on a RED run the reach is MORE useful, not less.
    pass(`gitignored-root citations: ${candidateRoots.size} distinct first segment(s) shape-qualified and cited, ${toProbe.length} probed through one git check-ignore call (${homesPresent} of ${agentHomeRoots.size} agent-home roots held out) — ${ignoredRoots.size} gitignored`);
    if (hard.length === 0) pass(`every path this repo points at from ${surfaces.length} surfaces (${findings.checked} in-scope citations) resolves to a TRACKED file — sections and symbols are NOT checked, see scripts/lib/pointer-check.mjs`);
    for (const f of findings) {
      if (f.level === 'SKIP') console.log('  --   ' + f.msg);
      else fail(f.msg);
    }
  }
} catch (e) { fail(`pointer check crashed: ${e.message}`); }

// 3. hooks present
console.log('hooks:');
for (const h of ['hooks/rot-canary-touch.js', 'hooks/rot-canary-stop.js', 'hooks/coalmine-conductor.js']) {
  fs.existsSync(path.join(repo, h)) ? pass(h) : fail(`${h} missing`);
}

// 3.5 shared regions inside standalone hooks — must match their partial byte-for-byte
console.log('shared regions:');
for (const t of REGION_TARGETS) {
  try {
    const partial = fs.readFileSync(path.join(repo, t.partial), 'utf8');
    const cur = fs.readFileSync(path.join(repo, t.file), 'utf8');
    const got = extractRegion(cur, t.name, t.comment);
    const want = (partial.endsWith('\n') ? partial : partial + '\n').replace(/\r\n/g, '\n');
    if (got === null) fail(`${t.file}: shared region '${t.name}' markers missing`);
    else if (got.replace(/\r\n/g, '\n') !== want) fail(`${t.file}: shared region '${t.name}' DRIFTED from ${t.partial} — run: node scripts/build-plugin.mjs`);
    else pass(`${t.file} region '${t.name}' in sync`);
  } catch (e) {
    fail(`${t.file}: region check failed: ${e.message}`);
  }
}

// Basenames the build injects from skills/_shared/references/ into every skill's
// references/ — they have no per-skill source, so compareAux must not treat them
// as orphans; they are byte-checked against the shared source separately below.
const SHARED_REF_NAMES = new Set(SHARED_REFERENCES.map((r) => r.name));

// Aux files (references/, skill-meta.json) ship verbatim — byte-compare both
// directions so a hand-edited or orphaned dist file can never reach the marketplace.
function compareAux(srcDir, dstDir, label) {
  try {
    const srcEntries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const e of srcEntries) {
      if (e.name === 'SKILL.md') continue;
      const sp = path.join(srcDir, e.name);
      const dp = path.join(dstDir, e.name);
      if (e.isDirectory()) {
        if (!fs.existsSync(dp)) { fail(`${label}/${e.name}/ missing — run: node scripts/build-plugin.mjs`); continue; }
        compareAux(sp, dp, `${label}/${e.name}`);
      } else {
        try {
          if (!fs.existsSync(dp)) fail(`${label}/${e.name} missing — run: node scripts/build-plugin.mjs`);
          else if (fs.readFileSync(sp, 'utf8').replace(/\r\n/g, '\n') !== fs.readFileSync(dp, 'utf8').replace(/\r\n/g, '\n')) fail(`${label}/${e.name} STALE vs source — run: node scripts/build-plugin.mjs`);
        } catch (err) { fail(`${label}/${e.name} compare failed: ${err.message}`); }
      }
    }
  } catch (err) {
    fail(`${label} source directory read failed: ${err.message}`);
  }
  try {
    const dstEntries = fs.readdirSync(dstDir, { withFileTypes: true });
    for (const e of dstEntries) {
      if (e.name === 'SKILL.md') continue;
      // A shared reference (build-injected into references/) legitimately has no
      // per-skill source — checked against skills/_shared below, not here.
      if (SHARED_REF_NAMES.has(e.name) && !fs.existsSync(path.join(srcDir, e.name))) continue;
      if (!fs.existsSync(path.join(srcDir, e.name))) fail(`${label}/${e.name} has no source — run: node scripts/build-plugin.mjs`);
    }
  } catch (err) {
    fail(`${label} dist directory read failed: ${err.message}`);
  }
}

// Every skill's dist references/<shared> must match the single shared source
// byte-for-byte (the ×9 footer-carve guarantee: one source, identical at each).
function checkSharedReferences(skills, shared) {
  for (const r of SHARED_REFERENCES) {
    const want = (shared.sharedReferences?.[r.name] ?? '').replace(/\r\n/g, '\n');
    for (const s of skills) {
      const dp = path.join(pluginDir, 'skills', s, 'references', r.name);
      if (!fs.existsSync(dp)) { fail(`plugin/skills/${s}/references/${r.name} missing — run: node scripts/build-plugin.mjs`); continue; }
      try {
        if (fs.readFileSync(dp, 'utf8').replace(/\r\n/g, '\n') !== want) fail(`plugin/skills/${s}/references/${r.name} STALE vs skills/_shared/references/${r.name} — run: node scripts/build-plugin.mjs`);
        else pass(`plugin/skills/${s}/references/${r.name} in sync (shared)`);
      } catch (e) { fail(`plugin/skills/${s}/references/${r.name} compare failed: ${e.message}`); }
    }
  }
}

// 4. plugin dist (committed; served by the marketplace via plugins[].source = "./plugin")
console.log('plugin dist:');
const pluginDir = path.join(repo, 'plugin');
let shared = null;
try { shared = loadShared(path.join(skillsSrc, '_shared')); }
catch (e) { fail(`_shared load failed: ${e.message}`); }
if (!fs.existsSync(pluginDir)) {
  fail('plugin/ missing — run: node scripts/build-plugin.mjs');
} else if (shared) {
  for (const s of skills) {
    const distMd = path.join(pluginDir, 'skills', s, 'SKILL.md');
    if (!fs.existsSync(distMd)) { fail(`plugin/skills/${s} missing — run: node scripts/build-plugin.mjs`); continue; }
    let got;
    try { got = fs.readFileSync(distMd, 'utf8'); }
    catch (e) { fail(`plugin/skills/${s} unreadable: ${e.message}`); continue; }
    if (got.includes('<!-- SHARED:')) { fail(`plugin/skills/${s} contains unresolved template markers — run: node scripts/build-plugin.mjs`); continue; }
    let want;
    try { want = renderSkillMd(path.join(skillsSrc, s), shared); }
    catch (e) { fail(`plugin/skills/${s} render failed: ${e.message}`); continue; }
    if (got.replace(/\r\n/g, '\n') !== want.replace(/\r\n/g, '\n')) { fail(`plugin/skills/${s} STALE vs source — run: node scripts/build-plugin.mjs`); continue; }
    compareAux(path.join(skillsSrc, s), path.join(pluginDir, 'skills', s), `plugin/skills/${s}`);
    pass(`plugin/skills/${s} in sync`);
  }
  // Shared references (build-injected into every skill) must match the one source.
  checkSharedReferences(skills, shared);
  // Reverse check: nothing ships from the dist that has no source (orphan guard).
  try {
    const pluginEntries = fs.readdirSync(pluginDir, { withFileTypes: true });
    for (const e of pluginEntries) {
      if (e.isDirectory()) {
        if (!['skills', 'hooks', '.claude-plugin', 'agents', 'commands'].includes(e.name)) {
          fail(`plugin/${e.name} is an orphan directory — run: node scripts/build-plugin.mjs`);
        }
      } else {
        fail(`plugin/${e.name} is an orphan file — run: node scripts/build-plugin.mjs`);
      }
    }
  } catch (e) { fail(`plugin/ root check failed: ${e.message}`); }

  try {
    const skillsDistDir = path.join(pluginDir, 'skills');
    if (fs.existsSync(skillsDistDir)) {
      const distEntries = fs.readdirSync(skillsDistDir, { withFileTypes: true });
      for (const e of distEntries) {
        if (e.isDirectory()) {
          if (!skills.includes(e.name)) {
            fail(`plugin/skills/${e.name} has no source — run: node scripts/build-plugin.mjs`);
          }
        } else {
          fail(`plugin/skills/${e.name} is an orphan file — run: node scripts/build-plugin.mjs`);
        }
      }
    }
  } catch (e) { fail(`plugin/skills check failed: ${e.message}`); }

  try {
    const hooksDistDir = path.join(pluginDir, 'hooks');
    if (fs.existsSync(hooksDistDir)) {
      const distEntries = fs.readdirSync(hooksDistDir, { withFileTypes: true });
      for (const e of distEntries) {
        if (e.isDirectory()) {
          fail(`plugin/hooks/${e.name} is an orphan directory — run: node scripts/build-plugin.mjs`);
        } else if (!['hooks.json', 'rot-canary-touch.js', 'rot-canary-stop.js', 'coalmine-conductor.js'].includes(e.name)) {
          fail(`plugin/hooks/${e.name} is an orphan file — run: node scripts/build-plugin.mjs`);
        }
      }
    }
  } catch (e) { fail(`plugin/hooks check failed: ${e.message}`); }

  try {
    const manifestDistDir = path.join(pluginDir, '.claude-plugin');
    if (fs.existsSync(manifestDistDir)) {
      const distEntries = fs.readdirSync(manifestDistDir, { withFileTypes: true });
      for (const e of distEntries) {
        if (e.isDirectory()) {
          fail(`plugin/.claude-plugin/${e.name} is an orphan directory — run: node scripts/build-plugin.mjs`);
        } else if (e.name !== 'plugin.json') {
          fail(`plugin/.claude-plugin/${e.name} is an orphan file — run: node scripts/build-plugin.mjs`);
        }
      }
    }
  } catch (e) { fail(`plugin/.claude-plugin check failed: ${e.message}`); }
  // Bundled extras (agents/, commands/) ship verbatim — both-direction guarantee.
  for (const extra of ['agents', 'commands']) {
    const src = path.join(repo, extra);
    const dist = path.join(pluginDir, extra);
    if (fs.existsSync(src)) {
      if (!fs.existsSync(dist)) fail(`plugin/${extra} missing — run: node scripts/build-plugin.mjs`);
      else compareAux(src, dist, `plugin/${extra}`);
    } else if (fs.existsSync(dist)) {
      fail(`plugin/${extra} has no source — run: node scripts/build-plugin.mjs`);
    }
  }
  for (const f of ['hooks/hooks.json', 'hooks/rot-canary-touch.js', 'hooks/rot-canary-stop.js', 'hooks/coalmine-conductor.js', '.claude-plugin/plugin.json']) {
    const distFile = path.join(pluginDir, f);
    if (!fs.existsSync(distFile)) { fail(`plugin/${f} missing — run: node scripts/build-plugin.mjs`); continue; }
    try {
      if (fs.readFileSync(path.join(repo, f), 'utf8').replace(/\r\n/g, '\n') !== fs.readFileSync(distFile, 'utf8').replace(/\r\n/g, '\n')) {
        fail(`plugin/${f} STALE vs ${f} — run: node scripts/build-plugin.mjs`);
      } else pass(`plugin/${f} in sync`);
    } catch (e) { fail(`plugin/${f} compare failed: ${e.message}`); }
  }
  try {
    const mkt = JSON.parse(fs.readFileSync(path.join(repo, '.claude-plugin', 'marketplace.json'), 'utf8').replace(/^\uFEFF/, ''));
    const srcField = mkt.plugins?.[0]?.source;
    if (srcField === './plugin') pass('marketplace serves ./plugin (conformed dist)');
    else fail(`marketplace plugins[0].source is ${JSON.stringify(srcField)} — must be "./plugin" so installs get conformed skills`);
  } catch { /* manifest parse already checked above */ }
}

// 5. optional install target
const arg = process.argv[2];
if (arg) {
  const targetKey = arg.toLowerCase();
  const dest = TARGETS[targetKey] ?? path.resolve(arg);
  console.log(`target ${dest}:`);
  for (const s of skills) {
    const targetMd = path.join(dest, s, 'SKILL.md');
    if (!fs.existsSync(targetMd)) {
      fail(`${s} NOT at target`);
      continue;
    }
    let content;
    try { content = fs.readFileSync(targetMd, 'utf8'); }
    catch (e) { fail(`${s} at target unreadable: ${e.message}`); continue; }
    if (content.includes('<!-- SHARED:')) {
      fail(`${s} at target contains unresolved template markers!`);
    } else {
      pass(`${s} installed and conformed`);
    }
  }
  // SFC-lite: re-hash installed files vs the manifest baseline (post-install tamper).
  try {
    const { findings, checked } = verifyAgainstManifest(dest);
    for (const f of findings) {
      if (f.level === 'FAIL') fail(`integrity: ${f.msg}`);
      else console.log(`  --   integrity: ${f.msg}`);
    }
    if (checked > 0 && findings.every((f) => f.level !== 'FAIL')) pass(`installed integrity: ${checked} file(s) match manifest hashes`);
  } catch (e) { fail(`integrity check crashed: ${e.message}`); }
}

console.log(ok ? '\nVERIFY: PASS' : '\nVERIFY: FAIL');
// CWK-071: this is the last statement in the file, so `process.exitCode` alone
// halts nothing that would otherwise run -- there is nothing after it.
process.exitCode = ok ? 0 : 1;
