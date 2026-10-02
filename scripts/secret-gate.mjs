#!/usr/bin/env node
// secret-gate — the pre-push secret scan a PUBLIC repository carries (UMB-282 (a), owner sheet AW-7 = (1)).
//
// WHY: GitHub scans a public repository for PROVIDER tokens for free, but a private key, a connection string or an
// HTTP authentication header is a "generic" pattern that needs GitHub Team with Secret Protection, and the owner chose
// not to buy it. This gate is the house's own wall for those: it runs the portable scanner (scripts/lib/secret-scan.mjs,
// byte-equal in every carrier, checked by the umbrella's scanner-parity.mjs) before a commit and before a push.
//
// TWO SCANS. (1) The tracked tree, always: that is what a CI checkout can see. (2) With --pre-push (the hook passes it,
// with git's ref lines on stdin): the ADDED lines of every commit being pushed, so a key added and then deleted inside the
// range is still found, plus every pushed commit message and annotated-tag message. --remote=<name> narrows a new branch
// to the commits that remote does not already have.
//
// A SCAN THAT CANNOT RUN FAILS: a scanner that will not load, a tracked file that cannot be read, stdin that is a
// terminal, a range git cannot list. Never a pass, never a note (hooks-safety.md 1.0: a git pre-* hook must be able to abort).
//
// ACKNOWLEDGMENT, the one escape hatch: a known NON-secret match is silenced by its 16-hex fingerprint on its own line in
// secret-scan.acks, read from a COMMITTED tree only (HEAD's for the tree scan, the pushed ref's tip for a pushed hit), so an
// ack only works if it travels in the push, where a reviewer sees it. A hit never prints its value.
//
// Usage:   node scripts/secret-gate.mjs [--pre-push [--remote=<name>]]
// Example: node scripts/secret-gate.mjs
// Exit:    0 clean · 1 a hit, or a scan that could not run · 64 usage error
// Report a problem: TheColliery/.github issues. Zero dependencies: node builtins only (Phoenix #2).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const USAGE = 'usage: node scripts/secret-gate.mjs [--pre-push [--remote=<name>]] | -h\n'
  + '  scans the tracked files; with --pre-push also every commit being pushed (git\'s ref lines on stdin)\n'
  + '  example: node scripts/secret-gate.mjs\n'
  + '  exit 0 clean · 1 a hit or a scan that could not run · 64 usage error';
const ACKS = 'secret-scan.acks';
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|7z|woff2?|ttf|otf|eot|mp[34]|mov|xlsx?|docx?|pptx?|gguf|safetensors|bin)$/i;
const BACKSLASH = String.fromCharCode(92);

const args = process.argv.slice(2);
const known = (a) => a === '--pre-push' || a.startsWith('--remote=');

// JSON.stringify neutralises CR, LF, controls, quotes and backslashes; every other character that can forge a line or hide
// text in a terminal is escaped BY CATEGORY (Cc, Cf, Zl, Zp), never by a list (security.md, log injection).
const unit4 = (c) => `${BACKSLASH}u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
const esc = (s) => JSON.stringify(String(s)).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => c.split('').map(unit4).join(''));
const gitIn = (a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 256 << 20, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C', LANGUAGE: 'C' } });

async function main() {
  const prePush = args.includes('--pre-push');
  const remoteArg = (args.find((a) => a.startsWith('--remote=')) || '').slice('--remote='.length);
  const fails = [];
  let tracked;
  try {
    tracked = gitIn(['ls-files', '-z']).split('\0').filter(Boolean);
  } catch (e) {
    const noRepo = /not a git repository/i.test(String((e && e.stderr) || ''));
    console.log(`FAIL SECRETS: ${noRepo ? 'this directory is not inside a git repository' : 'git could not list the tracked files (is git on PATH?)'}; the scan did NOT run`);
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
  const keep = (h, where, acks) => { if (acks.has(h.fp)) acked++; else hits.add(`${where} ${h.pattern} (fp ${h.fp})`); };
  const headAcks = acksAt('HEAD');

  let scanned = 0;
  const unreadable = [];
  for (const f of tracked.filter((n) => !BINARY.test(n))) {
    let t;
    try { t = fs.readFileSync(f, 'utf8'); } catch (e) { if (e && e.code !== 'ENOENT') unreadable.push(esc(f)); continue; }
    scanned++;
    for (const h of scan.scanText(t, f)) keep(h, `tree ${esc(f)}:${h.line}`, headAcks);
  }
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
  if (hits.size) fails.push(`${hits.size} secret-shaped match(es), values never printed. Remove each and rotate it if it was real, or acknowledge a known public value by fingerprint in ${ACKS}, committed on the branch you push: ${[...hits].slice(0, 5).join('; ')}${hits.size > 5 ? ' ...' : ''}`);
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
