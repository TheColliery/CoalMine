#!/usr/bin/env node
// test-run.mjs -- this room's run of its node test roster, through the canon wave runner (scripts/lib/wave-run.mjs, adopted by blob and never edited here).
//
//   node scripts/lib/test-run.mjs --heap-mb N --file-timeout-ms N --deadline-ms N [--file-clock-ms N] [--] <test files...>
//
// WHY THIS FILE EXISTS (29ix, c116, 2026-11-18): wave-run's own CLI prints the files that did NOT pass and no wall time at all, so the CI gate log could not show how
// long each file took, and the per-file clock (test-spawn.mjs FILE_CLOCK_MS) could only be sized from one box's serial run. This runner calls runWaves() with the same
// numbers and prints, as each file ends, `file <path> <ms> ms <STATUS>` for EVERY file (a PASS included), then the lines wave-run prints: FAIL / VACUOUS / NOT-RUN
// with their reasons, one SKIPPED line per skipped test, and the one summary line. Its exit code is wave-run's: 0 green, 1 red, 64 usage.
//
// Node builtins and the canon's own exports only (Phoenix #2). It runs nothing that wave-run would not run.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runWaves, skippedLines, STATUS } from './wave-run.mjs';

const EXIT_USAGE = 64;
const USAGE = `usage: test-run.mjs --heap-mb N --file-timeout-ms N --deadline-ms N [--file-clock-ms N] [--] <test files...>
  Runs each file through the wave runner and prints \`file <path> <ms> ms <STATUS>\` for every file, then the failing lines and the summary. Exit 0 green, 1 red, 64 usage.
`;
const NUMBER_FLAGS = { '--heap-mb': 'heapMb', '--file-timeout-ms': 'fileTimeoutMs', '--deadline-ms': 'deadlineMs', '--file-clock-ms': 'fileClockMs' };

// The argument list, read as the room's flags. Any flag this runner does not know is a usage error, never ignored.
export function parseRunArgs(argv) {
  const out = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out.files.push(...argv.slice(i + 1)); break; }
    if (a in NUMBER_FLAGS) {
      const raw = argv[++i];
      if (!/^[1-9]\d*$/.test(raw ?? '')) throw new Error(`${a} needs a positive whole number`);
      out[NUMBER_FLAGS[a]] = Number(raw);
    } else if (a.startsWith('-')) throw new Error(`unknown argument: ${a}`);
    else out.files.push(a);
  }
  for (const k of ['heapMb', 'fileTimeoutMs', 'deadlineMs']) {
    if (out[k] === undefined) throw new Error(`--${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())} is required: the room's numbers, and a run with no finite clock is refused`);
  }
  if (out.files.length === 0) throw new Error('no test files were given');
  return out;
}

// The line for one finished file. The time is the wall clock from its start to its end, rounded to whole milliseconds.
export const fileTimeLine = (file, ms, status) => `file ${file} ${Math.round(ms)} ms ${status}`;

async function main() {
  let args;
  try { args = parseRunArgs(process.argv.slice(2)); } catch (e) {
    process.stderr.write(`test-run: ${e.message}\n${USAGE}`);
    process.exitCode = EXIT_USAGE;
    return;
  }
  const started = new Map();
  let run;
  try {
    run = await runWaves({
      ...args,
      cwd: process.cwd(),
      env: process.env,
      onEvent: (ev) => {
        if (ev.type === 'start') started.set(ev.file, performance.now());
        if (ev.type === 'exit') {
          const t0 = started.get(ev.file);
          const ms = t0 === undefined ? 0 : performance.now() - t0;
          process.stdout.write(`${fileTimeLine(ev.file, ms, ev.status)}\n`);
        }
      },
    });
  } catch (e) {
    process.stderr.write(`test-run: ${e.message}\n`);
    process.exitCode = 2;
    return;
  }
  for (const r of run.results) {
    if (r.status === STATUS.PASS || r.status === STATUS.SKIP) continue;
    process.stdout.write(`${r.status} ${r.name}: ${r.reason}\n`);
    if (r.stdout || r.stderr) process.stderr.write(`--- ${r.name} (${r.status}) ---\n${r.stdout ?? ''}${r.stderr ?? ''}\n`);
  }
  for (const line of skippedLines(run.results)) process.stdout.write(`${line}\n`);
  process.stdout.write(`${run.summary.line}\n`);
  process.exitCode = run.exitCode;
}

// Run as the entry file only, compared by REAL path (a temp folder can be a symlink: macOS /var is /private/var), so a test that imports parseRunArgs or fileTimeLine starts no run.
function isEntry() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync.native(fileURLToPath(import.meta.url)) === fs.realpathSync.native(process.argv[1]); } catch { return false; }
}
if (isEntry()) {
  main().catch((e) => {
    process.stderr.write(`test-run: crashed (${e && e.message ? e.message : 'error'})\n`);
    process.exitCode = 2;
  });
}
