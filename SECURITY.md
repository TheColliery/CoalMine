# Verifying CoalMine

CoalMine is verified under the same framework as **[CoalTipple](https://github.com/TheColliery/CoalTipple/blob/main/SECURITY.md)**: all execution hooks follow the [Phoenix-13 commandments](https://github.com/TheColliery/.github/blob/main/hooks-safety.md), the plugin build (`node scripts/build-plugin.mjs`) is reproducible from source byte for byte (the claude.ai ZIPs are not: filesystem entry order and stored file times differ between builds), and security scans are event-driven, not run on every release (the last scan actually verified is pinned under Independent Scanning below).

---

## 🔒 Reporting a Vulnerability

Report a security issue in this repo through GitHub's private vulnerability reporting — [Security → Report a vulnerability](https://github.com/TheColliery/CoalMine/security/advisories/new) — never a public issue. In scope: everything this repo ships — the canary skills, the shipped hooks, the installer and other `scripts/`, the `plugin/` dist, and the PowerShell fallback hooks and platform hook-config templates we publish for manual install. Out of scope: a vulnerability in a third-party skill or codebase a canary merely scans — report that to its own maintainer. This is a one-person-maintained project. We acknowledge a report within 5 days, send an assessment within 10 days, and disclose publicly once the fix ships, or at 90 days at most. During an absence announced on the maintainer's GitHub profile, the 5 days count from the first day back. Where we decide not to fix, you are told that and why. A public GitHub issue remains the right channel for an ordinary, non-security bug.

Fixed vulnerabilities are published as [Security Advisories](https://github.com/TheColliery/CoalMine/security/advisories).

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

<!-- version-transition: SkillSpector scan—the re-scan is automatic on one event (E2: this repo's own version bump, gated by a per-repo baseline diff); a genuinely new attack surface is a second, by hand. Record the version/score/date/commit here only after a real scan, and REPLACE this section, never append to it. Last run: SkillSpector v2.13.4 (pin 5482446) · CoalMine v3.26.0 (commit 5c8b03c) · 2026-11-06 · 100/100 · 36 findings, none a defect, static coverage partial (52/58 files). -->
## 🔬 Independent Scanning—NVIDIA SkillSpector

CoalMine is evaluated against [NVIDIA SkillSpector](https://github.com/NVIDIA/skillspector), run locally via `uvx` (no install), static stage only (`--no-llm`).

* **Scan:** 2026-11-06, CoalMine v3.26.0 (commit `5c8b03c`, the `v3.26.0` tag), SkillSpector v2.13.4 pinned to commit `5482446` (`54824463814a0be01360792523ec7245a69190fc`).
* **Score:** 100/100 (CRITICAL static). **36 findings, none a defect**, each read at its source line.
* **Finding classes:**
  * RA1 Self-Modification ×10—the consent-gated Self-Updating text: the hook only schedules, the agent offers the platform's own `claude plugin update`.
  * RA2 Session Persistence ×18—prose and comments about local files, none of which sets up anything that runs (the README sentence on what the hooks write, the Stop hook's kill-switch text, one sentence in each skill's `problem-report.md`, comments in the hooks). The count rose from 2 because this pin's rule matches any text with no `|` from `create`, `write` or `mkdir` up to a `~/.` path, across lines.
  * AS1 Agent Config Directory Access ×2—a read-only `grep` of the project's rules home for CoalMine's freshness stamps.
  * AR1 Anti-Refusal Statement ×1—"Always answer **in the user's language**", a localization rule.
  * TM3 Unsafe Defaults ×3—comments naming the world-writable temp residual; the code answers it with `0o700` folders, `0o600` files and a symlink refusal.
  * AS3 Skill Enumeration ×1—the README disclosure that `gold-standard` reads project memory only to verify it.
  * BH1 Bundled hooks can execute when matching lifecycle events occur ×1—the scanner's standing note that a plugin registering hooks should have its reach reviewed.
* **Coverage:** partial, 52 of 58 files fully inspected. The three hook files are among the partial ones, so each change to the hooks is read by hand at review.

Earlier scans are in this file's git history. Scanning is event-driven (this repository's own version bump, or a genuinely new attack surface); this record names the last scan actually run.

---

## 🛡️ Structural Safety (Phoenix-13)

Security is built structurally. Every hook obeys the [Phoenix-13 rules](https://github.com/TheColliery/.github/blob/main/hooks-safety.md) (zero-dependency, no network, no child processes, fail-silent, session cleanup). No data-exfiltration path exists.

The same three Node hooks also carry an **Antigravity mode** (selected by the event-name argument wired in [`platform-configs/hooks/antigravity-hooks.json`](platform-configs/hooks/antigravity-hooks.json)): identical Phoenix-13 posture, output restricted to a single `{"injectSteps":[{"ephemeralMessage":...}]}` JSON line from the conductor (the current AG `PreInvocation` output contract; the Stop hook, after an edit, emits `{"decision":"continue","reason":...}`, which holds that stop once to ask for the scan, the same as Claude Code's block, and otherwise the no-op `{}`: it never does so after an `error` or `max_steps_exceeded` stop, nor a second time for a batch already acknowledged), and apart from that held stop, at most once per edit batch, CoalMine never blocks on Antigravity.

---

## 🩺 Debug Hatch

Off by default. Set `COALMINE_DEBUG` in the environment that starts the agent and the three Node hooks append two or three short JSON lines per run to `~/.claude/coal/coalmine/debug-hatch.jsonl`, rotated to `debug-hatch.1.jsonl` before a write would take it past 256 KiB, so the two files stay under 512 KiB. Each line holds a timestamp, a severity, the hook name, the platform, the Node version, an event name and, for a refusal, a crash or a finished run, a guard name, the error name and code, the hook's own file name and line, or short counts and true/false flags. It records structure only: a value is kept if it is a number, a true/false or a short plain word, anything else (a path, a line break, free text) is written as `redacted`, and nothing is read out of the hook payload. Nothing is written to stdout or stderr, and nothing leaves the machine unless you attach the file to a report yourself. The stop hook removes either file once it is older than `tempSweepStaleDays` days in your global config (7 if unset; a project config is ignored), whether or not the hatch is still on. On Linux and macOS the file is created at mode `0600` and opened without following links, and a folder the hatch creates itself gets mode `0700`; on Windows those modes and that flag do not apply, so the hook refuses a path that is not a plain file just before it opens it.
