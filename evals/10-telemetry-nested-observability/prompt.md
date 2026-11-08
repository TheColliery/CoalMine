---
tags: [fire, telemetry, sensitive-data-in-logs, nested-observability]
runs: 3
max_turns: 8
timeout_seconds: 300
allowed_tools: [Skill, Read, Glob, Grep]
---
Telemetry audit on this Worker before we ship it. Anything in it we should fix first?

```jsonc
// wrangler.jsonc
{
  "name": "intake-worker",
  "main": "src/index.js",
  "compatibility_date": "2026-10-01",
  "observability": { "logs": { "enabled": true } }
}
```

```js
// src/index.js
export default {
  async fetch(request) {
    console.log(await request.text());
    return new Response('ok');
  },
};
```
