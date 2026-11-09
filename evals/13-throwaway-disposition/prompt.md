---
tags: [fire, rot-canary, disposition]
runs: 3
max_turns: 8
timeout_seconds: 300
allowed_tools: [Skill, Read, Glob, Grep]
---
Code-health check on this small project before we ship it. Anything in it we should fix first?

```js
// index.mjs
import { parseLine } from './lib/util.mjs';

console.log(parseLine('a=1'));
```

```js
// lib/util.mjs
export function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {}
  return null;
}
```

```js
// scratch/probe-once.mjs
try {
  JSON.parse(process.argv[2]);
} catch {}
```
