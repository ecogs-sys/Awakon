# IPC Logging — Design

**Date:** 2026-06-20
**Status:** Approved (pending implementation plan)

## Problem

Awakon's main/renderer IPC is hard to troubleshoot over long-running sessions.
When something misbehaves after hours of use (state drift, missed events, a tab
that stops responding), there is no record of the IPC traffic that led there.

We want an opt-in capability: when the app is started with a target directory,
it logs **all** IPC traffic to disk so a developer can inspect what happened
after the fact.

## Goals

- Capture every application IPC message — requests (renderer→main) and events
  (main→renderer) — with full payloads.
- Enable it at startup via a CLI flag or environment variable; off by default
  with zero overhead when not enabled.
- Survive long runs: rotate log files by size and cap total retained files so
  the directory cannot grow without bound.
- Never break or slow IPC: a logging failure must be swallowed, never thrown
  into the IPC path.

## Non-Goals

- No in-UI toggle (Settings dialog). Activation is startup-only.
- No redaction/filtering of payloads. Full payloads are logged by design (see
  Security note).
- No log viewer/analysis tooling. Output is plain JSONL for `grep`/`jq`.
- No automatic upload or telemetry. Files stay local.

## Activation

Resolved once at startup, in precedence order:

1. CLI flag: `--log-ipc <dir>` or `--log-ipc=<dir>`
2. Env var: `AWAKON_LOG_IPC=<dir>`

If neither is present, logging is fully disabled — no interceptors are
installed and there is no runtime cost.

Optional tuning env vars (only read when logging is enabled):

- `AWAKON_LOG_IPC_MAX_FILES` — max retained rotated files (default `20`).
- `AWAKON_LOG_IPC_MAX_BYTES` — size threshold to roll a file (default
  `52428800`, i.e. 50 MB).

A pure function performs resolution:

```ts
resolveLogConfig(argv: string[], env: NodeJS.ProcessEnv): IpcLogConfig | null
// returns { dir, maxFiles, maxBytes } when enabled, else null
```

Startup behavior when enabled:

- `fs.mkdirSync(dir, { recursive: true })`.
- If the directory cannot be created or written, emit a single
  `console.warn('[ipc-log] disabled: <reason>')` and continue with logging
  **disabled**. The app never crashes because of logging.

## Interception

To log *all* IPC without editing every handler, two wrappers are installed
**once, before any handler registers and before any window opens**. (In
`main/index.ts` this must happen before line ~25's `new IpcRouter(...)`, whose
constructor binds handlers.)

### Requests (renderer → main)

Monkey-patch `ipcMain.handle` (and `ipcMain.on` as cheap insurance for any
future fire-and-forget channel). The wrapper:

1. Records the inbound `payload` and a start time.
2. Invokes the original listener (awaiting it if it returns a Promise).
3. Logs **one** entry on completion with `payload`, `response`, `durationMs`.
4. On a thrown error, logs the same entry with an `error` field, then
   re-throws so observable behavior is unchanged.

Note: most handlers in this codebase return a structured `{ error }` object
rather than throwing; those are captured normally as the `response`.

### Events (main → renderer)

Wrap each WebContents' `send` as it is created, via
`app.on('web-contents-created', (_e, wc) => { /* wrap wc.send */ })`. This
captures `IpcRouter.broadcast`, the direct `chromeWindow.webContents.send(...)`
calls in `main/index.ts`, and any future sender. A broadcast to N views produces
N entries, each tagged with the target `wcId`, so fan-out is visible.

> **Note:** an earlier draft proposed patching `WebContents.prototype.send`.
> That does not work: Electron exports `WebContents` only as a *type*, and the
> runtime `webContents` namespace object has no usable `.prototype`, so prototype
> patching captures nothing (the dereference throws and only request logging
> survives). Per-instance wrapping at creation time is version-agnostic and
> covers the chrome window and every terminal WebContentsView.

### Channel filter

Both wrappers log only application channels — those whose name starts with
`core.` or `event.` (every `IpcChannel` value uses one of these prefixes).
Electron-internal sends are ignored, keeping the log free of framework noise.

### Safety

Every logging operation is wrapped in `try/catch`. A failure to serialize or
write is swallowed (at most a single `console.warn`), and the original IPC
call proceeds and returns normally.

## The Sink — `IpcLogger`

Append-only JSONL, one object per line, size-rotated with a retention cap.

### File naming

```
ipc-<launchTimestamp>-NNN.jsonl
# e.g. ipc-20260620-143000-001.jsonl
```

The launch-timestamp prefix (set once when the logger is constructed) means a
restart never clobbers a previous run's files. `NNN` increments on each
rotation within the run.

### Rotation

- Backed by an append `fs.WriteStream` (`flags: 'a'`).
- Bytes written are tracked via `Buffer.byteLength(line)`.
- When the running total for the current file would exceed `maxBytes`, end the
  current stream, increment `NNN`, and open the next file.

### Retention cap

After each rotation, list files in `dir` matching `ipc-*.jsonl`, sort by name
(timestamp+seq is lexically chronological), and delete the oldest until at most
`maxFiles` remain. Deletion is strictly limited to files matching the
`ipc-*.jsonl` pattern — nothing else in the directory is ever touched. (A
single run's `NNN` sequence plus prior runs' files all share the pattern, so
the cap bounds the directory across restarts too.)

### Entry shape

```jsonc
// request (renderer -> main)
{"t":"2026-06-20T14:30:01.123Z","dir":"req","channel":"core.session.create","wcId":1,"payload":{...},"response":{...},"durationMs":4}

// request that threw
{"t":"2026-06-20T14:30:01.140Z","dir":"req","channel":"core.session.write","wcId":1,"payload":{...},"durationMs":2,"error":"<message>"}

// event (main -> renderer)
{"t":"2026-06-20T14:30:01.130Z","dir":"event","channel":"event.session.data","wcId":2,"payload":{"sessionId":"…","data":"<base64>"}}
```

- `t` — ISO-8601 timestamp.
- `dir` — `"req"` or `"event"`.
- `channel` — the IPC channel string.
- `wcId` — `WebContents.id` of the sender/target when available.
- `payload` / `response` / `durationMs` / `error` — as applicable.

Serialization uses `JSON.stringify` with a safe replacer that tolerates
circular references and `BigInt`. If a payload still cannot be serialized, the
line is written as `{"t":…,"dir":…,"channel":…,"serializeError":true}` so the
record is never silently dropped.

## Module Layout

New file `apps/desktop/src/main/ipc-logger.ts` (co-located with
`fs-handlers.ts`), exporting:

- `resolveLogConfig(argv, env): IpcLogConfig | null` — pure; no I/O, no Electron.
- `class IpcLogger` — the rotating sink: constructor opens the first file;
  `log(entry: IpcLogEntry): void`; `close(): void`. No Electron import, so it
  is unit-testable in isolation.
- `installIpcInterceptors(ipcMain, app, logger): void` — patches `ipcMain` and
  subscribes to `app`'s `web-contents-created` to wrap each WebContents' `send`.
  Targets are injected (not imported) so the function can be exercised against
  fakes in tests.

Wiring in `main/index.ts`:

```ts
const logConfig = resolveLogConfig(process.argv, process.env);
let ipcLogger: IpcLogger | null = null;
if (logConfig) {
  try {
    ipcLogger = new IpcLogger(logConfig);
    installIpcInterceptors(ipcMain, app, ipcLogger);
  } catch (err) {
    console.warn('[ipc-log] disabled:', err instanceof Error ? err.message : err);
    ipcLogger = null;
  }
}
// ... must run BEFORE: const ipcRouter = new IpcRouter(ipcMain, sessionManager);
```

(`app` is imported from `electron`; the interceptor subscribes to its
`web-contents-created` event.) On `app` quit, `ipcLogger?.close()` flushes the
stream.

## Data Flow

```
renderer  --invoke(channel,payload)-->  [patched ipcMain.handle]
                                              |  time + capture
                                              v
                                         original listener --> response
                                              |
                                              v
                                         IpcLogger.log({dir:"req", ...})

main  --webContents.send(channel,payload)--> [wrapped per-instance wc.send]
                                              |  capture (core./event. only)
                                              v
                                         IpcLogger.log({dir:"event", ...})
                                              |
                                              v
                                    rotating ipc-*.jsonl in <dir>
```

## Error Handling

| Failure | Behavior |
|---|---|
| Target dir uncreatable/unwritable | `console.warn` once; logging disabled; app runs normally. |
| Serialize failure for one entry | Write `{…,"serializeError":true}` line; continue. |
| Write-stream error mid-run | `console.warn` once; subsequent `log()` calls are no-ops; IPC unaffected. |
| Original IPC handler throws | Logged with `error`, then re-thrown unchanged. |

## Testing

Vitest, matching existing `apps/desktop/src/main/*.test.ts` and
`packages/core/tests/*` style.

- `resolveLogConfig`: `--log-ipc <dir>`, `--log-ipc=<dir>`, env-var form,
  flag-over-env precedence, max-files/max-bytes overrides, absent → `null`.
- `IpcLogger`: writing entries past `maxBytes` produces multiple files, each
  line valid JSON; exceeding `maxFiles` deletes the oldest `ipc-*.jsonl` and
  leaves non-matching files untouched; circular payload yields a
  `serializeError` line, not a throw.
- `installIpcInterceptors`: with a fake `ipcMain`, register a handler, invoke
  it, and assert one captured `req` entry (payload, response, `durationMs`);
  assert the error path captures `error` and re-throws; with a fake `send`
  target, assert a `core.`/`event.` channel is logged and a non-app channel is
  ignored.

## Security Note

Full payloads include terminal output (`event.session.data`) and keystrokes
(`core.session.write`), so the log can contain anything typed or displayed,
including secrets. This is an explicit, opt-in developer/troubleshooting
capability — disabled by default, written only to the operator-chosen
directory, never uploaded. Operators should treat the log directory as
sensitive and clear it when finished.
