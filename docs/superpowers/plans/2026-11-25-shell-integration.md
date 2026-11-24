# Shell Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Know which command is running in each session, and the session's live cwd, by having the shell announce both — cheaply, on every platform, and in a way that works for *any* CLI rather than only ones we can fingerprint from escape sequences.

**Why:** The right-click policy shipped in PR #26 identifies an app from terminal mode state (alternate screen / mouse tracking) plus the OSC window title. That works for Claude Code but **cannot** work for Codex or Gemini: both render their UI inline in the normal buffer without taking the alternate screen or grabbing the mouse, and Codex sets no OSC title at all. Nothing in the byte stream distinguishes them from a bare shell prompt. Process-tree inspection was measured at **~500ms per query** (dominated by PowerShell startup, not the query) — too slow to run on a click and too expensive to poll every session continuously, so it is not the primary mechanism. It survives as **Task 5**, a later-phase fallback scoped to the sessions shell integration structurally cannot reach (`cmd.exe`); see Appendix A for the full measurements.

**Architecture:** Awakon injects a small shell-integration script at session spawn. The script wraps the existing prompt and the PSReadLine input hook to emit OSC markers: `133;A/B/C/D` (prompt/input/command-start/command-end+exit), `OSC 7` (cwd), and `OSC 1337;awakonCommand=<line>` (the command text). `Session` feeds its existing `pty.onData` stream to a new `ShellIntegrationDetector` alongside `AttentionDetector` and `RateLimitDetector`; the parsed command and cwd land on `SessionInfo` and are broadcast like `SessionTitleChanged` already is. The right-click profile match then keys on **command name** instead of window title.

**Tech Stack:** TypeScript, Node.js, Vitest, node-pty, PowerShell, pnpm monorepo.

---

## Phase 1 spike — COMPLETE, viable

The one result that could have killed this: ConPTY re-renders output rather than passing bytes through, and is known to filter some sequences (synthesized `DECSET 1003h/1006h` never reached xterm during the PR #26 investigation). If it swallowed OSC 133, the approach was dead on the only platform that needs it.

Measured against a real pty running `pwsh.exe`, with the integration dot-sourced exactly as the real injection would do it:

| Marker | Survived ConPTY |
|---|---|
| `OSC 133;A` prompt start | YES |
| `OSC 133;B` input start | YES |
| `OSC 133;C` command began | YES |
| `OSC 133;D;<exit>` command finished | YES |
| `OSC 7` cwd | YES |
| `OSC 1337;awakonCommand=` | YES |

Captured end-to-end, not merely detected:

```
command lines : ["echo hello-from-awakon", "cd packages"]
exit codes    : ["0", "0", "0"]
cwd reports   : [".../Awakon", ".../Awakon", ".../Awakon", ".../Awakon/packages"]
readline hook : ["readline-hooked"]
```

The cwd report tracking `cd packages` confirms live cwd works, which closes the "tab labels show the launch folder forever" limitation from PR #26.

---

## File Structure

**Created:**
- `packages/core/src/shell-integration/pwsh.ps1` — the injected script (Phase 2)
- `packages/core/src/shell-integration/bash.sh`, `zsh.zsh` — (Phase 3)
- `packages/core/src/shell-integration-detector.ts` — OSC 133 / 7 / 1337 stream parser
- `packages/core/tests/shell-integration-detector.test.ts` — parser unit tests
- `packages/core/src/shell-integration-spawn.ts` — per-shell spawn args/env computation
- `packages/core/tests/shell-integration-spawn.test.ts`

**Modified:**
- `packages/core/src/session.ts` — wire the detector; hold `foregroundCommand` + live `cwd`; emit change events
- `packages/core/src/session-manager.ts` — re-emit as manager events (mirror `sessionTitleChanged`)
- `packages/core/src/ipc-router.ts` — broadcast a new `SessionCommandChanged`
- `packages/contracts/src/session.ts` — add `foregroundCommand` to `SessionInfoSchema`
- `packages/contracts/src/ipc.ts` — new channel + payload schema
- `packages/terminal-host/src/app-profiles.ts` — match profiles on command name
- `apps/desktop/src/renderer/terminal/split-container.ts` — pass command through to the policy

**Unchanged (do not edit):**
- `packages/core/src/attention-detector.ts` — separate concern, already stable
- `packages/core/src/rate-limit-detector.ts`

---

## Task 1: Stream parser

- [ ] **Step 1.1: Failing tests for `ShellIntegrationDetector`**

Cover: `133;A/B/C`, `133;D;<exit>` (including non-zero and missing exit), `OSC 7` cwd (file:// URL → native path, with URL-decoding for spaces), `1337;awakonCommand=`, payloads split across chunk boundaries (the existing `AttentionDetector` has the same hazard — see its `prefixMatchPos` handling), and that unrelated OSC sequences (`ESC]0;title BEL`) are ignored without corrupting state.

- [ ] **Step 1.2: Implement the parser**

Byte-stream scanner in the same shape as `AttentionDetector`. Emits `commandStart(cmd)`, `commandEnd(exitCode)`, `cwdChanged(path)`. Must be allocation-light: it sees every byte of every session.

## Task 2: Spawn-time injection

- [ ] **Step 2.1: Write `pwsh.ps1`**

Wrap — never replace — the existing `prompt` and `PSConsoleHostReadLine`, so prompt frameworks (oh-my-posh, starship) keep working. Guard every hook with existence checks and leave the shell fully functional if anything throws. Validated shape from the spike:

```powershell
$global:__awakonOrigPrompt = $function:prompt
function global:prompt {
  $exitCode = if ($global:LASTEXITCODE -ne $null) { $global:LASTEXITCODE } else { 0 }
  $out  = "$ESC]133;D;$exitCode$BEL" + "$ESC]133;A$BEL"
  $out += "$ESC]7;file:///$($PWD.Path -replace '\\','/')$BEL"
  $out += & $global:__awakonOrigPrompt
  $out += "$ESC]133;B$BEL"
  return $out
}
```

- [ ] **Step 2.2: Per-shell spawn computation + tests**

Pure function: shell → `{ args, env }`.
- **pwsh/powershell** — dot-source the script via `-NoExit -Command`
- **bash/git-bash** — `--init-file` wrapper that sources the user's `~/.bashrc` **first**
- **zsh** — temp `ZDOTDIR` whose `.zshrc` sources the user's
- **cmd** — unsupported, return unchanged args (cmd has no hook; VS Code doesn't support it either)
- **wsl** — unchanged for now; depends on the inner shell

- [ ] **Step 2.3: Wire into `Session`**

Script path must resolve correctly **inside the packaged asar** — `extraResources` or `asarUnpack`, since PowerShell cannot dot-source a file inside an asar. This is the most likely packaging failure; verify with a `--dir` build, not just `pnpm dev`.

## Task 3: Surface the state

- [ ] **Step 3.1: `SessionInfo.foregroundCommand` + IPC broadcast**
- [ ] **Step 3.2: Renderer consumes it; profiles match command name**

Replace the title-based match with command-based, keeping the mode-state gate as a fallback for sessions where integration is unavailable (cmd, or a shell that failed to inject). Add `codex` and `gemini` profiles — the actual point of the exercise.

## Task 4: Settings + escape hatch

- [ ] **Step 4.1: `shellIntegration` setting (default on), with a visible off switch**

Injecting into someone's shell must be refusable without uninstalling.

---

## Task 5 (later phase): process-tree fallback where integration can't reach

Do **not** start this until Tasks 1–4 have shipped and been lived with. It exists to
cover the sessions shell integration structurally cannot serve — primarily `cmd.exe`,
which has no prompt hook or init-file mechanism (VS Code doesn't support it either) —
plus any session where injection was declined or failed.

Scoping it this way is what makes the cost acceptable: the measurements in Appendix A
rule out polling *every* session continuously, but a fallback that runs only for
sessions with no integration, and only while one is focused, is a much smaller bill.

- [ ] **Step 5.1: Decide the cheap query mechanism first — this gates the rest**

~500ms per PowerShell spawn (Appendix A) is the blocker, and it is startup cost, not
query cost. Pick one and prototype it before building anything on top:
- **Native module** (`CreateToolhelp32Snapshot`, ~1–5ms) — fastest, but adds a
  compiled dependency to every platform build and to the signing/packaging pipeline.
- **Long-lived helper process** fed queries over a pipe — no new build dependency,
  pays startup once, but Awakon then owns a background process and its lifecycle
  (crash recovery, shutdown, orphan cleanup).

If neither prototypes acceptably, stop — the fallback is not worth a worse cost than
the problem.

- [ ] **Step 5.2: `ProcessTreeDetector` in `packages/core`**

Resolve the shallowest descendant of the session's shell PID (agent CLIs spawn their
own children, so depth > 1 is normal and the deepest is the wrong answer). Poll only
sessions lacking shell integration, only while focused, with a cached last-known value.

- [ ] **Step 5.3: Feed it into the same `foregroundCommand` field**

Task 3 already defines the field, the IPC broadcast and the profile matching. This
step only adds a second *source* for it, so no consumer changes — and shell
integration must always win when both are available, since it reports the real
command line rather than an inferred one.

- [ ] **Step 5.4: Mark the inference as lower-confidence**

A descendant is not provably the foreground process (Appendix A). Anything that acts
destructively or irreversibly on `foregroundCommand` must be able to tell the two
sources apart; right-click paste is safe either way.

---

## Risks

- **Prompt frameworks.** oh-my-posh/starship also override `prompt`. Wrapping (not replacing) plus installing last is the mitigation, but this is the most likely source of "Awakon broke my terminal". Test explicitly against oh-my-posh.
- **Packaging.** The script must be dot-sourceable from outside the asar. Verify in a real packaged build.
- **Trust.** The script is injected into the user's shell: ship it readable, in-repo, executing nothing dynamic, and make it opt-out.
- **SSH / WSL / containers.** Only works if integration exists on the far side. Explicitly out of scope — but note process inspection cannot reach there *at all*, so this is still strictly better.
- **Scope discipline.** Live cwd (Task 1 gives it for free) is tempting to wire straight into tab labels. That is a separate change with its own UX question (does a tab rename itself as you `cd`?) and should not ride along here.

---

## Open decisions

1. **Default on or opt-in?** Recommend on, with a settings toggle — invisible when it works.
2. **Own OSC namespace or VS Code's `633`?** Recommend our own `1337;awakon*` (matches the existing `awakonAttention` precedent) to avoid implying compatibility with VS Code's full protocol.
3. **Does live cwd change tab labels?** Recommend deferring — land the plumbing, decide the UX separately.

---

## Appendix A: Process-tree polling — evidence behind Task 5

Recorded so the investigation isn't repeated. This was the alternative to shell
integration for answering "what is running in this terminal" on Windows. It is not
the primary mechanism — the cost below rules that out — but it survives as the
**Task 5 fallback** for sessions shell integration cannot reach (`cmd.exe` above all).

### What it is

Every Windows process records its parent's PID, so the system forms a tree. Awakon
already knows each session's shell PID (it spawned it — `SessionInfo.pid`), so the
question becomes "walk the tree downward from that PID". Verified behaving exactly
as expected against a real pty:

```
A. Idle shell prompt        [0] pid 30964  pwsh.exe
                                (no children — shell sitting at its prompt)
B. While `node` is running  [0] pid 30964  pwsh.exe
                                    [1] pid 34968  node.exe
C. After the child exits    [0] pid 30964  pwsh.exe
                                (no children)
```

An earlier probe confirmed the same for the real thing: `claude.exe` appears as a
child of the shell while running and disappears on exit.

### Why it is not the primary mechanism

**Measured cost, three runs each:**

```
full snapshot          592ms  565ms  548ms
single-parent query    531ms  465ms  473ms
```

Narrowing the query to one parent barely helps, which shows the cost is **spawning
PowerShell**, not the WMI query. Consequences:

1. **Cannot run on the click.** A right-click must feel instant; ~500ms of lag would
   be worse than the bug it fixes.
2. **So it must be polled and cached** — but at ~500ms CPU per poll, a 1–2s interval
   burns roughly a quarter to a half of a core continuously, forever, in an app
   designed to sit in the background all day.

**Making it cheap requires one of:**
- A **native module** calling `CreateToolhelp32Snapshot` (~1–5ms) — but that adds a
  compiled dependency to every platform build.
- A **long-lived helper PowerShell process** fed queries over a pipe — pays startup
  once, but Awakon then owns a background process and its lifecycle.

### Fundamental limits (independent of cost)

- **Descendants ≠ foreground.** The tree says what exists *under* the shell, not
  which process owns the terminal. Backgrounded jobs and agent-spawned helpers all
  appear with no way to rank them. In practice there is usually one interactive
  child, so it is a good proxy — but it is an inference, not a fact.
- **Windows has no foreground process group.** There is no job control and no
  `tcsetpgrp` equivalent. ConPTY tracks *attached* processes
  (`GetConsoleProcessList`), but has no notion of which owns input, and the caller
  must be attached to that console — a GUI app on the master side is not. This is
  why `node-pty`'s `process` getter is a stub on Windows
  (`src/windowsTerminal.ts:200` returns `this._name`, which is why it reports
  `"xterm-256color"`).
- **Breaks over SSH / WSL / containers.** The tree only covers local processes;
  shell integration installed on the far side still works.

### Where it earns its place — Task 5

**`cmd.exe` is the gap shell integration cannot cover**: no prompt hook, no init-file
mechanism (VS Code doesn't support it either). For those sessions, process-tree
polling is the *only* available signal. Scoped to sessions without integration, and
only while focused, the cost becomes defensible — which is precisely how Task 5
frames it. Step 5.1 still has to find a query mechanism cheaper than a PowerShell
spawn before any of it is worth building.

### Note for macOS/Linux

None of this is needed off Windows. Unix kernels track the terminal's **foreground
process group**, and `node-pty` already implements the lookup:

- Linux — `tcgetpgrp(fd)` → `/proc/<pgrp>/cmdline` (`src/unix/pty.cc:622-626`)
- macOS — `tcgetpgrp(fd)` → `sysctl(KERN_PROC_PID)` → `kp_proc.p_comm` (`:661-671`)

So `pty.process` is accurate and effectively free there. The irony worth recording:
the one platform where we want this is the one platform without the clean API — and
the platforms that have it are the ones where right-click shows a menu anyway, so we
don't need it.
