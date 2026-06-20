# Awakon

**Run many terminal sessions in parallel — and never miss the moment one of them needs you.**

Awakon is a cross-platform desktop terminal built for working with several AI coding
agents (Claude Code, Codex CLI, and friends) at once. Every project gets its own tab,
every tab runs a real shell, and the app watches all of them for you: when a background
session prints a prompt, hits a rate limit, or rings the bell, Awakon badges the tab and
fires a native OS notification — so you can keep your eyes on one session while the
others quietly wait their turn. It can even resume a rate-limited agent on its own.

> ### ⚠️ Important — build it yourself, for now
> Awakon is **not yet code-signed or notarised**, so there is no public, ready-to-run
> download. **Anyone who wants to use Awakon must build it on their own machine** from
> this repository, following the instructions below. Signed installers for Windows,
> macOS, and Linux will come once app signing is in place.

---

## Features

- 🗂️ **Tabbed sessions** — run many shells side by side; create, close, switch, and reorder tabs entirely from the keyboard.
- 🐚 **Pick your shell per tab** — PowerShell, `cmd`, `bash`, `zsh`, `wsl`, or any custom command, each with its own working directory.
- 🔔 **Attention awareness** — when a *background* session needs input, its tab badges with a yellow dot and the sidebar highlights it.
- 🖥️ **Native OS notifications** — get a desktop notification when a session needs you and the window is unfocused or you're on a different tab; click it to jump straight there.
- ⏳ **Rate-limit auto-resume** — detects when an AI agent says it's hit its usage limit, reads the reset time, and automatically resumes the session when the limit clears.
- ◧ **Split panes** — split any tab horizontally or vertically (VS Code-style) to watch two sessions in one view.
- 📋 **Live sidebar** — a collapsible rail listing every session with its shell, status (running / awaiting input / exited), and time-in-state.
- 💾 **Session persistence** — open tabs, shells, working directories, and layout are restored on the next launch.
- ⚙️ **Settings panel** — configure auto-resume detection and response text from an in-app dialog.
- ⌨️ **Keyboard-first** — every common action has a shortcut; see [Keyboard shortcuts](#keyboard-shortcuts).
- 🖧 **Cross-platform** — Windows, macOS, and Linux from a single codebase.
- 🛡️ **Crash isolation** — each session runs in its own process, so one misbehaving tab can't take the others down.

---

## Screenshots

**Single session — full sidebar with live session status.**

![Awakon main window with sidebar and a PowerShell session](docs/images/main.png)

**Pick your shell per tab — choose the shell and working directory for each new session.**

![The New Session dialog showing a working directory and pwsh / cmd / git-bash shell choices](docs/images/new-session.png)

**Multiple tabs — background tabs badge yellow when they need you; the sidebar counters update instantly.**

![Three tabs with two awaiting-input badges and the sidebar showing 2 AWAIT](docs/images/multi-tab.png)

**Attention awareness at a glance — the live sidebar tracks every session's status and time-in-state.**

![Sidebar close-up with one session each awaiting, rate-limited, running, and idle](docs/images/sidebar.png)

**Rate-limit auto-resume — a limited tab shows its reset time and a pending auto-resume you can cancel.**

![A rate-limited session with a 9:30 PM resume badge on the tab and a rate-limited pill in the sidebar](docs/images/auto-resume.png)

**Split panes — watch two sessions side by side…**

![A tab split into two side-by-side panes](docs/images/splits.png)

**…or stacked, one above the other.**

![A tab split into two stacked panes](docs/images/splits-vertical.png)

**Settings — configure auto-resume detection phrase, response text, and a default working directory.**

![The Auto-resume settings panel](docs/images/settings.png)

---

## Prerequisites

Install these before building, on every platform:

| Tool | Version | Notes |
|---|---|---|
| [Node.js](https://nodejs.org/) | 20 or newer | LTS recommended |
| [pnpm](https://pnpm.io/) | 9.x | Easiest via Corepack: `corepack enable` |
| [Git](https://git-scm.com/) | any recent | to clone the repository |

Awakon uses a native module (`node-pty`), so each OS also needs a working C/C++
build toolchain:

### Windows

- **PowerShell 7+** (`pwsh.exe`) on your `PATH` — this is Awakon's default shell.
- A **C++ build toolchain** for compiling the native PTY module. Either:
  - tick **"Tools for Native Modules"** when running the official Node.js installer, **or**
  - install **Visual Studio Build Tools** with the *Desktop development with C++* workload plus **Python 3** from the [Visual Studio Installer](https://visualstudio.microsoft.com/downloads/).

### macOS

- **Xcode Command Line Tools:**
  ```bash
  xcode-select --install
  ```

### Linux

- A C/C++ toolchain and Python 3. On Debian/Ubuntu:
  ```bash
  sudo apt-get install -y build-essential python3
  ```
  AppImage runtime libraries (`libfuse2`) may also be needed to *run* the packaged build:
  ```bash
  sudo apt-get install -y libfuse2
  ```

---

## Build & run

### Quick start — build an installer (one command)

Clone the repo, then run the script for your OS from the repo root. The script
checks prerequisites, installs dependencies (or skips them if already present),
compiles the app, and produces a platform installer in
`apps/desktop/release/<version>/`.

**Windows (PowerShell):**
```powershell
git clone https://github.com/ecogs-sys/Awakon.git
cd Awakon
.\scripts\build.ps1
```

**macOS / Linux:**
```bash
git clone https://github.com/ecogs-sys/Awakon.git
cd Awakon
bash scripts/build.sh
```

> **Prerequisites:** Node.js ≥ 20 and pnpm must be installed first — run
> `corepack enable` once to activate pnpm. See [Prerequisites](#prerequisites)
> for platform-specific build-toolchain requirements.

> **A note on signing.** The macOS build config sets `mac.identity: null` so
> packaging works locally without an Apple Developer certificate. The resulting
> build is **unsigned** — macOS Gatekeeper and Windows SmartScreen will warn when
> you launch it, and you may need to allow it explicitly. This is expected until
> signed releases ship.

### Run in development mode

To open Awakon without building an installer (fastest way to try it):

```bash
git clone https://github.com/ecogs-sys/Awakon.git
cd Awakon
corepack enable
pnpm install
pnpm dev
```

A native window opens immediately with hot-reload enabled.

### Manual step-by-step (troubleshooting)

Use these steps when you need to run stages individually — for example to debug a
failed build or to package for a specific platform after a `pnpm install` that's
already been done.

**1. Install dependencies**
```bash
corepack enable
pnpm install
```

**2. Compile all packages and the Electron app**
```bash
pnpm build
```

**3. Package an installer for your platform**

*Windows* — produces `Awakon Setup x.y.z.exe`:
```powershell
pnpm --filter @awakon/desktop dist:win
```

*macOS* — produces `Awakon-x.y.z.dmg`:
```bash
pnpm --filter @awakon/desktop dist:mac
```

*Linux* — produces `Awakon-x.y.z.AppImage`:
```bash
pnpm --filter @awakon/desktop dist:linux
```

The packaged output lands in `apps/desktop/release/<version>/`.

> `electron-builder` can only target the OS it is running on without additional
> cross-compilation setup, so run each `dist:*` command on the matching platform.

### IPC logging (troubleshooting)

Awakon can record **all** of its internal IPC traffic — every request between the
renderer and main process and every event sent back — to disk. This is useful for
diagnosing issues that only surface during long-running sessions. It is **off by
default**; enable it at startup by pointing the app at a directory.

**Enable it:**

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

**Configuration:**

| Variable | Default | Meaning |
|---|---|---|
| `AWAKON_LOG_IPC` | _(off)_ | Directory to write logs to. Also settable via `--log-ipc <dir>`. |
| `AWAKON_LOG_IPC_MAX_FILES` | `20` | Number of rotated files to keep; the oldest are deleted. |
| `AWAKON_LOG_IPC_MAX_BYTES` | `52428800` | Size threshold (bytes, ~50 MB) before rolling to a new file. |

**Output format:** rotating JSON-lines files named `ipc-<timestamp>-NNNNNN.jsonl`,
one JSON object per line. Each line records a request (`"dir":"req"`) or an event
(`"dir":"event"`):

```json
{"t":"2026-06-20T14:30:01.123Z","dir":"req","channel":"core.session.create","wcId":1,"payload":{"shell":"bash"},"response":{"id":"s1"},"durationMs":4}
{"t":"2026-06-20T14:30:01.130Z","dir":"event","channel":"event.session.data","wcId":2,"payload":{"sessionId":"s1","data":"<base64>"}}
```

Fields: `t` timestamp · `channel` IPC channel · `wcId` source/target WebContents id ·
`payload`/`response` the message bodies · `durationMs` handler time · `error` if a
request threw. Inspect with any JSONL tool, e.g. `jq -c 'select(.dir=="req")' ipc-*.jsonl`.

> The log captures full payloads, including terminal output and keystrokes. Treat
> the log directory as sensitive and clear it when you are done.

> Logging writes to disk synchronously on every IPC message, so enabling it can
> reduce terminal throughput under heavy output. Turn it off when you are not
> actively collecting a trace.

### Project scripts

| Command | Effect |
|---|---|
| `pnpm dev` | Run the app in development mode with hot-reload |
| `pnpm build` | Compile all packages and the Electron app |
| `pnpm test` | Unit + integration tests (Vitest) |
| `pnpm test:e2e` | End-to-end tests against the packaged app (Playwright) |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm lint` | ESLint |
| `pnpm --filter @awakon/desktop dist:win\|dist:mac\|dist:linux` | Package an installer for that OS |

---

## Feature details

This section expands on the features listed above.

### Tabbed sessions

Each tab is an independent shell session backed by its own PTY. Open a new tab with
`Ctrl+T`, close the focused one with `Ctrl+W`, and move between them with
`Ctrl+Tab` / `Ctrl+Shift+Tab` or jump directly with `Ctrl+1`…`Ctrl+9`. Tabs can be
reordered by dragging. Because every session runs in its own process, a crash or hang
in one tab never affects the others.

### Pick your shell per tab

When you create a tab, the New Session dialog lets you choose the shell and the working
directory. On Windows the default is PowerShell 7 (`pwsh`), falling back to
`powershell.exe`; on macOS and Linux it's your login shell. You can also point a tab at
`cmd`, `wsl`, or any custom command — handy for launching a specific agent CLI directly.

### Attention awareness

Awakon watches each session's output for signs that it needs you — a terminal bell
(`BEL`), or going idle shortly after printing a recognised prompt. When a **background**
tab (one you're not currently looking at) raises a signal, its tab badges with a yellow
dot and its entry in the sidebar is highlighted and switches to an `awaiting-input`
status. The badge clears automatically as soon as you type into that session.

### Native OS notifications

When a session needs attention *and* the window is unfocused — or focused but on a
different tab — Awakon fires a native desktop notification naming the session. Clicking
the notification focuses the Awakon window and switches straight to that tab.
Notifications are coalesced (at most one per session in a short window) so a chatty
agent can't spam you.

### Rate-limit auto-resume

AI coding agents often pause with a message like *"You've hit your limit — resets at
9:30pm"*. Awakon scans session output for a configurable phrase, parses the reset time
(including an optional timezone), and — when that time arrives — automatically types a
response (by default, `continue`) into the tab to pick the work back up. The check is
done with a periodic sweep rather than a single long timer, so it stays reliable across
OS sleep and clock changes. Pending resumes are shown on a sidebar badge and can be
cancelled there. Configure the detection phrase and the response text in **Settings**.

### Split panes

Any tab can be split so two sessions share one view. `Ctrl+\` splits the focused pane
horizontally, `Ctrl+Shift+\` splits it vertically, and `Ctrl+Shift+W` closes the focused
pane. Each pane is a full, independent session — splitting is purely a layout choice.

### Live sidebar

The collapsible left rail (toggle with `Ctrl+B`) shows a real-time summary row of
counts across all sessions — **AWAIT**, **LIMITED**, **RUNNING**, and **IDLE** — so
you can see at a glance how many agents need attention without reading every card.
Below the summary, each session is listed with its shell icon, title, current status
(`running`, `awaiting-input`, `rate-limited`, or `exited`), and how long it has been
in that state. Click an entry to focus its tab.

### Session persistence

Your open tabs, their shells, working directories, titles, and split layout are saved
and restored across restarts. PTYs respawn fresh on relaunch — the *layout* comes back,
but in-progress conversation state inside an agent is not preserved. The persisted state
lives in your platform's userData directory:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Awakon\sessions.json` |
| macOS | `~/Library/Application Support/Awakon/sessions.json` |
| Linux | `~/.config/Awakon/sessions.json` |

If that file is ever corrupted, Awakon backs it up and starts fresh — the app always
launches.

### Settings panel

Open **View → Settings…** (or `Ctrl+,`) to configure rate-limit auto-resume. The
**Auto-resume** panel lets you toggle the feature on or off, set the **text to detect**
that marks a rate-limit message (preset chips for common phrases are provided), and set
the **response to send** when the limit resets. Settings persist across restarts.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close focused tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+1` … `Ctrl+9` | Jump to tab 1–9 |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+\` | Split focused pane horizontally |
| `Ctrl+Shift+\` | Split focused pane vertically |
| `Ctrl+Shift+W` | Close focused pane |
| `Ctrl+,` | Open Settings |

On macOS, use `Cmd` in place of `Ctrl`.

### Cross-platform & crash isolation

Awakon is built on Electron with one chrome renderer plus one isolated view per session.
The same codebase runs on Windows, macOS, and Linux, and the per-session process model
means a renderer crash in one tab is contained — the others (and their underlying
shells) keep running.
