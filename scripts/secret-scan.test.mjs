#!/usr/bin/env node
// Unit tests for scripts/lib/secret-scan.mjs. PORTABLE like the module: node builtins only, no
// repository path or name, so a sibling repo copies this file beside the module unchanged.
//
// ⚠️ NO SECRET-SHAPED LITERAL APPEARS IN THIS FILE. Every sample is assembled at runtime from
// fragments, so a scan of this file finds nothing, and no copy of it carries a usable key shape.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { PATTERNS, scanLine, scanText, scanPatch, scanPushed, parsePushRefs, rangeArgs, fingerprint, shannon, ENTROPY_THRESHOLD } from './lib/secret-scan.mjs';
import * as scanLib from './lib/secret-scan.mjs';

const cc = (...c) => String.fromCharCode(...c);
const SAMPLES = {
  'aws-access-key-id': cc(65, 75, 73, 65) + 'TESTFAKEKEY00000',
  'github-token': 'gh' + 'p_' + 'A1b2'.repeat(9),
  'github-fine-grained-pat': 'github' + '_pat_' + 'A1_b'.repeat(15),
  'gitlab-pat': 'gl' + 'pat-' + 'A1b2C3d4E5f6G7h8I9j0',
  'sendgrid-api-key': 'S' + 'G.' + 'A'.repeat(22) + '.' + 'B'.repeat(43),
  'square-access-token': 'sq0' + 'atp-' + 'A1b2'.repeat(6),
  'square-oauth-secret': 'sq0' + 'csp-' + 'A1b2'.repeat(11),
  'anthropic-api-key': 'sk' + '-ant-' + 'api03-' + 'A1b2'.repeat(10),
  'openai-style-api-key': 'sk' + '-proj-' + 'A1b2C3'.repeat(7),
  'slack-token': 'xo' + 'xb-' + '1234567890-abcdef',
  'stripe-live-key': 'sk' + '_live_' + 'A1b2'.repeat(7),
  'google-api-key': 'AI' + 'za' + 'A1b2C3d4E5'.repeat(3) + 'F6g7H',
  'private-key-pem': '-'.repeat(5) + 'BEGIN RSA PRIVATE KEY' + '-'.repeat(5),
};

test('every named pattern fires on its own runtime-assembled sample, and names only itself', () => {
  assert.deepStrictEqual(Object.keys(SAMPLES).sort(), PATTERNS.map((p) => p.name).sort(), 'one sample per pattern, no pattern untested');
  for (const [name, sample] of Object.entries(SAMPLES)) {
    assert.deepStrictEqual(scanLine(`value: ${sample} end`), [name], `${name} must fire on its sample and nothing else must`);
  }
});

test('prose that names a prefix is not a hit', () => {
  for (const line of [
    'AWS keys start with the access-key prefix; GitHub tokens start with gh and an underscore',
    'the sk' + '-learn-compatible-models-and-more-of-them list has no key in it',
    'a PEM header looks like BEGIN ... PRIVATE KEY without the dashes',
  ]) assert.deepStrictEqual(scanLine(line), [], line);
});

test('the generic rule: a high-entropy value assigned to a key-like name fires', () => {
  const name = 'client' + '_secret';
  assert.deepStrictEqual(scanLine(`${name} = "q7Rt2Lk9` + 'Xw4Zp1Mn8Vb3Yc6"'), ['generic-high-entropy-assignment']);
});

test('the generic rule cannot fire on hashes, SHAs, UUIDs, references or low-entropy values', () => {
  const hex64 = 'a1b2c3d4e5f60718'.repeat(4);
  // the hex alphabet caps entropy at log2(16) = 4.0 bits/char, below nothing and excluded anyway
  assert.ok(shannon(hex64) <= 4, 'hex entropy is bounded by 4.0');
  assert.ok(ENTROPY_THRESHOLD < 4, 'so the hex exclusion, not the threshold, is what removes hashes');
  for (const line of [
    `api_token_sha256 = ${hex64}`,
    `secret_commit: ${hex64.slice(0, 40)}`,
    `access_key_id = ${hex64.slice(0, 8)}-${hex64.slice(8, 12)}-${hex64.slice(12, 16)}-${hex64.slice(16, 20)}-${hex64.slice(20, 32)}`,
    'password: $' + '{{ secrets.DEPLOY_PASSWORD_2026 }}',
    'token = process.env.GITHUB_TOKEN_FOR_THIS_REPOSITORY',
    'secret_name = zzzzzzzzzzzzzzzzzzzzzzz1', // not hex, so only the ENTROPY gate can stop it
    'cache_key = short1',
  ]) assert.deepStrictEqual(scanLine(line), [], line);
});

// ONE MATCH MAY NEVER HIDE ANOTHER ON THE SAME LINE (LWK-212 round 2). Every value on a line is a
// hit of its own with its own fingerprint, so neither a failed check nor an acknowledgment of one
// value can silence a different value beside it.
test('a decoy that fails a pattern check cannot hide a real value later on the same line', () => {
  const decoy = 'sk' + '-learn-compatible-models-and-more-of-them';
  assert.deepStrictEqual(scanLine(`${decoy} ${SAMPLES['openai-style-api-key']}`), ['openai-style-api-key']);
});

test('two values of one pattern on one line are two hits with two fingerprints', () => {
  const second = 'gh' + 'p_' + 'Z9y8'.repeat(9);
  const hits = scanText(`a ${SAMPLES['github-token']} b ${second}`, 'f.txt');
  assert.strictEqual(hits.length, 2, 'acking the first value must not silence the second');
  assert.notStrictEqual(hits[0].fp, hits[1].fp);
});

test('a pattern hit does not suppress a generic hit on the same line, and two generic values are two hits', () => {
  const name = 'client' + '_secret';
  const gen = `${name} = "q7Rt2Lk9` + 'Xw4Zp1Mn8Vb3Yc6"';
  assert.deepStrictEqual(scanLine(`${SAMPLES['google-api-key']} ${gen}`).sort(), ['generic-high-entropy-assignment', 'google-api-key']);
  const gen2 = 'api' + `_token: "Hj5Kd8Pq2Ws7Vx4` + 'Nb1Mz6Rt"';
  assert.deepStrictEqual(scanLine(`${gen}; ${gen2}`), ['generic-high-entropy-assignment', 'generic-high-entropy-assignment']);
});

test('a skipped reference cannot swallow a real value joined to it by "&" (a query string)', () => {
  const real = 'api' + '_key=q7Rt2Lk9' + 'Xw4Zp1Mn8Vb3Yc6';
  assert.deepStrictEqual(scanLine('https://x.test/p?token=$' + '{VAR}&' + real), ['generic-high-entropy-assignment']);
});

test('a value a pattern already matched is not reported a second time by the generic rule', () => {
  // the assigned value IS the pattern's match: one hit, so an ack of it covers the whole line
  assert.deepStrictEqual(scanLine('api' + `_key = "${SAMPLES['stripe-live-key']}"`), ['stripe-live-key']);
});

test('a hit carries line, pattern and fingerprint — never the value', () => {
  const hits = scanText(`clean\nx = ${SAMPLES['github-token']}\n`, 'a/b.txt');
  assert.strictEqual(hits.length, 1);
  assert.deepStrictEqual(Object.keys(hits[0]).sort(), ['fp', 'line', 'pattern']);
  assert.strictEqual(hits[0].line, 2);
  assert.match(hits[0].fp, /^[0-9a-f]{16}$/);
  assert.strictEqual(JSON.stringify(hits).includes('A1b2'), false, 'no fragment of the value may appear in a hit');
});

test('a fingerprint is stable per file, pattern and value, and differs across files', () => {
  assert.strictEqual(fingerprint('f', 'p', 'v'), fingerprint('f', 'p', 'v'));
  assert.notStrictEqual(fingerprint('f', 'p', 'v'), fingerprint('g', 'p', 'v'));
  assert.notStrictEqual(fingerprint('f', 'p', 'v'), fingerprint('f', 'p', 'w'));
});

test('scanPatch scans ADDED lines only, with new-file line numbers, including a "++" content line', () => {
  const key = SAMPLES['stripe-live-key'];
  const patch = [
    cc(0) + 'COMMIT ' + 'c'.repeat(40),
    'diff --git a/x.txt b/x.txt',
    '--- a/x.txt',
    '+++ b/x.txt',
    '@@ -3,0 +4,2 @@ context',
    '+clean',
    `+++ ${key}`, // an ADDED line whose content is "++ <key>": it reads exactly like a file header
    '@@ -9 +10,0 @@',
    `-${SAMPLES['aws-access-key-id']}`,
    'diff --git a/gone.txt b/gone.txt',
    '--- a/gone.txt',
    '+++ /dev/null',
    '',
  ].join('\n');
  const hits = scanPatch(patch);
  assert.strictEqual(hits.length, 1, 'the removed line must not count; the "++" line must');
  assert.deepStrictEqual({ file: hits[0].file, line: hits[0].line, pattern: hits[0].pattern }, { file: 'x.txt', line: 5, pattern: 'stripe-live-key' });
  assert.strictEqual(hits[0].commit, 'c'.repeat(40));
});

test('parsePushRefs reads git lines and REFUSES a malformed one', () => {
  const a = 'a'.repeat(40), z = '0'.repeat(40);
  assert.deepStrictEqual(parsePushRefs(`refs/heads/main ${a} refs/heads/main ${z}\n\n`),
    [{ localRef: 'refs/heads/main', localSha: a, remoteRef: 'refs/heads/main', remoteSha: z }]);
  assert.deepStrictEqual(parsePushRefs(''), []);
  assert.throws(() => parsePushRefs('refs/heads/main not-a-sha refs/heads/main x\n'));
  assert.throws(() => parsePushRefs('three fields only\n'));
});

test('rangeArgs: deletion skips, new branch and unknown remote scan against all remotes, else remote..local', () => {
  const a = 'a'.repeat(40), b2 = 'b'.repeat(40), z = '0'.repeat(40);
  const ref = (l, r) => ({ localRef: 'x', localSha: l, remoteRef: 'x', remoteSha: r });
  assert.strictEqual(rangeArgs(ref(z, b2), () => true), null);
  assert.deepStrictEqual(rangeArgs(ref(a, z), () => true), [a, '--not', '--remotes']);
  assert.deepStrictEqual(rangeArgs(ref(a, b2), () => false), [a, '--not', '--remotes']);
  assert.deepStrictEqual(rangeArgs(ref(a, b2), () => true), [`${b2}..${a}`]);
  // the push remote named: only its own tracking refs count as already pushed
  assert.deepStrictEqual(rangeArgs(ref(a, z), () => true, 'origin'), [a, '--not', '--remotes=origin']);
  assert.deepStrictEqual(rangeArgs(ref(a, b2), () => true, 'origin'), [`${b2}..${a}`]);
});

// ------------------------------------------------------------ ROUND 3 (LWK-212 INSPECT bounce 1)
const BS = cc(92);

// F1. A regex runs synchronously, so an in-process test timeout cannot interrupt a hung scan. The
// scans run in a child with a hard kill, and each time is measured inside the child.
test('a 200k-character line dense with key-like names scans in under 1 s (no catastrophic backtracking)', () => {
  const LIB_URL = new URL('./lib/secret-scan.mjs', import.meta.url).href;
  const script = [
    `const m = await import(${JSON.stringify(LIB_URL)});`,
    'const N = 200000;',
    'const shapes = {',
    "  slug: 'word-'.repeat(7) + 'key-',",
    "  dotted: 'seg.'.repeat(6) + 'token.',",
    "  plainDotted: 'ab.',",
    "  spacedName: 'key' + ' '.repeat(50) + ':',",
    "  minified: 'a_key=v1,',",
    "  pemWords: '-----BEGIN ' + 'AB '.repeat(20),",
    "  gitlabRun: 'gl' + 'pat-',",
    "  underscoreKeys: '_key',",
    "  dottedKeys: 'a.key',",
    "  longSnakeNoOperator: 'A_'.repeat(40) + 'SECRET_' + 'B_'.repeat(40) + ' ',",
    '};',
    'const out = {};',
    'for (const [k, unit] of Object.entries(shapes)) {',
    '  const s = unit.repeat(Math.ceil(N / unit.length)).slice(0, N);',
    '  const t = process.hrtime.bigint();',
    '  m.scanLine(s);',
    '  out[k] = Math.round(Number(process.hrtime.bigint() - t) / 1e6);',
    '}',
    'console.log(JSON.stringify(out));',
  ].join('\n');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=512' },
  });
  assert.strictEqual(r.status, 0, `every scan must finish inside the kill timeout; status ${r.status}, signal ${r.signal}\n${r.stderr}`);
  const ms = JSON.parse(r.stdout);
  for (const [shape, t] of Object.entries(ms)) assert.ok(t < 1000, `${shape}: ${t} ms for ${200000} chars`);
});

// F7. git C-quotes a name holding special bytes. The unquoted name must fingerprint exactly like
// the same name in a tree scan, or an acknowledgment could never match it.
test('scanPatch unquotes every C escape git uses in a name, so a quoted name fingerprints like the tree', () => {
  const key = SAMPLES['stripe-live-key'];
  const cases = [
    [`"b/bel${BS}a.txt"`, `bel${cc(7)}.txt`],
    [`"b/v${BS}v${BS}b${BS}f.txt"`, `v${cc(11)}${cc(8)}${cc(12)}.txt`],
    [`"b/t${BS}t${BS}n${BS}r.txt"`, `t${cc(9)}${cc(10)}${cc(13)}.txt`],
    [`"b/q${BS}"${BS}${BS}.txt"`, `q"${BS}.txt`],
    [`"b/${BS}344${BS}275${BS}240.txt"`, `${cc(0x4f60)}.txt`], // one CJK character as three octal UTF-8 bytes
  ];
  for (const [quoted, name] of cases) {
    const patch = [cc(0) + 'COMMIT ' + 'c'.repeat(40), 'diff --git "a/x" "b/x"', '--- /dev/null', `+++ ${quoted}`,
      '@@ -0,0 +1 @@', `+x = ${key}`, ''].join('\n');
    const hits = scanPatch(patch);
    assert.strictEqual(hits.length, 1, quoted);
    assert.strictEqual(hits[0].file, name, quoted);
    assert.strictEqual(hits[0].fp, scanText(`x = ${key}`, name)[0].fp, `${quoted}: the range fingerprint must equal the tree fingerprint`);
  }
});

// F8. Cheap false-negative shapes.
test('an assignment written "=>" (PHP) or ":=" (Go) is read as an assignment', () => {
  const v = 'q7Rt2Lk9' + 'Xw4Zp1Mn8Vb3Yc6';
  assert.deepStrictEqual(scanLine(`'api` + `_key' => '${v}',`), ['generic-high-entropy-assignment']);
  assert.deepStrictEqual(scanLine(`apiKey := "${v}"`), ['generic-high-entropy-assignment']);
});

test('a provider key right after a literal backslash-n/r/t or a %XX escape is still a key', () => {
  const aws = SAMPLES['aws-access-key-id'];
  for (const pre of [`"env":"FOO=1${BS}n`, `a${BS}r`, `b${BS}t`, 'https://x.test/cb?q=token%3D', 'path%2F']) {
    assert.deepStrictEqual(scanLine(pre + aws), ['aws-access-key-id'], pre);
  }
  assert.deepStrictEqual(scanLine('xyz' + aws), [], 'a key glued to an ordinary word character is still not a key');
});

// Real git from here on: throwaway repos under the OS temp dir, every delete path-asserted.
const GITCFG = ['-c', 'user.name=scan-test', '-c', 'user.email=scan-test@example.invalid', '-c', 'commit.gpgsign=false',
  '-c', 'tag.gpgsign=false', '-c', 'core.autocrlf=false'];
const ZERO40 = '0'.repeat(40);
const gitAt = (cwd) => (args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
function inTemp(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-scan-test-'));
  try { return fn(root); } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())) && path.basename(root).startsWith('secret-scan-test-'),
      'refusing to delete outside the temp dir');
    fs.rmSync(root, { recursive: true, force: true });
  }
}
function repoIn(root, name, { bare = false } = {}) {
  const d = path.join(root, name);
  fs.mkdirSync(d);
  gitAt(d)(['init', '-q', ...(bare ? ['--bare'] : ['-b', 'main'])]);
  return d;
}
const run = (d, args) => gitAt(d)([...GITCFG, ...args]);
function commitIn(d, files, msg = 'c') {
  for (const [f, c] of Object.entries(files)) {
    const p = path.join(d, f);
    if (c === null) fs.rmSync(p);
    else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); }
  }
  run(d, ['add', '-A']);
  run(d, ['commit', '-q', '--allow-empty', '-m', msg]);
  return run(d, ['rev-parse', 'HEAD']).trim();
}
const refLine = (local, remote, ref = 'refs/heads/main') => `${ref} ${local} ${ref} ${remote}\n`;
const where = (hits) => hits.map((h) => `${h.kind}:${h.file}:${h.pattern}`).sort();

test('the pushed range scans a file git calls binary (a NUL byte, a -diff attribute), unless the caller skips its path', () => {
  inTemp((root) => {
    const d = repoIn(root, 'w');
    const aws = SAMPLES['aws-access-key-id'];
    const base = commitIn(d, { 'a.txt': 'hello\n' }, 'base');
    commitIn(d, { 'data.txt': `x${cc(0)}y\naws = ${aws}\n` }, 'nul');
    const n2 = commitIn(d, { 'data.txt': null }, 'rm');
    assert.deepStrictEqual(where(scanPushed(refLine(n2, base), gitAt(d)).hits), ['diff:data.txt:aws-access-key-id']);
    commitIn(d, { '.gitattributes': '*.cfg -diff\n' }, 'attr');
    commitIn(d, { 'x.cfg': `aws = ${aws}\n` }, 'cfg');
    const n3 = commitIn(d, { 'x.cfg': null }, 'rm');
    assert.deepStrictEqual(where(scanPushed(refLine(n3, n2), gitAt(d)).hits), ['diff:x.cfg:aws-access-key-id']);
    // the ONLY way a path escapes the range scan: an explicit predicate from the caller
    assert.deepStrictEqual(scanPushed(refLine(n3, n2), gitAt(d), { skipFile: (f) => f === 'x.cfg' }).hits, []);
  });
});

test('a key in a pushed commit message or annotated-tag message is a hit, never the value', () => {
  inTemp((root) => {
    const bare = repoIn(root, 'origin.git', { bare: true });
    const d = repoIn(root, 'w');
    run(d, ['remote', 'add', 'origin', bare]);
    const gh = SAMPLES['github-token'];
    const base = commitIn(d, { 'a.txt': 'hello\n' }, 'base');
    run(d, ['push', '-q', 'origin', 'main']);
    const m = commitIn(d, { 'c.txt': 'clean\n' }, `deploy with ${gh}`);
    const r1 = scanPushed(refLine(m, base), gitAt(d));
    assert.deepStrictEqual(where(r1.hits), ['message:null:github-token']);
    assert.strictEqual(r1.hits[0].line, 1);
    assert.strictEqual(JSON.stringify(r1.hits).includes('A1b2'), false, 'no fragment of the value may appear in a hit');
    // an annotated tag on a commit the remote already holds: no commit is new, the tag message is
    run(d, ['tag', '-a', 'at', base, '-m', `release note ${gh}`]);
    const tag = run(d, ['rev-parse', 'at']).trim();
    const r2 = scanPushed(refLine(tag, ZERO40, 'refs/tags/at'), gitAt(d));
    assert.strictEqual(r2.commits, 0);
    assert.deepStrictEqual(where(r2.hits), ['tag:null:github-token']);
    assert.notStrictEqual(r2.hits[0].fp, r1.hits[0].fp, 'a commit-message hit and a tag-message hit are different acknowledgments');
  });
});

test('with the push remote named, only THAT remote\'s tracking refs count as already pushed', () => {
  inTemp((root) => {
    const origin = repoIn(root, 'origin.git', { bare: true });
    const mirror = repoIn(root, 'mirror.git', { bare: true });
    const d = repoIn(root, 'w');
    run(d, ['remote', 'add', 'origin', origin]);
    run(d, ['remote', 'add', 'mirror', mirror]);
    commitIn(d, { 'a.txt': 'hello\n' }, 'base');
    run(d, ['checkout', '-q', '-b', 'mir']);
    const mk = commitIn(d, { 'm.txt': `m = ${SAMPLES['github-token']}\n` }, 'mir');
    run(d, ['push', '-q', 'mirror', 'mir']);
    const stdin = refLine(mk, ZERO40, 'refs/heads/mir');
    assert.deepStrictEqual(where(scanPushed(stdin, gitAt(d), { remote: 'origin' }).hits), ['diff:m.txt:github-token']);
    // no remote name (the push target was a bare URL): every remote's tracking refs, as before
    assert.deepStrictEqual(scanPushed(stdin, gitAt(d)).hits, []);
    for (const bad of ['-x', 'a*', 'a b', 'a[1]']) assert.throws(() => scanPushed(stdin, gitAt(d), { remote: bad }), TypeError, bad);
  });
});

test('every pushed hit names the ref it was found under, once per ref, so acknowledgments can be read per ref', () => {
  inTemp((root) => {
    const d = repoIn(root, 'w');
    const base = commitIn(d, { 'a.txt': 'hello\n' }, 'base');
    const leak = commitIn(d, { 'k.txt': `aws = ${SAMPLES['aws-access-key-id']}\n` }, 'leak');
    const top = commitIn(d, { 'b.txt': 'more\n' }, 'top');
    const r = scanPushed(refLine(leak, base, 'refs/heads/one') + refLine(top, base, 'refs/heads/two'), gitAt(d));
    assert.strictEqual(r.commits, 2, 'a commit reached by two refs is scanned once');
    assert.deepStrictEqual(r.hits.map((h) => h.refSha).sort(), [leak, top].sort());
    assert.strictEqual(new Set(r.hits.map((h) => h.fp)).size, 1, 'the same value, the same fingerprint');
  });
});

// ----------------------------------- FOLLOW-UP: long snake_case names (N1) · non-commit pushes (N2)
test('a key-like token deep inside a long snake_case name is found, before or after it', () => {
  const v = 'q7Rt2Lk9' + 'Xw4Zp1Mn8Vb3Yc6';
  const G = ['generic-high-entropy-assignment'];
  assert.deepStrictEqual(scanLine('A_'.repeat(35) + 'API' + '_KEY=' + v), G, '70 name characters before the token');
  assert.deepStrictEqual(scanLine('API' + '_KEY' + '_X'.repeat(35) + '=' + v), G, '70 name characters after the token');
  const env = 'SERVICE_PRODUCTION_EUROPE_WEST_PRIMARY_DATABASE_REPLICA_CONNECTION_' + 'SEC' + 'RET';
  assert.deepStrictEqual(scanLine(`${env}=${v}`), G, `a realistic ${env.length}-character env name`);
  // controls: a bare "key" is a name only at the start of a line, as before
  assert.deepStrictEqual(scanLine('items.map(key => valueFromTheMapWithLongName2)'), [], 'an arrow function is not an assignment');
  assert.deepStrictEqual(scanLine('monkey_business = ' + v), [], '"key" inside a word is not the key token');
});

test('a pushed ref whose object is not a commit (a tag of a blob or a tree) is refused, never passed', () => {
  inTemp((root) => {
    const d = repoIn(root, 'w');
    const base = commitIn(d, { 'a.txt': 'hello\n' }, 'base');
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: d, input: `aws = ${SAMPLES['aws-access-key-id']}\n`, encoding: 'utf8', timeout: 30000,
    }).trim();
    run(d, ['tag', '-a', 'blobtag', blob, '-m', 'plain note']);
    const annotated = run(d, ['rev-parse', 'blobtag']).trim();
    const tree = execFileSync('git', ['mktree'], {
      cwd: d, input: `100644 blob ${blob}\tsecret.env\n`, encoding: 'utf8', timeout: 30000,
    }).trim();
    for (const [label, sha, ref, type] of [
      ['G4a annotated tag of a blob', annotated, 'refs/tags/blobtag', 'blob'],
      ['G4b lightweight tag of a blob', blob, 'refs/tags/lwblob', 'blob'],
      ['G4c lightweight tag of a tree', tree, 'refs/tags/treetag', 'tree'],
    ]) {
      assert.throws(() => scanPushed(refLine(sha, ZERO40, ref), gitAt(d)),
        (e) => e.code === 'ENONCOMMIT' && e.refs.length === 1 && e.refs[0].ref === ref && e.refs[0].type === type, label);
    }
    // every non-commit ref is named at once, alongside a clean branch
    assert.throws(() => scanPushed(refLine(base, ZERO40) + refLine(blob, ZERO40, 'refs/tags/lwblob') + refLine(tree, ZERO40, 'refs/tags/treetag'), gitAt(d)),
      (e) => e.code === 'ENONCOMMIT' && e.refs.map((x) => x.ref).join(',') === 'refs/tags/lwblob,refs/tags/treetag');
    // controls, behaving as before: a branch, a tag of a commit, and a deletion
    run(d, ['tag', '-a', 'rel', base, '-m', 'release']);
    const rel = run(d, ['rev-parse', 'rel']).trim();
    assert.doesNotThrow(() => scanPushed(refLine(base, ZERO40) + refLine(rel, ZERO40, 'refs/tags/rel') + refLine(ZERO40, base, 'refs/heads/gone'), gitAt(d)));
  });
});

test('a non-secret assignment cannot swallow the secret assignment in its own value', () => {
  const v = ['Qz7', 'xV2', 'mK9', 'pL4', 'wR8', 'tY3', 'nB6', 'jH1'].join('');
  const q = cc(34);
  const G = ['generic-high-entropy-assignment'];
  assert.deepStrictEqual(scanLine(`$env:API` + `_KEY = ${q}${v}${q}`), G, 'PowerShell $env: assignment');
  assert.deepStrictEqual(scanLine(`url: https://example.invalid/p?api` + `_key=${v}`), G, 'a URL query behind a non-secret name');
  assert.deepStrictEqual(scanLine(`  opts: to` + `ken=${v}`), G, 'an inline YAML value holding an assignment');
  assert.deepStrictEqual(scanLine(`API` + `_KEY=${v}`), G, 'control: the plain assignment');
  // a secret-named value skipped as a reference or as too short is read again, so it hides nothing
  assert.deepStrictEqual(scanLine('to' + 'ken=$' + `{X}:api` + `_key=${v}`), G, 'behind a skipped reference');
  assert.deepStrictEqual(scanLine('pwd=ab:api' + `_key=${v}`), G, 'behind a skipped short value');
});

// A tag may point at ANOTHER tag; the chain still peels to a commit, so the non-commit guard lets it
// through. Every tag message on the chain is scanned, and each hit names the tag object it sits in.
test('a key in an INNER annotated tag of a tag chain is a hit naming that tag object, never the value', () => {
  inTemp((root) => {
    const d = repoIn(root, 'w');
    const gh = SAMPLES['github-token'];
    const base = commitIn(d, { 'a.txt': 'hello\n' }, 'base');
    run(d, ['tag', '-a', 'inner', base, '-m', `release note ${gh}`]);
    run(d, ['tag', '-a', 'outer', 'inner', '-m', 'clean outer message']);
    const inner = run(d, ['rev-parse', 'inner']).trim();
    const outer = run(d, ['rev-parse', 'outer']).trim();
    assert.strictEqual(run(d, ['cat-file', '-t', outer]).trim(), 'tag');
    assert.match(run(d, ['cat-file', 'tag', outer]), /^type tag$/m, 'fixture: the outer tag points at a tag object');
    assert.strictEqual(run(d, ['cat-file', '-t', `${outer}^{}`]).trim(), 'commit', 'fixture: the chain still peels to a commit');
    const r = scanPushed(refLine(outer, ZERO40, 'refs/tags/outer'), gitAt(d));
    assert.deepStrictEqual(where(r.hits), ['tag:null:github-token']);
    assert.strictEqual(r.hits[0].commit, inner, 'the hit names the inner tag object, not the outer');
    assert.strictEqual(r.hits[0].refSha, outer, 'the hit still belongs to the pushed ref');
    assert.strictEqual(r.tags, 2, 'both tag objects were read');
    assert.strictEqual(JSON.stringify(r.hits).includes('A1b2'), false, 'no fragment of the value may appear in a hit');
  });
});

test('a three-deep tag chain is walked to the bottom, and a key in the OUTER message is still a hit', () => {
  inTemp((root) => {
    const d = repoIn(root, 'w');
    const gh = SAMPLES['github-token'];
    const base = commitIn(d, { 'a.txt': 'hello\n' }, 'base');
    run(d, ['tag', '-a', 't1', base, '-m', `bottom ${gh}`]);
    run(d, ['tag', '-a', 't2', 't1', '-m', 'middle, clean']);
    run(d, ['tag', '-a', 't3', 't2', '-m', 'top, clean']);
    const [t1, t3] = ['t1', 't3'].map((n) => run(d, ['rev-parse', n]).trim());
    const deep = scanPushed(refLine(t3, ZERO40, 'refs/tags/t3'), gitAt(d));
    assert.deepStrictEqual(where(deep.hits), ['tag:null:github-token']);
    assert.strictEqual(deep.hits[0].commit, t1);
    assert.strictEqual(deep.tags, 3);
    // the current behaviour, kept: the key sits in the OUTER message and is found there, once
    run(d, ['tag', '-a', 'top', 't2', '-m', `outer ${gh}`]);
    const top = run(d, ['rev-parse', 'top']).trim();
    const outerHit = scanPushed(refLine(top, ZERO40, 'refs/tags/top'), gitAt(d));
    assert.strictEqual(outerHit.hits.filter((h) => h.commit === top).length, 1);
    // an outer hit keeps the fingerprint a single, unchained tag gives for the same value
    run(d, ['tag', '-a', 'solo', base, '-m', `outer ${gh}`]);
    const solo = scanPushed(refLine(run(d, ['rev-parse', 'solo']).trim(), ZERO40, 'refs/tags/solo'), gitAt(d));
    assert.strictEqual(solo.hits.length, 1);
    assert.strictEqual(solo.hits[0].fp, outerHit.hits.find((h) => h.commit === top).fp, 'the outer-tag fingerprint does not move');
    // one label for every tag message: an INNER hit has the fingerprint an unchained tag gives for the same value
    assert.strictEqual(deep.hits[0].fp, solo.hits[0].fp, 'an inner-tag hit and an unchained-tag hit share one fingerprint');
  });
});

test('a tag chain longer than the bound FAILS CLOSED instead of passing partly read', () => {
  // Docs that state this bound say "a tag chain longer than 16 tag objects"; the number is pinned
  // here so a change to the constant cannot leave that sentence false without a red test.
  assert.strictEqual(scanLib.MAX_TAG_DEPTH, 16, 'docs that state this bound change with it');
  inTemp((root) => {
    const d = repoIn(root, 'w');
    const base = commitIn(d, { 'a.txt': 'hello\n' }, 'base');
    run(d, ['tag', '-a', 'c0', base, '-m', 'level 0']);
    for (let i = 1; i <= scanLib.MAX_TAG_DEPTH; i++) run(d, ['tag', '-a', `c${i}`, `c${i - 1}`, '-m', `level ${i}`]);
    const atBound = run(d, ['rev-parse', `c${scanLib.MAX_TAG_DEPTH - 1}`]).trim();
    assert.doesNotThrow(() => scanPushed(refLine(atBound, ZERO40, 'refs/tags/atbound'), gitAt(d)), 'a chain exactly at the bound is read in full');
    const past = run(d, ['rev-parse', `c${scanLib.MAX_TAG_DEPTH}`]).trim();
    assert.throws(() => scanPushed(refLine(past, ZERO40, 'refs/tags/past'), gitAt(d)), (e) => e.code === 'ETAGCHAIN');
  });
});

// A stub git whose every tag object has the text `tagText`. `reads` counts the tag objects it was asked for.
function tagStub(tagText) {
  const stub = (args) => {
    if (args[0] === 'cat-file' && args[1] === '-t' && args[2].endsWith('^{}')) return 'commit\n';
    if (args[0] === 'cat-file' && args[1] === '-t') return 'tag\n';
    if (args[0] === 'cat-file' && args[1] === '-e') throw new Error('absent');
    if (args[0] === 'rev-list') return '';
    if (args[0] === 'cat-file' && args[1] === 'tag') { stub.reads++; return tagText; }
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
  stub.reads = 0;
  return stub;
}
const stubA = 'a'.repeat(40);

test('a tag object that points back at one already read FAILS CLOSED on the repeat itself, not on the depth bound', () => {
  // git cannot make a cycle, so a stub does. Without the repeat guard the depth bound would still
  // stop it, after MAX_TAG_DEPTH reads: counting the reads is what tells the two apart.
  const loop = tagStub(`object ${stubA}\ntype tag\ntag loop\n\nclean\n`);
  assert.throws(() => scanPushed(refLine(stubA, ZERO40, 'refs/tags/loop'), loop), (e) => e.code === 'ETAGCHAIN');
  assert.strictEqual(loop.reads, 1, 'the repeat is caught on the second sight of the object, after one read');
});

test('a tag object missing the object header, the type header, or both FAILS CLOSED with ETAGCHAIN', () => {
  const cases = [
    ['no headers at all', 'garbage with no headers\n'],
    ['object line, no type line', `object ${stubA}\ntag half\n\nclean\n`],
    ['type line, no object line', 'type commit\ntag half\n\nclean\n'],
  ];
  for (const [label, text] of cases) {
    assert.throws(() => scanPushed(refLine(stubA, ZERO40, 'refs/tags/half'), tagStub(text)), (e) => e.code === 'ETAGCHAIN', label);
  }
});
