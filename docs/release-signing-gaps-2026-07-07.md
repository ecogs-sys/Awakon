# Release signing gaps — 2026-07-07

Tracked separately from the Microsoft Store readiness review
([`microsoft-store-review-2026-07-05.md`](microsoft-store-review-2026-07-05.md)), which
covers the MSIX/Store submission path only. These two items block the **direct-download
(GitHub Releases)** channels — `apps/desktop/electron-builder.json` — not the Store path.

## mac: dmg is unsigned and unnotarized (release blocker for that channel)

`electron-builder.json:27` sets `"identity": null` — electron-builder skips code signing
entirely for the `dmg` target. Consequences for anyone who downloads the dmg directly
(not via the Store, which isn't a mac distribution channel anyway):

- Gatekeeper blocks the unsigned app on first launch ("Awakon can't be opened because
  Apple cannot check it for malicious software"); the user must right-click → Open or
  clear the quarantine attribute manually.
- No notarization ticket, so even that bypass shows a scarier warning than a notarized
  app would.
- `electron-updater`'s mac auto-update path (`auto-update.ts`) verifies signatures on
  update packages when the app itself is signed — an unsigned app gets a weaker
  integrity story for in-place updates too.

**Fix (not yet done — needs an Apple Developer ID cert + notarization credentials,
which this environment doesn't have):** set `mac.identity` to a Developer ID Application
certificate, add `afterSign` notarization (electron-builder's `notarize` option or a
custom `afterSign` hook calling `@electron/notarize`), and store the signing
credentials/API key as CI secrets.

## Linux: no signature on release artifacts

`electron-builder.json`'s `publish` config auto-generates `latest-linux.yml` with a
sha512 hash of the AppImage, which `electron-updater` checks before applying an update —
so in-place updates aren't completely unauthenticated. But there is no GPG (or other)
detached signature over the AppImage/deb artifacts themselves, so:

- A user who downloads the AppImage directly from the GitHub release (not through the
  auto-updater) has no way to verify it came from this project rather than a
  compromised/mirrored release.
- The sha512 in `latest-linux.yml` is itself served from the same GitHub release —  it
  protects against transport corruption, not against a compromised release upload.

**Fix (not yet done — needs a maintainer GPG key + a signing step in the release
pipeline):** GPG-sign the AppImage/deb artifacts as part of the release build and publish
the detached `.sig`/`.asc` files alongside them, with the public key documented in the
repo (e.g. `SECURITY.md` or the release notes).
