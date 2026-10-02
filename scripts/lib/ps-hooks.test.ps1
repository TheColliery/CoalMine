# Hermetic spawn tests for the PowerShell rot-canary hooks (alt/powershell/*.ps1).
# Run: powershell -NoProfile -File scripts\lib\ps-hooks.test.ps1   (or pwsh)
# Zero external dependencies. Spawns the REAL .ps1 files with fixture stdin and a
# sandboxed TEMP + USERPROFILE so no real session state or kill-switch can affect
# the result (mirrors hooks-safety.md §7 for the PS twins of the Node hooks).
#
# Covers the two board-audit fixes:
#   CRITICAL — a single-element disabledCanaries array must disable the canary
#              (the if-expression assignment used to unwrap it to a scalar -> @()).
#   HIGH     — a lone '=======' banner must NOT flag merge-conflict markers; only a
#              real '<<<<<<< '/'>>>>>>> ' co-occurrence does (Node parity).
$ErrorActionPreference = 'Stop'

$repo  = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$touch = Join-Path $repo 'alt\powershell\rot-canary-touch.ps1'
$stop  = Join-Path $repo 'alt\powershell\rot-canary-stop.ps1'
$psExe = (Get-Process -Id $PID).Path  # the same PowerShell host running this test

$pass = 0; $fail = 0
function Check([string]$name, [bool]$cond) {
  if ($cond) { Write-Host "  PASS $name"; $script:pass++ }
  else        { Write-Host "  FAIL $name"; $script:fail++ }
}

function New-Sandbox {
  # A throwaway project root (carries a .git marker so Find-GitRoot stops here) +
  # a separate sandbox TEMP so the hook's session files never touch the real $env:TEMP.
  $root = Join-Path ([System.IO.Path]::GetTempPath()) ('cm-pshook-' + [guid]::NewGuid().ToString('N'))
  $tmp  = Join-Path $root '_temp'
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  New-Item -ItemType Directory -Path $tmp  -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $root '.git') -Force | Out-Null
  return [pscustomobject]@{ Root = $root; Temp = $tmp }
}

function Invoke-Hook([string]$script, [string]$stdin, $sb) {
  # Run the hook in a child PowerShell with cwd = sandbox root and TEMP/USERPROFILE
  # redirected into the sandbox. Returns the captured stdout string.
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $psExe
  $psi.Arguments = "-NoProfile -NonInteractive -File `"$script`""
  $psi.WorkingDirectory = $sb.Root
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.EnvironmentVariables['TEMP'] = $sb.Temp
  $psi.EnvironmentVariables['TMP']  = $sb.Temp
  $psi.EnvironmentVariables['USERPROFILE'] = $sb.Root  # no real ~/.claude/.rot-canary-* leaks in
  $p = [System.Diagnostics.Process]::Start($psi)
  $p.StandardInput.Write($stdin)
  $p.StandardInput.Close()
  $out = $p.StandardOutput.ReadToEnd()
  $null = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  return [pscustomobject]@{ ExitCode = $p.ExitCode; StdOut = $out }
}

# ── CRITICAL: single-element disabledCanaries disables touch + stop ──────────────
$sb = New-Sandbox
try {
  '{"disabledCanaries":["rot-canary"]}' | Set-Content -Path (Join-Path $sb.Root '.coalmine.json') -Encoding UTF8
  $codeFile = Join-Path $sb.Root 'a.js'
  'const x = 1;' | Set-Content -Path $codeFile -Encoding UTF8
  $stdin = (@{ session_id = 'PSDIS'; tool_input = @{ file_path = $codeFile } } | ConvertTo-Json -Compress)
  $r = Invoke-Hook $touch $stdin $sb
  $touched = Join-Path $sb.Temp 'rot-canary-PSDIS.touched'
  Check 'touch: single-element disabledCanaries exits 0'        ($r.ExitCode -eq 0)
  Check 'touch: single-element disabledCanaries records NOTHING' (-not (Test-Path $touched))
  Check 'touch: disabled canary emits no output'               ([string]::IsNullOrEmpty($r.StdOut.Trim()))

  # stop: with a pre-existing .touched, a single-element disable must still no-op (no nudge).
  Set-Content -Path $touched -Value ($codeFile + "`r`n") -Encoding UTF8
  $rs = Invoke-Hook $stop (@{ session_id = 'PSDIS'; stop_hook_active = $false } | ConvertTo-Json -Compress) $sb
  Check 'stop: single-element disabledCanaries exits 0'         ($rs.ExitCode -eq 0)
  Check 'stop: single-element disabledCanaries emits no nudge'  ([string]::IsNullOrEmpty($rs.StdOut.Trim()))
} finally { Remove-Item $sb.Root -Recurse -Force -ErrorAction SilentlyContinue }

# ── CRITICAL: legacy "disable":["all"] single-element disables too ───────────────
$sb = New-Sandbox
try {
  '{"disable":["all"]}' | Set-Content -Path (Join-Path $sb.Root '.coalmine.json') -Encoding UTF8
  $codeFile = Join-Path $sb.Root 'b.js'
  'const y = 2;' | Set-Content -Path $codeFile -Encoding UTF8
  $stdin = (@{ session_id = 'PSALL'; tool_input = @{ file_path = $codeFile } } | ConvertTo-Json -Compress)
  $r = Invoke-Hook $touch $stdin $sb
  Check 'touch: legacy single-element disable:[all] records NOTHING' (-not (Test-Path (Join-Path $sb.Temp 'rot-canary-PSALL.touched')))
} finally { Remove-Item $sb.Root -Recurse -Force -ErrorAction SilentlyContinue }

# ── sanity: NOT disabled still records (the fix must not over-disable) ───────────
$sb = New-Sandbox
try {
  '{"watchedExtensions":[".js"]}' | Set-Content -Path (Join-Path $sb.Root '.coalmine.json') -Encoding UTF8
  $codeFile = Join-Path $sb.Root 'c.js'
  'const z = 3;' | Set-Content -Path $codeFile -Encoding UTF8
  $stdin = (@{ session_id = 'PSON'; tool_input = @{ file_path = $codeFile } } | ConvertTo-Json -Compress)
  $r = Invoke-Hook $touch $stdin $sb
  Check 'touch: enabled canary records the touched file'        (Test-Path (Join-Path $sb.Temp 'rot-canary-PSON.touched'))
} finally { Remove-Item $sb.Root -Recurse -Force -ErrorAction SilentlyContinue }

# ── HIGH: a lone '=======' banner does NOT flag merge-conflict markers ───────────
$sb = New-Sandbox
try {
  $codeFile = Join-Path $sb.Root 'banner.js'
  # A line that literally IS '=======' (a common ASCII section divider) with NO
  # angle-bracket conflict marker anywhere — the bare-regex bug flagged this.
  @('const header = `', '=======', '`;', 'const a = 1;') |
    Set-Content -Path $codeFile -Encoding UTF8
  $stdin = (@{ session_id = 'PSBAN'; tool_input = @{ file_path = $codeFile } } | ConvertTo-Json -Compress)
  $r = Invoke-Hook $touch $stdin $sb
  $smells = Join-Path $sb.Temp 'rot-canary-PSBAN.smells'
  Check 'touch: lone ======= banner exits 0'                   ($r.ExitCode -eq 0)
  $bannerFlagged = (Test-Path $smells) -and ((Get-Content -Raw $smells) -match 'merge-conflict')
  Check 'touch: lone ======= banner does NOT flag merge-conflict' (-not $bannerFlagged)
} finally { Remove-Item $sb.Root -Recurse -Force -ErrorAction SilentlyContinue }

# ── HIGH: a real conflict ('<<<<<<< ' + '=======') DOES flag ─────────────────────
$sb = New-Sandbox
try {
  $codeFile = Join-Path $sb.Root 'conflict.js'
  @('<<<<<<< HEAD', 'const a = 1;', '=======', 'const a = 2;', '>>>>>>> branch') |
    Set-Content -Path $codeFile -Encoding UTF8
  $stdin = (@{ session_id = 'PSCON'; tool_input = @{ file_path = $codeFile } } | ConvertTo-Json -Compress)
  $r = Invoke-Hook $touch $stdin $sb
  $smells = Join-Path $sb.Temp 'rot-canary-PSCON.smells'
  $conflictFlagged = (Test-Path $smells) -and ((Get-Content -Raw $smells) -match 'merge-conflict')
  Check 'touch: real <<<<<<< + ======= conflict IS flagged'    $conflictFlagged
} finally { Remove-Item $sb.Root -Recurse -Force -ErrorAction SilentlyContinue }

# ── Two-level config (v3.9.0): global ~/.claude/.coalmine.json + project git-root ──
# USERPROFILE is sandboxed to $sb.Root, so the global layer is <root>\.claude\.coalmine.json
# and the project layer is <root>\.coalmine.json (the .git marker stops Find-GitRoot there).
$sb = New-Sandbox
try {
  New-Item -ItemType Directory -Path (Join-Path $sb.Root '.claude') -Force | Out-Null
  '{"disabledCanaries":["rot-canary"]}' | Set-Content -Path (Join-Path $sb.Root '.claude\.coalmine.json') -Encoding UTF8
  $codeFile = Join-Path $sb.Root 'g.js'
  'const g = 1;' | Set-Content -Path $codeFile -Encoding UTF8
  $stdin = (@{ session_id = 'PSGLO'; tool_input = @{ file_path = $codeFile } } | ConvertTo-Json -Compress)
  $r = Invoke-Hook $touch $stdin $sb
  Check 'touch: GLOBAL-layer disable alone is honored'          (-not (Test-Path (Join-Path $sb.Temp 'rot-canary-PSGLO.touched')))

  # board #113 findings-back: disabledCanaries now UNION-merges (hooks-safety.md §9 --
  # the safer direction for an array is UNION, never pick-one-side), so a project
  # clearing its own list can no longer silently re-enable an explicit global disable.
  # This assertion used to expect the OPPOSITE (project's empty array winning) -- that
  # was the exact escalation hole board #113 closed; corrected here to match.
  '{"disabledCanaries":[]}' | Set-Content -Path (Join-Path $sb.Root '.coalmine.json') -Encoding UTF8
  $stdin2 = (@{ session_id = 'PSWIN'; tool_input = @{ file_path = $codeFile } } | ConvertTo-Json -Compress)
  $r2 = Invoke-Hook $touch $stdin2 $sb
  Check 'touch: project empty disabledCanaries cannot clear an explicit global disable (UNION merge, board #113)' (-not (Test-Path (Join-Path $sb.Temp 'rot-canary-PSWIN.touched')))
} finally { Remove-Item $sb.Root -Recurse -Force -ErrorAction SilentlyContinue }

# ── M1: tempSweepStaleDays:0 must not delete THIS session's own recent marker ────
# Before the >=1 floor, 0 pushed the sweep cutoff to "now"; the sweep runs BEFORE
# the .touched file is read, so a marker written moments earlier (backdated a few
# seconds here — old enough to be < "now" but nowhere near 1 day) was deleted too,
# silently suppressing this session's own end-of-scan nudge (Node parity).
$sb = New-Sandbox
try {
  '{"tempSweepStaleDays":0}' | Set-Content -Path (Join-Path $sb.Root '.coalmine.json') -Encoding UTF8
  $realFile = Join-Path $sb.Root 'edited-a.js'
  'x' | Set-Content -Path $realFile -Encoding UTF8
  $base = Join-Path $sb.Temp 'rot-canary-PSSWEEP'
  $touchedFile = "$base.touched"
  Set-Content -Path $touchedFile -Value ($realFile + "`r`n") -Encoding UTF8
  $recent = (Get-Date).ToUniversalTime().AddSeconds(-5)
  [System.IO.File]::SetLastWriteTimeUtc($touchedFile, $recent)

  $stdin = (@{ session_id = 'PSSWEEP'; stop_hook_active = $false } | ConvertTo-Json -Compress)
  $r = Invoke-Hook $stop $stdin $sb
  Check 'stop: tempSweepStaleDays:0 exits 0' ($r.ExitCode -eq 0)
  $decisionBlocked = $false
  try { $decisionBlocked = (($r.StdOut | ConvertFrom-Json).decision -eq 'block') } catch {}
  Check "stop: tempSweepStaleDays:0 must not delete this session's own recent marker" $decisionBlocked
} finally { Remove-Item $sb.Root -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host ''
Write-Host "PS hook results: $pass passed, $fail failed"
if ($fail -gt 0) { exit 1 } else { exit 0 }
