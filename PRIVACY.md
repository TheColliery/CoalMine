# CoalMine Privacy Policy

**CoalMine collects nothing and phones nowhere.**

- **No telemetry.** No usage data, analytics, or identifiers are collected, stored, or transmitted — by the skills, the hooks, the installer, or any bundled component.
- **No network calls from hooks.** The bundled hooks (`coalmine-conductor`, `rot-canary-touch`, `rot-canary-stop`) are offline by design (Phoenix Commandment #7). They write only to your OS temp directory (session markers, self-cleaned) and, under `~/.claude/`, a local update-check date stamp (`coal/coalmine/update-check` — migrated 2026-08-08 from the pre-campaign root `.coalmine-update-check`, which is still read as a fallback and deleted on the next write) and the mode/opt-out files you set (e.g. `.rot-canary-mode`) — all local, none transmitted.
- **Skills run inside YOUR agent.** Any web lookups a canary performs (e.g. CVE verification against GHSA/OSV/NVD) are executed by your own AI agent under your own account, on your explicit choice via a consent menu — CoalMine itself operates no servers and receives no traffic.
- **`/coalmine:stats` is computed locally.** The dashboard reads canary activity and rule-freshness from your own files; nothing is calculated remotely or reported anywhere.
- **Error reports are manual.** When a component misbehaves, your agent may OFFER to open a pre-filled GitHub issue form; nothing is ever submitted automatically, and you see and edit the full contents before sending.
- **Local files only.** Per-project state lives in files you can read: the config (`<project>/.claude/coal/coalmine.json` by default — or another known agent dir, or the legacy `<project>/.coalmine.json` from before 2026-08-08 — see README's Configure section for the full read order), `.coalmine-manifest.json` (per install target), and temp session markers that self-clean within 7 days.

Questions: open an issue at <https://github.com/HetCreep/CoalMine/issues>.
