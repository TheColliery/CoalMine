---
tags: [fire, telemetry, sensitive-data-in-logs]
runs: 3
max_turns: 8
timeout_seconds: 300
allowed_tools: [Skill, Read, Glob, Grep]
---
Telemetry audit on this Worker before we ship it. Anything in it we should fix first?

```toml
# wrangler.toml
name = "intake-worker"
main = "src/index.js"
compatibility_date = "2026-10-01"

[observability]
enabled = true
```

```js
// src/index.js
export default {
  async fetch(request) {
    console.log(await request.text());
    console.log(request.headers.get('Authorization'));
    return new Response('ok');
  },
};
```
