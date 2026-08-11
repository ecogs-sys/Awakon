# Crash logging

Awakon records **unexpected crashes** — uncaught exceptions and unhandled promise
rejections in the main process — to a persistent log file. Unlike [IPC logging](./ipc-logging.md),
this is **always on** and needs no flags.

## Why it exists

An unexpected throw on a native async callback (for example, node-pty tearing down a
ConPTY session when a tab is closed after long uptime) has no `ipcMain.handle` frame
above it to catch it. Without a global handler, Node's default behavior is to print the
stack to a stderr nobody sees in a packaged app and then exit — the app "crashes without
any error." The crash handlers turn that into a logged stack trace and keep the app
running.

## Where the log lives

A single appended file, `crash.log`, in the app's log directory (`app.getPath('logs')`):

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\Awakon\logs\crash.log` |
| macOS | `~/Library/Logs/Awakon/crash.log` |
| Linux | `~/.config/Awakon/logs/crash.log` |

## Output format

JSON-lines, one object per crash:

```json
{"t":"2026-08-10T21:30:00.000Z","kind":"uncaughtException","message":"...","stack":"Error: ...\n    at ..."}
```

`kind` is either `uncaughtException` or `unhandledRejection`.

## Behavior on a crash

- The record is written synchronously (so it survives an immediate re-crash) and logged
  to the console as `[crash] <kind>: ...`.
- For an **uncaughtException**, a dialog tells the user an unexpected error occurred and
  points at `crash.log`. The app keeps running — for a terminal multiplexer, losing every
  open session to one stray throw is worse than continuing in a possibly-degraded state.
  The dialog is rate-limited to at most once per 10 s so a recurring throw can't storm it.
- **Unhandled rejections** are logged only (no dialog) to avoid noise.

## Reporting a crash

Attach `crash.log` to the bug report. If the crash is reproducible during a long session,
also enable [IPC logging](./ipc-logging.md) and capture the traffic leading up to it — the
two logs together pin down what the app was doing when it threw.

## Related code

- `apps/desktop/src/main/crash-logger.ts` — the handlers and the log writer.
- `apps/desktop/src/main/index.ts` — installs the handlers early at startup and wires the
  dialog.
