# PS parity tests for hooks/_shared/ps-config.ps1 (H3 + H4 bug fixes)
# Run: powershell -NoProfile -File scripts\lib\ps-config.test.ps1
# Zero external dependencies.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\..\hooks\_shared\ps-config.ps1')

$pass = 0; $fail = 0

function Check([string]$name, [bool]$cond) {
  if ($cond) { Write-Host "  PASS $name"; $script:pass++ }
  else        { Write-Host "  FAIL $name"; $script:fail++ }
}

# ---- H3: Test-ValidSessionId ----
Check 'valid alphanumeric sid accepted'     (Test-ValidSessionId 'abc123')
Check 'valid sid with dash-underscore'      (Test-ValidSessionId 'sess-id_01')
Check 'empty string rejected'               (-not (Test-ValidSessionId ''))
Check 'null rejected'                       (-not (Test-ValidSessionId $null))
Check 'traversal ..\.. rejected'            (-not (Test-ValidSessionId '..\..'))
Check 'traversal ../../etc rejected'        (-not (Test-ValidSessionId '../../etc'))
Check 'sid with slash rejected'             (-not (Test-ValidSessionId 'a/b'))
Check 'sid with dot rejected'               (-not (Test-ValidSessionId 'a.b'))
Check 'sid with space rejected'             (-not (Test-ValidSessionId 'a b'))

# ---- H4: Remove-JsoncComments (Node parity fixtures) ----

# 1. Full-line // comment (also worked in old regex)
$c1 = '{"a": 1 // line comment' + "`n}"
$r1 = (Remove-JsoncComments $c1) | ConvertFrom-Json
Check 'full-line // comment stripped'       ($r1.a -eq 1)

# 2. Inline trailing comment (FAILED with old regex — it matched only ^\\s*// lines)
$c2 = "{`"mode`": `"auto`", // trailing note`n`"count`": 3}"
$r2 = (Remove-JsoncComments $c2) | ConvertFrom-Json
Check 'inline trailing // stripped'         ($r2.mode -eq 'auto' -and $r2.count -eq 3)

# 3. // inside a string NOT stripped (old regex stripped the whole line → ConvertFrom-Json threw)
$c3 = '{"url":"http://example.com","mode":"auto"}'
$r3 = (Remove-JsoncComments $c3) | ConvertFrom-Json
Check '// inside string value preserved'    ($r3.url -eq 'http://example.com' -and $r3.mode -eq 'auto')

# 4. Block comment stripped
$c4 = '{"a":"keep","b":"keep2" /* block */}'
$r4 = (Remove-JsoncComments $c4) | ConvertFrom-Json
Check '/* */ block comment stripped'        ($r4.a -eq 'keep' -and $r4.b -eq 'keep2')

# 5. Backslash-terminated string before // string (escape-leak → old regex mis-stripped)
$bsVal = 'C:\'
$slashStr = 'a//b'
$c5 = '{"p":"C:\\","x":"a//b"}'
$r5 = (Remove-JsoncComments $c5) | ConvertFrom-Json
Check 'backslash-terminated string: escape-leak fixed (p=C:\)' ($r5.p -eq $bsVal)
Check 'backslash-terminated string: // inside next string preserved (x=a//b)' ($r5.x -eq $slashStr)

# 6. Mixed: inline comment + // in string + block comment
$c6 = @"
{
  "domain": "https://api.example.com", // endpoint
  "count": 5 /* the limit */
}
"@
$r6 = (Remove-JsoncComments $c6) | ConvertFrom-Json
Check 'mixed: // inline + // in string + block all handled'  ($r6.domain -eq 'https://api.example.com' -and $r6.count -eq 5)

# ---- M1: Load-CoalmineConfig safer-value-wins guard for updateMode ----
# No PS hook reads updateMode yet (the conductor is Node-only), but the merge
# function itself must stay Node<->PS parity and ships real logic — tested
# directly here since there is no PS hook to spawn it through.
function Test-SaferMerge {
  param($GlobalCfg, $ProjectCfg)
  $sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ('cm-psconfig-' + [guid]::NewGuid().ToString('N'))
  $homeDir = Join-Path $sandbox 'home'
  $proj = Join-Path $sandbox 'proj'
  New-Item -ItemType Directory -Path (Join-Path $homeDir '.claude') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $proj '.git') -Force | Out-Null
  if ($GlobalCfg) { ($GlobalCfg | ConvertTo-Json -Compress) | Set-Content -Path (Join-Path $homeDir '.claude\.coalmine.json') -Encoding UTF8 }
  if ($ProjectCfg) { ($ProjectCfg | ConvertTo-Json -Compress) | Set-Content -Path (Join-Path $proj '.coalmine.json') -Encoding UTF8 }
  $savedProfile = $env:USERPROFILE
  Push-Location $proj
  try {
    $env:USERPROFILE = $homeDir
    return Load-CoalmineConfig
  } finally {
    Pop-Location
    $env:USERPROFILE = $savedProfile
    Remove-Item $sandbox -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$sm1 = Test-SaferMerge -GlobalCfg @{ updateMode = 'off' } -ProjectCfg @{ updateMode = 'auto' }
Check 'safer-merge: project cannot escalate explicit global off -> auto' ($sm1.updateMode -eq 'off')

$sm2 = Test-SaferMerge -GlobalCfg @{ updateMode = 'auto' } -ProjectCfg @{ updateMode = 'off' }
Check 'safer-merge: project MAY move safer (auto global -> off project)' ($sm2.updateMode -eq 'off')

$sm3 = Test-SaferMerge -GlobalCfg $null -ProjectCfg @{ updateMode = 'auto' }
Check 'safer-merge: no explicit global config clamps to the schema default (board #112) -- project cannot escalate past it' ($sm3.updateMode -eq 'ask')

$sm4 = Test-SaferMerge -GlobalCfg @{ updateMode = 'off' } -ProjectCfg @{ updateMode = 'off' }
Check 'safer-merge: matching values pass through unchanged' ($sm4.updateMode -eq 'off')

# ---- board #113: enableConductor / rotCanaryMode / disabledCanaries safer-value-wins ----
# MEDIUM (INSPECT): the H3/H4/M1 coverage above never exercised the three keys board #113
# added, and it took CI going red on 4 releases before anyone noticed the M1-style bug that
# was already ALSO present for those three. Added here so the next Node<->PS drift is caught
# locally, not three releases later.

$sm5 = Test-SaferMerge -GlobalCfg @{ enableConductor = $false } -ProjectCfg @{ enableConductor = $true }
Check 'safer-merge: project cannot escalate explicit global enableConductor:false -> true' ($sm5.enableConductor -eq $false)

$sm6 = Test-SaferMerge -GlobalCfg @{ conductor = $false } -ProjectCfg @{ conductor = $true }
Check 'safer-merge: enableConductor legacy-key-only escalation (global conductor:false, project conductor:true) is clamped' ($sm6.conductor -eq $false)

$sm7 = Test-SaferMerge -GlobalCfg @{ rotCanaryMode = 'off' } -ProjectCfg @{ rotCanaryMode = 'AUTO' }
Check 'safer-merge: rotCanaryMode case-fold -- project "AUTO" (uppercase) cannot escape an explicit global "off"' ($sm7.rotCanaryMode -eq 'off')

$sm8 = Test-SaferMerge -GlobalCfg @{ rotCanaryMode = 'off' } -ProjectCfg @{ mode = 'auto' }
Check 'safer-merge: rotCanaryMode legacy-cross-key escalation (global rotCanaryMode:off, project mode:auto) is clamped' ($sm8.rotCanaryMode -eq 'off')

$sm9 = Test-SaferMerge -GlobalCfg @{ disabledCanaries = @('rot-canary') } -ProjectCfg @{ disabledCanaries = @() }
Check 'safer-merge: disabledCanaries UNION -- project cannot clear an explicit global disable list' ($sm9.disabledCanaries -contains 'rot-canary')

# Deliberate platform divergence, proven live rather than left as a comment-only claim
# (hooks/_shared/ps-config.ps1's own header note): PowerShell's -contains is
# case-insensitive, so a hand-edited uppercase entry needs no merge-layer case-fold here,
# unlike the Node side's `.includes()`.
$sm10 = Test-SaferMerge -GlobalCfg @{ disabledCanaries = @('ROT-CANARY') } -ProjectCfg $null
Check 'safer-merge: disabledCanaries global-only uppercase entry still matches via -contains (PS case-insensitive by default, no fold needed)' ($sm10.disabledCanaries -contains 'rot-canary')

Write-Host ''
Write-Host "PS results: $pass passed, $fail failed"
if ($fail -gt 0) { exit 1 } else { exit 0 }
