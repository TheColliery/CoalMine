<!-- coalmine: verified 2026-06-12 · revalidate 90d · definition file for gold-standard -->
# Gold-standard — method details

## Picking exemplars (3–5, fresh every run)
- Same product CATEGORY as the audited project (CLI tool → ripgrep/prettier; package registry → npm/Cargo; skill library → anthropics/skills, obra/superpowers; web service → the big public post-mortem publishers).
- Each exemplar must be NAMED and CITABLE — "npm does X (docs link)", never "best practice says".
- Verify every version-sensitive exemplar claim through source-grounding before it becomes a criterion. Multi-source: cross-reference registries + advisory feeds (GHSA/OSV/NVD) + vendor docs; never one source, never memory.

## Scorecard mechanics
- Criteria split MUST-HAVE (table stakes — absence blocks "done") vs EXCELLENCE (top-tier polish).
- Scoring: ✅ = 1 · 🟡 = 0.5 · ❌ = 0 · N-A excluded but MUST carry a written justification (unjustified N-A counts as ❌).
- Overall % = points / scored criteria. Report per-dimension % too. Never inflate — 85% says 85%.
- Output order: Bar → Scorecard table → per-dimension % + overall (list N-A exclusions) → prioritized gaps (criterion · exemplar · effort · impact) → one-line verdict + top 3 moves.

## Rule lifecycle artifacts
- **Stamp** (FILL writes, RE-VALIDATE refreshes): `<!-- coalmine: verified 2026-06-12 · exemplar npm-provenance-docs · revalidate 90d -->` placed on the line above the rule heading.
- **Why 30d vs 90d:** 30d fits fast-moving surfaces that ship weekly-to-daily (agent platforms, model/API versions); 90d is still stricter than every authoritative anchor (OWASP ~4y, NIST/FISMA annual) — a cheap early warning, not a compliance floor. CVE/advisory rules follow the Dependabot pattern: the advisory EVENT re-validates first, the 30d stamp is only the staleness backstop.
- **Tombstone** (RETIRE writes, one line in the project's memory/decision log): `retired <rule-name> 2026-06-12: <reason — subject removed / platform dead / merged into <other rule>>`.
- Before FILL adds any rule, grep the decision log for a tombstone with the same subject — resurrect only on explicit user override.

## Blocked environments
Network/sandbox blocks an external check → mark that criterion N-A with the block as justification; never guess the answer from memory.
