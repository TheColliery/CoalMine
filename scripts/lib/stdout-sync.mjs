// stdout-sync.mjs -- a preload (`node --import <this file>`, put on NODE_OPTIONS by wave-run.mjs) that makes a piped stdout and stderr BLOCKING, so a process that ends with
// process.exit() loses none of what it has written (CoalHearth's measured fix, 3531c02; carried into the canon on 2026-10-09, 08d D2).
//
// WHY: `node --test --test-force-exit` ends the test file's process with process.exit() as soon as its tests are done. The file process reports its results to the runner over its
// stdout, a pipe. Node makes that pipe BLOCKING on Windows only (lib/net.js: "Make stdout and stderr blocking on Windows"); on POSIX the pipe is a non-blocking libuv handle, and
// whatever the kernel buffer (64 KiB on Linux) could not take yet is queued in user space, where process.exit() discards it. The runner then counts fewer tests than the file ran,
// silently: exit 0, no error. The Linux and macOS legs of CoalHearth's CI showed it (counts below their floors that differed from leg to leg, the missing names always the LAST
// ones of the file); Windows never showed it, so the defect was invisible on the machine that wrote the runner. A runner that judged the exit code could not see it at all, which
// means a lost `not ok` event could read as green.
//
// WHAT: switch the two streams to blocking when they are pipes (a TTY and a file are synchronous already). On Windows this repeats what Node did; elsewhere it is the whole fix.
// Every node process of the run inherits it, the runner's own process included, so its report to the reader is covered too. Best effort: never throws, prints nothing.
for (const stream of [process.stdout, process.stderr]) {
  try {
    if (stream && stream._type === 'pipe' && stream._handle && typeof stream._handle.setBlocking === 'function') stream._handle.setBlocking(true);
  } catch { /* best effort: a stream that refuses stays as it was */ }
}
