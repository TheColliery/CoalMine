// CWK-133 -- gitEnv() strips the whole GIT_* family and pins the ceiling, and a fixture
// `git init` under an ambient ABSOLUTE GIT_DIR leaves the repository that GIT_DIR names
// untouched. Zero-dep (node:test + built-ins). Fixtures under os.tmpdir(), removed by t.after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitEnv } from './git-env.mjs';

function withEnv(t, vars) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; process.env[k] = v; }
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}

test('gitEnv: strips every GIT_-prefixed key, whatever the name, and keeps the rest', (t) => {
  withEnv(t, { GIT_DIR: '/somewhere/.git', GIT_INDEX_FILE: '/somewhere/.git/index', GIT_SOME_FUTURE_KEY: 'x', CWK133_PLAIN: 'kept' });
  const env = gitEnv('/ceiling');
  for (const key of Object.keys(env)) {
    assert.ok(!key.startsWith('GIT_') || key === 'GIT_CEILING_DIRECTORIES', `${key} survived the strip`);
  }
  assert.equal(env.CWK133_PLAIN, 'kept', 'a non-GIT_ key passes through unchanged');
  assert.equal(env.GIT_CEILING_DIRECTORIES, '/ceiling');
});

test('gitEnv: returns a copy -- editing it never touches process.env', (t) => {
  withEnv(t, { GIT_DIR: '/original' });
  const env = gitEnv('/ceiling');
  env.GIT_DIR = '/poisoned';
  assert.equal(process.env.GIT_DIR, '/original');
});

function gitAvailable() {
  return spawnSync('git', ['--version'], { encoding: 'utf8', env: gitEnv(os.tmpdir()) }).status === 0;
}

// THE PROPERTY (red-first): plant an ABSOLUTE GIT_DIR that names a sandbox repository,
// run a fixture init the way this room's tests now do, and read the sandbox's config
// back BYTE-FOR-BYTE. Before CWK-133 the fixture spawns spread process.env; the same
// init then re-initialised the planted repository (measured red, build note R8 item 4).
test('CWK-133: a fixture git init under an ambient ABSOLUTE GIT_DIR leaves the planted repository untouched', (t) => {
  if (!gitAvailable()) { t.skip('git binary not available'); return; }
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cwk133-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const victim = path.join(base, 'victim');
  const fixture = path.join(base, 'fixture');
  fs.mkdirSync(victim);
  fs.mkdirSync(fixture);
  assert.equal(spawnSync('git', ['init', '-q', '.'], { cwd: victim, env: gitEnv(base) }).status, 0, 'fixture sanity: the victim repository exists');
  const victimConfig = path.join(victim, '.git', 'config');
  const before = fs.readFileSync(victimConfig);

  withEnv(t, { GIT_DIR: path.join(victim, '.git') }); // what a linked-worktree hook exports
  const r = spawnSync('git', ['init', '-q', '.'], { cwd: fixture, env: gitEnv(base) });

  assert.equal(r.status, 0, `the fixture init itself must succeed: ${r.stderr}`);
  assert.deepEqual(fs.readFileSync(victimConfig), before, 'the planted repository config must be byte-identical');
  assert.ok(fs.existsSync(path.join(fixture, '.git')), 'the fixture got its OWN .git');
});
