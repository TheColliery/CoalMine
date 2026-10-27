// 27b round 2 (rot-canary MEDIUM, scripts/agy-validate.test.mjs): the agy probe SKIPS only when agy is absent.
// A probe that hangs, or that fails in any other way, must FAIL the caller, never read as a named absence.
// The forced failures run process.execPath (a real child that hangs or exits non-zero), so no fake agy is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeAgy } from './agy-probe.mjs';

test('agy probe: a command that is not on PATH is absent, so the caller skips', () => {
  const p = probeAgy({ command: 'no-such-binary-27b-agy-probe', timeoutMs: 20000 });
  assert.equal(p.state, 'absent');
});

test('agy probe: a probe that hangs past its timeout FAILS and names ETIMEDOUT, never reads as absent', () => {
  const p = probeAgy({ command: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'], timeoutMs: 300 });
  assert.equal(p.state, 'failed');
  assert.match(p.reason, /ETIMEDOUT/);
});

test('agy probe: an agy that exits non-zero on --version FAILS and names the exit code', () => {
  const p = probeAgy({ command: process.execPath, args: ['-e', 'process.exit(3)'], timeoutMs: 20000 });
  assert.equal(p.state, 'failed');
  assert.match(p.reason, /exited 3/);
});

test('agy probe: a runnable agy that exits 0 is present', () => {
  const p = probeAgy({ command: process.execPath, args: ['--version'], timeoutMs: 20000 });
  assert.equal(p.state, 'present');
});
