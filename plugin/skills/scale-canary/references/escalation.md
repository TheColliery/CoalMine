<!-- coalmine: verified 2026-07-23 · revalidate 30d · shared escalation detail for all canaries -->
# Heavy-tier escalation — per-platform levers & durability

Read this only before a **Heavy** run (deep fan-out). Light/Standard never need it.

## Per-platform Heavy lever
Use your host's, if it has concurrent fan-out:

- **Claude Code** → Dynamic Workflows / `ultracode` (≤16 concurrent agents)
- **OpenAI Codex** → `xhigh` + subagents + Cloud `--attempts`
- **Cursor** → Max Mode + parallel Cloud Agents
- **Amp** → Oracle + subagents
- **GitHub Copilot** → `/fleet` (Copilot CLI) + Cloud agent
- **Goose** → subagents
- **JetBrains** → Junie CLI
- **Gemini CLI (business-tier product; individual tiers ended 2026-06-18 → Antigravity CLI) / Cline (read-only) / Devin Desktop (ex-Windsurf)** → subagents

No concurrent fan-out on your host → escalate by model tier + reasoning depth only; never fake parallelism you cannot do.

⚠️ Subagent support CHURNS fast — most major agents added it through 2026 — so verify your platform's current capability rather than trusting this list.

## Heavy-run durability
Run in short phases, reading results between them. If a run dies, recover finished sub-agent results from your platform's run records and re-spawn only what is missing. On Claude Code, fan out with the bundled `coalmine-scanner` agent (read-only, one dimension per spawn, table output).
