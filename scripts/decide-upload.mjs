#!/usr/bin/env node
// UMB-163's --clobber-only-on-first-run fix. Reads the SHA256SUMS.txt already on the Release
// (if the workflow's check of the Release's assets found one) and the fresh one this
// run just built, decides upload-clobber / skip / fail, and PRINTS the action on its own line
// so the workflow's bash step can branch on it (`ACTION=$(node scripts/decide-upload.mjs ...)`)
// -- never on the exit code alone, since "fail" and "a script crashed" must read differently
// in the log even though both are non-zero.
//
// Usage: node decide-upload.mjs <fresh-sums-path> [existing-sums-path]
// The existing path is OPTIONAL and, when given, may legitimately not exist: the workflow's check lists the
// Release's assets first and downloads SHA256SUMS.txt only when it is there, so a missing file means "no prior
// SHA256SUMS.txt", never "the lookup failed" (a failed lookup fails that step before this script runs, 14h).
import fs from 'node:fs';
import { decideUpload } from './lib/asset-upload-mode.mjs';

function main() {
  const [freshPath, existingPath] = process.argv.slice(2);
  if (!freshPath) {
    console.error('decide-upload: usage: node decide-upload.mjs <fresh-sums-path> [existing-sums-path]');
    process.exitCode = 2;
    return;
  }
  let fresh;
  try {
    fresh = fs.readFileSync(freshPath, 'utf8');
  } catch (e) {
    console.error(`decide-upload: could not read the freshly built ${freshPath}: ${e.message}`);
    process.exitCode = 2;
    return;
  }
  const existing = existingPath && fs.existsSync(existingPath) ? fs.readFileSync(existingPath, 'utf8') : null;

  const { action, reason } = decideUpload(existing, fresh);
  console.error(`decide-upload: ${action} -- ${reason}`);
  console.log(action);
  if (action === 'fail') process.exitCode = 1;
}

main();
