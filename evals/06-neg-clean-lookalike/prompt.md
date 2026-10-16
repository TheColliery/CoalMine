---
tags: [negative, false-positive]
runs: 3
max_turns: 8
timeout_seconds: 300
allowed_tools: [Skill, Read, Glob, Grep]
---
Code-health scan on this file, please.

```js
// scripts/lib/rules.mjs
import { readdirSync, lstatSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';

function isDir(p) {
  try {
    return lstatSync(p).isDirectory();
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return false;
    throw err; // could-not-tell is not knows-it-is-absent
  }
}

function listRules(root) {
  try {
    return readdirSync(root, { recursive: true }).filter((f) => f.endsWith('.md'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// Public entry point. Called by bin/rules.mjs, never from inside this file.
export function collect(repoRoot, trees) {
  const seen = new Set();
  for (const t of trees) {
    const dir = join(repoRoot, t);
    if (!isDir(dir)) continue;
    for (const f of listRules(dir)) seen.add(`${t}/${f}`);
  }
  return [...seen].sort();
}

export function firstN(items, n) {
  const out = [];
  for (let i = 0; i <= items.length - 1 && out.length < n; i++) out.push(items[i]);
  return out;
}

export function withHandle(path, fn) {
  const h = openSync(path, 'r');
  try {
    return fn(h);
  } finally {
    closeSync(h);
  }
}
```
