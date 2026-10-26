#!/usr/bin/env node
// CoalMine self-consistency check (on-demand) — the mechanical half of the
// "don't trust your own non-code artifacts" layer.
//
//   node scripts/consistency.mjs                 → check this repo; the doctrine-mirror check
//                                                  compares the rule homes it can resolve
//   node scripts/consistency.mjs --base <dir>    → compare the rule homes under <dir>
//
// Verifies cross-document facts agree, doctrine mirrors are byte-identical, and
// every rule stamp is well-formed. Fail-loud (exit 1) per scripts-quality.md.
// The semantic half — a memory/rule prescription that contradicts a Commandment
// or a recorded decision — is caught by the gold-standard RE-VALIDATE pass, not
// here, because it has no canonical baseline to diff against.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAll, resolveMirrorBase, hasRuleHome, MIRROR_ROOTS } from './lib/consistency.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = [
  'Usage: node scripts/consistency.mjs [--base <dir>]',
  '  (no flag)     check this repo. The doctrine-mirror check compares the rule homes it resolves:',
  '                the cwd when the cwd holds one, else the repo, else its parent.',
  '  --base <dir>  compare the rule homes under <dir>. Fails loud when neither home is there.',
  '  -h, --help    print this usage and exit 0.',
  'Report a problem: https://github.com/TheColliery/CoalMine/issues',
].join('\n');

// Returns { help: true } | { error } | { base: string | null }. base is the value of --base, resolved.
function parseArgs(argv) {
  let base = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return { help: true };
    if (a === '--base') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('-')) return { error: '--base needs a directory' };
      base = path.resolve(v);
      i++;
    } else {
      return { error: `unknown option ${a}` };
    }
  }
  return { base };
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) { console.log(USAGE); return 0; }
  if (parsed.error) { console.error(`consistency: ${parsed.error}\n${USAGE}`); return 1; }

  // The mirror base: an explicit --base, else the cwd when the cwd holds a rule home (an umbrella
  // run), else null, which is today's default (the repo, or its parent, via resolveMirrorBase).
  const cwd = process.cwd();
  const chosen = parsed.base !== null ? parsed.base : (hasRuleHome(cwd) ? cwd : null);

  // A chosen base with NO rule home compares nothing. That is a FAIL, never a PASS over zero files.
  const extra = [];
  if (chosen !== null && !hasRuleHome(chosen)) {
    extra.push({ level: 'FAIL', msg: `consistency: no rule home under ${chosen} (looked for ${MIRROR_ROOTS.join(' and ')}); nothing to compare` });
  }

  // A crash is rendered as a finding rather than a second exit path: one output shape,
  // and the process exits NATURALLY on its exit code — `process.exit()` can truncate a
  // pending stdout write (node/runtime.md §7), which on a gate would silently drop the
  // very FAIL lines it exists to print.
  let findings;
  try {
    findings = [...extra, ...checkAll(repo, chosen !== null ? { mirrorBase: chosen } : {})];
  } catch (e) {
    findings = [...extra, { level: 'FAIL', msg: `consistency check crashed: ${e.message}` }];
  }

  if (findings.length === 0) {
    // Scope-honest wording: the mirror check compares the rule homes that EXIST at the
    // base it chose — a base with neither home compares nothing, and that case is a FAIL
    // above. A PASS names the base, so it never reads as "checked" when the real answer
    // is "nothing was there to check".
    //
    // The widened clause below deliberately does NOT say "this repo carries neither tree"
    // (2026-07-31 RE-INSPECT, MEDIUM) — under the M2 `hasBoth` ruling, widening happens
    // whenever repo lacks a COMPLETE pair, i.e. ZERO **or ONE** tree; the reachable case is
    // the exact M2 stray-tree scenario `hasBoth` exists to catch, so a line claiming "no
    // tree here" would deny the very tree the ruling was written to ignore. It also does
    // NOT say "its parent does" (the matching LOW from the same round) — the parent only
    // needs to satisfy `hasEither`, so it too may hold just one tree; whether anything was
    // actually compared there is exactly what "an absent counterpart is not compared"
    // already says, without asserting a completeness neither side is guaranteed to have.
    const mirrorBase = chosen !== null ? chosen : resolveMirrorBase(repo);
    const mirrorNote = chosen !== null
      ? `doctrine mirrors agree across the rule homes present at ${mirrorBase} (an absent rule home is not compared)`
      : mirrorBase === repo
        ? 'doctrine mirrors agree across the rule homes present in this repo (an absent rule home is not compared)'
        : `doctrine mirrors agree across the rule homes present at ${mirrorBase} (this repo does not carry a complete local pair, so the check widened there; an absent counterpart at that base is not compared)`;
    // L2 (2026-07-31 INSPECT): checkRuleStamps has the IDENTICAL vacuity as the mirror
    // check had before C1 — it always reads `repo` as-is (never resolveMirrorBase; that
    // is a separate, named-not-fixed gap, see consistency.mjs's checkAll comment) and
    // CoalMine carries neither `.claude/rules` nor `.agents/rules`, so it always scans
    // zero files. "stamps agree" was the same false-coverage claim the mirror clause
    // above was rewritten to stop making — say so, rather than fix the root this round.
    const hasStampHome = ['.claude/rules', '.agents/rules'].some((r) => fs.existsSync(path.join(repo, r)));
    const stampsNote = hasStampHome
      ? 'every rule stamp in this repo is well-formed'
      : 'no rule-stamp home exists in this repo to scan (stamps unchecked here)';
    console.log(`CONSISTENCY: PASS — cross-document facts agree; ${stampsNote}; ${mirrorNote}.`);
    return 0;
  }
  for (const f of findings) console.log(`  ${f.level}  ${f.msg}`);
  console.log('\nCONSISTENCY: FAIL');
  return 1;
}

process.exitCode = main(process.argv.slice(2));
