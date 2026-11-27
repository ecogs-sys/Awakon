# Shell Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Know which command is running in each session, and the session's live cwd, by having the shell announce both — cheaply, on every platform, and in a way that works for *any* CLI rather than only ones we can fingerprint from escape sequences.

**Why:** The right-click policy shipped in PR #26 identifies an app from terminal mode state (alternate screen / mouse tracking) plus the OSC window title. That works for Claude Code but **cannot** work for Codex or Gemini: both render their UI inline in the normal buffer without taking the alternate screen or grabbing the mouse, and Codex sets no OSC title at all. Nothing in the byte stream distinguishes them from a bare shell prompt. Process-tree inspection was measured at **~500ms per query** (dominated by PowerShell startup, not the query) — too slow to run on a click and too expensive to poll every session continuously, so it is not the primary mechanism. It survives as **Task 5**, a later-phase fallback scoped to the sessions shell integration structurally cannot reach (`cmd.exe`); see Appendix A for the full measurements.

**Architecture:** Awakon injects a small shell-integration script at session spawn. The script wraps the existing prompt and the PSReadLine input hook to emit OSC markers: `133;A/B/C/D` (prompt/input/command-start/command-end+exit), `OSC 7` (cwd), and `OSC 1337;awakonCommand=<line>` (the command text). `Session` feeds its existing `pty.onData` stream to a new `ShellIntegrationDetector` alongside `AttentionDetector` and `RateLimitDetector`; the parsed command and cwd land on `SessionInfo` and are broadcast like `SessionTitleChanged` already is. The right-click profile match then keys on **command name** instead of window title.

**Tech Stack:** TypeScript, Node.js, Vitest, node-pty, PowerShell, pnpm monorepo.

**Phases:**

| Phase | Scope | Tasks |
|---|---|---|
| 1 | Spike: does OSC 133 survive ConPTY? | **COMPLETE — passed** |
| 2 | pwsh/powershell integration, end to end | Tasks 1–4 |
| 3 | bash / zsh / git-bash | Task 2.2 extensions |
| 4 | Consumers: auto-resume for other CLIs, live cwd | separate plans |
| 5 | Process-tree fallback for `cmd.exe` | Task 5 — **may be dropped entirely** |

Phase 2 is the whole payoff: it is what makes `codex` and `gemini` work. Phases 3–5 are
each independently droppable.

---

## Phase 1 spike — COMPLETE, viable

The one result that could have killed this: ConPTY re-renders output rather than passing bytes through, and is known to filter some sequences (synthesized `DECSET 1003h/1006h` never reached xterm during the PR #26 investigation). If it swallowed OSC 133, the approach was dead on the only platform that needs it.

Measured against a real pty running `pwsh.exe`:

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

**Re-verified after the injection mechanism changed.** The original spike dot-sourced a
`.ps1`; Step 2.3 rejects that (ExecutionPolicy), so the mechanism was re-tested as
`powershell -NoExit -EncodedCommand <base64>` — the exact spawn `Session` will use:

```
probe (integration installed): YES    OSC 133;A/B/C/D: YES    OSC 7: YES
captured commands: ["echo still-interactive", "cd packages"]
cwd reports      : [".../Awakon", ".../Awakon/packages"]
shell stayed interactive: YES
```

Still unverified, and called out at Step 2.4: whether our hooks install *after* the
user's profile. If they install first, a prompt framework defined in the profile
overwrites the wrapper and every marker disappears silently.

---

## File Structure

**Created:**
- `packages/core/src/shell-integration/pwsh.ts` — the pwsh integration **as an exported
  string constant**, not a `.ps1` on disk. See Step 2.3: ExecutionPolicy blocks loading
  script files on a default Windows install, so the script is injected via
  `-EncodedCommand` and never touches the filesystem (Phase 2)
- `packages/core/src/shell-integration/bash.ts`, `zsh.ts` — same pattern (Phase 3).
  POSIX shells have no ExecutionPolicy equivalent, but keeping one shape avoids two
  packaging stories
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

- [ ] **Step 2.1: Author the pwsh integration string**

Wrap — never replace — the existing `prompt` and `PSConsoleHostReadLine`, so prompt frameworks (oh-my-posh, starship) keep working. Guard every hook with existence checks and leave the shell fully functional if anything throws. Shape verified end-to-end through `-EncodedCommand` (note `$ESC`/`$BEL` must be defined — without them the markers silently emit as empty strings):

```powershell
$ESC = [char]27
$BEL = [char]7
if (-not (Test-Path variable:global:__awakonOrigPrompt)) {
  $global:__awakonOrigPrompt = $function:prompt
}
function global:prompt {
  $exitCode = if ($global:LASTEXITCODE -ne $null) { $global:LASTEXITCODE } else { 0 }
  $out  = "$ESC]133;D;$exitCode$BEL" + "$ESC]133;A$BEL"
  $out += "$ESC]7;file:///$($PWD.Path -replace '\\','/')$BEL"
  $out += & $global:__awakonOrigPrompt
  $out += "$ESC]133;B$BEL"
  return $out
}
```

Two accuracy caveats to handle while writing it:
- **`$LASTEXITCODE` only reflects native executables.** A failing *cmdlet* leaves it
  stale, so `133;D` would report a wrong exit code. Combine with `$?` the way VS Code's
  integration does.
- **`OSC 7` must URL-encode the path.** The snippet above only swaps separators; a cwd
  containing spaces or `#` produces a malformed file:// URL. Encode here, and have the
  Task 1 parser decode — pick one convention and test a path with spaces both ways.

- [ ] **Step 2.2: Per-shell spawn computation + tests**

Pure function: shell → `{ args, env }`.
- **pwsh/powershell** — `-NoExit -EncodedCommand <base64 utf16le>` (see Step 2.3 for why
  not a dot-sourced file). Verified: integration installs, all markers emit, and the
  shell stays interactive afterwards.
- **bash/git-bash** — `--init-file` wrapper that sources the user's `~/.bashrc` **first**
- **zsh** — temp `ZDOTDIR` whose `.zshrc` sources the user's
- **cmd** — unsupported, return unchanged args (cmd has no hook; VS Code doesn't support it either)
- **wsl** — unchanged for now; depends on the inner shell

- [ ] **Step 2.3: Wire into `Session` — inject via `-EncodedCommand`, NOT a .ps1 file**

**Do not ship the integration as a `.ps1` and dot-source it.** PowerShell's
ExecutionPolicy governs script *files*, and Windows clients default to `Restricted`,
where loading one fails outright:

```
--- dot-source .ps1 under Restricted ---
. : File ...\integration.ps1 cannot be loaded because running scripts is
    disabled on this system.
--- same file under Unrestricted (control) --- INTEGRATION-RAN
--- inline -Command under Restricted ---      INLINE-RAN
--- -EncodedCommand under Restricted ---      ENCODED-RAN
```

The Phase 1 spike dot-sourced a file successfully only because that machine has
`LocalMachine = Unrestricted`. On a default install it would have failed for every
user. ExecutionPolicy does **not** apply to code passed via `-Command` /
`-EncodedCommand`, so embed the integration as a string in the bundle and inject it
encoded (`-EncodedCommand` over inline `-Command`: no quoting to escape, and the
script is multi-line).

This also removes the asar problem entirely — with no file on disk there is nothing
to `extraResources` or `asarUnpack`, and nothing for PowerShell to fail to read out
of the archive. Two risks closed by one decision.

Do **not** reach for `-ExecutionPolicy Bypass` instead: it is security-sensitive,
looks like malware behaviour to endpoint tooling, and is unnecessary given the above.

- [ ] **Step 2.4: Verify our hooks install AFTER the user's profile**

**Unverified and load-bearing.** If the encoded command runs before profile load, an
oh-my-posh or starship `prompt` defined in the profile overwrites our wrapper and every
marker silently disappears. PowerShell documents `-Command` as running after profiles,
but this was not tested — and the whole feature fails quietly if it is wrong. Test with
a real profile that installs a prompt framework, asserting `133;A` still appears.

## Task 3: Surface the state

- [ ] **Step 3.1: `SessionInfo.foregroundCommand` + IPC broadcast**
- [ ] **Step 3.2: Renderer consumes it; profiles match command name**

Replace the title-based match with command-based, keeping the mode-state gate as a fallback for sessions where integration is unavailable (cmd, or a shell that failed to inject). Add `codex` and `gemini` profiles — the actual point of the exercise.

## Task 4: Settings + escape hatch

- [ ] **Step 4.1: `shellIntegration` setting (default on), with a visible off switch**

Injecting into someone's shell must be refusable without uninstalling.

---

## Task 5 (later phase, possibly never): process-tree fallback

**This task exists to serve `cmd.exe`, and nothing else it can actually reach.** Every
other Windows shell Awakon offers (pwsh, powershell, git-bash) can be instrumented
directly, so if `cmd` sessions are acceptable without app detection, **this entire task
can be dropped** — along with its native-module-or-helper-process decision, its polling
cost, and its descendants-aren't-foreground inference. That is the single largest
simplification available to this plan, and it is a product call, not a technical one.

Note `wsl` is **not** an argument for keeping it: a WSL session's processes live in a
separate Linux PID namespace, so a Windows process-tree walk sees only `wsl.exe` and
never the program inside. WSL is reachable only by installing integration in the WSL
distro itself — neither mechanism here covers it.

Graceful degradation makes dropping it cheap: a `cmd` session with no integration
simply keeps the PR #26 behaviour (mode-state detection), which still catches Claude
Code — it just won't catch Codex or Gemini there.

Do **not** start this until Tasks 1–4 have shipped and been lived with, and only if
`cmd` support is judged necessary. It covers sessions shell integration structurally
cannot serve — `cmd.exe`, which has no prompt hook or init-file mechanism (VS Code
doesn't support it either) — plus any session where injection was declined or failed.

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

- **Prompt frameworks.** oh-my-posh/starship also override `prompt`. Wrapping (not replacing) plus installing last is the mitigation, but this is the most likely source of "Awakon broke my terminal". Test explicitly against oh-my-posh — and note Step 2.4: if our hook installs *before* the profile, the framework silently wins and every marker vanishes.
- **Command lines enter the scrollback.** `OSC 1337;awakonCommand=<line>` puts the full
  command text into the session byte stream, which flows into the `RingBuffer` and is
  replayed on restore. Command lines routinely contain secrets (`$env:TOKEN='…'`,
  `curl -H "Authorization: …"`). The marker is invisible on screen but present in the
  buffer. Never write the parsed command to disk — not to `crash.log`, not through the
  IPC logger — and treat `foregroundCommand` as sensitive: match profiles on the first
  token (the program name), and do not retain the argument tail.
- **Trust.** The script is injected into the user's shell: ship it readable, in-repo, executing nothing dynamic, and make it opt-out.
- **SSH / WSL / containers.** Only works if integration exists on the far side. Explicitly out of scope — but note process inspection cannot reach there *at all*, so this is still strictly better.
- **Scope discipline.** Live cwd (Task 1 gives it for free) is tempting to wire straight into tab labels. That is a separate change with its own UX question (does a tab rename itself as you `cd`?) and should not ride along here.

---

## Open decisions

1. **Default on or opt-in?** Recommend on, with a settings toggle — invisible when it works.
2. **Own OSC namespace or VS Code's `633`?** Recommend our own `1337;awakon*` (matches the existing `awakonAttention` precedent) to avoid implying compatibility with VS Code's full protocol.
3. **Does live cwd change tab labels?** Recommend deferring — land the plumbing, decide the UX separately.
4. **PowerShell-only, or PowerShell-first?** PowerShell-only (Phase 2, stop) deletes
   Task 5 *and* Phase 3, roughly halving the remaining work, at the cost of Git Bash
   users — a real segment on Windows. Recommend **PowerShell-first**: ship Phase 2,
   add bash/git-bash in Phase 3 (cheap, well-understood), and drop Task 5 regardless,
   since `cmd` degrades gracefully to the PR #26 behaviour. Dropping Task 5 is the
   simplification worth taking; dropping Phase 3 is the one worth thinking about.

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
