<!-- coalmine: verified 2026-06-12 · revalidate 90d · definition file for resilience-audit -->
# Resilience audit — concrete detection procedures

## 1. External I/O — what to grep
| Stack | Missing timeout looks like | Right shape |
|---|---|---|
| TS/JS | bare `fetch(url)` / axios without `timeout` | `AbortSignal.timeout(ms)` / axios `timeout` |
| C# | `HttpClient` with default (100 s) timeout in hot paths | per-request `CancellationTokenSource` |
| Python | `requests.get(url)` with no `timeout=` (waits forever) | explicit `timeout=(connect, read)` |
| Go | `http.Get` (no deadline) | `http.Client{Timeout}` / `context.WithTimeout` |
Retry without backoff/jitter or without a max-attempts bound = finding (retry storms). Rate-limit responses (429) swallowed as generic errors = finding.

## 2. Storage — atomicity
- Safe write idiom: write temp file → fsync → rename over target. Direct `writeFile(target)` on data the app must not lose = finding (crash mid-write corrupts).
- Error path must clean partial output; the previous good copy must survive failure (never delete-then-write).

## 3. Partial completion
- Any loop over N items that catches per-item errors and then reports unconditional success = CRITICAL ("extracted 50/100, said done").
- Right shape: count failures, surface `n/N (k failed)`, non-zero exit / failure status on k>0.

## 4. Crash / restart idempotency
- Re-running the operation after a kill must not duplicate effects (payments, sends, appends). Look for: append-without-dedup, missing idempotency keys on external calls, half-state files without a journal/marker.

## 5. Concurrency
- Two instances racing on the same file/row: look for check-then-act gaps (`existsSync` → `writeFile`), missing locks/transactions, TOCTOU on temp paths.

## 6. Input boundary
- Malformed/huge/truncated input at every parse site: `JSON.parse` without try, unbounded `readFile` of attacker-sized payloads, missing schema validation at process edges. Fail fast with the exact reason; never half-apply.

## 7. Dependency down
- For each external service: what happens on ECONNREFUSED? Acceptable answers: cached fallback, graceful degrade, clear error. Unacceptable: hang, retry-forever, silent empty result presented as truth.

## 8. Resource exhaustion
- Unbounded queues/buffers fed by external input; connections acquired without release on the error path; missing backpressure on producers.

## The four-question check (every failure point)
Detected? (code notices, doesn't swallow) · Handled? (retry/fallback/fail-clean) · Recoverable? (rollback/idempotent, no data loss) · Communicated? (clear error to user AND log — never a false "done").
