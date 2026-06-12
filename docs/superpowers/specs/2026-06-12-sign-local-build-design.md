# Sign Local Unpacked Build — Design

**Date:** 2026-06-12
**Status:** Approved

## Goal

Provide a single command that produces a freshly built `win-unpacked` directory and
signs `Awakon.exe` with an auto-managed self-signed certificate, so the packaged app
launches locally without Windows SmartScreen / "unknown publisher" friction.

Scope is **local development only**. The self-signed certificate is trusted on the
developer's own machine and nowhere else.

## Decisions

- **Certificate source:** self-signed, auto-generated and reused.
- **Sign scope:** main executable only (`Awakon.exe`).
- **Build step:** build then sign (produce a fresh `win-unpacked`, then sign it).
- **Platform:** Windows only. Authenticode is a Windows concept; no `.sh` counterpart.

## Signing Mechanism

Use native PowerShell cmdlets — **no Windows SDK / `signtool.exe` dependency**:

- `New-SelfSignedCertificate` — create the code-signing cert.
- `Set-AuthenticodeSignature` — sign the exe (SHA256 digest).

This keeps the script zero-install on any Windows box with PowerShell.

## Script: `scripts/sign-local.ps1`

Flow:

1. **Anchor to repo root** via `$PSScriptRoot/..` (matches `scripts/build.ps1`).
2. **Ensure cert exists.** Look for a cert named `Awakon Local Dev (Self-Signed)` in
   `Cert:\CurrentUser\My` with a code-signing EKU. If absent:
   - Create it with `New-SelfSignedCertificate` (~5-year validity, code-signing EKU).
   - Add it to **Trusted Root** and **Trusted Publisher** for the current user so the
     resulting signature is actually *trusted* on this machine.
   Reused on subsequent runs (idempotent).
3. **Build then package.** Run the workspace + desktop build, then
   `electron-builder --dir` (stops at `win-unpacked`, skips the NSIS installer). A new
   `dist:dir` npm script is added to `apps/desktop/package.json`.
4. **Locate the exe.** `apps/desktop/release/<version>/win-unpacked/Awakon.exe`, where
   `<version>` is read from `apps/desktop/package.json`.
5. **Sign** with `Set-AuthenticodeSignature` (SHA256). No timestamp — not meaningful for
   a local self-signed cert.
6. **Verify & report.** Re-read signature status, print the signed exe path + signer,
   exit non-zero on failure.

## Error Handling

- `$ErrorActionPreference = 'Stop'` and an `Invoke-Native` exit-code helper, matching
  `scripts/build.ps1`.
- Fail clearly if the build produced no `win-unpacked`.

## Out of Scope (YAGNI)

- No `.sh` counterpart (Windows-only concept).
- No installer (NSIS) signing.
- No all-binaries signing (main exe only, per decision).
- No timestamp server.
