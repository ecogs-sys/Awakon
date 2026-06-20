# tools

Standalone developer utilities for Awakon. These are not part of the app build.

## `ipc-log-viewer.html` — IPC log viewer

A self-contained, zero-dependency viewer for the IPC JSONL logs produced by the
desktop app's IPC logger (see `docs/troubleshooting/` and `--log-ipc` /
`AWAKON_LOG_IPC`). Logs land in e.g. `C:\temp\ipc-logs\ipc-*.jsonl`.

### Usage

1. Double-click `ipc-log-viewer.html` (or open it in any modern browser).
2. Click **Open .jsonl…** or drag a log file onto the window.

Everything runs locally in the browser — nothing is uploaded.

### What it does

- Renders each JSONL record as a row: line #, time (`HH:MM:SS.mmm`), `+Δms`
  since the previous record, direction (`req`/`event`), `wcId`, channel,
  `durationMs` (slow calls highlighted), and a one-line summary.
- **Decodes terminal data**: payloads carrying base64 `data` (e.g.
  `event.session.data`, `core.session.write`, `core.session.replay`) are
  base64-decoded and have their ANSI/OSC/control escape sequences stripped so
  the summary is readable text.
- **Search & filter**: free-text search across channel, decoded text, and raw
  JSON; filter by direction, channel, or `wcId`; toggles to hide `session.data`
  noise or show errors only.
- **Detail panel**: click a row (or use ↑/↓; `Esc` closes) to see pretty-printed
  `payload`/`response`. Terminal data offers three views — decoded (clean),
  raw + visible escapes, and the original base64.
- Virtualized list, so large (tens of MB) logs stay responsive. Malformed lines
  are shown inline rather than breaking the view.
