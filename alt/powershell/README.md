# PowerShell hooks (fallback — for setups without Node.js)

The plugin's **default** hooks are cross-platform Node scripts in [`../../hooks/`](../../hooks/) and activate automatically when you install the plugin — that's the recommended path.

These PowerShell versions are a **fallback** for Windows setups that don't have Node.js on `PATH` (e.g. the native installer of Claude Code without Node). Same trigger semantics and temp-file scheme, wired **manually** via your own `settings.json`. Known differences (deliberate, not port gaps): the stop-hook nudge is **English-only** here, while the Node version localizes to th/ja/zh/es; and these twins cover the code-rot **scan only** — the quiet memory-drift advisory (`memoryDriftNudge`), the `os.tmpdir()` scratch-space exclude, the size-tripwire exemptions (test files + declared over-runs), and the `scanExcludePaths` lab-tooling scan-scope exclude are Node-hook-only; and the per-project config read order (namespace campaign #69+#39, 2026-08-08) — `.claude`/`.agents`/`.gemini` agent-dir candidates before the legacy root dotfile — is also Node-hook-only, these twins still read only the legacy `<gitroot>/.coalmine.json` path; and the **sweep-throttle marker hardening** (CWK-031/U8, 2026-08-31) — a private `os.tmpdir()/coalmine/` subdir at mode `0o700`, an `lstat` symlink guard on that dir, and a per-pid-temp + `rename` re-stamp instead of a plain write — is Node-hook-only too, deliberately: Windows `$env:TEMP` is per-user and ACL'd, so the shared-`/tmp` precondition that made the Node path exploitable is absent here — as is the **explicit `mode: 0o600` on every temp write** the Node twins gained with it (CWK-043), which `[System.IO.File]::WriteAllText` has no parameter for and which would carry no meaning on NTFS, where ACLs and not POSIX modes are the access model (full reason for both halves, including the same-user residual, in the header comment above the marker code in `rot-canary-stop.ps1`).

## What they do

| Hook | Event | Behavior |
|---|---|---|
| `rot-canary-touch.ps1` | `PostToolUse` (Write/Edit/MultiEdit) | Records the code files touched this session to a per-session temp marker; flags unambiguous tripwires (merge-conflict markers, >800-line files). Always exits 0 (non-blocking). |
| `rot-canary-stop.ps1` | `Stop` | At a natural stop, if code was edited this session, asks the agent to run the code-health scan at `DEPTH=QUICK` on the touched files. **Loop-guarded** (`stop_hook_active`), **one-shot per edit-batch** (a `.scanned` marker), and **kill-switchable**. |

## Manual install (Windows, no Node)

1. Copy both `.ps1` files to `~/.claude/hooks/` (or any path you like).
2. Merge [`settings.snippet.json`](settings.snippet.json) into `~/.claude/settings.json` under `hooks` — replace `<HOME>` with your home path (e.g. `C:\Users\you`). Keep any hooks you already have.
3. Restart your Claude Code session (hooks load at session start).

> If you have Node, ignore this folder — just install the plugin (see the root README) and the Node hooks handle everything with no manual wiring.

## Modes — auto / manual / off

Set `~/.claude/.rot-canary-mode` to one word — these PowerShell hooks honor it just like the Node hooks:

- **auto** (default, or absent) — tripwire records edits + the `Stop` hook runs the audit at session end.
- **manual** — tripwire still records touched files, but the `Stop` hook does **not** auto-run; you run the audit yourself.
- **off** — silent (tripwire records nothing, no auto-run).

Back-compat: `~/.claude/.rot-canary-off` (any contents) forces **off**.

## How the loop guard works

The `Stop` hook would re-fire after the agent finishes the scan it requested. It avoids an infinite loop by:
- bailing when `stop_hook_active` is true (the stop is already a continuation), and
- writing a `.scanned` marker holding the `.touched` timestamp captured at nudge time; it only re-nudges when `.touched` is newer than that stored value (i.e. new edits happened since the last scan). Unknown/legacy marker content re-nudges rather than being swallowed.

## Cleanup (Phoenix #1 — zero garbage)

Once a batch is acknowledged (next stop with no new edits), the hook deletes the session's `.touched`/`.smells`/`.scanned` files. On every stop it also sweeps `rot-canary-*` temp files older than 7 days, so sessions killed mid-way can't leak state forever.
