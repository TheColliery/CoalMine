---
description: CoalMine self-update — check for a newer CoalMine version and offer to apply it, or set how updates are handled
---

CoalMine keeps itself current through the conductor (session start), gated by `.coalmine.json` `updateMode` (ask | auto | remind | off, default ask) and throttled to once per `updateCheckDays` (default 14). This command is the agent procedure each mode triggers — and a manual entry point. Always answer in the user's language; offer choices via your question tool; never spend tokens or change config without a chosen option.

**Config reads — every config key, always the CASCADE, never the bare project file:** `~/.claude/.coalmine.json` first, then the project config (own agent dir → other known agent dirs → legacy `<gitroot>/.coalmine.json`), project wins per key. A bare project read is ABSENT on a machine configured only globally, so it silently yields defaults.

**ask** — present the 3-way choice via your question tool:
- **auto** — the agent web-checks on a ~`updateCheckDays` cadence and offers updates (~1-2K tokens/check).
- **remind** — a free periodic reminder; the user runs the update themselves.
- **off** — no reminders.

Save the pick (no forced check — the chosen mode drives future sessions):
`node scripts/configure.mjs --updateMode <auto|remind|off>` (run from the CoalMine repo, or wherever `.coalmine.json` lives).

**auto** (the version CHECK — the only token spend, standing-consented):
1. Get the latest published tag (graceful — never assume git/network is present):
   `git ls-remote --tags --sort=-v:refname https://github.com/HetCreep/CoalMine.git | head -1`
   (parse the trailing `vX.Y.Z`; ignore `^{}` deref lines).
2. Compare to the installed version in `.claude-plugin/plugin.json` (the plugin cache copy, or the repo copy if working from source).
3. If a newer tag exists → OFFER (don't auto-run): `claude plugin update coalmine@coalmine` then `/reload-plugins`. If current → "up to date." 
4. **Graceful fallback (no-external-assumption):** if `git ls-remote` fails, git is missing, or there is no network, say "Can't check for updates offline — update manually with `claude plugin update coalmine@coalmine` when you're back online" and stop. Never crash, never assume a version.

**remind** — nothing for the agent to do; the conductor already surfaced the free reminder line. (If invoked manually, run the **auto** check above on request.)

**off** — no update activity.

Rule freshness (a separate, free, local nudge the conductor also raises): if gold-standard `coalmine: verified` stamps in `.claude/rules/`, `.agents/rules/`, or `AGENTS.md` are past their `revalidate Nd` date, offer `/gold-standard` RE-VALIDATE — see `/coalmine:stats` for the per-rule table. This is local-only and never spends tokens.
