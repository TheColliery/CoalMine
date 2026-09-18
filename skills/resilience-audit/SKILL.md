---
name: resilience-audit
description: >-
  Failure-mode audit (FMEA for software) — for each way the system can fail (network, storage, partial completion, crash, concurrency, bad input), check whether code DETECTS, HANDLES, RECOVERS, and COMMUNICATES it. Triggers on: "/resilience-audit", "resilience-audit", "FMEA audit". Use when touching network, storage, async, retry, or rollback paths. Flags data loss, silent-success-on-failure, missing rollback/retry/idempotency. Reports; does not fix unless asked.
---

# Resilience Audit

<!-- SHARED:LANGUAGE_HEADER -->

For every operation: **"what happens when this FAILS?"** Report; do NOT fix unless asked.

## Failure categories
1. **External I/O** — network down/slow, API 4xx/5xx/timeout, rate-limit. Retry w/ backoff? Timeout set? Clear error vs hang?
2. **Storage** — disk full, permission denied, partial write. Atomic write (temp+rename)? Cleanup on failure? Existing good copy untouched?
3. **Partial completion** — half-done op (50/100 files). Reported as FAILURE, never success.
4. **Crash / OOM** — killed mid-op. Idempotent restart? No orphaned half-state?
5. **Concurrency** — two instances, race, deadlock. Locking / idempotency / safe re-entry?
6. **Input / data** — malformed, null, truncated, huge. Validate at boundary? Fail-fast?
7. **Dependency down** — fallback/cache/graceful degrade? Clear error vs silent hang?
8. **Resource exhaustion** — bounded? Backpressure? Cleanup on error path?

Per-stack timeout/atomicity/idempotency patterns to grep: read `references/checks.md` before scanning.

## For each failure point, check 4 things
- **Detected?** code notices it (doesn't swallow)?
- **Handled?** retry/fallback/fail-clean — not ignored, not silent-success?
- **Recoverable?** rollback/idempotent; no data loss or corruption?
- **Communicated?** clear error to user+log; not a hang, not a false "done"?

## Discipline
- Trace actual failure path (cite file:line). Don't assume handling exists; prove it.
- "partial = failure" — any path reporting success on partial completion = CRITICAL.
- "logged" ≠ "handled" — swallowed+logged error that corrupts state or returns success = CRITICAL.

## Fix mode (choice-gated)
After the report, present via `ask_question`:
- **Fix safe ones** — add missing timeout, null/input validation, clear error+log on unhandled path. Each: checkpoint → fix → build+tests → revert if newly red.
- **Let me pick** — user-selected fixes only.
- **Report only** — change nothing.

NEVER auto-fix: retry/rollback/recovery/atomicity logic (semantic changes can introduce new failure modes).

## Grants & denials (CLASSIFY-BLOCK)
| class | step it powers | grant | on denial |
|---|---|---|---|
| read | trace failure paths for the 8 categories above | `Read`·`Grep`·`Glob` | refuse that file, name it — never a clean bill |
| write | Fix mode's safe-guard apply, incl. checkpoint → build+tests → revert if newly red | `Edit`·`Bash` (checkpoint/build/revert need exec) | report the fix as NOT applied AND the checkpoint/revert as NOT available, never claim done |

<!-- SHARED:CLASSIFY_BLOCK -->

## Output
`| operation | failure mode | effect | handling (file:line) | severity | recommended guard |`
Ordering/atomicity findings · Summary (counts + top fixes) · Not assessed

Severity: CRITICAL (data loss/corruption/silent-success) · HIGH (crash/hang/partial-no-recovery) · MEDIUM (poor degradation/missing retry) · LOW (cosmetic)

<!-- SHARED:REPORTING_FOOTER -->

<!-- SHARED:ORCHESTRATION -->

<!-- SHARED:ESCALATION_FOOTER -->
