<div align="center">

# 🐤 CoalMine

> *A mine's canary dies first so the miners live — these nine die first so your codebase lives.*

**9 Quality-Safeguard Canaries for AI Coding Agents** — Detect code rot, weak rules, hallucinations, supply-chain vulnerabilities, brittle architectures, and API contract drift before they pollute your codebase.

![version](https://img.shields.io/github/v/tag/TheColliery/CoalMine?label=version&color=blue)
![license](https://img.shields.io/badge/license-Apache_2.0-blue)
![status](https://img.shields.io/badge/status-live-brightgreen)
![SKILL.md](https://img.shields.io/badge/SKILL.md-open_standard_·_major_agents-success)
![skills](https://img.shields.io/badge/skills-9-success)

![Claude Code](https://img.shields.io/badge/Claude_Code-validated-brightgreen)
![Antigravity](https://img.shields.io/badge/Antigravity-validated_canaries_·_primed_auto--cadence-brightgreen)
![Cursor](https://img.shields.io/badge/Cursor-works_with-blue)
![Codex](https://img.shields.io/badge/Codex-works_with-blue)
![Gemini CLI](https://img.shields.io/badge/Gemini_CLI-works_with-blue)
![Cline](https://img.shields.io/badge/Cline-works_with-blue)
![Copilot](https://img.shields.io/badge/Copilot-works_with-blue)
![claude.ai](https://img.shields.io/badge/claude.ai-ZIP_upload_confirmed_2026--10--09-blue)

[Design Principles](https://github.com/TheColliery/.github/blob/main/DESIGN-PRINCIPLES.md) · [Benchmark](https://github.com/TheColliery/.github/tree/main/benchmarks/CoalMine) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md) · [Releases](https://github.com/TheColliery/CoalMine/releases)

**Docs:** [thecolliery.gitbook.io/thecolliery-docs/tools/coalmine](https://thecolliery.gitbook.io/thecolliery-docs/tools/coalmine) *(publishing soon)*

**Part of [TheColliery](https://github.com/TheColliery)** — siblings: **[CoalTipple](https://github.com/TheColliery/CoalTipple)** (model/effort routing) · **[CoalBoard](https://github.com/TheColliery/CoalBoard)** (consensus & debate board) · **[CoalHearth](https://github.com/TheColliery/CoalHearth)** (session warm-resume) · **[CoalFace](https://github.com/TheColliery/CoalFace)** (fan-out discipline) · **[CoalWash](https://github.com/TheColliery/CoalWash)** (memory defrag) · **[CoalLedger](https://github.com/TheColliery/CoalLedger)** (docs health).

</div>

---

## 🐤 The 9 Canaries

| Skill Name | Catches | Run Mode |
|---|---|---|
| **`rot-canary`** | Dead code, bugs, resource leaks, race conditions, silent failures, stale docs | **Auto + Manual** (runs on session end / manual trigger) |
| **`gold-standard`** | Audits project completeness against world-class exemplars | **One-time** (triggered once, governs the session) |
| **`source-grounding`** | Prevents AI hallucinations by forcing cross-source verification | **Standing rule** (always on only where your own `CLAUDE.md` or `AGENTS.md` carries it; CoalMine writes no such file) · offered at session start on version-sensitive work · `/source-grounding` on demand |
| **`supply-chain-audit`** | Audits dependency vulnerabilities, licenses, phone-home code, and build/CI security | **On-demand** (manually run when relevant) |
| **`resilience-audit`** | Audits failure path handling (FMEA), rollbacks, retry limits, and idempotency | **On-demand** (manually run when relevant) |
| **`telemetry-canary`** | Audits observability, log structures, metrics, and telemetry quality | **On-demand** (manually run when relevant) |
| **`testability-canary`** | Audits testing ease, code coupling, mockability, and Dependency Injection (DI) | **On-demand** (manually run when relevant) |
| **`scale-canary`** | Audits performance scaling issues, $O(N^2)$ loops, and duplicate (N+1) database queries | **On-demand** (manually run when relevant) |
| **`drift-canary`** | Prevents contract and schema drift (API/database contract inconsistencies) | **On-demand** (manually run when relevant) |

*Run Mode Details:*
* 📌 **Standing rule:** `source-grounding` is a rule for your agent, not a background process. It is always on where your own `CLAUDE.md` or `AGENTS.md` says so (CoalMine does not write that line for you); otherwise the session-start conductor offers it when you work on version-sensitive facts, and `/source-grounding` runs it on demand.
* 🔄 **Auto + Manual:** Scans affected files at session end via lifecycle hooks (auto-wired in Claude Code; manual snippets in [`platform-configs/hooks/`](platform-configs/hooks/) for other agents). Manual trigger via `/rot-canary`.
* ⚡ **One-time:** Governs the session by scanning and filling project-local rules.
* 🎯 **On-demand:** Manually run for specific tasks to conserve tokens.

*Canaries follow **grounding in evidence, zero grade inflation, and report before fixing**. Fixes apply through a safe loop: checkpoint, baseline build and tests, apply the fix, build and tests again, and auto-revert only on a NEW failure.*

*Em-dash typography (`unspaced`/`spaced`/`off`, house style) is not one of the 9 — that rule belongs to [CoalLedger](https://github.com/TheColliery/CoalLedger)'s `doc-quality` canary (`emDash` config key, factory default `off`), never duplicated here.*

---

## 🔌 Universal Agent Support

`SKILL.md` is an **open standard** compatible with all major AI coding agents:

| AI Agent | Target Skills Folder | Installation Shortcut | Choice Tool Support |
|---|---|---|---|
| **Claude Code** | plugin cache (recommended) or `~/.claude/skills/` | `/plugin install coalmine@coalmine` | ✅ **Native:** `AskUserQuestion` |
| **Antigravity** | `.agents/skills/` | `node scripts/install.mjs antigravity` | ✅ **Native:** built-in question prompt |
| **Cursor** | `.cursor/skills/` | `node scripts/install.mjs cursor` | ✅ **Native:** built-in ask-question tool |
| **Devin Desktop (ex-Windsurf)** | `.windsurf/skills/` | `node scripts/install.mjs windsurf` | ✅ **Native:** `suggested_responses` |
| **GitHub Copilot** | `.github/skills/` | `node scripts/install.mjs copilot` | ✅ **Native:** `askQuestions` |
| **Cline** | `.claude/skills/` | `node scripts/install.mjs cline` | ✅ **Native:** `ask_question` |
| **Gemini CLI (business-tier; individual tiers ended 2026-06-18 → Antigravity CLI)** | `.gemini/skills/` | `node scripts/install.mjs gemini` | ✅ **Native:** `ask_user` |
| **Goose** | `.agents/skills/` | `node scripts/install.mjs goose` | ⚠️ **Text Fallback:** no question tool |
| **Amp** | `.agents/skills/` | `node scripts/install.mjs amp` | ⚠️ **Text Fallback:** tool not documented |
| **Junie** | `.junie/skills/` | `node scripts/install.mjs junie` | ⚠️ **Text Fallback:** tool not documented |
| **Codex** | `.agents/skills/` | `node scripts/install.mjs codex` | ✅ **Native:** `request_user_input` |
| **Kiro** | `.kiro/skills/` | `node scripts/install.mjs kiro` | ⚠️ **Text Fallback:** tool not documented |
| **Augment Code** | `.augment/skills/` | `node scripts/install.mjs augment` | ⚠️ **Text Fallback:** tool not documented |

*Skill paths follow the cross-vendor [Agent Skills spec](https://agentskills.io/specification). Cline reads `.claude/skills/`, Junie reads `.junie/skills/`, Kiro reads `.kiro/skills/`, Augment reads `.augment/skills/`, others use `.agents/skills/`.*

### What ports where

| Part | Portable? |
|---|---|
| The 9 skills (the audits) | ✅ All targets natively via Agent Skills spec |
| Interactive choice menus (`ask_question`) | ✅ Native question tools on most agents; text fallback on Goose/Amp/Junie |
| Sub-agent fan-out + tiers | ✅ Supported if host has sub-agent system; inline fallback |
| rot-canary **auto-cadence** | ✅ Auto-wired on Claude Code; 🔧 primed on Antigravity 2.0 via a one-time `hooks.json` copy (see Install) + manual snippets in [`platform-configs/hooks/`](platform-configs/hooks/) for other hook-capable agents; ⛔ unsupported on Cline/Junie |

**Manual Fallback:** Copy conformed skill body from [`plugin/skills/<name>/SKILL.md`](plugin/skills/) (strip YAML frontmatter) into `AGENTS.md` / rules file.

---

## 🚀 Install

**Per-platform, at a glance** — every canary is a read/analyze skill, so it runs wherever a `SKILL.md` loads; only the `rot-canary` auto-cadence hook is host-dependent (Claude Code auto-wires it; a manual snippet covers other hook-capable hosts).

| Platform | Tier | Install |
|---|---|---|
| **Claude Code** | validated | `/plugin marketplace add TheColliery/CoalMine` → `/plugin install coalmine@coalmine` (Option A) — auto-wires the `rot-canary` Stop-hook |
| **Antigravity** | validated (canaries) · **primed** (auto-cadence) | file-copy the skills to the global `~/.gemini/config/skills/` **or** per-project `<workspace>/.agents/skills/` (`node scripts/install.mjs antigravity`); for the full auto-cadence (conductor + rot-canary) on AG 2.0's hook engine, copy [`platform-configs/hooks/antigravity-hooks.json`](platform-configs/hooks/antigravity-hooks.json) to `<workspace>/.agents/hooks.json` or `~/.gemini/config/hooks.json` and adjust the CoalMine path |
| **Cursor · Codex · Cline · Copilot · Gemini CLI · …** | works with | `node scripts/install.mjs <agent>` — file-copy into the agent's skills folder (targets in [Universal Agent Support](#-universal-agent-support)) |
| **claude.ai** (web / app) | upload confirmed 2026-10-09 (`rot-canary.zip`) | Download a per-skill ZIP from [Releases](https://github.com/TheColliery/CoalMine/releases) and upload it as a custom skill (Option A3; Customize > Skills) — read/analyze skills only, manual invocation, no hooks. Confirmed 2026-10-09 by uploading `rot-canary.zip` (the v3.22.2 asset, one of nine ZIPs built the same way) in two accounts: accepted, security scan passed, listed under "Created by you". Not tested: a lower-case `skill.md`, the 201-byte description case (`telemetry-canary`), and the other eight ZIPs |

**primed** (the Antigravity auto-cadence status — a feature-automation marker, never a platform-trust tier; Antigravity's own platform tier is `validated` above, independent of this) = built + hermetically tested against the AG 2.0 hook spec (corroborated against the official docs 2026-07-13). **Firing itself is UNRESOLVED, not confirmed:** a 2026-07-12 pilot fired CoalMine's Stop cadence live on AG; a more isolated 2026-08-04 re-test on a real AG 2.0 install recorded ZERO fires across a real tool call. Neither measurement is retracted — see [`antigravity-hooks.json`](platform-configs/hooks/antigravity-hooks.json)'s own `$comment` — probe a copy of your own config before relying on it. Delivery of the injected context into the agent is separately unconfirmed end-to-end even when firing does occur. The 9 canaries themselves are already validated on AG — skill invocation, not the auto-cadence hooks, is what that covers.

### Option A — Claude Code Plugin (No clone needed)
```text
/plugin marketplace add TheColliery/CoalMine
/plugin install coalmine@coalmine
```

> 🔧 **Maintainers:** `plugin/` is generated output. After edits in `skills/`, `skills/_shared/`, `hooks/`, or `.claude-plugin/plugin.json`, run `node scripts/build-plugin.mjs`.

### Option A2 — skills.sh (One line)
```bash
npx skills add TheColliery/CoalMine/plugin
```
Installs the 9 rendered skills from `plugin/skills/` as files: manual invocation only, no hooks. Point it at `/plugin`. The bare `TheColliery/CoalMine` form installs the unrendered `skills/` templates. (Path read from the `skills` CLI v1.7.0 source; not yet confirmed by a run.)

### Option A3 — claude.ai (web / desktop app)
Download a canary's ZIP from the [Releases page](https://github.com/TheColliery/CoalMine/releases) (one asset per skill, built by CI on every tag) and upload it as a custom skill, then turn it on under **Customize > Skills** in claude.ai or the desktop app (the path Anthropic's skills guide documents). Manual invocation only — no hooks there. **Status: confirmed 2026-10-09 by uploading `rot-canary.zip`** (the v3.22.2 asset; one of the nine ZIPs, all built the same way) in two accounts. claude.ai accepted it, the security scan passed, and it is listed under "Created by you" with its name and description. The upload box says a `.zip` or `.skill` file must include a `SKILL.md`, and that the `.md` file must hold the skill name and description as YAML; the upper-case `SKILL.md` passed, `skill-meta.json` caused no refusal, and the description is read decoded (rot-canary's quoted triggers showed as real quotes). The synced skill reached a Claude Code session as `anthropic-skills:rot-canary` within minutes. **Not tested:** a lower-case `skill.md`, the 201-byte description case (`telemetry-canary`), and the other eight ZIPs (not uploaded). Anthropic's guide says the ZIP must hold the skill's folder at its top level, so the archive contains `<skill-name>/SKILL.md`, and that a `SKILL.md` at the root of the ZIP is not recognized as a skill. CoalMine's CI zips each skill folder from its parent and checks every archive entry before upload (`scripts/build-claude-ai-zips.mjs` and the release workflow), and that workflow built the v3.22.2 asset above. One uploaded ZIP is not a platform run of the suite, so this path still carries no platform-tier word (validated or "works with"). ZIPs from Releases before this fix put `SKILL.md` at the archive root, which Anthropic's guide says is not recognized: download again. To check a ZIP yourself, run `unzip -l rot-canary.zip` (swap in your ZIP): every entry should start with `rot-canary/`. **Don't hand-zip `skills/` yourself** — those are unrendered templates (their shared sections are still markers); the Release ZIPs are built from the rendered `plugin/skills/` copies. Each ZIP carries the skill description trimmed to 200 characters, a conservative house cap (Anthropic documents 1,024), until one real upload at the longer length is on record. Each Release also carries a `SHA256SUMS.txt` covering every ZIP — you'll typically have just the one skill's ZIP, not all nine, so verify with `sha256sum --ignore-missing -c SHA256SUMS.txt` (the plain `-c` form reports the other eight as FAILED). On Windows: `$f='rot-canary.zip'; (Get-FileHash $f).Hash -ieq (Select-String $f SHA256SUMS.txt).Line.Split()[0]` (swap in the ZIP you downloaded). Steps + capability notes: [CLAUDE-AI-INSTALL](https://github.com/TheColliery/.github/blob/main/CLAUDE-AI-INSTALL.md).

### Option B — Universal Installer

#### 1. Clone the Repository
```bash
git clone https://github.com/TheColliery/CoalMine.git
```

#### 2. Run the Installer
Run from **your project's root folder** (not inside the CoalMine clone):
```bash
cd /path/to/your-project
node /path/to/CoalMine/scripts/install.mjs <agent|all|PATH>
```
* Supported `<agent>`: `antigravity`, `cursor`, `codex`, `cline`, `copilot`, `windsurf`, `amp`, `goose`, `junie`, `gemini`, `kiro`, `augment` (for `claude`, prefer the plugin above) — see [Universal Agent Support](#-universal-agent-support) for target folders + choice-tool support.
* `all` auto-detects and installs to all configured agents in the directory.
* The installer puts a small pre-commit and pre-push hook where git actually reads hooks — your `core.hooksPath` if the repo sets one (a leading `~` is expanded the way git does), otherwise `.git/hooks`. That hook only runs the hook it replaced (kept beside it as `<hook>.pre-coalmine`, with its exit status and arguments passed through); it never runs CoalMine's own test and verify gate in your repo. A hook your repo tracks (husky, lefthook, a versioned `.githooks/`) is not rewritten: the installer prints `[refused] <hook>: <reason>` and exits non-zero. It also writes trigger rules and generates `.coalmine.json` config. Every write stays inside the project (or the install target you named), with one exception: the git hook goes where `core.hooksPath` points, and when that folder is outside the project (a shared hooks folder) the installer prints a `NOTE` that the change applies to every repo using it, and it will not create such a folder. A path that is a symbolic link, or that resolves outside it, is refused with `[refused] <path>: <reason>` and exit 1 — the installer never writes through a link ([security advisory](SECURITY.md#-security-advisories)).

#### 3. Verify & Uninstall
* **Verify:** `node /path/to/CoalMine/scripts/verify.mjs <agent|PATH>`
* **Uninstall:** `node /path/to/CoalMine/scripts/install.mjs --uninstall <agent|PATH>` — removes CoalMine's own git hooks, but never a **tracked** one: if `core.hooksPath` points at a versioned directory (e.g. a repo's own `.githooks/`) and the hook there is ours, uninstall REFUSES rather than deleting a maintainer-owned file — it prints `[refused] <hook>: <reason>` and exits non-zero; remove it yourself (e.g. `git rm <hook>`) if you want it gone. Uninstall puts your backed-up hook back (`<hook>.pre-coalmine`) only over a hook that is CoalMine's; if you wrote a new hook there since, both files stay, it prints `[kept] <hook>: <reason>` and exits non-zero, and you merge them yourself. A skill folder the install manifest names is removed only when every file in it matches the hash the manifest recorded; otherwise it is kept with a `[kept]` line and a non-zero exit. A linked path is refused the same way on uninstall.

---

## Commands

| Command | What it does |
|---|---|
| **the 9 canaries** | See [The 9 Canaries](#-the-9-canaries) — each triggers on its own name/keywords (e.g. `/rot-canary`) or matching conversation context |
| `/coalmine:stats` | Measurement dashboard — canary activity this session + rule-freshness status across the project's rules home |
| `/coalmine:update` | Self-update — check for a newer CoalMine version and offer to apply it, or set how updates are handled |

---

## 🔋 One button: install — the suite drives itself

Installing is the power button. The agent conducts the canaries and asks for consent before running expensive tasks:

| What | When it fires | Your part |
|---|---|---|
| **gold-standard** | Offered once on new projects, and again when a rule's `revalidate` date passes | Run now / Queue / Skip |
| **rot-canary** | Auto-scans touched files at session end (QUICK); findings end with a fix menu | Choose a fix option |
| **memory-drift advisory** | One quiet `systemMessage` (reaches the session transcript and an interactive user) at session end when code changed but no MEMORY.md update was recorded — not part of the scan report, never blocks; needs a root MEMORY.md, off via `memoryDriftNudge=false` | Update MEMORY + crystallize if worth keeping |
| **Specialists** | Offered when conversation enters their domain (deps, schemas, async, loops, etc.) | Accept / Skip |
| **source-grounding** | Standing rule for version-sensitive facts: always on where your `CLAUDE.md` or `AGENTS.md` carries it, offered at session start, `/source-grounding` on demand | — |

*Consent Rule:* Nothing expensive runs silently. Revocable via `.coalmine.json`, `~/.claude/.rot-canary-off`, or `--uninstall`.

---

## ⚙️ Configure (.coalmine.json)

Zero-config to start — and two config levels when you want them: a global `~/.claude/.coalmine.json` overlaid per key by the project config (project wins), so a globally-installed CoalMine can be tuned or **shut off per project** — a project that doesn't need it stops loading (and burning tokens) there (`disabledCanaries: ["all"]` is the full off-switch; `enableConductor: false` silences only the session-start conductor, leaving rot-canary's auto-scan running).

<!-- namespace-campaign rail: this wording is copied verbatim into every sibling room's README Configure section, one flock -->
**Where the per-project config lives — the read order (identical across the series, one flock):** (1) `<project>/.<the running agent's own dir>/coal/coalmine.json` — the dir of the agent actually executing (Claude Code: `.claude`, i.e. `<project>/.claude/coal/coalmine.json` — the canonical path); (2) other known agent dirs, fixed order `.claude` → `.agents` → `.gemini` (first found wins); (3) LEGACY, both **DEPRECATED**: `<project>/.claude/.coalmine.json`, then `<project>/.coalmine.json` at the project root (the pre-2026-08-08 shape) — first found wins after the three above, both still read normally, no breakage for an existing config. **Deprecation notice:** the replacement is the canonical path `<project>/.claude/coal/coalmine.json`; both legacy paths are deprecated as of the release named by the `### Deprecated` entry in [CHANGELOG.md](CHANGELOG.md) and removable no earlier than the next MAJOR (deprecated at a MINOR, removable at a MAJOR — this series' SemVer boundary, not a calendar window); CoalMine owns the migration (`configure.mjs`, below). **No runtime warning is printed:** hooks stay silent (Phoenix #13), so nothing appears in your terminal — this note and the CHANGELOG are the channel. The one runtime signal is a single line in the session-start conductor's context asking the agent to relay the move, and a config sitting at a path the walk never reads (for example `<project>/.agents/.coalmine.json`) is reported the same way as IGNORED, since its settings have no effect. The installer generates the default at the new own-dir home for a never-configured project (an existing config at any candidate, including either legacy path, is left alone); `node scripts/configure.mjs` writes back wherever the config was found, migrating a legacy-location config to the new own-dir home on that write (nothing is auto-moved on a mere read). Write the global layer with `node scripts/configure.mjs --global <flags>`. The high-impact keys:

| Key | Default | What it does |
|---|---|---|
| `language` | `auto` | Language for prompts and nudges (`auto` \| `en` \| `th` \| `ja` \| `zh` \| `es`) |
| `enableConductor` | `true` | Master switch for rules injection at session start |
| `rotCanaryMode` | `auto` | rot-canary session-end auto-scan (`auto` \| `manual` \| `off`) |
| `updateCheckDays` | `14` | Days between self-update checks or reminders (1-365; a value outside that range falls back to 14) |
| `memoryDriftNudge` | `true` | Quiet session-end advisory when code changed but MEMORY.md didn't — no report, never blocks (needs a root MEMORY.md) |
| `defaultTier` | `auto` | Force an execution tier (`Light` \| `Standard` \| `Heavy` \| `auto`) |
| `disabledCanaries` | `[]` | Canaries to disable (e.g. `["rot-canary"]` or `["all"]`) |
| `scanExcludePaths` | `[]` | Path fragments/globs (`*` wildcard, `/` separator on every OS), matched against the project-relative path, so `**/scratchpad/**` works at any depth, skipped by the session-end auto-scan — lab tooling only (scratch probes, one-shot harnesses); shipped/tracked source is never excluded by this key |
| `scanEverything` | `false` | **The override.** `true` bypasses EVERY scan-scope cut for the run — `scanExcludePaths` ignored, `autoScanFileCap` not applied. Positive polarity: `true` = more scanning. Does NOT re-enable a disabled canary, and does not reach the recording-side cuts (`watchedExtensions`, tmpdir) or the tripwire's own `tripwireMaxFileSizeKb` cap (that file is still recorded and still scanned — only its edit-time pre-flag is skipped). **Clamped safer-value-wins:** a project-level `true` is forced to `false` unless your global layer also says `true`, so a cloned repo cannot force a full scan on your machine |

<!-- flock-canonical sentence (UMB-174): copied verbatim into every sibling room's README Configure section; only the skill name and the two canonical paths change -->
**`autoFixMode` is not clamped.** The agent reads `autoFixMode` from the config files itself; the hooks' safer-value clamp never sees it (it covers `updateMode`, `enableConductor`, `rotCanaryMode`, `disabledCanaries` and `scanEverything`). A project config is overlaid per key and the project wins, so a cloned repository's `.coalmine.json` can set `autoFixMode: "safe"`, and then `rot-canary` applies its safe-class fixes in an interactive session (a session-end scan included) without showing the menu; a non-interactive `claude -p` run stays report-only. A global value is not a floor here: it does not stop a project from setting the key. What does work: read a cloned repository's `.coalmine.json` (or `.claude/coal/coalmine.json`) before you open it there; or set `rotCanaryMode` to `"off"` or `"manual"` in your global config, which a project cannot raise, so no session-end scan runs in any repository (a manual `/rot-canary` still reads the project key); or list `"rot-canary"` in the global `disabledCanaries`, which a project can add to but not remove from.

**Which folder counts as "the project".** The `rot-canary` Stop and touch hooks find the project config from the folder the agent started them in (their working directory), not from a workspace path in the hook's event data. The session-start conductor's Antigravity and Gemini CLI adapters do read the workspace path from the event. If your agent starts hooks in a different folder from the one you work in, put the config where the hooks' folder finds it, or use the global `~/.claude/.coalmine.json`.

**A config that exists but cannot be read.** If the project config the read order above selects, or the global config, is malformed JSON, is a directory, cannot be opened (permissions), or is valid JSON that is not an object, the session-start context carries one line in exactly this wording, and the file is skipped as if it were absent: `UNREADABLE: <path> exists but is not a readable config (<reason>); it was skipped — canonical = <canonical>`. `<reason>` is `malformed JSON`, `a directory`, `unreadable` or `not a JSON object`; `<canonical>` is the config path for that level (`.claude/coal/coalmine.json` for a project, `~/.claude/.coalmine.json` for the global file). Fix the file, or delete it, and start a new session. The line never changes which config is used, and a config refused by the link and size rule below stays silent.

**A config that is a link, or oversized.** The project config, and the rule files the conductor scans (`AGENTS.md`, `.claude/rules/**`), come with a cloned repository, so a repo can plant a link at any of those paths. The hooks read such a file only when it is a regular file, or a symlink whose target resolves inside the project and is a regular file; a link that escapes the project, a FIFO or device, or a file over 1 MiB (configs) or 4 MiB (governance docs) is **ignored** as if absent (the hooks print nothing — Phoenix #13). `node scripts/configure.mjs` **refuses** such a path instead (exit 1, the path named), never reading, backing up or overwriting through it; `--global` still writes through a link at `~/.claude/.coalmine.json`, on purpose, since dotfile managers link that file. The PowerShell fallback hooks refuse every reparse point, even one that stays inside the project. See the [security advisory](SECURITY.md#-security-advisories).

Full key reference: every key + default lives in [`scripts/lib/config-schema.mjs`](scripts/lib/config-schema.mjs) and the commented template [`platform-configs/.coalmine.json`](platform-configs/.coalmine.json) — or run `node scripts/configure.mjs --help`.

---

## Permissions

CoalMine asks for the least it needs: **read** (main + spawned scan workers, repo-scoped) · **exec** for read-only probes only (build `--dry`, lint, dead-code checks) · **scratch-write** confined to `os.tmpdir()` session state and one `~/.claude` update-check stamp · **ask** before any fix or spend. It never requests target-file writes or deletes, and its hooks/scripts never touch the network on their own — a canary's own web check (source-grounding, CVE lookups) is the agent's own judgment call through its normal tools, not a CoalMine background call. A spawned scan worker gets strictly less than the orchestrator: no Agent or Task tool of its own, no Edit or Write tool, no prompts to the user. It does hold `Bash` for read-only probes, and a shell can write, so its read-only rule is an instruction it follows, not a sandbox. Hooks auto-wire on Claude Code and carry a tested Antigravity 2.0 contract on the same files — capability-keyed, never a hardcoded platform list.

Full series matrix + the must-fail set: [Permission Matrix](https://github.com/TheColliery/.github/blob/main/PERMISSION-MATRIX.md)

---

## 📝 Ultra-Short Summary Format

Canaries report in a lean shape (one-line verdict + severity table of confirmed findings) to save tokens. Seven canaries (all but `gold-standard`/`source-grounding`, whose output isn't per-defect) call Claude Code's `ReportFindings` panel when it's callable — click-to-file, fix-lifecycle tracking, no chat duplication; the table below is the fallback wherever the panel tool isn't available:
```text
| # | path:line | category | severity | finding | evidence |
```
*Severity levels:* CRITICAL · HIGH · MEDIUM · LOW. Clean scan outputs a single line.

---

## ⚡ Escalation Tiers

| Tier | Trigger | Orchestration | Token Cost |
|---|---|---|---|
| **Light** | Small scope / targeted review | Primary agent, quick | Very Low 🟢 |
| **Standard** | Moderate scope / module review | Multi-threaded routing, detailed | Moderate 🟡 |
| **Heavy** | Large scope / release prep | Sub-agent fan-out, deep paths | High 🔴 |

---

## 📊 Benchmark

**Headline (measured 2026-07-03, skill v3.8.4):** 7 canaries measured over 82 fixtures (60 planted defects + 22 clean decoys) × 4 engines (Claude Fable 5 / Opus 4.8 / Sonnet 5 + Gemini 3.5 Flash), K=3-5 repeated runs per arm — **recall at 100% on 5 of 7 suites for every engine · zero decoy false alarms across the entire batch (~200 clean-file opportunities)** · the two suites that separate engines are drift-canary (88% median — engines split on which side is authoritative) and rot-canary (92% median on opus/haiku/AG — the one item needs whole-file reachability reasoning).

Each canary is measured AV-Comparatives-style — recall, precision, decoy false-positives, and severity accuracy over fixed fixture corpora, scored mechanically, cross-engine, with repeated runs (flips extend K per the locked methodology). **Honest scope:** small, dated samples authored in-project — a regression floor, not an independent benchmark; re-run on model/skill changes.

Full method, per-category scoring, and the cross-engine comparison live in the series records: [`TheColliery/.github/benchmarks/CoalMine`](https://github.com/TheColliery/.github/tree/main/benchmarks/CoalMine).

---

## 🧭 Design Principles

Bound by the 11 principles of the [Quantum Computer Spec](https://github.com/TheColliery/.github/blob/main/DESIGN-PRINCIPLES.md): maximum performance, zero visible errors, single-brand, minimum power, essential accessories, error correction, determinism, isolation, measurement, trustworthiness, and entanglement.

---

## 🧭 Part of TheColliery

CoalMine is the quality-safeguard canary suite of a family of sibling skills built to one engineering doctrine:

- [CoalTipple](https://github.com/TheColliery/CoalTipple) — model/effort routing
- [CoalBoard](https://github.com/TheColliery/CoalBoard) — consensus & debate board
- [CoalHearth](https://github.com/TheColliery/CoalHearth) — session warm-resume
- [CoalFace](https://github.com/TheColliery/CoalFace) — fan-out discipline
- [CoalWash](https://github.com/TheColliery/CoalWash) — memory defrag
- [CoalLedger](https://github.com/TheColliery/CoalLedger) — docs health

Install one, it stands alone; install all, they compose without conflict.

Also part of the family, not yet installable: **[CoalGob](https://github.com/TheColliery/CoalGob)**
(OS-trash delete guard, PUBLIC BETA v0.1.0-beta.1) — engine + tests ship, no skill/hook surface yet.

The shared doctrine: Phoenix-13 hooks (zero-dependency, no network, fail-silent, no child processes, deterministic), single-source-of-truth config schemas, and a strict no-overkill discipline. More at [TheColliery](https://github.com/TheColliery).

---

## 📄 License

Apache License 2.0. See [LICENSE](LICENSE) for details.
