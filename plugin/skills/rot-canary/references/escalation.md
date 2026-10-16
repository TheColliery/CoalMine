<!-- coalmine: verified 2026-10-14 · revalidate 30d · shared escalation detail for all canaries -->
# Heavy-tier escalation — per-platform levers & durability

Read this only before a **Heavy** run (deep fan-out). Light/Standard never need it.

## Per-platform Heavy lever
Use your host's, if it has concurrent fan-out:

- **Claude Code** → Dynamic Workflows / `ultracode` (up to 16 concurrent agents by default, fewer on a machine with fewer CPUs — code.claude.com/docs/en/workflows, re-read 2026-10-15)
- **OpenAI Codex** → `xhigh` + subagents + Cloud `--attempts`
- **Cursor** → parallel Cloud Agents (Max Mode is now only on legacy request-based plans, cursor.com/docs/models-and-pricing)
- **Amp** → Oracle + subagents (⚠️ unverified: check ampcode.com/manual, which named neither on 2026-10-14)
- **GitHub Copilot** → `/fleet` (Copilot CLI) + Cloud agent
- **Goose** → subagents (⚠️ unverified: check the Goose docs on subagents; the page tried returned 404)
- **JetBrains** → Junie CLI
- **Gemini CLI (business-tier product; individual tiers ended 2026-06-18 → Antigravity CLI) / Cline (read-only) / Devin Desktop (ex-Windsurf)** → subagents

No concurrent fan-out on your host → escalate by model tier + reasoning depth only; never fake parallelism you cannot do.

⚠️ Subagent support CHURNS fast — most major agents added it through 2026 — so verify your platform's current capability rather than trusting this list.

## Heavy-run durability
Run in short phases, reading results between them. If a run dies, recover finished sub-agent results from your platform's run records and re-spawn only what is missing. On Claude Code, fan out with the bundled `coalmine-scanner` agent (read-only, one dimension per spawn, table output).
