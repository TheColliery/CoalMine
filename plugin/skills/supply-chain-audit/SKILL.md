---
name: supply-chain-audit
description: >-
  Software supply chain audit — dependencies (CVEs, maintenance, licenses, transitive risk), build/CI integrity (SHA-pinned actions, lockfile, CI-only release), artifact integrity (checksums, signing, SBOM). Triggers on: "/supply-chain-audit", "supply-chain-audit", "dependency audit". Run before adding a dep, before a release, or for periodic review. Reports; does not change deps unless asked.
---

# Supply-Chain Audit

**Language:** Generate EVERYTHING at runtime in the user's language — questions, answer options, menu labels, recommendations, report narrative. Detect from their messages; never default to English just because this file is English. English is allowed only for technical terms: commands, paths, code identifiers, severity labels (CRITICAL/HIGH/MEDIUM/LOW), and tier names (Light/Standard/Heavy).

**Config reads — every config key, always the CASCADE, never the bare project file:** `~/.claude/.coalmine.json` first, then the project config (own agent dir → other known agent dirs → legacy `<gitroot>/.coalmine.json`), project wins per key. A bare project read is ABSENT on a machine configured only globally, so it silently yields defaults.

Audit what the project trusts: deps, build pipeline, shipped artifact. Report; do NOT change deps unless asked.

## 1. Dependencies
- **Scope** — honor `.coalmine.json` `packageManifests` if set: scan exactly those manifest/lockfile paths; else infer by inspecting the repo.
- **CVEs** — run ecosystem auditor; cross-check every hit in GHSA/OSV/NVD. Cite advisory ID + affected range + fixed version. (Invoke source-grounding — never from memory.)
- **Maintenance** — last release, commit recency, bus-factor, archived/deprecated flag.
- **License** — flag copyleft inside permissive project, missing/unknown license.
- **Transitive** — full tree; name the parent to bump for a transitive fix.
- **Behavior** — phone home? install scripts? unexpected egress?

## 2. Build / CI
- CI-only release builds?
- Actions pinned to commit SHA (not floating tag)?
- Lockfile committed + enforced in CI?
- Minimal token scope? No `pull_request_target`?

## 3. Artifact
- SHA-256 checksums published for every binary?
- Signed (Authenticode/GPG)? Gap documented honestly?
- SBOM generated?
- User can verify before running?

## Tooling
Per-ecosystem vuln/license/outdated commands + offline fallback: read `references/tooling.md` when selecting scanners.

## Discipline
- Ground every CVE/fixed-version in an advisory. Never from memory.
- Don't auto-change deps — report + recommend; user decides (bumps break builds).
- State what was NOT scanned. Blocked network scans → lockfile inspection fallback (see `references/tooling.md`), mark live checks N-A.

## Fix mode (choice-gated)
After the report, present via `ask_question`:
- **Pin safe now** — commit already-present unchanged lockfile, pin CI action to current SHA, add missing checksum step. Each: checkpoint → apply → verify.
- **Let me pick** — user-selected fixes only.
- **Report only** — change nothing.

NEVER auto-fix: dep version bump, lockfile regen (re-resolves entire transitive tree).

## Grants & denials (CLASSIFY-BLOCK)
| class | step it powers | grant | on denial |
|---|---|---|---|
| read | scan manifests/lockfiles; run the ecosystem auditor | `Read`·`Grep`·`Glob`·`Bash` (read-only) | refuse that manifest, name it in "Not scanned" — never a clean bill |
| write | Fix mode's pin/commit, incl. checkpoint → apply → verify | `Edit`·`Write`·`Bash` (checkpoint/verify need exec) | report the pin as NOT applied AND the checkpoint/verify as NOT available, never claim done |
| network | GHSA/OSV/NVD cross-check | `WebSearch`·`WebFetch` (or delegated to source-grounding) | `⚠️ unverified: check [advisory ID]` |

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
`| package | direct/transitive | issue | severity | advisory | fixed-in | action |`
Build+artifact checklist · Summary (counts + top fixes) · Not scanned

For `ReportFindings`: `file` = the manifest/lockfile path that named the package (`packageManifests`, or the inferred one); `line` is best-effort (the pin/version line if easily found) or omitted and named imprecise per the shared reporting rail — never fabricate a line.

**Reporting:** call `ReportFindings` when callable — `file`/`line` MUST be the defect site, never the enclosing function; an unresolvable line reports your best guess, named imprecise in the wrap-up — **never dropped, never faked.** Severity prefixed in `summary` (e.g. `[HIGH] …`), ranked most-severe first, SUSPECTED as `verdict: PLAUSIBLE`; chat then carries only the wrap-up line (counts · coverage gaps · overflow past 32 · any imprecise-line findings) + the fix menu, never a restatement of findings. Not callable → the table above, unchanged. An Apply-fixes click = consent to the safe-fix class only — gated the same as this skill's own fix-mode (Hook Context needs an interactive session, per the Hook Context rule below) — composing with (never bypassing) the fix-mode discipline. **After any fix round, re-report the same findings with `outcome: fixed`/`skipped`/`no_change_needed` — skipping this leaves the round UNFINISHED.**

## Escalation — Scope & Model Quality

Tiers are **capability targets**, not platform commands — resolve each to your host's nearest lever. No lever for one? **Degrade gracefully — never fake parallelism you can't do**; escalate via model tier + reasoning depth instead.

| Level | Intent | Capability target | Cost |
|---|---|---|---|
| **Light** | Single-section check, spot audit | Cheapest model · single agent, no sub-agents. | Low |
| **Standard** | Multi-section balanced audit | Balanced model · raised reasoning · sub-agents per category **only if your platform runs concurrent workers** (else single-agent). | Balanced |
| **Heavy** | Full 3-section audit + adversarial CVE verify | Most capable model + largest context · deepest reasoning · max sub-agent fan-out **if supported** · adversarial cross-check where available. | High |

Per-platform Heavy levers + Heavy-run durability: read `references/escalation.md` before a Heavy run. No concurrent fan-out on your host → escalate by model + reasoning only.

**Agent Context (interactive):** score the tier rubric, then call `ask_question` once with the 3 tiers — the pick marked `✓`, score shown, labels localized — and wait for the choice before starting. `ask_question` = your platform's question tool: Claude Code `AskUserQuestion` · Cline `ask_question` · Copilot `askQuestions` · Gemini CLI `ask_user` (business-tier product; individual tiers ended 2026-06-18 → Antigravity CLI) · Codex `request_user_input` · Cursor/Devin Desktop (ex-Windsurf)/Antigravity built-in prompts; none → numbered text menu.

**Tier rubric (deterministic):** +1 each — ① >20 files or whole-repo/cross-module reach ② >2 of this skill's categories relevant ③ release/security/pre-ship context ④ findings will drive code changes. **0–1 Light · 2–3 Standard · 4 Heavy.** **Freshness cap:** scope already audited ≥Standard this session → cap at Light (re-auditing fresh ground wastes tokens; scope to what changed). **Default tier:** honor `.coalmine.json` `defaultTier` unless the user requests a tier for that run — an explicit request overrides everything.

**Hook Context (auto-triggered):** auto-Light, no tier question, no sub-agents — report first. Interactive session (a user is present) → follow this skill's own Fix mode section, if it defines one, for what to offer after the report; non-interactive → report-only. Where a Fix mode section exists, never fix without a chosen option.

**Entanglement:** after the report, if confirmed findings fall in another canary's domain, offer it once via `ask_question` (one line, max one offer): perf/N+1 → scale-canary · contract/serialization/config → drift-canary · failure-path/retry → resilience-audit · logging/metrics → telemetry-canary · coupling/DI → testability-canary · dependency/CVE → supply-chain-audit · unverified version-sensitive claim → source-grounding · missing/stale rule → gold-standard.

**Self error-report:** if this skill misbehaves (contradictory instruction, broken procedure, wrong finding class), OFFER to file it at https://github.com/HetCreep/CoalMine/issues/new/choose with a user-reviewed summary — never auto-submit, never include unapproved code or paths.
