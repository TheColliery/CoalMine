import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectAssetsToPrune } from './release-prune.mjs';

const rel = (tag_name, published_at, opts = {}) => ({
  tag_name, published_at, prerelease: false, draft: false,
  assets: [{ id: `${tag_name}-zip`, name: 'CoalMine.zip' }, { id: `${tag_name}-sums`, name: 'SHA256SUMS.txt' }],
  ...opts,
});

test('selectAssetsToPrune: keeps the newest stable + one previous (N=2), prunes ZIP + SHA256SUMS on everything older', () => {
  const releases = [
    rel('v3.20.0', '2026-09-21T00:00:00Z'),
    rel('v3.19.0', '2026-09-19T00:00:00Z'),
    rel('v3.18.3', '2026-09-10T00:00:00Z'),
    rel('v3.18.2', '2026-09-01T00:00:00Z'),
  ];
  const { keptReleases, assetsToDelete } = selectAssetsToPrune(releases, 2);
  assert.deepEqual(keptReleases, ['v3.20.0', 'v3.19.0']);
  assert.deepEqual(assetsToDelete.map((a) => a.tag_name).sort(), ['v3.18.2', 'v3.18.2', 'v3.18.3', 'v3.18.3']);
  assert.ok(assetsToDelete.every((a) => a.name === 'CoalMine.zip' || a.name === 'SHA256SUMS.txt'));
});

test('selectAssetsToPrune: input order does not matter -- sorted by published_at, not array position', () => {
  const releases = [
    rel('v1.0.0', '2026-01-01T00:00:00Z'),
    rel('v3.0.0', '2026-09-01T00:00:00Z'),
    rel('v2.0.0', '2026-06-01T00:00:00Z'),
  ];
  const { keptReleases } = selectAssetsToPrune(releases, 2);
  assert.deepEqual(keptReleases, ['v3.0.0', 'v2.0.0']);
});

test('selectAssetsToPrune: pre-release and draft releases are never counted as "stable" and never pruned', () => {
  const releases = [
    rel('v1.0.0-beta.1', '2026-01-01T00:00:00Z', { prerelease: true }),
    rel('v1.0.0', '2026-01-05T00:00:00Z'),
    rel('v0.9.0', '2025-12-01T00:00:00Z', { draft: true }),
  ];
  const { keptReleases, assetsToDelete } = selectAssetsToPrune(releases, 2);
  assert.deepEqual(keptReleases, ['v1.0.0']);
  assert.deepEqual(assetsToDelete, [], 'only one real stable release exists -- nothing older to prune, and the beta/draft rows must not be treated as prunable stock');
});

test('selectAssetsToPrune: an asset that is neither a .zip nor SHA256SUMS.txt is left alone even on an older stable release', () => {
  const releases = [
    rel('v2.0.0', '2026-02-01T00:00:00Z'),
    rel('v1.0.0', '2026-01-01T00:00:00Z'),
    { tag_name: 'v0.9.0', published_at: '2025-12-01T00:00:00Z', prerelease: false, draft: false, assets: [{ id: 'x', name: 'MIGRATION.md' }] },
  ];
  const { assetsToDelete } = selectAssetsToPrune(releases, 2);
  assert.deepEqual(assetsToDelete, [], 'MIGRATION.md is not a prunable name');
});

test('selectAssetsToPrune: fewer stable releases than `keep` -- keeps them all, prunes nothing', () => {
  const releases = [rel('v1.0.0', '2026-01-01T00:00:00Z')];
  const { keptReleases, assetsToDelete } = selectAssetsToPrune(releases, 2);
  assert.deepEqual(keptReleases, ['v1.0.0']);
  assert.deepEqual(assetsToDelete, []);
});

test('selectAssetsToPrune: an older stable release with no assets at all produces no delete entries (not a crash)', () => {
  const releases = [
    rel('v2.0.0', '2026-02-01T00:00:00Z'),
    rel('v1.0.0', '2026-01-01T00:00:00Z'),
    { tag_name: 'v0.9.0', published_at: '2025-12-01T00:00:00Z', prerelease: false, draft: false, assets: [] },
  ];
  const { assetsToDelete } = selectAssetsToPrune(releases, 2);
  assert.deepEqual(assetsToDelete, []);
});
