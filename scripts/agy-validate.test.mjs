// 27b: the shipped plugin must load every agent under Antigravity's own loader. agy 1.4.8 reads the YAML
// frontmatter of plugin/agents/*.md and refuses a `tools` field written as a comma string ("cannot unmarshal
// !!str ... into []string. The loader skips this agent"), so components.agents reads 0. The validator is the
// reader that matters, so the check runs agy's own `plugin validate` on the BUILT dist, never a regex over the
// frontmatter. agy is probed, not decided by platform: where it is not on PATH the test skips VISIBLY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { probeAgy } from './lib/agy-probe.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = path.join(repo, 'plugin');
const AGY_TIMEOUT_MS = 120000;

test('agy validate: the built plugin has no error finding and its agent loads', (t) => {
  // Skip ONLY when agy is absent; a probe that hangs or fails is a failure (27b round 2).
  const probe = probeAgy({ timeoutMs: AGY_TIMEOUT_MS });
  if (probe.state === 'absent') { t.skip('agy not on PATH: AG plugin validation not run'); return; }
  assert.equal(probe.state, 'present', `agy probe failed (not a skip): ${probe.reason}`);

  const r = spawnSync('agy', ['plugin', 'validate', PLUGIN, '--json'], { encoding: 'utf8', timeout: AGY_TIMEOUT_MS });
  assert.equal(r.error, undefined, `agy plugin validate did not run: ${r.error && r.error.code}`);

  let report;
  try { report = JSON.parse(r.stdout); } catch (e) {
    assert.fail(`agy plugin validate printed no JSON report (exit ${r.status}): ${e.message}\n${r.stdout}\n${r.stderr}`);
  }

  const errors = (report.findings || []).filter((f) => f.severity === 'error');
  assert.deepEqual(
    errors.map((f) => `${f.file}: ${f.message}`), [],
    'agy reports error findings on the built plugin',
  );
  assert.ok(report.components.agents >= 1, `agy loads no agent (components.agents = ${report.components.agents})`);
});
