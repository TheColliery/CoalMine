# Verifying CoalMine

CoalMine is verified under the same framework as **[CoalTipple](https://github.com/TheColliery/CoalTipple/blob/main/SECURITY.md)**: all execution hooks follow the [Phoenix-13 commandments](https://github.com/TheColliery/.github/blob/main/hooks-safety.md), builds are fully reproducible from source, and security scans run on each release.

---

## 🔒 Reporting a Vulnerability

Report a security issue in this repo through GitHub's private vulnerability reporting — [Security → Report a vulnerability](https://github.com/HetCreep/CoalMine/security/advisories/new) — never a public issue. In scope: everything this repo ships — the canary skills, the shipped hooks, the installer and other `scripts/`, the `plugin/` dist, and the PowerShell fallback hooks and platform hook-config templates we publish for manual install. Out of scope: a vulnerability in a third-party skill or codebase a canary merely scans — report that to its own maintainer. This is a one-person-maintained project, with no fixed response-time SLA: expect the report to be read and acknowledged, triaged against the scope above, and disclosed once a fix ships — or, where we decide not to fix, told that and why. A public GitHub issue remains the right channel for an ordinary, non-security bug.

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

<!-- version-transition: the pin below reflects the LAST ACTUAL scan -- do NOT bump the SkillSpector/CoalMine version, date, or score without a real re-scan (an unscanned version's security is UNVERIFIED; never claim coverage). Re-scan periodically or on a significant plugin/ skill change (skillspector/scan.ps1 CoalMine), then re-sync the finding refs. Last run: SkillSpector v2.3.9 · CoalMine v3.8.4 (commit 1cda13c) · 2026-07-02 · 95/100 · 12 false positives. Line refs drift on skill edits — verify against the fresh scan output. (This file is at the repo root, OUTSIDE the scanned plugin/ dir, so this comment is not scanned.) -->
## 🔬 Independent Scanning — NVIDIA SkillSpector

CoalMine is evaluated against [NVIDIA SkillSpector](https://github.com/NVIDIA/skillspector), run locally via `uvx` (no install). Score **95/100 (CRITICAL static)** — driven by consent-gated **Self-Updating**, which the static **RA1 self-modification** rule flags (×7) as a false positive; not a defect. **12 findings, all false positives.** v2.3.9 added new analyzers (incl. `AR1` anti-refusal) — the one new finding is a context-blind match; the score is unchanged from v2.3.5 (95).

**Scan provenance:** SkillSpector **v2.3.9** (self-reported; the tool ships no tagged releases — the version is the `uvx`-from-git HEAD, `326a2b4`) · CoalMine **v3.8.4** (commit `1cda13c`) · **2026-07-02** · static stage (`--no-llm`). Scanning is event-driven (a new SkillSpector version, or a genuinely new attack surface) — this pins the last version actually verified.

* **Static Scan (95/100 - CRITICAL):** 12 false positives:
  * `HIGH · RA1 Self-Modification` ×7 (the `/coalmine:update` command + the conductor's self-update scheduler + `self-update` comments) — the series **consent-gated Self-Updating**: the hook only SCHEDULES (no network), the agent offers the platform's own `claude plugin update`; the skill never rewrites its own files.
  * `HIGH · AR1 Anti-Refusal` (`commands/update.md:5`, new v2.3.9 analyzer) — matched "Always answer"; the sentence is "Always answer **in the user's language**" — a localization rule, not refuse-suppression.
  * `HIGH · AS1 Agent Snooping` (`commands/stats.md:12`) — a read-only `grep` of the project's own rules home for CoalMine's freshness stamps; the command ends "Do not modify any file."
  * `HIGH · P2 Hidden Instructions` (`skills/gold-standard/references/method.md:1`, confidence 0.21) — the metadata rule-freshness stamp (an instruction-shaped HTML comment carrying no command or exfil directive).
  * `MED · EA2 Autonomous Decision` (`skills/gold-standard/SKILL.md:28`) — the line reads "...**never** assume approval"; the scanner matched the substring "assume approval" and missed the "never." The `ask_question` gate is the opposite of acting without confirmation.
  * `MED · RA2 Session Persistence` (`hooks/rot-canary-stop.js:240`) — the stop-hook session temp file (written to `tmpdir`, deleted on stop) plus the flagged text itself: the USER's documented opt-out ("Disable: create `~/.claude/.rot-canary-off`") — a kill-switch, not an OS-persistence mechanism.
* **Method:** `uvx --from git+https://github.com/NVIDIA/skillspector.git skillspector scan <plugin> --format json` — uvx fetches its own ephemeral Python, so no manual Python/pip install is needed; a JSON report is written even when the optional LLM stage is skipped.
* **LLM Semantic Scan:** not run this pass (`--no-llm` — static-only is the documented, FP-prone baseline: pattern-match without the skill-contract context).

---

## 🛡️ Structural Safety (Phoenix-13)

Security is built structurally. Every hook obeys the [Phoenix-13 rules](https://github.com/TheColliery/.github/blob/main/hooks-safety.md) (zero-dependency, no network, no child processes, fail-silent, session cleanup). No data-exfiltration path exists.

The same three Node hooks also carry an **Antigravity mode** (selected by the event-name argument wired in [`platform-configs/hooks/antigravity-hooks.json`](platform-configs/hooks/antigravity-hooks.json)): identical Phoenix-13 posture, output restricted to a single `{"injectSteps":[{"ephemeralMessage":...}]}` JSON line from the conductor (the current AG `PreInvocation` output contract; the Stop hook emits the explicit no-op `{}` — the current engine has no Stop inject channel), and CoalMine never blocks on Antigravity.

<!-- CWK-058 doc-only proof push, 2026-09-03: this line exists to measure which required checks fire on a doc-only path. -->
