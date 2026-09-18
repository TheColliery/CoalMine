---
name: telemetry-canary
description: >-
  Observability and structured logging canary — checks for structured logs (JSON), OpenTelemetry metrics/traces, proper error stack traces, and flags empty catches or silent log swallowing. Triggers on keywords: "/telemetry-canary", "telemetry-canary", "observability audit", "structured logging". Use when adding or changing logging, metrics, tracing, or error-handling code.
---

# Telemetry Canary (Observability & Logging Audit)

<!-- SHARED:LANGUAGE_HEADER -->

Audit code for proper telemetry instrumentation — ensure the app is not a black box in production.

## Auditing Categories
1. **Empty / Silent Catch** — catch blocks that swallow exceptions without logging a stack trace or forwarding the error.
2. **Unstructured Logs** — plain-string logging in server code (prefer JSON / structured key-value for cloud queries).
3. **No Correlation ID** — operations crossing boundaries (HTTP/gRPC/threads) without propagating a trace/correlation ID.
4. **Missing Metrics** — critical transactions (checkout, auth, errors) lacking counter/histogram instrumentation.
5. **No Stack Traces** — errors logged without stack context (`logger.error(e.message)` instead of `logger.error(e)`).

Per-stack grep patterns and right/wrong shapes per category: read `references/checks.md` before scanning.

## Fix mode (choice-gated)

In Agent Context, after the report, present via `ask_question`:

- **Apply safe logs:** insert error logging into empty catch blocks (standard logger template) + stack-trace mapping. Each fix: checkpoint (git stash/commit in a git repo; else copy the file aside — never assume git) → apply → build + tests → auto-revert if newly red.
- **Let me pick:** user selects which telemetry gaps to resolve.
- **Report only:** exit unchanged.

## Grants & denials (CLASSIFY-BLOCK)
| class | step it powers | grant | on denial |
|---|---|---|---|
| read | scan logging/metrics/error paths for the categories above | `Read`·`Grep`·`Glob` | refuse that file, name it — never a clean bill |
| write | Fix mode's safe-log apply, incl. checkpoint → build+tests → auto-revert if newly red | `Edit`·`Bash` (checkpoint/build/revert need exec) | report the fix as NOT applied AND the checkpoint/revert as NOT available, never claim done |

<!-- SHARED:CLASSIFY_BLOCK -->

## Output
`| file:line | category | severity | finding | recommendation |`

Severity: CRITICAL (swallowed error with state mutation) · HIGH (missing stack trace in error logs) · MEDIUM (unstructured log in API boundary) · LOW (minor trace gaps)

<!-- SHARED:REPORTING_FOOTER -->

<!-- SHARED:ORCHESTRATION -->

<!-- SHARED:ESCALATION_FOOTER -->

