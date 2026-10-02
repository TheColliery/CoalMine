// R14 / CWK-180: the plugin folder ships a README (the directory refuses a plugin folder without one of 40+ words,
// and it is the listing's text). It is authored at plugin-src/README.md, copied by build-plugin.mjs, and gated by verify.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const words = (s) => s.split(/\s+/).filter(Boolean).length;

test('plugin/README.md is the build of plugin-src/README.md and has at least 40 words', () => {
  const src = fs.readFileSync(path.join(repo, 'plugin-src', 'README.md'), 'utf8');
  const dist = fs.readFileSync(path.join(repo, 'plugin', 'README.md'), 'utf8');
  assert.equal(dist.replace(/\r\n/g, '\n'), src.replace(/\r\n/g, '\n'));
  assert.ok(words(dist) >= 40, `${words(dist)} words`);
});

test('the plugin README names every shipped hook, at least three example uses, the issue tracker, and claims no directory listing', () => {
  const md = fs.readFileSync(path.join(repo, 'plugin', 'README.md'), 'utf8');
  const hooks = JSON.parse(fs.readFileSync(path.join(repo, 'hooks', 'hooks.json'), 'utf8'));
  const names = new Set();
  for (const groups of Object.values(hooks.hooks)) for (const g of groups) for (const h of g.hooks) names.add(/hooks\/([a-z-]+)\.js/.exec(h.command)[1]);
  assert.equal(names.size, 3);
  for (const n of names) assert.ok(md.includes('`' + n + '`'), `names the ${n} hook`);
  const examples = md.split('## Example uses')[1].split('\n## ')[0].split('\n').filter((l) => /^\d+\. /.test(l));
  assert.ok(examples.length >= 3, `${examples.length} example uses`);
  // Parse each URL and compare host and path (a substring test of an unparsed URL is what CodeQL js/incomplete-url-substring-sanitization refuses).
  const urls = (md.match(/https:\/\/[^\s<>)\]]+/g) || []).map((u) => new URL(u));
  assert.ok(urls.some((u) => u.hostname === 'github.com' && u.pathname === '/TheColliery/CoalMine/issues'), 'names the issue tracker');
  assert.ok(!/anthropic'?s? (plugin )?directory|listed in anthropic/i.test(md), 'no claim of being listed (LAW-WAVES P-ANTHROPIC-3)');
});

test('verify.mjs fails a tree whose plugin/README.md is missing, stale, or under 40 words', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-plugin-readme-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const skip = new Set(['.git', 'scratchpad', '.claude', 'node_modules', 'dist-claude-ai']);
  fs.cpSync(repo, dir, { recursive: true, filter: (src) => !skip.has(path.basename(src)) });
  const run = () => spawnSync(process.execPath, [path.join(dir, 'scripts', 'verify.mjs')], {
    cwd: dir, encoding: 'utf8', timeout: 110000, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048', TEMP: dir, TMP: dir, TMPDIR: dir },
  });
  assert.equal(run().status, 0, 'control: the copied tree verifies clean');
  const dist = path.join(dir, 'plugin', 'README.md');
  const good = fs.readFileSync(dist, 'utf8');
  fs.rmSync(dist);
  let r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /plugin\/README\.md missing/);
  fs.writeFileSync(dist, good + '\nextra line\n');
  r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /plugin\/README\.md STALE/);
  fs.writeFileSync(path.join(dir, 'plugin-src', 'README.md'), 'Too short.\n');
  fs.writeFileSync(dist, 'Too short.\n');
  r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /under 40 words/);
});
