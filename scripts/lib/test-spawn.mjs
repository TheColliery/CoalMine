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
// so a file's wall can be longer than its serial 47.7 s; 240 s is about five times it and twice the per-test clock.
// RUN_TIMEOUT_MS is the whole run: the serial suite took 249 s (test.mjs) and 271 s (sum of the files' walls) on the same busy box, waves finish sooner, and 600 s stays under the gate job's
// 15-minute timeout-minutes in ci.yml.
export const HEAP_MB = 2048;
export const TEST_TIMEOUT_MS = 120000;
export const FILE_CLOCK_MS = 240000;
export const RUN_TIMEOUT_MS = 600000;
export const OUTER_GRACE_MS = 30000;
export const OUTER_TIMEOUT_MS = RUN_TIMEOUT_MS + TEST_TIMEOUT_MS + OUTER_GRACE_MS;
export const RUN_KILL_SIGNAL = 'SIGKILL';
export const WAVE_RUN = 'scripts/lib/wave-run.mjs';

// ONE FILE RUNS OUTSIDE THE WAVES (09a, a courier for the canon): wave-run.test.mjs, the wave runner's own test. Under wave-run every child gets NODE_OPTIONS=--import stdout-sync.mjs,
// and that file's test "the stdout preload switches BOTH pipes ... (a recorder loaded first sees the two calls)" spawns a node with its own recorder AFTER that preload, so the
// recorder sees no setBlocking call and the test fails: measured, plain node --test 34 pass 0 fail; the same file with NODE_OPTIONS=--import <stdout-sync url> 33 pass 1 fail.
// The file is the canon's byte for byte and is not edited here, so it is run by the plain node --test line below (heap cap in the env, files serial, force-exit, a clock per test,
// the whole-run deadline), the 08b plan unchanged. It is therefore judged by its exit code and pass count, not by wave-run's TAP-names reading; wave-run's own VACUOUS reading is
// proven end to end in test-spawn.test.mjs, and the canon should make that test hermetic to NODE_OPTIONS (returned to the chief).
export const OUTSIDE_WAVES = ['scripts/lib/wave-run.test.mjs'];
export const HEAP_FLAG = '--max-old-space-size=' + HEAP_MB;

export function plainSpawnPlan(tests, baseEnv) {
  const caller = baseEnv.NODE_OPTIONS || '';
  const nodeOptions = /(^|\s)--max-old-space-size[= ]/.test(caller) ? caller : `${caller} ${HEAP_FLAG}`.trim();
  return {
    args: ['--test', '--test-concurrency=1', '--test-force-exit', `--test-timeout=${TEST_TIMEOUT_MS}`, ...tests],
    env: { ...baseEnv, NODE_OPTIONS: nodeOptions },
    timeout: RUN_TIMEOUT_MS,
    killSignal: RUN_KILL_SIGNAL,
  };
}

export function testSpawnPlan(tests, baseEnv) {
  return {
    args: [WAVE_RUN, '--heap-mb', String(HEAP_MB), '--file-timeout-ms', String(TEST_TIMEOUT_MS), '--deadline-ms', String(RUN_TIMEOUT_MS), '--file-clock-ms', String(FILE_CLOCK_MS), '--', ...tests],
    env: { ...baseEnv },
    timeout: OUTER_TIMEOUT_MS,
    killSignal: RUN_KILL_SIGNAL,
  };
}
