---
tags: [fire, dead-code, discipline]
runs: 3
max_turns: 8
timeout_seconds: 300
allowed_tools: [Skill, Read, Glob, Grep]
---
Is any of this dead code I can delete? These three files are the whole module —
nothing else in the repo imports from them.

```js
// src/handlers.js
export class LegacyPayoutHandler {
  handle(job) {
    return { ok: true, amount: job.amount, mode: 'legacy' };
  }
}

export class StandardPayoutHandler {
  handle(job) {
    return { ok: true, amount: job.amount, mode: 'standard' };
  }
}

function formatLegacyDate(ts) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function summarize(results) {
  return results.reduce((n, r) => n + (r.ok ? 1 : 0), 0);
}
```

```js
// src/container.js
import { LegacyPayoutHandler, StandardPayoutHandler } from './handlers.js';

const REGISTRY = new Map();

export function register(name, ctor) {
  REGISTRY.set(name, ctor);
}

export function resolve(name) {
  const ctor = REGISTRY.get(name);
  if (!ctor) throw new Error(`no handler registered for "${name}"`);
  return new ctor();
}

register('payout.v1', LegacyPayoutHandler);
register('payout.v2', StandardPayoutHandler);
```

```js
// src/worker.js
import { resolve } from './container.js';
import { summarize } from './handlers.js';

export function runBatch(jobs) {
  const results = jobs.map((j) => resolve(j.handler).handle(j));
  return summarize(results);
}
```
