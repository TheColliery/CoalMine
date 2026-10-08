#!/usr/bin/env node
// Unit tests for scripts/lib/secret-scan.mjs. PORTABLE like the module: node builtins only, no
// repository path or name, so a sibling repo copies this file beside the module unchanged.
//
// ⚠️ NO SECRET-SHAPED LITERAL APPEARS IN THIS FILE. Every sample is assembled at runtime from
// fragments, so a scan of this file finds nothing, and no copy of it carries a usable key shape.
import test, { after } from 'node:test';
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

// LWK-264. Two shapes false-alarmed the generic rule on real repositories, both found by their MASKED shape (no value was ever
// printed). Every fixture below is synthetic: a made-up identifier or token, never a value from any real file. Each new
// shape is paired with a REAL-secret-shaped fixture on the same left side that must STILL fire, because the repair may
// never be a wider hole: the answer is a better boundary, not an exclusion, an acknowledgement or a higher floor.
const G264 = ['generic-high-entropy-assignment'];
const RAND264 = 'q7Rt2Lk9' + 'Xw4Zp1Mn8Vb3Yc6Dd5Ff0Gg'; // a 30-character random base62 literal

test('a .NET ResX file reference: the closing </value> tag is not part of the public key token before it', () => {
  // The token name is built from pieces so this file holds no `...Token=` assignment for the house scan to read (the file scans itself).
  // The pieces are joined, not added with `+`: CodeQL's js/missing-space-in-concatenation (Kolwen alert 24) reads two adjacent string
  // literals joined by `+` as a sentence missing a space, and this one is deliberate. What is built is unchanged, character for character.
  const head = ['<value>..', '\\Resources\\icon.png;System.Drawing.Bitmap, System.Drawing, Version=4.0.0.0, Culture=neutral, Public', 'KeyToken='].join('');
  assert.deepStrictEqual(scanLine(head + 'a1b2c3d4e5f60718' + '</value>'), [], 'the framework token is a 16-character hex name, and the tag is markup');
  // controls on the same left side: a real high-entropy literal is still a hit, with or without the tag after it
  assert.deepStrictEqual(scanLine(head + RAND264 + '</value>'), G264, 'a real value followed by the closing tag');
  assert.deepStrictEqual(scanLine(head + RAND264), G264, 'a real value with nothing after it');
});

test('a long identifier on the right of a secret-named left side is code, not a literal', () => {
  const id = 'resolveLocalStateFileForBrowserProfileV2'; // 40 characters, a digit, letters of both cases: past every content gate
  for (const [label, line] of [
    ['a call wrapped in a call', 'path' + `_key = str(${id}("Local State"))`],
    ['a bare call', 'encrypted' + `_key = ${id}(blob)`],
    ['a call with a numeric argument', 'let pad' + `_token_id = ${id}(0);`],
    ['an index expression', 'token' + `_ids: ${id}[1..]`],
    ['a path of identifiers', 'self.session' + `_token = ${'self.' + id}(0)`],
  ]) assert.deepStrictEqual(scanLine(line), [], label);
  // controls: the same four left sides with a REAL high-entropy literal on the right still fire, quoted or bare
  assert.deepStrictEqual(scanLine('path' + `_key = "${RAND264}"`), G264, 'quoted literal');
  assert.deepStrictEqual(scanLine('encrypted' + `_key = ${RAND264}`), G264, 'bare literal');
  assert.deepStrictEqual(scanLine('let pad' + `_token_id = ${RAND264};`), G264, 'bare literal before a semicolon');
  assert.deepStrictEqual(scanLine('token' + `_ids: ${RAND264}`), G264, 'bare literal after a colon');
  // a quoted value is a literal even when it looks like a call: the quote is the writer saying so
  assert.deepStrictEqual(scanLine('path' + `_key = "${id}(blob"`), G264, 'a quoted call-shaped value is still judged as a literal');
  // a real key written behind a skipped call is still found: the walk goes on inside what it skips
  assert.deepStrictEqual(scanLine('path' + `_key = ${id}(x) api` + `_key=${RAND264}`), G264, 'a real key behind a call');
});

// LWK-264, round 2. The repair may widen nothing: a real, machine-generated secret that the rule caught before must still be
// caught. Some generators draw from an alphabet that holds `(` or `[` (a default web-framework secret key; a password manager
// with symbols), so a bare real secret CAN start with an identifier-looking run followed by `(`. Each fixture below is a
// synthetic key of that kind, placed ON one edge of the guard that reads a bare value as code: where the code charset ends,
// what may open the identifier, what counts as a quote, what ends a value. Every one must fire.
test('a real machine-generated secret on an edge of the code-value guard still fires', () => {
  // every character class of a default framework key: the key's first non-identifier character is `(`
  const django = 'k7m2q9x4' + '(' + 'v8b3n6' + '*' + 'p1r5t0w' + '#' + 'z2c4' + '!' + 'y6u8i9o3' + '^' + 'a5s7d1f' + '%' + 'g3h5j';
  const bracket = 'Qw3rT9y' + '[' + 'Zp2Lm8' + '!' + 'Vb4nC6' + '#' + 'Hj1'; // a symbol password whose first symbol is `[`
  const dashLed = 'k7m2' + '-' + 'q9x4' + '(' + 'v8b3n6*p1r5t0w#z2c4y6u8i9o3'; // `-` inside the first run
  const digitLed = '7km2q9x4' + '(' + 'v8b3n6*p1r5t0w#z2c4y6u8i9o3'; // a digit opens the run
  const angled = 'k7m2q9x4' + '<' + 'v8b3n6p1r5t0wz2c4y6u8i9o3'; // `<` that is not the start of a closing tag
  const notATag = 'k7m2q9x4v8b3n6' + '</9' + 'p1r5t0wz2c4y6u8i9o3'; // `</` that is not a closing tag
  const tagMid = 'k7m2q9x4v8b3n6' + '</a>' + 'p1r5t0wz2c4y6u8i9o3'; // a tag-shaped piece with more key after it
  // Each next value passes the code-value guard's earlier conditions and fails exactly ONE, so dropping that one condition
  // (or loosening it a notch) turns a real secret quiet and one of these goes red.
  const hyphened = 'generousBanana-operationMedia-alligators' + '(' + '1xq'; // condition 1: `-` ends the identifier run
  const wordsNoBracket = 'correctlyHorse' + 'batterystaples' + '2026'; // condition 1: no `(` or `[` at all, words with a hump
  const wordsDigitLed = '7correctHorseBatteryStaple' + '(' + '1x'; // condition 1: a digit may not open the run
  const symbolTail = 'resolveLocalStateFileForBrowserProfile' + '(' + 'a*b#c1'; // condition 2: the WHOLE value is code characters
  const noVowels = 'qwrtypklsjhg_fdszxcvbnm' + '(' + '1x'; // condition 3: vowels are scarce in a random run
  const digitsBetween = 'a1b2c3d4e5f6_g7h8i9j0k1l2' + '(' + 'm3n4'; // condition 3: no run of six word characters
  const loudCase = 'aQeWiRoTuYaSeDiFoGuHaJeKiLoZuXaCeVi' + '(' + '1x'; // condition 4: half the letters are upper case
  // condition 5: code has `_`, `.` or a camelCase hump; a passphrase of plain words joined by a bracket has none
  const passParen = 'pastel(gerbil7(unbutton(corridor';
  const passSquare = 'pastel[gerbil7[unbutton[corridor';
  // condition 5, the other side: capitals with NO hump (`[a-z][A-Z]`) are a Capitalised passphrase, not code. Loosening the
  // hump test to "any capital letter" reads this as code, so this fixture is what holds the hump test at `[a-z][A-Z]` (G-1).
  const passCaps = 'Pastel(Gerbil7(Unbutton(Corridor';
  const id = 'resolveLocalStateFileForBrowserProfileV2';
  for (const [label, line] of [
    ['a framework key, .env bare', 'SECRET' + `_KEY=${django}`],
    ['a tag-shaped piece with more key after it', 'SECRET' + `_KEY=${tagMid}`],
    ['words joined by hyphens before a bracket', 'DB' + `_PASSWORD=${hyphened}`],
    ['plain words with no bracket at all', 'DB' + `_PASSWORD=${wordsNoBracket}`],
    ['a digit opening a word-like run', 'DB' + `_PASSWORD=${wordsDigitLed}`],
    ['a word-like prefix with a symbol tail', 'DB' + `_PASSWORD=${symbolTail}`],
    ['a long run of consonants, no vowels', 'DB' + `_PASSWORD=${noVowels}`],
    ['letters and digits alternating', 'DB' + `_PASSWORD=${digitsBetween}`],
    ['a vowel-rich run of random case', 'DB' + `_PASSWORD=${loudCase}`],
    ['a passphrase of words joined by (', 'SECRET' + `_KEY=${passParen}`],
    ['a passphrase of words joined by [', 'SECRET' + `_KEY=${passSquare}`],
    ['a Capitalised passphrase of words joined by (, capitals but no camelCase hump', 'SECRET' + `_KEY=${passCaps}`],
    ['the same passphrase joined by hyphens (control)', 'SECRET' + `_KEY=${passParen.replace(/\(/g, '-')}`],
    ['the same passphrase, quoted (control)', 'SECRET' + `_KEY="${passParen}"`],
    ['a framework key, YAML bare', 'secret' + `_key: ${django}`],
    ['a framework key, quoted', 'SECRET' + `_KEY="${django}"`],
    ['a symbol password opening with a bracket, bare', 'DB' + `_PASSWORD=${bracket}`],
    ['a dash inside the first run', 'SECRET' + `_KEY=${dashLed}`],
    ['a digit opening the first run', 'SECRET' + `_KEY=${digitLed}`],
    ['a `<` that does not open a closing tag', 'SECRET' + `_KEY=${angled}`],
    ['a `</` that is not a closing tag', 'SECRET' + `_KEY=${notATag}`],
    ['a real key followed on the line by a call', 'api' + `_key=${RAND264}; init(cfg)`],
    ['a single-quoted call-shaped value', 'path' + `_key = '${id}(blob'`],
    ['a backtick-quoted call-shaped value', 'path' + `_key = \`${id}(blob\``],
  ]) assert.deepStrictEqual(scanLine(line), G264, label);
});

// LWK-277. A constant that NAMES an environment variable (`SECRET_ENV = 'CLOUDFLARE_…_TENANT'`) is not a secret: the value is an
// all-caps snake_case NAME, and the left side says so (`…_ENV`, `…_VAR`, `…_NAME`, `envVar`). Three conditions, all required, so the
// quiet case stays far from any real secret: a pointer-style left name, a value of word-like all-caps segments joined by `_`, AND a
// value that itself holds a secret word (U4-A: a passphrase with a short token but no secret word must fire). Each
// quiet fixture below fires on the unpatched lib; each control sits ONE step outside the case and must still fire.
const ENV277 = ['CLOUDFLARE', 'R2', 'SECRET', 'ACCESS', 'KEY', 'TENANT'].join('_');
const PASSPHRASE277_R2 = ['CORRECT', 'HORSE', 'R2', 'BATTERY', 'STAPLE'].join('_'); // the same, with a short letter+digit token inside
const PASSPHRASE277 =['CORRECT', 'HORSE', 'BATTERY', 'STAPLE', '2026'].join('_'); // assembled, so the gate's own scan sees no secret-shaped literal
test('an environment-variable NAME held by a constant named for it is not a secret', () => {
  for (const [label, line] of [
    ['a quoted constant', 'SECRET' + `_ENV = '${ENV277}'`],
    ['export const, with the semicolon', 'export const SECRET' + `_ENV = '${ENV277}';`],
    ['.env, bare', 'SECRET' + `_ENV=${ENV277}`],
    ['YAML', 'secret' + `_env: ${ENV277}`],
    ['a camelCase left name', 'secret' + `EnvVar = '${ENV277}'`],
    ['a ..._Name left name', 'apiKey' + `Name = 'STRIPE_LIVE_SECRET_KEY_V2_BACKUP'`],
    ['a ..._env_name left name, a digit in a short segment', 'token' + `_env_name: 'GITHUB_APP_INSTALLATION_TOKEN_V2'`],
  ]) assert.deepStrictEqual(scanLine(line), [], label);
});

test('the pointer-name quiet case is narrow: a plain secret name, or a real secret on a pointer name, still fires', () => {
  const pointer = 'SECRET' + '_ENV';
  for (const [label, line] of [
    ['the same value on a plain secret name', 'SECRET' + `_KEY = '${ENV277}'`],
    ['a random base62 value on a pointer name', `${pointer} = '${RAND264}'`],
    ['a random base62 value on a pointer name, bare', `${pointer}=${RAND264}`],
    ['random capitals and digits with underscores, not word-like segments', `${pointer} = 'X7Q_2L9K4W_4ZP1M8V3B3Y6D5F0G_1H'`],
    ['random capitals and digits, no underscore', `${pointer} = 'Q7R2L9X4W4Z1P1M8V3B3Y6D5F0G1H2'`],
    ['a mixed-case value that only looks like a name', `${pointer} = 'Cloudflare_R2_secret_access_key_tenant'`],
    ['a name-shaped value on a password name', 'DB' + `_PASSWORD = '${PASSPHRASE277}'`],
    ['a word-like name with a lowercase tail', `${pointer} = '${ENV277}_xq7'`],
    ['a name-shaped value over the 100-character limit', `${pointer} = '${ENV277}_${ENV277}_${ENV277}'`],
    ['a five-character segment that is not a word (letters and digits)', `${pointer} = 'X7Q_L9K4W_ZP1M8V3B3Y6D5F0G_H1'`],
    ['words with no vowel', `${pointer} = 'QXZTBRNK_PLMSWRTY_HGFDSKJL_R2_KEY'`],
    ['an empty segment (a doubled underscore)', `${pointer} = 'CLOUDFLARE__R2_SECRET_ACCESS_KEY_TENANT'`],
    ['a leading underscore', `${pointer} = '_CLOUDFLARE_R2_SECRET_ACCESS_KEY_TENANT'`],
    ['a trailing underscore', `${pointer} = 'CLOUDFLARE_R2_SECRET_ACCESS_KEY_TENANT_'`],
    ['a segment that opens with a digit', `${pointer} = 'CLOUDFLARE_2R_SECRET_ACCESS_KEY_TENANT'`],
    ['a capitals passphrase with a digits-only segment', `${pointer} = '${PASSPHRASE277}'`],
    ['a capitals passphrase holding a short letter-and-digit token (U4-A): its value names no secret word', `${pointer} = '${PASSPHRASE277_R2}'`],
    ['a run of short tokens, no word in it', `${pointer} = 'AB1_CD2_EF3_KEY_IJ5_KL6_MN7_OP8'`],
    ['one word among short tokens, under three quarters in words', `${pointer} = 'AB1_CD2_EF3_TOKEN_IJ5_KL6'`],
    ['words and one five-character junk token (a short token is three at most)', `${pointer} = 'CLOUDFLARE_SECRET_ACCESS_L9K4W'`],
    ['the pointer word in the middle of the left name', 'SECRET' + `_ENV_KEY = '${ENV277}'`],
    ['the pointer word at the start of the left name', 'ENV' + `_SECRET = '${ENV277}'`],
    ['words that do not pronounce: vowels under a quarter, no long consonant run',`${pointer} = 'SPQOPGJIJBD_PMGIVPJAMRW_GSWUSRLEVMJ_R2_KEY'`],
    ['words that do not pronounce: plenty of vowels, but a run of four consonants', `${pointer} = 'XFZLOUOOLB_PZTTEOIOVH_GMSHIIEART_R2_KEY'`],
  ]) assert.deepStrictEqual(scanLine(line), G264, label);
});

// LWK-269. GitHub's stateless App installation tokens are `ghs_APPID_JWT`, about 520 characters (the vendor's changelogs of
// 2026-10-02 and 2026-05-15, its 2026-04-24 notice and its installation-token docs, read 2026-10-04). The `_` after the app id and
// the dots of the JWT fall outside the 36-255 character class, so no provider rule matched. Every fixture is synthetic: a made-up
// app id and a generated body in the JWT's alphabet, never an issued token.
const b64url = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const draw = (n, seed) => { // a deterministic pseudo-random body in the base64url alphabet
  let s = seed >>> 0; let out = '';
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; out += b64url[(s >>> 16) % 64]; }
  return out;
};
const jwtShape = (parts) => parts.join('.'); // header.payload.signature
const stateless = (body) => 'gh' + 's_' + '3141592' + '_' + body;
const STATELESS_RANDOM = stateless(jwtShape(['eyJ' + draw(33, 269), draw(300, 270), draw(167, 271)])); // 4 + 7 + 1 + 505 = 517
const STATELESS_FLAT = stateless(jwtShape(['eyJ' + 'A1b2'.repeat(8), 'A1b2'.repeat(75), 'A1b2'.repeat(41)])); // low entropy: the generic rule cannot save it

test('a stateless installation token is a github-token wherever it sits, and the legacy 40-character form still is', () => {
  assert.strictEqual(STATELESS_RANDOM.length, 517, 'the fixture is the size the queue row names');
  const legacy = 'gh' + 's_' + 'A1b2'.repeat(9);
  assert.deepStrictEqual(scanLine(`token = ${legacy}`), ['github-token'], 'legacy form, on a token line');
  for (const [label, token] of [['random body', STATELESS_RANDOM], ['low-entropy body', STATELESS_FLAT]]) {
    assert.deepStrictEqual(scanLine(`token = ${token}`), ['github-token'], `${label}, on a token line: one hit, named for the provider, not the generic rule`);
    assert.deepStrictEqual(scanLine(`x ${token} y`), ['github-token'], `${label}, bare in prose`);
    assert.deepStrictEqual(scanLine(`token = "${token}"`), ['github-token'], `${label}, quoted`);
    assert.deepStrictEqual(scanLine(`Authorization: Bearer ${token}`), ['github-token'], `${label}, in a header`);
  }
  const hits = scanText(`clean\nt = ${STATELESS_RANDOM}\n`, 'a/b.txt');
  assert.deepStrictEqual(hits.map((h) => `${h.line}:${h.pattern}`), ['2:github-token'], 'one hit, with its line');
  assert.ok(!JSON.stringify(hits).includes(STATELESS_RANDOM.slice(20, 60)), 'a hit never carries the value');
});

test('a ghs_ mention that is not a stateless token is not a hit', () => {
  for (const line of [
    'the installation token starts with ghs and an underscore, then the app id',
    'x ' + 'gh' + 's_' + '3141592' + '_ and nothing after it',
    'x ' + 'gh' + 's_' + '3141592' + '_' + 'short.body', // too short to be issued
    'x ' + 'gh' + 's_' + 'resolve_installation_token_for_the_current_application_run', // an identifier of about 60: past the legacy size, under the 100 floor
    'prefix_' + 'gh' + 's_' + '3141592' + '_' + draw(200, 273), // glued to a word character: not a key
  ]) assert.deepStrictEqual(scanLine(line).filter((n) => n === 'github-token'), [], line);
});

// U1-A. The vendor's pages never say what the segment after `ghs_` is: the shape is `ghs_APPID_JWT` and its own recommended pattern
// constrains no alphabet there. So the rule asks only for `ghs_`, a run of the JWT's alphabet and a floor well above the 40-character
// legacy form, never for digits. Each of these must fire wherever it sits: a bare line and a header line are where no generic rule applies.
test('a stateless installation token fires whatever its first segment is, digits or not, even absent', () => {
  const jwtBody = jwtShape(['eyJhbGciOiJFUzI1NiJ9', draw(300, 275), draw(167, 276)]); // a short header, so the legacy 36-255 class cannot catch it by luck
  const first = [
    ['a letters-and-digits segment', 'notanumber_'],
    ['a client-id-shaped segment', 'Iv23li' + draw(14, 277).replace(/[-_]/g, 'q') + '_'],
    ['a legacy client id with a dot', 'Iv1.' + '0123456789abcdef' + '_'],
    ['no segment at all (two underscores in a row)', '_'],
    ['no segment, the JWT straight after the prefix', ''],
  ];
  for (const [label, seg] of first) {
    const token = 'gh' + 's_' + seg + jwtBody;
    assert.deepStrictEqual(scanLine(`x ${token} y`), ['github-token'], `${label}, bare in prose`);
    assert.deepStrictEqual(scanLine(`Authorization: Bearer ${token}`), ['github-token'], `${label}, in a header`);
    assert.deepStrictEqual(scanLine(`token = "${token}"`), ['github-token'], `${label}, quoted`);
    assert.deepStrictEqual(scanLine(`token = ${token}`), ['github-token'], `${label}, on a token line`);
  }
});

// U1-C. The floor of the stateless alternative is held from below by the 58-character quiet fixture; this holds it from above. The
// vendor says only that a token is "about 520 characters" and varies with its data, and a JWT signed with ES256 and a small payload
// is about 120 characters after the prefix (its signature alone is 86). So a stateless token of that size must still fire: a later
// "tightening" of the floor to 200 or more would let it through on every bare and header line, with the suite otherwise green.
test('a short stateless installation token, about 120 characters after the prefix, still fires', () => {
  const body = jwtShape(['eyJhbGciOiJFUzI1NiJ9', draw(13, 278), draw(86, 279)]); // a short header, a tiny payload, an ES256-sized signature
  assert.strictEqual(body.length, 121, 'the fixture is just above the 100 floor');
  const token = 'gh' + 's_' + body;
  assert.deepStrictEqual(scanLine(`x ${token} y`), ['github-token'], 'bare in prose');
  assert.deepStrictEqual(scanLine(`Authorization: Bearer ${token}`), ['github-token'], 'in a header');
});

// S3. The rows above hold the floor from above (a token of 121 fires) and, loosely, from below (a 58-character identifier is quiet,
// which only rules out a floor of 58 or less). These two pin the floor to the design value of 100 in both directions: a body one
// character under it is NOT a token, and one of exactly 100 is. A floor of 59 to 99 now turns the first red, 101 to 121 the second.
// The bodies are dotted, so the 36-255 base62 alternative cannot catch them by luck.
test('a ghs_ body of 99 characters is not a hit, and one of exactly 100 is: the floor is pinned from both sides', () => {
  const header = 'eyJhbGciOiJFUzI1NiJ9';
  const under = jwtShape([header, draw(13, 280), draw(64, 281)]);
  const exact = jwtShape([header, draw(13, 282), draw(65, 283)]);
  assert.strictEqual(under.length, 99, 'one under the floor');
  assert.strictEqual(exact.length, 100, 'exactly the floor');
  for (const [label, line] of [['bare in prose', (t) => `x ${t} y`], ['in a header', (t) => `Authorization: Bearer ${t}`]]) {
    assert.deepStrictEqual(scanLine(line('gh' + 's_' + under)), [], `99 characters, ${label}`);
    assert.deepStrictEqual(scanLine(line('gh' + 's_' + exact)), ['github-token'], `100 characters, ${label}`);
  }
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
// scans run in a child with a hard kill. NO WALL-CLOCK ASSERTION (a slow or loaded runner would turn it red with no code change):
// two guards that do not depend on the host's speed replace it.
// THE DECLARED TRADE (N-1, routed by the Chotmeter reviewer). This test used to assert a ceiling in milliseconds per shape. That
// assert is gone on purpose, and a carrier's reviewer should read what replaced it as follows. MEASURED: the characters each regex
// call reads, as a growth ratio between N/2 and N, per shape (the work guard), and whether the scan finishes inside the child's kill
// timeout at all (the hang guard). NOT MEASURED: elapsed time of any one shape, so a slow-but-linear regression (a constant factor,
// even 10x) passes unless it nears the kill timeout; backtracking steps inside a single regex call, which the meter counts as
// the characters of that call's match; and any work that is not a regex call. Those last two reach only the hang guard.
//  - The hang guard: a scan of 200k characters that backtracks without bound never ends, so the child's kill timeout ends it and
//    `status === 0` fails. Linear scans take a fraction of a second, so the timeout is ~40x slack, and a quadratic scan of 200k
//    characters is minutes, far past it.
//  - The work guard: every RegExp.exec call is metered by the characters it had to read (a patched RegExp.prototype.exec sees test,
//    matchAll, replace and split too), and each shape is scanned at N/2 and at N characters; linear work at most about doubles. A scan
//    loop that restarts, or re-reads the rest of the line per match, grows about 4x and is caught here, without a clock. The meter
//    sees what each exec call reads, not backtracking inside one call; that is the hang guard's job. A control proves the meter itself
//    can see a re-read: a deliberate one, which must read about 4x, so a later "tidy" of the meter's miss charge cannot go unnoticed.
//  - What stays for the hang guard ALONE: a sticky attempt's own read (a failing sticky call is charged +1, whatever it read before
//    failing, because it cannot read past its own pattern's reach), and every piece of work that is not a regex call (string loops,
//    `indexOf`, slices). A native quadratic loop of that kind is invisible to the meter and is caught only by the kill timeout.
//    Do not "fix" a shape that reads quadratic without first asking whether the meter or the lib is wrong.
test('a 200k-character line dense with key-like names scans in linear work (no catastrophic backtracking)', () => {
  const LIB_URL = new URL('./lib/secret-scan.mjs', import.meta.url).href;
  const script = [
    `const m = await import(${JSON.stringify(LIB_URL)});`,
    'const exec = RegExp.prototype.exec;',
    'let work = 0;',
    // characters read by one call: from where it starts (lastIndex for a global or sticky regex, else 0) to the end of its match, or to
    // the end of the line when it finds none; +1 so that a call is never free. A STICKY call that fails is charged only the +1: it
    // reads from lastIndex until its pattern stops matching, not to the end of the line, so charging it the line would count a linear
    // scan as quadratic (the lib's code-value test runs once per judged value; B-1)
    'RegExp.prototype.exec = function (s) {',
    '  const str = String(s);',
    '  const from = this.global || this.sticky ? this.lastIndex : 0;',
    '  const r = exec.call(this, str);',
    '  work += Math.max(0, (r ? r.index + r[0].length : this.sticky ? from : str.length) - from) + 1;',
    '  return r;',
    '};',
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
    // the code-value guard: bare values that open like a call, one long run of identifier characters, many starts
    "  codeValueRuns: 'token=resolveStateFileForProfile(',",
    "  codeValueDots: 'token=self.state.profile.file.',",
    "  codeValueNested: 'token:token:token:token:',",
    "  codeValueOneRun: 'secret=' + 'resolveState'.repeat(20000) + '(',",
    // the most ordinary assignment line, repeated: many judged values, so the sticky code-value test runs once per value (B-1)
    // (written in two pieces, so that this file holds no secret-shaped assignment for the house scan to read)
    "  repeatedAssignment: 'tok' + 'en=abcdefghijklmnopqrstuvwx1 ',",
    // a reference opens each value (`$`), so each is skipped cheaply and the walk goes on inside it: many starts, one value run with no end
    "  referenceRuns: 'token=$',",
    // the stateless installation token: many starts of its prefix, and one run that never ends
    "  statelessStarts: 'gh' + 's_1_' + 'a.',",
    "  statelessOneRun: 'gh' + 's_1_' + 'a'.repeat(200000),",
    '};',
    'const out = {};',
    'for (const [k, unit] of Object.entries(shapes)) {',
    '  const at = (n) => { const s = unit.repeat(Math.ceil(n / unit.length)).slice(0, n); work = 0; m.scanLine(s); return work; };',
    '  out[k] = [at(N / 2), at(N)];',
    '}',
    // the meter's own control (U2-A): a deliberate re-read of the rest of the line by a global regex that never matches, which is
    // quadratic by construction; the meter must read it as about 4x (a meter that lets a global miss through cheaply reads 2x)
    'const reread = (n) => { const s = "a".repeat(n); const re = /b/g; work = 0; for (let i = 0; i < n; i += 50) { re.lastIndex = i; re.exec(s); } return work; };',
    'out.__reread = [reread(N / 2), reread(N)];',
    'console.log(JSON.stringify(out));',
  ].join('\n');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=512' },
  });
  assert.strictEqual(r.status, 0, `every scan must finish inside the kill timeout; status ${r.status}, signal ${r.signal}\n${r.stderr}`);
  const { __reread: reread, ...counts } = JSON.parse(r.stdout);
  assert.ok(reread[1] > 3 * reread[0], `the meter's own control: a deliberate re-read read ${reread[0]} characters at 100k and ${reread[1]} at 200k, which is not the ~4x growth of a quadratic read, so the meter cannot be trusted to see one`);
  for (const [shape, [half, full]] of Object.entries(counts)) {
    assert.ok(half > 0, `${shape}: the meter saw no regex call at 100k characters, so it measures nothing`);
    assert.ok(full <= 2.2 * half + 1000, `${shape}: ${half} characters read at 100k, but ${full} at 200k, more than linear growth`);
  }
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
// THE SANDBOX (LWK-278). The fixtures must not depend on the developer's own machine: every fixture repository lives in ONE sandbox of
// this test's own, and the developer's global git configuration (a hooks path, a signing rule, a template directory) never applies to
// a fixture call. The `GIT_*` filter below closes the inherited-environment half (LWK-258); the sandbox closes the configuration half.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-scan-sandbox-'));
const EMPTY_GLOBAL = path.join(SANDBOX, 'empty-global-gitconfig');
fs.writeFileSync(EMPTY_GLOBAL, '');
after(() => {
  assert.ok(path.resolve(SANDBOX).startsWith(path.resolve(os.tmpdir())) && path.basename(SANDBOX).startsWith('secret-scan-sandbox-'), 'refusing to delete outside the temp dir');
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
// A git hook runs with GIT_DIR, GIT_INDEX_FILE and friends set; a fixture that inherited them would act on the repository the
// hook runs for. Every fixture git call gets an environment without them, read at call time so a test can plant them, and with the
// sandbox in place of the box: TEMP, TMP, TMPDIR, HOME, USERPROFILE and XDG_CONFIG_HOME point at it, the global git config is an
// empty file of the sandbox, and the system config is off.
const gitEnv = () => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k))),
  TEMP: SANDBOX, TMP: SANDBOX, TMPDIR: SANDBOX, HOME: SANDBOX, USERPROFILE: SANDBOX, XDG_CONFIG_HOME: SANDBOX,
  GIT_CONFIG_GLOBAL: EMPTY_GLOBAL, GIT_CONFIG_NOSYSTEM: '1',
});
const gitAt = (cwd) => (args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv() });
function inTemp(fn) {
  const root = fs.mkdtempSync(path.join(SANDBOX, 'secret-scan-test-'));
  try { return fn(root); } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(SANDBOX) + path.sep) && path.basename(root).startsWith('secret-scan-test-'),
      'refusing to delete outside the sandbox');
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

// LWK-258. A git hook runs with GIT_DIR, GIT_INDEX_FILE and friends set, and node inherits them. A fixture git call that
// inherited them would act on the repository the hook runs for, not on the throwaway one: this suite would read (and, for
// init/add/commit, WRITE) the wrong repository. The plant below is process-wide for the length of this one synchronous test.
test('a GIT_DIR and GIT_INDEX_FILE a hook inherited are dropped: every fixture git call acts on its own repository', () => {
  inTemp((root) => {
    const decoy = repoIn(root, 'decoy');
    const planted = { GIT_DIR: path.join(decoy, '.git'), GIT_INDEX_FILE: path.join(decoy, '.git', 'index') };
    const saved = Object.fromEntries(Object.keys(planted).map((k) => [k, process.env[k]]));
    Object.assign(process.env, planted);
    let own;
    try {
      const d = repoIn(root, 'own');
      own = commitIn(d, { 'a.txt': 'hello\n' }, 'in the fixture');
      assert.strictEqual(path.resolve(gitAt(d)(['rev-parse', '--show-toplevel']).trim()), path.resolve(d), 'the fixture call must resolve the fixture repository');
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
    assert.match(own, /^[0-9a-f]{40}$/, 'the commit must land in the fixture repository');
    const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
    const decoyHead = spawnSync('git', ['-C', decoy, 'rev-parse', '--verify', '-q', 'HEAD'], { encoding: 'utf8', timeout: 30000, env: cleanEnv });
    assert.notStrictEqual(decoyHead.status, 0, 'the decoy repository must stay empty: a commit in it means a fixture call followed GIT_DIR');
  });
});

// LWK-278. The witness for the sandbox: it plants a hostile global git configuration (an executable hooks path whose pre-commit hook
// exits 1) and a hostile HOME in the test process itself, then builds a fixture. Without the sandbox the fixture commit fails with the
// hostile hook's exit 1, the fixture folder is outside the sandbox, and the child environment holds the box's own HOME. The system
// configuration cannot be planted from a test, so GIT_CONFIG_NOSYSTEM is asserted on the environment the fixture calls receive.
// The plant is process-wide for the length of this one synchronous test and restored in a `finally`.
test('the fixtures run in the test\'s own sandbox: a hostile global git config and HOME never reach them, and the fixture folders live inside it', () => {
  const hostile = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-scan-hostile-'));
  try {
    const hooks = path.join(hostile, 'hooks');
    fs.mkdirSync(hooks);
    fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho hostile global hook >&2\nexit 1\n', { mode: 0o755 });
    const hostileConfig = '[core]\n\thooksPath = ' + hooks.replace(/\\/g, '/') + '\n';
    fs.writeFileSync(path.join(hostile, '.gitconfig'), hostileConfig); // the per-user file (HOME)
    fs.mkdirSync(path.join(hostile, 'git'));
    fs.writeFileSync(path.join(hostile, 'git', 'config'), hostileConfig); // the XDG file, which HOME alone does not cover
    const planted = { HOME: hostile, USERPROFILE: hostile, XDG_CONFIG_HOME: hostile, GIT_CONFIG_GLOBAL: path.join(hostile, '.gitconfig') };
    const saved = Object.fromEntries(Object.keys(planted).map((k) => [k, process.env[k]]));
    Object.assign(process.env, planted);
    try {
      inTemp((root) => {
        assert.ok(path.resolve(root).startsWith(path.resolve(SANDBOX) + path.sep), `the fixture folder is inside the sandbox: ${root}`);
        const d = repoIn(root, 'own');
        const sha = commitIn(d, { 'a.txt': 'hello\n' }, 'under a hostile global config'); // a commit under the hostile global hook would fail with exit 1
        assert.match(sha, /^[0-9a-f]{40}$/);
        const seen = spawnSync('git', ['-C', d, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8', timeout: 30000, env: gitEnv() });
        assert.strictEqual(seen.status, 1, `git finds no hooks path (exit 1): ${seen.stdout}`);
        const env = gitEnv();
        assert.deepStrictEqual([env.TEMP, env.TMP, env.TMPDIR, env.HOME, env.USERPROFILE, env.XDG_CONFIG_HOME], Array(6).fill(SANDBOX), 'the fixture calls see the sandbox, not the box');
        assert.strictEqual(env.GIT_CONFIG_GLOBAL, EMPTY_GLOBAL);
        assert.strictEqual(fs.readFileSync(EMPTY_GLOBAL, 'utf8'), '', 'the global config is an empty file of the sandbox');
        assert.strictEqual(env.GIT_CONFIG_NOSYSTEM, '1', 'the system configuration is off');
      });
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  } finally {
    assert.ok(path.resolve(hostile).startsWith(path.resolve(os.tmpdir())) && path.basename(hostile).startsWith('secret-scan-hostile-'), 'refusing to delete outside the temp dir');
    fs.rmSync(hostile, { recursive: true, force: true });
  }
});

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
      cwd: d, input: `aws = ${SAMPLES['aws-access-key-id']}\n`, encoding: 'utf8', timeout: 30000, env: gitEnv(),
    }).trim();
    run(d, ['tag', '-a', 'blobtag', blob, '-m', 'plain note']);
    const annotated = run(d, ['rev-parse', 'blobtag']).trim();
    const tree = execFileSync('git', ['mktree'], {
      cwd: d, input: `100644 blob ${blob}\tsecret.env\n`, encoding: 'utf8', timeout: 30000, env: gitEnv(),
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
