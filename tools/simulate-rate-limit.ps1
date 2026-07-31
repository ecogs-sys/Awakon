<#
.SYNOPSIS
  Fake CLI that mimics Claude Code's rate-limit menu so Awakon's auto-resume
  feature (RateLimitDetector + reset-time-parser + ResumeScheduler, see
  packages/core/src) can be exercised end-to-end without waiting for a real
  session limit.

.DESCRIPTION
  Prints random "assistant output" lines, then at random points prints a
  rate-limit menu shaped exactly like Claude Code's:

    You've hit your session limit . resets 5:20pm (Pacific/Auckland)

    1. Stop and wait for limit to reset
    2. Upgrade your plan

    Enter to confirm . Esc to cancel

  That block is what packages/core/src/rate-limit-detector.ts looks for:
  the literal detectText ("Stop and wait for limit to reset"), a numbered
  option line, and an "Enter to confirm" footer. The "resets <time>" text is
  what packages/core/src/reset-time-parser.ts extracts. The displayed time is
  always converted into the Pacific/Auckland zone (falling back to no
  timezone -- i.e. the parser's local-zone fallback -- if that zone's tzdata
  isn't available on this machine), so the printed wall-clock time always
  round-trips back to the real "now + RenewDelaySeconds" instant regardless
  of which zone this script itself is running in.

  Run this inside an Awakon session tab (with autoResume.enabled = true in
  Settings) to test the real app end-to-end, or run it directly in a normal
  terminal and answer the two prompts yourself with Enter.

  Stage 1: as soon as the menu is shown, the script blocks waiting for a
  keypress (Enter) -- this is what Awakon's app answers automatically by
  writing responseText ("1\r") into the session. The moment that key
  arrives, a per-cycle log file is written recording the hit time and the
  renew (reset) time.

  Stage 2: the script then blocks again, waiting for a second keypress --
  this is what Awakon's ResumeScheduler answers by writing resumeText
  ("continue\r") shortly after the renew time passes. When that key
  arrives, a CONTINUED entry (with actual elapsed wait) is appended to the
  same log file, and random output resumes.

.PARAMETER MinLinesBeforeLimit
  Minimum number of random output lines printed before a rate limit fires.

.PARAMETER MaxLinesBeforeLimit
  Maximum number of random output lines printed before a rate limit fires.

.PARAMETER MinLineDelayMs
  Minimum delay between random output lines, in milliseconds.

.PARAMETER MaxLineDelayMs
  Maximum delay between random output lines, in milliseconds.

.PARAMETER RenewDelaySeconds
  How far in the future (from the moment the limit hits) the printed
  "resets <time>" should be. Kept short by default so a full hit -> renew
  cycle can be tested in under a minute.

.PARAMETER MaxCycles
  Number of rate-limit cycles to run before exiting. 0 = run forever
  (Ctrl+C to stop).

.PARAMETER MinCycleGapSeconds
  Minimum time between one cycle's hit and the next cycle's hit, for
  MaxCycles <> 1 runs. Awakon's SessionManager answers a detected menu once
  and then ignores re-detections of the same session for
  RESPONSE_COOLDOWN_MS (5 minutes -- packages/core/src/session-manager.ts)
  on the assumption that anything closer together than that is the same menu
  redrawing, not a second real rate-limit hit. If this script fired cycle 2
  before that cooldown cleared, Awakon would correctly -- by design -- decline
  to answer it, and the simulator would then sit forever at the stage-1
  keypress wait for a response that Awakon will never send. Defaults to 305s
  (the 5-minute cooldown plus a 5s margin against clock/scheduling jitter) so
  every cycle after the first is far enough from the previous one to be
  treated as a genuine new hit. Lower this only if you are intentionally
  testing the cooldown-suppression path itself (in which case Awakon will not
  answer, and you must press Enter/Esc yourself to unblock the wait).

  This timing gap alone is not sufficient, though: RateLimitDetector also
  keeps a sliding window of only the last 4096 raw characters it has seen
  (WINDOW_MAX -- packages/core/src/rate-limit-detector.ts) and only re-emits
  once the *previous* detectText occurrence has fully scrolled out of that
  window. Between cycles this script therefore also writes a deterministic
  block of filler output (see Write-DetectorWindowFlush) sized comfortably
  past 4096 characters, so cycle 2+'s menu is guaranteed to be seen as a
  fresh hit rather than silently ignored because the stale occurrence from
  the previous cycle was still inside the window.

.PARAMETER LogDir
  Directory for the per-cycle log files. Created if missing.

.EXAMPLE
  .\tools\simulate-rate-limit.ps1

.EXAMPLE
  .\tools\simulate-rate-limit.ps1 -MinLinesBeforeLimit 5 -MaxLinesBeforeLimit 10 -RenewDelaySeconds 20 -MaxCycles 3
#>

param(
    [int]$MinLinesBeforeLimit = 15,
    [int]$MaxLinesBeforeLimit = 30,
    [int]$MinLineDelayMs = 250,
    [int]$MaxLineDelayMs = 900,
    [int]$RenewDelaySeconds = 45,
    [int]$MaxCycles = 0,
    [int]$MinCycleGapSeconds = 305,
    [string]$LogDir = (Join-Path $PSScriptRoot "rate-limit-logs")
)

$ErrorActionPreference = "Stop"

if ($MinLinesBeforeLimit -gt $MaxLinesBeforeLimit) {
    throw "MinLinesBeforeLimit ($MinLinesBeforeLimit) must be <= MaxLinesBeforeLimit ($MaxLinesBeforeLimit)."
}
if ($MinLineDelayMs -gt $MaxLineDelayMs) {
    throw "MinLineDelayMs ($MinLineDelayMs) must be <= MaxLineDelayMs ($MaxLineDelayMs)."
}

# RateLimitDetector (packages/core/src/rate-limit-detector.ts) keeps only the last
# WINDOW_MAX=4096 raw characters it has seen. A detectText occurrence that is still
# anywhere inside that window suppresses re-detection, so a second, genuinely new hit
# is silently ignored unless the *previous* occurrence has fully scrolled out first.
# See .PARAMETER MinCycleGapSeconds for the companion time-based cooldown.
$RateLimitDetectorWindowChars = 4096
$WindowFlushChars = $RateLimitDetectorWindowChars + 1024

$Subjects = @("the parser", "the session store", "the ring buffer", "this component", "the settings schema", "the resume scheduler", "the test suite", "the build", "the IPC router", "the detector")
$Verbs    = @("looks correct", "needs a small tweak", "passed cleanly", "is worth double-checking", "handles the edge case", "should be refactored", "is now covered by tests", "matches the spec", "was the root cause", "can be simplified")
$Fillers  = @("Let me check.", "One moment.", "Looking at this now.", "Running the tests.", "That makes sense.", "Here's what I found.", "Updating now.", "Good catch.", "Moving on.", "Almost done.")

function Write-RandomLine {
    $roll = Get-Random -Minimum 0 -Maximum 3
    if ($roll -eq 0) {
        Write-Host (Get-Random -InputObject $Fillers)
    } else {
        $subject = Get-Random -InputObject $Subjects
        $verb = Get-Random -InputObject $Verbs
        Write-Host ("{0} {1}." -f ((Get-Culture).TextInfo.ToTitleCase($subject)), $verb)
    }
}

function Wait-ForKeypress {
    while ($true) {
        $key = [Console]::ReadKey($true)
        if ($key.Key -eq [ConsoleKey]::Enter) { break }
    }
    Write-Host ""
}

# Writes at least $MinChars of deterministic, instant (no per-line delay) filler so
# the previous cycle's detectText occurrence is guaranteed to scroll out of
# RateLimitDetector's sliding window before the next cycle's menu is printed. See the
# WINDOW_MAX comment near the top of this script for why this is necessary in addition
# to the MinCycleGapSeconds time-based wait.
function Write-DetectorWindowFlush {
    param([int]$MinChars)
    Write-Host "(flushing detector window before the next hit...)"
    $written = 0
    while ($written -lt $MinChars) {
        $line = ('-' * 78)
        Write-Host $line
        $written += $line.Length + [Environment]::NewLine.Length
    }
}

function Get-DisplayTimeZone {
    # "Pacific/Auckland" is the IANA id; "New Zealand Standard Time" is the
    # Windows id for the same zone -- try both so this works on Windows
    # PowerShell builds without full ICU/IANA tzdata.
    foreach ($id in @("Pacific/Auckland", "New Zealand Standard Time")) {
        try { return [System.TimeZoneInfo]::FindSystemTimeZoneById($id) } catch {}
    }
    return $null
}
$script:DisplayTz = Get-DisplayTimeZone
if (-not $script:DisplayTz) {
    Write-Warning "Pacific/Auckland timezone data not found on this machine -- falling back to no timezone in the printed message (reset-time-parser then uses the local zone, which still matches this script's own clock)."
}

function Get-FutureResetTargetUtc {
    param([datetime]$HitTimeLocal, [int]$DelaySeconds)
    $hitUtc = $HitTimeLocal.ToUniversalTime()
    $target = $hitUtc.AddSeconds($DelaySeconds)
    # Round UP to the next whole minute -- the printed message only carries
    # minute precision ("10:06pm"), so a target that lands mid-minute would
    # otherwise truncate down to a label matching the *current* minute,
    # reading as "now" instead of clearly in the future (and risking
    # reset-time-parser rolling it a full day forward if the real detector
    # fires a moment later, once that truncated minute has already passed).
    $remainderTicks = $target.Ticks % [TimeSpan]::TicksPerMinute
    if ($remainderTicks -ne 0) {
        $target = $target.AddTicks([TimeSpan]::TicksPerMinute - $remainderTicks)
    }
    # Guarantee at least one full minute past the hit time's own minute, even
    # for a very small -RenewDelaySeconds.
    $hitMinuteFloor = $hitUtc.AddTicks(-($hitUtc.Ticks % [TimeSpan]::TicksPerMinute))
    if ($target -le $hitMinuteFloor) {
        $target = $hitMinuteFloor.AddMinutes(1)
    }
    return $target
}

function Format-ResetLabel {
    param([datetime]$TargetUtc)
    # Convert the rounded target instant into Pacific/Auckland wall-clock time
    # -- NOT just format the local time with a hardcoded TZ label -- so the
    # printed time always parses back to the correct instant regardless of
    # which zone this script happens to be running in.
    if ($script:DisplayTz) {
        $zoned = [System.TimeZoneInfo]::ConvertTimeFromUtc($TargetUtc, $script:DisplayTz)
        $clock = $zoned.ToString("h:mmtt", [Globalization.CultureInfo]::InvariantCulture).ToLowerInvariant()
        return "$clock (Pacific/Auckland)"
    }
    $local = $TargetUtc.ToLocalTime()
    return $local.ToString("h:mmtt", [Globalization.CultureInfo]::InvariantCulture).ToLowerInvariant()
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Write-Host "=== Rate-limit simulator started ===" -ForegroundColor Cyan
Write-Host "Log dir: $LogDir"
Write-Host "Press Ctrl+C to stop at any time."
Write-Host ""

$cycle = 0
$script:lastHitTime = $null
while ($true) {
    $cycle++
    if ($MaxCycles -gt 0 -and $cycle -gt $MaxCycles) { break }

    $lineCount = Get-Random -Minimum $MinLinesBeforeLimit -Maximum ($MaxLinesBeforeLimit + 1)
    for ($i = 0; $i -lt $lineCount; $i++) {
        Write-RandomLine
        Start-Sleep -Milliseconds (Get-Random -Minimum $MinLineDelayMs -Maximum $MaxLineDelayMs)
    }

    # From cycle 2 onward, guarantee the previous cycle's menu text has scrolled out of
    # RateLimitDetector's 4096-char window before this cycle's menu is printed (see the
    # WINDOW_MAX comment near the top of this script) -- otherwise the real detector
    # would silently fail to treat this as a new hit even though MinCycleGapSeconds has
    # satisfied Awakon's separate time-based cooldown.
    if ($cycle -gt 1) {
        Write-DetectorWindowFlush -MinChars $WindowFlushChars
    }

    # Keep this hit at least MinCycleGapSeconds after the previous one, so Awakon's
    # RESPONSE_COOLDOWN_MS doesn't silently drop it as redraw churn (see
    # .PARAMETER MinCycleGapSeconds above) -- without this wait, a fast MaxCycles run
    # never exercises the auto-resume path past cycle 1.
    if ($script:lastHitTime) {
        $sinceLastHit = (New-TimeSpan -Start $script:lastHitTime -End (Get-Date)).TotalSeconds
        $remaining = $MinCycleGapSeconds - $sinceLastHit
        if ($remaining -gt 0) {
            Write-Host ""
            Write-Host ("Waiting {0:N0}s before the next hit, so Awakon's {1}s re-answer cooldown has cleared and this cycle is treated as a genuine new rate-limit event..." -f $remaining, $MinCycleGapSeconds) -ForegroundColor Yellow
            Start-Sleep -Seconds $remaining
        }
    }

    $hitTime = Get-Date
    $script:lastHitTime = $hitTime
    $renewTargetUtc = Get-FutureResetTargetUtc -HitTimeLocal $hitTime -DelaySeconds $RenewDelaySeconds
    $renewTime = $renewTargetUtc.ToLocalTime()
    $renewLabel = Format-ResetLabel -TargetUtc $renewTargetUtc

    Write-Host ""
    Write-Host ("You've hit your session limit . resets {0}" -f $renewLabel)
    Write-Host ""
    Write-Host "1. Stop and wait for limit to reset"
    Write-Host "2. Upgrade your plan"
    Write-Host ""
    Write-Host "Enter to confirm . Esc to cancel"

    $logFile = Join-Path $LogDir ("ratelimit-{0:D4}-{1:yyyyMMdd-HHmmss}.log" -f $cycle, $hitTime)
    @"
RATE LIMIT HIT
  cycle:       $cycle
  hit time:    $($hitTime.ToString("o"))
  renew time:  $($renewTime.ToString("o"))
  renew label: $renewLabel (as printed in the menu)
"@ | Set-Content -Path $logFile -Encoding utf8

    # Stage 1: block until "1" + Enter is typed (by a human, or by Awakon
    # writing responseText into this session's stdin).
    Wait-ForKeypress

    Write-Host ""
    Write-Host "Waiting until the limit resets..."
    Write-Host ""

    # Stage 2: block until "continue" + Enter is typed (by a human, or by
    # Awakon's ResumeScheduler writing resumeText after the renew time passes).
    Wait-ForKeypress

    $continueTime = Get-Date
    $waitedSeconds = [math]::Round((New-TimeSpan -Start $hitTime -End $continueTime).TotalSeconds, 1)
    Add-Content -Path $logFile -Encoding utf8 -Value @"

CONTINUED
  time:    $($continueTime.ToString("o"))
  waited:  ${waitedSeconds}s (hit -> continued)
"@

    Write-Host "Resuming..."
    Write-Host ""
}

Write-Host "=== Rate-limit simulator finished ($cycle cycle(s)) ===" -ForegroundColor Cyan
