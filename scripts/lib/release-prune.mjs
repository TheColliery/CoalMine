// UMB-163 (signed 2026-09-21, "ใช่ เก็บ 2 ล็อกเลย" -- N=2): which release ZIP assets a
// stable-tag push should prune. Pure SELECTION logic only -- no network call lives here, so
// the decision is unit-testable without touching the GitHub API. The executor
// (prune-release-zips.mjs) makes the actual DELETE calls, and only when a room has opted in
// (the flag is checked in the workflow's `if:`, not here) -- nothing in this file, or in the
// executor it feeds, runs unprompted.
//
// Keeps: the assets of the LATEST stable release plus ONE previous stable release -- the
// rollback a user who updated and broke can take without a rebuild. Everything else: the
// Release record and the tag are NEVER touched (history is evidence, the red-run law's own
// shape); only an asset named like a claude.ai ZIP or its digest file is a candidate -- a room
// that attaches something else to an old Release keeps it untouched.

const PRUNABLE_NAME = /\.zip$|^SHA256SUMS\.txt$/;

// releases: the array `GET /repos/{o}/{r}/releases` returns (or a same-shaped fixture) --
// each a {tag_name, prerelease, draft, published_at, assets: [{id, name}]} object.
// Returns { keptReleases: [tag_name, ...], assetsToDelete: [{tag_name, id, name}, ...] }.
export function selectAssetsToPrune(releases, keep = 2) {
  const stable = releases
    .filter((r) => !r.prerelease && !r.draft)
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  const keptReleases = stable.slice(0, keep).map((r) => r.tag_name);
  const olderStable = stable.slice(keep);
  const assetsToDelete = [];
  for (const r of olderStable) {
    for (const a of r.assets || []) {
      if (PRUNABLE_NAME.test(a.name)) assetsToDelete.push({ tag_name: r.tag_name, id: a.id, name: a.name });
    }
  }
  return { keptReleases, assetsToDelete };
}
