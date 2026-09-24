# Verifying CoalMine

CoalMine is verified under the same framework as **[CoalTipple](https://github.com/TheColliery/CoalTipple/blob/main/SECURITY.md)**: all execution hooks follow the [Phoenix-13 commandments](https://github.com/TheColliery/.github/blob/main/hooks-safety.md), builds are fully reproducible from source, and security scans run on each release.

---

## 🔒 Reporting a Vulnerability

Report a security issue in this repo through GitHub's private vulnerability reporting — [Security → Report a vulnerability](https://github.com/TheColliery/CoalMine/security/advisories/new) — never a public issue. In scope: everything this repo ships — the canary skills, the shipped hooks, the installer and other `scripts/`, the `plugin/` dist, and the PowerShell fallback hooks and platform hook-config templates we publish for manual install. Out of scope: a vulnerability in a third-party skill or codebase a canary merely scans — report that to its own maintainer. This is a one-person-maintained project, with no fixed response-time SLA: expect the report to be read and acknowledged, triaged against the scope above, and disclosed once a fix ships — or, where we decide not to fix, told that and why. A public GitHub issue remains the right channel for an ordinary, non-security bug.

---

## 📢 Security Advisories

### CWK-137 — a cloned repository could act on your machine through a planted link (2026-09-24)

**What an attacker needs.** A repository you clone that carries a planted symbolic link (on Windows, a junction or symlink), FIFO or device file at a path CoalMine reads or writes. That is the whole precondition: no other access. The hooks fire on ordinary session events in that clone; `install.mjs` and `configure.mjs` act only when you run them there. **No CVE id is claimed; none exists.** Found by a blind automated security review (2026-09-24).

**Affected versions.** Every release from **1.0.0** (the first release; it has no git tag, its `CHANGELOG.md` heading is dated 2026-06-09) through **v3.20.1**. Because 1.0.0 is untagged, the exact commit a 1.0.0 user has cannot be identified, so 1.0.0 is stated by commit. 1.0.0 commits from `2aeb8de` (2026-06-05, the first commit with an installer) carry the skills-directory write-through of defect 2. Commits from 2026-06-09 (`112b0ce`, `33013d3`) carry every other 1.0.0 site: the hooks' language probe, the rules-file and git-hook writes, and `verify.mjs <target>`'s read. Only the 1.0.0 commits before `2aeb8de` carry none, and they have no installer. The range was derived by walking versions, not tags: `.claude-plugin/plugin.json` history has 77 versions, `CHANGELOG.md` headings 76, and git tags 76. 1.0.0 is the only version with no tag; `CHANGELOG.md` has no 2.2.0 heading, though tag `v2.2.0` and a `plugin.json` 2.2.0 exist (2.2.0 is inside the range, so no claim here is affected). Each per-site first version below is the first version whose tree contains that call shape, checked at the previous release too. The defects were measured on the earliest tree where each was executed (WSL Ubuntu, Node 24.19.0, a fake `HOME`, hooks under a 3 GB address-space cap and a 30 s timeout): a 2026-06-06 1.0.0 tree (`27a542a`, the skills-directory write; also `2aeb8de`), the newest 1.0.0 tree (`90d4b12`), v2.0.0, v3.0.0 and v3.3.0. **Fixed in:** the repository, commit `a4f0cff`; that commit is not in a release yet, so the next release after v3.20.1 ships it, and this entry will name that version when it does. Until then, do not run a CoalMine hook, `install.mjs` or `configure.mjs` in a clone you do not trust.

#### 1. The hooks read a planted path with no bound

| | |
|---|---|
| **What happens** | A link to `/dev/zero` at `AGENTS.md`, `MEMORY.md`, `README.md`, a rules file or the project `coalmine.json` made the hook crash (`std::bad_alloc`, exit 134, measured on Linux). A FIFO at one of those paths, or a `.claude/rules` link to `/`, made the hook never return. On Windows a junction on `.claude/rules` made the conductor scan rule stamps outside the project (an outside stamp silenced the onboarding offer). Nothing is disclosed and no file is changed: the hook dies or hangs. |
| **First affected** | The stop hook's language probe reading `<cwd>/AGENTS.md`, `MEMORY.md` and `README.md`: **1.0.0** (crash measured on the newest 1.0.0 tree, v2.0.0 and v2.3.0; the probe is skipped when `LANG` already names Thai, Japanese, Chinese or Spanish). The stop and touch hooks reading the project `.coalmine.json`: **v3.0.0** (crash measured; v2.8.0 exits normally). The conductor scanning `AGENTS.md` and `.claude/rules/**` for rule stamps: **v3.7.5** (the onboarding-stamp scan: v3.11.2). `verify.mjs <target>` reading each installed `SKILL.md`: **1.0.0** (by source: an earlier draft of this entry said v2.2.1, from a search on an error-message string added later); its manifest check: **v3.5.0**. |

#### 2. `install.mjs` wrote through a planted link

| | |
|---|---|
| **What happens** | With the Copilot instructions file (`copilot-instructions.md`, in the project's `.github` directory) linked to `~/.bashrc`, `install.mjs copilot` appended CoalMine's own rules block, between `COALMINE:START` and `COALMINE:END` markers, to the shell rc and reported success (measured on v2.0.0 and v3.20.1). The attacker does not choose the appended text; it is CoalMine's template, but it lands in a file outside the project. The same write-through applied to an existing git hook (its bytes are replaced, and a hook that is a link had its target's bytes copied into the `.pre-coalmine` backup slot), the default project config, the manifest, and a directory link on `.github` or `.agents`, which carried the skills install outside the project. |
| **First affected** | The platform rules file create and append: **1.0.0** (append measured on the newest 1.0.0 tree, v2.0.0 and v3.20.1); its rewrite on uninstall: **v2.4.0**. The git hook write: **1.0.0** (by source); its backup copy: **v2.2.1**. The skills directory install: **1.0.0**, from commit `2aeb8de` (2026-06-05), measured on a 2026-06-06 1.0.0 tree: with `.github` linked to a directory outside the project, `install.mjs copilot` wrote the whole skills tree there. The manifest write: **v2.6.0**. The default project config copy: **v3.7.0**. |

#### 3. `configure.mjs` read, backed up and overwrote through a planted link

| | |
|---|---|
| **What happens** | With the project config linked to `~/.bashrc`, `configure.mjs` treated it as malformed, copied its bytes into a `.bak` **inside the repository**, then overwrote the link target. Measured on v3.3.0 and v3.20.1: the rc file ended as `{ "language": "en" }`, and the `.bak` held the original bytes, which a later `git add -A` in that clone could commit. |
| **First affected** | **v3.3.0**, the release that introduced `configure.mjs`. |

**What the fix does.** Reads of a repo-derived path go through `readRepoFileBounded` (in the three hooks and in `scripts/lib/repo-fs.mjs`). It does `lstat` first. A regular file proceeds. A symlink proceeds only when its `realpath.native` target lies inside the project and is a regular file. A FIFO, device, socket, directory, or a link that escapes the project or dangles is skipped before `open`. The open uses `O_NONBLOCK`, the descriptor is re-checked, and a file over its bound (`MAX_CONFIG_BYTES` = 1 MiB for configs, `MAX_DOC_BYTES` = 4 MiB for governance docs) is skipped, never truncated. The conductor's rule walk is capped at `MAX_RULE_WALK_ENTRIES` = 5000 entries and `MAX_RULE_WALK_DEPTH` = 16 levels. Writes go through `writeRepoFile`: the nearest existing ancestor must resolve inside the project, the target must not be a link, and the bytes go to a sibling temp opened with `wx` and are renamed into place. A refused write prints `[refused] <path>: <reason>` and exits 1. `configure.mjs --global` keeps its follow-through write to `~/.claude/.coalmine.json`, because dotfile managers link that file; its read is bounded. The PowerShell fallback hooks refuse every reparse point (`Test-CoalmineSafeFile`), stricter than Node by design. **Not covered, named:** a regular file swapped in between the `lstat` and the `open` may lie outside the project (the descriptor re-check still holds the read to a bounded regular file); an agent's own file reads through its tools are the host's permission system; and a tree delivered as an archive rather than a git clone can carry a planted `.git/config` with an outside `core.hooksPath` (or a `.git` file naming an outside gitdir). `install.mjs` treats a hooks directory outside the worktree as its own root, on the reasoning that git configuration chose it, and that reasoning does not hold for such a tree, so the installer may replace git hooks in a directory it should not. The bound: the bytes written are CoalMine's own fixed gate script, never attacker text, and an existing hook is first kept as `<hook>.pre-coalmine`.

**What to check if you ran CoalMine in a clone you did not write.**
- A stray `.bak` beside a CoalMine config: `<project>/.claude/coal/coalmine.json.bak` or `<project>/.coalmine.json.bak`. Its contents are the file the config path was linked to, not a config. Delete it and do not commit it.
- A `COALMINE:START` block in a file outside the repository, for example a shell rc: `grep -l "COALMINE:START" ~/.bashrc ~/.zshrc ~/.profile`. Remove the block. Also compare any hook or config file `install.mjs` or `configure.mjs` reported writing against what you expect, since those writes replace the file. A git hook replaced by CoalMine carries `# Generated by CoalMine`, and the hook it replaced is kept beside it as `<hook>.pre-coalmine`.
- Links in a clone you already ran a tool in: `find . -not -path './.git/*' \( -type l -o -type p \)` (POSIX) or `Get-ChildItem -Recurse -Force | Where-Object { $_.Attributes -band 'ReparsePoint' }` (PowerShell) — a link at a path CoalMine reads or writes is the tell.

---

## 🔑 Commit & Tag Signatures

Every **release tag** and **maintainer commit** is SSH-signed (`gpg.format=ssh`); GitHub shows the Verified badge on them. Automated **Dependabot / CI** commits are not signed with the maintainer key (GitHub signs these with its own), so verify a signed **release tag** — the artifact a release consumer trusts:
```bash
echo "* ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEtqTWGKhX1Dk9nZP8ns13Wl5zsO1Cz3VlTS6m1p2fP9" > coalmine_signers
git config gpg.ssh.allowedSignersFile ./coalmine_signers
git tag -v "$(git describe --tags --abbrev=0)"
```

---

## 📦 Dist Integrity

The `plugin/` distribution directory is generated output gated by checks:
* **Pre-commit/Pre-push Gates:** `node scripts/verify.mjs` automatically re-renders skills from source and byte-compares the committed output to prevent drift.
* **Reproducible Builds:** Any user can clone, run `node scripts/build-plugin.mjs`, and verify the output is byte-identical.
* **Test Suite:** `node --test` runs the zero-dependency unit and hermetic-hook tests (an explicit file list, wired into the git hooks).

---

<!-- version-transition: the pin below reflects the LAST ACTUAL scan -- do NOT bump the SkillSpector/CoalMine version, date, or score without a real re-scan (an unscanned version's security is UNVERIFIED; never claim coverage). Re-scan periodically or on a significant plugin/ skill change (skillspector/scan.ps1 CoalMine), then re-sync the finding refs. Last run: SkillSpector v2.11.2 · CoalMine v3.20.0 (commit 2b15c04) · 2026-09-22 · 100/100 · 20 false positives, static coverage partial (42/46 files). Line refs drift on skill edits — verify against the fresh scan output. (This file is at the repo root, OUTSIDE the scanned plugin/ dir, so this comment is not scanned.) -->
## 🔬 Independent Scanning — NVIDIA SkillSpector

CoalMine is evaluated against [NVIDIA SkillSpector](https://github.com/NVIDIA/skillspector), run locally via `uvx` (no install). Score **100/100 (CRITICAL static)** — driven by consent-gated **Self-Updating**, which the static **RA1 self-modification** rule flags (×10) as a false positive; not a defect. **20 findings, all false positives on adjudication** (RA1 ×10 · RA2 ×3 · TM3 ×3, which match the word "world-writable" in comments describing a residual the code mitigates with `0o700` directories, `0o600` files and a symlink refusal · AR1 · AS1 · P2 · BH1, the scanner's own note that `hooks/hooks.json` registers hooks). The score is not comparable to the 95 recorded at v2.3.9: the previous dist (v3.8.4) re-scanned with this scanner also scores 100.

**Scan provenance:** SkillSpector **v2.11.2** (self-reported; the tool ships no tagged releases — the version is the `uvx`-from-git HEAD, `3956d4b`) · CoalMine **v3.20.0** (commit `2b15c04`) · **2026-09-22** · static stage (`--no-llm`). Static coverage was **partial** (42 of 46 files fully inspected): two hook files reached the scanner's parser span limit, `hooks/hooks.json` is opaque to it, and `skills/gold-standard/SKILL.md` was reported as text it could not fully evaluate; those files were read by hand. Scanning is event-driven (a new SkillSpector version, or a genuinely new attack surface) — this pins the last version actually verified.

* **Static Scan (100/100 - CRITICAL):** 20 findings, all false positives on adjudication:
  * `HIGH · RA1 Self-Modification` ×10 (`commands/update.md:2` + `hooks/coalmine-conductor.js` at `:362 :436 :443 :445 :447 :453 :640 :788 :847`) — the series **consent-gated Self-Updating**: the hook only SCHEDULES (no network), the agent offers the platform's own `claude plugin update`; the skill never rewrites its own files.
  * `HIGH · AS1 Agent Snooping` (`commands/stats.md:12`) — a read-only `grep` of the project's own rules home for CoalMine's freshness stamps; the command ends "Do not modify any file."
  * `HIGH · AR1 Anti-Refusal` (`commands/update.md:5`) — matched "Always answer"; the sentence is "Always answer **in the user's language**" — a localization rule, not refuse-suppression.
  * `HIGH · P2 Hidden Instructions` (`skills/gold-standard/references/method.md:1`) — the metadata rule-freshness stamp (an instruction-shaped HTML comment carrying no command or exfil directive).
  * `MED · TM3 Tool Misuse` ×3 (`hooks/coalmine-conductor.js:712`, `hooks/rot-canary-stop.js` at `:505 :561`) — match the word "world-writable" inside comments naming the residual a third party could pre-create; the code mitigates it with `0o700` directories, `0o600` files and a symlink refusal.
  * `MED · RA2 Session Persistence` ×3 (`hooks/coalmine-conductor.js:847`, `hooks/rot-canary-stop.js:739` ×2) — comments describing the update-stamp / session-temp mechanism; a throttle/kill-switch stamp, not an OS-persistence mechanism.
  * `MED · BH1 Bundled Execution Surface` (`hooks/hooks.json:1`) — the scanner's own standing note that a plugin registering lifecycle hooks should have its reach reviewed; the three registered hooks are `SessionStart`/`PostToolUse[Write|Edit|MultiEdit]`/`Stop`, all `type: command`, unchanged from the previous dist.
* **Method:** `uvx --from git+https://github.com/NVIDIA/skillspector.git skillspector scan <plugin> --format json` — uvx fetches its own ephemeral Python, so no manual Python/pip install is needed; a JSON report is written even when the optional LLM stage is skipped.
* **LLM Semantic Scan:** not run this pass (`--no-llm` — static-only is the documented, FP-prone baseline: pattern-match without the skill-contract context).

---

## 🛡️ Structural Safety (Phoenix-13)

Security is built structurally. Every hook obeys the [Phoenix-13 rules](https://github.com/TheColliery/.github/blob/main/hooks-safety.md) (zero-dependency, no network, no child processes, fail-silent, session cleanup). No data-exfiltration path exists.

The same three Node hooks also carry an **Antigravity mode** (selected by the event-name argument wired in [`platform-configs/hooks/antigravity-hooks.json`](platform-configs/hooks/antigravity-hooks.json)): identical Phoenix-13 posture, output restricted to a single `{"injectSteps":[{"ephemeralMessage":...}]}` JSON line from the conductor (the current AG `PreInvocation` output contract; the Stop hook emits the explicit no-op `{}` — the current engine has no Stop inject channel), and CoalMine never blocks on Antigravity.

<!-- CWK-058 doc-only proof push, 2026-09-03: this line exists to measure which required checks fire on a doc-only path. -->
