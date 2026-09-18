---
name: drift-canary
description: >-
  Compatibility and schema drift canary — checks for database schema migration safety, breaking API contract changes, serializable payload mismatches, and backward compatibility drift. Triggers on keywords: "/drift-canary", "drift-canary", "contract drift", "breaking changes". Use when changing DB schemas, API contracts, serialized payloads, or required config keys.
---

# Drift Canary (Contract & Schema Drift Audit)

<!-- SHARED:LANGUAGE_HEADER -->

Audit code to ensure changes do not break backward compatibility or cause database/API mismatches.

## Auditing Categories
1. **Breaking Schema Migrations** — dropping columns, changing types, or adding non-null columns without defaults (crashes on deploy).
2. **API Contract breaking changes** — modifying existing REST/GraphQL properties, removing endpoints, or adding required query fields that break old clients.
3. **Serialization mismatches** — editing properties in serialized payloads (JSON, Protobuf, XML) without deserialization fallbacks.
4. **Library Contract Drift** — changing a public method signature in a shared library without a deprecated wrapper.
5. **Environment Configuration drift** — introducing new required config keys (`.env` / OS vars) without defaults or fallback.

Expand/contract migration rules, per-format serialization fallbacks, and the breaking-vs-additive API checklist: read `references/checks.md` before scanning.

**Scope:** honor `.coalmine.json` `schemaPaths` / `migrationDirs` if set — scan those globs/dirs; else infer by inspecting the repo.

## Discipline
- **Style Drift Resolution (Fix mode):** when an approved fix touches mixed-style code, conform the minority patterns to the dominant style (highest average usage) to minimize churn — never start a standalone style refactor.

## Fix mode (choice-gated)

In Agent Context, after the report, present via `ask_question`:

- **Apply safe deprecations:** mark endpoints/methods deprecated + add backward-compatibility mapping wrappers. Each fix: checkpoint (git stash/commit in a git repo; else copy the file aside — never assume git) → apply → build + tests → auto-revert if newly red.
- **Let me pick:** user selects specific compatibility fixes.
- **Report only:** exit unchanged.

## Grants & denials (CLASSIFY-BLOCK)
| class | step it powers | grant | on denial |
|---|---|---|---|
| read | scan schema/API/serialization surfaces for the categories above | `Read`·`Grep`·`Glob` | refuse that file, name it — never a clean bill |
| write | Fix mode's deprecation/compat-wrapper apply, incl. checkpoint → build+tests → auto-revert if newly red | `Edit`·`Bash` (checkpoint/build/revert need exec) | report the fix as NOT applied AND the checkpoint/revert as NOT available, never claim done |

<!-- SHARED:CLASSIFY_BLOCK -->

## Output
`| file:line | contract interface | severity | finding | migration path |`

Severity: CRITICAL (breaking DB schema mutation / breaking API change) · HIGH (serialization type change) · MEDIUM (unmapped new required env key) · LOW (missing deprecation doc)

<!-- SHARED:REPORTING_FOOTER -->

<!-- SHARED:ORCHESTRATION -->

<!-- SHARED:ESCALATION_FOOTER -->

