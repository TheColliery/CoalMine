// The spawn plan of scripts/test.mjs (CWK-199's class, rebuilt at 09a around the canon wave runner). test.mjs enumerates the roster and guards it in both
// directions; the RUNNING is scripts/lib/wave-run.mjs (adopted by blob id, BB-87): one `node --test --test-reporter=tap` child per file, the next admitted only
// while a fresh reading of the machine says BREATHE (the first always runs), under the heap cap, a clock per test, an optional wall clock per file, and a
// whole-run deadline that kills the tree. This file holds this room's NUMBERS and builds that command line; it runs nothing.
//
// WHAT 08b SHIPPED AND WHAT BECAME OF EACH PIECE (the order of 09a asked for the disposition of every one):
//  - --test-force-exit: FOLDED. wave-run passes it to every child itself, and puts stdout-sync.mjs in front of the child so a force-exit on a POSIX pipe no longer
//    loses the tail of the report (CoalHearth's CI, measured 2026-10-08). A test that hangs past its clock, or a file that leaks a handle, still ends and still reads as it did.
//  - the 600 s whole-run deadline: FOLDED into wave-run's --deadline-ms (RUN_TIMEOUT_MS here). A file the deadline kills is FAIL with the reason, a file it never reached is NOT-RUN,
//    and the run is red; both are named in wave-run's summary. The spawnSync `timeout` test.mjs puts on the wave-run process stays, as the outer backstop for wave-run ITSELF
//    hanging (OUTER_TIMEOUT_MS: the deadline, plus the wait wave-run allows its killed children, plus a grace).
//  - --test-concurrency=1: RETIRED. It was one file at a time because the box could not be read; the live reading (machine-reading.mjs, CoalFace's file) now decides how many
//    files run together, which is the owner's wave rule (AGENTS.md THE MACHINE BOUND), and wave-run starts exactly one `node --test` per file, so the flag has nothing left to bound.
//  - the heap cap in the env: FOLDED. wave-run's --heap-mb puts it on NODE_OPTIONS of every child, so every process a test itself spawns inherits it (a caller's own heap flag is kept).
//
// NAMED DIVERGENCE FROM THE EXEMPLAR (CoalTipple scripts/lib/test-spawn.mjs, blob 7a8aecf3): the exemplar builds a `node --test` argv; this builds a wave-run argv. The 08b defect
// it fixed (a hung test whose file process stayed alive, so the finite clock did not bound the run) is closed by wave-run itself, not by this file.
//
// TEST_TIMEOUT_MS is the finite clock testing.md asks of every room's test entry. Basis, measured 2026-10-08 on this box, serial, the box busy with other seats: the slowest single
// test took 10.6 s (secret-scan.test.mjs, "a tag chain longer than the bound FAILS CLOSED") and the slowest file 47.7 s wall (secret-scan.test.mjs; next render.test.mjs 41.5 s,
// install.test.mjs 39.5 s). 120 s is about 2.5 times the slowest file. A synchronous block is cut by that call's own `timeout`, not by this flag.
// FILE_CLOCK_MS is the wall clock of ONE file, the clock that reaches a hang before the file's first test (which --test-timeout never does). Waves put several files on the box at once,
// so a file's wall can be longer than its serial 47.7 s. 240 s (the 2026-10-08 figure) was sized from one box; it was cut on CI, so FILE_CLOCK_MS is now sized from the
// runner (29ix, 2026-11-18). CI READINGS, Node 22, commit a58bfcc, the slowest file of each leg (run ids and job ids of CI run 44351624973, attempt 1, and its re-run,
// attempt 2, the same commit): Windows secret-gate.test.mjs 232,811 ms (job 134968603135) and 129,501 ms (job 134974365263); macOS 176,370 ms (job 134968603003)
// and 139,744 ms (job 134974365136); Ubuntu 217,782 ms (job 134968603263) and 181,522 ms (job 134974365053). Other repos, same runner class, from their CI runs:
// CoalBoard macOS 224.9 s, CoalLedger Windows 187.8 s. 420 s holds 1.8 times the largest reading held here (232.8 s) and 1.87 times CoalBoard's macOS reading; the
// gate job's 15-minute timeout and this whole-run deadline (600 s) stay above it.
// RUN_TIMEOUT_MS is the whole run: the serial suite took 249 s (test.mjs) and 271 s (sum of the files' walls) on the same busy box, waves finish sooner, and 600 s stays under the gate job's
// 15-minute timeout-minutes in ci.yml.
export const HEAP_MB = 2048;
export const TEST_TIMEOUT_MS = 120000;
export const FILE_CLOCK_MS = 420000;
export const RUN_TIMEOUT_MS = 600000;
export const OUTER_GRACE_MS = 30000;
export const OUTER_TIMEOUT_MS = RUN_TIMEOUT_MS + TEST_TIMEOUT_MS + OUTER_GRACE_MS;
export const RUN_KILL_SIGNAL = 'SIGKILL';
export const TEST_RUN = 'scripts/lib/test-run.mjs';
// The canon wave runner the room's runner calls (test-run.mjs); the plan no longer starts it directly.
export const WAVE_RUN = 'scripts/lib/wave-run.mjs';

// THE NODE 22 MAPPING (the head's ruling, the c113 bounce of 2026-11-18, on the CI cut measured in CoalMine jobs 134464623316 and 134467705581). On Node 22
// --test-timeout clocks the WHOLE FILE, so the per-test value of 120 s cut the file at 120 s: tests 1 to 44 of secret-gate.test.mjs took about 44 s, then test 45
// ("wide text past the decode bound") ran at least about 77 s (five gate runs over a 9 MiB blob) before the clock ended the file. The same cut hit the older blob
// in CoalLedger (fc9dc14, job 133162505764), so returning to an older blob is no fix. The cut test is canon: its cost is couriered upward to the canon owner, never
// edited in this room. The flag therefore carries FILE_CLOCK_MS on Node 22 (the file clock this room already holds) and TEST_TIMEOUT_MS on Node 24 and later. The
// boundary is "before Node 24", not "Node 22 exactly": a line before 24 clocks the whole file too, and no such line is in the matrix.
export function fileTimeoutFlagMs(nodeMajor) {
  return nodeMajor < 24 ? FILE_CLOCK_MS : TEST_TIMEOUT_MS;
}

export function testSpawnPlan(tests, baseEnv, nodeMajor = Number(process.versions.node.split('.')[0])) {
  return {
    args: [TEST_RUN, '--heap-mb', String(HEAP_MB), '--file-timeout-ms', String(fileTimeoutFlagMs(nodeMajor)), '--deadline-ms', String(RUN_TIMEOUT_MS), '--file-clock-ms', String(FILE_CLOCK_MS), '--', ...tests],
    env: { ...baseEnv },
    timeout: OUTER_TIMEOUT_MS,
    killSignal: RUN_KILL_SIGNAL,
  };
}
