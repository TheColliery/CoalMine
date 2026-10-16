#!/usr/bin/env node
// UMB-163 step 2's EXECUTOR. NOTHING here runs unless a room's own head has opted in: the
// workflow's own `if:` already gates the step on `vars.PRUNE_OLD_RELEASE_ZIPS == 'true'`
// (a per-repo GitHub Actions variable, off by default, an owner/head UI click), and this file
// checks the SAME flag again itself -- defense in depth, never trust one gate alone for a
// destructive action. Deletes ONLY the assets `release-prune.mjs`'s pure selection names
// (a .zip or SHA256SUMS.txt on a stable Release older than the newest + one previous, N=2,
// signed 2026-09-21) -- the Release record and the tag are NEVER touched by this file; it
// calls no endpoint that could touch either.
//
// Needs GITHUB_TOKEN (contents: write -- the same permission the calling job already holds
// to create the Release and upload assets) and GITHUB_REPOSITORY ("owner/repo"), both standard
// GitHub Actions environment variables -- never invented ad hoc.
import { pathToFileURL } from 'node:url';
import { selectAssetsToPrune } from './lib/release-prune.mjs';

const API = 'https://api.github.com';
const PER_PAGE = 100;
const MAX_PAGES = 50; // 5,000 Releases: a repository past this is refused, never read halfway

// Every page until a SHORT one (the last page may be exactly full: the next is then empty and ends the read). A pager that stopped at a fixed page count handed the selection a list missing
// Releases, and a destructive step that reasons over "the older stable Releases" must never reason over a partial list (14h, CoalFace #9 = CoalLedger #7): at the cap on a full page this FAILS.
export async function listReleases(repo, token, fetchFn = fetch, maxPages = MAX_PAGES) {
  const releases = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await fetchFn(`${API}/repos/${repo}/releases?per_page=${PER_PAGE}&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`GET releases page ${page} -> HTTP ${r.status}`);
    const body = await r.json();
    if (!Array.isArray(body)) throw new Error(`GET releases page ${page} returned something that is not a list`);
    releases.push(...body);
    if (body.length < PER_PAGE) return releases;
  }
  throw new Error(`the Releases list is still full at page ${maxPages} (${releases.length} read): refusing to prune from a list that may be missing Releases`);
}

async function deleteAsset(repo, token, id) {
  const r = await fetch(`${API}/repos/${repo}/releases/assets/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  return r.status === 204;
}

async function main() {
  if (process.env.PRUNE_OLD_RELEASE_ZIPS !== 'true') {
    console.log('prune-release-zips: PRUNE_OLD_RELEASE_ZIPS is not "true" -- flag off, nothing pruned');
    return;
  }
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    console.error('prune-release-zips: GITHUB_TOKEN and GITHUB_REPOSITORY must both be set');
    process.exitCode = 1;
    return;
  }

  const releases = await listReleases(repo, token);
  const { keptReleases, assetsToDelete } = selectAssetsToPrune(releases, 2);
  console.log(`prune-release-zips: keeping assets on ${keptReleases.join(', ') || '(no stable releases found)'}`);
  if (assetsToDelete.length === 0) {
    console.log('prune-release-zips: nothing to prune');
    return;
  }

  let failed = 0;
  for (const a of assetsToDelete) {
    const ok = await deleteAsset(repo, token, a.id);
    console.log(`prune-release-zips: ${ok ? 'deleted' : 'FAILED to delete'} ${a.name} on ${a.tag_name}`);
    if (!ok) failed++;
  }
  if (failed > 0) {
    console.error(`prune-release-zips: ${failed} of ${assetsToDelete.length} deletion(s) failed`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`prune-release-zips: ${e.message}`);
    process.exitCode = 1;
  });
}
