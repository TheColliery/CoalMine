// Guard-rail tests only. The actual list-releases/delete-asset calls are a real externality
// (the GitHub API) that testing.md's own Test Doubles rule says to mock only when you can't
// run in-process at all -- here we simply never reach them: both cases below return/exit
// before any network call happens, so the test proves that WITHOUT touching the network
// (never a fake, since there is nothing safe to fake a delete call into).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prune-release-zips.mjs');

function run(env) {
  // Strip any ambient GITHUB_TOKEN/GITHUB_REPOSITORY from the real environment (this test may
  // run inside a workflow that has them) so each case controls its own inputs exactly.
  const clean = { ...process.env };
  delete clean.PRUNE_OLD_RELEASE_ZIPS;
  delete clean.GITHUB_TOKEN;
  delete clean.GITHUB_REPOSITORY;
  return spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { ...clean, ...env } });
}

test('prune-release-zips.mjs: flag unset -- exit 0, "flag off" message, no attempt to reach the network', () => {
  const res = run({});
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /flag off, nothing pruned/);
});

test('prune-release-zips.mjs: flag set to anything other than the literal "true" is still off (e.g. "1", "TRUE")', () => {
  for (const v of ['1', 'TRUE', 'yes']) {
    const res = run({ PRUNE_OLD_RELEASE_ZIPS: v });
    assert.equal(res.status, 0, `value "${v}": ${res.stderr}`);
    assert.match(res.stdout, /flag off/);
  }
});

test('prune-release-zips.mjs: flag on but GITHUB_TOKEN/GITHUB_REPOSITORY missing -- fails loud, exit 1, never reaches the network', () => {
  const res = run({ PRUNE_OLD_RELEASE_ZIPS: 'true' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /GITHUB_TOKEN and GITHUB_REPOSITORY must both be set/);
});
