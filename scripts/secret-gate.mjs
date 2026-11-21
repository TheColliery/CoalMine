#!/usr/bin/env node
// secret-gate — the secret scan a repository runs before a commit and before a push.
//
// WHY: GitHub scans a public repository for PROVIDER tokens. This gate is the repository's own check: it runs the
// portable scanner (scripts/lib/secret-scan.mjs, kept byte-identical in every repository that carries it) before a
// commit and before a push. The scanner catches a provider-shaped token anywhere on a line (a URL or an HTTP header included), a
// private-key header and a high-entropy value assigned to a name like secret, token, password or key. It does NOT catch a credential
// inside a URL or connection string (scheme://user:pass@host) unless the credential is provider-shaped, an HTTP authentication header
// whose value is a scheme and a token (Authorization: Bearer <key>, X-Api-Token: Bearer <key>) unless that token is provider-shaped,
// or a key split across lines.
//
// TWO SCANS. (1) The STAGED tree, always: every blob in the index except a binary one (a blob whose every staged path has a binary-looking name AND whose bytes are binary is skipped, below, unless the scanner's wide-text rule reads it as UTF-16 or UTF-32: then it is decoded and scanned; or unless the scanner's search for a provider key in a wide spelling finds one: then it is read again and scanned whole, 21i), which is what a commit records and what a CI checkout
// holds (a staged edit is scanned even when the working file was changed back; an unstaged edit cannot be committed or
// pushed and is not reported). A commit made with "git commit -a" or a partial commit reads the index that commit uses
// (GIT_INDEX_FILE), one of the two GIT_* variables the gate keeps. (2) With --pre-push (the hook passes it,
// with git's ref lines on stdin): the ADDED lines of every commit being pushed, so a key added and then deleted inside the
// range is still found, plus every pushed commit message and annotated-tag message. --remote=<name> narrows a new branch
// to the commits that remote does not already have.
//
// A SCAN THAT CANNOT RUN FAILS: a scanner that will not load, a tracked file that cannot be read, stdin that is a
// terminal, a range git cannot list, a staged blob git cannot read. Never a pass, never a note (a git pre-* hook must be
// able to abort the operation).
//
// ACKNOWLEDGMENT, the one escape hatch: a known NON-secret match is silenced by its 16-hex fingerprint on its own line in
// secret-scan.acks, read from a COMMITTED tree only (HEAD's for the tree scan, the pushed ref's tip for a pushed hit), so an
// ack only works if it travels in the push, where a reviewer sees it. A hit never prints its value.
//
// Usage:   node scripts/secret-gate.mjs [--pre-push [--remote=<name>]]
//          node scripts/secret-gate.mjs --rename-odd=<path as hex>:<blob> --to=<new name>   (the rename a refusal prints, 21j)
// Example: node scripts/secret-gate.mjs
// Exit:    0 clean · 1 a hit, or a scan that could not run · 64 usage error
// Report a problem: TheColliery/.github issues. Zero dependencies: node builtins only.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';

const USAGE = 'usage: node scripts/secret-gate.mjs [--pre-push [--remote=<name>]] | --rename-odd=<hex>:<blob> --to=<new name> | --drop-twin=<drop hex>:<keep hex>:<blob> | -h\n'
  + '  scans the staged files (the index); with --pre-push also every commit being pushed (git\'s ref lines on stdin)\n'
  + '  --rename-odd renames, in the index only, the one staged path that is not valid UTF-8 named by its bytes as hex and its blob (a refusal prints it)\n'
  + '  a rename stopped after its add (a kill prints nothing) leaves both names staged on one blob: run it again, and its refusal prints\n'
  + '  the --drop-twin=<drop hex>:<keep hex>:<blob> commands that finish it or undo it (each names the entry it removes and the one that must remain)\n'
  + '  example: node scripts/secret-gate.mjs\n'
  + '  exit 0 clean · 1 a hit or a scan that could not run · 64 usage error';
const ACKS = 'secret-scan.acks';
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|7z|woff2?|ttf|otf|eot|mp[34]|mov|xlsx?|docx?|pptx?|gguf|safetensors|bin)$/i;
const BACKSLASH = String.fromCharCode(92);

const args = process.argv.slice(2);
const known = (a) => a === '--pre-push' || a.startsWith('--remote=') || a.startsWith('--rename-odd=') || a.startsWith('--to=') || a.startsWith('--drop-twin=');

// JSON.stringify neutralises CR, LF, controls, quotes and backslashes; every other character that can forge a line or hide
// text in a terminal is escaped BY CATEGORY (Cc, Cf, Zl, Zp), never by a list (CWE-117, log injection).
const unit4 = (c) => `${BACKSLASH}u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
const esc = (s) => JSON.stringify(String(s)).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => c.split('').map(unit4).join(''));
// A path whose bytes are not UTF-8, printed (21a, 21c): every printed form of it is built BYTE BY BYTE by one helper whose output is printable ASCII only, so no byte
// of the path, nor any character it decodes to (a C1 control such as U+009B, a line separator, a bidi override), ever reaches the terminal raw (the CWE-117 rule above,
// which the wildcard of 21b broke by keeping valid UTF-8 characters as they were; the 21b re-check's N1).
const asciiOf = (b, keep, other) => [...b].map((x) => (keep(x) ? String.fromCharCode(x) : other(x))).join('');
const PRINTABLE = (x) => x >= 0x20 && x <= 0x7e;
// shown: printable ASCII as it is, every other byte, a backslash and a quote as \xNN
const showBytes = (b) => asciiOf(b, (x) => PRINTABLE(x) && x !== 0x5c && x !== 0x22, (x) => `${BACKSLASH}x${x.toString(16).padStart(2, '0')}`);
// as hex (21j): the rename a refusal prints names the path by its exact bytes, ASCII only, so it pastes in any shell; the wildcard of 21b to 21i also matched a valid name
// A hook runs with GIT_DIR, GIT_WORK_TREE, GIT_PREFIX and others that aim git at the repository the hook was started for.
// Every git call here drops them (the gate runs from the repository root and finds its repository from there), except
// GIT_INDEX_FILE, which names the index a commit is made from and is the thing commit mode must read, and GIT_CEILING_DIRECTORIES, which only NARROWS where git
// searches for the repository (a folder under a ceiling is not part of a repository above it; the worst a wrong value does is make the gate fail closed).
const KEPT = new Set(['GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES']);
const gitEnv = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k) || KEPT.has(k.toUpperCase()))), LC_ALL: 'C', LANGUAGE: 'C' });
// Windows looks for a program in the CURRENT folder before PATH, and the current folder is the checkout being scanned, so a git.exe planted in
// it ran in git's place with the committer's rights (measured 2026-11-03; CWE-426). Windows' own switch turns that lookup off, and Node reads it
// from THIS process's environment, never from a child's env option (measured), so the gate sets it for itself before its first spawn. Elsewhere
// the current folder is searched only when PATH names it, the user's own setting.
if (process.platform === 'win32') process.env.NoDefaultCurrentDirectoryInExePath = '1';
// git honours a replace ref when it reads an object, so a local `git replace` could show the scan other bytes than the commit records and the push
// sends. Every git call here reads objects as they are stored.
const NO_REPLACE = '--no-replace-objects';
// The scanner asks for one answer as bytes ({ buffer: true }: a commit's patch, to decode wide text in it); every other answer is a string.
const gitIn = (a, o) => execFileSync('git', [NO_REPLACE, ...a], { encoding: o && o.buffer ? 'buffer' : 'utf8', maxBuffer: 256 << 20, timeout: 60000, stdio: [o && o.input ? 'pipe' : 'ignore', 'pipe', 'pipe'], input: o && o.input, env: gitEnv() }); // input: bytes for git's stdin (21j)
// Reads blobs in one STREAMED process: "<sha> <type> <size>\n<bytes>\n" per object, "<sha> missing\n" for one git does not have. Each distinct id
// is asked for once, however many paths stage it. An id in `probe` (every path that stages it has a binary-looking name) is judged on its first
// bytes as they arrive and, when they are binary, dropped as it streams past, never held: a binary blob of any size costs no memory. Every other
// id is held whole, because it is scanned. Resolves a Map from id to its bytes, BINARY_BLOB for a dropped one, or null for a missing object.
const BINARY_BLOB = Symbol('binary');
// What the stream may hold at once (t342 F9, 2026-11-17): every blob that is scanned is held whole, so a very large staged text file (a dump, a data export) would fill the process's memory, and the
// concat of its pieces would throw outside any try. The count includes a blob still being probed and is released when a probed blob is dropped as binary. Past the ceiling the gate stops with a
// FAIL line that names the file, and the tree is NOT scanned (fail closed). The ceiling equals gitIn's own maxBuffer; SECRET_GATE_MAX_HELD_BYTES can only LOWER it (a test hook: a value that
// is not a positive integer, or that is higher, is ignored), so no environment can weaken the gate.
const HELD_CEILING = 256 << 20;
const heldCeiling = () => { const n = Number(process.env.SECRET_GATE_MAX_HELD_BYTES); return Number.isSafeInteger(n) && n > 0 && n < HELD_CEILING ? n : HELD_CEILING; };
const PROBE_BYTES = 8000; // the scanner's looksBinary reads this many first bytes
// A probed blob dropped as binary by its first bytes is not final (t343 F5, 2026-11-18; the 18b bounce made it a whole-file verdict). The prefix cannot see wide text that starts later, and no single piece of the
// stream can be trusted alone either: the scanner's wide-text rule is a threshold on TOTALS (NULs by byte position mod 4: at least WIDE_MIN_NULS, and at least WIDE_SKEW times the others), so evidence split
// across pieces, each under the threshold, reads wide only in sum. So every probed blob keeps four counters, NULs by ABSOLUTE offset mod 4, over every byte it streams (constant memory, whatever the chunk
// sizes), and the rule is applied once to the totals when the blob ends: a dropped blob whose totals read wide is answered { rereadBytes: size } instead of BINARY_BLOB, and the caller reads that one blob again,
// held, and judges it on its whole bytes. The verdict equals judging the whole file; nothing is held for a blob that never reads wide. The rule restated here is wideKinds' count test in secret-scan.mjs
// (the scanner's source repository, its own constants); a test compares this verdict with the scanner's on the whole buffer.
const WIDE_MIN_NULS = 12;
const WIDE_SKEW = 4;
// 20f (the 7edf02c review's H1): a blob the totals do not read as wide text can still hold a key in a wide spelling (text of both byte orders, balancing each
// other). The scanner's own search for those spellings (spelledProbe, passed in by the caller, never restated here) is fed every byte of the stream at its blob
// offset beside the totals; a blob is read again only when it found a provider key, so an honest binary is never read twice or scanned as text.
const newCounts = (newProbe) => ({ z: [0, 0, 0, 0], spelled: newProbe ? newProbe() : null });
const spelledKey = (c) => { if (!c.spelled) return false; c.spelled.end(); return c.spelled.found(); };
const wideByCounts = ({ z }) => {
  const even = z[0] + z[2];
  const odd = z[1] + z[3];
  if (Math.max(even, odd) >= WIDE_MIN_NULS && Math.max(even, odd) >= WIDE_SKEW * Math.min(even, odd)) return true;
  for (let k = 0; k < 4; k++) {
    const high = Math.min(z[(k + 1) & 3], z[(k + 2) & 3], z[(k + 3) & 3]);
    if (high >= WIDE_MIN_NULS && high >= WIDE_SKEW * z[k]) return true;
  }
  return false;
};
const countNuls = (c, piece, offset) => {
  for (let i = 0; i < piece.length; i++) {
    const nul = piece[i] === 0;
    if (nul) c.z[(offset + i) & 3]++;
  }
  if (c.spelled) c.spelled.feed(piece, offset);
};
function readBlobs(shas, probe, looksBinary, nameOf = new Map(), newProbe = null) {
  const ids = [...new Set(shas)];
  const ceiling = heldCeiling();
  let held = 0;
  return new Promise((resolve, reject) => {
    const out = new Map();
    let next = 0;
    let head = Buffer.alloc(0); // a header line not yet ended
    let cur = null; // { id, left, keep: true | false | null (not yet probed), parts, have }
    let bad = null;
    const child = spawn('git', [NO_REPLACE, 'cat-file', '--batch'], { timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'], env: gitEnv() });
    const stop = (msg, code = 'ECATFILE') => { if (!bad) bad = Object.assign(new Error(msg), { code }); child.kill(); };
    const tooBig = (id, what) => stop(`${esc(nameOf.get(id) || id)} ${what}: more than ${ceiling} bytes of staged text would be held in memory at once`, 'EHELD');
    child.stdout.on('data', (chunk) => {
      if (bad) return;
      let data = head.length ? Buffer.concat([head, chunk]) : chunk;
      head = Buffer.alloc(0);
      let pos = 0;
      while (pos < data.length) {
        if (cur && cur.left > 0) {
          let take = Math.min(cur.left, data.length - pos);
          // a blob still being probed takes no more than the prefix the probe reads, so its verdict never depends on how large a piece arrived (t346 F8):
          // the rest of the piece is read on the next turn of this loop, under the verdict
          if (cur.keep === null) take = Math.min(take, PROBE_BYTES - cur.have);
          const piece = data.subarray(pos, pos + take);
          pos += take;
          cur.left -= take;
          if (cur.z) countNuls(cur.z, piece, cur.size - cur.left - take); // the piece's first byte sits at blob offset size - (left + take)
          if (cur.keep === false) continue;
          // 21i (21h D20): a held blob is written into ONE buffer of its size, counted whole when it is made, so it is never joined from pieces (which held it twice)
          if (cur.buf) { piece.copy(cur.buf, cur.have); cur.have += take; continue; }
          cur.parts.push(piece);
          cur.have += take;
          held += take;
          if (held > ceiling) return tooBig(cur.id, 'is too large to hold');
          if (cur.keep === null && (cur.have >= PROBE_BYTES || cur.left === 0)) {
            const prefix = Buffer.concat(cur.parts); // at most PROBE_BYTES
            cur.keep = !looksBinary(prefix);
            if (!cur.keep) { held -= cur.have; cur.parts = []; } else {
              cur.z = null; // a blob kept as text needs no counters
              held += cur.size - cur.have;
              if (held > ceiling) return tooBig(cur.id, 'is too large to hold');
              try { cur.buf = Buffer.allocUnsafe(cur.size); } catch { return tooBig(cur.id, 'could not be allocated'); }
              prefix.copy(cur.buf, 0);
              cur.parts = [];
            }
          }
        } else if (cur) {
          if (data[pos] !== 10) return stop('cat-file output was malformed');
          pos++;
          let whole = cur.z && cur.keep === false && (wideByCounts(cur.z) || spelledKey(cur.z)) ? { rereadBytes: cur.size } : BINARY_BLOB;
          if (cur.keep !== false) { try { whole = cur.buf ?? Buffer.concat(cur.parts); } catch { return tooBig(cur.id, 'could not be joined'); } } // pieces only for a blob that ended before its probe read anything
          out.set(cur.id, whole);
          cur = null;
        } else {
          const nl = data.indexOf(10, pos);
          if (nl < 0) { head = Buffer.from(data.subarray(pos)); return; }
          const parts = data.toString('latin1', pos, nl).split(' ');
          pos = nl + 1;
          if (next >= ids.length) return stop('cat-file answered more objects than it was asked for');
          const id = ids[next++];
          if (parts[1] === 'missing') { out.set(id, null); continue; }
          const size = Number(parts[2]);
          if (!Number.isSafeInteger(size) || size < 0) return stop('cat-file output was malformed');
          if (!probe.has(id) && held + size > ceiling) return tooBig(id, 'is too large to hold'); // a header already says it: refused before one byte is held
          cur = { id, left: size, size, keep: probe.has(id) ? null : true, parts: [], have: 0, z: probe.has(id) ? newCounts(newProbe) : null, buf: null };
          if (cur.keep) { held += size; try { cur.buf = Buffer.allocUnsafe(size); } catch { return tooBig(id, 'could not be allocated'); } }
        }
      }
    });
    child.stderr.resume();
    child.stdin.on('error', () => {}); // a git that exits early closes the pipe; 'close' below reports why
    child.on('error', (e) => { if (!bad) bad = e; reject(bad); });
    child.on('close', (code, signal) => {
      if (bad) return reject(bad);
      if (code !== 0 || signal) return reject(Object.assign(new Error('cat-file failed'), { code: signal || `exit ${code}` }));
      if (cur || head.length || next < ids.length) return reject(Object.assign(new Error('cat-file output ended early'), { code: 'ECATFILE' }));
      resolve(out);
    });
    child.stdin.end(ids.join('\n') + '\n');
  });
}

async function main() {
  const prePush = args.includes('--pre-push');
  const remoteArg = (args.find((a) => a.startsWith('--remote=')) || '').slice('--remote='.length);
  const fails = [];
  let tracked;
  // 21a (CodeRabbit on a carrier's pull request): the listing is split as BYTES, and a path that does not survive a round trip through UTF-8 is set aside and named, never
  // decoded to U+FFFD: two such paths would become one name, and their hits one fingerprint that one acknowledgment clears for both
  const oddPaths = [];
  try {
    const listing = gitIn(['ls-files', '-s', '-z'], { buffer: true });
    tracked = [];
    for (let s = 0; s < listing.length;) {
      let e = listing.indexOf(0, s);
      if (e < 0) e = listing.length;
      const entry = listing.subarray(s, e);
      s = e + 1;
      if (!entry.length) continue;
      const text = entry.toString('utf8');
      const m = /^(\d+) ([0-9a-f]{40,64}) (\d)\t([\s\S]*)$/.exec(text);
      if (!m) throw new Error('unreadable index entry');
      if (!Buffer.from(text, 'utf8').equals(entry)) { const raw = entry.subarray(entry.indexOf(9) + 1); oddPaths.push({ shown: showBytes(raw), hex: raw.toString('hex'), mode: m[1], sha: m[2] }); continue; }
      tracked.push({ mode: m[1], sha: m[2], name: m[4] });
    }
  } catch (e) {
    const err = String((e && e.stderr) || '');
    // git words "no repository above here" two ways, each with a parenthetical (the upward walk reached the root, or stopped
    // at a mount boundary); "not a git repository: '<path>'" with none is a BROKEN repository, not an absent one: older git
    // prints it for a .git link to a missing directory (the ubuntu runner, 2026-10-23), and the bare phrase misread it
    const noRepo = /not a git repository \(or any (?:of the parent directories\)|parent up to mount point )/.test(err);
    // a git that ran and refused (a broken .git link, a dubious-ownership refusal) names its own cause; PATH is only the guess
    // when git printed nothing at all
    const first = (err.split('\n').find((l) => l.trim()) || '').trim();
    console.log(`FAIL SECRETS: ${noRepo ? 'this directory is not inside a git repository' : `git could not list the tracked files (${first ? esc(first) : 'is git on PATH?'})`}; the scan did NOT run`);
    process.exitCode = 1;
    return;
  }
  let scan;
  try {
    scan = await import(new URL('lib/secret-scan.mjs', import.meta.url).href);
  } catch (e) {
    console.log(`FAIL SECRETS: scripts/lib/secret-scan.mjs could not load (${e && e.code ? e.code : 'error'}); the scan did NOT run, so the push is not cleared`);
    process.exitCode = 1;
    return;
  }
  const ackCache = new Map();
  const badAck = [];
  const acksAt = (rev) => {
    if (ackCache.has(rev)) return ackCache.get(rev);
    const set = new Set();
    let text = '';
    try { text = gitIn(['show', `${rev}:${ACKS}`]); } catch { text = ''; }
    text.split(/\r?\n/).forEach((l, i) => {
      const t = l.replace(/#.*$/, '').trim();
      if (!t) return;
      if (/^[0-9a-f]{16}$/.test(t)) set.add(t); else badAck.push(`${rev.slice(0, 12)}:${i + 1}`);
    });
    ackCache.set(rev, set);
    return set;
  };
  const hits = new Set();
  let acked = 0;
  const tooLargeHits = new Set(); // classified by the hit's own pattern where it is kept (t342 F5): the line's text carries a file name, which a stranger chooses
  const keep = (h, where, acks) => { if (acks.has(h.fp)) acked++; else (h.pattern === scan.WIDE_TOO_LARGE ? tooLargeHits : hits).add(`${where} ${h.pattern} (fp ${h.fp})`); };
  const headAcks = acksAt('HEAD');

  let scanned = 0;
  const spelledOf = (b, name) => (typeof scan.spelledHits === 'function' ? scan.spelledHits(b, name) : []); // a scanner copy older than 20f has none
  const unreadable = [];
  const wanted = tracked.filter((e) => e.mode !== '160000'); // a gitlink is a submodule commit, not a file
  let blobs = null;
  if (wanted.length) {
    const allBinaryNamed = new Map(); // id -> true when every path that stages it has a binary-looking name
    for (const e of wanted) allBinaryNamed.set(e.sha, allBinaryNamed.get(e.sha) !== false && BINARY.test(e.name));
    const probe = new Set([...allBinaryNamed].filter(([, b]) => b).map(([id]) => id));
    const nameOf = new Map(wanted.map((e) => [e.sha, e.name]));
    const prefixBinary = (b) => scan.looksBinary(b) && !scan.wideKinds(b).length;
    try {
      const first = await readBlobs(wanted.map((e) => e.sha), probe, prefixBinary, nameOf, scan.spelledProbe);
      // A blob whose NUL totals read as wide text is read again, one at a time, and judged on its whole bytes. It is text by the gate's own rule, so the held-bytes
      // ceiling binds it as it binds text: the first read's buffers and every earlier re-read's count against the same ceiling (t346 F19), and one that cannot be held is a
      // FAIL line that names it, never a skip as binary (t346 F18: a wide file past the ceiling passed unscanned). The results are staged and become `blobs` only when every
      // re-read has come back, so a re-read that fails leaves no half-read map behind (t345 #10): the tree is then reported NOT scanned and nothing of it is.
      const staged = new Map(first);
      let heldNow = 0;
      for (const v of first.values()) if (Buffer.isBuffer(v)) heldNow += v.length;
      for (const [id, v] of first) {
        if (!v || v === BINARY_BLOB || v.rereadBytes === undefined) continue;
        if (heldNow + v.rereadBytes > heldCeiling()) {
          fails.push(`${esc(nameOf.get(id) || id)} reads as UTF-16 or UTF-32 text by its NUL counts, but holding its ${v.rereadBytes} bytes would put more than ${heldCeiling()} bytes of staged text in memory at once, so it was NOT scanned; keep the file out of the repository, or track it with Git LFS`);
          staged.set(id, BINARY_BLOB); // already failed by name above; the scan loop passes over it
          continue;
        }
        let again;
        try { again = (await readBlobs([id], new Set(), prefixBinary, nameOf)).get(id); } catch (e) { throw Object.assign(e ?? new Error('cat-file error'), { rereadOf: nameOf.get(id) || id }); } // the line names the file whose re-read failed (t352)
        const kept = again && !scan.wideKinds(again).length && !spelledOf(again, nameOf.get(id) || '').length ? BINARY_BLOB : again;
        staged.set(id, kept);
        if (Buffer.isBuffer(kept)) heldNow += kept.length;
      }
      blobs = staged;
    } catch (e) {
      fails.push(e && e.code === 'EHELD' ? `${e.message}; the tree was NOT scanned. Keep the file out of the repository, or track it with Git LFS` : `git could not ${e && e.rereadOf ? `re-read ${esc(e.rereadOf)}` : 'read the staged files'} (${e && e.code ? e.code : 'cat-file error'}); the tree was NOT scanned`);
    }
  }
  // A binary-looking NAME only marks a blob for the content probe: it is skipped when its bytes are binary too (a NUL in its first bytes,
  // git's rule, the scanner's looksBinary), so a text file named .png is scanned like any other. The scanner reads each blob from its bytes (scanBytes):
  // wide text (UTF-16 or UTF-32, by the scanner's wideKinds rule) is decoded and scanned, and every blob is read as UTF-8 too.
  if (blobs) wanted.forEach((e) => {
    const bytes = blobs.get(e.sha);
    if (bytes === null) { unreadable.push(esc(e.name)); return; }
    if (bytes === BINARY_BLOB) return; // binary-named at every path and binary by its first bytes, dropped while it streamed
    // only a Buffer is bytes (19b L2): anything else (a marker that leaked, an undefined) fails by name and is never counted as scanned or read as text
    if (!Buffer.isBuffer(bytes)) { fails.push(`${esc(e.name)} reached the scan as something other than its bytes (an internal error); it was NOT scanned`); return; }
    // a binary-looking name with NUL-bearing bytes is still text when the scanner's wide-text rule reads its first bytes as UTF-16 or UTF-32 (the bytes the stream probe judged)
    // 20f: such a blob reached here only because it holds a key in a wide spelling; only that search runs on it, never the text rules, so its noise draws no hit
    if (BINARY.test(e.name) && scan.looksBinary(bytes) && !scan.wideKinds(bytes).length) {
      for (const h of spelledOf(bytes, e.name)) keep(h, `tree ${esc(e.name)}:${h.line}`, headAcks);
      return;
    }
    scanned++;
    for (const h of scan.scanBytes(bytes, e.name)) keep(h, `tree ${esc(e.name)}:${h.line}`, headAcks);
  });
  if (unreadable.length) fails.push(`${unreadable.length} tracked file(s) could not be read, so were NOT scanned: ${unreadable.slice(0, 3).join('; ')}`);
  // 21b (the 21a review's L2): the refusal stands, and it says it is about the path, not a key, and how to rename such a path in the index. git mv cannot name it (its
  // quoted form is not unquoted, and a Windows command line cannot carry the byte), so the commands use the blob id and a wildcard, each checked on a real repository.
  // 21j (the 21i INSPECT's HIGH): no wildcard. A wildcard of such a path also matched a valid name of the same byte shape, and the forced removal of 21i dropped that
  // name's staged change; the gate's own --rename-odd (renameOdd, below) removes exactly the entry it named, by its bytes and its blob, in one index update.
  if (oddPaths.length) fails.push(`${oddPaths.length} staged path(s) are not valid UTF-8, so the gate cannot give their hits a fingerprint of their own and did NOT scan them. This refusal is about the path, not about a key in it. Rename each in the index with the command printed for it (git mv cannot name such a path, and a wildcard can also match a valid name): it removes exactly that entry, found by its bytes and its blob, and stages the same blob under the new name; the working tree is not touched: ${oddPaths.slice(0, 3).map((o) => `${o.shown}: node scripts/secret-gate.mjs --rename-odd=${o.hex}:${o.sha} --to="<new name>"`).join(' | ')}${oddPaths.length > 3 ? ' ...' : ''}`);

  let rangeNote = 'no pushed range (tree mode)';
  if (prePush) {
    try {
      if (process.stdin.isTTY) throw new Error('stdin is a terminal');
      let remote = null;
      if (remoteArg && gitIn(['remote']).split(/\r?\n/).map((s) => s.trim()).includes(remoteArg)) remote = remoteArg;
      const r = scan.scanPushed(fs.readFileSync(0, 'utf8'), gitIn, { remote });
      const place = { diff: (h) => `${esc(h.file)}:${h.line}`, message: (h) => `(commit message):${h.line}`, tag: (h) => `(tag message):${h.line}` };
      for (const h of r.hits) keep(h, `pushed ${h.commit.slice(0, 12)} ${place[h.kind](h)}`, acksAt(h.refSha));
      rangeNote = r.refs
        ? `pushed range: ${r.refs} ref(s), ${r.commits} commit(s) with their messages, ${r.tags} annotated tag message(s)`
        : 'pushed range: no refs on stdin, nothing to scan';
    } catch (e) {
      if (e && e.code === 'EPATHBYTES') {
        fails.push(`a pushed file's path is not valid UTF-8 (${showBytes(e.path)}), so its hits cannot get a fingerprint of their own; the added lines of this push were NOT scanned. This refusal is about the path, not about a key in it. Rename the file in the unpushed commit that adds it: run the gate without --pre-push while the path is in the index, follow the rename it prints, then git commit --amend (or rebase, for an older commit)`);
      } else if (e && e.code === 'ENONCOMMIT') {
        for (const r of e.refs) fails.push(`${esc(r.ref)} pushes a non-commit object (${/^[a-z]+$/.test(r.type) ? r.type : esc(r.type)}), which the range scan cannot read`);
      } else {
        fails.push(`the pushed range could not be read (${e && e.code ? e.code : 'git or stdin error'}); the added lines of this push were NOT scanned`);
      }
    }
  }
  if (badAck.length) fails.push(`${ACKS} line(s) ${badAck.join(', ')} (revision:line) are not a 16-hex fingerprint; refusing to guess what they acknowledge`);
  // a file too large to decode holds no match and no value: its own line says what an acknowledgement of it does
  const tooLarge = [...tooLargeHits];
  const matches = [...hits];
  if (tooLarge.length) fails.push(`${tooLarge.length} file(s) the scanner reads as UTF-16 or UTF-32 text are larger than ${scan.WIDE_DECODE_MAX_BYTES >> 20} MiB, so their wide text was NOT decoded or scanned. Check each for keys first: acknowledging its fingerprint in ${ACKS} lets those exact bytes pass without the wide-text scan: ${tooLarge.slice(0, 5).join('; ')}${tooLarge.length > 5 ? ' ...' : ''}`);
  if (matches.length) fails.push(`${matches.length} secret-shaped match(es), values never printed. Remove each and rotate it if it was real, or acknowledge a known public value by fingerprint in ${ACKS}, committed where the gate reads it: for a "tree" hit in HEAD (the commit checked out), for a "pushed" hit in the tip of the ref you push (21i): ${matches.slice(0, 5).join('; ')}${matches.length > 5 ? ' ...' : ''}`);
  if (fails.length) {
    for (const f of fails) console.log(`FAIL SECRETS: ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS SECRETS: tree scan of ${scanned} tracked text file(s) clean; ${rangeNote}${acked ? `, ${acked} acknowledged hit(s) via ${ACKS}` : ''}`);
}

// --rename-odd=<hex>:<blob> --to=<new name> (21j, reworked at 21k): the one staged entry whose path bytes are <hex>, which is not valid UTF-8, and whose blob is
// <blob> is renamed in the index; the working tree is not touched. 21k (the 21i INSPECT's re-check: a name git refused dropped the entry with exit 0, and a file or
// folder clash removed another entry): GIT judges the new state before anything is removed. (1) The new entry is ADDED first, with the same mode and blob, by git
// update-index --add --cacheinfo, never --replace, so git refuses an invalid path (.., .git, an absolute or drive path, a backslash on Windows, a trailing slash) and
// a file/folder clash, and its own reason is printed. (2) The whole index is read back: exactly that one entry must be new and nothing else changed. (3) Only then
// is the old entry removed, by its exact bytes (mode 0 in --index-info), and the index read back again; the success line follows. A name already staged, or one that
// differs from a staged name or folder only by letter case (one file on Windows and macOS), is refused before git is asked. Every refusal before (3) changes nothing.
function readIndexEntries() {
  const listing = gitIn(['ls-files', '-s', '-z'], { buffer: true });
  const out = [];
  for (let s = 0; s < listing.length;) {
    let e = listing.indexOf(0, s);
    if (e < 0) e = listing.length;
    const entry = listing.subarray(s, e);
    s = e + 1;
    const tab = entry.indexOf(9);
    if (tab < 0) continue;
    const [mode, sha, stage] = entry.subarray(0, tab).toString('latin1').split(' ');
    out.push({ mode, sha, stage, name: entry.subarray(tab + 1), row: entry.toString('hex') });
  }
  return out;
}
// The command that removes one staged entry, named by its exact bytes and blob, ASCII only so it pastes in any shell (21l).
const dropTwinCmd = (drop, keep, sha) => `node scripts/secret-gate.mjs --drop-twin=${drop.toString('hex')}:${keep.toString('hex')}:${sha}`; // 21m: names both entries
// What a rename stopped after its add leaves (21l): both names staged on one blob, nothing lost, and the two commands that settle it.
const bothStaged = (raw, toBytes, sha) => [
  `the index now holds ${esc(toBytes.toString('utf8'))} staged beside ${showBytes(raw)}, both on blob ${sha.slice(0, 12)}, so nothing is lost. Run one of these:`,
  `  Finish the rename (remove the old entry): ${dropTwinCmd(raw, toBytes, sha)}`,
  `  Undo it (remove the new entry): ${dropTwinCmd(toBytes, raw, sha)}`,
].join('\n');
// 21n (a red on main's POSIX runners): a name any of the three platforms a carrier builds on refuses is refused on EVERY platform, as the letter-case twin is, because a
// carrier's CI runs Windows, macOS and Linux (C:/abs.txt is a legal path to git on Linux). The rules are Windows' own (node/runtime.md section 4, Microsoft Learn,
// Naming Files, Paths, and Namespaces) applied to each segment: no reserved character (< > : " \ | ? * or codes 0-31), no reserved device name before the first period
// in any case (CON PRN AUX NUL, COM1-COM9, LPT1-LPT9 and their superscript forms), and no segment ending in a space or a period. null when the name passes.
const RESERVED_CHAR = /[<>:"\\|?*\u0000-\u001f]/;
const DEVICE = /^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])$/i;
function windowsRefuses(name) {
  for (const seg of name.split('/')) {
    if (RESERVED_CHAR.test(seg)) return `${esc(seg)} holds a character Windows reserves (< > : " \\ | ? * or a control character)`;
    if (DEVICE.test(seg.split('.')[0])) return `${esc(seg)} is a device name Windows reserves (CON, PRN, AUX, NUL, COM1-COM9, LPT1-LPT9)`;
    if (/[ .]$/.test(seg)) return `${esc(seg)} ends in a space or a period, which Windows drops`;
  }
  return null;
}
function renameOdd(spec, to) {
  const m = /^((?:[0-9a-f]{2})+):([0-9a-f]{40,64})$/.exec(spec);
  if (!m) { console.error(`secret-gate: --rename-odd takes <path as hex>:<blob>, as the refusal prints it, not ${esc(spec)}`); process.exitCode = 64; return; }
  if (typeof to !== 'string' || !to || /[\0\r\n]/.test(to)) { console.error('secret-gate: --rename-odd needs --to=<new name>, one line, not empty'); process.exitCode = 64; return; }
  const raw = Buffer.from(m[1], 'hex');
  const fail = (why, changed = 'nothing was changed') => { console.log(`FAIL RENAME: ${why}; ${changed}`); process.exitCode = 1; };
  if (Buffer.from(raw.toString('utf8'), 'utf8').equals(raw)) return fail(`${esc(raw.toString('utf8'))} is valid UTF-8: rename it with git mv`);
  const before = readIndexEntries();
  const target = before.find((e) => e.name.equals(raw));
  if (!target) return fail(`no staged path ${showBytes(raw)}`);
  if (target.stage !== '0') return fail(`${showBytes(raw)} is unmerged (stage ${target.stage}): finish or abort the merge first, then run the gate again`);
  if (target.sha !== m[2]) return fail(`${showBytes(raw)} is staged with blob ${target.sha.slice(0, 12)}, not ${m[2].slice(0, 12)}: run the gate again and use the command it prints now`);
  const portable = windowsRefuses(to);
  if (portable) return fail(`${portable}: a carrier's CI builds on Windows, macOS and Linux, so the name must be legal on all three; choose another name`);
  const toBytes = Buffer.from(to, 'utf8');
  const fold = to.toLowerCase();
  for (const e of before) {
    if (e.name.equals(toBytes)) {
      // 21l: the new name already staged with this blob and mode beside the old entry is what a rename stopped after its add leaves behind
      if (e.sha === m[2] && e.mode === target.mode && e.stage === '0') return fail(`${esc(to)} is already staged with this blob, beside ${showBytes(raw)}: a half-finished earlier run (stopped or failed after its add)`, bothStaged(raw, toBytes, m[2]));
      return fail(`${esc(to)} is already in the index: choose another name`);
    }
    const n = e.name.toString('utf8');
    if (!Buffer.from(n, 'utf8').equals(e.name)) continue;
    const ln = n.toLowerCase();
    if (ln === fold) return fail(`${esc(to)} differs from the staged ${esc(n)} only by letter case, one file on Windows and macOS: choose another name`);
    // a folder or file clash by letter case only; an exact clash is git's to refuse in (1)
    if ((ln.startsWith(fold + '/') && !n.startsWith(to + '/')) || (fold.startsWith(ln + '/') && !to.startsWith(n + '/'))) return fail(`${esc(to)} clashes with the staged ${esc(n)} by letter case only, one folder on Windows and macOS: choose another name`);
  }
  // (1) add first: git judges the name
  try { gitIn(['update-index', '--add', '--cacheinfo', `${target.mode},${m[2]},${to}`]); } catch (e) {
    const reason = String((e && e.stderr) || (e && e.message) || 'git error').split(/\r?\n/).filter(Boolean).slice(0, 2).join(' / ');
    return fail(`git refused the new name: ${esc(reason)}`);
  }
  // From here the new entry is staged: no message may say nothing was changed (21l). A failure says what the index holds and how to settle it.
  const halfDone = (why) => fail(why, bothStaged(raw, toBytes, m[2]));
  try {
    // (2) read back: exactly the one new entry, nothing else changed
    const want = Buffer.concat([Buffer.from(`${target.mode} ${m[2]} 0\t`), toBytes]).toString('hex');
    const was = new Set(before.map((e) => e.row));
    const now = readIndexEntries();
    const kept = new Set(now.map((e) => e.row));
    const extra = now.filter((e) => !was.has(e.row) && e.row !== want);
    const gone = before.filter((e) => !kept.has(e.row));
    if (extra.length || gone.length || !now.some((e) => e.row === want)) {
      const named = [...extra.map((e) => `new ${showBytesOrName(e.name)}`), ...gone.map((e) => `gone ${showBytesOrName(e.name)}`)].join(', ');
      return halfDone(`the index after adding ${esc(to)} is not the one expected (${named || 'the new entry is missing'}): another run may have touched the index, so the old entry was NOT removed`);
    }
    // (3) only now remove the old entry, by its exact bytes, and read back again
    gitIn(['update-index', '-z', '--index-info'], { input: Buffer.concat([Buffer.from(`0 ${m[2]}\t`), raw, Buffer.from([0])]) });
    if (readIndexEntries().some((e) => e.name.equals(raw))) return halfDone(`${showBytes(raw)} is still staged after its removal`);
  } catch (e) {
    return halfDone(`the rename stopped after its add (${e && e.code ? e.code : 'git error'})`);
  }
  console.log(`secret-gate: renamed ${showBytes(raw)} to ${esc(to)} in the index (blob ${m[2].slice(0, 12)}); the working tree is not touched`);
}
// A name for a message: valid UTF-8 as a quoted string, anything else byte by byte.
const showBytesOrName = (b) => (Buffer.from(b.toString('utf8'), 'utf8').equals(b) ? esc(b.toString('utf8')) : showBytes(b));
// --drop-twin=<drop hex>:<keep hex>:<blob> (21l, both entries named since 21m): remove the stage-0 entry whose path bytes are <drop hex>, only while the stage-0 entry
// whose path bytes are <keep hex> is staged with the same <blob>, so the blob stays staged under that named entry and nothing is lost. The two must be different entries
// and the rename's own pair: exactly one of them a path that is not valid UTF-8. Another file that happens to hold the same blob (every empty file shares one) is never
// taken in place of the named entry (the 21i INSPECT's re-check of 21l: with any same-blob entry as the twin, the Finish and the Undo both ran and the rescued file was
// left under neither name). It finishes or undoes a rename stopped after its add: the Finish names (old, keep new), the Undo (new, keep old), so after either one the
// other is refused, the entry it must keep being gone.
function dropTwin(spec) {
  const m = /^((?:[0-9a-f]{2})+):((?:[0-9a-f]{2})+):([0-9a-f]{40,64})$/.exec(spec);
  if (!m) { console.error(`secret-gate: --drop-twin takes <drop hex>:<keep hex>:<blob>, as the gate prints it, not ${esc(spec)}`); process.exitCode = 64; return; }
  const drop = Buffer.from(m[1], 'hex');
  const keep = Buffer.from(m[2], 'hex');
  const sha = m[3];
  const fail = (why) => { console.log(`FAIL DROP: ${why}; nothing was changed`); process.exitCode = 1; };
  if (drop.equals(keep)) return fail(`the entry to drop and the entry to keep are the same entry, ${showBytesOrName(drop)}`);
  const odd = (b) => !Buffer.from(b.toString('utf8'), 'utf8').equals(b);
  if (odd(drop) === odd(keep)) return fail(`exactly one of the two is a path that is not valid UTF-8 in the pair a rename leaves; ${showBytesOrName(drop)} and ${showBytesOrName(keep)} are not that pair`);
  const before = readIndexEntries();
  const target = before.find((e) => e.name.equals(drop) && e.stage === '0');
  if (!target) return fail(`no staged path ${showBytesOrName(drop)}`);
  if (target.sha !== sha) return fail(`${showBytesOrName(drop)} is staged with blob ${target.sha.slice(0, 12)}, not ${sha.slice(0, 12)}`);
  const kept = before.find((e) => e.name.equals(keep) && e.stage === '0');
  if (!kept) return fail(`the entry to keep, ${showBytesOrName(keep)}, is not staged, so removing ${showBytesOrName(drop)} could leave the file under neither name`);
  if (kept.sha !== sha) return fail(`${showBytesOrName(keep)} is staged with blob ${kept.sha.slice(0, 12)}, not ${sha.slice(0, 12)}, so it does not keep the bytes of ${showBytesOrName(drop)}`);
  gitIn(['update-index', '-z', '--index-info'], { input: Buffer.concat([Buffer.from(`0 ${sha}\t`), drop, Buffer.from([0])]) });
  const after = readIndexEntries();
  if (after.some((e) => e.name.equals(drop))) { console.log(`FAIL DROP: ${showBytesOrName(drop)} is still staged after its removal`); process.exitCode = 1; return; }
  console.log(`secret-gate: removed ${showBytesOrName(drop)} from the index; ${showBytesOrName(keep)} still stages blob ${sha.slice(0, 12)}`);
}
const renameArg = args.find((a) => a.startsWith('--rename-odd='));
const dropArg = args.find((a) => a.startsWith('--drop-twin='));
const unknown = args.filter((a) => !known(a));
if (args.includes('-h') || args.includes('--help')) console.log(USAGE);
else if (unknown.length) { console.error(`secret-gate: unknown argument ${JSON.stringify(unknown[0])}
${USAGE}`); process.exitCode = 64; }
else if (dropArg) { try { dropTwin(dropArg.slice('--drop-twin='.length)); } catch (e) { console.error(`secret-gate: the removal could not run (${e && e.code ? e.code : 'git error'}); the index is as git left it, check git ls-files -s`); process.exitCode = 1; } }
else if (renameArg) { try { renameOdd(renameArg.slice('--rename-odd='.length), (args.find((a) => a.startsWith('--to=')) ?? '').slice('--to='.length) || undefined); } catch (e) { console.error(`secret-gate: the rename could not run (${e && e.code ? e.code : 'git error'}); nothing was changed`); process.exitCode = 1; } }
else main().catch((e) => { console.error(`secret-gate: ${e && e.message ? e.message : e}`); process.exitCode = 1; });
