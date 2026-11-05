// Debug hatch collector (CWK3-007 stage 1, c61). Synced into the Stop hook ONLY, below its 'debug-hatch' region (hatchDir, HATCH_FILE, HATCH_OLD)
// and its 'node-config' region (readCfgFile). Each file has its own try, and the whole swallows: a collector that throws must never take the
// host down (Phoenix #4). It removes the hatch's own two files once they are older than tempSweepStaleDays in the GLOBAL config (7 unless set).
// It runs whether COALMINE_DEBUG is set or not, and it never depends on the temp folder or the canary's mode: sweepStale calls it first.
// The days are read only once a file is found, so a machine with no hatch file pays no config read.
// A project file arrives with a clone, so it has no say over a file in the user's home (hooks-safety.md §9, a removal edge): global value, else the factory 7.
function hatchStaleDays() {
  const cfg = readCfgFile(path.join(os.homedir(), '.claude', '.coalmine.json'), null);
  const v = cfg && cfg.tempSweepStaleDays;
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.floor(v)) : 7;
}
function sweepHatch() {
  try {
    const dir = hatchDir();
    let staleMs = null;
    for (const name of [HATCH_FILE, HATCH_OLD]) {
      try {
        const file = path.join(dir, name);
        const st = fs.lstatSync(file);
        if (!st.isFile()) continue; // a link or a folder is not the hatch's file: leave it
        if (staleMs === null) staleMs = hatchStaleDays() * 24 * 60 * 60 * 1000;
        if (Date.now() - st.mtimeMs > staleMs) fs.unlinkSync(file);
      } catch { /* this file stays; the other one is still tried */ }
    }
  } catch { /* the collector never throws */ }
}
