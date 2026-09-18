---
description: CoalMine measurement dashboard — canary activity this session + rule-freshness status across the project's rules home
---

Produce the CoalMine stats report for this project, in the user's language. Three sections, tables only:

**1. Canary activity (this session, from conversation context):**
| canary | runs | findings (C/H/M/L) | fixes accepted |
Count every CoalMine canary invocation visible in this session (manual or hook-nudged). If none ran, one line saying so.

**2. Rule freshness (scan now):**
Grep the project's rules home (`.claude/rules/`, `.agents/rules/`, `AGENTS.md`) for `coalmine: verified` stamps. For each stamped rule:
| rule (file) | verified | revalidate | status |
Status = ✅ current · ⚠️ due within 7 days · ❌ OVERDUE.
**Config reads — every config key, always the CASCADE, never the bare project file:** `~/.claude/.coalmine.json` first, then the project config (own agent dir → other known agent dirs → legacy `<gitroot>/.coalmine.json`), project wins per key. A bare project read is ABSENT on a machine configured only globally, so it silently yields defaults.

To calculate the revalidation threshold (days) for each rule:
- If the stamp has `revalidate 30d` (platform rule), check `platformRuleRevalidateDays` from `.coalmine.json` (default: 30).
- If the stamp has `revalidate 90d` (general rule), check `ruleRevalidateDays` from `.coalmine.json` (default: 90).
If any rule is overdue, end by offering `/gold-standard` re-validation via AskUserQuestion (Run now / Queue / Skip). If no stamps exist, say the project has no CoalMine-filled rules yet.

**3. Definitions freshness (the installed pattern DB):**
Grep the installed CoalMine skills' `references/*.md` files for their `coalmine: verified` stamps (plugin cache or skills dir — wherever this skill itself is installed from). One line per file:
| definition file | verified | revalidate | status |
To calculate the revalidation threshold (days) for each definition file:
- If the stamp has `revalidate 30d` (platform definition), check `platformDefinitionRevalidateDays` from `.coalmine.json` (default: 30).
- If the stamp has `revalidate 90d` (general definition), check `definitionRevalidateDays` from `.coalmine.json` (default: 90).
These ship with CoalMine itself — if any is OVERDUE, do NOT re-ground locally; advise updating CoalMine instead (`claude plugin update coalmine@coalmine` on Claude Code; reinstall via `install.mjs` from a fresh clone elsewhere), like updating antivirus definitions.

No prose beyond the tables and the single offer. Do not modify any file.
