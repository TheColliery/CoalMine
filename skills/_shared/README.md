# skills/_shared — injected template partials

Each partial below is injected into every `skills/*/SKILL.md` template wherever its marker appears. Rendering happens in `scripts/lib/render.mjs` (the only place that knows the rules) — used by `install.mjs`, `build-plugin.mjs`, and `verify.mjs`.

| Partial | Marker in SKILL.md template | Used by |
|---|---|---|
| `language-header.md` | `<!-- SHARED:LANGUAGE_HEADER -->` | all 9 templates |
| `orchestration.md` | `<!-- SHARED:ORCHESTRATION -->` | all 9 templates |
| `escalation-footer.md` | `<!-- SHARED:ESCALATION_FOOTER -->` | all 9 templates |
| `reporting-footer.md` | `<!-- SHARED:REPORTING_FOOTER -->` | 7 of 9 templates — every canary whose Output is a per-defect `file`/`line`/severity table; not `gold-standard` (a 5-part audit report, no per-defect rows) or `source-grounding` (verified/unverified annotations, no `file`/`line`/severity) |
| `classify-block.md` | `<!-- SHARED:CLASSIFY_BLOCK -->` | 8 of 9 templates — every skill except `source-grounding` (skill-authoring.md §5b P6: read+network only, no write step, its D1 already covers the one hot class) |

`orchestration.md` additionally contains `{{LIGHT_INTENT}}`, `{{STANDARD_INTENT}}`, `{{HEAVY_INTENT}}` placeholders, filled per skill from that skill's `skill-meta.json`.

## Shared references (on-demand, not injected by marker)

`references/` here holds shared reference files the build copies into **every** skill's `references/` dir — listed in `SHARED_REFERENCES` (`scripts/lib/render.mjs`). Unlike the marker partials above (always resident in SKILL.md), these load **on-demand** only when an agent Reads them, so heavy detail the auto/Light path never needs stays out of the always-loaded footer.

| Shared reference | Lands at | Holds |
|---|---|---|
| `references/escalation.md` | `<each skill>/references/escalation.md` | per-platform Heavy levers + Heavy-run durability (read before a Heavy run) |

verify.mjs byte-compares each skill's injected copy to the one source here.

Rules: source templates in `skills/` MUST keep their markers (verify.mjs fails if they are conformed in place). The committed `plugin/` dist MUST contain no markers — after editing anything here, run `node scripts/build-plugin.mjs`.

## The mold — canonical SKILL.md structure (principle 3: single brand)

Every skill template follows this section order; new skills copy it exactly:

1. frontmatter (`name` = dir name, kebab-case; `description` = what + `Triggers on:` keywords + use-when)
2. `# Title` → `<!-- SHARED:LANGUAGE_HEADER -->` → one mission line
3. Core sections (skill-specific: categories/checklist/acts)
4. `references/` pointer line(s) — every skill ships a `references/` dir for per-stack depth
5. `## Discipline`
6. `## Fix mode (choice-gated)` (or report-only note) → `## Grants & denials (CLASSIFY-BLOCK)` (skip only for `source-grounding`, per its `_shared/README.md` row above) → `## Output` + severity scale → `<!-- SHARED:REPORTING_FOOTER -->` (only if Output is a per-defect `file`/`line`/severity table — skip for a non-finding-shaped Output like `gold-standard`'s audit report)
7. `## Escalation — Scope & Model Quality` → tier table → `<!-- SHARED:ORCHESTRATION -->` → `<!-- SHARED:ESCALATION_FOOTER -->`
