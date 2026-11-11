// build-claude-ai-zips.test.mjs -- 09g item 12 (c), CoalMine issue 42 M1-M3 (the room's record: CoalMine/scratchpad/r09a/issue42-inspect.md). Hermetic: the staging script is copied into a scratch
// repository with stub libs, run as a child under a heap cap and a clock, and what it stages is read back. The workflow's zip step is held by its text, and by a real build twice where the
// runner has `zip` (a visible skip where it does not: the zip FLAGS are cleared only on a runner).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'build-claude-ai-zips.mjs');
const WORKFLOW = path.join(HERE, '..', '.github', 'workflows', 'claude-ai-zips.yml');
const EPOCH = 1700000000; // 2023-11-14T22:13:20Z
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'zips-test-'));
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
// Every child runs under named keys and a sandboxed HOME and temp: never the operator's own (a bare spawn inherits them whole) and never Node's
// fallbacks to them when the keys are absent (os.homedir() reads the account's home, os.tmpdir() the system temp) (CoalFace t188, order 18c; the
// front-door-links test's shape).
const CHILD_HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(CHILD_HOME);
const childEnv = (extra = {}) => ({
  ...Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'PATHEXT', 'ComSpec'].filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])),
  HOME: CHILD_HOME, USERPROFILE: CHILD_HOME, TEMP: CHILD_HOME, TMP: CHILD_HOME, TMPDIR: CHILD_HOME, ...extra,
});

// The two libs the staging script imports are the room's own; these stubs keep this test self-contained.
const STUB_CAP = "export const frontmatterField = (text, k) => { const m = new RegExp('^' + k + ': (.*)$', 'm').exec(text); return m ? m[1].replace(/^\"|\"$/g, '') : null; };\n";
const STUB_TRIM = "export const CLAUDE_AI_DESC_CAP = 200;\nexport const trimDescription = (d, cap) => d.slice(0, cap);\n";
let n = 0;

// a scratch repository: scripts/ with the script under test, plugin/skills/<name>/ with a SKILL.md and whatever `extra(dir)` adds
function repo(skills, extra = () => {}) {
  const root = path.join(SANDBOX, 'r' + n++);
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts', 'build-claude-ai-zips.mjs'));
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'desc-cap.mjs'), STUB_CAP);
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'claude-ai-trim.mjs'), STUB_TRIM);
  for (const name of skills) {
    const dir = path.join(root, 'plugin', 'skills', name);
    fs.mkdirSync(path.join(dir, 'references'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: "does ${name}"\n---\nbody\n`);
    fs.writeFileSync(path.join(dir, 'references', 'a.md'), 'a\n');
    extra(dir);
  }
  return root;
}
function stage(root, env = {}) {
  const r = spawnSync(process.execPath, ['--max-old-space-size=256', path.join(root, 'scripts', 'build-claude-ai-zips.mjs')], {
    cwd: root, encoding: 'utf8', timeout: 60000, env: childEnv(env),
  });
  return r;
}
const listAll = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [path.join(dir, e.name), ...listAll(path.join(dir, e.name))] : [path.join(dir, e.name)]));
const rel = (root, p) => path.relative(path.join(root, 'dist-claude-ai'), p).split(path.sep).join('/');

test('control: a plain skill stages SKILL.md and its references, exit 0', () => {
  const root = repo(['alpha']);
  const r = stage(root);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const files = listAll(path.join(root, 'dist-claude-ai')).filter((p) => fs.statSync(p).isFile()).map((p) => rel(root, p)).sort();
  assert.deepEqual(files, ['alpha/SKILL.md', 'alpha/references/a.md']);
});

test('M1: with SOURCE_DATE_EPOCH every staged file and folder carries that mtime, whenever it was built -- RED before 09g', async () => {
  const a = repo(['alpha', 'beta']);
  const r1 = stage(a, { SOURCE_DATE_EPOCH: String(EPOCH) });
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  await new Promise((resolve) => setTimeout(resolve, 1100)); // a later build would have later mtimes
  const b = repo(['alpha', 'beta']);
  stage(b, { SOURCE_DATE_EPOCH: String(EPOCH) });
  for (const root of [a, b]) {
    const all = listAll(path.join(root, 'dist-claude-ai'));
    assert.ok(all.length >= 6, 'files and folders were staged');
    for (const p of [path.join(root, 'dist-claude-ai', 'alpha'), ...all]) assert.equal(Math.floor(fs.statSync(p).mtimeMs / 1000), EPOCH, rel(root, p));
  }
});

test('M1: an epoch that is not whole seconds of 1980 or later is refused before anything is staged, and an unset one leaves the times alone', () => {
  for (const bad of ['yesterday', '-5', '12.5', '100', '9999999999999', '']) {
    const root = repo(['alpha']);
    const r = stage(root, { SOURCE_DATE_EPOCH: bad });
    assert.equal(r.status, 1, bad);
    assert.match(r.stderr, /SOURCE_DATE_EPOCH must be whole seconds, 1980-01-01 or later/, bad);
    assert.equal(fs.existsSync(path.join(root, 'dist-claude-ai')), false, 'nothing staged for ' + bad);
  }
  const root = repo(['alpha']);
  assert.equal(stage(root).status, 0);
  assert.ok(Math.floor(fs.statSync(path.join(root, 'dist-claude-ai', 'alpha', 'SKILL.md')).mtimeMs / 1000) > EPOCH, 'unset: the real time stays');
});

test('M3: a dotfile or a dot-folder is not staged at any depth -- RED before 09g', () => {
  const root = repo(['alpha'], (dir) => {
    fs.writeFileSync(path.join(dir, '.hidden'), 'x');
    fs.writeFileSync(path.join(dir, 'references', '.DS_Store'), 'x');
    fs.mkdirSync(path.join(dir, 'references', '.cache'));
    fs.writeFileSync(path.join(dir, 'references', '.cache', 'y.md'), 'x');
  });
  const r = stage(root);
  assert.equal(r.status, 0, r.stderr);
  const files = listAll(path.join(root, 'dist-claude-ai')).map((p) => rel(root, p));
  assert.deepEqual(files.filter((f) => f.split('/').some((seg) => seg.startsWith('.'))), []);
  assert.ok(files.includes('alpha/references/a.md'), 'the plain file is still staged');
});

test('M2: a symlink (or junction) inside a skill is REFUSED, not followed: the skill fails, the others still stage, exit 1 -- RED before 09g', (t) => {
  const outside = path.join(SANDBOX, 'outside-secret.txt');
  fs.writeFileSync(outside, 'secret outside the tree\n');
  let made = true;
  const root = repo(['alpha', 'beta'], (dir) => {
    if (!dir.endsWith('alpha') || !made) return;
    try { fs.symlinkSync(process.platform === 'win32' ? SANDBOX : outside, path.join(dir, 'references', 'link'), process.platform === 'win32' ? 'junction' : 'file'); } catch { made = false; }
  });
  if (!made) { t.skip('this account cannot make a symlink here'); return; }
  const r = stage(root);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /FAIL alpha: .*neither a regular file nor a folder/);
  const staged = listAll(path.join(root, 'dist-claude-ai')).map((p) => rel(root, p));
  assert.ok(!staged.some((f) => f.endsWith('/link') || f.includes('outside-secret')), 'the target was not copied');
  assert.ok(staged.includes('beta/SKILL.md'), 'the other skill staged');
});

test('M2: a name with a control character is refused (probed: skipped visibly where the filesystem cannot make one)', (t) => {
  let made = true;
  const root = repo(['alpha'], (dir) => { try { fs.writeFileSync(path.join(dir, 'a' + String.fromCharCode(10) + 'b.md'), 'x'); } catch { made = false; } });
  if (!made) { t.skip('this filesystem refuses a newline in a name'); return; }
  const r = stage(root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FAIL alpha: .*control character/);
});

// 29e (a), CoalLedger INSPECT r34 L1: the skills listing filtered on Dirent.isDirectory(), which is false for a junction, so a linked skill was dropped with exit 0 and no word.
test('a junction or symlink directly under plugin/skills is REFUSED by name, exit 1, never skipped or followed -- RED before 29e (a)', (t) => {
  const root = repo(['alpha']);
  try { fs.symlinkSync(path.join(root, 'plugin', 'skills', 'alpha'), path.join(root, 'plugin', 'skills', 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); } catch { t.skip('this account cannot make a junction or symlink here'); return; }
  const r = stage(root);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /FAIL linked: .*neither a regular file nor a folder/);
  const staged = listAll(path.join(root, 'dist-claude-ai')).map((p) => rel(root, p));
  assert.ok(!staged.some((f) => f.startsWith('linked')), 'the link was neither followed nor staged');
  assert.ok(staged.includes('alpha/SKILL.md'), 'the real skill staged');
});

test('a dot folder directly under plugin/skills is not staged, as a dotfile is not at any depth -- RED before 29e (a)', () => {
  const root = repo(['alpha']);
  fs.mkdirSync(path.join(root, 'plugin', 'skills', '.hidden'));
  fs.writeFileSync(path.join(root, 'plugin', 'skills', '.hidden', 'SKILL.md'), '---\nname: hidden\ndescription: "x"\n---\nbody\n');
  const r = stage(root);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const staged = listAll(path.join(root, 'dist-claude-ai')).map((p) => rel(root, p));
  assert.ok(!staged.some((f) => f.split('/').some((seg) => seg.startsWith('.'))), 'no dot entry staged');
  assert.ok(staged.includes('alpha/SKILL.md'), 'the real skill staged');
  assert.match(r.stdout, /^skipped \.hidden$/m, 'the skip is named on the output, on a line of its own');
});

// ---- the workflow's zip step: the text holds the flags; a real build holds the result where `zip` exists ---------------------------------------------------
const zipStep = () => {
  const lines = fs.readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const at = lines.findIndex((l) => l.includes('- name: Zip each staged skill directory'));
  assert.ok(at >= 0, 'the step exists');
  const end = lines.findIndex((l, i) => i > at && /^ {6}(- name:|#)/.test(l));
  return lines.slice(at, end < 0 ? lines.length : end).join('\n');
};

test('M1/M3: the zip step zips a SORTED list with -X -D, under TZ=UTC, with the dotfile exclusion at every depth, and the staging step is handed the tag commit time -- RED before 09g', () => {
  const step = zipStep();
  assert.match(step, /TZ: UTC/);
  assert.match(step, /find "\$\{name\}" -type f \| LC_ALL=C sort \| zip -X -D -@ "\$\{name\}\.zip" -x '\*\/\.\*'/);
  assert.doesNotMatch(step, /zip -r/, 'the recursive form lists in readdir order');
  const wf = fs.readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
  assert.match(wf, /run: SOURCE_DATE_EPOCH="\$\(git log -1 --format=%ct\)" node scripts\/build-claude-ai-zips\.mjs/);
});

test('M1 on a runner: two builds of the same tree at different times give byte-identical ZIPs (skipped visibly where zip is absent: the flags are cleared by a runner)', (t) => {
  const probe = spawnSync('zip', ['-v'], { encoding: 'utf8', timeout: 15000, env: childEnv() });
  if (probe.error || probe.status !== 0) { t.skip('no zip on this machine: ubuntu and macOS runners clear this'); return; }
  const bash = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8', timeout: 15000, env: childEnv() });
  if (bash.error || bash.status !== 0) { t.skip('no bash on this machine'); return; }
  const script = zipStep().split('\n').slice(zipStep().split('\n').findIndex((l) => /^\s*run: \|/.test(l)) + 1).map((l) => l.replace(/^ {10}/, '')).join('\n');
  const build = (root) => {
    assert.equal(stage(root, { SOURCE_DATE_EPOCH: String(EPOCH) }).status, 0);
    const r = spawnSync('bash', ['-c', script], { cwd: root, encoding: 'utf8', timeout: 60000, env: childEnv({ TZ: 'UTC' }) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return fs.readFileSync(path.join(root, 'dist-claude-ai', 'alpha.zip'));
  };
  const first = build(repo(['alpha'], (dir) => fs.writeFileSync(path.join(dir, 'references', '.DS_Store'), 'x')));
  const later = build(repo(['alpha'], (dir) => fs.writeFileSync(path.join(dir, 'references', '.DS_Store'), 'y')));
  assert.ok(first.equals(later), 'same bytes');
  const file = path.join(SANDBOX, 'built-alpha.zip');
  fs.writeFileSync(file, first);
  const entries = spawnSync('unzip', ['-Z1', file], { encoding: 'utf8', timeout: 15000, env: childEnv() }).stdout.split('\n').filter(Boolean);
  assert.deepEqual(entries, ['alpha/SKILL.md', 'alpha/references/a.md'], 'sorted by byte value, no folder entries, no dotfile');
});

// order 2026-11-03b, CoalLedger T-43: two of that room's fixes hold for every room and join the canon (its third, a main-module guard, guards an
// import no room makes of this script, which exports nothing).
test('an EMPTY plugin/skills is a failure, exit 1, never "Done: 0/0" with exit 0 -- RED before 2026-11-03b (CoalLedger T-43)', () => {
  const root = repo([]);
  fs.mkdirSync(path.join(root, 'plugin', 'skills'), { recursive: true });
  const r = stage(root);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^FAIL: .*holds no skill directories/m);
  assert.doesNotMatch(r.stdout, /Done: 0\/0/);
});

test('a block-scalar description with a blank line inside is replaced whole: no tail line is left in the staged frontmatter -- RED before 2026-11-03b (CoalLedger T-43)', () => {
  const root = repo(['alpha'], (dir) => fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: alpha\ndescription: >\n  first paragraph\n\n  orphaned tail\nlicense: Apache-2.0\n---\nbody\n'));
  const r = stage(root);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const text = fs.readFileSync(path.join(root, 'dist-claude-ai', 'alpha', 'SKILL.md'), 'utf8');
  const front = /^---\n([\s\S]*?)\n---/.exec(text)[1].split('\n');
  assert.equal(front.filter((l) => l.startsWith('description:')).length, 1, text);
  assert.ok(!text.includes('orphaned tail'), 'the tail of the old description is gone: ' + text);
  assert.ok(front.includes('license: Apache-2.0') && front.includes('name: alpha'), 'the fields around it stay: ' + text);
});

// 2026-11-12a (CoalLedger's re-copy, its CW-054 row): the house entry guard. A script that is also a module runs only as the entry point, never on import, and the compare is on REAL paths:
// import.meta.url is the loader's realpath of the entry, process.argv[1] only path.resolve'd, so a lexical compare through a junction or a symlinked folder never matches and the guard fails OPEN
// (the script silently does nothing). Both sides go through fs.realpathSync.native; where either cannot be resolved the PLAIN resolved paths are compared.
const importProbe = (root) => {
  const probe = path.join(root, 'import-probe.mjs');
  fs.writeFileSync(probe, `import { pathToFileURL } from 'node:url';\nawait import(pathToFileURL(${JSON.stringify(path.join(root, 'scripts', 'build-claude-ai-zips.mjs'))}).href);\nconsole.log('imported');\nconsole.log('exitCode=' + (process.exitCode ?? 'unset'));\n`);
  return probe;
};

test('importing the staging script runs nothing: no output of its own, no dist-claude-ai, the importer\'s exit code untouched -- RED before 2026-11-12a', () => {
  const root = repo(['alpha']);
  const r = spawnSync(process.execPath, ['--max-old-space-size=256', importProbe(root)], { cwd: root, encoding: 'utf8', timeout: 60000, env: childEnv() });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, 'imported\nexitCode=unset\n');
  assert.equal(r.stderr, '');
  assert.equal(fs.existsSync(path.join(root, 'dist-claude-ai')), false, 'the import staged nothing');
  assert.equal(stage(repo(['alpha'])).status, 0, 'run as the entry it still stages');
});

test('run through a junction or a symlinked folder the script is still the entry and stages (the compare is on real paths, never lexical) -- RED against a lexical import.meta.url compare', (t) => {
  const root = repo(['alpha']);
  const via = path.join(SANDBOX, 'via' + n++);
  fs.mkdirSync(via);
  try { fs.symlinkSync(path.join(root, 'scripts'), path.join(via, 'scripts'), 'junction'); } catch { t.skip('this account cannot make a junction or symlink here'); return; }
  const r = spawnSync(process.execPath, ['--max-old-space-size=256', path.join(via, 'scripts', 'build-claude-ai-zips.mjs')], { cwd: root, encoding: 'utf8', timeout: 60000, env: childEnv() });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Done: 1\/1 skill\(s\) staged/);
  assert.ok(fs.existsSync(path.join(root, 'dist-claude-ai', 'alpha', 'SKILL.md')), 'the build ran through the link');
});

// the preload makes the real-path call fail, as it does where a path cannot be resolved: the guard then compares the plain paths
const NO_REALPATH = "import fs from 'node:fs';\nfs.realpathSync.native = () => { throw new Error('unresolvable'); };\n";
// neither the real path nor the file identity can be read: only the plain compare is left, so this leg runs on a path that is its own real path (a symlinked temp folder, as on macOS, spells it two ways)
const NO_REALPATH_NO_STAT = NO_REALPATH + "fs.statSync = () => { throw new Error('unreadable'); };\n";
test('where neither the real path nor the file identity can be read the guard compares plain paths: a direct run still stages, an import still runs nothing -- RED before 2026-11-12a', () => {
  const root = fs.realpathSync.native(repo(['alpha']));
  const pre = path.join(root, 'no-realpath.mjs');
  fs.writeFileSync(pre, NO_REALPATH_NO_STAT);
  const flags = ['--max-old-space-size=256', '--import', pathToFileURL(pre).href];
  const direct = spawnSync(process.execPath, [...flags, path.join(root, 'scripts', 'build-claude-ai-zips.mjs')], { cwd: root, encoding: 'utf8', timeout: 60000, env: childEnv() });
  assert.equal(direct.status, 0, direct.stdout + direct.stderr);
  assert.ok(fs.existsSync(path.join(root, 'dist-claude-ai', 'alpha', 'SKILL.md')), 'the entry ran on plain paths');
  const other = fs.realpathSync.native(repo(['alpha']));
  const imported = spawnSync(process.execPath, [...flags.slice(0, 1), '--import', pathToFileURL(pre).href, importProbe(other)], { cwd: other, encoding: 'utf8', timeout: 60000, env: childEnv() });
  assert.equal(imported.status, 0, imported.stdout + imported.stderr);
  assert.equal(imported.stdout, 'imported\nexitCode=unset\n');
  assert.equal(fs.existsSync(path.join(other, 'dist-claude-ai')), false, 'an import never runs it, resolved or not');
});

// 2026-11-12b: the macOS red of 12a. A temp folder there is a symlink (/var -> /private/var): the loader hands import.meta.url the REAL path while process.argv[1] stays as typed, so where the real-path call
// fails, a compare of plain paths never matched and a direct run staged nothing. The fallback compares file IDENTITY (dev + ino through stat, which follows links) before it falls to plain paths.
test('where the real path cannot be resolved a run through a symlinked or junctioned folder still stages: the fallback compares file identity, not spelling -- RED on macOS before 2026-11-12b', (t) => {
  const root = repo(['alpha']);
  const via = path.join(SANDBOX, 'via' + n++);
  fs.mkdirSync(via);
  try { fs.symlinkSync(path.join(root, 'scripts'), path.join(via, 'scripts'), 'junction'); } catch { t.skip('this account cannot make a junction or symlink here'); return; }
  const pre = path.join(root, 'no-realpath.mjs');
  fs.writeFileSync(pre, NO_REALPATH);
  const r = spawnSync(process.execPath, ['--max-old-space-size=256', '--import', pathToFileURL(pre).href, path.join(via, 'scripts', 'build-claude-ai-zips.mjs')], { cwd: root, encoding: 'utf8', timeout: 60000, env: childEnv() });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(root, 'dist-claude-ai', 'alpha', 'SKILL.md')), 'the build ran through the link with no real path');
  const other = repo(['alpha']);
  const imported = spawnSync(process.execPath, ['--max-old-space-size=256', '--import', pathToFileURL(pre).href, importProbe(other)], { cwd: other, encoding: 'utf8', timeout: 60000, env: childEnv() });
  assert.equal(imported.stdout, 'imported\nexitCode=unset\n', imported.stdout + imported.stderr);
  assert.equal(fs.existsSync(path.join(other, 'dist-claude-ai')), false, 'an import never runs it on the identity compare either');
});

// 2026-11-12c (the umbrella auditor's F1 on 571ae22): a volume that gives no file id answers stat with dev 0 and ino 0, and the identity compare then calls ANY two files one, so an import ran the build. A
// zero ino is no identity at all: the guard falls on to the plain paths, so a direct run still stages and an import still runs nothing.
const NO_REALPATH_ZERO_STAT = NO_REALPATH + "fs.statSync = () => ({ dev: 0n, ino: 0n });\n";
test('where stat gives no file id (dev 0, ino 0) the identity compare is no answer: an import runs nothing and a direct run still stages -- RED before 2026-11-12c (auditor F1)', () => {
  const root = fs.realpathSync.native(repo(['alpha']));
  const pre = path.join(root, 'no-realpath.mjs');
  fs.writeFileSync(pre, NO_REALPATH_ZERO_STAT);
  const other = fs.realpathSync.native(repo(['alpha']));
  const imported = spawnSync(process.execPath, ['--max-old-space-size=256', '--import', pathToFileURL(pre).href, importProbe(other)], { cwd: other, encoding: 'utf8', timeout: 60000, env: childEnv() });
  assert.equal(imported.stdout, 'imported\nexitCode=unset\n', imported.stdout + imported.stderr);
  assert.equal(fs.existsSync(path.join(other, 'dist-claude-ai')), false, 'an import never runs it on a zero file id');
  const direct = spawnSync(process.execPath, ['--max-old-space-size=256', '--import', pathToFileURL(pre).href, path.join(root, 'scripts', 'build-claude-ai-zips.mjs')], { cwd: root, encoding: 'utf8', timeout: 60000, env: childEnv() });
  assert.equal(direct.status, 0, direct.stdout + direct.stderr);
  assert.ok(fs.existsSync(path.join(root, 'dist-claude-ai', 'alpha', 'SKILL.md')), 'the entry still ran on the plain paths');
});

test('imported from `node -e` (no argv[1] at all) the guard answers "not the entry" without throwing: nothing runs, exit 0 -- 2026-11-12a mutant Z6', () => {
  const root = repo(['alpha']);
  const code = `await import(${JSON.stringify(pathToFileURL(path.join(root, 'scripts', 'build-claude-ai-zips.mjs')).href)}); console.log('imported');`;
  const r = spawnSync(process.execPath, ['--max-old-space-size=256', '--input-type=module', '-e', code], { cwd: root, encoding: 'utf8', timeout: 60000, env: childEnv() });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, 'imported\n');
  assert.equal(fs.existsSync(path.join(root, 'dist-claude-ai')), false);
});
