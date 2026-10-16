#!/usr/bin/env node
// CoalFace machine reading (R18 F1, owner sheet BB-11): admit work by the LIVE CPU/RAM reading at the moment,
// with no count of ours. Run it before a wave: `node <skill dir>/scripts/machine-reading.mjs`.
//   exit 0 = BREATHE (start the wave) · 1 = WAIT (hold it, read again later) · 64 = usage error · 2 = could not read
// Each call is one fresh reading and keeps no state; the caller calls it again before every wave.
//
// It ships INSIDE the skill folder so it travels with the plugin, the claude.ai ZIP and a file-copy install alike.
// Node built-ins only, and nothing imported from outside this folder (Phoenix #2). No --version flag: the version
// lives in .claude-plugin/plugin.json, which this folder does not carry.
//
// Axes (each optional; an axis the machine cannot report is UNMEASURED and never blocks on its own):
//   CPU    busy % from a delta of os.cpus() times over a short sample, judged over the k busiest logical CPUs where
//          k = os.availableParallelism() (the CPUs this process may use; all of them on an unconfined box, so the
//          reading is then the whole-machine mean as before); on Linux, where cgroup v2 cpu.max holds a quota, busy % of
//          that quota from cpu.stat usage_usec over the same sample. The output names the source.
//   memory free % = process.availableMemory() (sees a container limit) over process.constrainedMemory() when that is
//          a real limit, else os.totalmem(). A constrainedMemory of 0, at or above 2**63 (libuv returns UINT64_MAX when a
//          cgroup holds no limit) or above os.totalmem() is NO limit. Where availableMemory is absent (Node before 22.0.0)
//          the axis is UNMEASURED: os.freemem() is never the fallback (on macOS it counts free pages only).
//   All axes unmeasured: BREATHE only with --running 0, so a machine that cannot be read releases one unit at a time.
//   GPU    not read: no portable API. Printed as N/A.
// Thresholds are OURS, not a measurement of any machine; they are flags (--cpu-max, --mem-min) because this folder
// cannot import the config reader. The agent passes the merged .coalface.json values.

import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

export const DEFAULTS = Object.freeze({ cpuMaxPct: 80, memMinPct: 10 });
const SAMPLE_MS = 400; // CPU sample window: long enough to move os.cpus() times, short enough to run before every wave
const EXIT_BREATHE = 0;
const EXIT_WAIT = 1;
const EXIT_USAGE = 64;
const EXIT_ERROR = 2; // the machine could not be read at all: neither BREATHE nor WAIT

const round1 = (n) => Math.round(n * 10) / 10;

// Busy share of the delta between two os.cpus() snapshots. null = unmeasured (empty list, no elapsed time).
// shortcut: every logical CPU counts the same, so on a hybrid box (performance and efficiency cores) the k busiest are
// not weighted by core class; the per-OS core-class read waits for phase 2 (CWK2-025 finding 1) and a hybrid-box measurement.
// usable = os.availableParallelism(): when it is lower than the CPU count the process is confined (an affinity mask, a cpuset),
// the CPUs it may use are not named by os.cpus(), and the whole-machine mean would read the unusable ones as idle room. The
// reading is then the mean over the k busiest CPUs (a confined box whose usable CPUs are saturated reads busy). With usable
// absent, not a positive integer, or at least the CPU count (an unconfined box) it is the whole-machine mean, as before.
export function cpuBusyFromTimes(before, after, usable) {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length === 0 || before.length !== after.length) return null;
  let busy = 0;
  let total = 0;
  const shares = [];
  for (let i = 0; i < before.length; i++) {
    const a = before[i].times;
    const b = after[i].times;
    const sum = (t) => t.user + t.nice + t.sys + t.idle + t.irq;
    const dTotal = sum(b) - sum(a);
    const dIdle = b.idle - a.idle;
    if (!(dTotal >= 0) || !(dIdle >= 0)) return null;
    total += dTotal;
    busy += dTotal - dIdle;
    shares.push(dTotal > 0 ? (dTotal - dIdle) / dTotal : 0);
  }
  if (total <= 0) return null;
  if (Number.isInteger(usable) && usable > 0 && usable < before.length) {
    const top = shares.sort((x, y) => y - x).slice(0, usable);
    return round1((top.reduce((x, y) => x + y, 0) / usable) * 100);
  }
  return round1((busy / total) * 100);
}

// Free memory share from injected readings. avail = process.availableMemory() or null where the runtime has none (UNMEASURED,
// never os.freemem()). constrained = process.constrainedMemory(): a real limit only when it is above 0, below 2**63 and not above
// the machine total (libuv returns UINT64_MAX when a cgroup holds no limit); anything else means "no limit" and total is the denominator.
export function memFreePct({ avail = null, constrained = 0, total = 0 } = {}) {
  if (typeof avail !== 'number' || !Number.isFinite(avail)) return null;
  const limited = constrained > 0 && constrained < 2 ** 63 && constrained <= total;
  const denom = limited ? constrained : total;
  return denom > 0 ? round1(Math.min(100, (avail / denom) * 100)) : null;
}

// Container CPU: cgroup v2 cpu.max ("<quota> <period>" or "max <period>") and two cpu.stat reads. null = no quota
// or unreadable, so the caller uses the host reading.
export function cgroupCpu({ cpuMax, statA, statB, elapsedMs }) {
  if (typeof cpuMax !== 'string' || typeof statA !== 'string' || typeof statB !== 'string') return null;
  const [quotaRaw, periodRaw] = cpuMax.trim().split(/\s+/);
  const quota = Number(quotaRaw);
  const period = Number(periodRaw);
  if (!Number.isFinite(quota) || !(quota > 0) || !(period > 0)) return null;
  const usage = (s) => {
    const m = /^usage_usec\s+(\d+)\s*$/m.exec(s);
    return m ? Number(m[1]) : null;
  };
  const a = usage(statA);
  const b = usage(statB);
  if (a === null || b === null || b < a || !(elapsedMs > 0)) return null;
  const cores = quota / period;
  const busyPct = ((b - a) / (elapsedMs * 1000 * cores)) * 100;
  return { source: 'cgroup', busyPct: round1(Math.min(100, busyPct)) };
}

// PURE decision over injected readings. null on an axis = unmeasured = never blocks. `running` = units the caller
// already holds; with 0 the first unit is admitted regardless of the reading, so a queue can never stick.
export function decide({ cpuBusyPct = null, cpuSource = 'unmeasured', memFreePct = null, running = 0, cpuMaxPct = DEFAULTS.cpuMaxPct, memMinPct = DEFAULTS.memMinPct } = {}) {
  const reasons = [];
  if (cpuBusyPct !== null && cpuBusyPct >= cpuMaxPct) reasons.push(`cpu ${cpuBusyPct}% at or above ${cpuMaxPct}%`);
  if (memFreePct !== null && memFreePct < memMinPct) reasons.push(`mem free ${memFreePct}% below ${memMinPct}%`);
  // Every axis unmeasured releases one unit at a time: a second unit WAITs, the first is admitted by the running-zero rule below.
  if (cpuBusyPct === null && memFreePct === null) reasons.push('every axis unmeasured');
  const over = reasons.length > 0;
  const forced = over && running === 0;
  return {
    verdict: over && !forced ? 'WAIT' : 'BREATHE',
    admittedBy: forced ? 'running-zero' : over ? null : 'reading',
    reasons,
    cpuBusyPct,
    cpuSource,
    memFreePct,
    gpu: 'N/A',
    running,
    thresholds: { cpuMaxPct, memMinPct },
  };
}

export function formatLine(r) {
  const cpu = r.cpuBusyPct === null ? 'cpu unmeasured' : `cpu ${r.cpuBusyPct}% (${r.cpuSource})`;
  const mem = r.memFreePct === null ? 'mem unmeasured' : `mem free ${r.memFreePct}%`;
  // A WAIT names each axis that held and the threshold it crossed (decide() built them); a BREATHE line keeps its shape.
  const tail = r.admittedBy === 'running-zero' ? ' · admitted: running 0' : r.verdict === 'WAIT' && r.reasons.length ? ` · held: ${r.reasons.join('; ')}` : '';
  return `${r.verdict} — ${cpu} · ${mem} · gpu N/A${tail}`;
}

const USAGE = `usage: machine-reading.mjs [--cpu-max N] [--mem-min N] [--running N] [--json]
  Reads this machine's CPU and memory now. Prints BREATHE or WAIT. Exit 0 = BREATHE, 1 = WAIT, 64 = usage error,
  2 = could not read the machine (treat as unmeasured: neither BREATHE nor WAIT).
  --cpu-max N   WAIT when CPU busy is at or above N percent (1-100, default ${DEFAULTS.cpuMaxPct})
  --mem-min N   WAIT when free memory is below N percent (0-99, default ${DEFAULTS.memMinPct})
  --running N   units you already hold (default 0); with 0 the first unit is admitted regardless of the reading
  --json        print the structured reading
  The defaults are ours, not a measurement of your machine. Example: node machine-reading.mjs --cpu-max 70
`;

function intIn(raw, min, max) {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

export function parseArgs(argv) {
  const out = { cpuMaxPct: DEFAULTS.cpuMaxPct, memMinPct: DEFAULTS.memMinPct, running: 0, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--json') out.json = true;
    else if (a === '--cpu-max' || a === '--mem-min' || a === '--running') {
      const [min, max] = a === '--cpu-max' ? [1, 100] : a === '--mem-min' ? [0, 99] : [0, 1e6];
      const n = intIn(argv[++i], min, max);
      if (n === null) return { error: `${a} needs an integer ${min}-${max}` };
      if (a === '--cpu-max') out.cpuMaxPct = n;
      else if (a === '--mem-min') out.memMinPct = n;
      else out.running = n;
    } else return { error: `unknown argument: ${a}` };
  }
  return out;
}

const readText = (p) => {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readLive() {
  const t0 = Date.now();
  const cpusA = os.cpus();
  const cpuMax = os.platform() === 'linux' ? readText('/sys/fs/cgroup/cpu.max') : null;
  const statA = cpuMax ? readText('/sys/fs/cgroup/cpu.stat') : null;
  await sleep(SAMPLE_MS);
  const cpusB = os.cpus();
  const elapsedMs = Date.now() - t0;
  const statB = cpuMax ? readText('/sys/fs/cgroup/cpu.stat') : null;
  const cg = cgroupCpu({ cpuMax, statA, statB, elapsedMs });
  let cpuBusyPct = null;
  let cpuSource = 'unmeasured';
  if (cg) { cpuBusyPct = cg.busyPct; cpuSource = cg.source; } else {
    cpuBusyPct = cpuBusyFromTimes(cpusA, cpusB, typeof os.availableParallelism === 'function' ? os.availableParallelism() : undefined);
    if (cpuBusyPct !== null) cpuSource = 'host';
  }
  const avail = typeof process.availableMemory === 'function' ? process.availableMemory() : null; // absent = UNMEASURED, never os.freemem()
  const constrained = typeof process.constrainedMemory === 'function' ? process.constrainedMemory() : 0;
  return { cpuBusyPct, cpuSource, memFreePct: memFreePct({ avail, constrained, total: os.totalmem() }) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    process.stderr.write(`machine-reading: ${args.error}\n${USAGE}`);
    process.exitCode = EXIT_USAGE;
    return;
  }
  if (args.help) {
    process.stdout.write(`machine-reading — admit by the live CPU/RAM reading\n${USAGE}`);
    return;
  }
  const r = decide({ ...(await readLive()), running: args.running, cpuMaxPct: args.cpuMaxPct, memMinPct: args.memMinPct });
  process.stdout.write(args.json ? `${JSON.stringify(r)}\n` : `${formatLine(r)}\n`);
  process.exitCode = r.verdict === 'BREATHE' ? EXIT_BREATHE : EXIT_WAIT;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    process.stderr.write(`machine-reading: could not read this machine (${e && e.code ? e.code : 'error'}). Re-run it, or report at github.com/TheColliery/CoalFace/issues.\n`);
    process.exitCode = EXIT_ERROR;
  });
}
