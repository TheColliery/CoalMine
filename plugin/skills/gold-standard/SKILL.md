---
name: gold-standard
description: >-
  World-class completeness audit — score a project's rules/standards/features against best-in-class exemplars, name the gaps, fill missing rules, adopt as binding, then offer to conform existing code. Triggers on keywords: "/gold-standard", "gold-standard", "audit rules", "are we world-class", "fill gaps", "complete our rules", "conform old code".
---

# Gold Standard

**Language:** Generate EVERYTHING at runtime in the user's language — questions, answer options, menu labels, recommendations, report narrative. Detect from their messages; never default to English just because this file is English. English is allowed only for technical terms: commands, paths, code identifiers, severity labels (CRITICAL/HIGH/MEDIUM/LOW), and tier names (Light/Standard/Heavy).

**Config reads — every config key, always the CASCADE, never the bare project file:** `~/.claude/.coalmine.json` first, then the project config (own agent dir → other known agent dirs → legacy `<gitroot>/.coalmine.json`), project wins per key. A bare project read is ABSENT on a machine configured only globally, so it silently yields defaults.

Answer: **"For a project that does THIS — are rules/standards/features 100% vs world-class? If not, what's missing?"**

Four acts: **AUDIT** → **FILL** → **ADOPT** → **CONFORM**. Stop at any.

**Manual `/gold-standard` = interactive setup:** read `references/wizard.md` (dual-audience — layman 1-question default · programmer order→bill→pay). The auto/keyword path (the Triggers table) skips it.

## Triggers
| Keyword | Act |
|---|---|
| "audit rules" / "gold-standard" / "are we world-class" | AUDIT |
| "fill gaps" / "complete our rules" | FILL |
| "work by these rules" / "follow from now on" | ADOPT |
| "conform old code" / "retrofit" | CONFORM |
| "fill and adopt" / `ACTION=fill-adopt` | AUDIT → FILL → summary → ADOPT → offer CONFORM |

## Consent gates (G1–G6, declared)
| # | what it gates | when it fires | Agent lane | Hook lane |
|---|---|---|---|---|
| G1 | model tier | before work starts | `ask_question`, 3 tiers, wait for pick | suppressed — auto-Light, no tier question |
| G2 | ADOPT | before treating the ruleset as binding | `ask_question` | `ask_question` |
| G3 | CONFORM fix | before each fix | `ask_question` | `ask_question` |
| G4 | RE-VALIDATE change | any re-stamp / rewrite / delete / consistency-fix | `ask_question` | `ask_question` |
| G5 | entanglement hand-off | after the report, cross-domain finding | `ask_question`, once | `ask_question`, once |
| G6 | self error-report | skill misbehaves | offer, never auto-submit | offer, never auto-submit |

Hook cells assume an interactive session; non-interactive → D6, report-only: no gate fires. Manual `/gold-standard` wizard (`references/wizard.md`) carries its own setup gates — on-demand, not counted above.

## Acts

ADOPT and every CONFORM fix: gated (G2/G3), never assumed (P2).

1. **AUDIT** — pick 3–5 named exemplars **fresh at run time** (the bar moves with the era — never reuse a remembered bar (P3)), derive the 100% checklist per dimension, score (✅/🟡/❌/N-A), give overall %. Previously filled/adopted rules are audit subjects too: a rule past its `revalidate` due date or contradicted by today's exemplars is a gap.
2. **FILL** — write missing MUST-HAVE rules into the project's rules home (`.claude/rules/` → `AGENTS.md` → `STANDARDS.md`). Match project style + voice. Cite the exemplar. Invoke source-grounding for version-sensitive claims. Extend existing; never duplicate (P4). Check the retired-rules record first — never resurrect a rule retired with a reason unless the user overrides (P5). No overkill rules — only essential, practical, saturated ones (P6). Stamp each rule: `<!-- coalmine: verified <YYYY-MM-DD> · exemplar <name> · revalidate <30|90>d -->` — 30d fast-moving surfaces, 90d general; a CVE/advisory rule's event overrides its calendar stamp. Mechanics + why: `references/method.md`.
3. **ADOPT** — treat the completed ruleset as binding for the rest of the session. Code changes still need user approval — adoption governs *how* to work, not license to auto-edit (P7).
4. **CONFORM** — scan existing code against adopted rules; report violations (`path:line` · rule · evidence). Fix on approval: checkpoint → one fix → build+tests → revert if newly red. Style Drift: conform minority patterns to the dominant style (highest average usage); never start a standalone style refactor (P8).
5. **RE-VALIDATE** (runs inside every repeat AUDIT, or when offered on a past-due stamp) — verdict each CoalMine-stamped rule, all changes choice-gated (G4/P9):
   - **still valid** → re-stamp the date, touch nothing else (no churn);
   - **stale but needed** → rewrite against today's exemplar;
   - **obsolete** (subject removed, platform died, or substance merged into another rule) → **delete the rule** + record a one-line tombstone in the project's memory/decision log (`retired <rule> <date>: <reason>`) — dead rules burn context every session; the tombstone blocks the next FILL from resurrecting them.
   - **CONSISTENCY** (the agent trusts memory/rules it never verifies — so verify them): scan the memory/decision log and any in-repo rule register for (a) a prescribed fix/"decision" that **contradicts a binding rule or another decision** (e.g. prescribing randomness where a determinism rule forbids it) — a poisoned/stale entry; (b) references to a file, flag, or command that **no longer exists**. Flag each with the conflicting source quoted; correct only through the choice-gate (P9). This is the semantic half; the mechanical half (`node scripts/consistency.mjs`: cross-document counts, byte-identical doctrine mirrors, well-formed stamps) runs without an agent.

Exemplar-picking rules, scorecard mechanics, stamp/tombstone formats: read `references/method.md` before the first AUDIT.

## Method
1. **Bar** — name 3–5 world-class exemplars + why them (cite real programs, not "best practices" (P11)).
2. **Checklist** — MUST-HAVE (table-stakes) vs EXCELLENCE (top-tier polish). Each tied to an exemplar.
3. **Score** — every criterion. 🟡 = half credit. N-A must be justified; unjustified N-A = ❌ (D2).
4. **Gaps** — prioritized: MUST-HAVEs first. Each: criterion · exemplar · effort · impact.

## Dimensions (pick relevant)
Correctness · Security · Performance · UX/DX · Docs/onboarding · Testing/CI · Distribution/integrity · Observability · Governance/licensing · Maintainability · Compatibility · Error handling

## Discipline
- State dimensions not assessed + why.
- Score/verify per P10–P12 + D1 (Prohibitions/Degrade paths below) — not restated here.

## Prohibitions (P1–P16, declared)
| # | never … |
|---|---|
| P1 | default to English just because this file is English |
| P2 | assume ADOPT/CONFORM approval — always `ask_question` (G2/G3) |
| P3 | reuse a remembered exemplar bar — pick fresh each AUDIT |
| P4 | duplicate an existing rule during FILL |
| P5 | resurrect a retired rule without the user's override |
| P6 | write an overkill rule — essential/practical/saturated only |
| P7 | auto-edit code under ADOPT's authority — code changes still need approval |
| P8 | start a standalone style refactor during CONFORM |
| P9 | make a RE-VALIDATE change (re-stamp / rewrite / delete / consistency-fix) outside the choice-gate (G4) |
| P10 | inflate a score — 85% says 85% |
| P11 | cite an unsourced "best practice" — every criterion names a real exemplar |
| P12 | score from memory or a single source |
| P13 | fix without a chosen option (Hook lane) |
| P14 | auto-submit the self error-report |
| P15 | include unapproved code or paths in the self error-report |
| P16 | treat a denied FILL/write as if it succeeded — ADOPT MUST NOT bind against rules that were never written |

Dedup: P5 restated at the RE-VALIDATE tombstone · P9 restated at the CONSISTENCY sub-bullet · P11 restated at Method §1 · P16 restated at the CLASSIFY-BLOCK write row — one row each, further mentions.

## Degrade paths (D1–D8, declared)
| # | branch | condition | lane |
|---|---|---|---|
| D1 | mark **N-A** with justification, never guess | sandbox/network blocks an external lookup | universal |
| D2 | unjustified N-A scores as ❌, not skipped | N-A given with no justification | universal |
| D3 | degrade to model tier + reasoning depth, never fake parallelism | no capability lever for the target tier on this host | universal |
| D4 | fixed at Light, no tier question, no sub-agents | Hook Context (auto-triggered) | Hook only |
| D5 | report-only, no fix offered | Hook Context, interactive or non-interactive — this skill defines no Fix mode section, so the footer's deferral resolves to report-only either way | Hook only |
| D6 | fall back to a numbered text menu | host has no question tool | universal |
| D7 | report the rule/fix as NOT written, never say "filled"/"adopted" (P16) | write (`Edit`/`Write`) denied during FILL/ADOPT/CONFORM/RE-VALIDATE | universal |
| D8 | refuse that file, name it — never a clean bill | read (`Read`/`Grep`/`Glob`) denied during AUDIT/CONSISTENCY scanning | universal |

D3 restated at four sites — the general clause, the Standard row's "(else single-agent)", the Heavy row's "if supported", and the Heavy-specific "escalate by model + reasoning only" — one row, four mentions. D4–D6 come from the shared Escalation footer below (Agent lane has no equivalent for D4/D5 — tier is asked, see G1, never degraded; D6 applies in either lane, wherever `ask_question` would fire). The Freshness cap (scope already audited this session → cap at Light) is a tier-selection modifier on G1, not a degrade branch — no capability lever is missing and there is no unhappy path, so it stays out of D. D7/D8 are this skill's CLASSIFY-BLOCK branches (skill-authoring.md §5b) — numbered here, not restated in the table below.

## Grants & denials (CLASSIFY-BLOCK)
SPAWN/TIER/QUESTION-TOOL/NETWORK already discharged above — D3/D4/D6, D1. This table adds READ + WRITE; their denial branches are numbered into the Degrade paths ledger (D8, D7) rather than restated here.
| class | step it powers | grant | on denial |
|---|---|---|---|
| read | AUDIT (scan exemplars/rule trees) · CONSISTENCY (scan memory/decision log) | `Read`·`Grep`·`Glob` | D8 |
| write | FILL · ADOPT · CONFORM · RE-VALIDATE | `Edit`·`Write` (·`Bash` — CONFORM's checkpoint→build/tests→revert interlock) | D7, P16 |

A denial reaches the WORKER as a visible message and propagates no further — never to a
caller, never as a catchable condition. Every row above states a grant or an explicit death;
a step that dies says so in the output, never as a false "done"/"skipped"/"clean".

- **read** denied → refuse before scanning; never a false clean bill.
- **write** denied → report the change as NOT applied — never claim done.
- **network** denied/unfetchable → `⚠️ unverified: check [source]`.
- **spawn** denied → degrade per Escalation's own capability-lever fallback (never fake
  parallelism) and say the fan-out did not happen — already discharged there; a row above
  is only for a spawn this skill does OUTSIDE tier escalation.

## Output — 5 locations, declared
(the AUDIT report only — FILL writes rules, RE-VALIDATE writes a tombstone, self error-report files an issue: none of those are part of this list)
1. Bar — category + named exemplars
2. Scorecard — `| dimension | criterion | tier (must/excellence) | exemplar | status | evidence |`
3. Per-dimension % + overall % (list N-A exclusions)
4. Gaps — criterion · exemplar · effort · impact
5. Verdict — 1 line + top 3 moves

## Escalation — Scope & Model Quality

Tiers are **capability targets**, not platform commands — resolve each to your host's nearest lever. No lever for one? **Degrade gracefully — never fake parallelism you can't do**; escalate via model tier + reasoning depth instead.

| Level | Intent | Capability target | Cost |
|---|---|---|---|
| **Light** | Quick gap check, AUDIT only | Cheapest model · single agent, no sub-agents. | Low |
| **Standard** | Balanced audit, AUDIT+FILL | Balanced model · raised reasoning · sub-agents per category **only if your platform runs concurrent workers** (else single-agent). | Balanced |
| **Heavy** | Full audit cycle, AUDIT+FILL+ADOPT+CONFORM | Most capable model + largest context · deepest reasoning · max sub-agent fan-out **if supported** · adversarial cross-check where available. | High |

Per-platform Heavy levers + Heavy-run durability: read `references/escalation.md` before a Heavy run. No concurrent fan-out on your host → escalate by model + reasoning only.

**Agent Context (interactive):** score the tier rubric, then call `ask_question` once with the 3 tiers — the pick marked `✓`, score shown, labels localized — and wait for the choice before starting. `ask_question` = your platform's question tool: Claude Code `AskUserQuestion` · Cline `ask_question` · Copilot `askQuestions` · Gemini CLI `ask_user` (business-tier product; individual tiers ended 2026-06-18 → Antigravity CLI) · Codex `request_user_input` · Cursor/Devin Desktop (ex-Windsurf)/Antigravity built-in prompts; none → numbered text menu.

**Tier rubric (deterministic):** +1 each — ① >20 files or whole-repo/cross-module reach ② >2 of this skill's categories relevant ③ release/security/pre-ship context ④ findings will drive code changes. **0–1 Light · 2–3 Standard · 4 Heavy.** **Freshness cap:** scope already audited ≥Standard this session → cap at Light (re-auditing fresh ground wastes tokens; scope to what changed). **Default tier:** honor `.coalmine.json` `defaultTier` unless the user requests a tier for that run — an explicit request overrides everything.

**Hook Context (auto-triggered):** auto-Light, no tier question, no sub-agents — report first. Interactive session (a user is present) → follow this skill's own Fix mode section, if it defines one, for what to offer after the report; non-interactive → report-only. Where a Fix mode section exists, never fix without a chosen option.

**Entanglement:** after the report, if confirmed findings fall in another canary's domain, offer it once via `ask_question` (one line, max one offer): perf/N+1 → scale-canary · contract/serialization/config → drift-canary · failure-path/retry → resilience-audit · logging/metrics → telemetry-canary · coupling/DI → testability-canary · dependency/CVE → supply-chain-audit · unverified version-sensitive claim → source-grounding · missing/stale rule → gold-standard.

**Self error-report:** if this skill misbehaves (contradictory instruction, broken procedure, wrong finding class), OFFER to file it at https://github.com/HetCreep/CoalMine/issues/new/choose with a user-reviewed summary — never auto-submit, never include unapproved code or paths.
