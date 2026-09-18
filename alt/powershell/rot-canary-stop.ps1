# Code-Health Tier 2 (Stop)
# At a natural stop, if code was edited this session, nudge the agent to run /rot-canary QUICK
# on the touched files. Loop-guarded (stop_hook_active), one-shot per edit-batch, kill-switchable.
# NAMED DIVERGENCE from the Node twin (deliberate, not a port gap): this fallback covers the
# code-rot SCAN only — it has neither the quiet memory-drift advisory (v3.12.0/v3.12.3, which
# rides a Stop JSON channel this English-only text nudge does not emit), the os.tmpdir()
# scratch-space exclude (v3.12.2), nor the scanExcludePaths lab-tooling scan-scope exclude
# (2026-07-30). A Node-less box gets the scan; the rest stays Node-only.
$ErrorActionPreference = 'SilentlyContinue'

function Get-RcMode {
  # ~/.claude/.rot-canary-mode = auto|manual|off (absent = auto). .rot-canary-off = off (back-compat).
  $dir = Join-Path $env:USERPROFILE '.claude'
  if (Test-Path (Join-Path $dir '.rot-canary-off')) { return 'off' }
  $f = Join-Path $dir '.rot-canary-mode'
  if (Test-Path $f) { $v = ([System.IO.File]::ReadAllText($f)).Trim().ToLower(); if ('auto','manual','off' -contains $v) { return $v } }
  return 'auto'
}

# <coalmine-shared: ps-config> — synced from hooks/_shared/ps-config.ps1 by build-plugin; edit the partial, not this block
function Find-GitRoot {
  $dir = (Get-Location).Path
  while ($true) {
    if (Test-Path (Join-Path $dir '.git')) { return $dir }
    $parent = Split-Path $dir -Parent
    if (-not $parent -or $parent -eq $dir) { return (Get-Location).Path }
    $dir = $parent
  }
}

function Remove-JsoncComments {
  # Port of Node stripJsonc: strips // and /* */ comments OUTSIDE strings only.
  # The regex alternation matches either a quoted string (consuming \" or any non-quote/non-backslash
  # char, so a value ending in \\ terminates the string correctly instead of leaking escape state)
  # or a // line comment, or a /* */ block comment — comments outside strings become empty string.
  param([string]$Text)
  $result = [System.Text.StringBuilder]::new($Text.Length)
  $i = 0
  $len = $Text.Length
  while ($i -lt $len) {
    $c = $Text[$i]
    if ($c -eq '"') {
      # consume string literal, preserving content
      $null = $result.Append($c); $i++
      while ($i -lt $len) {
        $sc = $Text[$i]
        $null = $result.Append($sc); $i++
        if ($sc -eq '\' -and $i -lt $len) { $null = $result.Append($Text[$i]); $i++ }  # escaped char
        elseif ($sc -eq '"') { break }
      }
    } elseif ($c -eq '/' -and ($i + 1) -lt $len -and $Text[$i + 1] -eq '/') {
      # // line comment — skip to end of line
      while ($i -lt $len -and $Text[$i] -ne "`n") { $i++ }
    } elseif ($c -eq '/' -and ($i + 1) -lt $len -and $Text[$i + 1] -eq '*') {
      # /* */ block comment — skip to */
      $i += 2
      while ($i -lt $len -and -not ($Text[$i] -eq '*' -and ($i + 1) -lt $len -and $Text[$i + 1] -eq '/')) { $i++ }
      if ($i -lt $len) { $i += 2 }
    } else {
      $null = $result.Append($c); $i++
    }
  }
  return $result.ToString()
}

function Read-CoalmineConfigFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $null }
  try {
    $rawJson = [System.IO.File]::ReadAllText($Path)
    $cleanJson = Remove-JsoncComments $rawJson
    $parsed = $cleanJson | ConvertFrom-Json
    if ($parsed -is [PSCustomObject]) { return $parsed }
    return $null
  } catch {
    return $null
  }
}

function Resolve-Aliased {
  # Effective scalar value for $Key, preferring the new name -- matches every read
  # site's own `if ($null -ne $cfg.X) {...} else {$cfg.legacyX}` chain. Needed
  # because clamping the canonical and legacy names as two INDEPENDENT keys is not
  # enough: a project setting the CANONICAL key unconditionally wins at the read
  # site over whatever a global config set under the LEGACY name, bypassing a
  # per-key clamp that never looks at the other layer's other name (board #113).
  param($Obj, [string]$Key, [string]$LegacyKey)
  if ($null -eq $Obj) { return $null }
  if ($null -ne $Obj.$Key) { return $Obj.$Key }
  if ($LegacyKey) { return $Obj.$LegacyKey }
  return $null
}
function Resolve-AliasedArray {
  # Same preference as Resolve-Aliased, array-shaped. @()-wraps the result: a
  # single-element JSON array survives ConvertFrom-Json as an array, but an
  # if-expression assignment (as used here) enumerates a one-element Object[]
  # into a scalar String -- the same trap the stop/touch hooks already guard
  # against at their own $disabledArr = @($disabled) call.
  # THE LEADING COMMA IS LOAD-BEARING, not style: `return @(...)` on an EMPTY
  # array collapses to $null at the CALLER once it crosses the function's
  # pipeline-output boundary (measured live: an empty-array return read back as
  # $null, silently skipping the union computation below and leaking a project
  # disabledCanaries:[] straight through as an unclamped escalation -- caught
  # before this shipped, board #113). `,@(...)` wraps the array as ONE pipeline
  # object so PowerShell's own unwrap-by-one-level rule hands the caller back
  # the original array, empty or not, instead of nothing at all.
  param($Obj, [string]$Key, [string]$LegacyKey)
  if ($null -eq $Obj) { return $null }
  if ($null -ne $Obj.$Key) { return ,@($Obj.$Key) }
  if ($LegacyKey -and $null -ne $Obj.$LegacyKey) { return ,@($Obj.$LegacyKey) }
  return $null
}

function Load-CoalmineConfig {
  # Two-level (Node twin parity): global ~/.claude/.coalmine.json overlaid per key
  # by the project <gitroot>/.coalmine.json (project wins). __proto__/constructor/
  # prototype keys dropped at merge for parity with the Node guard.
  # SAFER-VALUE-WINS GUARD (corrected 2026-07-09 — the old blanket "no guard
  # needed" verdict was HALF-WRONG): `updateMode` IS read by a hook (the Node
  # conductor) and drives a real consent escalation (an 'auto' check spends
  # tokens + networks unsolicited) — an untrusted project config must not flip
  # an explicit global 'off' up to 'auto'. Guarded below (Node≡PS parity),
  # mirroring CoalWash's mergeSafety. `autoFixMode` is the one true exception:
  # read by the AGENT from the raw file, never by any hook via this merge, so a
  # hook-side guard for IT would protect nothing — that half of the old verdict
  # stands.
  # TWO DEFECTS CLOSED (board #112, 2026-08-13, Node≡PS parity with `47b25bc`):
  # (1) `if (-not $globalCfg) { return $projectCfg }` returned the RAW project
  # config with ZERO merge/clamp applied — worse than the Node original, since
  # not even the shallow-merge loop ran. Both early returns removed; the merge
  # now always runs, and an absent global reads as the SAFER_ENUM key's schema
  # default, never "return project raw" or "anything goes". (2) `[array]::IndexOf`
  # on .NET strings is ordinal (case-sensitive) — the same case-fold hole as the
  # Node CW-H5 shape, letting a project 'AUTO' miss the lookup and ride the
  # earlier shallow-merge unclamped. Both sides are now lowercased before the
  # lookup.
  # THREE MORE KEYS CLOSED (board #113, 2026-08-13, corrected in the same unit's
  # findings-back after INSPECT) — `enableConductor`/`rotCanaryMode`/`disabledCanaries`
  # join the same clamp mechanism, PLUS their legacy aliases `conductor`/`mode`/`disable`
  # (found auditing the read sites: a project setting the CANONICAL key unconditionally
  # shadows a global set under the LEGACY name, bypassing a clamp that never looks at
  # the other name -- Resolve-Aliased/Resolve-AliasedArray close it by resolving each
  # LAYER's effective value through the same new-preferred-over-legacy chain BEFORE the
  # clamp compares them; the clamped result is mirrored into BOTH the canonical and
  # legacy field names, so a same-key-both-legacy scenario -- global conductor:false,
  # project conductor:true, neither ever touching the canonical name -- is still caught).
  # `enableConductor` was FIRST judged out of scope ("no PS hook reads it, a clamp
  # defends nothing") and left off $saferEnum entirely -- WRONG, caught by this unit's
  # own new tests failing: this file's own updateMode precedent (directly above, M1)
  # already clamps a key with NO PS consumer "because the merge function itself must
  # stay Node<->PS parity" -- the same reasoning applies to enableConductor and was
  # inconsistently skipped for it alone. `enableConductor`'s order is `@($false, $true)`
  # (a boolean pair, not a string enum) -- compared via a direct index lookup, never
  # `.ToLower()` (booleans aren't strings; `([string]$false).ToLower()` produces
  # `'false'`, which cannot match an $order array of real booleans via [array]::IndexOf
  # -- the exact bug the Node side's `fold()` non-string-passthrough exists to avoid,
  # reproduced here as a live measured failure before being fixed, not a hypothetical).
  # TWO NODE-SIDE FIXES DELIBERATELY *NOT* PORTED, VERIFIED not assumed: PowerShell's
  # `-contains`/`-eq` are CASE-INSENSITIVE by default (confirmed live: 'ROT-CANARY'
  # -contains-matches 'rot-canary', 'OFF' -eq-matches 'off') -- unlike Node's
  # `.includes()`/`===`, so (a) disabledCanaries array entries need no case-fold here
  # (the read sites' own `-contains` already folds), and (b) the clamp's WINNING
  # value is stored as-is (not canonicalized to $order[i]) -- the K1 storage-trap
  # fix Node needed (a raw-cased winner reaching a strict === consumer) protects
  # against nothing reachable on this platform's own case-insensitive operators.
  $globalCfg = Read-CoalmineConfigFile (Join-Path (Join-Path $env:USERPROFILE '.claude') '.coalmine.json')
  $projectCfg = Read-CoalmineConfigFile (Join-Path (Find-GitRoot) '.coalmine.json')
  if (-not $globalCfg -and -not $projectCfg) { return $null }
  $merged = [ordered]@{}
  foreach ($src in @($globalCfg, $projectCfg)) {
    if (-not $src) { continue }
    foreach ($prop in $src.PSObject.Properties) {
      if ($prop.Name -in @('__proto__', 'constructor', 'prototype')) { continue }
      $merged[$prop.Name] = $prop.Value
    }
  }
  # Constrain whenever the PROJECT sets the key (via either name) — an absent
  # global is its schema default, never "no preference to defend" (board #112).
  # Case-fold both sides before the ordered lookup so a differently-cased project
  # value cannot dodge the CLAMP DECISION (irrelevant to the STORED result on
  # this platform — see the header note above).
  $saferEnum = @{
    updateMode = @{ order = @('off', 'remind', 'ask', 'auto'); default = 'ask' } # index 0 = safest; default = config-schema.mjs's declared factory default
    rotCanaryMode = @{ order = @('off', 'manual', 'auto'); default = 'auto'; legacy = 'mode' }
    enableConductor = @{ order = @($false, $true); default = $true; legacy = 'conductor' } # boolean pair -- compared directly below, never .ToLower()'d
  }
  foreach ($key in $saferEnum.Keys) {
    $spec = $saferEnum[$key]
    $projectVal = Resolve-Aliased $projectCfg $key $spec.legacy
    if ($null -eq $projectVal) { continue } # project expressed no opinion via either name
    $globalVal = Resolve-Aliased $globalCfg $key $spec.legacy
    $globalValue = if ($null -ne $globalVal) { $globalVal } else { $spec.default }
    $order = $spec.order
    $isBoolOrder = $order[0] -is [bool]
    $gi = if ($isBoolOrder) { [array]::IndexOf($order, [bool]$globalValue) } else { [array]::IndexOf($order, ([string]$globalValue).ToLower()) }
    $pi = if ($isBoolOrder) { [array]::IndexOf($order, [bool]$projectVal) } else { [array]::IndexOf($order, ([string]$projectVal).ToLower()) }
    if ($gi -eq -1 -or $pi -eq -1) { continue } # unknown value: leave the shallow-merge result
    $result = if ($pi -le $gi) { $projectVal } else { $globalValue } # project may not be LOUDER than the (explicit-or-default) global
    $merged[$key] = $result
    if ($spec.legacy) { $merged[$spec.legacy] = $result } # a same-key-both-legacy scenario needs the legacy field itself clamped too, not just the canonical mirror
  }
  # Same effective-value resolution as $saferEnum above (via either the new or
  # legacy key name), but the safer direction for an array is UNION (dedup), not
  # "pick one side" — either side may add. disabledCanaries: more entries = more
  # disabled = quieter, the same QUIETEN-only direction hooks-safety.md §9 already
  # requires of scanExcludePaths on the Node side (scanExcludePaths itself has no
  # PS consumer -- not ported).
  $unionArrayKeys = @{ disabledCanaries = @{ default = @(); legacy = 'disable' } }
  foreach ($key in $unionArrayKeys.Keys) {
    $spec = $unionArrayKeys[$key]
    $projectArr = Resolve-AliasedArray $projectCfg $key $spec.legacy
    if ($null -eq $projectArr) { continue } # project expressed no opinion via either name
    $globalArrRaw = Resolve-AliasedArray $globalCfg $key $spec.legacy
    $globalArr = if ($null -ne $globalArrRaw) { $globalArrRaw } else { $spec.default } # absent global = its schema default ([]), never "nothing to union"
    $merged[$key] = @(@($globalArr) + @($projectArr) | Select-Object -Unique)
  }
  return [PSCustomObject]$merged
}

function Test-ValidSessionId {
  # Phoenix #10 (sandbox): allowlist session_id — a traversal-shaped sid (e.g. ..\..\x)
  # must not escape $env:TEMP via Join-Path. Non-conforming -> fail-silent (Phoenix #4).
  param([string]$Sid)
  return ($Sid -and $Sid -match '^[A-Za-z0-9_-]+$')
}
# </coalmine-shared: ps-config>

try {
  $cfg = Load-CoalmineConfig
  $staleDays = 7
  if ($cfg) {
    $disabled = if ($null -ne $cfg.disabledCanaries) { $cfg.disabledCanaries } else { $cfg.disable } # legacy key honored
    # Node parity: force to an array. ConvertFrom-Json PRESERVES a single-element array,
    # but the if-expression assignment above enumerates a single-element Object[] into a
    # scalar String — so an old `-is [array]` guard dropped {"disabledCanaries":["rot-canary"]}
    # to @() and the kill-switch silently no-op'd. @($disabled) re-wraps a scalar (and $null) safely.
    $disabledArr = @($disabled)
    if ($disabledArr -contains 'rot-canary' -or $disabledArr -contains 'all') { exit 0 }
    $rcCfgMode = if ($null -ne $cfg.rotCanaryMode) { $cfg.rotCanaryMode } else { $cfg.mode } # legacy key honored
    if ($rcCfgMode -eq 'off' -or $rcCfgMode -eq 'manual') { exit 0 }
    # Clamp at read time to a positive integer (floor 1, not 0; Node≡PS parity) — the
    # schema bound (min:1) is enforced only by verify.mjs, never at hook read time. A
    # raw 0 pushes the cutoff to "now": the sweep below runs BEFORE this session's own
    # .touched/.smells/.scanned markers are read, so a marker written earlier THIS
    # session already has a write-time < "now" and 0 deletes it too — silently
    # suppressing this session's own end-of-scan nudge, on top of deleting every
    # concurrent session's fresh temp. A negative value pushes the cutoff further into
    # the future (same bug, worse); a non-numeric value → the default 7.
    $tsd = $cfg.tempSweepStaleDays -as [double]
    if ($null -ne $tsd) { $staleDays = [Math]::Max(1, [int][Math]::Floor($tsd)) }
  }
  if ((Get-RcMode) -ne 'auto') { exit 0 }

  # Phoenix #1 (zero garbage) + #8 (deterministic): sweep stale rot-canary temp files
  # (legacy rotcanary-* prefix too), throttled to once per 24h by a marker file's
  # timestamp - no randomness. The 0-byte marker is the machine-level gate itself.
  # NAMED DIVERGENCE from the Node twin (CWK-031/U8, 2026-08-31): hooks/rot-canary-stop.js
  # moved this marker into a private os.tmpdir()/coalmine/ subdir (mode 0o700 + an lstat
  # dir-symlink guard) and re-stamps it via per-pid-temp + rename instead of a plain write.
  # NOT ported, deliberately - the threat it closes does not exist on this script's only
  # platform, and the hardening would be pure cost:
  #   1. That defect is a SHARED-/tmp one. Windows $env:TEMP is PER-USER
  #      (C:\Users\<name>\AppData\Local\Temp, ACL'd to that user), so another unprivileged
  #      local user cannot pre-plant anything at this fixed name. Unix /tmp is the shared
  #      root that makes the Node path exploitable; this script never runs there.
  #   2. This is the NO-NODE Windows fallback (see README) - it is not the Linux/macOS
  #      path by construction, so the exploitable variant is unreachable here.
  #   3. Creating a symlink on Windows needs SeCreateSymbolicLinkPrivilege (admin, or
  #      Developer Mode); 0o700 has no meaning on NTFS ACLs either.
  # Residual, stated rather than implied: a SAME-USER process could still plant a link
  # here - but a same-user process can already write this user's files directly, so it
  # crosses no privilege boundary and gains nothing. Re-open this if the PS fallback is
  # ever made to run on a Unix shell.
  #
  # SAME DIVERGENCE, SECOND HALF (CWK-043, 2026-08-31): the Node twins now pass an explicit
  # `mode: 0o600` on every os.tmpdir() write (CodeQL js/insecure-temporary-file #66/#67 -
  # its sink is a temp write with no mode). NOT portable here and not needed here, for two
  # independent reasons: [System.IO.File]::WriteAllText has no mode/permission parameter at
  # all, and a POSIX mode is not the access model on NTFS (ACLs are) - so there is nothing
  # to pass and nothing it would mean. The threat it hardens against is also absent for the
  # reasons above: $env:TEMP is per-user and ACL'd, so this file is already scoped to this
  # user by the directory it sits in. Applies to BOTH WriteAllText calls in this script
  # (this marker and the .scanned acknowledgement marker below).
  $marker = Join-Path $env:TEMP 'rot-canary-sweep.marker'
  $doSweep = $true
  if ([System.IO.File]::Exists($marker)) {
    if ([System.IO.File]::GetLastWriteTimeUtc($marker) -gt [DateTime]::UtcNow.AddHours(-24)) { $doSweep = $false }
  }
  if ($doSweep) {
    [System.IO.File]::WriteAllText($marker, '')
    Get-ChildItem (Join-Path $env:TEMP 'rot-canary-*'), (Join-Path $env:TEMP 'rotcanary-*') -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -ne 'rot-canary-sweep.marker' -and $_.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddDays(-$staleDays) } |
      Remove-Item -Force -ErrorAction SilentlyContinue
  }

  $raw = [Console]::In.ReadToEnd()
  if (-not $raw) { exit 0 }
  # Strip a leading BOM some shells prepend when piping stdin.
  $raw = $raw.TrimStart([char]0xFEFF)
  $in = $raw | ConvertFrom-Json
  if ($in.stop_hook_active) { exit 0 }
  $sid = $in.session_id; if (-not (Test-ValidSessionId $sid)) { exit 0 }
  $base = Join-Path $env:TEMP "rot-canary-$sid"
  $touched = "$base.touched"
  if (-not [System.IO.File]::Exists($touched)) { exit 0 }
  $scanned = "$base.scanned"
  $touchedTicks = [System.IO.File]::GetLastWriteTimeUtc($touched).Ticks
  if ([System.IO.File]::Exists($scanned)) {
    # Marker stores the .touched ticks captured at nudge time
    $stored = 0L
    $rawMark = ([System.IO.File]::ReadAllText($scanned)).Trim()
    if ($rawMark -match '^\d+$') { $stored = [long]$rawMark }
    if ($touchedTicks -le $stored) {
      # Batch already acknowledged on a previous stop — state no longer needed.
      foreach ($f in @($touched, "$base.smells", $scanned)) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
      exit 0
    }
  }
  $files = [System.IO.File]::ReadAllLines($touched) | Where-Object { $_ -and [System.IO.File]::Exists($_) } | Sort-Object -Unique
  if (-not $files) { exit 0 }

  # autoScanFileCap and autoScanFileCapSlice implementation.
  # Clamp at read time to a positive integer (Node≡PS parity) — the schema bound
  # (min:1) is enforced only by verify.mjs, never at hook read time. Without this,
  # {0} emits an empty-list nudge and {-1}/non-int makes Select-Object -First throw.
  $fileCap = 10
  $fileCapSlice = 5
  if ($cfg) {
    if ($cfg.autoScanFileCap -ne $null) { $fileCap = [Math]::Max(1, [int][Math]::Floor([double]$cfg.autoScanFileCap)) }
    if ($cfg.autoScanFileCapSlice -ne $null) { $fileCapSlice = [Math]::Max(1, [int][Math]::Floor([double]$cfg.autoScanFileCapSlice)) }
  }

  $capNotice = ''
  if ($files.Count -gt $fileCap) {
    # Sort by last write time (newest first)
    $files = $files | Sort-Object { (Get-Item $_).LastWriteTimeUtc } -Descending
    $files = $files | Select-Object -First $fileCapSlice
    $capNotice = "`n`n(Auto-scan capped at $fileCapSlice files to prevent token leakage; remaining files can be scanned manually)"
  } else {
    $files = $files | Sort-Object
  }

  $smellText = ''
  if ([System.IO.File]::Exists("$base.smells")) {
    $sm = [System.IO.File]::ReadAllLines("$base.smells") | Where-Object { $_ } | Sort-Object -Unique
    if ($sm) { $smellText = "`nTripwires flagged at edit time:`n" + ($sm -join "`n") }
  }
  # Acknowledgement marker — stores the .touched ticks captured at nudge time.
  [System.IO.File]::WriteAllText($scanned, [string]$touchedTicks)
  $list = ($files | ForEach-Object { "  - $_" }) -join "`n"
  $reason = "Code-health auto-check (session end): code files were edited this session. Before stopping, invoke the rot-canary skill at DEPTH=QUICK with SCOPE = these touched files + their direct callers:`n$list$smellText$capNotice`n`nReport CONFIRMED findings only (severity table; one line if none). If findings exist and a user is present, end by offering the fix menu via your question tool - never fix without a chosen option. (Disable: create ~/.claude/.rot-canary-off)"
  $out = @{ decision = 'block'; reason = $reason } | ConvertTo-Json -Compress
  Write-Output $out
  exit 0
} catch { exit 0 }
