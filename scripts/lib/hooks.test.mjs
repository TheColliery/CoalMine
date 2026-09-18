// CoalMine rot-canary hook tests — node:test built-in, zero dependencies.
// Run: node --test scripts/lib/hooks.test.mjs
// Spawns the real hooks with fixture stdin and a sandboxed TEMP so no real
// session state is touched. Covers: touch record + case-insensitive dedup,
// fail-silent on garbage, stop nudge emit, acknowledged-batch cleanup.
// waiver: intentional single hermetic spawn-suite >800 lines — split only if it
// keeps growing; the gate (scripts/test.mjs) enumerates explicit files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOUCH = path.join(repo, 'hooks', 'rot-canary-touch.js');
const STOP = path.join(repo, 'hooks', 'rot-canary-stop.js');
const CONDUCTOR = path.join(repo, 'hooks', 'coalmine-conductor.js');

function runHook(script, input, tmp, args = [], cwd = tmp) {
  // TEMP/TMP/TMPDIR → sandbox os.tmpdir(); USERPROFILE/HOME → sandbox os.homedir()
  // so the real ~/.claude/.rot-canary-mode can never affect the test (mode = auto default).
  // args: the AG hooks.json template passes the event name as argv (AG mode); CC passes none.
  // cwd: defaults to the same sandbox dir as TEMP/TMP/TMPDIR (every existing caller is
  // unaffected); a test exercising the os.tmpdir()-exclusion guard passes a SEPARATE
  // project dir here, since loadCfg()'s project-config lookup keys off raw process.cwd().
  return spawnSync(process.execPath, [script, ...args], {
    input,
    encoding: 'utf8',
    cwd,
    env: { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp, USERPROFILE: tmp, HOME: tmp },
  });
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cm-hooktest-'));
}

// Mirrors hooks/coalmine-conductor.js's djb2 (test-local — the hook doesn't
// export it). Lets a test plant the EXACT marker path the hook would compute
// for a given session key, to test the EEXIST branch directly.
function djb2(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

test('conductor injects offer rules, and .coalmine.json can silence it', () => {
  const tmp = mkTmp();
  try {
    const on = runHook(CONDUCTOR, '', tmp);
    assert.equal(on.status, 0);
    assert.ok(on.stdout.includes('[CoalMine]'), 'conductor must emit the offer rules');
    assert.ok(on.stdout.includes('gold-standard'), 'onboarding offer rule present');

    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ enableConductor: false }), 'utf8');
    const off = runHook(CONDUCTOR, '', tmp);
    assert.equal(off.status, 0);
    assert.equal(off.stdout, '', 'conductor:false must silence the injection');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('conductor drops only the onboarding line when skipOnboarding is set', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ skipOnboarding: true }), 'utf8');
    const r = runHook(CONDUCTOR, '', tmp);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('[CoalMine]'), 'rest of the conductor still injects');
    assert.ok(r.stdout.includes('Specialists'), 'specialist offers still present');
    assert.ok(!r.stdout.includes('offer /gold-standard ONCE'), 'gold-standard onboarding offer is dropped');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('conductor auto-suppresses onboarding once a coalmine: verified stamp exists anywhere in the rule roots (HOOK-LEAN, no manual skipOnboarding needed)', () => {
  const tmp = mkTmp();
  try {
    const rulesDir = path.join(tmp, '.claude', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, 'gold-standard.md'), '<!-- coalmine: verified 2026-07-01 revalidate 90d -->\n', 'utf8');
    const r = runHook(CONDUCTOR, '', tmp);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('[CoalMine]'), 'rest of the conductor still injects');
    assert.ok(r.stdout.includes('Specialists'), 'specialist offers still present');
    assert.ok(!r.stdout.includes('offer /gold-standard ONCE'), 'a verified stamp anywhere auto-suppresses the onboarding offer');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('project .coalmine.json can disable the canary', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ disabledCanaries: ['rot-canary'] }), 'utf8');
    const r = runHook(TOUCH, JSON.stringify({ session_id: 'CFG', tool_input: { file_path: 'C:\\proj\\a.js' } }), tmp);
    assert.equal(r.status, 0);
    assert.ok(!fs.existsSync(path.join(tmp, 'rot-canary-CFG.touched')), 'disabled canary must record nothing');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('touch hook records edited code file and exits 0', () => {
  const tmp = mkTmp();
  const proj = mkTmp(); // project dir, sibling of the sandbox os.tmpdir() (tmp) — the fixture must live OUTSIDE tmp now that touch excludes os.tmpdir() (a Windows-literal 'C:\proj\a.js' resolved as a RELATIVE segment under process.cwd()==tmp on POSIX, landing inside tmp and tripping the exclusion — CI-red on ubuntu, masked on macOS by an unrelated /private realpath quirk)
  try {
    const real = path.join(proj, 'a.js');
    const r = runHook(TOUCH, JSON.stringify({ session_id: 'T1', tool_input: { file_path: real } }), tmp, [], proj);
    assert.equal(r.status, 0);
    const touched = path.join(tmp, 'rot-canary-T1.touched');
    assert.ok(fs.existsSync(touched), '.touched file must be created in sandbox TEMP');
    assert.ok(fs.readFileSync(touched, 'utf8').includes('a.js'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('touch + stop reject a traversal-shaped session_id (Phoenix #10 sandbox guard)', () => {
  const tmp = mkTmp();
  const evil = '../../../etc/cmhooktest-target';
  const escaped = path.join(tmp, 'rot-canary-' + evil) + '.touched'; // resolves OUTSIDE the sandbox tmpdir
  try {
    const r = runHook(TOUCH, JSON.stringify({ session_id: evil, tool_input: { file_path: 'C:\\proj\\a.js' } }), tmp);
    assert.equal(r.status, 0, 'touch is fail-silent on a bad sid (Phoenix #4)');
    assert.ok(!fs.existsSync(escaped), 'touch wrote NO file outside the sandbox tmpdir');
    assert.ok(!fs.existsSync(path.join(tmp, 'rot-canary-' + evil + '.touched')), 'nothing written for a rejected sid');
    const s = runHook(STOP, JSON.stringify({ session_id: evil, stop_hook_active: false }), tmp);
    assert.equal(s.status, 0, 'stop is fail-silent on a bad sid');
  } finally {
    try { fs.rmSync(escaped, { force: true }); } catch {} // clean if a regression let it escape
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('touch hook dedups case-insensitively on win32 and never crashes', () => {
  const tmp = mkTmp();
  const proj = mkTmp(); // project dir, sibling of the sandbox os.tmpdir() (tmp) — same Windows-literal-path fix as T1 above
  try {
    const upper = path.join(proj, 'App.js');
    const lower = path.join(proj, 'app.js');
    runHook(TOUCH, JSON.stringify({ session_id: 'T2', tool_input: { file_path: upper } }), tmp, [], proj);
    runHook(TOUCH, JSON.stringify({ session_id: 'T2', tool_input: { file_path: lower } }), tmp, [], proj);
    const lines = fs.readFileSync(path.join(tmp, 'rot-canary-T2.touched'), 'utf8').split('\n').filter(Boolean);
    if (process.platform === 'win32') {
      assert.equal(lines.length, 1, 'same path differing only by case must be recorded once on win32');
    } else {
      assert.equal(lines.length, 2);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('hooks are fail-silent: garbage and empty stdin exit 0 with no output', () => {
  const tmp = mkTmp();
  try {
    for (const input of ['not json {{{', '']) {
      const rt = runHook(TOUCH, input, tmp);
      assert.equal(rt.status, 0);
      assert.equal(rt.stdout, '');
      const rs = runHook(STOP, input, tmp);
      assert.equal(rs.status, 0);
      assert.equal(rs.stdout, '');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop hook emits decision:block nudge listing touched files, filtering non-paths', () => {
  const tmp = mkTmp();
  try {
    const real = path.join(tmp, 'edited-a.js');
    fs.writeFileSync(real, 'x');
    const base = path.join(tmp, 'rot-canary-S1');
    // One real path + one garbage line — only the real one may surface.
    fs.writeFileSync(base + '.touched', real + '\n\u0000\u0001garbage-not-a-path\n');
    const stdin = JSON.stringify({ session_id: 'S1', stop_hook_active: false });

    const first = runHook(STOP, stdin, tmp);
    assert.equal(first.status, 0);
    const out = JSON.parse(first.stdout);
    assert.equal(out.decision, 'block');
    assert.ok(out.reason.includes('edited-a.js'), 'reason lists the touched file');
    assert.ok(!out.reason.includes('garbage-not-a-path'), 'garbage lines are filtered out');
    assert.ok(fs.existsSync(base + '.scanned'), 'one-shot marker written');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop hook cleans up session temp files once the batch is acknowledged', () => {
  const tmp = mkTmp();
  try {
    const base = path.join(tmp, 'rot-canary-S2');
    fs.writeFileSync(base + '.touched', 'C:\\proj\\a.js\n');
    fs.writeFileSync(base + '.smells', '');
    // The .scanned marker stores the .touched mtime captured at nudge time;
    // touched mtime <= stored value → batch acknowledged → cleanup.
    fs.writeFileSync(base + '.scanned', String(fs.statSync(base + '.touched').mtimeMs));

    const r = runHook(STOP, JSON.stringify({ session_id: 'S2', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'acknowledged batch must not re-nudge');
    for (const s of ['.touched', '.smells', '.scanned']) {
      assert.ok(!fs.existsSync(base + s), `${s} must be deleted (Phoenix #1 zero garbage)`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop hook honors language override in .coalmine.json', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ language: 'ja' }), 'utf8');
    const real = path.join(tmp, 'edited-a.js');
    fs.writeFileSync(real, 'x');
    const base = path.join(tmp, 'rot-canary-S3');
    fs.writeFileSync(base + '.touched', real + '\n');
    const stdin = JSON.stringify({ session_id: 'S3', stop_hook_active: false });

    const r = runHook(STOP, stdin, tmp);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.ok(out.reason.includes('自動チェック'), 'nudge reason must be in Japanese');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('touch hook honors tripwireMaxFileSizeKb in .coalmine.json', () => {
  const tmp = mkTmp();
  const proj = mkTmp(); // project dir, sibling of the sandbox os.tmpdir() (tmp) — the fixture must live OUTSIDE tmp now that touch excludes os.tmpdir()
  try {
    fs.writeFileSync(path.join(proj, '.coalmine.json'), JSON.stringify({ tripwireMaxFileSizeKb: 1 }), 'utf8');

    // Create a file larger than 1KB (e.g. 2KB)
    const largeFile = path.join(proj, 'large.js');
    fs.writeFileSync(largeFile, 'x'.repeat(2048));

    const r = runHook(TOUCH, JSON.stringify({ session_id: 'T3', tool_input: { file_path: largeFile } }), tmp, [], proj);
    assert.equal(r.status, 0);

    // It should record the touched file path, but should NOT flag it as smell (smell scan is skipped)
    assert.ok(fs.existsSync(path.join(tmp, 'rot-canary-T3.touched')), 'touched path is still recorded');
    assert.ok(!fs.existsSync(path.join(tmp, 'rot-canary-T3.smells')), 'large file smells check was skipped due to size cap');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('touch hook honors watchedExtensions override in .coalmine.json', () => {
  const tmp = mkTmp();
  const proj = mkTmp(); // project dir, sibling of the sandbox os.tmpdir() (tmp)
  try {
    fs.writeFileSync(path.join(proj, '.coalmine.json'), JSON.stringify({ watchedExtensions: ['py', '.sh'] }), 'utf8');

    const fileJs = path.join(proj, 'file.js');
    fs.writeFileSync(fileJs, 'x');
    const filePy = path.join(proj, 'file.py');
    fs.writeFileSync(filePy, 'x');

    const r1 = runHook(TOUCH, JSON.stringify({ session_id: 'T4', tool_input: { file_path: fileJs } }), tmp, [], proj);
    assert.equal(r1.status, 0);
    assert.ok(!fs.existsSync(path.join(tmp, 'rot-canary-T4.touched')), 'unwatched JS file is ignored');

    const r2 = runHook(TOUCH, JSON.stringify({ session_id: 'T4', tool_input: { file_path: filePy } }), tmp, [], proj);
    assert.equal(r2.status, 0);
    assert.ok(fs.existsSync(path.join(tmp, 'rot-canary-T4.touched')), 'watched PY file is recorded');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('touch hook honors tripwireMaxLines override in .coalmine.json', () => {
  const tmp = mkTmp();
  const proj = mkTmp(); // project dir, sibling of the sandbox os.tmpdir() (tmp)
  try {
    fs.writeFileSync(path.join(proj, '.coalmine.json'), JSON.stringify({ tripwireMaxLines: 5 }), 'utf8');

    const fileLines = path.join(proj, 'lines.js');
    fs.writeFileSync(fileLines, 'x\n'.repeat(10)); // 11 lines

    const r = runHook(TOUCH, JSON.stringify({ session_id: 'T5', tool_input: { file_path: fileLines } }), tmp, [], proj);
    assert.equal(r.status, 0);

    const smellsFile = path.join(tmp, 'rot-canary-T5.smells');
    assert.ok(fs.existsSync(smellsFile), 'smell file was created');
    assert.ok(fs.readFileSync(smellsFile, 'utf8').includes('file >5 lines'), 'triggered custom maxLines smell warning');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('touch hook clamps a negative tripwireMaxLines → no mass false-smell (Board-2 clamp)', () => {
  const tmp = mkTmp();
  const proj = mkTmp(); // project dir, sibling of the sandbox os.tmpdir() (tmp)
  try {
    // raw -3 would flag EVERY file (lines > -3 is always true); clamped to >=1 a
    // 1-line file must NOT be flagged. Same clamp class as tripwireMaxFileSizeKb / ruleRevalidateDays.
    fs.writeFileSync(path.join(proj, '.coalmine.json'), JSON.stringify({ tripwireMaxLines: -3 }), 'utf8');
    const oneLine = path.join(proj, 'one.js');
    fs.writeFileSync(oneLine, 'x'); // 1 line, no trailing newline
    const r = runHook(TOUCH, JSON.stringify({ session_id: 'T5b', tool_input: { file_path: oneLine } }), tmp, [], proj);
    assert.equal(r.status, 0);
    const smellsFile = path.join(tmp, 'rot-canary-T5b.smells');
    const smells = fs.existsSync(smellsFile) ? fs.readFileSync(smellsFile, 'utf8') : '';
    assert.ok(!smells.includes('lines'), 'a negative tripwireMaxLines must not produce a line-count smell on a 1-line file');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('loadCfg parses JSONC with a backslash-terminated string before a later // string (no silent revert to defaults)', () => {
  const tmp = mkTmp();
  const proj = mkTmp(); // project dir, sibling of the sandbox os.tmpdir() (tmp)
  try {
    // The comment-stripper used to desync here: a string value ending in a literal
    // backslash ("C:\\") leaked escape state, so a LATER string containing // was
    // mis-stripped → JSON.parse threw → catch{} reverted the WHOLE config to defaults.
    // This fixture must still parse so the tripwireMaxLines override is honored.
    const jsonc = [
      '{',
      '  // a comment line',
      '  "watchedExtensions": ["js"],',
      '  "schemaPaths": ["C:\\\\"],',           // value ends in one literal backslash
      '  "trustedDomains": ["http://example.com"], /* later // inside a string */',
      '  "tripwireMaxLines": 5',
      '}',
    ].join('\n');
    fs.writeFileSync(path.join(proj, '.coalmine.json'), jsonc, 'utf8');

    const fileLines = path.join(proj, 'lines.js');
    fs.writeFileSync(fileLines, 'x\n'.repeat(10)); // 11 lines > the override of 5

    const r = runHook(TOUCH, JSON.stringify({ session_id: 'T6', tool_input: { file_path: fileLines } }), tmp, [], proj);
    assert.equal(r.status, 0);

    const smellsFile = path.join(tmp, 'rot-canary-T6.smells');
    assert.ok(fs.existsSync(smellsFile), 'config parsed: smell file created from the JSONC override');
    assert.ok(
      fs.readFileSync(smellsFile, 'utf8').includes('file >5 lines'),
      'tripwireMaxLines:5 honored — config did NOT silently revert to the default 800',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('size tripwire: a declared over-run (top-of-file ponytail, drifted N) is NOT flagged — the finding is an UNDECLARED over-run (coding-style.md 2026-07-26)', () => {
  const tmp = mkTmp();
  const proj = mkTmp(); // project dir, sibling of the sandbox os.tmpdir() (tmp)
  try {
    fs.writeFileSync(path.join(proj, '.coalmine.json'), JSON.stringify({ tripwireMaxLines: 5 }), 'utf8');
    const f = path.join(proj, 'declared.js');
    // N deliberately DRIFTED (999 vs 11 actual): the N is HISTORY, not a live claim —
    // a stale number must not reopen the finding (the churn the amendment killed).
    fs.writeFileSync(f, '// ponytail: 999 lines at declaration — single cohesive fixture\n' + 'x\n'.repeat(10));
    const r = runHook(TOUCH, JSON.stringify({ session_id: 'SZ1', tool_input: { file_path: f } }), tmp, [], proj);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'hook stays silent (Phoenix #13)');
    assert.ok(fs.existsSync(path.join(tmp, 'rot-canary-SZ1.touched')),
      'declared file is still RECORDED for the stop-scan — the exemption covers the size smell only');
    const smellsFile = path.join(tmp, 'rot-canary-SZ1.smells');
    const smells = fs.existsSync(smellsFile) ? fs.readFileSync(smellsFile, 'utf8') : '';
    assert.ok(!smells.includes('file >'), 'a declared over-run must not produce a size smell');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('size tripwire: an UNDECLARED over-run stays flagged, and a waiver declaration never silences the merge-conflict tripwire', () => {
  const tmp = mkTmp();
  const proj = mkTmp(); // project dir, sibling of the sandbox os.tmpdir() (tmp)
  try {
    fs.writeFileSync(path.join(proj, '.coalmine.json'), JSON.stringify({ tripwireMaxLines: 5 }), 'utf8');
    const plain = path.join(proj, 'undeclared.js');
    fs.writeFileSync(plain, 'x\n'.repeat(10)); // 10 lines, no declaration
    const conflicted = path.join(proj, 'declared-conflict.js');
    // waiver: form (the pre-rule in-tree idiom, hooks.test.mjs:6 precedent) — accepted
    // as a declaration; the size smell goes quiet but the CONFLICT smell must survive.
    fs.writeFileSync(conflicted,
      '// waiver: 12 lines — conflict fixture\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n' + 'x\n'.repeat(6));
    for (const f of [plain, conflicted]) {
      const r = runHook(TOUCH, JSON.stringify({ session_id: 'SZ2', tool_input: { file_path: f } }), tmp, [], proj);
      assert.equal(r.status, 0);
    }
    const rows = fs.readFileSync(path.join(tmp, 'rot-canary-SZ2.smells'), 'utf8').split('\n').filter(Boolean);
    const plainRow = rows.find((l) => l.startsWith(plain + ':'));
    assert.ok(plainRow && plainRow.includes('file >5 lines (10)'), 'the undeclared over-run is still flagged — this half must not weaken');
    const confRow = rows.find((l) => l.startsWith(conflicted + ':'));
    assert.ok(confRow && confRow.includes('merge-conflict markers'), 'the conflict tripwire still fires on a declared file');
    assert.ok(!confRow.includes('file >'), 'the declaration silences ONLY the size smell');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('size tripwire: test files are out of scope — .test. basename and a tests/ dir segment both exempt (source files only)', () => {
  const tmp = mkTmp();
  const proj = mkTmp(); // project dir, sibling of the sandbox os.tmpdir() (tmp)
  try {
    fs.writeFileSync(path.join(proj, '.coalmine.json'), JSON.stringify({ tripwireMaxLines: 5 }), 'utf8');
    const byName = path.join(proj, 'big.test.js');
    fs.writeFileSync(byName, 'x\n'.repeat(10)); // 10 lines, no declaration
    fs.mkdirSync(path.join(proj, 'tests'), { recursive: true });
    const byDir = path.join(proj, 'tests', 'helper.js');
    fs.writeFileSync(byDir, 'x\n'.repeat(10));
    for (const f of [byName, byDir]) {
      const r = runHook(TOUCH, JSON.stringify({ session_id: 'SZ3', tool_input: { file_path: f } }), tmp, [], proj);
      assert.equal(r.status, 0);
    }
    const touched = fs.readFileSync(path.join(tmp, 'rot-canary-SZ3.touched'), 'utf8');
    assert.ok(touched.includes('big.test.js') && touched.includes('helper.js'),
      'test files are still RECORDED for the stop-scan — only the size smell is out of scope');
    const smellsFile = path.join(tmp, 'rot-canary-SZ3.smells');
    const smells = fs.existsSync(smellsFile) ? fs.readFileSync(smellsFile, 'utf8') : '';
    assert.ok(!smells.includes('file >'), 'no size smell on test files');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('size tripwire: the tests/ segment exemption survives the root and the file being TWO SPELLINGS of one dir (the macOS /private/var class)', (t) => {
  // Regression for a real CI red: macos-latest failed on both node 22 and 24 while
  // ubuntu+windows passed, because process.cwd() is kernel-resolved (/private/var/...)
  // while the payload path is not (/var/...), so isTestFile's `..` guard rejected a
  // path that was really inside the root. Reproduced here WITHOUT macOS by pointing a
  // junction/symlink at the project dir: spawn cwd uses the real spelling, the payload
  // uses the link. 'junction' is the unprivileged Windows shim; the arg is ignored on POSIX.
  const tmp = mkTmp();
  const holder = mkTmp();
  const real = path.join(holder, 'real');
  const link = path.join(holder, 'link');
  fs.mkdirSync(real, { recursive: true });
  try {
    try {
      fs.symlinkSync(real, link, 'junction');
    } catch (e) {
      // Visible skip, never a bare return — a silent vacuous pass is how this class hid.
      t.skip(`cannot create a directory link here (${e.code}) — no two spellings to compare`);
      return;
    }
    fs.writeFileSync(path.join(real, '.coalmine.json'), JSON.stringify({ tripwireMaxLines: 5 }), 'utf8');
    fs.mkdirSync(path.join(real, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(real, 'tests', 'helper.js'), 'x\n'.repeat(10));
    // cwd = the REAL spelling, payload = the SAME file via the OTHER spelling.
    const r = runHook(TOUCH, JSON.stringify({ session_id: 'SZLINK', tool_input: { file_path: path.join(link, 'tests', 'helper.js') } }), tmp, [], real);
    assert.equal(r.status, 0);
    // ANTI-VACUITY PIN: exit 0 proves nothing on a fail-silent hook — Phoenix #4
    // guarantees it on every bail path (bad sid, extension gate, tmpdir exclude,
    // unreadable config), and the real assertion below is a NEGATIVE. Without this
    // positive state-effect check, a future gate that made the hook bail on this
    // fixture would turn the test green while proving nothing.
    const touched = fs.readFileSync(path.join(tmp, 'rot-canary-SZLINK.touched'), 'utf8');
    assert.ok(touched.includes('helper.js'), 'the hook actually processed the fixture (not a silent bail)');
    const smellsFile = path.join(tmp, 'rot-canary-SZLINK.smells');
    const smells = fs.existsSync(smellsFile) ? fs.readFileSync(smellsFile, 'utf8') : '';
    assert.ok(!smells.includes('file >'), 'a tests/ file must stay exempt when root and file are spelled differently');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(holder, { recursive: true, force: true });
  }
});

test('size tripwire: the declaration must sit in the file head — a deep marker does not silence an over-run, a header-block one does', () => {
  const tmp = mkTmp();
  const proj = mkTmp(); // project dir, sibling of the sandbox os.tmpdir() (tmp)
  try {
    fs.writeFileSync(path.join(proj, '.coalmine.json'), JSON.stringify({ tripwireMaxLines: 5 }), 'utf8');
    // Declaration at line 20 (end of a header block, the md-ast.mjs:24 shape) → inside
    // the 30-line head window → accepted.
    const headerStyle = path.join(proj, 'header.js');
    fs.writeFileSync(headerStyle, '// header\n'.repeat(19) + '// ponytail: 25 lines — header-block placement\n' + 'x\n'.repeat(5));
    // Same marker text buried at line 36 → OUTSIDE the head window → the over-run is
    // UNDECLARED where the rule says a declaration lives, so it stays flagged.
    const deepMarker = path.join(proj, 'deep.js');
    fs.writeFileSync(deepMarker, 'x\n'.repeat(35) + '// ponytail: 99 lines at declaration — too deep to count\n');
    for (const f of [headerStyle, deepMarker]) {
      const r = runHook(TOUCH, JSON.stringify({ session_id: 'SZ4', tool_input: { file_path: f } }), tmp, [], proj);
      assert.equal(r.status, 0);
    }
    const smellsFile = path.join(tmp, 'rot-canary-SZ4.smells');
    const smells = fs.existsSync(smellsFile) ? fs.readFileSync(smellsFile, 'utf8') : '';
    assert.ok(!smells.includes('header.js'), 'a header-block declaration (≤ line 30) is honored');
    assert.ok(smells.includes('deep.js') && smells.includes('file >5 lines'),
      'a marker below the head window does not count as a declaration — the undeclared half holds');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('size tripwire: a poison declaration line cannot blow the latency budget (ReDoS bound; the suite\'s FIRST timing assertion)', () => {
  const tmp = mkTmp();
  const proj = mkTmp(); // project dir, sibling of the sandbox os.tmpdir() (tmp)
  try {
    // SHIPPED DEFAULTS on purpose — no .coalmine.json. The scan needs lineCount > 800,
    // and 100k digits + 801 short lines is 99.2 KB, under the 100 KB size cap: the
    // catastrophic path is reachable without any config change. The lazy `.*?` before
    // `\d+` backtracks quadratically in LINE LENGTH, so this measured 5424 ms unbounded
    // vs 57 ms on the benign control; the 2048-char slice puts it back at ~3 ms.
    // Every other test here asserts STATE — none asserts TIME, so the suite was
    // structurally blind to this axis and 56/56 green was never evidence on it.
    // 2000 ms ceiling: ~25x over the fixed path, ~2.7x under the broken one on the
    // slowest box measured — non-flaky in both directions.
    const f = path.join(proj, 'poison.js');
    // 1 poison line + 800 content lines = 801 > the shipped cap of 800 (the trailing
    // newline's empty split element is dropped by the hook, so this is exactly 801).
    fs.writeFileSync(f, `// ponytail: ${'9'.repeat(100000)}\n` + 'x\n'.repeat(800));
    assert.ok(fs.statSync(f).size < 100 * 1024, 'fixture must stay under the shipped tripwireMaxFileSizeKb, else the scan is skipped and the test proves nothing');
    const t0 = Date.now();
    const r = runHook(TOUCH, JSON.stringify({ session_id: 'SZ5', tool_input: { file_path: f } }), tmp, [], proj);
    const ms = Date.now() - t0;
    assert.equal(r.status, 0);
    assert.ok(ms < 2000, `hook took ${ms} ms on a poison declaration line — the ReDoS bound is gone`);
    const smells = fs.readFileSync(path.join(tmp, 'rot-canary-SZ5.smells'), 'utf8');
    assert.ok(smells.includes('file >800 lines (801)'), 'digits with no "lines" payload is NOT a declaration — still flagged');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('stop hook honors autoScanFileCapSlice override in .coalmine.json', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ autoScanFileCap: 2, autoScanFileCapSlice: 1 }), 'utf8');
    
    const fileA = path.join(tmp, 'a.js');
    const fileB = path.join(tmp, 'b.js');
    const fileC = path.join(tmp, 'c.js');
    fs.writeFileSync(fileA, 'x');
    fs.writeFileSync(fileB, 'x');
    fs.writeFileSync(fileC, 'x');
    
    const base = path.join(tmp, 'rot-canary-S4');
    fs.writeFileSync(base + '.touched', `${fileA}\n${fileB}\n${fileC}\n`);
    
    const r = runHook(STOP, JSON.stringify({ session_id: 'S4', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    
    const out = JSON.parse(r.stdout);
    assert.ok(out.reason.includes('capped at 1 files'), 'warning notice dynamic interpolation maps new slice cap value');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop hook clamps autoScanFileCap:0 → no empty-list / "capped at 0" nudge (Board #2)', () => {
  // Before the read-time clamp, {autoScanFileCap:0, autoScanFileCapSlice:0} → files.slice(0,0)
  // → an empty file list + a "capped at 0 files" notice (a wasted, self-contradictory turn).
  // The clamp floors both at 1, so the nudge lists a real file and never says "capped at 0".
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ autoScanFileCap: 0, autoScanFileCapSlice: 0 }), 'utf8');
    const fileA = path.join(tmp, 'a.js');
    const fileB = path.join(tmp, 'b.js');
    fs.writeFileSync(fileA, 'x');
    fs.writeFileSync(fileB, 'x');
    const base = path.join(tmp, 'rot-canary-S5');
    fs.writeFileSync(base + '.touched', `${fileA}\n${fileB}\n`);

    const r = runHook(STOP, JSON.stringify({ session_id: 'S5', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.decision, 'block');
    assert.ok(!out.reason.includes('capped at 0'), 'must NOT say "capped at 0" — the cap is clamped to 1');
    assert.ok(out.reason.includes('a.js') || out.reason.includes('b.js'), 'nudge must list at least one real file, never an empty list');
    // The list region (between the intro and any cap notice) carries a real "  - <file>" line.
    assert.ok(/\n {2}- .+\.js/.test(out.reason), 'a non-empty bullet list of files is present');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop hook clamps autoScanFileCapSlice:-1 → does NOT drop the last touched file (Board #2)', () => {
  // Before the clamp, {autoScanFileCap:2, autoScanFileCapSlice:-1} with 3 files → slice(0,-1)
  // silently kept "all but the last" + a "capped at -1 files" notice. The clamp floors the
  // slice at 1 → the notice reads "capped at 1 files" and the all-but-last drop is impossible.
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ autoScanFileCap: 2, autoScanFileCapSlice: -1 }), 'utf8');
    const fileA = path.join(tmp, 'a.js');
    const fileB = path.join(tmp, 'b.js');
    const fileC = path.join(tmp, 'c.js');
    fs.writeFileSync(fileA, 'x');
    fs.writeFileSync(fileB, 'x');
    fs.writeFileSync(fileC, 'x');
    const base = path.join(tmp, 'rot-canary-S6');
    fs.writeFileSync(base + '.touched', `${fileA}\n${fileB}\n${fileC}\n`);

    const r = runHook(STOP, JSON.stringify({ session_id: 'S6', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.decision, 'block');
    assert.ok(!out.reason.includes('capped at -1'), 'must NOT emit a negative "-1" slice notice');
    assert.ok(out.reason.includes('capped at 1 files'), 'slice clamped to 1 (positive int), not the negative "all-but-last" behavior');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop hook does NOT sweep stale temp when the canary is disabled (a disabled canary does no work)', () => {
  const tmp = mkTmp();
  try {
    // A stale leftover from a crashed session (mtime ~99 days old → past the 7-day default).
    const stale = path.join(tmp, 'rot-canary-OLD.touched');
    fs.writeFileSync(stale, 'C:\\proj\\x.js\n');
    const old = Date.now() - 99 * 24 * 60 * 60 * 1000;
    fs.utimesSync(stale, new Date(old), new Date(old));
    // Canary disabled for this project.
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ disabledCanaries: ['rot-canary'] }), 'utf8');

    const r = runHook(STOP, JSON.stringify({ session_id: 'DIS', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'disabled canary emits no nudge');
    assert.ok(fs.existsSync(stale), 'disabled canary must skip the sweep — stale temp is left untouched');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop hook DOES sweep stale temp on the active (auto) path', () => {
  const tmp = mkTmp();
  try {
    // Same stale leftover, but the canary is active (default auto, no override).
    const stale = path.join(tmp, 'rot-canary-OLD.touched');
    fs.writeFileSync(stale, 'C:\\proj\\x.js\n');
    const old = Date.now() - 99 * 24 * 60 * 60 * 1000;
    fs.utimesSync(stale, new Date(old), new Date(old));
    // No .touched for THIS session → the hook sweeps, then bails (nothing to nudge).
    const r = runHook(STOP, JSON.stringify({ session_id: 'ACT', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    assert.ok(!fs.existsSync(stale), 'auto path sweeps stale temp older than the cutoff (Phoenix #1)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop hook: a pre-planted SYMLINK at the sweep-throttle marker never truncates its target (CWK-031/U8)', (t) => {
  const tmp = mkTmp();
  const victim = path.join(mkTmp(), 'victim.txt');
  try {
    // The U8 defect: the throttle marker sat FLAT in the shared tmp ROOT under a fixed name,
    // written with the default 'w' flag, which FOLLOWS a symlink at the destination. On Unix
    // any local user could pre-plant a link there and have the victim's next Stop truncate the
    // target. The security property under test is PATH-INDEPENDENT — "no code path of this hook
    // truncates a file through a planted marker symlink" — so the link is planted at BOTH the
    // pre-U8 flat-root path AND the post-U8 subdir path. That is what makes this red-first
    // against the unmodified hook (which stat-follows the flat link to a backdated victim,
    // decides the throttle is expired, and writes THROUGH it) while staying honest about the
    // fact that the fix also moved the file.
    fs.writeFileSync(victim, 'PRECIOUS\n');
    // Backdate the victim: the pre-fix code stat()s THROUGH the link, so a fresh victim mtime
    // would trip the 24h throttle and the old code would return before writing — hiding its own
    // bug behind an unrelated early exit. Backdating forces the old code down the write path.
    const old = Date.now() - 99 * 24 * 60 * 60 * 1000;
    fs.utimesSync(victim, new Date(old), new Date(old));

    const markerDir = path.join(tmp, 'coalmine');
    fs.mkdirSync(markerDir, { recursive: true });
    try {
      // 'junction' is the unprivileged Windows shim but is DIR-only; a file symlink needs
      // Developer Mode. Try the real file link and skip visibly with the errno if refused.
      fs.symlinkSync(victim, path.join(tmp, 'rot-canary-sweep.marker'), 'file');
      fs.symlinkSync(victim, path.join(markerDir, 'rot-canary-sweep.marker'), 'file');
    } catch (e) {
      t.skip(`cannot create a file symlink here (${e.code}) — needs Developer Mode/privilege on Windows`);
      return; // t.skip does not stop the body; return so this is a visible skip, never a vacuous pass
    }

    const r = runHook(STOP, JSON.stringify({ session_id: 'SYMU8', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0, 'fail-silent still exits 0 (Phoenix #4)');
    assert.equal(fs.readFileSync(victim, 'utf8'), 'PRECIOUS\n', 'the symlink target must NOT be truncated');
  } finally {
    fs.rmSync(path.dirname(victim), { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop hook: an ALIASED (hard-linked) sweep marker is replaced, never written through (CWK-031/U8, unprivileged)', (t) => {
  // The privilege-free half of the test above, and on a stock Windows box the ONLY one that
  // actually runs: creating a file SYMLINK needs Developer Mode (EPERM here), and 'junction' is
  // dir-only so it cannot stand in for a file. A HARD LINK needs no privilege and exercises the
  // SAME distinguishing semantics the fix turns on — a second directory entry for one inode:
  //   write(path, 'w')      → writes THROUGH the entry into the shared inode → victim truncated
  //   rename(tmp, path)     → REPLACES the directory entry → the victim's own name keeps its bytes
  // Measured on this box before it was relied on: 'w' left the victim "", rename left it intact.
  // It does not model an attacker crossing a privilege boundary (a hard link needs write access
  // to the target already) — it models the WRITE SEMANTICS, which is the property the fix changes.
  const tmp = mkTmp();
  const victimDir = mkTmp();
  const victim = path.join(victimDir, 'victim.txt');
  try {
    fs.writeFileSync(victim, 'PRECIOUS\n');
    const old = Date.now() - 99 * 24 * 60 * 60 * 1000; // past the 24h gate, so the write path is reached
    fs.utimesSync(victim, new Date(old), new Date(old));

    const markerDir = path.join(tmp, 'coalmine');
    fs.mkdirSync(markerDir, { recursive: true });
    try {
      // Both the pre-U8 flat-root path and the post-U8 subdir path, so the assertion is
      // path-independent and goes RED against the unmodified hook rather than passing vacuously.
      fs.linkSync(victim, path.join(tmp, 'rot-canary-sweep.marker'));
      fs.linkSync(victim, path.join(markerDir, 'rot-canary-sweep.marker'));
    } catch (e) {
      t.skip(`cannot create a hard link here (${e.code}) — needs same-volume link support`);
      return; // t.skip does not stop the body; return so this is a visible skip, never a vacuous pass
    }

    const r = runHook(STOP, JSON.stringify({ session_id: 'HLNKU8', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0, 'fail-silent still exits 0 (Phoenix #4)');
    assert.equal(
      fs.readFileSync(victim, 'utf8'),
      'PRECIOUS\n',
      'the aliased target must keep its bytes — a plain write would truncate it through the shared inode',
    );
  } finally {
    fs.rmSync(victimDir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop hook: a FRESH symlink at the marker is never obeyed as a throttle — the sweep still runs (INSPECT M1/L1)', (t) => {
  // The first version of the fix's own comment claimed a planted link "reads as no marker".
  // Measured false: lstat does NOT throw on a link, it returns the LINK's own stat, so a
  // just-created link has an mtime of ~now — without an explicit isSymbolicLink() arm the
  // gate takes the `< 24h` branch, returns early, and the link SURVIVES while suppressing
  // every sweep, refreshable by the planter forever (no write-through; an unbounded
  // temp-cleanup DoS). This pins the arm that makes the self-healing claim actually true.
  const tmp = mkTmp();
  const target = mkTmp(); // what the planted link points at — must stay untouched
  try {
    const markerDir = path.join(tmp, 'coalmine');
    fs.mkdirSync(markerDir, { recursive: true });
    const marker = path.join(markerDir, 'rot-canary-sweep.marker');
    try {
      // junction = the unprivileged dir-link shim this box permits; 'dir' on POSIX.
      fs.symlinkSync(target, marker, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (e) {
      t.skip(`symlink/junction unavailable (${e.code}) — cannot plant a link at the marker`);
      return; // t.skip does not stop the body; return so this is a visible skip, never a vacuous pass
    }
    // The sweep's observable: a backdated canary temp that only a RUNNING sweep deletes.
    const bait = path.join(tmp, 'rot-canary-BAIT.touched');
    fs.writeFileSync(bait, 'C:\\proj\\x.js\n');
    const old = Date.now() - 99 * 24 * 60 * 60 * 1000;
    fs.utimesSync(bait, new Date(old), new Date(old));

    const r = runHook(STOP, JSON.stringify({ session_id: 'FRESHLNK', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0, 'fail-silent still exits 0 (Phoenix #4)');
    // The DoS property, and the only one that holds for EVERY link type: the gate is not
    // obeyed, so the sweep runs. Deliberately NOT asserting the link is gone — this fixture
    // is a junction (dir-type), the unprivileged link this box permits, and rename onto a
    // dir-type link fails EPERM (measured). Replacement is the FILE-symlink case, which is
    // EPERM to create here; asserting it would encode an over-claim as a passing test.
    assert.ok(!fs.existsSync(bait), 'the sweep must still run — a fresh link must not suppress it');
    assert.equal(fs.readdirSync(target).length, 0, 'nothing written THROUGH the link into the target dir');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('stop hook: the .scanned temp marker is created 0o600, not the default mode (CWK-043)', (t) => {
  // CodeQL js/insecure-temporary-file (#66/#67) sinks a temp-dir write that passes NO `mode`
  // (or one whose low 6 bits are not all zero) — re-derived from the query source: it reads
  // the mode argument ONLY, never the flag, the dir's permissions, or filename randomness.
  // Beyond the alert it is real defence-in-depth: these are FLAT os.tmpdir() writes, so on a
  // shared Unix /tmp the file's own mode is the only thing scoping it to this user.
  // POSIX-only assertion: Windows/NTFS uses ACLs and reports a synthetic mode, so the check
  // would be meaningless there — skipped visibly rather than asserted into a false pass.
  if (process.platform === 'win32') {
    t.skip('POSIX mode bits are not the access model on Windows/NTFS (ACLs are) — nothing to assert');
    return; // t.skip does not stop the body; return so this is a visible skip, never a vacuous pass
  }
  const tmp = mkTmp();
  try {
    // The touched path must EXIST at stop time or the hook correctly bails without nudging
    // and never writes `.scanned` — which is exactly how the first version of this test
    // failed on CI: it planted a non-existent `C:\proj\x.js`, so the marker under assertion
    // was never created. Same real-file shape as the nudge tests above.
    const real = path.join(tmp, 'edited-mode.js');
    fs.writeFileSync(real, 'x');
    const touched = path.join(tmp, 'rot-canary-MODE.touched');
    fs.writeFileSync(touched, real + '\n');
    const r = runHook(STOP, JSON.stringify({ session_id: 'MODE', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    const scanned = path.join(tmp, 'rot-canary-MODE.scanned');
    assert.ok(fs.existsSync(scanned), 'the acknowledgement marker must have been written');
    assert.equal(
      fs.statSync(scanned).mode & 0o777,
      0o600,
      'the temp marker must be owner-only — a default-mode temp write is the CodeQL sink',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('touch hook: .touched and .smells are created 0o600, not the default mode (CWK-043 M1)', (t) => {
  // Covers the two `appendFileSync` sites hardened for the THREAT rather than for the
  // scanner (appendFileSync is not one of js/insecure-temporary-file's 14 modelled sinks, so
  // nothing flags them) — they are flat os.tmpdir() writes carrying the user's edited paths
  // and the findings against them. Previously untested because the assertion cannot run on
  // this room's dev box; kept POSIX-only for the same access-model reason as the sibling above.
  if (process.platform === 'win32') {
    t.skip('POSIX mode bits are not the access model on Windows/NTFS (ACLs are) — nothing to assert');
    return; // t.skip does not stop the body; return so this is a visible skip, never a vacuous pass
  }
  const tmp = mkTmp();
  const proj = mkTmp(); // SIBLING of the sandbox TEMP, never nested inside it: touch.js drops
  try {                 // any file under os.tmpdir() from recording (the v3.12.2 scope guard).
    fs.mkdirSync(path.join(proj, '.git'));
    // Pin the threshold in the fixture instead of leaning on the 800 default and writing a
    // 900-line file: this is a MODE test, and coupling it to a tripwire constant it does not
    // care about would make it fail for an unrelated reason the day that default moves.
    // Same shape the sibling `tripwireMaxLines override` test above already uses.
    fs.writeFileSync(path.join(proj, '.coalmine.json'), JSON.stringify({ tripwireMaxLines: 5 }), 'utf8');
    const f = path.join(proj, 'big.js');
    fs.writeFileSync(f, 'const x=1;\n'.repeat(10)); // 11 lines > the pinned 5 → also yields .smells
    const r = runHook(
      TOUCH,
      JSON.stringify({ session_id: 'T600', tool_name: 'Write', tool_input: { file_path: f }, cwd: proj }),
      tmp,
      [],
      proj,
    );
    assert.equal(r.status, 0);
    for (const suffix of ['.touched', '.smells']) {
      const p = path.join(tmp, 'rot-canary-T600' + suffix);
      assert.ok(fs.existsSync(p), `${suffix} must have been written`);
      assert.equal(fs.statSync(p).mode & 0o777, 0o600, `${suffix} must be owner-only`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('stop hook: a stranded rename `.tmp` is reaped by the subdir sweep (INSPECT L3 — SIGKILL residue)', () => {
  // The catch's unlinkSync covers the EXCEPTION path only; process death between the write
  // and the rename strands `.sweep-<pid>.tmp`, which the subdir sweep could not collect while
  // it matched `*.marker` alone. No privilege needed — the stranded file is simulated directly,
  // since racing a real SIGKILL is not worth it (scripts-quality.md's own honest limit).
  const tmp = mkTmp();
  try {
    const markerDir = path.join(tmp, 'coalmine');
    fs.mkdirSync(markerDir, { recursive: true });
    const stranded = path.join(markerDir, '.sweep-99999.tmp');
    fs.writeFileSync(stranded, '');
    const old = Date.now() - 99 * 24 * 60 * 60 * 1000; // past the >=1d clamped cutoff
    fs.utimesSync(stranded, new Date(old), new Date(old));

    const r = runHook(STOP, JSON.stringify({ session_id: 'STRAND', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    assert.ok(!fs.existsSync(stranded), 'a stale rename temp must be reaped, not orphaned forever (Phoenix #1)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop hook: the sweep throttle marker RE-STAMPS its mtime (the `wx` trap — bare wx would freeze it)', () => {
  // Guards the trap the obvious fix walks into: the sibling markers (touch.js's .memmoved, the
  // AG conductor's session latch) are WRITE-ONCE latches where `wx`'s EEXIST IS the signal — but
  // this marker is a 24h GATE whose mtime must move on every sweep. A bare `{ flag: 'wx' }` swap
  // fails EEXIST once the file exists, the empty catch swallows it, the mtime freezes, and after
  // the first 24h the sweep then runs on EVERY stop forever. Hence per-pid-temp + renameSync,
  // which refuses the symlink AND keeps overwrite semantics. No privilege needed — runs anywhere.
  const tmp = mkTmp();
  try {
    const marker = path.join(tmp, 'coalmine', 'rot-canary-sweep.marker');
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, '');
    const stale = Date.now() - 99 * 24 * 60 * 60 * 1000; // well past the 24h gate
    fs.utimesSync(marker, new Date(stale), new Date(stale));

    const r = runHook(STOP, JSON.stringify({ session_id: 'STAMP', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    assert.ok(fs.existsSync(marker), 'the marker still exists after the sweep (it is the gate, not garbage)');
    assert.ok(
      fs.lstatSync(marker).mtimeMs > stale + 60 * 1000,
      're-stamped: an expired throttle marker must get a FRESH mtime, or the 24h gate never closes again',
    );
    assert.ok(
      !fs.readdirSync(path.dirname(marker)).some((f) => f.endsWith('.tmp')),
      'the per-pid rename temp must never be left behind (Phoenix #1 — the subdir sweep only collects *.marker)',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop hook: a pre-planted SYMLINK at the marker SUBDIR is refused — nothing written through it (CWK-031/U8)', (t) => {
  const tmp = mkTmp();
  const target = mkTmp(); // attacker-controlled dir the planted symlink points at
  try {
    // mkdirSync(recursive) SILENTLY succeeds on a pre-planted symlink at os.tmpdir()/coalmine,
    // following it with the 0o700 mode unapplied — so the marker write would land inside the
    // attacker's dir. Same lstat (no-follow) dir guard the AG conductor already ships; here the
    // fail-closed branch skips the write AND the sweep.
    const markerDir = path.join(tmp, 'coalmine');
    try {
      fs.symlinkSync(target, markerDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (e) {
      t.skip(`symlink/junction unavailable (${e.code}) — cannot exercise the dir-symlink guard`);
      return; // t.skip does not stop the body; return so this is a visible skip, never a vacuous pass
    }
    const r = runHook(STOP, JSON.stringify({ session_id: 'DIRSYM', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0, 'fail-closed still exits 0 (Phoenix #4)');
    assert.equal(r.stderr, '', 'no stderr (Phoenix #13)');
    assert.equal(fs.readdirSync(target).length, 0, 'nothing written THROUGH the symlinked subdir into the attacker dir');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('stop hook clamps tempSweepStaleDays:-30 → does NOT delete a future-dated concurrent temp (board round-3 LOW)', () => {
  // Before the read-time clamp, {tempSweepStaleDays:-30} pushed the cutoff 30 days into the
  // FUTURE (cutoff = now - (-30)d = now + 30d), so `mtime < cutoff` held even for files NEWER
  // than now — the sweep deleted a concurrent session's live temp. Clamped to 0 → cutoff = now
  // → a file dated in the future survives. A future mtime is the observable that separates the
  // two: unclamped deletes it (< now+30d), clamped keeps it (not < now).
  const tmp = mkTmp();
  try {
    const future = path.join(tmp, 'rot-canary-CONCURRENT.touched');
    fs.writeFileSync(future, 'C:\\proj\\y.js\n');
    const ahead = Date.now() + 10 * 24 * 60 * 60 * 1000; // 10 days ahead — inside the buggy 30d future window
    fs.utimesSync(future, new Date(ahead), new Date(ahead));
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ tempSweepStaleDays: -30 }), 'utf8');
    // No .touched for THIS session → the hook sweeps, then bails (nothing to nudge).
    const r = runHook(STOP, JSON.stringify({ session_id: 'CLAMP', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    assert.ok(fs.existsSync(future), 'a negative override must not push the cutoff into the future and delete a live temp');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("stop hook floors tempSweepStaleDays:0 to >=1 — must not delete this session's own recent marker (M1)", () => {
  // Before the >=1 floor, tempSweepStaleDays:0 pushed the sweep cutoff to "now".
  // sweepStale() runs BEFORE this session's own .touched is read below, so a
  // marker written moments earlier in the SAME session (already older than "now"
  // by the time the sweep runs) was deleted too — silently suppressing this
  // session's own end-of-scan nudge. Backdating by a few seconds (not a full day)
  // reproduces "recent but strictly before now" deterministically without relying
  // on process-spawn timing jitter.
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ tempSweepStaleDays: 0 }), 'utf8');
    const real = path.join(tmp, 'edited-a.js');
    fs.writeFileSync(real, 'x');
    const base = path.join(tmp, 'rot-canary-S7');
    fs.writeFileSync(base + '.touched', real + '\n');
    const recent = Date.now() - 5000;
    fs.utimesSync(base + '.touched', new Date(recent), new Date(recent));

    const r = runHook(STOP, JSON.stringify({ session_id: 'S7', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.decision, 'block', 'tempSweepStaleDays:0 must not sweep away this session\'s own few-seconds-old marker');
    assert.ok(out.reason.includes('edited-a.js'), 'the nudge still lists the touched file');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanExcludePaths (2026-07-30): a matching touched file is dropped from the nudge, a non-matching one still surfaces, and the skip count is reported', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ scanExcludePaths: ['scratchpad'] }), 'utf8');
    const kept = path.join(tmp, 'real-code.js');
    const skipped = path.join(tmp, 'scratchpad-probe.js');
    fs.writeFileSync(kept, 'x');
    fs.writeFileSync(skipped, 'x');
    const base = path.join(tmp, 'rot-canary-SE1');
    fs.writeFileSync(base + '.touched', `${kept}\n${skipped}\n`);

    const r = runHook(STOP, JSON.stringify({ session_id: 'SE1', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.decision, 'block');
    assert.ok(out.reason.includes('real-code.js'), 'non-excluded file still surfaces in the nudge');
    assert.ok(!out.reason.includes('scratchpad-probe.js'), 'excluded file must not appear in the nudge');
    assert.ok(out.reason.includes('1 file(s) skipped'), 'skip clause reports the correct count — autopilot is still running, not dead');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanExcludePaths (CWK-054): when EVERY touched file is excluded, the stop discloses it on the quiet channel instead of going silent', () => {
  // Before CWK-054 this case emitted `{}` — byte-identical to a session where the scan
  // ran and found nothing. A suppressed scan must not look like a clean one.
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ scanExcludePaths: ['scratchpad'] }), 'utf8');
    const a = path.join(tmp, 'scratchpad-a.js');
    const b = path.join(tmp, 'scratchpad-b.js');
    fs.writeFileSync(a, 'x');
    fs.writeFileSync(b, 'x');
    const base = path.join(tmp, 'rot-canary-SE9');
    fs.writeFileSync(base + '.touched', `${a}
${b}
`);

    const r = runHook(STOP, JSON.stringify({ session_id: 'SE9', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.ok(out.systemMessage, 'the all-excluded case must surface SOMETHING, not stay silent');
    assert.ok(out.systemMessage.includes('2'), 'the note carries the suppressed COUNT');
    assert.ok(out.systemMessage.includes('scanExcludePaths'), 'the note NAMES the knob that did the cutting');
    assert.ok(out.systemMessage.includes('scanEverything'), 'the note names the override key by its positive polarity');
    // QUIET, not loud: no severity table, no fix menu, no blocking Stop.
    assert.equal(out.decision, undefined, 'the note must NOT ride the loud blocking reason');
    assert.equal(out.reason, undefined, 'no scan report is owed — nothing was scanned');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanExcludePaths (CWK-054): anti-cry-wolf holds — a stop that touched NOTHING is still fully silent', () => {
  // The new disclosure fires on "touched AND all cut", never on "touched nothing".
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ scanExcludePaths: ['scratchpad'] }), 'utf8');
    const base = path.join(tmp, 'rot-canary-SE10');
    fs.writeFileSync(base + '.touched', '');

    const r = runHook(STOP, JSON.stringify({ session_id: 'SE10', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    // Total silence here is an EMPTY stdout, not '{}': with no extant file, no drift and
    // nothing suppressed the hook returns BEFORE the emit block and writes nothing at all.
    assert.equal(r.stdout, '', 'nothing touched → nothing written at all, exactly as before');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanEverything (CWK-057): bypasses scanExcludePaths — an excluded file IS scanned, and the run says so', () => {
  // THE SABOTAGE TARGET. Remove either bypass in rot-canary-stop.js and this goes RED:
  // the early return in getScanExcludePaths(), or the !scanEverythingOn() guard on the cap.
  const tmp = mkTmp();
  try {
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    // GLOBAL layer carries the key: a project-level true would be CLAMPED to false by
    // hooks-safety.md §9 (that clamp has its own test below), so arming it from the project
    // layer here would prove the clamp works, not that the bypass works.
    fs.writeFileSync(path.join(tmp, '.claude', '.coalmine.json'), JSON.stringify({ scanEverything: true }), 'utf8');
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ scanExcludePaths: ['scratchpad'] }), 'utf8');
    const excluded = path.join(tmp, 'scratchpad-probe.js');
    fs.writeFileSync(excluded, 'x');
    const base = path.join(tmp, 'rot-canary-SE11');
    fs.writeFileSync(base + '.touched', excluded + '\n');

    const r = runHook(STOP, JSON.stringify({ session_id: 'SE11', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    // The cut is genuinely bypassed: the file the exclude names is IN the scan list.
    assert.equal(out.decision, 'block', 'a scan report must exist — the excluded file was scanned');
    assert.ok(out.reason.includes('scratchpad-probe.js'), 'scanEverything must defeat scanExcludePaths');
    assert.ok(!out.reason.includes('skipped per scanExcludePaths'), 'nothing was skipped, so no skip clause');
    // And the run discloses its own scope, on the SAME quiet channel (CWK-054's twin).
    assert.ok(out.systemMessage && out.systemMessage.includes('scanEverything'),
      'an unfiltered run must be as legible as a suppressed one');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanEverything (CWK-057): bypasses the autoScanFileCap slice — every touched file is scanned, not the newest N', () => {
  // The cap is the more dangerous of the two cuts: an excluded path is at least NAMED in
  // config, a capped file is dropped by mtime with nothing pointing at it.
  const tmp = mkTmp();
  try {
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coalmine.json'), JSON.stringify({ scanEverything: true }), 'utf8');
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ autoScanFileCap: 2, autoScanFileCapSlice: 1 }), 'utf8');
    const files = [];
    for (let i = 0; i < 4; i++) {
      const f = path.join(tmp, `capped-${i}.js`);
      fs.writeFileSync(f, 'x');
      files.push(f);
    }
    const base = path.join(tmp, 'rot-canary-SE13');
    fs.writeFileSync(base + '.touched', files.join('\n') + '\n');

    const r = runHook(STOP, JSON.stringify({ session_id: 'SE13', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    for (const f of files) {
      assert.ok(out.reason.includes(path.basename(f)), `${path.basename(f)} must survive the cap under scanEverything`);
    }
    assert.ok(!out.reason.includes('Auto-scan capped'), 'no cap notice — the cap did not fire at all');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanEverything (CWK-057): a PROJECT-level true is clamped to false when the global layer is silent (hooks-safety.md §9)', () => {
  // A cloned repo must not be able to force a full scan on your machine. Same safer-value-wins
  // shape as enableConductor/rotCanaryMode, opposite polarity: here `true` is the LOUDER side.
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, '.coalmine.json'),
      JSON.stringify({ scanEverything: true, scanExcludePaths: ['scratchpad'] }), 'utf8');
    const excluded = path.join(tmp, 'scratchpad-probe.js');
    const kept = path.join(tmp, 'real-code.js');
    fs.writeFileSync(excluded, 'x');
    fs.writeFileSync(kept, 'x');
    const base = path.join(tmp, 'rot-canary-SE12');
    fs.writeFileSync(base + '.touched', kept + '\n' + excluded + '\n');

    const r = runHook(STOP, JSON.stringify({ session_id: 'SE12', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.ok(!out.reason.includes('scratchpad-probe.js'), 'the clamp holds: a project-only true does NOT bypass the exclude');
    assert.ok(out.reason.includes('skipped per scanExcludePaths'), 'the exclude still fired, so its skip clause still shows');
    assert.ok(!(out.systemMessage || '').includes('scanEverything is ON'), 'and the override notice must not claim an override that was clamped away');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanExcludePaths honors a * wildcard fragment (lightweight glob, not a full glob engine)', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ scanExcludePaths: ['*.scratch.js'] }), 'utf8');
    const kept = path.join(tmp, 'probe.js');
    const skipped = path.join(tmp, 'probe.scratch.js');
    fs.writeFileSync(kept, 'x');
    fs.writeFileSync(skipped, 'x');
    const base = path.join(tmp, 'rot-canary-SE3');
    fs.writeFileSync(base + '.touched', `${kept}\n${skipped}\n`);

    const r = runHook(STOP, JSON.stringify({ session_id: 'SE3', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.ok(out.reason.includes('probe.js') && !out.reason.includes('probe.scratch.js'), 'the wildcard fragment matched only the intended file');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanExcludePaths: consecutive "*" in a fragment cannot blow the latency budget (ReDoS bound; H1)', () => {
  // Before this fix, K consecutive '*' compiled to K consecutive '.*' groups —
  // catastrophic backtracking on a non-matching path. Measured through the shipped
  // hook: a 4-star fragment against a ~180-char non-matching path HUNG 18-30s (a
  // regex .test() hang cannot be caught by try/catch, so this was a silent
  // session-end freeze, not a crash). Same shape as the size-tripwire ReDoS bound
  // at hooks.test.mjs's poison-declaration test above — SHIPPED-DEFAULTS-reachable,
  // any project .coalmine.json (untrusted, hooks-safety.md section 9) can plant it.
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ scanExcludePaths: ['****ZZZ'] }), 'utf8');
    // Long, non-matching filename reproduces the backtracking shape; 150 'a's plus
    // the sandbox tmp path comfortably clears the ~180-char repro length.
    const f = path.join(tmp, 'a'.repeat(150) + '.js');
    fs.writeFileSync(f, 'x');
    const base = path.join(tmp, 'rot-canary-SE6');
    fs.writeFileSync(base + '.touched', f + '\n');

    const t0 = Date.now();
    const r = runHook(STOP, JSON.stringify({ session_id: 'SE6', stop_hook_active: false }), tmp);
    const ms = Date.now() - t0;
    assert.equal(r.status, 0);
    assert.ok(ms < 2000, `stop hook took ${ms} ms matching a consecutive-"*" fragment — the collapse-to-single-".*" bound is gone`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.decision, 'block', 'the file does not contain "ZZZ" so it must not match — and must still surface in the nudge');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanExcludePaths: alternating "*" (the classic evil-regex shape) cannot blow the latency budget either (ReDoS bound; H1 round 2)', () => {
  // Round 1's collapse-consecutive-'*' fix only closed the "many stars in a row"
  // shape (the test above). A fragment with SEPARATED wildcards ("a*a*a*...ZZZ",
  // the textbook evil-regex pattern) still compiled to multiple non-adjacent '.*'
  // groups under the regex approach — measured live before this fix: a 10-star
  // alternating fragment against a non-matching path with just 30 extra characters
  // of slack took 13.5s, growing exponentially with slack. The linear segment
  // matcher (matchesFragment) has no regex in its hot path at all, so this is now
  // O(fragment length + path length) regardless of how the '*' are arranged.
  const tmp = mkTmp();
  try {
    const frag = 'a*'.repeat(10) + 'ZZZ'; // 'ZZZ' as the improbable-by-chance marker (matches the sibling test's convention)
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ scanExcludePaths: [frag] }), 'utf8');
    const f = path.join(tmp, 'a'.repeat(100) + '.js'); // no 'ZZZ' -> forces a full non-match scan
    fs.writeFileSync(f, 'x');
    const base = path.join(tmp, 'rot-canary-SE8');
    fs.writeFileSync(base + '.touched', f + '\n');

    const t0 = Date.now();
    const r = runHook(STOP, JSON.stringify({ session_id: 'SE8', stop_hook_active: false }), tmp);
    const ms = Date.now() - t0;
    assert.equal(r.status, 0);
    assert.ok(ms < 2000, `stop hook took ${ms} ms matching an alternating-"*" fragment — the linear-matcher bound is gone`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.decision, 'block', 'the file does not contain "ZZZ" so it must not match — and must still surface in the nudge');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanExcludePaths fragments use "/" portably — a "/"-separated fragment still matches on a "\\"-separated touched path (M1)', () => {
  // The doc's own example ("**/scratchpad/**") compiled against an UN-normalized
  // Windows path (\-separated) silently failed to match — a Windows user following
  // the example got a no-op exclusion with no error. path.join here uses the native
  // separator, so this test exercises the real bug/fix on whichever platform runs it.
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ scanExcludePaths: ['**/scratchpad/**'] }), 'utf8');
    fs.mkdirSync(path.join(tmp, 'scratchpad'), { recursive: true });
    const f = path.join(tmp, 'scratchpad', 'probe.mjs');
    fs.writeFileSync(f, 'x');
    const base = path.join(tmp, 'rot-canary-SE7');
    fs.writeFileSync(base + '.touched', f + '\n');

    const r = runHook(STOP, JSON.stringify({ session_id: 'SE7', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    // AMENDED CWK-054: was `stdout === ''`. That assertion proved the file produced no LOUD
    // report, which is weaker than what this test is actually for — an emit of nothing at all
    // would also pass it. The all-excluded quiet note now carries the skip COUNT, so the
    // exclusion itself is directly observable: count 1 means the fragment matched.
    const out = JSON.parse(r.stdout);
    assert.equal(out.reason, undefined, 'excluded file must not reach the loud scan report');
    assert.ok(out.systemMessage && out.systemMessage.includes('all 1 touched file(s)'),
      'the "/"-separated example fragment must exclude the file regardless of the OS path separator — the skip count proves the match');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanExcludePaths: a literal "?" in a fragment does not over-match (regression, negative arm — runs on every platform)', () => {
  // Before this fix, fragmentToRegExp escaped every regex metachar EXCEPT '?', so
  // "notes?.js" compiled to /notes?\.js/i — 's' optional — and ALSO matched the
  // unrelated "note.js", silently widening the exclude past what the user wrote.
  // Split from the literal-match arm below on purpose (L2 / a repeat of the
  // size-tripwire lesson: t.skip() marks the WHOLE test skipped, so a skippable
  // leg sharing a test with a leg that runs hides the runnable leg's real pass).
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ scanExcludePaths: ['notes?.js'] }), 'utf8');
    const unrelated = path.join(tmp, 'notes.js'); // must NOT match — 's' must not become optional
    fs.writeFileSync(unrelated, 'x');
    const base = path.join(tmp, 'rot-canary-SE5');
    fs.writeFileSync(base + '.touched', unrelated + '\n');

    const r = runHook(STOP, JSON.stringify({ session_id: 'SE5', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.decision, 'block', 'the unrelated file must still surface — a literal "?" fragment must not match it');
    assert.ok(out.reason.includes('notes.js'), 'notes.js was wrongly excluded before the fix');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanExcludePaths: a literal "?" in a fragment matches its literal target (regression, positive arm — capability-gated)', (t) => {
  // '?' is a reserved character in Windows filenames, so a file literally named
  // "notes?.js" cannot exist on this platform — only a Unix-like filesystem can
  // prove the fragment ALSO matches its literal target, not just that it stopped
  // over-matching (proven by the sibling test above, which runs everywhere).
  // Own test, own visible skip — never folded into a test that also runs.
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ scanExcludePaths: ['notes?.js'] }), 'utf8');
    let literalFile;
    try {
      literalFile = path.join(tmp, 'notes?.js');
      fs.writeFileSync(literalFile, 'x');
    } catch (e) {
      t.skip(`cannot create a file literally named "notes?.js" on this volume (${e.code}) — this arm needs a Unix-like filesystem`);
      return;
    }
    const base = path.join(tmp, 'rot-canary-SE5B');
    fs.writeFileSync(base + '.touched', literalFile + '\n');
    const r = runHook(STOP, JSON.stringify({ session_id: 'SE5B', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    // AMENDED CWK-054, same reason as the separator test above — and this arm is the one
    // that would have gone red on the Unix CI runners while SKIPPING here, the exact
    // shape that reddened CI in CWK-043. Fixed on the same pass, not left for CI to find.
    const out = JSON.parse(r.stdout);
    assert.equal(out.reason, undefined, 'excluded file must not reach the loud scan report');
    assert.ok(out.systemMessage && out.systemMessage.includes('all 1 touched file(s)'),
      'the fragment must match its own literal target — the skip count proves the exclusion');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanExcludePaths: every touched file excluded + no memory-drift → no LOUD nudge (never a "capped at 0"-style empty scan report)', () => {
  // AMENDED CWK-054. This test previously asserted `stdout === ''` — total silence — and that
  // assertion encoded the RETIRED design as expected behaviour: it would have gone red against
  // the very fix that closed the defect, which is the "a passing test that asserts the old shape
  // is part of the defect, not a regression guard" shape this room has already paid for once.
  // What it was actually protecting is still protected and is what it now asserts: NO empty-list
  // loud nudge. The all-excluded case is disclosed on the quiet channel instead (its own test
  // above); it is no longer indistinguishable from a session that scanned and found nothing.
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ scanExcludePaths: ['probe'] }), 'utf8');
    const skipped = path.join(tmp, 'probe.js');
    fs.writeFileSync(skipped, 'x');
    const base = path.join(tmp, 'rot-canary-SE4');
    fs.writeFileSync(base + '.touched', skipped + '\n');

    const r = runHook(STOP, JSON.stringify({ session_id: 'SE4', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.decision, undefined, 'no blocking Stop — there is no scan report to make');
    assert.equal(out.reason, undefined, 'no empty-list nudge: the loud report is not built at all');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// --- Two-level config (v3.9.0): global ~/.claude/.coalmine.json + project git-root file ---
// The sandbox maps USERPROFILE/HOME to tmp, so the global layer is <tmp>/.claude/.coalmine.json
// and the project layer is <tmp>/.coalmine.json (cwd = tmp, no .git → findGitRoot returns tmp).

test('GLOBAL .coalmine.json alone is honored (the layer that was previously never read)', () => {
  const tmp = mkTmp();
  try {
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coalmine.json'), JSON.stringify({ enableConductor: false }), 'utf8');
    const r = runHook(CONDUCTOR, '', tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'a global-layer enableConductor:false must silence the conductor with no project file present');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('project .coalmine.json overrides the global per NON-safety key (project wins) — but a project cannot escalate enableConductor past an explicit global false (board #113)', () => {
  // board #113: this test used to plant enableConductor:false(global)/true(project) and
  // assert the project value WON — that was the live escalation bug, not a feature. A
  // non-safety key (skipOnboarding) still shows plain project-wins; enableConductor now
  // shows the SAFER_ENUM clamp instead.
  const tmp = mkTmp();
  try {
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coalmine.json'), JSON.stringify({ enableConductor: false, skipOnboarding: false }), 'utf8');
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ enableConductor: true, skipOnboarding: true }), 'utf8');
    const r = runHook(CONDUCTOR, '', tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'global enableConductor:false must hold — project true is clamped back to false, so nothing is emitted at all (skipOnboarding never gets a chance to matter)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('enableConductor safer-value-wins: legacy-key-only escalation (global conductor:false, project conductor:true) is clamped (board #113)', () => {
  const tmp = mkTmp();
  try {
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coalmine.json'), JSON.stringify({ conductor: false }), 'utf8');
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ conductor: true }), 'utf8');
    const r = runHook(CONDUCTOR, '', tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'global conductor:false (legacy key) must hold even when project escalates via the SAME legacy key name — the clamp result is mirrored into both key names');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// --- rotCanaryMode / disabledCanaries safer-value-wins (board #113) ---
// Read at rot-canary-stop.js's projectOverride(): disabledCanaries.includes('rot-canary'/'all')
// or rotCanaryMode === 'off'/'manual' both drive canaryActive=false, which skips the scan
// entirely (stdout stays ''); an escalation past an explicit global choice means the scan
// wrongly RUNS (non-empty stdout naming the touched file).

function plantTouchedFixture(tmp, label) {
  const f = path.join(tmp, `${label}.js`);
  fs.writeFileSync(f, 'x');
  fs.writeFileSync(path.join(tmp, `rot-canary-${label}.touched`), `${f}\n`);
  return f;
}

test('rotCanaryMode safer-value-wins: project cannot escalate an explicit global "off" to "auto" (board #113)', () => {
  const tmp = mkTmp();
  try {
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coalmine.json'), JSON.stringify({ rotCanaryMode: 'off' }), 'utf8');
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ rotCanaryMode: 'auto' }), 'utf8');
    plantTouchedFixture(tmp, 'RM1');
    const r = runHook(STOP, JSON.stringify({ session_id: 'RM1', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'global off must hold — project auto is clamped back to off, scan must not run');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('rotCanaryMode safer-value-wins: legacy-key-only escalation (global mode:off, project rotCanaryMode:auto, cross-key) is clamped (board #113)', () => {
  const tmp = mkTmp();
  try {
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coalmine.json'), JSON.stringify({ mode: 'off' }), 'utf8');
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ rotCanaryMode: 'auto' }), 'utf8');
    plantTouchedFixture(tmp, 'RM2');
    const r = runHook(STOP, JSON.stringify({ session_id: 'RM2', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', "global's legacy 'mode:off' must hold even though project used the canonical key name — the clamp resolves both sides through either name");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('rotCanaryMode safer-value-wins: the WINNING value is stored CANONICAL (lowercase), not the raw-cased input — a non-escalating project "OFF" must still read as off (board #113, the CoalWash K1 storage trap)', () => {
  // Not an escalation attempt: project types 'OFF' (uppercase) meaning the SAME safe
  // value as global's 'off'. The clamp's own comparison folds case correctly either
  // way; what this test isolates is whether the STORED merge output is re-foldable by
  // a consumer that compares with strict === (rot-canary-stop.js's own `mode === 'off'`
  // does NOT .toLowerCase() first, unlike updateMode's consumer).
  const tmp = mkTmp();
  try {
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coalmine.json'), JSON.stringify({ rotCanaryMode: 'off' }), 'utf8');
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ rotCanaryMode: 'OFF' }), 'utf8');
    plantTouchedFixture(tmp, 'RM3');
    const r = runHook(STOP, JSON.stringify({ session_id: 'RM3', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'a canonically-equal but differently-cased project value must still resolve to off, not silently fall through as if unmatched');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('disabledCanaries safer-value-wins: project cannot clear an explicit global disable list via UNION merge (board #113)', () => {
  const tmp = mkTmp();
  try {
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coalmine.json'), JSON.stringify({ disabledCanaries: ['rot-canary'] }), 'utf8');
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ disabledCanaries: [] }), 'utf8');
    plantTouchedFixture(tmp, 'DC1');
    const r = runHook(STOP, JSON.stringify({ session_id: 'DC1', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', "global's disable list must survive a project's empty override — union, not replace");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('disabledCanaries safer-value-wins: legacy-key-only escalation (global disable:[rot-canary], project disabledCanaries:[], cross-key) is unioned (board #113)', () => {
  const tmp = mkTmp();
  try {
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coalmine.json'), JSON.stringify({ disable: ['rot-canary'] }), 'utf8');
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ disabledCanaries: [] }), 'utf8');
    plantTouchedFixture(tmp, 'DC2');
    const r = runHook(STOP, JSON.stringify({ session_id: 'DC2', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', "global's legacy 'disable' list must survive a project clearing the canonical key — resolved through either name before unioning");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('disabledCanaries case-fold: a hand-edited uppercase global entry still disables the canary (board #113)', () => {
  // Global-only, no project file at all — isolates the case-fold from the union/clamp
  // logic entirely. config-schema.mjs's `lower: true` is enforced by configure.mjs on
  // WRITE; a hand-edited file bypasses it, and the read site's `.includes('rot-canary')`
  // is a raw, case-sensitive check.
  const tmp = mkTmp();
  try {
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coalmine.json'), JSON.stringify({ disabledCanaries: ['ROT-CANARY'] }), 'utf8');
    plantTouchedFixture(tmp, 'DC3');
    const r = runHook(STOP, JSON.stringify({ session_id: 'DC3', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'an uppercase-cased global entry must still match the lowercase canary id it names');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('merge drops __proto__/constructor/prototype keys (pollution cannot ride the overlay)', () => {
  const tmp = mkTmp();
  try {
    // An untrusted project config trying to smuggle enableConductor:false through __proto__:
    // the merge must drop the key entirely, so the conductor still emits.
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coalmine.json'), JSON.stringify({ skipOnboarding: true }), 'utf8');
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), '{ "__proto__": { "enableConductor": false }, "constructor": { "x": 1 }, "prototype": { "y": 2 } }', 'utf8');
    const r = runHook(CONDUCTOR, '', tmp);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('[CoalMine]'), 'proto-shaped keys must be dropped at merge, never honored');
    assert.ok(!r.stdout.includes('offer /gold-standard ONCE'), 'the global layer keys still apply through the merge');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('scanExcludePaths merges as a UNION across global+project — a project list cannot silently drop a global exclusion (hooks-safety.md section 9)', () => {
  const tmp = mkTmp();
  try {
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', '.coalmine.json'), JSON.stringify({ scanExcludePaths: ['global-lab'] }), 'utf8');
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ scanExcludePaths: ['project-lab'] }), 'utf8');

    const kept = path.join(tmp, 'real.js');
    const globalExcluded = path.join(tmp, 'global-lab-probe.js');
    const projectExcluded = path.join(tmp, 'project-lab-probe.js');
    fs.writeFileSync(kept, 'x');
    fs.writeFileSync(globalExcluded, 'x');
    fs.writeFileSync(projectExcluded, 'x');
    const base = path.join(tmp, 'rot-canary-SE2');
    fs.writeFileSync(base + '.touched', `${kept}\n${globalExcluded}\n${projectExcluded}\n`);

    const r = runHook(STOP, JSON.stringify({ session_id: 'SE2', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.ok(out.reason.includes('real.js'), 'a non-excluded file still surfaces');
    assert.ok(!out.reason.includes('global-lab-probe.js'), 'the GLOBAL exclusion must still apply even though the project set its own list (union, not override)');
    assert.ok(!out.reason.includes('project-lab-probe.js'), 'the project exclusion applies too');
    assert.ok(out.reason.includes('2 file(s) skipped'), 'both exclusions counted in the skip clause');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// --- Antigravity adapter (AG mode = event-name argv, per platform-configs/hooks/
// antigravity-hooks.json). Same real hooks, spawned hermetically with AG-shaped
// fixture stdin in both casing variants (snake_case core / camelCase toolCall).

// The sanctioned AG PreInvocation output (contract re-derived 2026-07-23 from the
// installed engine): exactly {"injectSteps":[{"ephemeralMessage": ...}]} — the
// pilot-era flat additionalContext key is a dead letter in the engine and must
// never appear (nor the CC decision protocol; the key-set assert covers both).
function agInject(stdout) {
  const out = JSON.parse(stdout);
  assert.deepEqual(Object.keys(out), ['injectSteps'], 'injectSteps is the ONLY key (current AG PreInvocation output contract)');
  assert.equal(out.injectSteps.length, 1, 'exactly one injected step');
  assert.deepEqual(Object.keys(out.injectSteps[0]), ['ephemeralMessage'], 'ephemeralMessage (transient system message) is the step type');
  return out.injectSteps[0].ephemeralMessage;
}

test('AG conductor: first PreInvocation injects the directive ONCE (injectSteps/ephemeralMessage); repeats are silent (marker throttle)', () => {
  const tmp = mkTmp();
  try {
    fs.mkdirSync(path.join(tmp, '.git')); // anchor findGitRoot inside the sandbox
    const stdin = JSON.stringify({ session_id: 'AGC1', cwd: tmp, hook_event_name: 'PreInvocation' });
    const first = runHook(CONDUCTOR, stdin, tmp, ['PreInvocation']);
    assert.equal(first.status, 0);
    assert.equal(first.stderr, '', 'no stderr (Phoenix #13)');
    const msg = agInject(first.stdout);
    assert.ok(msg.includes('[CoalMine]'), 'AG emit is the sanctioned injectSteps/ephemeralMessage JSON');
    assert.ok(!msg.includes('self-update'), 'KIND 1 (CC plugin machinery) is skipped on AG');
    assert.ok(!fs.existsSync(path.join(tmp, '.claude', '.coalmine-update-check')), 'AG must not consume the CC update stamp');
    assert.ok(
      fs.readdirSync(path.join(tmp, 'coalmine')).some((f) => f.startsWith('ag-conductor-') && f.endsWith('.marker')),
      'once-per-session marker written to the private coalmine/ subdir (CodeQL js/insecure-temporary-file fix)',
    );

    const second = runHook(CONDUCTOR, stdin, tmp, ['PreInvocation']);
    assert.equal(second.status, 0);
    assert.equal(second.stdout, '', 'PreInvocation fires per model call — the marker must silence every repeat');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AG conductor: a pre-existing marker (EEXIST on the wx create) causes a silent skip — exit 0, no output', () => {
  const tmp = mkTmp();
  try {
    fs.mkdirSync(path.join(tmp, '.git'));
    const markerDir = path.join(tmp, 'coalmine');
    fs.mkdirSync(markerDir, { recursive: true, mode: 0o700 });
    const key = 'AGPLANTED';
    // Plant the exact marker the conductor would compute for this session key
    // BEFORE the hook ever runs — proves the wx create genuinely hits EEXIST
    // against the SAME path, not merely "some file already in the dir".
    fs.writeFileSync(path.join(markerDir, `ag-conductor-${djb2(key)}.marker`), '');
    const stdin = JSON.stringify({ session_id: key, cwd: tmp, hook_event_name: 'PreInvocation' });
    const r = runHook(CONDUCTOR, stdin, tmp, ['PreInvocation']);
    assert.equal(r.status, 0, 'EEXIST is caught and treated as fail-silent (Phoenix #4)');
    assert.equal(r.stdout, '', 'a pre-existing marker must skip the emit entirely');
    assert.equal(r.stderr, '', 'no stderr (Phoenix #13)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AG conductor: unwritable tmp (TEMP/TMP/TMPDIR point at a FILE, ENOTDIR) fails closed — no emit, exit 0', () => {
  const tmp = mkTmp();
  const fakeTmpFile = path.join(tmp, 'not-a-dir'); // a FILE standing in for os.tmpdir()
  fs.writeFileSync(fakeTmpFile, '');
  try {
    const stdin = JSON.stringify({ session_id: 'AGUNWRITABLE', cwd: tmp, hook_event_name: 'PreInvocation' });
    // A merely-nonexistent TMPDIR would NOT reproduce this: mkdirSync({recursive:true})
    // just creates it. Pointing at an existing FILE makes the coalmine/ subdir
    // create fail with ENOTDIR — the real "can't write" case.
    const r = spawnSync(process.execPath, [CONDUCTOR, 'PreInvocation'], {
      input: stdin,
      encoding: 'utf8',
      cwd: tmp,
      env: { ...process.env, TEMP: fakeTmpFile, TMP: fakeTmpFile, TMPDIR: fakeTmpFile, USERPROFILE: tmp, HOME: tmp },
    });
    assert.equal(r.status, 0, 'fail-closed still exits 0 (Phoenix #4)');
    assert.equal(r.stdout, '', 'an unwritable tmp (ENOTDIR on mkdirSync) must skip the emit, never crash or leak an error');
    assert.equal(r.stderr, '', 'no stderr (Phoenix #13)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AG conductor: a pre-planted SYMLINK at the marker subdir is refused — no marker in the target, no emit (dir-symlink close)', (t) => {
  const tmp = mkTmp();
  const target = mkTmp(); // attacker-controlled dir the planted symlink points at
  try {
    fs.mkdirSync(path.join(tmp, '.git'));
    // mkdirSync(recursive) FOLLOWS a pre-planted symlink at os.tmpdir()/coalmine (silently
    // succeeding, 0o700 unapplied); without the lstat guard the wx marker writes THROUGH into
    // `target`. The guard must lstat (no-follow) + fail-closed (skip the emit), the advisory class.
    const markerDir = path.join(tmp, 'coalmine');
    try {
      fs.symlinkSync(target, markerDir, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      t.skip('symlink/junction unavailable (needs privilege) — cannot exercise the dir-symlink guard');
      return; // t.skip does not stop the body; return so the case is skipped, never a vacuous pass
    }
    const stdin = JSON.stringify({ session_id: 'AGSYM', cwd: tmp, hook_event_name: 'PreInvocation' });
    const r = runHook(CONDUCTOR, stdin, tmp, ['PreInvocation']);
    assert.equal(r.status, 0, 'fail-closed still exits 0 (Phoenix #4)');
    assert.equal(r.stdout, '', 'a symlinked marker subdir must skip the emit entirely (fail-closed)');
    assert.equal(r.stderr, '', 'no stderr (Phoenix #13)');
    assert.equal(fs.readdirSync(target).length, 0, 'no marker written THROUGH the symlink into the attacker dir');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('AG conductor: transcript_path keys the session when session_id is absent; no key / garbage → silent', () => {
  const tmp = mkTmp();
  try {
    const byTranscript = runHook(CONDUCTOR, JSON.stringify({ transcript_path: 'C:/x/t.jsonl' }), tmp, ['PreInvocation']);
    assert.equal(byTranscript.status, 0);
    assert.ok(agInject(byTranscript.stdout).includes('[CoalMine]'), 'transcript_path works as the fallback key');

    for (const stdin of [JSON.stringify({}), 'not json {{{', '']) {
      const r = runHook(CONDUCTOR, stdin, tmp, ['PreInvocation']);
      assert.equal(r.status, 0);
      assert.equal(r.stdout, '', 'un-keyable payload → no emit (an unguarded injection would repeat per model call)');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AG conductor: KIND 2 past-due rule nudge rides the guarded injection; enableConductor:false silences AG too', () => {
  const tmp = mkTmp();
  try {
    fs.mkdirSync(path.join(tmp, '.git'));
    const rulesDir = path.join(tmp, '.claude', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    fs.writeFileSync(path.join(rulesDir, 'a.md'), `<!-- coalmine: verified ${old} · exemplar X · revalidate 30d -->\n`, 'utf8');
    const r = runHook(CONDUCTOR, JSON.stringify({ sessionId: 'AGC2', cwd: tmp }), tmp, ['PreInvocation']);
    assert.equal(r.status, 0);
    assert.ok(agInject(r.stdout).includes('past their revalidate date'), 'KIND 2 detected via the camelCase sessionId variant');

    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ enableConductor: false }), 'utf8');
    // Count-based, not filename-based: the marker filename embeds djb2(sessionId)
    // (a hash), never the literal session id, so a `.includes('AGC3')` check on
    // the filename can never match anything — count is the correct observable.
    const beforeCount = fs.readdirSync(path.join(tmp, 'coalmine')).length;
    const off = runHook(CONDUCTOR, JSON.stringify({ session_id: 'AGC3', cwd: tmp }), tmp, ['PreInvocation']);
    assert.equal(off.status, 0);
    assert.equal(off.stdout, '', 'the config gate silences the AG path too');
    assert.equal(
      fs.readdirSync(path.join(tmp, 'coalmine')).length,
      beforeCount,
      'a silenced conductor writes no NEW marker',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AG conductor: onboarding suppression follows the PAYLOAD cwd, not the hook process cwd (redundant-offer fix)', () => {
  const spawnDir = mkTmp(); // the hook PROCESS's own cwd -- NOT the workspace on AG, holds no stamp
  const workDir = mkTmp();  // the payload's cwd -- the real workspace, holds the verified stamp
  try {
    fs.mkdirSync(path.join(workDir, '.git')); // anchor findGitRoot(workDir) at workDir, not further up
    const rulesDir = path.join(workDir, '.claude', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, 'gold-standard.md'), '<!-- coalmine: verified 2026-07-01 revalidate 90d -->\n', 'utf8');
    const stdin = JSON.stringify({ session_id: 'AGCWD1', cwd: workDir, hook_event_name: 'PreInvocation' });
    const r = runHook(CONDUCTOR, stdin, spawnDir, ['PreInvocation']);
    assert.equal(r.status, 0);
    assert.ok(
      !agInject(r.stdout).includes('offer /gold-standard ONCE'),
      'a verified stamp at the PAYLOAD cwd must suppress onboarding even though the hook process cwd (spawnDir) has none -- proves the check follows input.cwd, not process.cwd()',
    );
  } finally {
    fs.rmSync(spawnDir, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

// CURRENT AG spec payload (re-derived 2026-07-23): conversationId + workspacePaths[]
// — no cwd, no session_id. The conductor must key the marker on conversationId and
// resolve the workspace from workspacePaths[0].
test('AG conductor current-spec payload (conversationId + workspacePaths): injects once at the workspace, repeat silent', () => {
  const spawnDir = mkTmp(); // hook process cwd = the hooks.json dir on AG, NOT the workspace
  const workDir = mkTmp();
  try {
    fs.mkdirSync(path.join(workDir, '.git'));
    const rulesDir = path.join(workDir, '.claude', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, 'gold-standard.md'), '<!-- coalmine: verified 2026-07-01 revalidate 90d -->\n', 'utf8');
    const stdin = JSON.stringify({ conversationId: 'AGCONV1', workspacePaths: [workDir] });
    const first = runHook(CONDUCTOR, stdin, spawnDir, ['PreInvocation']);
    assert.equal(first.status, 0);
    const msg = agInject(first.stdout);
    assert.ok(msg.includes('[CoalMine]'), 'a current-spec payload (no cwd/session_id) still injects');
    assert.ok(
      !msg.includes('offer /gold-standard ONCE'),
      'workspacePaths[0] drives the onboarding check (the current spec ships no cwd field)',
    );
    const second = runHook(CONDUCTOR, stdin, spawnDir, ['PreInvocation']);
    assert.equal(second.status, 0);
    assert.equal(second.stdout, '', 'conversationId keys the once-per-session marker');
  } finally {
    fs.rmSync(spawnDir, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("Gemini conductor: SessionStart argv emits the NESTED hookSpecificOutput.additionalContext shape (not AG's flat shape)", () => {
  const tmp = mkTmp();
  try {
    const first = runHook(CONDUCTOR, '', tmp, ['SessionStart']);
    assert.equal(first.status, 0);
    assert.equal(first.stderr, '', 'no stderr (Phoenix #13)');
    const out = JSON.parse(first.stdout);
    assert.ok(out.hookSpecificOutput && out.hookSpecificOutput.additionalContext.includes('[CoalMine]'), 'Gemini emit is the nested hookSpecificOutput.additionalContext shape');
    assert.ok(!('additionalContext' in out), 'never AG\'s flat top-level shape on Gemini');
    assert.ok(!out.hookSpecificOutput.additionalContext.includes('self-update'), 'KIND 1 (CC plugin machinery) is skipped on Gemini, same as AG');
    assert.ok(!fs.existsSync(path.join(tmp, '.claude', '.coalmine-update-check')), 'Gemini must not consume the CC update stamp');
    let noMarkerFiles = [];
    try { noMarkerFiles = fs.readdirSync(path.join(tmp, 'coalmine')); } catch {} // subdir never created is also a pass
    assert.ok(
      !noMarkerFiles.some((f) => f.endsWith('.marker')),
      'Gemini needs no once-per-session marker file — SessionStart already fires once per session',
    );

    const second = runHook(CONDUCTOR, '', tmp, ['SessionStart']);
    assert.equal(second.status, 0);
    assert.ok(
      JSON.parse(second.stdout).hookSpecificOutput.additionalContext.includes('[CoalMine]'),
      'no marker throttle on Gemini — fires every invocation, unlike AG\'s once-per-session guard',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Gemini conductor: KIND 2 past-due rule nudge rides the nested output; enableConductor:false silences it too', () => {
  const tmp = mkTmp();
  try {
    fs.mkdirSync(path.join(tmp, '.git')); // anchor findGitRoot inside the sandbox (Gemini reads process.cwd(), which runHook sets to tmp)
    const rulesDir = path.join(tmp, '.claude', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    fs.writeFileSync(path.join(rulesDir, 'a.md'), `<!-- coalmine: verified ${old} · exemplar X · revalidate 30d -->\n`, 'utf8');
    const r = runHook(CONDUCTOR, '', tmp, ['SessionStart']);
    assert.equal(r.status, 0);
    assert.ok(JSON.parse(r.stdout).hookSpecificOutput.additionalContext.includes('past their revalidate date'), 'KIND 2 detected via process.cwd()');

    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ enableConductor: false }), 'utf8');
    const off = runHook(CONDUCTOR, '', tmp, ['SessionStart']);
    assert.equal(off.status, 0);
    assert.equal(off.stdout, '', 'the config gate silences the Gemini path too');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('file-copy mode (FileCopy argv): plain CC text shape, KIND 1 self-update skipped, update stamp NOT written', () => {
  const tmp = mkTmp();
  try {
    // No config → updateMode defaults to 'ask'. On the plain CC (no-argv) path
    // that emits the KIND 1 ask directive AND writes ~/.claude/.coalmine-update-check.
    // The 5 file-copy platforms (Copilot CLI/Kiro/Augment/Devin CLI/Junie) install
    // by file-copy: a `claude plugin update` offer is a wrong instruction there,
    // and the stamp write would throttle a co-installed real CC's own nudge.
    const r = runHook(CONDUCTOR, '', tmp, ['FileCopy']);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '', 'no stderr (Phoenix #13)');
    assert.ok(r.stdout.includes('[CoalMine]'), 'file-copy mode emits the plain CC text shape');
    assert.ok(!r.stdout.trim().startsWith('{'), 'plain stdout — never the AG/Gemini JSON envelope (FileCopy must not fall into the AG branch)');
    assert.ok(!r.stdout.includes('self-update'), 'KIND 1 (CC plugin machinery) is skipped on file-copy platforms');
    assert.ok(!fs.existsSync(path.join(tmp, '.claude', '.coalmine-update-check')), 'file-copy mode must not consume the shared CC update stamp');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AG touch: toolCall.args payload (camelCase) records the edited file', () => {
  const tmp = mkTmp();
  const proj = mkTmp(); // project dir, sibling of the sandbox os.tmpdir() (tmp) — must live OUTSIDE tmp now
  try {
    const real = path.join(proj, 'edited-b.js');
    fs.writeFileSync(real, 'x');
    const stdin = JSON.stringify({ session_id: 'AGT1', cwd: proj, toolCall: { name: 'write_to_file', args: { filePath: real } } });
    const r = runHook(TOUCH, stdin, tmp, ['PostToolUse']);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'touch stays silent');
    const touched = path.join(tmp, 'rot-canary-AGT1.touched');
    assert.ok(fs.existsSync(touched), '.touched recorded from the AG toolCall.args shape');
    assert.ok(fs.readFileSync(touched, 'utf8').includes('edited-b.js'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('AG stop: emits the explicit no-op {} (no Stop inject channel in the current engine; never decision:block)', () => {
  const tmp = mkTmp();
  try {
    const real = path.join(tmp, 'edited-c.js');
    fs.writeFileSync(real, 'x');
    fs.writeFileSync(path.join(tmp, 'rot-canary-AGS1.touched'), real + '\n');
    const r = runHook(STOP, JSON.stringify({ session_id: 'AGS1' }), tmp, ['Stop']);
    assert.equal(r.status, 0);
    // Contract re-derived 2026-07-23: the engine documents NO Stop-output inject
    // channel; the pilot-era additionalContext key is a dead letter. The valid
    // output is the explicit no-op {} — never the dead key, never decision:block.
    assert.equal(r.stdout.trim(), '{}', 'AG Stop output is the explicit empty object');
    assert.ok(fs.existsSync(path.join(tmp, 'rot-canary-AGS1.scanned')), 'the scan side effects (ack marker) still ran');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// The touch->stop pair shares one tmp-state key chain: on the current AG spec both
// hooks must derive it from conversationId (a split chain would strand the state).
test('AG touch+stop pair on the current-spec payload: conversationId keys the shared state, workspacePaths[0] resolves relative paths', () => {
  const tmp = mkTmp();
  const proj = mkTmp(); // project workspace, sibling of the sandbox os.tmpdir() (tmp) — must live OUTSIDE tmp now
  try {
    fs.writeFileSync(path.join(proj, 'edited-conv.js'), 'x');
    const t1 = runHook(TOUCH, JSON.stringify({
      conversationId: 'AGCONV2',
      workspacePaths: [proj],
      tool_name: 'write_to_file',
      tool_input: { file_path: 'edited-conv.js' }, // relative — must resolve vs workspacePaths[0]
    }), tmp, ['PostToolUse']);
    assert.equal(t1.status, 0);
    assert.equal(t1.stdout, '', 'touch stays silent');
    const touched = path.join(tmp, 'rot-canary-AGCONV2.touched');
    assert.ok(fs.existsSync(touched), '.touched keyed by conversationId');
    assert.ok(fs.readFileSync(touched, 'utf8').includes('edited-conv.js'), 'relative path resolved against workspacePaths[0]');

    const r = runHook(STOP, JSON.stringify({ conversationId: 'AGCONV2' }), tmp, ['Stop']);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '{}', 'AG Stop no-op output');
    assert.ok(fs.existsSync(path.join(tmp, 'rot-canary-AGCONV2.scanned')), 'stop read the conversationId-keyed state (one chain across the pair)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('stop sweep collects stale AG conductor markers (Phoenix #1)', () => {
  const tmp = mkTmp();
  try {
    const stale = path.join(tmp, 'coalmine-conductor-zzz.marker');
    fs.writeFileSync(stale, '');
    const old = Date.now() - 99 * 24 * 60 * 60 * 1000;
    fs.utimesSync(stale, new Date(old), new Date(old));
    const r = runHook(STOP, JSON.stringify({ session_id: 'SWP', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    assert.ok(!fs.existsSync(stale), 'a legacy flat-tmp-root marker (pre-fix install) is still swept with the rot-canary temp');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop sweep collects stale AG conductor markers from the new coalmine/ subdir (CodeQL fix)', () => {
  const tmp = mkTmp();
  try {
    const markerDir = path.join(tmp, 'coalmine');
    fs.mkdirSync(markerDir, { recursive: true, mode: 0o700 });
    const stale = path.join(markerDir, 'ag-conductor-zzz.marker');
    fs.writeFileSync(stale, '');
    const old = Date.now() - 99 * 24 * 60 * 60 * 1000;
    fs.utimesSync(stale, new Date(old), new Date(old));
    const r = runHook(STOP, JSON.stringify({ session_id: 'SWP2', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    assert.ok(!fs.existsSync(stale), 'a stale AG conductor marker in the private coalmine/ subdir is swept too');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop sweep collects conductor markers even when rot-canary is OFF — but still leaves the canary\'s own temp alone (ownership split)', () => {
  // The conductor markers belong to the CONDUCTOR (independently enabled, no stop
  // hook of its own); gating their only collector on rot-canary's mode leaked one
  // marker per AG session forever for an off/manual-canary + conductor-on user.
  // The canary's OWN temp stays untouched when disabled (pinned Node≡PS behavior).
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ disabledCanaries: ['rot-canary'] }), 'utf8');
    const old = Date.now() - 99 * 24 * 60 * 60 * 1000;
    // Stale conductor marker in the new coalmine/ subdir...
    const markerDir = path.join(tmp, 'coalmine');
    fs.mkdirSync(markerDir, { recursive: true, mode: 0o700 });
    const subdirMarker = path.join(markerDir, 'ag-conductor-yyy.marker');
    fs.writeFileSync(subdirMarker, '');
    fs.utimesSync(subdirMarker, new Date(old), new Date(old));
    // ...a stale legacy flat-root marker (pre-fix install)...
    const flatMarker = path.join(tmp, 'coalmine-conductor-yyy.marker');
    fs.writeFileSync(flatMarker, '');
    fs.utimesSync(flatMarker, new Date(old), new Date(old));
    // ...and the canary's OWN stale temp, which a disabled canary must NOT touch.
    const canaryTemp = path.join(tmp, 'rot-canary-OLD2.touched');
    fs.writeFileSync(canaryTemp, 'C:\\proj\\z.js\n');
    fs.utimesSync(canaryTemp, new Date(old), new Date(old));

    const r = runHook(STOP, JSON.stringify({ session_id: 'OFFSWP', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'disabled canary emits nothing');
    assert.ok(!fs.existsSync(subdirMarker), 'stale coalmine/ marker collected even with rot-canary off');
    assert.ok(!fs.existsSync(flatMarker), 'stale legacy flat marker collected even with rot-canary off');
    assert.ok(fs.existsSync(canaryTemp), "the canary's own temp stays untouched when disabled (pinned behavior preserved)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- Memory-drift exit-gate (session-end hygiene surface) ----
// A helper that plants a REAL code file + its .touched record so the stop hook's
// existsSync filter passes, with the sandbox tmp as both TEMP and project root.
function plantCodeSession(tmp, sid) {
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  const code = path.join(proj, 'a.js');
  fs.writeFileSync(code, 'x();\n');
  fs.writeFileSync(path.join(tmp, `rot-canary-${sid}.touched`), code + '\n');
  return code;
}

test('touch hook records a MEMORY.md edit as .memmoved marker, never into .touched', () => {
  const tmp = mkTmp();
  const proj = mkTmp(); // project dir, sibling of the sandbox os.tmpdir() (tmp) — a MEMORY.md UNDER tmp is covered separately (tmpdir-exclusion test below)
  try {
    const mem = path.join(proj, 'MEMORY.md');
    fs.writeFileSync(mem, '# m\n');
    const r = runHook(TOUCH, JSON.stringify({ session_id: 'MD1', tool_input: { file_path: mem } }), tmp);
    assert.equal(r.status, 0);
    assert.ok(fs.existsSync(path.join(tmp, 'rot-canary-MD1.memmoved')), '.memmoved marker created');
    assert.ok(!fs.existsSync(path.join(tmp, 'rot-canary-MD1.touched')), 'MEMORY.md never enters the code .touched list');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('stop hook routes the memory-drift note to systemMessage, decoupled from the loud scan report (board #82: additionalContext at Stop eats -p results)', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, 'MEMORY.md'), '# project memory\n'); // project root uses the convention
    plantCodeSession(tmp, 'MD2');
    const r = runHook(STOP, JSON.stringify({ session_id: 'MD2', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    // The loud scan report is UNCHANGED: still a blocking reason that invokes rot-canary.
    assert.equal(out.decision, 'block', 'scan report still blocks');
    assert.ok(out.reason.includes('rot-canary'), 'scan report still asks to invoke rot-canary');
    assert.ok(!out.reason.includes('memoryDriftNudge'), 'drift note is NOT welded into the loud report');
    // The drift note rides systemMessage, decoupled from the loud `reason` block...
    assert.ok(out.systemMessage && out.systemMessage.includes('memoryDriftNudge'),
      'drift note lands in systemMessage');
    // ...as a soft reminder, carrying no scan / fix-menu framing of its own.
    assert.ok(!out.systemMessage.includes('DEPTH=QUICK'), 'note carries no scan/fix-menu framing');
    // Regression guard for board #82: hookSpecificOutput.additionalContext at Stop
    // forces a phantom second turn that discards a -p session's result — must be gone.
    assert.equal(out.hookSpecificOutput, undefined, 'never hookSpecificOutput on Stop (board #82)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop hook drift-only case (code edited then deleted, no MEMORY update) emits ONLY the quiet note, no loud scan block', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, 'MEMORY.md'), '# project memory\n');
    // Record a code edit whose file no longer exists at stop time (edited then deleted) —
    // "code moved" for the drift check, but nothing extant to scan → no loud report.
    const ghost = path.join(tmp, 'proj', 'gone.js');
    fs.writeFileSync(path.join(tmp, 'rot-canary-MD6.touched'), ghost + '\n');
    const r = runHook(STOP, JSON.stringify({ session_id: 'MD6', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.decision, undefined, 'no blocking decision when the only signal is drift');
    assert.equal(out.reason, undefined, 'no loud scan report when nothing extant to scan');
    assert.ok(out.systemMessage && out.systemMessage.includes('memoryDriftNudge'),
      'the drift note is emitted alone');
    assert.equal(out.hookSpecificOutput, undefined, 'never hookSpecificOutput on Stop (board #82)');
    assert.ok(!r.stdout.includes('DEPTH=QUICK'), 'no scan/fix-menu framing anywhere');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop hook stays drift-silent when a MEMORY.md edit was recorded (.memmoved present)', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, 'MEMORY.md'), '# project memory\n');
    plantCodeSession(tmp, 'MD3');
    fs.writeFileSync(path.join(tmp, 'rot-canary-MD3.memmoved'), '');
    const r = runHook(STOP, JSON.stringify({ session_id: 'MD3', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('rot-canary'), 'the scan nudge itself still fires');
    assert.ok(!r.stdout.includes('memoryDriftNudge'), 'no drift line when memory moved this session');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stop hook stays drift-silent when the project has no MEMORY.md convention', () => {
  const tmp = mkTmp();
  try {
    plantCodeSession(tmp, 'MD4'); // no MEMORY.md at the sandbox project root
    const r = runHook(STOP, JSON.stringify({ session_id: 'MD4', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('rot-canary'), 'the scan nudge itself still fires');
    assert.ok(!r.stdout.includes('memoryDriftNudge'), 'no drift line on a project without MEMORY.md');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('memoryDriftNudge:false silences the drift line but not the scan nudge', () => {
  const tmp = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, 'MEMORY.md'), '# project memory\n');
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), JSON.stringify({ memoryDriftNudge: false }), 'utf8');
    plantCodeSession(tmp, 'MD5');
    const r = runHook(STOP, JSON.stringify({ session_id: 'MD5', stop_hook_active: false }), tmp);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('rot-canary'), 'the scan nudge itself still fires');
    assert.ok(!r.stdout.includes('memoryDriftNudge'), 'config off-switch silences the drift line');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- os.tmpdir() scratch-space exclusion (2026-07-25, dogfood-found) ----
// A long IC campaign writes one-shot harness .mjs files under the SESSION SCRATCHPAD,
// which lives INSIDE os.tmpdir() — every Stop-scan nagged on them. The touch hook must
// exclude anything under its own os.tmpdir() before recording, without excluding a real
// project file that merely happens to live in the test sandbox's chosen TEMP dir.

test('touch hook excludes a file living under the sandbox os.tmpdir() (scratchpad exclusion) — no .touched, no .memmoved', () => {
  const tmp = mkTmp();
  try {
    // A watched-extension file directly under the hook's own os.tmpdir() (TEMP/TMP/TMPDIR
    // all point at tmp) — the dogfood shape: a one-shot IC-campaign harness .mjs under
    // the session scratchpad, which lives INSIDE os.tmpdir().
    const scratch = path.join(tmp, 'harness.mjs');
    fs.writeFileSync(scratch, 'x();\n');
    const r1 = runHook(TOUCH, JSON.stringify({ session_id: 'TMPX1', tool_input: { file_path: scratch } }), tmp);
    assert.equal(r1.status, 0);
    assert.ok(!fs.existsSync(path.join(tmp, 'rot-canary-TMPX1.touched')), 'a tmpdir-resident code file must not be recorded');

    // A MEMORY.md living under the same os.tmpdir() must not set .memmoved either —
    // temp files count for nothing, including the drift-marker convention file.
    const memInTmp = path.join(tmp, 'MEMORY.md');
    fs.writeFileSync(memInTmp, '# scratch\n');
    const r2 = runHook(TOUCH, JSON.stringify({ session_id: 'TMPX2', tool_input: { file_path: memInTmp } }), tmp);
    assert.equal(r2.status, 0);
    assert.ok(!fs.existsSync(path.join(tmp, 'rot-canary-TMPX2.memmoved')), 'a tmpdir-resident MEMORY.md must not set .memmoved');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('touch hook still records a normal project file living OUTSIDE os.tmpdir() (no-regression)', () => {
  const tmp = mkTmp();
  const proj = mkTmp(); // a project dir, sibling of the sandbox os.tmpdir() (tmp) — NOT nested inside it
  try {
    const real = path.join(proj, 'edited-real.mjs');
    fs.writeFileSync(real, 'x();\n');
    const r = runHook(TOUCH, JSON.stringify({ session_id: 'TMPX3', tool_input: { file_path: real } }), tmp);
    assert.equal(r.status, 0);
    const touched = path.join(tmp, 'rot-canary-TMPX3.touched');
    assert.ok(fs.existsSync(touched), 'a project file outside os.tmpdir() is still recorded');
    assert.ok(fs.readFileSync(touched, 'utf8').includes('edited-real.mjs'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('touch hook does NOT exclude a sibling directory whose name merely PREFIXES the tmpdir path (e.g. "<tmp>X")', () => {
  const tmp = mkTmp();
  const sibling = tmp + 'X'; // same parent, NOT nested — "<tmp>X" textually starts with "<tmp>" but is a different dir
  fs.mkdirSync(sibling, { recursive: true });
  try {
    const real = path.join(sibling, 'a.js');
    fs.writeFileSync(real, 'x();\n');
    const r = runHook(TOUCH, JSON.stringify({ session_id: 'TMPX4', tool_input: { file_path: real } }), tmp);
    assert.equal(r.status, 0);
    const touched = path.join(tmp, 'rot-canary-TMPX4.touched');
    assert.ok(fs.existsSync(touched), 'a sibling dir sharing a string prefix with tmpdir must NOT be excluded');
    assert.ok(fs.readFileSync(touched, 'utf8').includes('a.js'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(sibling, { recursive: true, force: true });
  }
});
