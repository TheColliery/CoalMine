---
name: testability-canary
description: >-
  Testability and design decoupling canary — checks for tight coupling, lack of Dependency Injection (DI), hardcoded constructors, Single Responsibility Principle (SRP) violations, and mockability gaps. Triggers on keywords: "/testability-canary", "testability-canary", "testability audit", "decoupling". Use when refactoring coupling, introducing DI, or making code unit-testable.
---

# Testability Canary (Decoupling & Mockability Audit)

<!-- SHARED:LANGUAGE_HEADER -->

Audit code to ensure it is decoupled, modular, and easy to cover with automated tests.

## Auditing Categories
1. **Hardcoded Constructors** — instantiating deps inside classes (`new DatabaseClient()`) instead of injecting via constructor/factory (prevents mocking).
2. **SRP Violations** — a class or method doing too many distinct duties (e.g. a service that also parses JSON and formats UI).
3. **Static Dependencies** — reliance on global static methods or Singletons that make test isolation impossible.
4. **Time & Environment Coupling** — direct `DateTime.Now`, `fs`, or `process.env` calls without an abstraction layer (fragile time/path-sensitive tests).
5. **Private Logic Gaps** — complex business logic hidden in private methods that can't be tested directly (extract to testable helpers).

Per-stack patterns and the mock-strategy vocabulary: read `references/checks.md` before scanning.

## Fix mode (choice-gated)

In Agent Context, after the report, present via `ask_question`:

- **Apply safe refactoring:** extract hardcoded initializations into constructor params (DI) + add interface definitions. Each fix: checkpoint (git stash/commit in a git repo; else copy the file aside — never assume git) → apply → build + tests → auto-revert if newly red.
- **Let me pick:** user selects specific refactoring moves.
- **Report only:** exit unchanged.

## Grants & denials (CLASSIFY-BLOCK)
| class | step it powers | grant | on denial |
|---|---|---|---|
| read | scan coupling/DI surfaces for the categories above | `Read`·`Grep`·`Glob` | refuse that file, name it — never a clean bill |
| write | Fix mode's safe-refactor apply, incl. checkpoint → build+tests → auto-revert if newly red | `Edit`·`Bash` (checkpoint/build/revert need exec) | report the fix as NOT applied AND the checkpoint/revert as NOT available, never claim done |

<!-- SHARED:CLASSIFY_BLOCK -->

## Output
`| file:line | coupling point | severity | finding | mock strategy |`

Severity: CRITICAL (un-mockable external write/network call) · HIGH (SRP violation blocking unit testing) · MEDIUM (time/env coupling) · LOW (minor static dependency)

<!-- SHARED:REPORTING_FOOTER -->

<!-- SHARED:ORCHESTRATION -->

<!-- SHARED:ESCALATION_FOOTER -->

