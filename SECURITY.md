# Verifying CoalMine

CoalMine is verified under the same framework as **[CoalTipple](https://github.com/TheColliery/CoalTipple/blob/main/SECURITY.md)**: all execution hooks follow the [Phoenix-13 commandments](https://github.com/TheColliery/.github/blob/main/hooks-safety.md), builds are fully reproducible from source, and security scans run on each release.

---

## 🔒 Reporting a Vulnerability

Report a security issue in this repo through GitHub's private vulnerability reporting — [Security → Report a vulnerability](https://github.com/TheColliery/CoalMine/security/advisories/new) — never a public issue. In scope: everything this repo ships — the canary skills, the shipped hooks, the installer and other `scripts/`, the `plugin/` dist, and the PowerShell fallback hooks and platform hook-config templates we publish for manual install. Out of scope: a vulnerability in a third-party skill or codebase a canary merely scans — report that to its own maintainer. This is a one-person-maintained project, with no fixed response-time SLA: expect the report to be read and acknowledged, triaged against the scope above, and disclosed once a fix ships — or, where we decide not to fix, told that and why. A public GitHub issue remains the right channel for an ordinary, non-security bug.

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
