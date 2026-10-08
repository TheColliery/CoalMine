// The child spawn plan of scripts/test.mjs (CWK-199's class). `node --test` spawns one child per test file;
// the heap cap rides NODE_OPTIONS in the ENV, which every per-file child inherits AND so does every process a
// test itself spawns (a hook or CLI run with spawnSync(process.execPath)): measured 2026-10-08 on Node 24.19
// (08b INSPECT), the runner also forwards an argv flag to the per-file children, but a process a test spawns
// gets the cap only from the env (2240 MB with the env form, 4288 MB with the flag on the argv). Node 24.19
// refuses --test-concurrency inside NODE_OPTIONS, so that flag, the clock and --test-force-exit ride the argv.
// The files run one at a time. Zone rule: CoalWorks dispatch-transport.md, ninth amendment, "THE GRANDCHILD
// HALF". A caller's own heap flag is kept as set (their cap wins, never doubled); any other NODE_OPTIONS
// value is kept and the cap appended.
//
// NAMED DIVERGENCE FROM THE EXEMPLAR (CoalTipple scripts/lib/test-spawn.mjs, blob 7a8aecf3, f1c9bf1; CoalMine
// 65e98bb was identical to it). This file adds three things, all for one defect (08b INSPECT M-1): a test that
// hangs past --test-timeout is reported failed, but its file's process stays alive while any handle (an
// interval, a server, a child) keeps its event loop running, so the run never ended and the finite clock
// did not bound the run. (1) --test-force-exit on the argv: the runner exits once all known tests have
// finished even if the event loop is still active. (2) RUN_TIMEOUT_MS and RUN_KILL_SIGNAL, a whole-run
// deadline test.mjs puts on its spawnSync, as the backstop for what (1) cannot reach (a test that blocks its
// thread synchronously, where neither the per-test clock nor force-exit can run). (3) the plan carries both,
// so the runner reads them from one place. The exemplar has the same defect (no force-exit, no outer
// timeout on its spawnSync at scripts/test.mjs:65): the same fix is OWED UPWARD to CoalTipple, and to every
// room whose test.mjs copies that shape (ONE FLOCK ONE COLOR (1)), routed by the head, not made here.
//
// TEST_TIMEOUT_MS is the finite clock testing.md asks of every room's test entry (a hung test must fail,
// not hold the runner). Basis, measured 2026-10-08 on this box, serial, one file per child, the box busy
// with other seats: the slowest single test took 10.6 s (secret-scan.test.mjs, "a tag chain longer than
// the bound FAILS CLOSED") and the slowest file 47.7 s wall (secret-scan.test.mjs; next render.test.mjs
// 41.5 s, install.test.mjs 39.5 s); 120 s is about 2.5 times the slowest file and the value CoalTipple,
// CoalHearth and CoalWash use. It is a per-test deadline: a synchronous block (a spawnSync that hangs) is
// cut by that call's own `timeout`, not by this flag.
//
// RUN_TIMEOUT_MS is the whole serial run: 249 s (test.mjs) and 271 s (sum of the 35 files' walls) measured the
// same day on the same busy box, so 600 s is about 2.2 times the longer reading, and stays under the gate
// job's 15-minute timeout-minutes in ci.yml. --test-force-exit is the primary cure and the deadline the last
// resort; each alone ends the planted hangs it covers (measured 2026-10-08, Node 24.19, Windows: with the flag
// removed a handle-leaking run still ended at the deadline, with the deadline removed a hung test still ended).
// Not measured here: Node 22 (the flag is documented from v22.0.0), and macOS or Linux, where the spawnSync
// timeout may leave a file process the runner had started; the CI matrix is that venue.
export const TEST_TIMEOUT_MS = 120000;
export const RUN_TIMEOUT_MS = 600000;
export const RUN_KILL_SIGNAL = 'SIGKILL';
export const HEAP_FLAG = '--max-old-space-size=2048';

export function testSpawnPlan(tests, baseEnv) {
  const caller = baseEnv.NODE_OPTIONS || '';
  const nodeOptions = /(^|\s)--max-old-space-size[= ]/.test(caller) ? caller : `${caller} ${HEAP_FLAG}`.trim();
  return {
    args: ['--test', '--test-concurrency=1', '--test-force-exit', `--test-timeout=${TEST_TIMEOUT_MS}`, ...tests],
    env: { ...baseEnv, NODE_OPTIONS: nodeOptions },
    timeout: RUN_TIMEOUT_MS,
    killSignal: RUN_KILL_SIGNAL,
  };
}
