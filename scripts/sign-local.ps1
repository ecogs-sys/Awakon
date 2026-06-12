<#
.SYNOPSIS
    Build the Awakon unpacked Windows app and sign it with a self-signed
    certificate for local runs (clears SmartScreen / "unknown publisher").

.DESCRIPTION
    Local development only. Produces a fresh win-unpacked via electron-builder
    --dir, then signs Awakon.exe with an auto-managed self-signed code-signing
    certificate that is trusted on this machine only. Uses native PowerShell
    cmdlets, so no Windows SDK / signtool.exe is required.

    Re-runnable: the certificate is created once and reused; the exe is
    re-signed on every build.

.PARAMETER SkipBuild
    Sign the most recent existing win-unpacked instead of building first.
#>
[CmdletBinding()]
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

# Anchor to repo root so relative paths work regardless of where the script is invoked from.
Set-Location (Join-Path $PSScriptRoot '..')

function Invoke-Native {
    $cmd = $args[0]
    $cmdArgs = $args[1..($args.Length - 1)]
    & $cmd @cmdArgs
    if ($LASTEXITCODE -ne 0) { throw "Command failed (exit $LASTEXITCODE): $($args -join ' ')" }
}

$certSubject = 'Awakon Local Dev (Self-Signed)'

# --- ensure a self-signed code-signing certificate exists ---
function Get-OrCreateSigningCert {
    $existing = Get-ChildItem Cert:\CurrentUser\My |
        Where-Object {
            $_.Subject -eq "CN=$certSubject" -and
            $_.EnhancedKeyUsageList.FriendlyName -contains 'Code Signing'
        } |
        Sort-Object NotAfter -Descending |
        Select-Object -First 1

    if ($existing) {
        Write-Host "Using existing signing certificate (thumbprint $($existing.Thumbprint))."
        return $existing
    }

    Write-Host "Creating self-signed code-signing certificate '$certSubject'..."
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject "CN=$certSubject" `
        -CertStoreLocation Cert:\CurrentUser\My `
        -KeyUsage DigitalSignature `
        -KeyExportPolicy Exportable `
        -NotAfter (Get-Date).AddYears(5)

    # Trust the cert on this machine so the resulting signature is honored, not just present.
    foreach ($store in @('Root', 'TrustedPublisher')) {
        $target = New-Object System.Security.Cryptography.X509Certificates.X509Store($store, 'CurrentUser')
        $target.Open('ReadWrite')
        $target.Add($cert)
        $target.Close()
        Write-Host "  Added certificate to CurrentUser\$store."
    }

    return $cert
}

$cert = Get-OrCreateSigningCert

# --- build the unpacked app ---
if ($SkipBuild) {
    Write-Host "Skipping build (-SkipBuild); signing the most recent win-unpacked."
} else {
    Write-Host "Building workspace packages..."
    Invoke-Native pnpm -r --filter './packages/*' build

    Write-Host "Compiling Electron app..."
    Invoke-Native pnpm --filter @awakon/desktop build

    Write-Host "Packaging unpacked Windows app (win-unpacked)..."
    Invoke-Native pnpm --filter @awakon/desktop dist:dir
}

# --- locate the unpacked executable ---
$version = (Get-Content (Join-Path $PSScriptRoot '..\apps\desktop\package.json') | ConvertFrom-Json).version
$exePath = Join-Path $PSScriptRoot "..\apps\desktop\release\$version\win-unpacked\Awakon.exe"

if (-not (Test-Path $exePath)) {
    throw "Unpacked executable not found at: $exePath`nRun a build first (omit -SkipBuild)."
}
$exePath = (Resolve-Path $exePath).Path

# --- sign ---
Write-Host "Signing $exePath ..."
$result = Set-AuthenticodeSignature -FilePath $exePath -Certificate $cert -HashAlgorithm SHA256

if ($result.Status -ne 'Valid') {
    throw "Signing failed: $($result.Status) - $($result.StatusMessage)"
}

# --- done ---
Write-Host ""
Write-Host "Signed successfully." -ForegroundColor Green
Write-Host "  Exe:    $exePath"
Write-Host "  Signer: $($result.SignerCertificate.Subject)"
Write-Host "  Status: $($result.Status)"
