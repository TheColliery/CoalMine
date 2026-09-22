---
tags: [fire, silent-failure]
runs: 3
max_turns: 8
timeout_seconds: 300
allowed_tools: [Skill, Read, Glob, Grep]
---
Do a code-health pass over this module before I ship it. It is the guard that
proves our two rule trees have not drifted apart.

```js
// scripts/lib/mirror-check.mjs
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const TREES = ['.claude/rules', '.agents/rules'];

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function listRules(root) {
  try {
    return readdirSync(root, { recursive: true }).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

export function checkMirrors(repoRoot) {
  const findings = [];
  const present = TREES.filter((t) => isDir(join(repoRoot, t)));
  if (present.length < 2) return findings; // only one tree here: nothing to mirror

  const [a, b] = present.map((t) => new Set(listRules(join(repoRoot, t))));
  for (const f of a) if (!b.has(f)) findings.push(`UNMIRRORED ${f}`);
  for (const f of b) if (!a.has(f)) findings.push(`UNMIRRORED ${f}`);
  return findings;
}

export function report(repoRoot) {
  const findings = checkMirrors(repoRoot);
  if (findings.length === 0) console.log('PASS: the two rule trees agree');
  else findings.forEach((f) => console.log(f));
  return findings.length === 0 ? 0 : 1;
}
```
