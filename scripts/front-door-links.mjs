#!/usr/bin/env node
// front-door-links: every outward http(s) link of the named markdown files answers, at the page it names (UMB3-035 row C9, order 16i).
// The engine and its reasons: scripts/lib/front-door-links.mjs. Run by .github/workflows/front-door-links.yml on every change to a front door and
// on a weekly clock, and by hand before a README ships a new link.
//
// Usage:   node scripts/front-door-links.mjs [--skip-host=<host>]... <file.md> [<file.md> ...]
// Example: node scripts/front-door-links.mjs README.md SECURITY.md
// Exit:    0 every link answers · 1 a finding, or a file that cannot be read · 64 usage error
// Env:     FRONT_DOOR_LINKS_TIMEOUT_MS (per request, default 10000) · FRONT_DOOR_LINKS_RETRY_MS (the pause before the one retry, default 2000)
// Output:  one `FAIL <file>:<line>: <url>: <why>` line per finding, then the summary line. Report a problem: the repository's issues.
// Node builtins only at the top level (node/runtime.md section 1): the engine is imported inside the try, so a missing engine is a FAIL line, never a stack.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const USAGE = 'usage: node scripts/front-door-links.mjs [--skip-host=<host>]... <file.md> [<file.md> ...] | -h\n'
  + '  fetches every http(s) link of the files (fenced and inline code excluded) and fails on one that does not answer at the page it names\n'
  + '  example: node scripts/front-door-links.mjs README.md SECURITY.md\n'
  + '  exit 0 every link answers · 1 a finding or an unreadable file · 64 usage error';

const env = (k, d) => (Number(process.env[k]) > 0 ? Number(process.env[k]) : d);

// A front door is a page a visitor reads, so a named file is read only as a regular file under a byte bound (ours: 4 MiB, far past any README),
// checked on the open descriptor before the read: a device or a pipe in its place has no end to read to. The open comes first (a stat of the name
// before it is a race), refuses a link where the platform can (O_NOFOLLOW) and never waits on a pipe (O_NONBLOCK); where it cannot (Windows), the
// name is checked for a link after the open. The same shape as release-notes.mjs's readChangelog.
const MAX_FILE_BYTES = 4194304;
const OPEN_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
function readBounded(f) {
  const notRegular = () => Object.assign(new Error('not a regular file'), { code: 'not a regular file' });
  let fd;
  try { fd = fs.openSync(f, OPEN_FLAGS); } catch (e) { throw e && e.code === 'ELOOP' ? notRegular() : e; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || fs.lstatSync(f).isSymbolicLink()) throw notRegular();
    if (st.size > MAX_FILE_BYTES) throw Object.assign(new Error('too large'), { code: `${st.size} bytes, past the byte bound of ${MAX_FILE_BYTES}` });
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}

// A file name, a link or a server's redirect target can carry a control character (C0, DEL, C1, a line or paragraph separator). Each is written as
// its code point, so no FAIL line can be forged, split or erased on the terminal or in a log that parses these lines (CWE-117).
const BACKSLASH = String.fromCharCode(92);
const printable = (s) => Array.from(String(s), (ch) => {
  const c = ch.codePointAt(0);
  return c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 ? `${BACKSLASH}u{${c.toString(16)}}` : ch;
}).join('');

async function main(argv) {
  if (argv.includes('-h') || argv.includes('--help')) { console.log(USAGE); return 0; }
  const skipHosts = [];
  const files = [];
  for (const a of argv) {
    if (a.startsWith('--skip-host=') && a.length > '--skip-host='.length) skipHosts.push(a.slice('--skip-host='.length).toLowerCase());
    else if (a.startsWith('-')) { console.error(`front-door-links: unknown flag ${JSON.stringify(a)}\n${USAGE}`); return 64; }
    else files.push(a);
  }
  if (!files.length) { console.error(`front-door-links: no file given\n${USAGE}`); return 64; }
  let fails = 0;
  const texts = [];
  for (const f of files) {
    try { texts.push({ name: f, text: readBounded(f) }); } catch (e) { console.log(`FAIL ${printable(f)}: cannot be read (${printable(e.code || e.message)})`); fails++; }
  }
  let summary = '';
  try {
    const lib = await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'front-door-links.mjs')).href);
    const r = await lib.checkFiles(texts, { timeoutMs: env('FRONT_DOOR_LINKS_TIMEOUT_MS', lib.DEFAULT_TIMEOUT_MS), retryMs: env('FRONT_DOOR_LINKS_RETRY_MS', lib.DEFAULT_RETRY_MS), skipHosts });
    for (const x of r.findings) console.log(`FAIL ${printable(x.file)}:${x.line}: ${printable(x.url)}: ${printable(x.message)}`);
    fails += r.findings.length;
    summary = `${r.links} link(s) in ${texts.length} file(s), ${r.fetched} fetched${r.skipped.length ? `, ${r.skipped.length} skipped by host` : ''}`;
  } catch (e) {
    console.log(`FAIL front-door-links: the engine could not run (${printable(e && e.message ? e.message : e)})`);
    fails++;
  }
  console.log(`${fails} finding(s)${summary ? `; ${summary}` : ''}`);
  return fails ? 1 : 0;
}

process.exitCode = await main(process.argv.slice(2));
