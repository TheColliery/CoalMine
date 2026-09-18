---
name: rot-canary
description: >-
  Code-health scan — dead code, bug-prone logic, resource leaks, concurrency bugs, silent failures, input-boundary issues, doc rot. Triggers on: "/rot-canary", "rot-canary", "code-health" (legacy aliases: "/rotcanary", "rotcanary"). Auto-runs at session end on touched files (QUICK, report only) via platform hooks — auto-wired by the Claude Code plugin, manual elsewhere. Run manually for fix mode. Reports; fixes on request via choice-gated menu.
---

# Rot-Canary

<!-- SHARED:LANGUAGE_HEADER -->

Scan code for rot. Report CONFIRMED findings. Fix on request.

## Parameters
- **SCOPE:** touched files (default) | diff | named files | whole repo. Touched-files scan is hybrid-capped: all if ≤ `autoScanFileCap`, else the `autoScanFileCapSlice` most-recently-modified files (warn the user). A touched file matching `scanExcludePaths` (lab/throwaway tooling only — never shipped/tracked source) is dropped before the cap; the nudge notes the skip count.
- **DISCLOSE EVERY SCOPE CUT, always — a suppressed finding must never look like an absent one.** Whenever the scope you actually scanned is narrower than the scope you were asked for, say so IN THE REPORT, with the COUNT and the KNOB that did the cutting: files dropped by `scanExcludePaths`, files left unscanned by the `autoScanFileCap` slice, file types outside `watchedExtensions`. State it even when the scan found nothing — that is exactly the case where the omission is invisible, because "scanned, clean" and "never scanned" read identically to a user. **If EVERY file in scope was cut, that is not a clean report: say plainly that no scan ran, and name what cut it.** **`scanEverything: true` bypasses every scan-scope cut at once** (`scanExcludePaths` ignored, `autoScanFileCap` not applied) — offer it when a user asks why files were skipped. It does NOT re-enable a disabled canary, and it does NOT reach the recording-side cuts (`watchedExtensions`, tmpdir), which decide what is recorded before any scan-time key is read, nor the tripwire's `tripwireMaxFileSizeKb` cap (an over-cap file IS recorded and IS scanned — only its edit-time pre-flag is skipped). **So report it as an unfiltered SCAN, never as "everything"** — an incompletely-widened scan that reads as fully widened is the same trust defect as a suppressed scan reading as a clean one, with the sign reversed. **Read it through the merged config, never the project file alone — for TWO independent reasons, and the second is the one CWK-057 left out:** (1) the READ PATH — a bare project file is ABSENT on a machine configured only globally, so an agent reading it sees nothing and silently uses defaults; (2) the CLAMP — a project-level `true` is CLAMPED to `false` unless the global layer also says `true` (`hooks-safety.md` §9 — a cloned repo must not be able to force a full scan on you), so a raw project-file read would report a scope that is not what the hook actually ran. (The Stop-hook auto-scan path already emits its own equivalents — `capNotice`, `scanExcludeNotice`, and the all-excluded quiet note — in all five languages; this rail is the MANUAL path's counterpart, which has no hook to speak for it.)
- **FILE TYPES:** code only by default, matching `watchedExtensions` (source files — never docs/prose/config-prose, CoalLedger's axis). Name non-code files explicitly to include them.
- **DEPTH:** QUICK (default) | DEEP

## Categories
1. **Bug-risk** — null deref, wrong operator, off-by-one, missing return
2. **Dead / unreachable** — zero-ref symbols, code after return/throw, always-true guards
3. **Disconnected** — exists but never wired to entry point, half-done refactor
4. **Duplication** — copy-paste diverged, two sources of truth for one constant
5. **Resource leak** — undisposed handle/stream/COM, subscription never removed
6. **Async** — unawaited task, `.Result`/`.Wait()` deadlock, blocking on UI thread
7. **Silent failure** — empty catch, success on partial completion, ignored return code
8. **Input security** — unvalidated input, injection, path traversal, secret in code/log
9. **Performance** — O(n²) in hot path, N+1, unbounded growth, work on UI thread
10. **Doc rot** — comment contradicts code, stale TODO, wrong param in docstring

## Discipline
- Report only CONFIRMED. Unverifiable → separate "SUSPECTED" list.
- Cite evidence (file:line, call-site count, the absent catch).
- "Dead" = **zero-reference reachability** (the static heuristic): zero references across ALL entry routes — reflection, DI, events, public API, tests — not a single-file grep.

## Fix mode (choice-gated)

**Before deciding fix mode:** read `~/.claude/.coalmine.json` then the project config (own agent dir → other known agent dirs → legacy `<gitroot>/.coalmine.json`; project wins per key); neither present → `autoFixMode` = `interactive`.

**Standing consent:** honor `.coalmine.json` `autoFixMode` as the pre-chosen option (the config IS the chosen option) — `off` = report only, no menu · `safe` = apply safe/reversible fixes automatically (still checkpoint → build/test → revert if red) · `interactive` (default) = present the menu below.

After any scan report in an interactive session — manual run OR hook-nudged auto-scan — you **MUST** present this menu via `ask_question` (skip only when findings are zero, no user is present, or `autoFixMode` pre-decided above):

- **Apply safe fixes:** mechanical, fully reversible edits only (dead imports, commented-out blocks, formatting). Each fix: checkpoint (git stash/commit in a git repo; else copy the file aside — never assume git exists) → apply → build + tests → auto-revert if newly red.
- **Let me pick:** list findings; user selects.
- **Report only:** exit unchanged.

NEVER auto-fix: live/reachable path · logic change · "API looks wrong" (ground via source-grounding first) · framework-wired code that only *looks* dead · SUSPECTED findings.

## Grants & denials (CLASSIFY-BLOCK)
| class | step it powers | grant | on denial |
|---|---|---|---|
| read | scan the touched/named files for the categories above | `Read`·`Grep`·`Glob`·`Bash` (read-only) | refuse that file, name it in the report — never a clean bill |
| write | Fix mode's safe/interactive apply, incl. checkpoint → build+tests → auto-revert if newly red | `Edit`·`Bash` (checkpoint/build/revert need exec, not just file-write) | report the fix as NOT applied AND the checkpoint/revert as NOT available, never claim done — this skill runs unattended on the Stop hook under `autoFixMode: safe`, with no interactive user to notice a denial, so the report line is the only signal and it says so |

<!-- SHARED:CLASSIFY_BLOCK -->

## Output
| # | path:line | category | severity | finding | evidence | fix |

Then: SUSPECTED list · coverage gaps · counts + top 3 to fix.

Severity: CRITICAL (data loss/security/crash on normal path) · HIGH (real bug/leak on reachable path) · MEDIUM (dead/dup/unwired) · LOW (style/doc rot)

<!-- SHARED:REPORTING_FOOTER -->

## Cadence
Stop hook → auto QUICK on the session's touched files (report only), hybrid-capped per `.coalmine.json` (see Parameters). Manual whole-repo DEEP sweep when needed. Auto-wiring is platform-dependent — read `references/cadence.md` before claiming auto-scan works on the current platform.

## Tooling
Per-stack build/dead-code/lint commands: read `references/tooling.md` when selecting scan tools.

<!-- SHARED:ORCHESTRATION -->

<!-- SHARED:ESCALATION_FOOTER -->
