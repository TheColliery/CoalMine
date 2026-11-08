---
tags: [negative, false-positive]
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
    console.log((await request.text()).length);
    console.log(redact(request.headers));
    console.log({ promptId: 'p-42' });
    return new Response('ok');
  },
};

function redact(headers) {
  const out = {};
  for (const [k, v] of headers) out[k] = /authorization|cookie/i.test(k) ? '[redacted]' : v;
  return out;
}
```
