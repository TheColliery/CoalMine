---
name: telemetry-canary
description: >-
  Observability and structured logging canary — checks for structured logs (JSON), OpenTelemetry metrics/traces, proper error stack traces, and flags empty catches or silent log swallowing. Triggers on keywords: "/telemetry-canary", "telemetry-canary", "observability audit", "structured logging". Use when adding or changing logging, metrics, tracing, or error-handling code.
---

# Telemetry Canary (Observability & Logging Audit)

**Language:** Generate EVERYTHING at runtime in the user's language — questions, answer options, menu labels, recommendations, report narrative. Detect from their messages; never default to English just because this file is English. English is allowed only for technical terms: commands, paths, code identifiers, severity labels (CRITICAL/HIGH/MEDIUM/LOW), and tier names (Light/Standard/Heavy).

**Config reads — every config key, always the CASCADE, never the bare project file:** `~/.claude/.coalmine.json` first, then the project config (own agent dir → other known agent dirs → legacy `<gitroot>/.coalmine.json`), project wins per key. A bare project read is ABSENT on a machine configured only globally, so it silently yields defaults.

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

A denial reaches the WORKER as a visible message and propagates no further — never to a
caller, never as a catchable condition. Every row above states a grant or an explicit death;
a step that dies says so in the output, never as a false "done"/"skipped"/"clean".

- **read** denied → refuse before scanning; never a false clean bill.
- **write** denied → report the change as NOT applied — never claim done.
- **network** denied/unfetchable → `⚠️ unverified: check [source]`.
- **spawn** denied → degrade per Escalation's own capability-lever fallback (never fake
  parallelism) and say the fan-out did not happen — already discharged there; a row above
  is only for a spawn this skill does OUTSIDE tier escalation.

## Output
`| file:line | category | severity | finding | recommendation |`

Severity: CRITICAL (swallowed error with state mutation) · HIGH (missing stack trace in error logs) · MEDIUM (unstructured log in API boundary) · LOW (minor trace gaps)

**Reporting:** call `ReportFindings` when callable — `file`/`line` MUST be the defect site, never the enclosing function; an unresolvable line reports your best guess, named imprecise in the wrap-up — **never dropped, never faked.** Severity prefixed in `summary` (e.g. `[HIGH] …`), ranked most-severe first, SUSPECTED as `verdict: PLAUSIBLE`; chat then carries only the wrap-up line (counts · coverage gaps · overflow past 32 · any imprecise-line findings) + the fix menu, never a restatement of findings. Not callable → the table above, unchanged. An Apply-fixes click = consent to the safe-fix class only — gated the same as this skill's own fix-mode (Hook Context needs an interactive session, per the Hook Context rule below) — composing with (never bypassing) the fix-mode discipline. **After any fix round, re-report the same findings with `outcome: fixed`/`skipped`/`no_change_needed` — skipping this leaves the round UNFINISHED.**

## Escalation — Scope & Model Quality

Tiers are **capability targets**, not platform commands — resolve each to your host's nearest lever. No lever for one? **Degrade gracefully — never fake parallelism you can't do**; escalate via model tier + reasoning depth instead.

| Level | Intent | Capability target | Cost |
|---|---|---|---|
| **Light** | Spot telemetry check, key paths only | Cheapest model · single agent, no sub-agents. | Low |
| **Standard** | Balanced observability audit, multi-category | Balanced model · raised reasoning · sub-agents per category **only if your platform runs concurrent workers** (else single-agent). | Balanced |
| **Heavy** | Full 5-category audit + adversarial verify | Most capable model + largest context · deepest reasoning · max sub-agent fan-out **if supported** · adversarial cross-check where available. | High |

Per-platform Heavy levers + Heavy-run durability: read `references/escalation.md` before a Heavy run. No concurrent fan-out on your host → escalate by model + reasoning only.

**Agent Context (interactive):** score the tier rubric, then call `ask_question` once with the 3 tiers — the pick marked `✓`, score shown, labels localized — and wait for the choice before starting. `ask_question` = your platform's question tool: Claude Code `AskUserQuestion` · Cline `ask_question` · Copilot `askQuestions` · Gemini CLI `ask_user` (business-tier product; individual tiers ended 2026-06-18 → Antigravity CLI) · Codex `request_user_input` · Cursor/Devin Desktop (ex-Windsurf)/Antigravity built-in prompts; none → numbered text menu.

**Tier rubric (deterministic):** +1 each — ① >20 files or whole-repo/cross-module reach ② >2 of this skill's categories relevant ③ release/security/pre-ship context ④ findings will drive code changes. **0–1 Light · 2–3 Standard · 4 Heavy.** **Freshness cap:** scope already audited ≥Standard this session → cap at Light (re-auditing fresh ground wastes tokens; scope to what changed). **Default tier:** honor `.coalmine.json` `defaultTier` unless the user requests a tier for that run — an explicit request overrides everything.

**Hook Context (auto-triggered):** auto-Light, no tier question, no sub-agents — report first. Interactive session (a user is present) → follow this skill's own Fix mode section, if it defines one, for what to offer after the report; non-interactive → report-only. Where a Fix mode section exists, never fix without a chosen option.

**Entanglement:** after the report, if confirmed findings fall in another canary's domain, offer it once via `ask_question` (one line, max one offer): perf/N+1 → scale-canary · contract/serialization/config → drift-canary · failure-path/retry → resilience-audit · logging/metrics → telemetry-canary · coupling/DI → testability-canary · dependency/CVE → supply-chain-audit · unverified version-sensitive claim → source-grounding · missing/stale rule → gold-standard.

**Self error-report:** if this skill misbehaves (contradictory instruction, broken procedure, wrong finding class), OFFER to file it at https://github.com/HetCreep/CoalMine/issues/new/choose with a user-reviewed summary — never auto-submit, never include unapproved code or paths.

