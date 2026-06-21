# IPC logging

Awakon can record **all** of its internal IPC traffic — every request between the
renderer and main process and every event sent back — to disk. This is useful for
diagnosing issues that only surface during long-running sessions. It is **off by
default**; enable it at startup by pointing the app at a directory.

## Enable it

```powershell
# Windows (PowerShell) — env var is easiest for an installed app:
$env:AWAKON_LOG_IPC = 'C:\temp\ipc'; & 'C:\Program Files\Awakon\Awakon.exe'
```

```bash
# macOS / Linux — flag or env var:
Awakon --log-ipc /tmp/awakon-ipc
AWAKON_LOG_IPC=/tmp/awakon-ipc Awakon

# In development mode, pass the flag through:
pnpm dev -- --log-ipc /tmp/awakon-ipc
```

The flag (`--log-ipc <dir>`) takes precedence over the env var. On startup the app
prints `[ipc-log] enabled -> <dir>` to the console when logging is active.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `AWAKON_LOG_IPC` | _(off)_ | Directory to write logs to. Also settable via `--log-ipc <dir>`. |
| `AWAKON_LOG_IPC_MAX_FILES` | `20` | Number of rotated files to keep; the oldest are deleted. |
| `AWAKON_LOG_IPC_MAX_BYTES` | `52428800` | Size threshold (bytes, ~50 MB) before rolling to a new file. |

## Output format

Rotating JSON-lines files named `ipc-<timestamp>-NNNNNN.jsonl`, one JSON object per
line. Each line records a request (`"dir":"req"`) or an event (`"dir":"event"`):

```json
{"t":"2026-06-20T14:30:01.123Z","dir":"req","channel":"core.session.create","wcId":1,"payload":{"shell":"bash"},"response":{"id":"s1"},"durationMs":4}
{"t":"2026-06-20T14:30:01.130Z","dir":"event","channel":"event.session.data","wcId":2,"payload":{"sessionId":"s1","data":"<base64>"}}
```

Fields: `t` timestamp · `channel` IPC channel · `wcId` source/target WebContents id ·
`payload`/`response` the message bodies · `durationMs` handler time · `error` if a
request threw. Inspect with any JSONL tool, e.g. `jq -c 'select(.dir=="req")' ipc-*.jsonl`.

## Cautions

> The log captures full payloads, including terminal output and keystrokes. Treat
> the log directory as sensitive and clear it when you are done.

> Logging writes to disk synchronously on every IPC message, so enabling it can
> reduce terminal throughput under heavy output. Turn it off when you are not
> actively collecting a trace.
