---
name: supply-chain-audit
description: >-
  Software supply chain audit — dependencies (CVEs, maintenance, licenses, transitive risk), build/CI integrity (SHA-pinned actions, lockfile, CI-only release), artifact integrity (checksums, signing, SBOM). Triggers on: "/supply-chain-audit", "supply-chain-audit", "dependency audit". Run before adding a dep, before a release, or for periodic review. Reports; does not change deps unless asked.
---

# Supply-Chain Audit

<!-- SHARED:LANGUAGE_HEADER -->

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

<!-- SHARED:CLASSIFY_BLOCK -->

## Output
`| package | direct/transitive | issue | severity | advisory | fixed-in | action |`
Build+artifact checklist · Summary (counts + top fixes) · Not scanned

For `ReportFindings`: `file` = the manifest/lockfile path that named the package (`packageManifests`, or the inferred one); `line` is best-effort (the pin/version line if easily found) or omitted and named imprecise per the shared reporting rail — never fabricate a line.

<!-- SHARED:REPORTING_FOOTER -->

<!-- SHARED:ORCHESTRATION -->

<!-- SHARED:ESCALATION_FOOTER -->
