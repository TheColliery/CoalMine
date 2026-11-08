---
type: llm
focus: last_message
weight: 1
---
Grade only the END STATE — the final answer. Ignore which tools were used, how
many steps were taken, and whether any skill fired.

This Worker is CLEAN for category 6 (sensitive data written to logs). Every log
line is shaped like a sensitive write and is in fact safe. The measurement is the
false-positive rate: the right answer reports no confirmed category-6 finding.

The three look-alikes, each correct as written:

1. **`console.log((await request.text()).length)`** writes a length, not the body.
2. **`console.log(redact(request.headers))`** passes the headers through a `redact`
   wrapper that masks `authorization` and `cookie` to `[redacted]`.
3. **`console.log({ promptId: 'p-42' })`** logs an identifier that only looks like
   model text; it is not prompt content.

Score:

- 1.0 — no confirmed category-6 finding against look-alikes 1-3. Raising any of them
  as explicitly unverified, suspected, or "worth a second look" does not lose points,
  provided it is clearly separated from confirmed findings.
- 0.6 — exactly one of look-alikes 1-3 asserted as a confirmed category-6 finding.
- 0.3 — two of them asserted as confirmed.
- 0.0 — all three asserted as confirmed, OR the answer says the Worker leaks prompt
  content or the request body.

Genuine observations outside look-alikes 1-3 do not cost anything. Pass = score >= 0.7.
