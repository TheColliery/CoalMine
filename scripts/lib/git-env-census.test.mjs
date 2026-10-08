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
  assert.deepEqual(one(allowFile(ALLOW_GOOD).replace('// x', '')), [], 'control: the three canon names are allowed');
  assert.deepEqual(one('// GIT_DIR is what a hook leaves behind\n' + allowFile(ALLOW_GOOD)), [], 'a name in a line comment is not a key');
});

test('census rule (a): a shorthand env with no declaration in the file, or declared as a call, stays a finding', () => {
  const f = one(SG + ", ['status'], { encoding: 'utf8', env });\n");
  assert.equal(f.length, 1);
  assert.match(f[0], /carries no 'env:'/);
  const call = one("const env = buildEnv();\n" + SG + ", ['status'], { env });\n");
  assert.equal(call.length, 1, 'an env the census cannot read is never waved through');
  assert.match(call[0], /carries no 'env:'/);
});
