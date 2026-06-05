# Audit 2026-05-20 — Awakon Stage 1 implementation review

Audit of the Awakon codebase against the design spec
(`docs/superpowers/specs/2026-05-17-ai-pad-terminal-design.md`) and the three
implementation plans.

## Findings index

### Critical (break a promised feature)
- F1 — Pane sessions create phantom tabs in the chrome
- F2 — NewSessionDialog hidden by the terminal WebContentsView overlay
- F3 — Orphan-pane safety net kills all pane sessions when any tab closes
- F4 — NotificationBridge leaks listeners on macOS window reopen
- F5 — Rename via sidebar context menu never persists
- F6 — window.prompt() in chrome renderer for rename is unreliable

### High (correctness / spec drift)
- F7 — Pane attention notification click cannot focus the owning tab
- F8 — Exited tab is destroyed; spec requires a read-only exited state
- F9 — Renderer-crash "Tab needs restart" state not surfaced
- F10 — Panes have no close UI, no Ctrl+W, no exit handling
- F11 — AttentionDetector idle timer keeps the event loop alive
- F12 — Tab reorder is not persisted across restarts
- F13 — Live-data / replay race in TerminalHost

### Medium (UX / hygiene)
- F14 — NotificationBridge wired after bootstrap; early attention events missed
- F15 — README is significantly out of date
- F16 — Sidebar context menu has no Escape dismiss
- F17 — splits.spec.ts only asserts the app did not crash
- F18 — CI does not build the desktop app on Windows/macOS
- F19 — SessionStore save errors are silently swallowed
- F20 — RingBuffer spec/impl mismatch on UTF-8 safety
- F21 — NotificationBridge does not truncate the title
- F22 — NewSessionDialog default cwd '~' breaks on Windows
- F23 — IPC event fan-out sends every session's data to every view
- F24 — electron-builder permanently disables macOS signing

### Low
- F25 — Unused / redundant imports in main
- F26 — keyboard.ts has comment-only no-op handlers
- F27 — SessionStore writeChain silently resets on error
- F28 — SplitContainer divider drag listeners accumulate

## Fix branch
`fix/audit-20-05-2026-01` — branched from
`feat/stage1-plan3-splits-persistence-packaging`.
