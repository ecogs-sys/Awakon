/**
 * PowerShell shell-integration script, held as a string rather than a `.ps1` on disk.
 *
 * Why a string: PowerShell's ExecutionPolicy governs script FILES, and Windows clients
 * default to `Restricted`, where dot-sourcing one fails outright ("running scripts is
 * disabled on this system"). ExecutionPolicy does not apply to code passed via
 * `-EncodedCommand`, so the integration is injected as encoded source and never touches
 * the filesystem. That also means there is nothing to `asarUnpack` — a packaged build
 * has no file for PowerShell to fail to read out of the archive.
 *
 * Everything here WRAPS rather than replaces: a user's prompt framework (oh-my-posh,
 * starship) must keep working, and a second injection must be a no-op. If any hook
 * throws, the shell has to stay fully usable — a broken integration is an inconvenience,
 * a broken shell is a bug report.
 */
export const PWSH_SHELL_INTEGRATION = String.raw`
$ESC = [char]27
$BEL = [char]7

# --- Prompt markers: D (previous command finished), A (prompt start), B (input start)
if (-not (Test-Path variable:global:__awakonOrigPrompt)) {
  $global:__awakonOrigPrompt = $function:prompt
}

function global:prompt {
  # $? MUST be read first: any statement before it overwrites the value we care about.
  $lastSucceeded = $?
  $lastExit = $global:LASTEXITCODE

  # $LASTEXITCODE only reflects native executables; a failing cmdlet leaves it stale,
  # so a bare read would report a wrong exit code. Combine with $?.
  $code = 0
  if (-not $lastSucceeded) {
    if ($null -ne $lastExit -and $lastExit -ne 0) { $code = $lastExit } else { $code = 1 }
  } elseif ($null -ne $lastExit -and $lastExit -ne 0) {
    $code = $lastExit
  }

  $out = "$ESC]133;D;$code$BEL" + "$ESC]133;A$BEL"

  # cwd (OSC 7). Let .NET build the file:// URI so spaces and other characters are
  # percent-encoded properly — a manual separator swap produces a malformed URL.
  # ProviderPath guards against non-filesystem locations (registry, cert: drives).
  try {
    if ($PWD.Provider.Name -eq 'FileSystem') {
      $out += "$ESC]7;$(([uri]$PWD.ProviderPath).AbsoluteUri)$BEL"
    }
  } catch { }

  # The user's own prompt, unchanged and in its original position.
  try { $out += & $global:__awakonOrigPrompt } catch { $out += "PS $($PWD.Path)> " }

  $out += "$ESC]133;B$BEL"

  # Restore $LASTEXITCODE: reading it above is harmless, but anything we ran since
  # could have changed it, and the user's next prompt must see the real value.
  $global:LASTEXITCODE = $lastExit
  return $out
}

# --- Command markers: C (command began) + the command line itself.
# PSReadLine supplies PSConsoleHostReadLine; the host calls it to read each line, so
# wrapping it gives us the command text at the moment it is submitted.
if (Get-Command PSConsoleHostReadLine -ErrorAction SilentlyContinue) {
  if (-not (Test-Path variable:global:__awakonOrigReadLine)) {
    $global:__awakonOrigReadLine = $function:PSConsoleHostReadLine
  }
  function global:PSConsoleHostReadLine {
    $line = & $global:__awakonOrigReadLine
    try {
      [Console]::Write("$ESC]133;C$BEL")
      [Console]::Write("$ESC]1337;awakonCommand=$line$BEL")
    } catch { }
    return $line
  }
}
`;
