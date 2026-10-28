// verify.mjs reads the project .coalmine.json through the same byte bound configure.mjs and the hooks use (28c item a).
// A file one byte over MAX_CONFIG_BYTES is refused by name, before the strip and the parse, instead of being read whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MAX_CONFIG_BYTES } from './repo-fs.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('verify.mjs: a .coalmine.json one byte over the bound is refused by name, not read whole', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-verify-bound-'));
  try {
    for (const d of ['skills', 'plugin', 'scripts', '.claude-plugin', 'hooks', 'agents', 'commands', 'alt', 'plugin-src']) {
      fs.cpSync(path.join(repo, d), path.join(tmp, d), { recursive: true });
    }
    // A valid-looking object padded past the bound: the only thing wrong with it is its size.
    const pad = 'a'.repeat(MAX_CONFIG_BYTES);
    fs.writeFileSync(path.join(tmp, '.coalmine.json'), `{"x":"${pad}"}`);
    const r = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'verify.mjs')], { encoding: 'utf8' });
    assert.equal(r.status, 1, 'an over-bound config is a FAIL');
    assert.ok(r.stdout.includes(`of at most ${MAX_CONFIG_BYTES} bytes`), `the refusal names the bound:\n${r.stdout}`);
    assert.ok(!r.stdout.includes('unrecognized keys'), 'the over-bound file is not parsed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
