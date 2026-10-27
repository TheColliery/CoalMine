// 27b round 2 (rot-canary MEDIUM, scripts/agy-validate.test.mjs): the agy probe SKIPS only when agy is absent.
// A probe that hangs, or that fails in any other way, must FAIL the caller, never read as a named absence.
// The forced failures run process.execPath (a real child that hangs or exits non-zero), so no fake agy is needed.
// 27c F5: a PATH holding only an agy.cmd shim is absent, and its reason names the shim (a shell-less spawn cannot run a .cmd);
// a probe with no timeoutMs gets the named default, never an unbounded wait.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeAgy, DEFAULT_PROBE_TIMEOUT_MS } from './agy-probe.mjs';

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

test('agy probe: a PATH holding only an agy.cmd is absent, and the reason names that shim', (t) => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-agyshim-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'agy.cmd'), '@echo off\r\n');
  const saved = { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT };
  t.after(() => {
    process.env.PATH = saved.PATH;
    if (saved.PATHEXT === undefined) delete process.env.PATHEXT; else process.env.PATHEXT = saved.PATHEXT;
  });
  process.env.PATH = dir;
  process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
  const p = probeAgy({ timeoutMs: 20000 });
  assert.equal(p.state, 'absent');
  assert.match(p.reason, /agy\.cmd/);
});

test('agy probe: no timeoutMs passes the named default to the spawn, never an unbounded wait', () => {
  assert.equal(typeof DEFAULT_PROBE_TIMEOUT_MS, 'number');
  let seen;
  const fake = (cmd, args, opts) => { seen = opts; return { status: 0, error: undefined, stderr: '' }; };
  const p = probeAgy({ command: 'agy', spawn: fake });
  assert.equal(p.state, 'present');
  assert.equal(seen.timeout, DEFAULT_PROBE_TIMEOUT_MS);
});
