// agy runs under a temp HOME, never the owner's real profile (28c item c). agy writes .gemini/config
// under HOME, so the probe run and the validate run must each receive an env whose HOME and temp
// variables point at a temp root; LOCALAPPDATA and APPDATA stay as they are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeAgy, validateAgyPlugin, agyEnv } from './agy-probe.mjs';

function tempHome(t) {
  const home = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-agyhome-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

test('agyEnv points HOME and the temp variables at the given root and keeps the app-data variables', () => {
  const base = { HOME: '/real/home', USERPROFILE: '/real/home', TEMP: '/real/tmp', LOCALAPPDATA: 'L', APPDATA: 'A', PATH: 'p' };
  const env = agyEnv('/tmp/root', base);
  for (const k of ['HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR']) assert.equal(env[k], '/tmp/root', k);
  assert.equal(env.LOCALAPPDATA, 'L');
  assert.equal(env.APPDATA, 'A');
  assert.equal(env.PATH, 'p');
});

test('agy probe: the probe spawn receives the temp-HOME env, not the inherited one', (t) => {
  const home = tempHome(t);
  const seen = [];
  const spy = (cmd, args, opts) => { seen.push(opts); return { status: 0, error: undefined, stdout: '', stderr: '' }; };
  probeAgy({ env: agyEnv(home), timeoutMs: 1000, spawn: spy });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].env && seen[0].env.HOME, home, 'the probe run must carry the temp HOME');
});

test('agy validate: the validate spawn receives the temp-HOME env, not the inherited one', (t) => {
  const home = tempHome(t);
  const seen = [];
  const spy = (cmd, args, opts) => { seen.push(opts); return { status: 0, error: undefined, stdout: '{}', stderr: '' }; };
  validateAgyPlugin({ pluginDir: '/x', env: agyEnv(home), timeoutMs: 1000, spawn: spy });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].env && seen[0].env.HOME, home, 'the validate run must carry the temp HOME');
  assert.equal(seen[0].env && seen[0].env.USERPROFILE, home, 'USERPROFILE is redirected too');
});
