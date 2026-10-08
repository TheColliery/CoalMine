// CWK-133 + CWK-136 -- the git-spawn census, both rungs, red-first on fixture text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { censusGitSpawns, collectScriptsMjs, blobId, EXEMPT_CARRIERS } from './git-env-census.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const one = (text) => censusGitSpawns([{ rel: 'scripts/x.mjs', text }]);
// The fixture calls are assembled from pieces so this file never holds the literal call
// shape itself -- the census scans scripts/**, this file included (the last test).
const SG = 'spawn' + "Sync('git'";
const EG = 'execFile' + "Sync('git'";

test('census rung 1 (CWK-133): a git spawn with NO env: is a finding, naming file and line', () => {
  const f = one("const a = 1;\n" + SG + ", ['init', '-q', '.'], { cwd: dir });\n");
  assert.equal(f.length, 1);
  assert.match(f[0], /^scripts\/x\.mjs:2 spawnSync\('git', \.\.\.\) carries no 'env:'/);
});

test('census rung 2 (CWK-136): env: process.env is REFUSED -- presence is not safety', () => {
  const f = one(SG + ", ['init'], { cwd: dir, env: process.env });\n");
  assert.equal(f.length, 1);
  assert.match(f[0], /passes process\.env without gitEnv\(\)/);
});

test('census rung 2 (CWK-136): a spread of process.env is REFUSED the same way', () => {
  const f = one(SG + ", ['init'], { cwd: dir, env: { ...process.env, GIT_CEILING_DIRECTORIES: base } });\n");
  assert.equal(f.length, 1);
  assert.match(f[0], /CWK-136/);
});

test('census: env: gitEnv(...) passes both rungs, on one line or across lines', () => {
  assert.deepEqual(one(SG + ", ['init'], { cwd: dir, env: gitEnv(path.dirname(dir)) });\n"), []);
  assert.deepEqual(one(EG + ",\n  ['status'],\n  { cwd: dir, env: gitEnv(base), encoding: 'utf8' });\n"), []);
  assert.deepEqual(one(SG + ", ['x'], { env: { ...gitEnv(b), LANG: process.env.LANG } });\n"), [], 'a process.env READ beside gitEnv() is not the hazard');
});

test('census: a call inside a line comment is not code', () => {
  assert.deepEqual(one("// e.g. " + SG + ", ['init'], { cwd: dir })\n"), []);
});

test('census: this room itself is clean -- every git spawn under scripts/ passes both rungs', () => {
  assert.deepEqual(censusGitSpawns(collectScriptsMjs(repo)), []);
});

// R8 INSPECT LOW-2: the census was blind to four call forms that reach git just as well.
// Two widenings, each red-first against the pre-widening CALL_RE: the async/argv forms
// ride the same two env rungs, and a git run through a SHELL string gets its own rung.
const SPA = 'spawn' + "('git'";
const EFA = 'execFile' + "('git'";
const EXS = 'execSync' + "('git";
const EXA = 'exec' + "(`git";

test('census widened (R8 LOW-2): async spawn and execFile ride rung 1 -- no env: is a finding', () => {
  const a = one(SPA + ", ['fetch'], { cwd: dir });\n");
  assert.equal(a.length, 1);
  assert.match(a[0], /spawn\('git', \.\.\.\) carries no 'env:'/);
  const b = one(EFA + ", ['status'], (err, out) => {});\n");
  assert.equal(b.length, 1);
  assert.match(b[0], /execFile\('git', \.\.\.\) carries no 'env:'/);
});

test('census widened (R8 LOW-2): async spawn with process.env is refused by rung 2, and passes with gitEnv()', () => {
  assert.match(one(SPA + ", ['fetch'], { env: process.env });\n")[0] || '', /passes process\.env without gitEnv\(\)/);
  assert.deepEqual(one(SPA + ", ['fetch'], { env: gitEnv(base) });\n"), []);
});

test('census shell rung (R8 LOW-2): git run through a shell string is refused, even with gitEnv()', () => {
  const a = one(EXS + " init -q', { cwd: dir });\n");
  assert.equal(a.length, 1);
  assert.match(a[0], /execSync\('git \.\.\.'\) runs git through a shell string/);
  const b = one(EXA + " status`, { env: gitEnv(base) }, cb);\n");
  assert.equal(b.length, 1, 'gitEnv() does not make a shell string safe');
  assert.match(b[0], /exec\('git \.\.\.'\)/);
});

test('census shell rung: a shell string for another program whose name starts with "git" is not git', () => {
  assert.deepEqual(one('execSync' + "('gitleaks detect', { cwd: dir });\n"), []);
  assert.deepEqual(one('spawn' + "('github-cli', ['x']);\n"), []);
});

// CWK-174: a byte-equal org carrier is exempt ONLY while its content is exactly the pinned blob.
const CARRIER = SPA + ", ['fetch'], { cwd: dir });\n";
test('census exemption (CWK-174): a pinned byte-equal carrier is skipped, an edited one is a finding again', () => {
  const pinned = { 'scripts/carrier.mjs': blobId(CARRIER) };
  assert.equal(censusGitSpawns([{ rel: 'scripts/carrier.mjs', text: CARRIER }]).length, 1, 'control: not exempt, the spawn is a finding');
  assert.deepEqual(censusGitSpawns([{ rel: 'scripts/carrier.mjs', text: CARRIER }], pinned), [], 'pinned content passes');
  const edited = censusGitSpawns([{ rel: 'scripts/carrier.mjs', text: CARRIER + '// edited\n' }], pinned);
  assert.equal(edited.length, 1, 'any edit re-opens it');
  assert.match(edited[0], /exempt byte-equal org carrier but its blob id is/);
  assert.equal(censusGitSpawns([{ rel: 'scripts/other.mjs', text: CARRIER }], pinned).length, 1, 'the exemption is per path, not per content');
});

test('census exemption (CWK-174): blobId equals `git hash-object` for the same bytes, and the live carriers match their pins', () => {
  assert.equal(blobId(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391', 'git\'s empty-blob id');
  assert.equal(blobId('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a', 'git hash-object of "hello" + LF');
  const live = collectScriptsMjs(repo).filter((f) => Object.hasOwn(EXEMPT_CARRIERS, f.rel));
  assert.equal(live.length, Object.keys(EXEMPT_CARRIERS).length, 'every pinned path exists in the tree (a stale pin is a finding, not silence)');
  assert.deepEqual(censusGitSpawns(live), [], 'and each is byte-equal to its pin');
});

// R14 bounce LOW-1: keepUserConfig (GIT_CONFIG_* pass-through) is allowed for ONE spawn, the installer's core.hooksPath read.
const KEEP = "{ keepUserConfig: " + "true }";
test('census (R14 LOW-1): a spawn that passes keepUserConfig is a finding anywhere but the installer\'s core.hooksPath read', () => {
  const planted = SG + ", ['init', '-q'], { cwd: dir, env: gitEnv('/', " + KEEP + ") });\n";
  const f = censusGitSpawns([{ rel: 'scripts/lib/some.test.mjs', text: planted }]);
  assert.equal(f.length, 1, 'a fixture spawn asking for the user git config is refused');
  assert.match(f[0], /keepUserConfig/);
  const inInstaller = censusGitSpawns([{ rel: 'scripts/install.mjs', text: planted }]);
  assert.equal(inInstaller.length, 1, 'inside install.mjs too, unless it is the core.hooksPath read');
});

test('census (R14 LOW-1): the installer\'s core.hooksPath read with keepUserConfig passes, and the live tree is clean', () => {
  const read = SG + ", ['config', '--type=path', '--get', 'core.hooksPath'], { cwd: d, env: gitEnv(p, " + KEEP + ") });\n";
  assert.deepEqual(censusGitSpawns([{ rel: 'scripts/install.mjs', text: read }]), []);
  assert.equal(censusGitSpawns([{ rel: 'scripts/other.mjs', text: read }]).length, 1, 'the same read elsewhere is refused');
  assert.deepEqual(censusGitSpawns(collectScriptsMjs(repo)), []);
});

// 08c (main's ruling UMB-456 (2)): rule (a), the ALLOWLIST env. A spawn whose env is an object built from NAMED keys of
// process.env, never the whole object, that carries GIT_CONFIG_NOSYSTEM: '1' and names no GIT_* key beyond the three the canon
// sets, passes without a blob pin. The fixtures are assembled so this file holds no literal spawn of its own.
const ALLOW_KEEP = "const keep = ['PATH', 'HOME', 'GIT_CEILING_DIRECTORIES'];\n";
const ALLOW_GOOD = "{ ...Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }";
const allowFile = (body, keep = ALLOW_KEEP) => keep + 'const env = ' + body + ';\n' + SG + ", ['config', '--local', '--get', 'remote.origin.url'], { encoding: 'utf8', timeout: 30000, env });\n";
const inlineFile = (body) => ALLOW_KEEP + SG + ", ['status'], { encoding: 'utf8', env: " + body + ' });\n';

test('census rule (a), witness a: an allowlist env passes with NO pin, declared beside the spawn or inline in it', () => {
  assert.deepEqual(one(allowFile(ALLOW_GOOD)), [], 'declared as const env, passed by shorthand');
  assert.deepEqual(one(inlineFile(ALLOW_GOOD)), [], 'written inline in the call');
  const carrier = collectScriptsMjs(repo).filter((f) => f.rel === 'scripts/release-notes.mjs');
  assert.equal(carrier.length, 1, 'the canon release-notes.mjs is in the walked tree');
  assert.deepEqual(censusGitSpawns(carrier, {}), [], 'the canon text itself passes with the pin table EMPTY');
});

test('census rule (a), witness b: an env that spreads the whole process.env is still refused, whatever else it carries', () => {
  for (const body of ["{ ...process.env, GIT_CONFIG_NOSYSTEM: '1' }", "{ ...process.env }"]) {
    for (const file of [allowFile(body), inlineFile(body)]) {
      const f = one(file);
      assert.equal(f.length, 1, body);
      assert.match(f[0], /passes process\.env without gitEnv\(\)/, 'refused for the process.env, not for a missing env:');
    }
  }
});

test('census rule (a), witness c: Object.assign({}, process.env) is still refused', () => {
  for (const body of ["Object.assign({}, process.env, { GIT_CONFIG_NOSYSTEM: '1' })", "Object.assign({}, process.env)"]) {
    const f = one(inlineFile(body));
    assert.equal(f.length, 1, body);
    assert.match(f[0], /passes process\.env without gitEnv\(\)/);
  }
  const declared = one(ALLOW_KEEP + "const env = { ...Object.fromEntries(keep.map((k) => [k, process.env[k]])), ...process.env, GIT_CONFIG_NOSYSTEM: '1' };\n" + SG + ", ['x'], { env });\n");
  assert.equal(declared.length, 1, 'a named-keys pick PLUS a whole-object spread is still a whole-object spread');
  assert.match(declared[0], /passes process\.env without gitEnv\(\)/);
});

test('census rule (a), witness d: an allowlist without GIT_CONFIG_NOSYSTEM: 1 is refused, and so is any other value', () => {
  const none = ALLOW_GOOD.replace("GIT_CONFIG_NOSYSTEM: '1', ", '');
  for (const body of [none, ALLOW_GOOD.replace("GIT_CONFIG_NOSYSTEM: '1'", "GIT_CONFIG_NOSYSTEM: '0'")]) {
    for (const file of [allowFile(body), inlineFile(body)]) {
      const f = one(file);
      assert.equal(f.length, 1, body);
      assert.match(f[0], /without GIT_CONFIG_NOSYSTEM: '1'/);
    }
  }
});

test('census rule (a), witness e: an allowlist that names or sets a GIT_* key beyond the canon three is refused', () => {
  const sets = ALLOW_GOOD.replace("GIT_TERMINAL_PROMPT: '0'", "GIT_TERMINAL_PROMPT: '0', GIT_DIR: '/elsewhere'");
  const kept = allowFile(ALLOW_GOOD, "const keep = ['PATH', 'GIT_WORK_TREE'];\n");
  for (const file of [allowFile(sets), inlineFile(sets), kept]) {
    const f = one(file);
    assert.equal(f.length, 1, file);
    assert.match(f[0], /names GIT_(DIR|WORK_TREE)/);
  }
  assert.deepEqual(one(allowFile(ALLOW_GOOD)), [], 'control: the three canon names are allowed');
  assert.deepEqual(one('// GIT_DIR is what a hook leaves behind\n' + allowFile(ALLOW_GOOD)), [], 'a name in a line comment is not a key');
});

test('census rule (a): a shorthand env with no declaration in the file, or declared as a call, stays a finding', () => {
  const f = one(SG + ", ['status'], { encoding: 'utf8', env });\n");
  assert.equal(f.length, 1);
  assert.match(f[0], /no readable declaration/);
  const call =one("const env = buildEnv();\n" + SG + ", ['status'], { env });\n");
  assert.equal(call.length, 1, 'an env the census cannot read is never waved through');
  assert.match(call[0], /does not define|cannot read|no readable declaration/);
});

// 08d: THE CENSUS WITNESS LIST (F1-F34 and P1-P6 of the 08d order), one probe per vector. F = must be a finding, P = must pass with no pin.
// A vector that declares `const env` is probed in both call forms, shorthand { env } and env: env. Probes are assembled here, so this file holds no spawn of its own.
const SPAWN_AT = (prop) => SG + ", ['status'], { cwd: d, " + prop + ' });';
const probe = (src, prop) => src.split('@SPAWN@').join(SPAWN_AT(prop));
const KEEPLIST = "const keep = ['PATH', 'HOME'];\n";
const PICK = "...Object.fromEntries(keep.filter((k) => k in process.env).map((k) => [k, process.env[k]]))";
const NS = "GIT_CONFIG_NOSYSTEM: '1'";
const DECL = ['env', 'env: env'];
const WITNESS_F = [
  { id: 'F1', src: "const base = { ...process.env };\nconst env = { ...base, " + NS + " };\n@SPAWN@", forms: DECL },
  { id: 'F1b', src: "const extra = process.env;\nconst env = { ...extra, " + NS + " };\n@SPAWN@", forms: DECL },
  { id: 'F1c', src: "const e = process.env;\nconst env = { ...Object.fromEntries(Object.entries(e)), " + NS + " };\n@SPAWN@", forms: DECL },
  { id: 'F2', src: "const env = { ...Object.fromEntries(Object.entries(process.env)), " + NS + " };\n@SPAWN@", forms: DECL },
  { id: 'F3', src: "const env = { ...Object.fromEntries(Object.entries(process.env).filter(() => true)), " + NS + " };\n@SPAWN@", forms: DECL },
  { id: 'F4', src: "const env = { ...process['env'], " + NS + " };\n@SPAWN@", forms: DECL },
  { id: 'F5', src: "import { env as penv } from 'node:process';\nconst env = { ...penv, " + NS + " };\n@SPAWN@", forms: DECL },
  { id: 'F6', src: "@SPAWN@", forms: ["env: { ...gitEnv(d), ...process.env }"] },
  { id: 'F7', src: "const base = { ...process.env };\n@SPAWN@", forms: ["env: { ...gitEnv(d), ...base }"] },
  { id: 'F8', src: "@SPAWN@", forms: ["env: { " + NS + ", extra: { ...process.env } }"] },
  { id: 'F9', src: KEEPLIST + "const env = { ...Object.fromEntries(keep.filter(Boolean).map((k) => [k, process.env[k]]).concat(Object.entries(process.env))), " + NS + " };\n@SPAWN@", forms: DECL },
  { id: 'F10', src: KEEPLIST + "const env = { ...Object.fromEntries(keep.filter(Boolean).flatMap(() => Object.entries(process.env))), " + NS + " };\n@SPAWN@", forms: DECL },
  { id: 'F11', src: "@SPAWN@", forms: ["env: { " + NS + ", all: process.env }"] },
  { id: 'F12', src: "function all() { return process.env; }\nconst env = { ...Object.fromEntries(Object.entries(all())), " + NS + " };\n@SPAWN@", forms: DECL },
  { id: 'F13', src: "function mk(x) { if (x) return { PATH: process.env.PATH, " + NS + " }; return process.env; }\n@SPAWN@", forms: ["env: mk(d)"] },
  { id: 'F14', src: "@SPAWN@", forms: ["env: sandboxEnv(cwd)"] },
  { id: 'F15', src: KEEPLIST + "const env = { " + PICK + ", " + NS + " };\nObject.assign(env, process.env);\n@SPAWN@", forms: DECL },
  { id: 'F16', src: "const env = { " + NS + " };\nfor (const k of Object.keys(process.env)) env[k] = process.env[k];\n@SPAWN@", forms: DECL },
  { id: 'F17', src: KEEPLIST + "const env = { " + PICK + ", " + NS + " };\nenv.GIT_DIR = '/elsewhere/.git';\n@SPAWN@", forms: DECL },
  { id: 'F18', src: "const KEYS = ['PATH'];\nKEYS.push('GIT_DIR');\nconst env = { ...Object.fromEntries(KEYS.map((k) => [k, process.env[k]])), " + NS + " };\n@SPAWN@", forms: DECL },
  { id: 'F19', src: "const keep = ['PATH', 'GIT_DIR'];\nconst env = { " + PICK + ", " + NS + " };\n@SPAWN@", forms: DECL },
  { id: 'F20', src: "const k2 = ['GIT_DIR'];\nconst keep = ['PATH', ...k2];\nconst env = { " + PICK + ", " + NS + " };\n@SPAWN@", forms: DECL },
  { id: 'F21', src: "const keep = ['PATH', 'GIT_' + 'DIR'];\nconst env = { " + PICK + ", " + NS + " };\n@SPAWN@", forms: DECL },
  { id: 'F22', src: "@SPAWN@", forms: ["env: { " + NS + ", ['GIT' + '_DIR']: process.env['GIT' + '_DIR'] }"] },
  { id: 'F23', src: "const env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '0' };\n@SPAWN@", forms: DECL },
  { id: 'F24', src: "const env = { PATH: process.env.PATH, " + NS + ", GIT_CONFIG_NOSYSTEM: '0' };\n@SPAWN@", forms: DECL },
  { id: 'F25', src: KEEPLIST + "const over = { GIT_CONFIG_NOSYSTEM: '0' };\nconst env = { " + NS + ", " + PICK + ", ...over };\n@SPAWN@", forms: DECL },
  { id: 'F26', src: "const env = { PATH: process.env.PATH, HOME: process.env.HOME };\n@SPAWN@", forms: DECL },
  { id: 'F27', src: "const flag = '1';\nconst env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: flag };\n@SPAWN@", forms: DECL },
  { id: 'F28', src: "const env = { /* GIT_CONFIG_NOSYSTEM: '1' */ PATH: process.env.PATH };\n// GIT_CONFIG_NOSYSTEM: '1'\n@SPAWN@", forms: DECL },
  { id: 'F29', src: "const env = { PATH: process.env.PATH, " + NS + ", git_dir: d };\n@SPAWN@", forms: DECL },
  { id: 'F30', src: "const env = { PATH: process.env.PATH, " + NS + ", GIT_DIR: d };\n@SPAWN@", forms: DECL },
  { id: 'F31', src: "function a() { const env = { PATH: process.env.PATH, " + NS + " }; return env; }\nfunction b(d) {\n  const env = { ...process.env };\n  @SPAWN@\n}", forms: DECL },
  { id: 'F32', src: "const env = { PATH: process.env.PATH, " + NS + " };\nfunction b(d) {\n  let env = { ...process.env };\n  @SPAWN@\n}", forms: DECL },
  { id: 'F33', src: "const env = { PATH: process.env.PATH, " + NS + " };\nfunction b(env) {\n  @SPAWN@\n}", forms: DECL },
  { id: 'F34', src: "function a() { const e2 = { PATH: process.env.PATH, " + NS + " }; return e2; }\nfunction b() {\n  const e2 = { ...process.env };\n  @SPAWN@\n}", forms: ['env: e2'] },
  // 08d bounce 2: the RE-INSPECT rows C1-C4 and C8, a write through any reference but the env's own name.
  { id: 'C1', src: KEEPLIST + "const env = { " + PICK + ", " + NS + " };\nconst alias = env;\nfor (const k in process.env) alias[k] = process.env[k];\n@SPAWN@", forms: DECL },
  { id: 'C2', src: KEEPLIST + "function fill(o) { for (const k in process.env) o[k] = process.env[k]; }\nconst env = { " + PICK + ", " + NS + " };\nfill(env);\n@SPAWN@", forms: DECL },
  { id: 'C3', src: KEEPLIST + "const env = { " + PICK + ", " + NS + " };\nReflect.set(env, 'GIT_DIR', d);\n@SPAWN@", forms: DECL },
  { id: 'C4', src: KEEPLIST + "const env = { " + PICK + ", " + NS + " };\nconst alias = env;\nalias.GIT_DIR = d;\n@SPAWN@", forms: DECL },
  { id: 'C8', src: KEEPLIST + "const env = { " + PICK + ", " + NS + " };\nObject.assign(Object(env), { GIT_DIR: d });\n@SPAWN@", forms: DECL },
];
const WITNESS_P = [
  { id: 'P3a', src: "@SPAWN@", forms: ['env: gitEnv(d)'] },
  { id: 'P3b', src: "const env = gitEnv(d);\n@SPAWN@", forms: DECL },
  { id: 'P4', src: "@SPAWN@", forms: ["env: { PATH: process.env.PATH, HOME: process.env.HOME, " + NS + " }"] },
  { id: 'P5', src: KEEPLIST + "const env = { " + PICK + ", " + NS + " };\n@SPAWN@", forms: DECL },
  { id: 'P6', src: KEEPLIST + "const env = { " + PICK + ", " + NS + ", GIT_TERMINAL_PROMPT: '0', GIT_CEILING_DIRECTORIES: d };\n@SPAWN@", forms: DECL },
  { id: 'P7 quoted key and a process.env mention in a string', src: "const note = 'process.env is never copied';\nconst env = { 'GIT_CONFIG_NOSYSTEM': '1', PATH: process.env.PATH };\n@SPAWN@", forms: DECL },
  { id: 'P8 helper with one literal return', src: "const mk = (dir) => ({ PATH: process.env.PATH, HOME: dir, " + NS + " });\n@SPAWN@", forms: ['env: mk(d)'] },
  { id: 'P9 helper with a block body', src: "function mk(dir) {\n  const x = 1;\n  return { PATH: process.env.PATH, HOME: dir, " + NS + " };\n}\n@SPAWN@", forms: ['env: mk(d)'] },
];
for (const v of WITNESS_F) {
  for (const prop of v.forms) {
    test('witness ' + v.id + ' must FAIL [' + prop.slice(0, 24) + ']', () => {
      const f = one(probe(v.src, prop));
      assert.equal(f.length, 1, v.id + ' must be exactly one finding, got: ' + JSON.stringify(f));
    });
  }
}
for (const v of WITNESS_P) {
  for (const prop of v.forms) {
    test('witness ' + v.id + ' must PASS with no pin [' + prop.slice(0, 24) + ']', () => {
      assert.deepEqual(censusGitSpawns([{ rel: 'scripts/x.mjs', text: probe(v.src, prop) }], {}), []);
    });
  }
}

test('witness P1: the canon release-notes.mjs (blob f8d998d8) passes with the pin table empty', () => {
  const live = collectScriptsMjs(repo).filter((f) => f.rel === 'scripts/release-notes.mjs');
  assert.equal(live.length, 1);
  assert.ok(blobId(live[0].text).startsWith('f8d998d8'), 'the file under test IS the canon blob');
  assert.deepEqual(censusGitSpawns(live, {}), []);
});

// P2: the canon release-notes.test.mjs builds its sandbox as ONE literal and hands it to git through a same-file helper.
test('witness P2: the sandboxEnv shape (a helper returning one allowlist literal) passes with no pin, and the live release-notes.test.mjs does too', () => {
  const helper = "const BASE_ENV_KEYS = ['PATH', 'Path', 'SystemRoot'];\nconst sandboxEnv = (dir) => ({\n  ...Object.fromEntries(BASE_ENV_KEYS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])),\n  HOME: dir, TEMP: dir, GIT_CEILING_DIRECTORIES: path.dirname(dir), GIT_CONFIG_NOSYSTEM: '1',\n  HOMEDRIVE: process.platform === 'win32' ? path.parse(dir).root : undefined,\n});\nconst childEnv = (dir, extra = {}) => Object.assign(sandboxEnv(dir), extra);\n";
  assert.deepEqual(censusGitSpawns([{ rel: 'scripts/x.mjs', text: helper + probe('@SPAWN@', 'env: sandboxEnv(d)') }], {}), []);
  const live = collectScriptsMjs(repo).filter((f) => f.rel === 'scripts/release-notes.test.mjs');
  assert.equal(live.length, 1);
  assert.deepEqual(censusGitSpawns(live, {}), []);
});

// Branches of the rule the witness list does not name, each with its own leg.
test('census (08d): an options spread AFTER env, a loop variable named env, a reassigned env and a helper with a second return are findings', () => {
  const good = "const env = { PATH: process.env.PATH, " + NS + " };\n";
  assert.equal(one(good + SG + ", ['x'], { env, ...opts });\n").length, 1, 'a spread after env can replace it');
  assert.deepEqual(one(good + SG + ", ['x'], { ...opts, env });\n"), [], 'a spread BEFORE env is replaced by it');
  assert.equal(one("for (const env of list) {\n" + SG + ", ['x'], { env });\n}\n").length, 1, 'a loop variable is unreadable');
  assert.equal(one(good + "let again = 1;\nenv = { ...gitEnv(d) };\n" + SG + ", ['x'], { env });\n").length, 1, 'a reassignment after the declaration');
  assert.equal(one("function mk() { if (a) return { PATH: process.env.PATH, " + NS + " }; return { PATH: process.env.PATH }; }\n" + SG + ", ['x'], { env: mk() });\n").length, 1, 'every return of a helper is judged');
  assert.equal(one(KEEPLIST + "const env = { ...Object.fromEntries(keep.filter(Boolean).concat(other)), " + NS + " };\n" + SG + ", ['x'], { env });\n").length, 1, 'a pick may only filter and map');
  assert.equal(one(KEEPLIST + "keep[0] = 'GIT_DIR';\nconst env = { " + PICK + ", " + NS + " };\n" + SG + ", ['x'], { env });\n").length, 1, 'a key list written after its declaration');
  assert.equal(one(good + "const env2 = 1;\nconst env = { ...process.env };\n" + SG + ", ['x'], { env });\n").length, 1, 'a second declaration is judged too');
  assert.equal(one(SG + ", ['x'], { env: gitEnv(d) || other });\n").length, 1, 'gitEnv(...) is trusted alone, not as the head of a larger expression');
  assert.match(one(SG + ", ['x'], { env: flag ? good : other });\n")[0], /cannot read/, 'a ternary is an env the census cannot read');
  assert.match(one("for (const env of list) {\n" + SG + ", ['x'], { env });\n}\n")[0], /loop variable/, 'the loop variable is named as the reason');
  assert.match(one(SG + ", ['x'], { env: { " + NS + ", ['GIT' + '_DIR']: 1 } });\n")[0], /computed property key/, 'a computed key is named as the reason');
  assert.equal(one(good + "const note = process['env'];\n" + SG + ", ['x'], { env });\n").length, 1, 'process[...] anywhere in the file is a read of the whole object');
  assert.equal(one("import { env as penv } from 'node:process';\n" + SG + ", ['x'], { env: { PATH: 'x', " + NS + " } });\n").length, 1, 'an import of the process env anywhere in the file, with no env binding to trip');
  assert.deepEqual(one("const env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: /* the system config is off */ '1' };\n" + SG + ", ['x'], { env });\n"), [], 'a block comment inside the NOSYSTEM value does not make the value something other than the literal 1');
  assert.equal(one("function a() { const env = { PATH: process.env.PATH, " + NS + " }; return env; }\nfunction b() { const env = { PATH: process.env.PATH }; " + SG + ", ['x'], { env }); }\n").length, 1, 'the second declaration alone lacks GIT_CONFIG_NOSYSTEM');
  assert.deepEqual(one("const env = { /* note */ PATH: process.env.PATH, /* the system config is off */ " + NS + " };\n" + SG + ", ['x'], { env });\n"), [], 'a block comment between members is not an unreadable member');
  assert.equal(one(KEEPLIST + "const env = { ...Object.fromEntries(keep.filter((k) => Object.keys(other).includes(k)).map((k) => [k, process.env[k]])), " + NS + " };\n" + SG + ", ['x'], { env });\n").length, 1, 'a pick callback may not read another whole object');
});

// 08d bounce 2: the branches of the any-other-use rule and of the for-in read, each with a leg only that branch can catch.
test('census (08d bounce 2): a bare reference to the env binding, a for-in over process.env and a shebang line', () => {
  const good = "const env = { PATH: process.env.PATH, " + NS + " };\n";
  assert.match(one(good + "const other = flag ? env : {};\n" + SG + ", ['x'], { env });\n")[0], /bare reference/, 'an alias through a ternary names the bare reference');
  assert.equal(one(good + "log(Object.keys(env));\n" + SG + ", ['x'], { env });\n").length, 1, 'a call argument is a bare reference');
  assert.deepEqual(one(good + "const home = env.PATH;\nconst first = env['PATH'];\n" + SG + ", ['x'], { env });\n" + SG + ", ['y'], { cwd: d, env: env });\n"), [], 'a member read and both spawn forms are allowed');
  assert.equal(one(good + "let n = 0;\nfor (const k in process.env) n++;\n" + SG + ", ['x'], { env });\n").length, 1, 'a for-in over process.env reads the whole object');
  assert.deepEqual(one(good + "const present = 'PATH' in process.env;\n" + SG + ", ['x'], { env });\n"), [], 'a presence test is not a read of the object');
  assert.deepEqual(one('#!/usr/bin/env node\n' + good + SG + ", ['x'], { env });\n"), [], 'a shebang line naming env is not a use of the binding');
});

test('census (08d bounce 2): the any-other-use rule also binds a spread source and a key list, and a destructured parameter or a second declaration is judged', () => {
  const good = "const env = { PATH: process.env.PATH, " + NS + " };\n";
  const pickDecl = "const pick = { PATH: process.env.PATH };\n";
  assert.deepEqual(one(pickDecl + "const env = { ...pick, " + NS + " };\n" + SG + ", ['x'], { env });\n"), [], 'a spread source used only by its spread is clean');
  assert.equal(one(pickDecl + "fill(pick);\nconst env = { ...pick, " + NS + " };\n" + SG + ", ['x'], { env });\n").length, 1, 'a spread source handed to a call can be changed there');
  assert.equal(one(KEEPLIST + "fill(keep);\nconst env = { " + PICK + ", " + NS + " };\n" + SG + ", ['x'], { env });\n").length, 1, 'a key list handed to a call can gain a GIT_ name there');
  assert.equal(one(good + "function run({ env }) {\n" + SG + ", ['x'], { env });\n}\n").length, 1, 'a destructured parameter named env is unreadable');
  assert.ok(one("function a() { const env = { PATH: process.env.PATH, " + NS + " };\n" + SG + ", ['a'], { env }); }\nfunction b() { const env = { PATH: process.env.PATH };\n" + SG + ", ['b'], { env }); }\n").length >= 1, 'the second declaration alone lacks NOSYSTEM and is judged, with no return env to trip the other rule');
});
