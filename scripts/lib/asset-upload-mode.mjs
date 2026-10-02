// UMB-163's own named divergence, closed here: "--clobber only on the first run of a tag" --
// before this, `gh release upload ... --clobber` ran unconditionally on every invocation
// (including a workflow_dispatch re-run), silently overwriting whatever a prior run had
// already published. A published version is immutable (RELEASE-PATTERN.md): once a ZIP is on
// a tag's Release, it must never SILENTLY become a different ZIP.
//
// Pure decision, no network -- fed the SHA256SUMS.txt already on the Release (or null if this
// is genuinely the first run for the tag) and the fresh one this run just built.
//
// UMB-182 M1, MEASURED (CoalFace rehearsal leg c+, run 35760645457): `zip -r` stores entry mtimes,
// so a rebuild NEVER matches the published SHA256SUMS.txt. A re-run of a tag whose assets are
// already published therefore always ends at `fail` -- and that red is the SAFE outcome, the one
// this design keeps: nothing is overwritten, and a fully published tag has nothing left for a re-run
// to do. `skip` stays for a rebuild that genuinely is byte-identical (reproducible zips would make
// it reachable; that cure is a pending decision tied to the prune step, AR-62). A run that died
// BEFORE SHA256SUMS.txt was uploaded (it uploads last) finds no prior file and uploads normally.
export function decideUpload(existingSums, freshSums) {
  if (existingSums === null) return { action: 'upload-clobber', reason: 'no prior SHA256SUMS.txt on this Release -- nothing to clobber, this is the first run for the tag' };
  if (existingSums === freshSums) return { action: 'skip', reason: 'a fresh rebuild matches what is already published byte-for-byte, nothing to upload' };
  return { action: 'fail', reason: 'a fresh rebuild of this tag differs from what is already published, and nothing was overwritten. Expected on a re-run of an already-published tag: zip stores file mtimes, so a rebuild never matches. A published version must never change after the fact; if this was not a re-run, investigate before forcing an overwrite' };
}
