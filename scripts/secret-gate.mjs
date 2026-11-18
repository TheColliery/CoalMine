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
// TWO SCANS. (1) The STAGED tree, always: every blob in the index except a binary one (a blob whose every staged path has a binary-looking name AND whose first bytes are binary is skipped, below), which is what a commit records and what a CI checkout
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
// Example: node scripts/secret-gate.mjs
// Exit:    0 clean · 1 a hit, or a scan that could not run · 64 usage error
// Report a problem: TheColliery/.github issues. Zero dependencies: node builtins only.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';

const USAGE = 'usage: node scripts/secret-gate.mjs [--pre-push [--remote=<name>]] | -h\n'
  + '  scans the staged files (the index); with --pre-push also every commit being pushed (git\'s ref lines on stdin)\n'
  + '  example: node scripts/secret-gate.mjs\n'
  + '  exit 0 clean · 1 a hit or a scan that could not run · 64 usage error';
const ACKS = 'secret-scan.acks';
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|7z|woff2?|ttf|otf|eot|mp[34]|mov|xlsx?|docx?|pptx?|gguf|safetensors|bin)$/i;
const BACKSLASH = String.fromCharCode(92);

const args = process.argv.slice(2);
const known = (a) => a === '--pre-push' || a.startsWith('--remote=');

// JSON.stringify neutralises CR, LF, controls, quotes and backslashes; every other character that can forge a line or hide
// text in a terminal is escaped BY CATEGORY (Cc, Cf, Zl, Zp), never by a list (CWE-117, log injection).
const unit4 = (c) => `${BACKSLASH}u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
const esc = (s) => JSON.stringify(String(s)).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => c.split('').map(unit4).join(''));
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
const gitIn = (a, o) => execFileSync('git', [NO_REPLACE, ...a], { encoding: o && o.buffer ? 'buffer' : 'utf8', maxBuffer: 256 << 20, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv() });
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
const wideByCounts = (z) => {
  const even = z[0] + z[2];
  const odd = z[1] + z[3];
  if (Math.max(even, odd) >= WIDE_MIN_NULS && Math.max(even, odd) >= WIDE_SKEW * Math.min(even, odd)) return true;
  for (let k = 0; k < 4; k++) {
    const high = Math.min(z[(k + 1) & 3], z[(k + 2) & 3], z[(k + 3) & 3]);
    if (high >= WIDE_MIN_NULS && high >= WIDE_SKEW * z[k]) return true;
  }
  return false;
};
const countNuls = (z, piece, offset) => { for (let i = 0; i < piece.length; i++) if (piece[i] === 0) z[(offset + i) & 3]++; };
function readBlobs(shas, probe, looksBinary, nameOf = new Map()) {
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
          const take = Math.min(cur.left, data.length - pos);
          const piece = data.subarray(pos, pos + take);
          pos += take;
          cur.left -= take;
          if (cur.z) countNuls(cur.z, piece, cur.size - cur.left - take); // the piece's first byte sits at blob offset size - (left + take)
          if (cur.keep === false) continue;
          cur.parts.push(piece);
          cur.have += take;
          held += take;
          if (held > ceiling) return tooBig(cur.id, 'is too large to hold');
          if (cur.keep === null && (cur.have >= PROBE_BYTES || cur.left === 0)) {
            cur.keep = !looksBinary(Buffer.concat(cur.parts));
            if (!cur.keep) { held -= cur.have; cur.parts = []; } else cur.z = null; // a blob kept as text needs no counters
          }
        } else if (cur) {
          if (data[pos] !== 10) return stop('cat-file output was malformed');
          pos++;
          let whole = cur.z && cur.keep === false && wideByCounts(cur.z) ? { rereadBytes: cur.size } : BINARY_BLOB;
          if (cur.keep !== false) { try { whole = Buffer.concat(cur.parts); } catch { return tooBig(cur.id, 'could not be joined'); } }
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
          cur = { id, left: size, size, keep: probe.has(id) ? null : true, parts: [], have: 0, z: probe.has(id) ? [0, 0, 0, 0] : null };
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
  try {
    tracked = gitIn(['ls-files', '-s', '-z']).split('\0').filter(Boolean).map((e) => {
      const m = /^(\d+) ([0-9a-f]{40,64}) (\d)\t([\s\S]*)$/.exec(e);
      if (!m) throw new Error('unreadable index entry');
      return { mode: m[1], sha: m[2], name: m[4] };
    });
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
      blobs = await readBlobs(wanted.map((e) => e.sha), probe, prefixBinary, nameOf);
      // a blob some chunk of which reads as wide text is read again, one at a time, and judged on its whole bytes; one past the held-bytes ceiling stays skipped, as it was before (it cannot be held)
      for (const [id, v] of [...blobs]) {
        if (!v || v === BINARY_BLOB || v.rereadBytes === undefined) continue;
        if (v.rereadBytes > heldCeiling()) { blobs.set(id, BINARY_BLOB); continue; }
        const again = (await readBlobs([id], new Set(), prefixBinary, nameOf)).get(id);
        blobs.set(id, again && !scan.wideKinds(again).length ? BINARY_BLOB : again);
      }
    } catch (e) {
      fails.push(e && e.code === 'EHELD' ? `${e.message}; the tree was NOT scanned` : `git could not read the staged files (${e && e.code ? e.code : 'cat-file error'}); the tree was NOT scanned`);
    }
  }
  // A binary-looking NAME only marks a blob for the content probe: it is skipped when its bytes are binary too (a NUL in its first bytes,
  // git's rule, the scanner's looksBinary), so a text file named .png is scanned like any other. The scanner reads each blob from its bytes (scanBytes):
  // wide text (UTF-16 or UTF-32, by the scanner's wideKinds rule) is decoded and scanned, and every blob is read as UTF-8 too.
  if (blobs) wanted.forEach((e) => {
    const bytes = blobs.get(e.sha);
    if (bytes === null) { unreadable.push(esc(e.name)); return; }
    if (bytes === BINARY_BLOB) return; // binary-named at every path and binary by its first bytes, dropped while it streamed
    // a binary-looking name with NUL-bearing bytes is still text when the scanner's wide-text rule reads its first bytes as UTF-16 or UTF-32 (the bytes the stream probe judged)
    if (BINARY.test(e.name) && scan.looksBinary(bytes) && !scan.wideKinds(bytes).length) return;
    scanned++;
    for (const h of scan.scanBytes(bytes, e.name)) keep(h, `tree ${esc(e.name)}:${h.line}`, headAcks);
  });
  if (unreadable.length) fails.push(`${unreadable.length} tracked file(s) could not be read, so were NOT scanned: ${unreadable.slice(0, 3).join('; ')}`);

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
      if (e && e.code === 'ENONCOMMIT') {
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
  if (matches.length) fails.push(`${matches.length} secret-shaped match(es), values never printed. Remove each and rotate it if it was real, or acknowledge a known public value by fingerprint in ${ACKS}, committed on the branch you push: ${matches.slice(0, 5).join('; ')}${matches.length > 5 ? ' ...' : ''}`);
  if (fails.length) {
    for (const f of fails) console.log(`FAIL SECRETS: ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS SECRETS: tree scan of ${scanned} tracked text file(s) clean; ${rangeNote}${acked ? `, ${acked} acknowledged hit(s) via ${ACKS}` : ''}`);
}

const unknown = args.filter((a) => !known(a));
if (args.includes('-h') || args.includes('--help')) console.log(USAGE);
else if (unknown.length) { console.error(`secret-gate: unknown argument ${JSON.stringify(unknown[0])}
${USAGE}`); process.exitCode = 64; }
else main().catch((e) => { console.error(`secret-gate: ${e && e.message ? e.message : e}`); process.exitCode = 1; });
