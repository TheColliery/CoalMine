// UMB-163's own named divergence, closed here: "--clobber only on the first run of a tag" --
// before this, `gh release upload ... --clobber` ran unconditionally on every invocation
// (including a workflow_dispatch re-run), silently overwriting whatever a prior run had
// already published. A published version is immutable (RELEASE-PATTERN.md): once a ZIP is on
// a tag's Release, it must never SILENTLY become a different ZIP.
//
// Pure decision, no network -- fed the SHA256SUMS.txt already on the Release (or null if this
// is genuinely the first run for the tag) and the fresh one this run just built.
export function decideUpload(existingSums, freshSums) {
  if (existingSums === null) return { action: 'upload-clobber', reason: 'no prior SHA256SUMS.txt on this Release -- nothing to clobber, this is the first run for the tag' };
  if (existingSums === freshSums) return { action: 'skip', reason: 'a fresh rebuild matches what is already published byte-for-byte -- an idempotent re-run (e.g. a workflow_dispatch retry), nothing to upload' };
  return { action: 'fail', reason: 'a fresh rebuild of this tag differs from what is already published -- a published version must never change after the fact; investigate before forcing an overwrite' };
}
