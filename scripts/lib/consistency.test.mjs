// Unit tests for the self-consistency + manifest-integrity layers.
// Zero-dep (node:test + built-ins), per scripts-quality.md section 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkCanaryCount, checkConductorCanaryCount, checkAgentCount, checkVersionPins, checkDoctrineMirrors, checkRuleStamps, resolveMirrorBase, checkAll } from './consistency.mjs';
import { hashInstalledTree, verifyAgainstManifest, MANIFEST_NAME } from './manifest.mjs';

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-consist-'));
  fs.mkdirSync(path.join(dir, 'skills', '_shared'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  // two real skills + the _shared dir (which listSkills must exclude)
  for (const s of ['alpha-canary', 'beta-canary']) {
    fs.mkdirSync(path.join(dir, 'skills', s), { recursive: true });
    fs.writeFileSync(path.join(dir, 'skills', s, 'SKILL.md'), `---\nname: ${s}\ndescription: x\n---\nbody\n`);
  }
  return dir;
}

test('canary count: passes when plugin.json matches skills/, fails on drift', () => {
  const dir = mkRepo();
  try {
    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ description: 'CoalMine — 2 quality-canary skills for agents' }));
    assert.deepEqual(checkCanaryCount(dir), [], 'matching count is clean');

    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ description: 'CoalMine — 5 quality-canary skills for agents' }));
    const drift = checkCanaryCount(dir);
    assert.equal(drift.length, 1);
    assert.match(drift[0].msg, /says 5 .* skills\/ has 2/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('conductor canary count: passes when hooks/coalmine-conductor.js matches skills/, fails on drift', () => {
  const dir = mkRepo();
  try {
    fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });
    const mkConductor = (n) => fs.writeFileSync(
      path.join(dir, 'hooks', 'coalmine-conductor.js'),
      `const CONDUCTOR_HEAD = [\n  '[CoalMine] ${n} quality canaries installed. Conduct them:',\n];\n`,
    );

    mkConductor(2); // mkRepo() ships 2 skills (alpha-canary, beta-canary)
    assert.deepEqual(checkConductorCanaryCount(dir), [], 'matching count is clean');

    mkConductor(9);
    const drift = checkConductorCanaryCount(dir);
    assert.equal(drift.length, 1);
    assert.match(drift[0].msg, /conductor hook says 9 .* skills\/ has 2/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('conductor canary count: missing string fails loud instead of silently passing', () => {
  const dir = mkRepo();
  try {
    fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'hooks', 'coalmine-conductor.js'), '// no canary-count string here\n');
    const f = checkConductorCanaryCount(dir);
    assert.equal(f.length, 1);
    assert.match(f[0].msg, /no "<N> quality canaries installed" string/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('agent count: README table rows must match targets.mjs, fails on drift', () => {
  const dir = mkRepo();
  try {
    fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
    const mkTargets = (names) => `import path from 'node:path';\nexport const TARGETS = {\n${names.map((n) => `  ${n}: path.join('x'),`).join('\n')}\n};\n`;
    const mkReadme = (names) => `# x\n\n## Universal Agent Support\n\n| AI Agent | Target Skills Folder | Shortcut | Tool |\n|---|---|---|---|\n${names.map((n) => `| **${n}** | \`.${n}/skills\` | cmd | tool |`).join('\n')}\n\ndone\n`;
    fs.writeFileSync(path.join(dir, 'scripts', 'lib', 'targets.mjs'), mkTargets(['alpha', 'beta', 'gamma']));

    fs.writeFileSync(path.join(dir, 'README.md'), mkReadme(['alpha', 'beta', 'gamma']));
    assert.deepEqual(checkAgentCount(dir), [], 'matching count is clean');

    fs.writeFileSync(path.join(dir, 'README.md'), mkReadme(['alpha', 'beta', 'gamma', 'delta']));
    const drift = checkAgentCount(dir);
    assert.equal(drift.length, 1);
    assert.match(drift[0].msg, /4 rows but targets\.mjs defines 3/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('version pins: a `version-pin:` line must match plugin.json; drift/missing fail, prose mention ignored', () => {
  const dir = mkRepo();
  try {
    fs.mkdirSync(path.join(dir, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '3.7.0', description: 'x' }));
    const tpl = path.join(dir, '.github', 'ISSUE_TEMPLATE', 'bug.yml');
    const mkTpl = (line) => fs.writeFileSync(tpl, `name: bug\nbody:\n  - type: input\n    attributes:\n      ${line}\n`);

    mkTpl('placeholder: "v3.7.0 on Windows"  # version-pin: tracks plugin.json');
    assert.deepEqual(checkVersionPins(dir), [], 'matching pin is clean');

    mkTpl('placeholder: "v3.6.0 on Windows"  # version-pin: tracks plugin.json');
    const drift = checkVersionPins(dir);
    assert.equal(drift.length, 1);
    assert.match(drift[0].msg, /pins v3\.6\.0 but plugin\.json is v3\.7\.0/);

    mkTpl('placeholder: "no version here"  # version-pin: tracks plugin.json');
    const nover = checkVersionPins(dir);
    assert.equal(nover.length, 1);
    assert.match(nover[0].msg, /no vX\.Y\.Z/);

    // a prose mention of the word `version-pin` (no colon) is NOT a pin
    mkTpl('description: "see the version-pin docs, e.g. v9.9.9 examples"');
    assert.deepEqual(checkVersionPins(dir), [], 'non-colon prose mention is ignored');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// This check rides checkTracked = the COMMIT GATE, so both directions matter equally:
// a repo with no issue templates is the COMMON case and must never start blocking
// commits, while a directory we could not READ is not a directory with no templates.
test('version pins: an UNENUMERABLE issue-template dir FAILs, an ABSENT one stays silent (this check rides the commit gate)', () => {
  const dir = mkRepo();
  const realReaddir = fs.readdirSync;
  const tplDir = path.join(dir, '.github', 'ISSUE_TEMPLATE');
  try {
    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '3.7.0', description: 'x' }));
    assert.deepEqual(checkVersionPins(dir), [], 'no .github/ISSUE_TEMPLATE at all is the legitimate absence — never block a commit on it');

    fs.mkdirSync(tplDir, { recursive: true });
    fs.writeFileSync(path.join(tplDir, 'bug.yml'),
      'name: bug\nbody:\n  - type: input\n    attributes:\n      placeholder: "v3.7.0"  # version-pin: tracks plugin.json\n');
    assert.deepEqual(checkVersionPins(dir), [], 'control: a matching pin is clean while the dir can be read');

    fs.readdirSync = (p, opts) => {
      if (path.basename(String(p)) === 'ISSUE_TEMPLATE') {
        const e = new Error('EACCES: permission denied, scandir'); e.code = 'EACCES'; throw e;
      }
      return realReaddir(p, opts);
    };
    const blind = checkVersionPins(dir);
    assert.equal(blind.length, 1, 'an unreadable template dir must not pass the pin gate over templates never opened');
    assert.match(blind[0].msg, /could not be enumerated/);
  } finally {
    fs.readdirSync = realReaddir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('doctrine mirrors: identical copies pass, a diverged copy fails', () => {
  const dir = mkRepo();
  try {
    const mk = (rel, body) => { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
    mk('.claude/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\n');
    mk('.agents/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\n');
    assert.deepEqual(checkDoctrineMirrors(dir), [], 'identical mirrors are clean');

    // tamper one mirror
    fs.writeFileSync(path.join(dir, '.agents/rules/ecc/domain/hooks-safety.md'), 'DOCTRINE\nPOISON\n');
    const f = checkDoctrineMirrors(dir);
    assert.equal(f.length, 1);
    assert.match(f[0].msg, /DIVERGED/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// board #125: the compare used to normalize CRLF->LF BEFORE comparing, so an EOL-only
// divergence was invisible BY CONSTRUCTION while AGENTS.md's two-way-mirror rule calls
// the trees "byte-identical" and names this function as its machine. Red-first proven:
// against the pre-fix module this test's [2] leg returned [] (the silent hole).
test('doctrine mirrors: an EOL-ONLY divergence FAILS (true byte-compare) and is classified apart from a content divergence', () => {
  const dir = mkRepo();
  try {
    const mk = (rel, body) => { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
    const CRLF = '# Rule\r\nline one\r\nline two\r\n';
    const LF = '# Rule\nline one\nline two\n';
    const twin = '.agents/rules/ecc/domain/hooks-safety.md';
    mk('.claude/rules/ecc/domain/hooks-safety.md', CRLF);
    mk(twin, CRLF);
    assert.deepEqual(checkDoctrineMirrors(dir), [], 'control: byte-identical mirrors stay silent');

    // [2] same text, different line endings — the case the old norm() swallowed.
    fs.writeFileSync(path.join(dir, twin), LF);
    const eol = checkDoctrineMirrors(dir);
    assert.equal(eol.length, 1, 'an EOL-only divergence must be VISIBLE, not normalized away');
    assert.match(eol[0].msg, /EOL-DIVERGED/);
    // The remedy must be the EOL one: normalizing line endings, never rewriting content.
    assert.match(eol[0].msg, /normalize both to CRLF/);

    // [3] a real content difference must NOT be mislabelled as an encoding problem —
    // the two findings prescribe opposite fixes, so the classification is load-bearing.
    fs.writeFileSync(path.join(dir, twin), '# Rule\r\nline one\r\nTAMPERED\r\n');
    const content = checkDoctrineMirrors(dir);
    assert.equal(content.length, 1);
    assert.doesNotMatch(content[0].msg, /EOL-DIVERGED/, 'a content divergence is not an EOL divergence');
    assert.match(content[0].msg, /DIVERGED —/);

    // [4] restoring byte-identity clears it — no sticky state.
    fs.writeFileSync(path.join(dir, twin), CRLF);
    assert.deepEqual(checkDoctrineMirrors(dir), [], 'restored byte-identity is clean again');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// INSPECT MEDIUM on 0261598: the EOL-vs-content discriminator must be LOSSLESS.
// `Buffer.toString('utf8')` maps every invalid byte sequence to U+FFFD, so two files
// that genuinely differ in bytes can decode to ONE identical string — which handed a
// real byte divergence the EOL remedy ("do NOT rewrite either file's content"), i.e.
// told the operator to look away from a possible tampering. Red-first proven: against
// the utf8-based discriminator this test's assertion reported EOL-DIVERGED.
test('doctrine mirrors: an invalid-UTF-8 byte divergence is NOT mislabelled as EOL-only (lossless discriminator)', () => {
  const dir = mkRepo();
  try {
    const rel = 'rules/ecc/domain/hooks-safety.md';
    const claude = path.join(dir, '.claude', rel);
    const agents = path.join(dir, '.agents', rel);
    for (const p of [claude, agents]) fs.mkdirSync(path.dirname(p), { recursive: true });

    // Two DIFFERENT byte strings that both decode to the same UTF-8 replacement text.
    // Identical line endings, so the only difference is a byte utf8 would have eaten.
    fs.writeFileSync(claude, Buffer.from([0x61, 0xC3, 0x28, 0x62, 0x0D, 0x0A]));
    fs.writeFileSync(agents, Buffer.from([0x61, 0xC0, 0x28, 0x62, 0x0D, 0x0A]));

    const f = checkDoctrineMirrors(dir);
    assert.equal(f.length, 1, 'a byte divergence must be reported');
    assert.doesNotMatch(f[0].msg, /EOL-DIVERGED/,
      'invalid-UTF-8 bytes must not collapse into "same text, different line endings" — that remedy tells the operator not to inspect content');
    assert.match(f[0].msg, /DIVERGED —/, 'it is a content/tamper divergence and must say so');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('doctrine mirrors: a MALFORMED rule home fails closed — only a genuinely ABSENT one gets the carve-out', () => {
  const dir = mkRepo();
  try {
    const mk = (rel, body) => { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
    mk('.claude/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\n');

    // The fail-OPEN hole this closes: a regular FILE where the counterpart TREE belongs
    // read as "absent", so the carve-out fired and the whole guard was bypassed in
    // silence while .claude genuinely held rules.
    fs.mkdirSync(path.join(dir, '.agents/rules'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agents/rules/ecc'), 'not a directory\n');
    const notdir = checkDoctrineMirrors(dir);
    assert.equal(notdir.length, 1, 'a file where the rule home belongs must be reported, not swallowed');
    assert.match(notdir[0].msg, /is NOT a directory/);

    // A PARENT that is a file is still a real absence. NOTE the errno differs by
    // platform — POSIX raises ENOTDIR, Windows raises ENOENT — so this leg exercises
    // the ENOTDIR arm of the classification only on the Unix CI runners while passing
    // here through the ENOENT arm. Both are the same verdict, which is why one
    // assertion covers both; the ENOTDIR arm is NOT dead code, it is just not
    // reachable on this volume.
    fs.rmSync(path.join(dir, '.agents/rules/ecc'));
    fs.rmSync(path.join(dir, '.agents/rules'), { recursive: true, force: true });
    fs.writeFileSync(path.join(dir, '.agents/rules'), 'parent is a file\n');
    assert.deepEqual(checkDoctrineMirrors(dir), [], 'ENOTDIR through a file parent = the home really is not there');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// SEPARATE test, deliberately: this leg cannot run on every volume, and folding it into
// the one above made t.skip mark the WHOLE test skipped — so the malformed-home
// assertions that DID run reported as "skipped" on Windows. One skippable leg must never
// hide a leg that ran.
test('doctrine mirrors: an UNINSPECTABLE rule home fails closed (Unix CI runners; skips where stat cannot be denied)', (t) => {
  const dir = mkRepo();
  const guarded = path.join(dir, '.agents/rules');
  try {
    const mk = (rel, body) => { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
    mk('.claude/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\n');
    mk('.agents/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\n');

    // chmod is a no-op on NTFS and needs Developer Mode for some ops, so the denial is
    // PROBED, never assumed from process.platform (a volume property, not a platform one).
    let denied = false;
    try {
      fs.chmodSync(guarded, 0o000);
      fs.statSync(path.join(dir, '.agents/rules/ecc'));
    } catch (e) {
      denied = e.code !== 'ENOENT' && e.code !== 'ENOTDIR';
    }
    if (!denied) {
      t.skip('this volume cannot deny stat (chmod no-op on NTFS / needs Developer Mode) — this leg runs on the Unix CI runners');
      return;
    }
    const unreadable = checkDoctrineMirrors(dir);
    assert.equal(unreadable.length, 1, 'an uninspectable rule home must fail closed, not read as absent');
    assert.match(unreadable[0].msg, /could not be inspected/);
  } finally {
    try { fs.chmodSync(guarded, 0o700); } catch { /* best effort, so cleanup can recurse */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The tri-state above hardened the stat PROBE. A guard rests on TWO capability checks
// — the probe AND the enumeration — and hardening one leaves the other: a swallowed
// readdir failure yields an empty tree, so two genuinely DIVERGED homes report
// agreement over zero files compared. POSIX `chmod 0100` is exactly that state (stat
// succeeds, readdir does not). Patching the `node:fs` default export reaches the
// module under test — one realm, one singleton object — so this leg runs on EVERY
// volume instead of only where permissions can be denied. No skippable leg here.
test('doctrine mirrors: an UNENUMERABLE rule home fails loud — a readdir failure is not an empty tree', () => {
  const dir = mkRepo();
  const realReaddir = fs.readdirSync;
  try {
    const mk = (rel, body) => { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
    mk('.claude/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\n');
    mk('.agents/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\nPOISON\n');
    assert.equal(checkDoctrineMirrors(dir).length, 1, 'control: the divergence is visible while the tree can be read');

    // Both roots still stat as directories; only the nested readdir fails, so the walk
    // is blinded MID-WALK and the recursion — not just the root — has to carry the guard.
    fs.readdirSync = (p, opts) => {
      if (path.basename(String(p)) === 'domain') {
        const e = new Error('EACCES: permission denied, scandir'); e.code = 'EACCES'; throw e;
      }
      return realReaddir(p, opts);
    };
    const blind = checkDoctrineMirrors(dir);
    assert.equal(blind.length, 2, 'each unenumerable rule home is reported — never a silent all-clear over zero files compared');
    for (const root of ['.claude/rules/ecc', '.agents/rules/ecc']) {
      assert.ok(blind.some((f) => f.msg.includes(root) && /could not be enumerated/.test(f.msg)), `${root} must be named as unenumerable`);
    }

    // ONE walker, BOTH callers: the stamp check consumed the same swallow.
    const stamps = checkRuleStamps(dir);
    assert.equal(stamps.length, 2, 'checkRuleStamps shares walkMd and must fail loud on the same blindness');
    assert.match(stamps[0].msg, /could not be enumerated/);
  } finally {
    fs.readdirSync = realReaddir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// SEPARATE test: creating a link is a volume capability, so this carries the one
// skippable leg and nothing else (t.skip marks the WHOLE test, not the leg).
test('doctrine mirrors: a DANGLING link at a rule home is MALFORMED, not absent (skips where the volume cannot make a link)', (t) => {
  const dir = mkRepo();
  try {
    const mk = (rel, body) => { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
    mk('.claude/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\n');
    fs.mkdirSync(path.join(dir, '.agents/rules'), { recursive: true });
    try {
      // 'junction' is the unprivileged Windows shim (a plain symlink needs Developer
      // Mode; measured EPERM here) and the type arg is ignored on POSIX. PROBED, never
      // keyed to process.platform — link permission is a volume property.
      fs.symlinkSync(path.join(dir, 'no-such-rule-home'), path.join(dir, '.agents/rules/ecc'), 'junction');
    } catch (e) {
      t.skip(`this volume cannot create a link (${e.code}) — this leg runs where one can`);
      return;
    }
    // statSync FOLLOWS the link and reports the missing target as ENOENT, which the
    // carve-out would read as "this clone does not keep that rule home" — while the
    // directory ENTRY is sitting right there. Only lstat separates no-home-here from
    // a broken one, and a broken one is malformed, never the carve-out.
    const f = checkDoctrineMirrors(dir);
    assert.equal(f.length, 1, 'a link that promises a rule home and delivers nothing must not inherit the ABSENT carve-out');
    assert.match(f[0].msg, /is NOT a directory/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('doctrine mirrors: ENUMERATED, not a pair list — a nested rule and a brand-new rule are both compared', () => {
  const dir = mkRepo();
  try {
    const mk = (rel, body) => { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
    // The live defect this replaced: the hard-coded list named 2 files, so common/,
    // node/, typescript/ and every root-level file went uncompared and drift read as clean.
    for (const rel of ['domain/hooks-safety.md', 'common/coding-style.md', 'node/runtime.md', 'index.md']) {
      mk(`.claude/rules/ecc/${rel}`, `RULE ${rel}\n`);
      mk(`.agents/rules/ecc/${rel}`, `RULE ${rel}\n`);
    }
    assert.deepEqual(checkDoctrineMirrors(dir), [], 'a fully mirrored tree is clean');

    // A rule added on the Claude side only — the shape of every future rule addition.
    mk('.claude/rules/ecc/typescript/testing.md', 'NEW RULE\n');
    const added = checkDoctrineMirrors(dir);
    assert.equal(added.length, 1, 'the newly-added rule must be compared without touching this check');
    assert.match(added[0].msg, /typescript\/testing\.md.*UNMIRRORED/);
    fs.rmSync(path.join(dir, '.claude/rules/ecc/typescript/testing.md'));

    // Nested content drift, in a directory the old pair list never named.
    fs.writeFileSync(path.join(dir, '.agents/rules/ecc/common/coding-style.md'), 'RULE common/coding-style.md\nPOISON\n');
    const drift = checkDoctrineMirrors(dir);
    assert.equal(drift.length, 1);
    assert.match(drift[0].msg, /common\/coding-style\.md.*DIVERGED/);
    fs.writeFileSync(path.join(dir, '.agents/rules/ecc/common/coding-style.md'), 'RULE common/coding-style.md\n');

  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Replaces the old assertion that RETIRED.md "mirrors like any other rule". That policy
// was RETIRED itself on 2026-07-27: `.claude/rules/**` is auto-loaded as a DIRECTORY, so
// a tombstone ledger inside the tree is paid for in every session forever and
// skill-authoring.md §6's whole point — retiring a dead rule costs nothing — collapsed.
// The ledger now lives OUTSIDE both trees as a single un-mirrored copy, and that LOCATION
// is the mechanism. Two legs, and the second is the sharper one: before this change a
// one-sided tombstone was reported as UNMIRRORED, whose remedy ("add it to the other
// tree") is now precisely the wrong move.
test('doctrine mirrors: a tombstone ledger INSIDE a rule tree FAILs — mirrored (silent before) or one-sided (wrong remedy before)', () => {
  const dir = mkRepo();
  try {
    const mk = (rel, body) => { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
    mk('.claude/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\n');
    mk('.agents/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\n');
    assert.deepEqual(checkDoctrineMirrors(dir), [], 'control: a tree with no tombstone is clean');

    // LEG 1 — the INVISIBLE regression: identical copies in both trees mirror perfectly,
    // so every content check agrees and the old gate said nothing at all.
    mk('.claude/rules/ecc/RETIRED.md', 'tombstone\n');
    mk('.agents/rules/ecc/RETIRED.md', 'tombstone\n');
    const both = checkDoctrineMirrors(dir);
    assert.equal(both.length, 1, 'a mirrored tombstone must be reported once, not pass because it agrees with itself');
    assert.match(both[0].msg, /must NOT live inside a rule tree/);
    for (const root of ['.claude/rules/ecc', '.agents/rules/ecc']) {
      assert.ok(both[0].msg.includes(root), `${root} must be named so the reader knows where to delete it`);
    }

    // LEG 2 — one-sided: the finding must be the tombstone verdict, NOT the mirror one.
    fs.rmSync(path.join(dir, '.agents/rules/ecc/RETIRED.md'));
    const oneSided = checkDoctrineMirrors(dir);
    assert.equal(oneSided.length, 1);
    assert.match(oneSided[0].msg, /must NOT live inside a rule tree/);
    assert.doesNotMatch(oneSided[0].msg, /UNMIRRORED/, 'never tell the reader to copy a tombstone into the other tree');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('doctrine mirrors: the two absences are DIFFERENT — whole tree absent is silent, tree present but incomplete FAILs', () => {
  const dir = mkRepo();
  try {
    const mk = (rel, body) => { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
    mk('.claude/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\n');
    mk('.claude/rules/ecc/common/testing.md', 'RULE\n');

    // (1) No .agents rule home at all — a clone that never installed it. SILENT.
    assert.deepEqual(checkDoctrineMirrors(dir), [], 'the whole counterpart tree being absent is the legitimate carve-out');

    // (2) The tree EXISTS but is missing a file — drift wearing the costume of (1). FAIL.
    mk('.agents/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\n');
    const partial = checkDoctrineMirrors(dir);
    assert.equal(partial.length, 1, 'a present-but-incomplete tree must not inherit the carve-out');
    assert.match(partial[0].msg, /common\/testing\.md.*MISSING from \.agents/);

    // (3) Reverse direction: a rule only the non-Claude agents can see is the same defect.
    mk('.agents/rules/ecc/common/testing.md', 'RULE\n');
    mk('.agents/rules/ecc/common/agents-only.md', 'RULE\n');
    const reverse = checkDoctrineMirrors(dir);
    assert.equal(reverse.length, 1);
    assert.match(reverse[0].msg, /agents-only\.md.*MISSING from \.claude/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// C1 (2026-07-31 umbrella governance audit): checkDoctrineMirrors(repo) is correct
// code, but CoalMine's OWN repo root carries neither rule tree — the real trees live
// one directory up, at the umbrella (`TheColliery/`, CoalMine's parent on the dev
// layout this repo ships from). Handed `repo` alone, the check took the legitimate
// "absent tree" carve-out on every single run and never once compared the umbrella's
// real files — 0 findings whether they agreed or diverged. resolveMirrorBase fixes
// this by widening to the parent ONLY when the repo itself does not carry a COMPLETE
// local pair (both trees) — see the M2 ruling above resolveMirrorBase's definition.
test('doctrine mirrors: C1 fix — the repo-rooted check is blind to a diverged PARENT tree; resolveMirrorBase catches it', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-c1-parent-'));
  const repo = path.join(parent, 'CoalMine');
  fs.mkdirSync(repo, { recursive: true });
  try {
    const mk = (base, rel, body) => { fs.mkdirSync(path.join(base, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), body); };

    // The umbrella tree lives at the PARENT of `repo`, not inside it. Plant a genuine
    // divergence there — a FIXTURE, never the live rule trees.
    mk(parent, '.claude/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\n');
    mk(parent, '.agents/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\nPOISON\n');

    // RED, reproducing the live bug: `repo` carries neither tree, so the unresolved
    // check takes the absent carve-out and reports clean — even though its parent
    // genuinely diverges one level up.
    assert.deepEqual(checkDoctrineMirrors(repo), [], 'repo-rooted check is blind to the parent — this IS the C1 vacuity, reproduced');

    // GREEN: resolveMirrorBase widens to the parent (repo has neither tree, the parent
    // has both) and the SAME comparison function now catches the drift.
    const base = resolveMirrorBase(repo);
    assert.equal(base, parent, 'resolveMirrorBase must widen to the parent when the repo itself carries neither tree');
    const found = checkDoctrineMirrors(base);
    assert.equal(found.length, 1, 'the fix must catch the divergence the old root missed');
    assert.match(found[0].msg, /DIVERGED/);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('doctrine mirrors: resolveMirrorBase prefers a repo-local tree over the parent — widen, never override', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-c1-local-'));
  const repo = path.join(parent, 'room');
  try {
    const mk = (base, rel, body) => { fs.mkdirSync(path.join(base, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), body); };
    // BOTH trees at repo (M2: a genuine local mirror adoption has both sides by
    // construction — that is what earns repo-local precedence, not one alone).
    mk(repo, '.claude/rules/ecc/x.md', 'LOCAL\n');
    mk(repo, '.agents/rules/ecc/x.md', 'LOCAL\n');
    // The parent ALSO happens to carry a tree — must never be preferred over the
    // repo's own (a room that mirrors org rules locally is checked against itself).
    mk(parent, '.claude/rules/ecc/x.md', 'DIFFERENT\n');
    assert.equal(resolveMirrorBase(repo), repo, 'a repo carrying BOTH its own trees is never overridden by an ancestor');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

// M2 (2026-07-31 INSPECT): a LONE stray tree at repo (e.g. a gitignored `mkdir` under
// `.claude/` — the phantom-slug class, hooks-safety.md §8) must NOT be trusted as "repo
// is authoritative" — that would suppress the parent-widen and silently re-create the
// exact C1 vacuity through an accidental path. Only BOTH trees present locally qualify.
test('doctrine mirrors: resolveMirrorBase — a LONE stray tree at repo does not suppress the parent-widen (M2)', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-m2-'));
  const repo = path.join(parent, 'CoalMine');
  try {
    const mk = (base, rel, body) => { fs.mkdirSync(path.join(base, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), body); };
    // repo carries ONLY .claude — no .agents counterpart. A stray, not an adoption.
    mk(repo, '.claude/rules/ecc/stray.md', 'STRAY\n');
    // The parent carries a genuine, FULLY mirrored (here: diverged) pair — the real
    // umbrella tree this fix exists to reach.
    mk(parent, '.claude/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\n');
    mk(parent, '.agents/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\nPOISON\n');

    assert.equal(resolveMirrorBase(repo), parent, 'a lone local tree must not pin the base to repo and hide the real umbrella pair');
    const found = checkDoctrineMirrors(resolveMirrorBase(repo));
    assert.equal(found.length, 1, 'the umbrella divergence must still be caught, not masked by the stray local tree');
    assert.match(found[0].msg, /DIVERGED/);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('doctrine mirrors: resolveMirrorBase stays at repo when neither repo nor parent carries a tree (a standalone clone)', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-c1-standalone-'));
  const repo = path.join(parent, 'CoalMine');
  fs.mkdirSync(repo, { recursive: true });
  try {
    assert.equal(resolveMirrorBase(repo), repo, 'no umbrella sibling — falls through to the honest absent carve-out, never a fabricated base');
    assert.deepEqual(checkDoctrineMirrors(resolveMirrorBase(repo)), [], 'genuinely nothing to compare stays silent');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

// H1 (2026-07-31 INSPECT, BLOCKING): the three tests above call resolveMirrorBase and
// checkDoctrineMirrors DIRECTLY — none of them proves the two are actually WIRED
// TOGETHER inside checkAll, the only real caller. Mutation-tested: reverting checkAll
// to `checkDoctrineMirrors(repo)` left the whole suite green (21/0) before this test
// existed — a composition-layer regression with no red anywhere. `.some()`, not a
// length check: other checks (canary count, version pins, ...) legitimately FAIL on a
// bare two-level fixture with no skills/plugin.json, so an exact findings.length would
// be wrong for reasons unrelated to the mirror wiring this test exists to prove.
// Also proves M1 in the same fixture: the DIVERGED finding must name the resolved base.
test('checkAll: wires resolveMirrorBase into checkDoctrineMirrors — a parent divergence surfaces through checkAll itself (H1), naming the base (M1)', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-h1-'));
  const repo = path.join(parent, 'CoalMine');
  fs.mkdirSync(repo, { recursive: true });
  try {
    const mk = (base, rel, body) => { fs.mkdirSync(path.join(base, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(base, rel), body); };
    mk(parent, '.claude/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\n');
    mk(parent, '.agents/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\nPOISON\n');

    const findings = checkAll(repo);
    const mirrorFail = findings.find((f) => /DIVERGED/.test(f.msg));
    assert.ok(mirrorFail, 'checkAll must surface the parent divergence — this is the composition layer H1 found unguarded');
    assert.ok(mirrorFail.msg.includes(parent), 'M1: a FAIL at the widened base must name it — the blocked reader needs it more than a PASS reader does');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

// L1 (2026-07-31 INSPECT): a symlink/junction AT the rule-home position used to be
// FOLLOWED by `statSync` and reported as a legitimate directory, so its target's `.md`
// files — anywhere on disk, not just under repo/parent — were read and reported as
// doctrine. `kind()` now lstats first and refuses ANY symlink at that exact path,
// dangling or live, the same way walkMd already refuses to follow one NESTED in the
// tree. Junction is the unprivileged Windows shim (a plain symlink needs Developer
// Mode); the type arg is ignored on POSIX — PROBED, never assumed from process.platform.
test('doctrine mirrors: a LIVE symlink at a rule home is refused, not followed to content outside repo/parent (L1)', (t) => {
  const dir = mkRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-l1-outside-'));
  try {
    const mk = (rel, body) => { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
    mk('.claude/rules/ecc/domain/hooks-safety.md', 'DOCTRINE\n');
    fs.mkdirSync(path.join(dir, '.agents/rules'), { recursive: true });
    // A REAL directory, outside both `dir` and its parent, with content that must
    // never be read as doctrine.
    fs.mkdirSync(path.join(outside, 'ecc'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'ecc', 'planted.md'), 'NOT DOCTRINE\n');
    try {
      fs.symlinkSync(path.join(outside, 'ecc'), path.join(dir, '.agents/rules/ecc'), 'junction');
    } catch (e) {
      t.skip(`this volume cannot create a link (${e.code}) — this leg runs where one can`);
      return;
    }
    const found = checkDoctrineMirrors(dir);
    assert.equal(found.length, 1, 'a live symlink at a rule home must be refused, not walked as a legitimate directory');
    assert.match(found[0].msg, /is NOT a directory/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('rule stamps: well-formed passes, malformed fails, unstamped ignored', () => {
  const dir = mkRepo();
  try {
    const mk = (rel, body) => { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
    mk('.claude/rules/ecc/domain/good.md', '# r\n<!-- coalmine: verified 2026-06-13 · exemplar x · revalidate 90d -->\n');
    mk('.claude/rules/ecc/domain/plain.md', '# just a rule, no stamp\n');
    assert.deepEqual(checkRuleStamps(dir), [], 'well-formed + unstamped are both clean');

    mk('.claude/rules/ecc/domain/bad.md', '# r\n<!-- coalmine: verified soon, revalidate whenever -->\n');
    const f = checkRuleStamps(dir);
    assert.equal(f.length, 1);
    assert.match(f[0].msg, /malformed coalmine stamp/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// gold-standard 2026-08-18/19, adjudication A14/F5: a malformed paths: glob doesn't
// error, it silently matches nothing forever — no signal anywhere. Same walk as the
// stamp check above (checkRuleStamps), same file, no second disk pass.
test('paths: glob shape — well-formed passes, an unclosed bracket expression FAILs naming the file and pattern', () => {
  const dir = mkRepo();
  try {
    const mk = (rel, body) => { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
    mk('.claude/rules/ecc/node/runtime.md', '---\npaths:\n  - "**/*.mjs"\n  - "**/*.cjs"\n---\n# r\n');
    assert.deepEqual(checkRuleStamps(dir), [], 'well-formed globs are clean');

    mk('.claude/rules/ecc/node/broken.md', '---\npaths:\n  - "**/*.[mjs"\n---\n# r\n');
    const f = checkRuleStamps(dir);
    assert.equal(f.length, 1);
    assert.match(f[0].msg, /broken\.md/);
    assert.match(f[0].msg, /malformed paths: glob/);
    assert.match(f[0].msg, /\*\*\/\*\.\[mjs/);
    assert.match(f[0].msg, /unclosed '\['/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('paths: glob shape — an unclosed brace FAILs, an empty pattern FAILs, an over-budget brace expansion FAILs', () => {
  const dir = mkRepo();
  try {
    const mk = (rel, body) => { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };

    mk('.claude/rules/ecc/a.md', '---\npaths:\n  - "**/*.{mjs,cjs"\n---\n# r\n');
    let f = checkRuleStamps(dir);
    assert.equal(f.length, 1);
    assert.match(f[0].msg, /unclosed '\{'/);
    fs.rmSync(path.join(dir, '.claude/rules/ecc/a.md'));

    mk('.claude/rules/ecc/a.md', '---\npaths:\n  - ""\n---\n# r\n');
    f = checkRuleStamps(dir);
    assert.equal(f.length, 1);
    assert.match(f[0].msg, /empty pattern/);
    fs.rmSync(path.join(dir, '.claude/rules/ecc/a.md'));

    // Nested (not sibling) braces multiply: {{a,b}a,{a,b}b} at N levels = 2^N
    // alternatives. 10 levels = 1024 > the 1000-alternative budget, in a short line.
    let bigBrace = 'x';
    for (let i = 0; i < 10; i++) bigBrace = `{${bigBrace}a,${bigBrace}b}`; // 2^10 = 1024 alternatives, nested
    mk('.claude/rules/ecc/a.md', `---\npaths:\n  - "${bigBrace}"\n---\n# r\n`);
    f = checkRuleStamps(dir);
    assert.equal(f.length, 1);
    assert.match(f[0].msg, /exceeds the 1000-alternative budget|brace nesting exceeds/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('paths: glob shape — SCOPE GUARD: a well-formed glob that matches no real file is NOT flagged (shape only, never "does it match")', () => {
  const dir = mkRepo();
  try {
    const mk = (rel, body) => { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
    mk('.claude/rules/ecc/nowhere.md', '---\npaths:\n  - "**/*.this-extension-matches-nothing-in-this-repo"\n---\n# r\n');
    assert.deepEqual(checkRuleStamps(dir), [], 'a syntactically valid glob is never judged on whether it matches anything');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// gold-standard INSPECT F5-1 (blocking MEDIUM, closed same round): the first budget
// check discarded a closed TOP-LEVEL group's count instead of accumulating it, so N
// SIBLING brace groups (which concatenate and multiply in real brace expansion)
// evaded the check entirely — measured live: 20 sibling {a,b} groups in a 100-char
// pattern compute 2^20 = 1,048,576 real alternatives and PASSED. This pins the exact
// finding as a permanent regression.
test('paths: glob shape — N SIBLING (not nested) brace groups accumulate and trip the budget, closing INSPECT F5-1', () => {
  const dir = mkRepo();
  try {
    const mk = (rel, body) => { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
    const siblings = '{a,b}'.repeat(20); // 2^20 = 1,048,576 real alternatives, 100 chars, all top-level siblings
    mk('.claude/rules/ecc/a.md', `---\npaths:\n  - "${siblings}"\n---\n# r\n`);
    const f = checkRuleStamps(dir);
    assert.equal(f.length, 1, 'sibling groups must accumulate into the budget check, not be discarded');
    assert.match(f[0].msg, /exceeds the 1000-alternative budget/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// gold-standard INSPECT F5-3 (LOW, closed same round): a backslash-escaped '[' is a
// literal bracket character, not a bracket-expression opener -- the original check
// had no escape handling and flagged this syntactically valid, matching glob as
// "unclosed '['". Pinned as a permanent regression.
test('paths: glob shape — a backslash-escaped literal "[" is not mistaken for an unclosed bracket expression, closing INSPECT F5-3', () => {
  const dir = mkRepo();
  try {
    const mk = (rel, body) => { fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
    // frontmatterListField does no YAML-escape interpretation -- whatever's between the
    // quotes in the file IS the pattern seen by the validator. One literal backslash
    // char followed by '[' is what "escaped" means to isEscaped, so the file must
    // contain exactly one backslash here (JS source '\\[' = one backslash + '[').
    mk('.claude/rules/ecc/a.md', '---\npaths:\n  - "**/foo\\[bar.md"\n---\n# r\n');
    assert.deepEqual(checkRuleStamps(dir), [], 'an escaped literal [ must not be read as a bracket-expression opener');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('manifest integrity: clean install verifies, post-install tamper is caught', () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-sfc-'));
  try {
    fs.mkdirSync(path.join(dest, 'alpha-canary'));
    const f = path.join(dest, 'alpha-canary', 'SKILL.md');
    fs.writeFileSync(f, 'original\n');
    const hashes = hashInstalledTree(dest, ['alpha-canary']);
    fs.writeFileSync(path.join(dest, MANIFEST_NAME), JSON.stringify({ version: '9.9.9', skills: ['alpha-canary'], hashes }));

    const clean = verifyAgainstManifest(dest);
    assert.equal(clean.ok, true);
    assert.equal(clean.checked, 1);

    fs.writeFileSync(f, 'TAMPERED\n');
    const dirty = verifyAgainstManifest(dest);
    assert.equal(dirty.ok, false);
    assert.ok(dirty.findings.some((x) => /TAMPERED/.test(x.msg)));

    fs.rmSync(f);
    const missing = verifyAgainstManifest(dest);
    assert.ok(missing.findings.some((x) => /MISSING/.test(x.msg)));
  } finally { fs.rmSync(dest, { recursive: true, force: true }); }
});

// TWO swallows, and the amplifier is that this walk WRITES its blindness into a
// persistent artifact: verifyAgainstManifest never walks the disk, it iterates only the
// recorded keys, so a file omitted at install sits permanently outside the integrity net
// and later tamper on it reports `ok` with no trace at either end. Every name reaching
// this walk was JUST written successfully (install.mjs pushes on success), so there is no
// legitimate-absence carve-out to preserve — any failure is a failure.
test('manifest integrity: a tree the walk cannot READ aborts the manifest — never one with a silent hole', () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-sfc-blind-'));
  const realReaddir = fs.readdirSync;
  const realReadFile = fs.readFileSync;
  try {
    fs.mkdirSync(path.join(dest, 'alpha-canary', 'references'), { recursive: true });
    const nested = path.join(dest, 'alpha-canary', 'references', 'method.md');
    fs.writeFileSync(path.join(dest, 'alpha-canary', 'SKILL.md'), 'top\n');
    fs.writeFileSync(nested, 'nested\n');
    assert.deepEqual(
      Object.keys(hashInstalledTree(dest, ['alpha-canary'])).sort(),
      ['alpha-canary/SKILL.md', 'alpha-canary/references/method.md'],
      'control: both files are recorded while the tree can be read',
    );

    // SWALLOW 1 — an unenumerable SUBDIRECTORY dropped the whole subtree from the manifest.
    fs.readdirSync = (p, opts) => {
      if (path.basename(String(p)) === 'references') {
        const e = new Error('EACCES: permission denied, scandir'); e.code = 'EACCES'; throw e;
      }
      return realReaddir(p, opts);
    };
    assert.throws(() => hashInstalledTree(dest, ['alpha-canary']), /EACCES/,
      'an unenumerable subtree must abort the manifest, not vanish from it');
    fs.readdirSync = realReaddir;

    // SWALLOW 2 — one unhashable FILE dropped just that file, same permanent effect.
    fs.readFileSync = (p, opts) => {
      if (String(p) === nested) {
        const e = new Error('EACCES: permission denied, open'); e.code = 'EACCES'; throw e;
      }
      return realReadFile(p, opts);
    };
    assert.throws(() => hashInstalledTree(dest, ['alpha-canary']), /EACCES/,
      'a file we just wrote but cannot hash must abort the manifest, not sit outside the integrity net');
  } finally {
    fs.readdirSync = realReaddir;
    fs.readFileSync = realReadFile;
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('manifest integrity: a manifest hash entry cannot escape the target dir', () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-sfc-esc-'));
  try {
    // POSIX `../` and absolute keys escape on every platform; the Windows-only
    // `..\` key (which slipped past the old `/`-split segment guard) is a real
    // traversal only where `\` is a separator — on POSIX it is a valid filename,
    // so it is asserted on win32 only.
    const evilKeys = ['../../etc/passwd', '/etc/passwd'];
    if (process.platform === 'win32') evilKeys.push('..\\..\\evil');
    for (const evil of evilKeys) {
      fs.writeFileSync(path.join(dest, MANIFEST_NAME), JSON.stringify({
        version: '9.9.9', skills: ['x'], hashes: { [evil]: 'deadbeef' },
      }));
      const r = verifyAgainstManifest(dest);
      assert.ok(r.findings.some((x) => /traversal/.test(x.msg)), `traversal entry ${JSON.stringify(evil)} must be rejected`);
      assert.equal(r.checked, 0, `escaping entry ${JSON.stringify(evil)} must never be hashed`);
    }
  } finally { fs.rmSync(dest, { recursive: true, force: true }); }
});
