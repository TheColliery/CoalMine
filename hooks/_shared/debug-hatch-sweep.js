// Debug hatch collector (CWK3-007 stage 1, c61). Synced into the Stop hook ONLY, below its 'debug-hatch' region, which it reads:
// hatchDir, HATCH_FILE and HATCH_OLD. It also calls getTempSweepStaleDays, which the Stop hook defines. Wholly inside one try/catch
// that swallows: a collector that throws must never take the host down (Phoenix #4). It removes the hatch's own two files once they are
// older than the stale window, so a hatch switched off, or a machine that once ran with it on, still ends up collected.
// It runs whether COALMINE_DEBUG is set or not, and it never depends on the temp folder or the canary's mode: sweepStale calls it first.
// The days are read only once a file is found, so a machine with no hatch file pays no config read.
function sweepHatch() {
  try {
    const dir = hatchDir();
    let staleMs = null;
    for (const name of [HATCH_FILE, HATCH_OLD]) {
      const file = path.join(dir, name);
      let st;
      try { st = fs.lstatSync(file); } catch { continue; } // absent: next
      if (!st.isFile()) continue; // a link or a folder is not the hatch's file: leave it
      if (staleMs === null) staleMs = getTempSweepStaleDays() * 24 * 60 * 60 * 1000;
      if (Date.now() - st.mtimeMs > staleMs) fs.unlinkSync(file);
    }
  } catch { /* the collector never throws */ }
}
