// CoalMine conductor self-update tests — node:test built-in, zero dependencies.
// Run: node --test scripts/lib/conductor-update.test.mjs
//
// Spawns the real conductor (hooks/coalmine-conductor.js) with a sandboxed
// TEMP + HOME so the real ~/.claude update stamp can never affect the test, and
// a tmp/.git anchor so findGitRoot stays inside the sandbox (never walks up to
// the real repo's rules). Covers, per hooks-safety.md §7:
//   - exit 0 + sanctioned-output-only on every path
//   - each updateMode (ask/auto/remind/off) injects the right KIND 1 directive or nothing
//   - the persistent stamp throttles KIND 1: due fires + writes the stamp; not-due is silent
//   - the stamp is written on a fire, never written when off
//   - KIND 2 past-due gold-rule detection fires only on a genuinely past-due stamp

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONDUCTOR = path.join(repo, 'hooks', 'coalmine-conductor.js');
// LEGACY (pre-namespace-campaign) stamp location + the new one it migrated to
// (#39, owner-designated 2026-08-08). writeStamp() below still plants the
// LEGACY location — every test that pre-seeds a stamp then runs the real
// conductor is thereby also proving the read-new-fallback-old migration read,
// for free, without needing a dedicated fixture per test.
const OLD_STAMP_REL = path.join('.claude', '.coalmine-update-check');
const NEW_STAMP_REL = path.join('.claude', 'coal', 'coalmine', 'update-check');

function runConductor(tmp, input = '') {
  // TEMP/TMP/TMPDIR → sandbox tmp; USERPROFILE/HOME → sandbox tmp so os.homedir()
  // (and the update stamp under it) is fully isolated from the real machine.
  return spawnSync(process.execPath, [CONDUCTOR], {
    input,
    encoding: 'utf8',
    cwd: tmp,
    env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp, USERPROFILE: tmp, HOME: tmp },
  });
}

// Sandbox project: a tmp dir with a .git anchor so findGitRoot stops here.
function mkProject(cfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cond-'));
  fs.mkdirSync(path.join(dir, '.git'));
  if (cfg !== undefined) {
    fs.writeFileSync(path.join(dir, '.coalmine.json'), JSON.stringify(cfg), 'utf8');
  }
  return dir;
}

function isoDaysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
// Mirrors readUpdateStamp: new location first, LEGACY fallback — so an
// assertion made AFTER running the conductor sees wherever the real stamp
// actually landed (new, if this run fired; the pre-seeded legacy location
// unchanged, if it did not).
function readStamp(tmp) {
  for (const rel of [NEW_STAMP_REL, OLD_STAMP_REL]) {
    try { return fs.readFileSync(path.join(tmp, rel), 'utf8').trim(); } catch { /* try next */ }
  }
  return null;
}
// Plants a stamp at the LEGACY location — simulates a pre-namespace-campaign
// install, so every precondition set up this way exercises the fallback read.
function writeStamp(tmp, iso) {
  const dir = path.join(tmp, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.coalmine-update-check'), iso, 'utf8');
}

test('default (no config): KIND 1 ask directive fires when no stamp, and the stamp is written', () => {
  const tmp = mkProject(); // no .coalmine.json → updateMode defaults to ask
  try {
    assert.equal(readStamp(tmp), null, 'precondition: no stamp');
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '', 'no stderr (Phoenix #13)');
    assert.ok(r.stdout.includes('[CoalMine]'), 'base conductor still injects');
    assert.ok(r.stdout.includes('CoalMine self-update (ask'), 'ask directive present when due');
    assert.equal(readStamp(tmp), todayISO(), 'stamp written to today after firing');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('ask is throttled: a fresh stamp (today) suppresses the KIND 1 directive', () => {
  const tmp = mkProject({ updateMode: 'ask', updateCheckDays: 14 });
  try {
    writeStamp(tmp, todayISO());
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('[CoalMine]'), 'base conductor still injects');
    assert.ok(!r.stdout.includes('CoalMine self-update (ask'), 'not due → no KIND 1 directive');
    assert.equal(readStamp(tmp), todayISO(), 'stamp unchanged (not rewritten when not due)');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('ask is due again once updateCheckDays has elapsed (stamp older than the window)', () => {
  const tmp = mkProject({ updateMode: 'ask', updateCheckDays: 14 });
  try {
    writeStamp(tmp, isoDaysAgo(20)); // 20 >= 14 → due
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('CoalMine self-update (ask'), 'elapsed window → directive fires');
    assert.equal(readStamp(tmp), todayISO(), 'stamp refreshed to today');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('ask stays silent one day before the window closes (boundary: days < updateCheckDays)', () => {
  const tmp = mkProject({ updateMode: 'ask', updateCheckDays: 14 });
  try {
    writeStamp(tmp, isoDaysAgo(13)); // 13 < 14 → not due
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(!r.stdout.includes('CoalMine self-update (ask'), '13 days < 14 → not due');
    assert.equal(readStamp(tmp), isoDaysAgo(13), 'stamp untouched');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('auto mode (due): injects the standing-consent check directive and writes the stamp', () => {
  const tmp = mkProject({ updateMode: 'auto' });
  try {
    // board #112: an absent global now clamps a project-only 'auto' down to the
    // schema default ('ask') — write an explicit global 'auto' so this test still
    // reaches genuine auto mode without relying on the escalation hole that fix
    // closes (covered on its own by the safer-value-wins tests below).
    writeGlobal(tmp, { updateMode: 'auto' });
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('standing consent'), 'auto directive present');
    assert.ok(r.stdout.includes('/coalmine:update'), 'auto points at the update procedure');
    assert.equal(readStamp(tmp), todayISO(), 'stamp written');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('remind mode (due): injects the free reminder line and writes the stamp', () => {
  const tmp = mkProject({ updateMode: 'remind', updateCheckDays: 30 });
  try {
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('self-update reminder'), 'remind line present');
    assert.ok(r.stdout.includes('claude plugin update coalmine@coalmine'), 'remind names the manual command');
    assert.ok(r.stdout.includes('~30d'), 'remind interpolates updateCheckDays');
    assert.equal(readStamp(tmp), todayISO(), 'stamp written');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('off mode: no KIND 1 directive of any kind, and the stamp is never written', () => {
  const tmp = mkProject({ updateMode: 'off' });
  try {
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('[CoalMine]'), 'base conductor still injects');
    assert.ok(!r.stdout.includes('self-update'), 'no self-update directive in off mode');
    assert.equal(readStamp(tmp), null, 'off must not create the stamp');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('KIND 2: a past-due gold-rule stamp triggers the RE-VALIDATE nudge', () => {
  const tmp = mkProject({ updateMode: 'ask' });
  try {
    writeStamp(tmp, todayISO()); // suppress KIND 1 so we isolate KIND 2
    const rulesDir = path.join(tmp, '.claude', 'rules', 'ecc');
    fs.mkdirSync(rulesDir, { recursive: true });
    // verified 100 days ago, revalidate 30d → 100 > 30 → past due
    fs.writeFileSync(
      path.join(rulesDir, 'a.md'),
      `# rule\n<!-- coalmine: verified ${isoDaysAgo(100)} · exemplar X · revalidate 30d -->\n`,
      'utf8',
    );
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('past their revalidate date'), 'KIND 2 nudge fires on a past-due stamp');
    assert.ok(r.stdout.includes('1 gold-standard rule'), 'counts exactly one past-due rule');
    assert.ok(!r.stdout.includes('CoalMine self-update (ask'), 'KIND 1 stayed throttled');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('KIND 2: a current gold-rule stamp does NOT trigger the nudge', () => {
  const tmp = mkProject({ updateMode: 'ask' });
  try {
    writeStamp(tmp, todayISO());
    const rulesDir = path.join(tmp, '.agents', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    // verified 5 days ago, revalidate 90d → 5 < 90 → current
    fs.writeFileSync(
      path.join(rulesDir, 'b.md'),
      `# rule\n<!-- coalmine: verified ${isoDaysAgo(5)} · exemplar Y · revalidate 90d -->\n`,
      'utf8',
    );
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(!r.stdout.includes('past their revalidate date'), 'a current stamp must not nudge');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('KIND 2 reads AGENTS.md (a file root, not a dir) and respects the stamp Nd', () => {
  const tmp = mkProject({ updateMode: 'ask' });
  try {
    writeStamp(tmp, todayISO());
    // verified 45 days ago, revalidate 30d → 45 > 30 → past due, in AGENTS.md at root
    fs.writeFileSync(
      path.join(tmp, 'AGENTS.md'),
      `# agents\n<!-- coalmine: verified ${isoDaysAgo(45)} · exemplar Z · revalidate 30d -->\n`,
      'utf8',
    );
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('past their revalidate date'), 'AGENTS.md past-due stamp is detected');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('off mode suppresses KIND 2 as well (updateMode !== off gate)', () => {
  const tmp = mkProject({ updateMode: 'off' });
  try {
    const rulesDir = path.join(tmp, '.claude', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(
      path.join(rulesDir, 'a.md'),
      `<!-- coalmine: verified ${isoDaysAgo(100)} · exemplar X · revalidate 30d -->\n`,
      'utf8',
    );
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(!r.stdout.includes('past their revalidate date'), 'off must suppress the KIND 2 nudge too');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('enableConductor:false silences everything, including self-update directives', () => {
  const tmp = mkProject({ enableConductor: false, updateMode: 'auto' });
  try {
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'disabled conductor emits nothing at all');
    assert.equal(readStamp(tmp), null, 'no stamp when the conductor short-circuits');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('out-of-bound updateCheckDays:99999 is rejected → falls back to the 14d window (no never-due lockout)', () => {
  // Board #5: the old guard (typeof number && >= 1) accepted 99999 verbatim, opening a
  // 99999-day window — once the stamp is written it would never be due again. The fixed
  // guard (Number.isInteger && >=1 && <=365) rejects it → default 14 → a 20-day-old stamp
  // is due. If 99999 were still honored verbatim, 20 < 99999 → no directive.
  const tmp = mkProject({ updateMode: 'ask', updateCheckDays: 99999 });
  try {
    writeStamp(tmp, isoDaysAgo(20));
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('CoalMine self-update (ask'), '99999 rejected → 14d default → 20d-old stamp is due');
    assert.equal(readStamp(tmp), todayISO(), 'stamp refreshed to today');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('non-integer updateCheckDays:1.5 is rejected → falls back to the 14d window (not used verbatim)', () => {
  // Board #5: the old guard accepted 1.5 (a float) verbatim. The fixed guard requires
  // Number.isInteger → 1.5 rejected → default 14 → a 13-day-old stamp is NOT yet due.
  // If 1.5 were honored verbatim, 13 >= 1.5 → it would fire — so silence proves rejection.
  const tmp = mkProject({ updateMode: 'ask', updateCheckDays: 1.5 });
  try {
    writeStamp(tmp, isoDaysAgo(13));
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(!r.stdout.includes('CoalMine self-update (ask'), '1.5 rejected → 14d default → 13d < 14 → not due');
    assert.equal(readStamp(tmp), isoDaysAgo(13), 'stamp untouched (not due)');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('out-of-bound updateCheckDays:0 is rejected → falls back to the 14d window', () => {
  // Board #5/#3 root: 0 must not be used verbatim (a 0-day window re-nudges every session).
  // The lower-bound guard already rejected 0; this pins that the fixed guard still does.
  // A 20-day-old stamp is due under the 14d default; a 0-day window would also fire here,
  // so we additionally pin that a fresh (today) stamp stays SILENT — impossible if 0 were
  // honored (0-day window → now-last < 0 never true → always due).
  const tmp = mkProject({ updateMode: 'ask', updateCheckDays: 0 });
  try {
    writeStamp(tmp, todayISO());
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(!r.stdout.includes('CoalMine self-update (ask'), '0 rejected → 14d default → fresh stamp is not due');
    assert.equal(readStamp(tmp), todayISO(), 'stamp untouched (not due)');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('a corrupt stamp self-heals (treated as due) and is overwritten with a valid date', () => {
  const tmp = mkProject({ updateMode: 'ask' });
  try {
    writeStamp(tmp, 'not-a-date');
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('CoalMine self-update (ask'), 'unparseable stamp → due');
    assert.equal(readStamp(tmp), todayISO(), 'corrupt stamp overwritten with today');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// --- Namespace campaign (#39, owner-designated 2026-08-08): update-check stamp
// migration to ~/.claude/coal/coalmine/update-check, read-new-fallback-old /
// write-new-drop-old, mirroring CoalWash's caliper.mjs (updateStampPath) ---
test('namespace migration: a LEGACY-only stamp is read via fallback, and firing relocates it to coal/coalmine/ + deletes the old root stamp', () => {
  const tmp = mkProject({ updateMode: 'ask', updateCheckDays: 14 });
  try {
    writeStamp(tmp, isoDaysAgo(20)); // legacy location only, elapsed window
    assert.ok(fs.existsSync(path.join(tmp, OLD_STAMP_REL)), 'precondition: legacy stamp exists');
    assert.ok(!fs.existsSync(path.join(tmp, NEW_STAMP_REL)), 'precondition: no new-location stamp yet');

    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('CoalMine self-update (ask'), 'the fallback-read stamp was seen as due');

    assert.ok(fs.existsSync(path.join(tmp, NEW_STAMP_REL)), 'write relocated the stamp to coal/coalmine/');
    assert.equal(fs.readFileSync(path.join(tmp, NEW_STAMP_REL), 'utf8').trim(), todayISO(), 'new-location stamp holds today');
    assert.ok(!fs.existsSync(path.join(tmp, OLD_STAMP_REL)), 'legacy root stamp deleted (no-old-version-leftover)');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('namespace migration: neither stamp location exists -> readUpdateStamp reads null, treated as due', () => {
  const tmp = mkProject(); // no config, no pre-seeded stamp anywhere
  try {
    assert.ok(!fs.existsSync(path.join(tmp, OLD_STAMP_REL)));
    assert.ok(!fs.existsSync(path.join(tmp, NEW_STAMP_REL)));
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('CoalMine self-update (ask'), 'no stamp anywhere -> due (default updateMode is ask)');
    assert.ok(fs.existsSync(path.join(tmp, NEW_STAMP_REL)), 'a fresh install writes directly to the new location');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// --- M1: updateMode safer-value-wins guard (two-level config) ---
// No PS conductor exists (Node-only), so this behavioral coverage lives here.
// An explicit GLOBAL choice may not be escalated by an untrusted project config
// (e.g. a cloned repo's .coalmine.json flipping 'off' -> 'auto', an unsolicited
// git ls-remote contradicting PRIVACY.md); a project moving SAFER is always fine.
function writeGlobal(tmp, cfg) {
  const dir = path.join(tmp, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.coalmine.json'), JSON.stringify(cfg), 'utf8');
}

test('updateMode safer-value-wins: project cannot escalate an explicit global "off" to "auto"', () => {
  const tmp = mkProject({ updateMode: 'auto' }); // project tries to go louder
  try {
    writeGlobal(tmp, { updateMode: 'off' }); // explicit global safety choice
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(!r.stdout.includes('self-update'), 'global off must hold — project auto is clamped back to off');
    assert.equal(readStamp(tmp), null, 'off must not create the update-check stamp');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('updateMode safer-value-wins: project MAY move safer (auto global -> off project)', () => {
  const tmp = mkProject({ updateMode: 'off' }); // project going SAFER is always allowed
  try {
    writeGlobal(tmp, { updateMode: 'auto' });
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(!r.stdout.includes('self-update'), 'project may always move to the safer "off"');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('updateMode safer-value-wins: global-only "off" (no project override) stays off', () => {
  const tmp = mkProject(); // no project .coalmine.json at all
  try {
    writeGlobal(tmp, { updateMode: 'off' });
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(!r.stdout.includes('self-update'), 'global off with no project override stays off');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// Clamp-unchanged regression (namespace campaign #69+#39, owner-designated
// 2026-08-08): the safer-value-wins guard applies identically no matter WHICH
// read-order candidate supplied the project value — only the file's ADDRESS
// moved, the clamp semantics did not. mkProject() plants the project value at
// the LEGACY location (still the every-other-M1-test shape above); this test
// plants it at the NEW own-dir location instead.
function writeProjectAtNewLocation(tmp, cfg) {
  const dir = path.join(tmp, '.claude', 'coal');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'coalmine.json'), JSON.stringify(cfg), 'utf8');
}

// --- board #112: two shipped clamp defects, red-first before the fix ---
test('updateMode safer-value-wins: project-only escalation with NO global config anywhere is clamped to the schema default, not "anything goes"', () => {
  const tmp = mkProject({ updateMode: 'auto' }); // project escalates; no global .coalmine.json written at all
  try {
    assert.ok(!fs.existsSync(path.join(tmp, '.claude', '.coalmine.json')), 'precondition: no global config file exists');
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(!r.stdout.includes('standing consent'), 'an absent global must not let a project "auto" through unclamped -- it clamps to the schema default (ask)');
    assert.ok(r.stdout.includes('CoalMine self-update (ask'), 'clamped to the schema default "ask" directive, not the project-requested "auto"');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('updateMode safer-value-wins: case-insensitive clamp -- project "AUTO" (uppercase) cannot escape an explicit global "off"', () => {
  const tmp = mkProject({ updateMode: 'AUTO' }); // project escalates, different case than the schema's lowercase enum
  try {
    writeGlobal(tmp, { updateMode: 'off' }); // explicit global safety choice, lowercase
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(!r.stdout.includes('self-update'), 'global off must hold regardless of the project value\'s case -- "AUTO" is still "auto"');
    assert.equal(readStamp(tmp), null, 'off must not create the update-check stamp');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('clamp-unchanged regression: safer-value-wins still holds when the project value arrives via the NEW own-dir shape, not the legacy path', () => {
  const tmp = mkProject(); // no project .coalmine.json at the legacy root
  try {
    writeGlobal(tmp, { updateMode: 'off' }); // explicit global safety choice
    writeProjectAtNewLocation(tmp, { updateMode: 'auto' }); // project tries to go louder, via the new shape
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(!r.stdout.includes('self-update'), 'global off must hold — a project value read from .claude/coal/coalmine.json is clamped exactly like one read from the legacy root');
    assert.equal(readStamp(tmp), null, 'off must not create the update-check stamp');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('KIND 2 ReDoS: a poisoned rule file (many openers, no terminator) does NOT hang the conductor', () => {
  // A poisoned .md: many valid stamp OPENERS and ZERO closing `-->`. The old
  // whole-file global capturing STAMP_RE walks each opener's lazy [\s\S]*? to EOF
  // looking for `-->` and fails → N openers × O(N)-to-EOF = O(n^2). Measured on
  // the old regex (this shape): 1MB=2.3s, 2MB=9.2s (clean quadratic doubling,
  // matching the judge's 1MB=2.65s / 2MB=10.6s). The bounded-window fix caps each
  // opener's regex input to STAMP_WINDOW, so it is linear (2MB≈0.46s). A 4s ceiling
  // sits far below the old ~9s and far above the fix's sub-second + Node startup —
  // it fails loud on a regression without flaking on a slow CI box.
  const tmp = mkProject({ updateMode: 'off' }); // off → isolate: only the KIND 2 scan runs
  try {
    const rulesDir = path.join(tmp, '.claude', 'rules', 'ecc');
    fs.mkdirSync(rulesDir, { recursive: true });
    const opener = '<!-- coalmine: verified 2026-01-01 revalidate 30d '; // NO closing -->
    fs.writeFileSync(path.join(rulesDir, 'poison.md'), opener.repeat(40000), 'utf8'); // ~2MB
    const t0 = Date.now();
    const r = runConductor(tmp);
    const elapsed = Date.now() - t0;
    assert.equal(r.status, 0, 'poisoned input still exits 0 (Phoenix #4)');
    assert.ok(elapsed < 4000, `conductor completed in ${elapsed}ms — bounded window keeps the scan linear (old O(n^2) took ~9s at 2MB)`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('KIND 2 bounded window still counts a well-formed past-due stamp buried in a large file', () => {
  // Correctness guard for the window fix: a genuine past-due stamp preceded by a
  // large benign body must still be detected (the fix must not drop real stamps).
  const tmp = mkProject({ updateMode: 'ask' });
  try {
    writeStamp(tmp, todayISO()); // suppress KIND 1
    const rulesDir = path.join(tmp, '.claude', 'rules', 'ecc');
    fs.mkdirSync(rulesDir, { recursive: true });
    const body = '# rule\n' + 'x'.repeat(500 * 1024) + '\n' +
      `<!-- coalmine: verified ${isoDaysAgo(100)} · exemplar X · revalidate 30d -->\n`;
    fs.writeFileSync(path.join(rulesDir, 'big.md'), body, 'utf8');
    const r = runConductor(tmp);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('past their revalidate date'), 'a real past-due stamp in a large file is still detected');
    assert.ok(r.stdout.includes('1 gold-standard rule'), 'counts exactly one');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
