// The child spawn plan of scripts/test.mjs (CWK-199's class). `node --test` spawns one child per test
// file, so the heap cap rides NODE_OPTIONS in the ENV (a --max-old-space-size flag on the argv would cap
// the runner and none of the files it runs; Node 24.19 refuses --test-concurrency inside NODE_OPTIONS, so
// that flag and the clock ride the argv) and the files run one at a time. Zone rule: CoalWorks
// dispatch-transport.md, ninth amendment, "THE GRANDCHILD HALF". A caller's own heap flag is kept as set
// (their cap wins, never doubled); any other NODE_OPTIONS value is kept and the cap appended.
// Same shape as CoalTipple's scripts/lib/test-spawn.mjs (f1c9bf1); no divergence.
//
// TEST_TIMEOUT_MS is the finite clock testing.md asks of every room's test entry (a hung test must fail,
// not hold the runner). Basis, measured 2026-10-08 on this box, serial, one file per child, the box busy
// with other seats: the slowest single test took 10.6 s (secret-scan.test.mjs, "a tag chain longer than
// the bound FAILS CLOSED") and the slowest file 47.7 s wall (secret-scan.test.mjs; next render.test.mjs
// 41.5 s, install.test.mjs 39.5 s); 120 s is about 2.5 times the slowest file and the value CoalTipple,
// CoalHearth and CoalWash use. It is a per-test deadline: a synchronous block (a spawnSync that hangs) is
// cut by that call's own `timeout`, not by this flag.
export const TEST_TIMEOUT_MS = 120000;
export const HEAP_FLAG = '--max-old-space-size=2048';

export function testSpawnPlan(tests, baseEnv) {
  const caller = baseEnv.NODE_OPTIONS || '';
  const nodeOptions = /(^|\s)--max-old-space-size[= ]/.test(caller) ? caller : `${caller} ${HEAP_FLAG}`.trim();
  return { args: ['--test', '--test-concurrency=1', `--test-timeout=${TEST_TIMEOUT_MS}`, ...tests], env: { ...baseEnv, NODE_OPTIONS: nodeOptions } };
}
