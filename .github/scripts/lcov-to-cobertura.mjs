#!/usr/bin/env node
// lcov-to-cobertura.mjs -- converts the lcov file Node's own test runner writes
// (`node --test --experimental-test-coverage --test-reporter=lcov ...`) into the Cobertura
// XML that GitHub's built-in code coverage upload accepts (actions/upload-code-coverage).
//
// Zero-dependency (Phoenix #2): Node builtins only, so a room never installs a converter.
// This file ships INSIDE the template on purpose (no run-time fetch from another repo --
// no-external-assumption); it is the one moving part coverage.yml needs that Node lacks.
//
// Usage: node .github/scripts/lcov-to-cobertura.mjs <lcov-in> <cobertura-out> [--root <dir>]
//   --root  the repo root that file paths are made relative to (default: the cwd).
// Exit 1, with a one-line message and no stack, on a missing/unreadable input or an lcov
// holding no source-file records (nothing to report is a loud fact, never an empty green).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Node's lcov reporter writes paths in the platform's own spelling (backslashes on Windows,
// and absolute or relative depending on the version) -- normalize both, then relativize.
function relPath(file, root) {
  let f = file.replace(/\\/g, '/');
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (r && f.toLowerCase().startsWith(r.toLowerCase() + '/')) f = f.slice(r.length + 1);
  return f.replace(/^\.\//, '');
}

/** lcov text -> [{ file, lines: Map<lineNo, hits>, branches: Map<lineNo, {covered, total}> }] */
export function parseLcov(text, root = '') {
  const records = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      cur = { file: relPath(line.slice(3), root), lines: new Map(), branches: new Map() };
    } else if (!cur) {
      continue;
    } else if (line.startsWith('DA:')) {
      const [no, hits] = line.slice(3).split(',');
      const n = Number(no);
      cur.lines.set(n, (cur.lines.get(n) ?? 0) + Number(hits));
    } else if (line.startsWith('BRDA:')) {
      const [no, , , taken] = line.slice(5).split(',');
      const n = Number(no);
      const b = cur.branches.get(n) ?? { covered: 0, total: 0 };
      b.total += 1;
      if (taken !== '-' && Number(taken) > 0) b.covered += 1;
      cur.branches.set(n, b);
    } else if (line === 'end_of_record') {
      records.push(cur);
      cur = null;
    }
  }
  return records;
}

const escapeAttr = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Cobertura rates are fractions; an empty denominator reads 0, never an inflated 1.
const rate = (n, d) => (d === 0 ? '0' : String(Number((n / d).toFixed(4))));

function sums(records) {
  let lc = 0; let lv = 0; let bc = 0; let bv = 0;
  for (const r of records) {
    lv += r.lines.size;
    for (const h of r.lines.values()) if (h > 0) lc += 1;
    for (const b of r.branches.values()) { bv += b.total; bc += b.covered; }
  }
  return { lc, lv, bc, bv };
}

/** records -> Cobertura XML text. `timestamp` is injectable so a test is deterministic. */
export function toCobertura(records, { timestamp = Date.now() } = {}) {
  const byPackage = new Map();
  for (const r of records) {
    const dir = path.posix.dirname(r.file);
    if (!byPackage.has(dir)) byPackage.set(dir, []);
    byPackage.get(dir).push(r);
  }
  const t = sums(records);
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<coverage line-rate="${rate(t.lc, t.lv)}" branch-rate="${rate(t.bc, t.bv)}" lines-covered="${t.lc}" lines-valid="${t.lv}" branches-covered="${t.bc}" branches-valid="${t.bv}" complexity="0" version="1" timestamp="${timestamp}">`);
  out.push('  <sources><source>.</source></sources>');
  out.push('  <packages>');
  for (const [dir, recs] of byPackage) {
    const p = sums(recs);
    out.push(`    <package name="${escapeAttr(dir)}" line-rate="${rate(p.lc, p.lv)}" branch-rate="${rate(p.bc, p.bv)}" complexity="0">`);
    out.push('      <classes>');
    for (const r of recs) {
      const c = sums([r]);
      out.push(`        <class name="${escapeAttr(r.file)}" filename="${escapeAttr(r.file)}" line-rate="${rate(c.lc, c.lv)}" branch-rate="${rate(c.bc, c.bv)}" complexity="0">`);
      out.push('          <lines>');
      for (const no of [...r.lines.keys()].sort((a, b) => a - b)) {
        const b = r.branches.get(no);
        const cc = b ? ` condition-coverage="${Math.round((b.covered / b.total) * 100)}% (${b.covered}/${b.total})"` : '';
        out.push(`            <line number="${no}" hits="${r.lines.get(no)}" branch="${b ? 'true' : 'false'}"${cc}/>`);
      }
      out.push('          </lines>');
      out.push('        </class>');
    }
    out.push('      </classes>');
    out.push('    </package>');
  }
  out.push('  </packages>');
  out.push('</coverage>');
  return out.join('\n') + '\n';
}

function main(argv) {
  const args = argv.slice(2);
  const pos = [];
  let root = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') root = path.resolve(args[++i] ?? '');
    else pos.push(args[i]);
  }
  const [inFile, outFile] = pos;
  if (!inFile || !outFile) {
    console.error('usage: lcov-to-cobertura.mjs <lcov-in> <cobertura-out> [--root <dir>]');
    process.exitCode = 1;
    return;
  }
  let text;
  try {
    text = fs.readFileSync(inFile, 'utf8');
  } catch (e) {
    console.error(`lcov-to-cobertura: cannot read ${inFile} (${e.code ?? e.message}) -- did the coverage run write it?`);
    process.exitCode = 1;
    return;
  }
  const records = parseLcov(text, root);
  if (records.length === 0) {
    console.error(`lcov-to-cobertura: ${inFile} holds no source-file records -- nothing to report.`);
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, toCobertura(records), 'utf8');
  const t = sums(records);
  console.log(`lcov-to-cobertura: ${records.length} file(s), ${t.lc}/${t.lv} lines covered -> ${outFile}`);
}

// Run only as an entry point, never on import (the test imports the two functions above).
const entry = process.argv[1] && path.resolve(process.argv[1]);
if (entry && fs.existsSync(entry) && fs.realpathSync.native(entry) === fs.realpathSync.native(fileURLToPath(import.meta.url))) {
  main(process.argv);
}
