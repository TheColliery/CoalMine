<div align="center">

# 🐤 CoalMine

> *A mine's canary dies first so the miners live — these nine die first so your codebase lives.*

**9 Quality-Safeguard Canaries for AI Coding Agents** — Detect code rot, weak rules, hallucinations, supply-chain vulnerabilities, brittle architectures, and API contract drift before they pollute your codebase.

![version](https://img.shields.io/github/v/tag/HetCreep/CoalMine?label=version&color=blue)
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
![claude.ai](https://img.shields.io/badge/claude.ai-works_with-blue)

[Design Principles](https://github.com/TheColliery/.github/blob/main/DESIGN-PRINCIPLES.md) · [Benchmark](https://github.com/TheColliery/.github/tree/main/benchmarks/CoalMine) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md) · [Releases](https://github.com/HetCreep/CoalMine/releases)

**Part of [TheColliery](https://github.com/TheColliery)** — siblings: **[CoalTipple](https://github.com/TheColliery/CoalTipple)** (model/effort routing) · **[CoalBoard](https://github.com/TheColliery/CoalBoard)** (consensus & debate board) · **[CoalHearth](https://github.com/TheColliery/CoalHearth)** (session warm-resume) · **[CoalFace](https://github.com/TheColliery/CoalFace)** (fan-out discipline) · **[CoalWash](https://github.com/TheColliery/CoalWash)** (memory defrag) · **[CoalLedger](https://github.com/TheColliery/CoalLedger)** (docs health).

</div>

---

## 🐤 The 9 Canaries

| Skill Name | Catches | Run Mode |
|---|---|---|
| **`rot-canary`** | Dead code, bugs, resource leaks, race conditions, silent failures, stale docs | **Auto + Manual** (runs on session end / manual trigger) |
| **`gold-standard`** | Audits project completeness against world-class exemplars | **One-time** (triggered once, governs the session) |
| **`source-grounding`** | Prevents AI hallucinations by forcing cross-source verification | **Always-on** (background rule for all chat sessions) |
| **`supply-chain-audit`** | Audits dependency vulnerabilities, licenses, phone-home code, and build/CI security | **On-demand** (manually run when relevant) |
| **`resilience-audit`** | Audits failure path handling (FMEA), rollbacks, retry limits, and idempotency | **On-demand** (manually run when relevant) |
| **`telemetry-canary`** | Audits observability, log structures, metrics, and telemetry quality | **On-demand** (manually run when relevant) |
| **`testability-canary`** | Audits testing ease, code coupling, mockability, and Dependency Injection (DI) | **On-demand** (manually run when relevant) |
| **`scale-canary`** | Audits performance scaling issues, $O(N^2)$ loops, and duplicate (N+1) database queries | **On-demand** (manually run when relevant) |
| **`drift-canary`** | Prevents contract and schema drift (API/database contract inconsistencies) | **On-demand** (manually run when relevant) |

*Run Mode Details:*
* 📌 **Always-on:** Runs implicitly in the background to verify facts.
* 🔄 **Auto + Manual:** Scans affected files at session end via lifecycle hooks (auto-wired in Claude Code; manual snippets in [`platform-configs/hooks/`](platform-configs/hooks/) for other agents). Manual trigger via `/rot-canary`.
* ⚡ **One-time:** Governs the session by scanning and filling project-local rules.
* 🎯 **On-demand:** Manually run for specific tasks to conserve tokens.

*Canaries follow **grounding in evidence, zero grade inflation, and report before fixing**. Fixes apply through a safe loop: `Stash/Commit -> Apply fix -> Run build+tests -> Auto-revert if tests fail`.*

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
| **Claude Code** | validated | `/plugin marketplace add HetCreep/CoalMine` → `/plugin install coalmine@coalmine` (Option A) — auto-wires the `rot-canary` Stop-hook |
| **Antigravity** | validated (canaries) · **primed** (auto-cadence) | file-copy the skills to the global `~/.gemini/config/skills/` **or** per-project `<workspace>/.agents/skills/` (`node scripts/install.mjs antigravity`); for the full auto-cadence (conductor + rot-canary) on AG 2.0's hook engine, copy [`platform-configs/hooks/antigravity-hooks.json`](platform-configs/hooks/antigravity-hooks.json) to `<workspace>/.agents/hooks.json` or `~/.gemini/config/hooks.json` and adjust the CoalMine path |
| **Cursor · Codex · Cline · Copilot · Gemini CLI · …** | works with | `node scripts/install.mjs <agent>` — file-copy into the agent's skills folder (targets in [Universal Agent Support](#-universal-agent-support)) |
| **claude.ai** (web / app) | works with | Download a per-skill ZIP from [Releases](https://github.com/HetCreep/CoalMine/releases) and upload as a custom skill (Option A3) — read/analyze skills only, manual invocation, no hooks |

**primed** (the Antigravity auto-cadence status — a feature-automation marker, never a platform-trust tier; Antigravity's own platform tier is `validated` above, independent of this) = built + hermetically tested against the empirically-verified AG 2.0 hook spec (pilot 2026-07-12 — which did fire CoalMine's Stop cadence live on AG; corroborated against the official docs 2026-07-13). Delivery of the injected context into the agent is emitted per spec but not yet confirmed end-to-end — one real AG session run flips it to confirmed. The 9 canaries themselves are already validated on AG.

### Option A — Claude Code Plugin (No clone needed)
```text
/plugin marketplace add HetCreep/CoalMine
/plugin install coalmine@coalmine
```

> 🔧 **Maintainers:** `plugin/` is generated output. After edits in `skills/`, `skills/_shared/`, `hooks/`, or `.claude-plugin/plugin.json`, run `node scripts/build-plugin.mjs`.

### Option A2 — skills.sh (One line)
```bash
npx skills add HetCreep/CoalMine
```

### Option A3 — claude.ai (web / desktop app)
Download a canary's ZIP from the [Releases page](https://github.com/HetCreep/CoalMine/releases) (one asset per skill, built by CI on every tag) and upload it as a custom skill (Settings → Capabilities → Skills). Manual invocation only — no hooks there. **Don't hand-zip `skills/` yourself** — our own frontmatter `description` runs up to our 1024-char cap, well past claude.ai's 200-char skill-listing limit; every published ZIP has its description deterministically trimmed to fit (`scripts/build-claude-ai-zips.mjs`, source `skills/*/SKILL.md` files are never edited). Each Release also carries a `SHA256SUMS.txt` covering every ZIP — you'll typically have just the one skill's ZIP, not all nine, so verify with `sha256sum --ignore-missing -c SHA256SUMS.txt` (the plain `-c` form reports the other eight as FAILED). On Windows: `$f='rot-canary.zip'; (Get-FileHash $f).Hash -ieq (Select-String $f SHA256SUMS.txt).Line.Split()[0]` (swap in the ZIP you downloaded). Steps + capability notes: [CLAUDE-AI-INSTALL](https://github.com/TheColliery/.github/blob/main/CLAUDE-AI-INSTALL.md).

### Option B — Universal Installer

#### 1. Clone the Repository
```bash
git clone https://github.com/HetCreep/CoalMine.git
```

#### 2. Run the Installer
Run from **your project's root folder** (not inside the CoalMine clone):
```bash
cd /path/to/your-project
node /path/to/CoalMine/scripts/install.mjs <agent|all|PATH>
```
* Supported `<agent>`: `antigravity`, `cursor`, `codex`, `cline`, `copilot`, `windsurf`, `amp`, `goose`, `junie`, `gemini`, `kiro`, `augment` (for `claude`, prefer the plugin above) — see [Universal Agent Support](#-universal-agent-support) for target folders + choice-tool support.
* `all` auto-detects and installs to all configured agents in the directory.
* The installer sets up pre-commit/pre-push gates where git actually reads hooks — your `core.hooksPath` if the repo sets one (husky, lefthook, a tracked `.githooks/`), otherwise `.git/hooks` — writes trigger rules, and generates `.coalmine.json` config.

#### 3. Verify & Uninstall
* **Verify:** `node /path/to/CoalMine/scripts/verify.mjs <agent|PATH>`
* **Uninstall:** `node scripts/install.mjs --uninstall <agent|PATH>` — removes CoalMine's own git hooks, but never a **tracked** one: if `core.hooksPath` points at a versioned directory (e.g. a repo's own `.githooks/`) and the hook there is ours, uninstall REFUSES rather than deleting a maintainer-owned file — it prints `[refused] <hook>: <reason>` and exits non-zero; remove it yourself (e.g. `git rm <hook>`) if you want it gone.

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
| **source-grounding** | Always-on background fact verification | — |

*Consent Rule:* Nothing expensive runs silently. Revocable via `.coalmine.json`, `~/.claude/.rot-canary-off`, or `--uninstall`.

---

## ⚙️ Configure (.coalmine.json)

Zero-config to start — and two config levels when you want them: a global `~/.claude/.coalmine.json` overlaid per key by the project config (project wins), so a globally-installed CoalMine can be tuned or **shut off per project** — a project that doesn't need it stops loading (and burning tokens) there (`disabledCanaries: ["all"]` is the full off-switch; `enableConductor: false` silences only the session-start conductor, leaving rot-canary's auto-scan running).

<!-- namespace-campaign rail: this wording is copied verbatim into every sibling room's README Configure section, one flock -->
**Where the per-project config lives — the read order (identical across the series, one flock):** (1) `<project>/.<the running agent's own dir>/coal/coalmine.json` — the dir of the agent actually executing (Claude Code: `.claude`); (2) other known agent dirs, fixed order `.claude` → `.agents` → `.gemini` (first found wins); (3) LEGACY: `<project>/.coalmine.json` at the project root (the pre-2026-08-08 shape) — still read normally, no breakage for an existing config. The installer generates the default at the new own-dir home for a never-configured project (an existing config at any candidate, including the legacy path, is left alone); `node scripts/configure.mjs` writes back wherever the config was found, migrating a legacy-location config to the new own-dir home on that write (nothing is auto-moved on a mere read). Write the global layer with `node scripts/configure.mjs --global <flags>`. The high-impact keys:

| Key | Default | What it does |
|---|---|---|
| `language` | `auto` | Language for prompts and nudges (`auto` \| `en` \| `th` \| `ja` \| `zh` \| `es`) |
| `enableConductor` | `true` | Master switch for rules injection at session start |
| `rotCanaryMode` | `auto` | rot-canary session-end auto-scan (`auto` \| `manual` \| `off`) |
| `memoryDriftNudge` | `true` | Quiet session-end advisory when code changed but MEMORY.md didn't — no report, never blocks (needs a root MEMORY.md) |
| `defaultTier` | `auto` | Force an execution tier (`Light` \| `Standard` \| `Heavy` \| `auto`) |
| `disabledCanaries` | `[]` | Canaries to disable (e.g. `["rot-canary"]` or `["all"]`) |
| `scanExcludePaths` | `[]` | Path fragments/globs skipped by the session-end auto-scan — lab tooling only (scratch probes, one-shot harnesses); shipped/tracked source is never excluded by this key |
| `scanEverything` | `false` | **The override.** `true` bypasses EVERY scan-scope cut for the run — `scanExcludePaths` ignored, `autoScanFileCap` not applied. Positive polarity: `true` = more scanning. Does NOT re-enable a disabled canary, and does not reach the recording-side cuts (`watchedExtensions`, tmpdir) or the tripwire's own `tripwireMaxFileSizeKb` cap (that file is still recorded and still scanned — only its edit-time pre-flag is skipped). **Clamped safer-value-wins:** a project-level `true` is forced to `false` unless your global layer also says `true`, so a cloned repo cannot force a full scan on your machine |

Full key reference: every key + default lives in [`scripts/lib/config-schema.mjs`](scripts/lib/config-schema.mjs) and the commented template [`platform-configs/.coalmine.json`](platform-configs/.coalmine.json) — or run `node scripts/configure.mjs --help`.

---

## Permissions

CoalMine asks for the least it needs: **read** (main + spawned scan workers, repo-scoped) · **exec** for read-only probes only (build `--dry`, lint, dead-code checks) · **scratch-write** confined to `os.tmpdir()` session state and one `~/.claude` update-check stamp · **ask** before any fix or spend. It never requests target-file writes or deletes, and its hooks/scripts never touch the network on their own — a canary's own web check (source-grounding, CVE lookups) is the agent's own judgment call through its normal tools, not a CoalMine background call. A spawned scan worker gets strictly less than the orchestrator: no spawn power of its own, no write/delete tools, no prompts to the user. Hooks auto-wire on Claude Code and carry a tested Antigravity 2.0 contract on the same files — capability-keyed, never a hardcoded platform list.

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

The shared doctrine: Phoenix-13 hooks (zero-dependency, no network, fail-silent, no child processes, deterministic), single-source-of-truth config schemas, and a strict no-overkill discipline. More at [TheColliery](https://github.com/TheColliery).

---

## 📄 License

Apache License 2.0. See [LICENSE](LICENSE) for details.
