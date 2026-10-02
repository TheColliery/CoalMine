// secret-scan.mjs — a zero-dependency secret scanner for a git gate.
//
// PORTABLE BY CONTRACT: node builtins only, no repository path, name or constant. A sibling
// repo copies this file byte-for-byte; everything repo-specific (which files, how a hit is
// reported, what the gate's summary says) belongs to the CALLER. Git is reached only through a
// `git(args) -> stdout` function the caller injects, so this module never spawns anything itself.
//
// WHY IT EXISTS: a PRIVATE repository on GitHub's Free plan gets neither server-side secret
// scanning nor push protection, so the repository's own pre-push gate is the only wall.
//
// WHAT IT NEVER DOES: return a matched value. A hit carries the location, the pattern NAME and a
// truncated one-way fingerprint (see fingerprint() below), and nothing else, so no caller can
// leak a value by accident. Locations come from files the caller may not have authored: the
// CALLER escapes them before printing.
//
// WHAT IT REFUSES: a pushed ref whose object is not a commit (a blob, a tree, or a tag that peels
// to one) is refused by name, never scanned, because a range scan would pass it unread.
// scanPushed() throws code 'ENONCOMMIT' naming every such ref, so a caller that does not know the
// code still fails.
//
// A pushed tag that points at another tag is followed down the chain and every tag message on it is
// scanned. A chain longer than MAX_TAG_DEPTH tag objects, a tag object met twice, or a tag object
// whose headers cannot be read throws code 'ETAGCHAIN', so a caller that does not know the code
// still fails: a message that was not read is not a message that was clean.
//
// LIMITS, stated: a line scanner cannot see a key split across lines, a credential inside a URL
// (scheme://user:pass@host), a key in a file NAME (names are escaped for printing, never scanned),
// a provider key glued to a following word character, or a value whose body is hex-only or
// single-case (the generic rule excludes hex; the `sk-` pattern requires mixed case). For the
// generic rule only, two residues (THREE STEPS, below): a key inside a secret-named value is
// reported only if the whole value passes the content test; and a secret name glued onto the end
// of the preceding value, with no whitespace, quote, `,` `;` `)` or `&` between, is read as part
// of that value, so the key after it is missed. Against the previous single-regex version, fewer
// glued keys are missed overall, but some it found are now missed: this walk reaches the class
// from more places. A provider-shaped key is found anywhere on the line.
//
// ⚠️ NO SECRET-SHAPED LITERAL APPEARS IN THIS FILE. Every pattern is assembled from fragments at
// load time, so a gate that scans its own tree scans this file and passes because nothing here
// matches, never because this file is skipped.

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

// ------------------------------------------------------------------ PATTERNS
// Provider prefixes covered by GitHub's own secret-scanning detectors. Each regex requires the
// prefix AND the body length/charset the provider issues, so a prose mention of a prefix
// ("keys start with the AWS access-key prefix") is not a hit. `check`, where present, is a
// second test on the matched text for a prefix too common in ordinary words.
const b = String.raw;
const DASH5 = '-'.repeat(5);
const hasMix = (s) => /[0-9]/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s);

// Where a provider key may START: after a non-word character or at the start of the line, and
// also right after a literal backslash-n/r/t (inside a JSON or C string, where the escape's
// letter is a word character) or a %XX escape (a URL-encoded value). A key glued to an ordinary
// word character is still not a key.
const L = b`(?:(?<![A-Za-z0-9_])|(?<=\\[nrt])|(?<=%[0-9A-Fa-f]{2}))`;

export const PATTERNS = Object.freeze([
  { name: 'aws-access-key-id', re: new RegExp(L + b`(?:AK` + b`IA|AS` + b`IA)[0-9A-Z]{16}\b`) },
  { name: 'github-token', re: new RegExp(L + b`gh[pousr]` + b`_[A-Za-z0-9]{36,255}\b`) },
  { name: 'github-fine-grained-pat', re: new RegExp(L + b`github` + b`_pat_[A-Za-z0-9_]{50,255}\b`) },
  { name: 'gitlab-pat', re: new RegExp(L + b`gl` + b`pat-[A-Za-z0-9_-]{20,}`) },
  { name: 'sendgrid-api-key', re: new RegExp(L + b`S` + b`G\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b`) },
  { name: 'square-access-token', re: new RegExp(L + b`sq0` + b`atp-[A-Za-z0-9_-]{22,}`) },
  { name: 'square-oauth-secret', re: new RegExp(L + b`sq0` + b`csp-[A-Za-z0-9_-]{43,}`) },
  { name: 'anthropic-api-key', re: new RegExp(L + b`sk` + b`-ant-[A-Za-z0-9_-]{32,}`) },
  // `sk-` opens ordinary hyphenated words, so the body must look issued: long, and mixing
  // digits with both letter cases. A 32-char random base62 body lacks one class ~5% of the time;
  // that miss is the price of not flagging every long hyphenated identifier.
  { name: 'openai-style-api-key', re: new RegExp(L + b`sk` + b`-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}`), check: hasMix },
  { name: 'slack-token', re: new RegExp(L + b`xo` + b`x[abprs]-[A-Za-z0-9-]{10,}`) },
  { name: 'stripe-live-key', re: new RegExp(L + b`(?:sk|rk)` + b`_live_[A-Za-z0-9]{24,}\b`) },
  { name: 'google-api-key', re: new RegExp(L + b`AI` + b`za[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])`) },
  { name: 'private-key-pem', re: new RegExp(DASH5 + b`BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?` + DASH5) },
]);

// ------------------------------------------------------------ GENERIC ENTROPY
// A value assigned to a key-like NAME, scored by Shannon entropy per character.
//
// THE THRESHOLD, and why it cannot fire on a hash: 3.5 bits/char, with four more gates:
//   - length >= 20;
//   - at least one digit AND one letter (a 20+ char random base62 value lacks a digit ~3% of
//     the time; a word-like config value almost always does);
//   - NOT hex-only (dashes allowed): a sha256 pin, a git SHA or a UUID lives in a 16-symbol
//     alphabet, and the maximum entropy of a hex string is log2(16) = 4.0 bits/char, so the
//     hex exclusion removes them STRUCTURALLY rather than by a threshold that happens to sit
//     above them;
//   - NOT a reference: a value opening with `$`, `<`, `%`, `{` or `[` names a secret, it is not one.
// 3.5 sits below random base62/base64 of length 20-40 (typically ~4.0-5.0) and above repetitive
// or word-like values. It was calibrated against every added line in the first host repo's
// history (the caller's return records the count); raise it only against such a measurement.
export const ENTROPY_THRESHOLD = 3.5;
export const ENTROPY_MIN_LENGTH = 20;
const NAME = String.raw`(?:secret|token|passw(?:or)?d|passwd|pwd|credential|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?key|(?:^|[_.-])key)`;
// A value ends at whitespace, a quote, `,` `;` `)` or `&`. The `&` matters: in a query string
// (`token=...&api_key=...`) a value that ran on would swallow the next assignment.
//
// THREE STEPS, SO THE COST STAYS LINEAR WITHOUT A LENGTH BOUND, AND NO VALUE HIDES A SECRET.
// 1. NAME_OP matches a name and its operator, never the value. The name is a WHOLE run of name
//    characters: the lookbehind lets a run start only where the previous character is not a name
//    character, so each run is tried once, and the greedy run can give back only characters that
//    cannot open an operator. The operator is `:=` (Go), `=>` (PHP, Ruby), `:` or `=`.
// 2. namesSecret() decides whether that run names a secret, anywhere inside it. A NON-secret name
//    consumes nothing past its operator, so the walk goes on INSIDE its value: `$env:API_KEY = …`,
//    `url: https://h/p?api_key=…` and `opts: token=…` each reach the secret assignment behind them.
// 3. Only for a secret name is the value read. A value skipped cheaply, as a `${...}`-style
//    reference or as too short, is walked again from its first character, so a real key behind it
//    is still found. A value judged on its CONTENT (digits and letters, not hex-only, entropy) is
//    consumed, hit or not, because each such judgment costs the value's length and must happen
//    once per character for the whole line to stay linear. The residues: a key inside a
//    secret-named value that fails on content is reported only if the whole value passes; and a
//    secret name glued onto the end of the preceding value, with no whitespace, quote, `,` `;`
//    `)` or `&` between, is read as part of that value, so the key after it is missed. Against
//    the previous single-regex version, fewer glued keys are missed overall, but some it found
//    are now missed, because this walk reaches the class from more places.
// A single regex with NAME between two name-character runs backtracks through both runs at every
// start position (cubic time, a hung push); bounding the runs stopped that but missed a key token
// deep in a long snake_case name, the commonest env-var shape.
const NAME_OP = new RegExp(String.raw`(?<![A-Za-z0-9_.-])([A-Za-z0-9_.-]+)["']?\s*(?::=|=>|[:=])\s*["'\x60]?`, 'g');
const VALUE_END = new RegExp(String.raw`[\s"'\x60,;)&]`, 'g');
// NAME's bare `key` alternative matches only at the start of a run that opens the line, as it
// always has: `key = ...` at the top of a file is a key, `map(key => value)` is not.
const NAME_RE = new RegExp(NAME, 'i');
const namesSecret = (name, runStart) => NAME_RE.test(runStart === 0 ? name : ` ${name}`);

export function shannon(s) {
  const n = s.length;
  if (!n) return 0;
  const counts = new Map();
  for (const c of s) counts.set(c, (counts.get(c) || 0) + 1);
  let h = 0;
  for (const k of counts.values()) { const p = k / n; h -= p * Math.log2(p); }
  return h;
}

// Every qualifying value on the line, with its [start, end) span.
// See THREE STEPS above for what is consumed and what is walked again.
function genericValues(line) {
  const out = [];
  const nameOp = new RegExp(NAME_OP); // own lastIndex per call
  const valueEnd = new RegExp(VALUE_END);
  // The end of the value run that holds `start`. Value starts only move forward, and a run holds
  // no end character, so one cached end serves every start inside it: each character is read once.
  let runEnd = -1;
  const endOf = (start) => {
    if (start >= runEnd) {
      valueEnd.lastIndex = start;
      const d = valueEnd.exec(line);
      runEnd = d ? d.index : line.length;
    }
    return runEnd;
  };
  for (let m = nameOp.exec(line); m; m = nameOp.exec(line)) {
    if (!namesSecret(m[1], m.index)) continue; // walk on inside its value
    const start = nameOp.lastIndex;
    const end = endOf(start);
    if (end - start < ENTROPY_MIN_LENGTH || /^[$<%{[]/.test(line[start])) continue; // cheap skip: walk on inside it
    nameOp.lastIndex = end; // judged on content from here: consumed, hit or not
    const v = line.slice(start, end);
    if (!/[0-9]/.test(v) || !/[A-Za-z]/.test(v)) continue;
    if (/^[0-9a-f-]+$/i.test(v)) continue;
    if (shannon(v) < ENTROPY_THRESHOLD) continue;
    out.push({ value: v, start, end });
  }
  return out;
}

// ---------------------------------------------------------------- SCANNING
// Global copies of the patterns, so a line is searched for EVERY match, not only the first.
const GLOBAL = PATTERNS.map((p) => ({ ...p, re: new RegExp(p.re.source, `${p.re.flags}g`) }));

// PRIVATE: the only place a matched value exists. It never leaves this module; callers get a
// pattern name and a fingerprint.
//
// ONE MATCH NEVER HIDES ANOTHER. Every match of every pattern is its own hit, with its own
// fingerprint, and a `check` is applied to each match separately — so a decoy that fails the
// check cannot hide a real value after it, and acknowledging one value cannot silence a
// different value on the same line. The generic rule runs on every line too; it skips only a
// value that overlaps a pattern match, which is the same text already reported once.
function matchLine(line) {
  const found = [];
  const spans = [];
  for (const p of GLOBAL) {
    for (const m of line.matchAll(p.re)) {
      if (p.check && !p.check(m[0])) continue;
      found.push({ pattern: p.name, value: m[0] });
      spans.push([m.index, m.index + m[0].length]);
    }
  }
  for (const g of genericValues(line)) {
    if (spans.some(([s, e]) => g.start < e && s < g.end)) continue;
    found.push({ pattern: 'generic-high-entropy-assignment', value: g.value });
  }
  return found;
}

// A fingerprint names ONE value in ONE file, so a caller can acknowledge a known, non-secret
// match (a third party's public client key in a captured page) without a path-wide exemption.
// 64 bits of sha256 over file, pattern and value. Every pattern above requires a long
// high-entropy body, so the fingerprint cannot be walked back to the value.
export function fingerprint(file, pattern, value) {
  return createHash('sha256').update(`${file}\0${pattern}\0${value}`).digest('hex').slice(0, 16);
}

// The pattern NAMES that hit one line. Never the matched text.
export function scanLine(line) {
  return matchLine(line).map((h) => h.pattern);
}

// Scan a whole text. hits: [{ line, pattern, fp }]
export function scanText(text, file = '') {
  const hits = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const h of matchLine(lines[i])) hits.push({ line: i + 1, pattern: h.pattern, fp: fingerprint(file, h.pattern, h.value) });
  }
  return hits;
}

// Unquote a C-style quoted path from a diff header. git quotes a name holding special bytes and
// escapes them as backslash-a/b/t/n/v/f/r, backslash-quote, backslash-backslash, or three octal
// digits per BYTE (so one non-ASCII character can be several octal escapes). The result is
// rebuilt as bytes and decoded once as UTF-8, so it equals the name a tree scan sees. Anything that
// is not git's quoting comes back raw: the fingerprint then matches no ack, which is the safe side.
const BACKSLASH = String.fromCharCode(92);
const C_ESCAPES = new Map([['a', 7], ['b', 8], ['t', 9], ['n', 10], ['v', 11], ['f', 12], ['r', 13], ['"', 34], [BACKSLASH, 92]]);
function unquotePath(p) {
  if (!(p.length >= 2 && p.startsWith('"') && p.endsWith('"'))) return p;
  const s = p.slice(1, -1);
  const bytes = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === BACKSLASH) {
      const oct = /^[0-7]{3}/.exec(s.slice(i + 1, i + 4));
      if (oct) {
        const v = parseInt(oct[0], 8);
        if (v > 255) return p;
        bytes.push(v); i += 4; continue;
      }
      const e = C_ESCAPES.get(s[i + 1]);
      if (e === undefined) return p;
      bytes.push(e); i += 2; continue;
    }
    const ch = String.fromCodePoint(s.codePointAt(i));
    for (const x of Buffer.from(ch, 'utf8')) bytes.push(x);
    i += ch.length;
  }
  return Buffer.from(bytes).toString('utf8');
}

// Scan the ADDED lines of a `git log -p --unified=0` patch stream whose commits are introduced by
// a line `\0COMMIT <sha>` (the caller's --format). hits: [{ commit, file, line, pattern, fp }]
// opts.skipFile(path) -> true skips that file's added lines: the ONLY way a path escapes the scan,
// and the caller's explicit choice (e.g. a path it knows is a genuine binary).
export function scanPatch(patch, opts = {}) {
  const skip = typeof opts.skipFile === 'function' ? opts.skipFile : null;
  const hits = [];
  // inHeader: a `+++ ` line is a file header only between `diff --git` and the first `@@`. Inside
  // a hunk, an ADDED line whose content starts with "++ " reads as `+++ ` too, and must be scanned.
  let commit = '', file = null, lineNo = 0, inHeader = false;
  for (const raw of String(patch).split('\n')) {
    const l = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (l.startsWith('\0COMMIT ')) { commit = l.slice(8).trim(); file = null; inHeader = false; continue; }
    if (l.startsWith('diff --git ') || l.startsWith('diff --cc ')) { file = null; inHeader = true; continue; }
    if (inHeader && l.startsWith('+++ ')) {
      const p = l.slice(4);
      file = p === '/dev/null' ? null : unquotePath(p).replace(/^b\//, '');
      if (file !== null && skip && skip(file)) file = null;
      continue;
    }
    if (l.startsWith('@@') && (inHeader || file !== null)) {
      const m = /^@@@? -\d+(?:,\d+)? (?:-\d+(?:,\d+)? )?\+(\d+)(?:,\d+)? @@/.exec(l);
      if (m) { lineNo = Number(m[1]); inHeader = false; continue; }
    }
    if (inHeader) continue;
    if (l.startsWith('+') && file !== null) {
      for (const h of matchLine(l.slice(1))) hits.push({ commit, file, line: lineNo, pattern: h.pattern, fp: fingerprint(file, h.pattern, h.value) });
      lineNo++;
    }
  }
  return hits;
}

// ------------------------------------------------------------ PUSHED RANGE
const ZERO = /^0+$/;
const SHA = /^[0-9a-f]{40,64}$/i;

// Parse pre-push stdin: "<local ref> <local sha> <remote ref> <remote sha>" per line.
// Throws on a malformed line: a range that cannot be read must fail the gate, never pass it.
export function parsePushRefs(stdinText) {
  const refs = [];
  for (const l of String(stdinText).split(/\r?\n/)) {
    if (!l.trim()) continue;
    const f = l.trim().split(/\s+/);
    if (f.length !== 4 || !SHA.test(f[1]) || !SHA.test(f[3])) throw new Error('malformed pre-push ref line');
    refs.push({ localRef: f[0], localSha: f[1], remoteRef: f[2], remoteSha: f[3] });
  }
  return refs;
}

// The rev-list arguments for one pushed ref, or null for a deletion (nothing is pushed).
// A brand-new remote branch (remote sha all zeros), or a remote sha this clone does not hold,
// scans every commit not already on a remote-tracking ref: the PUSH remote's own tracking refs
// when the caller names it, every remote's when it cannot (a push to a bare URL has no name).
// A commit held only by some OTHER remote is not on the push remote, so naming it matters.
export function rangeArgs(ref, hasCommit, remote = null) {
  if (ZERO.test(ref.localSha)) return null;
  if (ZERO.test(ref.remoteSha) || !hasCommit(ref.remoteSha)) return [ref.localSha, '--not', remote ? `--remotes=${remote}` : '--remotes'];
  return [`${ref.remoteSha}..${ref.localSha}`];
}

// A remote name reaches rev-list as a glob pattern, so it must hold no glob or whitespace
// character, and cannot open with `-`. git's own refname rules already forbid all of these.
function checkRemote(r) {
  if (typeof r !== 'string' || !/^[^\s*?[\-][^\s*?[]*$/.test(r) || r.includes(BACKSLASH)) throw new TypeError('invalid remote name');
  return r;
}

// Messages carry keys too (`git commit -m "... <token>"`). Their hits have no file; the label
// below stands in for one in the fingerprint and holds a NUL, which no path can, so a message
// acknowledgment can never match a file of the same name.
const NUL = String.fromCharCode(0);
const MESSAGE_LABEL = { message: `${NUL}commit-message`, tag: `${NUL}tag-message` };

// An annotated tag may point at ANOTHER tag, and the chain still peels to a commit, so the
// non-commit guard passes it. Every tag object on the chain is read, outer first, so no tag message
// goes unscanned. The walk is bounded: at most MAX_TAG_DEPTH tag objects. Real chains are one or
// two deep, so 16 is far past any use and still a handful of git calls. A longer chain, a tag
// object met twice (git's content hashing cannot make one, so this is a guard, not an expected
// path) and a tag object whose headers cannot be read all throw code 'ETAGCHAIN': a message that
// was not read is not a message that was clean, and the caller must turn the error into a failure.
export const MAX_TAG_DEPTH = 16;
function tagChain(sha, git) {
  const chain = [];
  const seen = new Set();
  for (let cur = sha; ; ) {
    if (seen.has(cur) || chain.length >= MAX_TAG_DEPTH) {
      const e = new Error('a pushed tag chain is too deep or repeats, so it was not fully read');
      e.code = 'ETAGCHAIN';
      throw e;
    }
    seen.add(cur);
    const text = git(['cat-file', 'tag', cur]);
    chain.push({ sha: cur, text });
    const head = text.split(/\r?\n\r?\n/, 1)[0];
    const obj = /^object ([0-9a-f]{40,64})$/m.exec(head);
    const type = /^type (\S+)$/m.exec(head);
    if (!obj || !type) {
      const e = new Error('a pushed tag object has no readable object and type headers');
      e.code = 'ETAGCHAIN';
      throw e;
    }
    if (type[1] !== 'tag') return chain;
    cur = obj[1];
  }
}

// Scan everything being pushed. git(args) -> stdout is injected by the caller and must THROW when
// git fails. opts: { remote, skipFile } (see rangeArgs and scanPatch).
//
// Per commit: the ADDED lines of its diff, with --text so a file git would call binary (a NUL
// byte, a -diff attribute) is still read; and its full message (%B), fetched separately so a
// message can never confuse the patch parser. Per pushed annotated tag: every tag message on its
// chain, outer first (a tag may point at another tag; see tagChain).
//
// Returns { refs, commits, tags, hits }. `tags` counts the tag objects read, per pushed ref, so a
// tag object shared by two pushed chains is counted once for each. EVERY hit names the pushed ref
// it was found under (refSha = that ref's local sha), and a commit reached by two refs yields its
// hits once per ref: the caller decides acknowledgments PER REF, from what that ref itself carries.
// kind is 'diff', 'message' or 'tag'; file is null for the last two. Every error propagates: the
// caller turns it into a FAIL, because a scan that could not run has not passed. A pushed ref that
// is not a commit throws code 'ENONCOMMIT' with refs: [{ ref, sha, type }], so a caller that knows
// the code can name each ref, and one that does not still fails.
export function scanPushed(stdinText, git, opts = {}) {
  const refs = parsePushRefs(stdinText);
  const remote = opts.remote === undefined || opts.remote === null || opts.remote === '' ? null : checkRemote(opts.remote);
  const hasCommit = (sha) => { try { git(['cat-file', '-e', `${sha}^{commit}`]); return true; } catch { return false; } };
  // FAIL CLOSED on a pushed object that is not a commit. `rev-list` returns NOTHING, with no error,
  // for a blob, a tree, or a tag of either, so a range scan would pass it unread
  // (`git tag x $(git hash-object -w secrets.env)` then a push). Every such ref is named in one
  // error; the caller must turn it into a failure. A branch, and a tag of a commit, peel to a
  // commit and pass through unchanged.
  const notCommits = [];
  for (const ref of refs) {
    if (ZERO.test(ref.localSha)) continue;
    const type = git(['cat-file', '-t', `${ref.localSha}^{}`]).trim();
    if (type !== 'commit') notCommits.push({ ref: ref.localRef, sha: ref.localSha, type });
  }
  if (notCommits.length) {
    const e = new Error('a pushed ref is not a commit');
    e.code = 'ENONCOMMIT';
    e.refs = notCommits;
    throw e;
  }
  const ranges = [];
  const shas = new Set();
  for (const ref of refs) {
    const args = rangeArgs(ref, hasCommit, remote);
    if (!args) continue;
    const list = git(['rev-list', ...args]).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const s of list) shas.add(s);
    ranges.push({ ref, list });
  }
  const bySha = new Map();
  for (const sha of shas) {
    const patch = git(['-c', 'core.quotepath=off', 'show', '--format=%x00COMMIT %H', '--unified=0', '--text',
      '--no-color', '--no-ext-diff', '--no-textconv', '--diff-merges=first-parent', sha]);
    const found = scanPatch(patch, opts).map((h) => ({ ...h, kind: 'diff' }));
    for (const h of scanText(git(['show', '-s', '--format=%B', sha]), MESSAGE_LABEL.message)) {
      found.push({ commit: sha, file: null, line: h.line, pattern: h.pattern, fp: h.fp, kind: 'message' });
    }
    bySha.set(sha, found);
  }
  const hits = [];
  let tags = 0;
  for (const { ref, list } of ranges) {
    for (const sha of list) for (const h of bySha.get(sha)) hits.push({ refSha: ref.localSha, ...h });
    if (ref.remoteSha !== ref.localSha && git(['cat-file', '-t', ref.localSha]).trim() === 'tag') {
      for (const t of tagChain(ref.localSha, git)) {
        tags++;
        for (const h of scanText(t.text, MESSAGE_LABEL.tag)) {
          hits.push({ refSha: ref.localSha, commit: t.sha, file: null, line: h.line, pattern: h.pattern, fp: h.fp, kind: 'tag' });
        }
      }
    }
  }
  return { refs: refs.length, commits: shas.size, tags, hits };
}
