---
tags: [fire, input-security, severity-ordering]
runs: 3
max_turns: 8
timeout_seconds: 300
allowed_tools: [Skill, Read, Glob, Grep]
---
Review this for anything that could bite us in production. `name` comes straight
off an HTTP query string.

```js
// server/files.js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'public';

// Reads a file from the public asset root. Rejects anything outside ROOT.
export function readAsset(name) {
  const full = join(ROOT, name);
  return readFileSync(full, 'utf8');
}

export function tail(lines, n) {
  const out = [];
  for (let i = lines.length - n; i <= lines.length; i++) {
    out.push(lines[i]);
  }
  return out;
}
```
