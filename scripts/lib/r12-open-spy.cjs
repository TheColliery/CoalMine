// R12 test preload (CodeQL #74-#79): a --require shim a test hands to a spawned hook through
// NODE_OPTIONS (test-sandbox.mjs withHomeReporter). It wraps fs.openSync on the
// shared default export -- the same object the hook's own `require('fs')` returns -- and acts
// ONLY on the one path named by CM_SPY_TARGET, so nothing else the hook does is touched.
//   CM_SPY_LOG   -- append one line per event: "open <n> fd=<fd>" / "open <n> threw=<code>"
//   CM_SPY_SWAP  -- "fifo000": on the Nth open of the target, N = CM_SPY_SWAP_AT (default 2; the conductor reads the config twice, so the refusal probe whose reason it REPORTS is the 4th open,
//                   after readRepoFileBounded's own in each pair), first replace the target with a mode-0 FIFO,
//                   i.e. a non-file swapped in AFTER the path checks and BEFORE the open.
// Not shipped: scripts/lib is outside build-plugin.mjs's copy list.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const target = process.env.CM_SPY_TARGET;
const log = process.env.CM_SPY_LOG;
const swap = process.env.CM_SPY_SWAP;
if (target && log) {
  const norm = (p) => { try { return path.resolve(String(p)); } catch { return ''; } };
  const want = norm(target);
  const out = (line) => { try { fs.appendFileSync(log, line + '\n'); } catch {} };
  const origOpen = fs.openSync;
  let opens = 0;
  fs.openSync = function (p, ...rest) {
    if (norm(p) !== want) return origOpen.call(this, p, ...rest);
    opens++;
    if (swap === 'fifo000' && opens === Number(process.env.CM_SPY_SWAP_AT || 2)) {
      fs.unlinkSync(target);
      if (spawnSync('mkfifo', [target]).status !== 0) throw new Error('mkfifo failed');
      fs.chmodSync(target, 0);
    }
    try {
      const fd = origOpen.call(this, p, ...rest);
      out(`open ${opens} fd=${fd}`);
      return fd;
    } catch (e) {
      out(`open ${opens} threw=${e.code}`);
      throw e;
    }
  };
}
