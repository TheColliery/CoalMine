# Contributing to CoalMine

CoalMine is the 9-canary quality-safeguard suite of the [TheColliery](https://github.com/TheColliery) series. Issues, bug reports, and pull requests are welcome.

---

## 🤝 Proposing a Change

1. **Open an issue first** describing the bug, false positive/negative, or proposed canary/rule change (especially for any `SKILL.md` edit).
2. Make the change and keep the verification gates green (below).
3. For detection behaviour, validate it against a real fixture — a finding must be grounded in evidence, never inflated.

---

## 💻 Developing & Testing

CoalMine is **zero-dependency** (Node.js built-ins only, Node 22+). No `npm install` is required.

Keep the gates green before and after editing:

```bash
node scripts/build-plugin.mjs   # re-inject the _shared regions into each skill + rebuild plugin/
node scripts/verify.mjs         # validate config, plugin sync, version pins, and dist-vs-CHANGELOG coverage
node scripts/test.mjs           # zero-dep unit + hermetic hook tests (node --test)
node scripts/consistency.mjs    # cross-doc counts, doctrine mirrors, well-formed stamps — gated via .githooks, not CI
```

This repo's own gates are tracked in `.githooks/`. Enable them once per clone — a fresh clone is ungated until you do (check with `git config --get core.hooksPath`):

```bash
git config core.hooksPath .githooks
```

pre-commit and pre-push then run `scripts/test.mjs`, `scripts/verify.mjs`, and `scripts/consistency.mjs` on every commit and push, plus the PowerShell parity tests when `pwsh` is on PATH. `consistency.mjs`'s doctrine-mirror check compares `.claude/rules/ecc/`/`.agents/rules/ecc/` at a resolved base — this repo's own root if it carries both trees, else its parent directory if that's where they live (the umbrella, `TheColliery/`, on the layout CoalMine ships from), else it silently compares nothing (a standalone clone with no rule home has nothing to check). It stays out of `verify.mjs`/CI on purpose — CI checks out only this repo, with no umbrella sibling to find.

`verify.mjs` also gates a missing `CHANGELOG.md` entry when the shipped `plugin/` dist changes (task #38) — it needs a reachable version tag as its baseline. `.github/workflows/ci.yml`'s checkout step now sets `fetch-depth: 0` (all history and tags — a CI run had no tag to compare against before this), so a tag should be reachable there too; that is a fact about the checkout step's configured inputs, not a confirmed CI result, since it hasn't been observed on a real run. The local pre-commit/pre-push gate is the one proven to catch a missing entry today.

### Development Rules
* **`skills/_shared/` is the Single Source of Truth** for shared blocks (language header, escalation footer, orchestration). Edit there, then run `node scripts/build-plugin.mjs` to re-inject; never hand-edit the generated regions inside a skill.
* **Rebuild `plugin/`** after editing `skills/`, `hooks/`, or `.claude-plugin/plugin.json` — it is generated output.
* **Keep hooks Phoenix-pure:** zero dependencies, fail-silent (wrap in try/catch, never set a non-zero exit, never call `process.exit()`), no network, 100% local. Every hook ships a hermetic spawn test.
* **Add unit tests:** every shared helper in `scripts/lib/` has a matching `*.test.mjs`.
* **Sandbox `HOME` in every installer/configure spawn:** a test or a manual probe of `install.mjs`/`configure.mjs` points `TEMP`/`TMP`/`TMPDIR`/`USERPROFILE`/`HOME` at an explicit fixture directory — separate from `cwd`, never folded into it — and never the operator's real machine. An **unsandboxed** spawn naming the bare `claude`/`all` target writes into the real `~/.claude/skills/`, and an unsandboxed `configure.mjs --global` writes `~/.claude/.coalmine.json`; sandboxed, both resolve harmlessly inside the fixture.
* **Code style:** 2-space indent, semicolons, single quotes, Node built-ins only.
* **Language:** shipped source and docs stay in English.

---

## 🖥️ Supported Platforms

`SKILL.md` is an open standard. CoalMine installs on Claude Code (plugin `coalmine@coalmine`) and any subagent-capable agent via `node scripts/install.mjs <agent|all>` (writes to that agent's skills folder, e.g. `.agents/skills/`). See the [README](README.md#-universal-agent-support) for the full agent matrix and what ports where.

**Two tiers, honestly.** Any subagent agent **works with** CoalMine through the open `SKILL.md` standard (the canaries just run) — usable today with no probe. The canaries are **validated** on Claude Code (full, with the auto-trigger hooks) and Antigravity (skills run; the hooks are Claude-Code-only). Validation follows *access*, not a request queue: if you run a platform we haven't, open an issue and we'll walk you through a one-off capability probe **you run** on your side, then we confirm it and add it to the validated matrix. The probe prompts stay private, and we never mark a platform "validated" until it's actually been run there — the free, open-standard path is always there; "validated" is earned by whoever has the platform.

---

## 🗂️ Project Layout

| Path | Purpose |
|---|---|
| `skills/<canary>/SKILL.md` | The 9 canary skills (the audits). |
| `skills/_shared/` | Shared blocks injected into each skill at build time. |
| `hooks/` | Phoenix-pure lifecycle hooks that ship (rot-canary auto-scan, conductor). |
| `.githooks/` | This repo's own pre-commit/pre-push gates — tracked, enabled via `core.hooksPath`. |
| `commands/` | Slash-commands (`/coalmine:stats`, `/coalmine:update`). |
| `scripts/` | `build-plugin`, `verify`, `consistency`, `install`, `configure` + `lib/`. |
| `plugin/` | Generated Claude Code plugin distribution. |
| `platform-configs/` | Per-agent install templates + manual hook snippets. |
| `alt/` | PowerShell fallback hooks for Node-less Windows setups. |
| `agents/coalmine-scanner.md` | Read-only scan worker for Heavy-tier fan-out. |

---

## 🚀 Releasing (Maintainers)

Bump the version in `.claude-plugin/plugin.json` → add a `CHANGELOG.md` entry → ensure `verify.mjs`, the test suite, and `consistency.mjs` pass (all three run automatically on commit/push once `.githooks/` is enabled, per above) → commit → create a signed git tag (`vX.Y.Z`) → push `--follow-tags` → publish a GitHub Release for the stable tag.

---

## 📄 License & Conduct

Contributions are licensed under the [Apache License 2.0](LICENSE). Assume good faith and be respectful. Report security issues per [SECURITY.md](SECURITY.md); if a canary itself misbehaves, file it via the repo issues.
