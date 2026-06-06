# Awakon — Demo Video Script & Storyboard

**Format:** ~2–3 minute product demo (screen recording + voiceover)
**Audience:** Developers already running AI coding agents (Claude Code, Codex CLI, etc.)
**Narrative:** Problem-led "day in the life" — the pain comes first, and each feature is introduced as it solves a beat of that story.
**Tone:** Technical, confident, a little wry. Talk to a peer who already feels this pain.

**Assets referenced** (already in `docs/images/`):
- `main.png` — single session, full sidebar
- `multi-tab.png` — three tabs, two awaiting-input badges, sidebar showing 2 AWAIT
- `splits.png` — a tab split into two panes
- `settings.png` — the Auto-resume settings panel

> **Production notes:** Times are cumulative targets, not hard cuts. Where a beat
> calls for live action (typing, a tab badging) capture a fresh screen recording;
> the four screenshots are fallbacks / cutaways. Keep the cursor movements
> deliberate and slow — viewers need a beat to read each UI change. Suggested
> music: low, driving, minimal; duck under voiceover.

---

## Storyboard

### Scene 1 — The problem (0:00 – 0:20)

| Visual | Audio (VO) |
|---|---|
| Cold open on a messy desktop: three separate terminal windows, each running an AI agent, overlapping. Cursor tabs between them. Push in on the one in the back — it's been sitting on a `Continue? (y/n)` prompt, untouched. A subtle clock overlay ticks up "+10:42". | "You're running three coding agents at once. Two are working. This one…" *(beat)* "…has been waiting on you for ten minutes. And you had no idea." |

**Shot list:** overlapping terminal windows; slow zoom to the stalled prompt; optional timer overlay.

---

### Scene 2 — Enter Awakon (0:20 – 0:35)

| Visual | Audio (VO) |
|---|---|
| Hard cut. The clutter collapses into a single clean Awakon window (`main.png` / live app). Tab bar across the top, live sidebar on the left. Title card animates in: **Awakon**. | "Awakon is a desktop terminal built for exactly this — running many agents in parallel, and never missing the moment one of them needs you." |

**Shot list:** transition from clutter → one window; reveal tab bar + sidebar; logo/title lower-third.

---

### Scene 3 — Tabbed sessions + pick your shell (0:35 – 0:55)

| Visual | Audio (VO) |
|---|---|
| Press `Ctrl+T`. New Session dialog opens — pick a shell (PowerShell, bash, wsl, custom) and a working directory. Confirm; a new tab spins up running an agent. Quickly open one or two more with `Ctrl+1`…`Ctrl+9` to show fast switching. | "Every project gets its own tab, backed by a real shell — PowerShell, bash, zsh, wsl, or any command you want, each in its own working directory. And because every session runs in its own process, one crash never takes the others down." |

**Shot list:** `Ctrl+T` → dialog → shell dropdown → working dir → new tab; quick `Ctrl+1`/`Ctrl+2` jumps.

---

### Scene 4 — Attention awareness (0:55 – 1:20)

| Visual | Audio (VO) |
|---|---|
| Focused on tab 1 while tabs 2 and 3 run in the background. One background tab prints a prompt and goes idle — its tab badges with a **yellow dot**, and the sidebar's **AWAIT** counter ticks from 0 to 1 (`multi-tab.png`). Then the second background tab does the same → **AWAIT 2**. | "Here's the part that matters. Awakon watches every session for you. The moment a background agent prints a prompt and goes quiet, its tab badges yellow and the sidebar tells you exactly how many are waiting — without you reading a single line of output." |

**Shot list:** active tab in foreground; background tab badges yellow; sidebar AWAIT 0→1→2; sidebar status row (AWAIT / LIMITED / RUNNING / IDLE).

---

### Scene 5 — Native notifications (1:20 – 1:40)

| Visual | Audio (VO) |
|---|---|
| Click away from Awakon to another app (browser/editor) so the window loses focus. A background session needs input → a **native OS notification** slides in naming the session. Click it → Awakon comes to front and jumps straight to that tab. | "Tabbed away? Awakon fires a native desktop notification with the session's name. Click it, and you land right on the tab that needs you. No hunting." |

**Shot list:** focus leaves Awakon; OS toast appears; click toast → window focuses + correct tab active. (Mention coalescing only if time: "and a chatty agent can't spam you.")

---

### Scene 6 — Rate-limit auto-resume (1:40 – 2:10) — hero feature

| Visual | Audio (VO) |
|---|---|
| A session prints the dreaded "You've hit your limit — resets at 9:30pm." A **LIMITED** badge appears in the sidebar with a pending-resume countdown. Cut to `settings.png` (`Ctrl+,`): the Auto-resume panel — toggle, detect-phrase chips, response text. Cut back: the reset time arrives and Awakon **types the response on its own**; the agent picks the work back up. | "And the best part — when an agent says it's out of usage and tells you when it resets, Awakon reads that time, waits for it, and resumes the session for you, automatically. You set the phrase to watch for and the reply to send. Walk away, come back, the work just continued." |

**Shot list:** rate-limit message in a tab; sidebar LIMITED + countdown; `Ctrl+,` settings panel (`settings.png`); time arrives → auto-typed `continue` → agent resumes. *This is the climax — give it room.*

---

### Scene 7 — Split panes + persistence (2:10 – 2:30)

| Visual | Audio (VO) |
|---|---|
| `Ctrl+\` splits the focused tab into two live panes side by side (`splits.png`) — two sessions in one view. Then quit and relaunch Awakon: tabs, shells, working directories, and the split layout all come back. | "Want two agents in one view? Split any tab. And when you quit, your tabs, shells, and layout are right where you left them next launch." |

**Shot list:** `Ctrl+\` split (`splits.png`); quick quit → relaunch → layout restored.

---

### Scene 8 — Close / CTA (2:30 – 2:40)

| Visual | Audio (VO) |
|---|---|
| Quick montage of keyboard shortcuts firing (new tab, switch, split, settings), then the three platform logos — Windows, macOS, Linux. End card: **Awakon** + repo URL `github.com/ecogs-sys/Awakon` + "Build it yourself today." | "Keyboard-first, cross-platform, one codebase on Windows, macOS, and Linux. Awakon. Run every agent in parallel — and never miss the moment one needs you." |

**Shot list:** shortcut montage; OS logos; end card with repo URL + CTA.

---

## Full voiceover (continuous read, for the recording booth)

> You're running three coding agents at once. Two are working. This one… has been waiting on you for ten minutes. And you had no idea.
>
> Awakon is a desktop terminal built for exactly this — running many agents in parallel, and never missing the moment one of them needs you.
>
> Every project gets its own tab, backed by a real shell — PowerShell, bash, zsh, wsl, or any command you want, each in its own working directory. And because every session runs in its own process, one crash never takes the others down.
>
> Here's the part that matters. Awakon watches every session for you. The moment a background agent prints a prompt and goes quiet, its tab badges yellow and the sidebar tells you exactly how many are waiting — without you reading a single line of output.
>
> Tabbed away? Awakon fires a native desktop notification with the session's name. Click it, and you land right on the tab that needs you. No hunting.
>
> And the best part — when an agent says it's out of usage and tells you when it resets, Awakon reads that time, waits for it, and resumes the session for you, automatically. You set the phrase to watch for and the reply to send. Walk away, come back, the work just continued.
>
> Want two agents in one view? Split any tab. And when you quit, your tabs, shells, and layout are right where you left them next launch.
>
> Keyboard-first, cross-platform, one codebase on Windows, macOS, and Linux. Awakon. Run every agent in parallel — and never miss the moment one needs you.

**Approx. word count:** ~250 words → ~1:50–2:10 of narration, leaving room for pauses and B-roll breathing space within the 2–3 min target.

---

## Capture checklist (for whoever records the screen footage)

- [ ] Scene 1: 2–3 plain terminal windows running agents; one left on an unanswered prompt.
- [ ] Scene 3: `Ctrl+T` New Session dialog; show the shell dropdown + working-directory picker.
- [ ] Scene 4: at least 3 tabs; trigger two background tabs to badge yellow; sidebar AWAIT 0→2.
- [ ] Scene 5: unfocus the window; trigger a native OS notification; click it to refocus + switch tab.
- [ ] Scene 6: a real (or staged) rate-limit message; sidebar LIMITED + countdown; `Ctrl+,` settings; auto-resume firing.
- [ ] Scene 7: `Ctrl+\` split; quit + relaunch showing restored layout.
- [ ] Scene 8: shortcut montage; end card with `github.com/ecogs-sys/Awakon`.

## Shortcuts cheat-sheet (for on-screen key overlays)

`Ctrl+T` new tab · `Ctrl+W` close tab · `Ctrl+Tab` / `Ctrl+Shift+Tab` next/prev · `Ctrl+1`…`Ctrl+9` jump · `Ctrl+B` toggle sidebar · `Ctrl+\` split horizontal · `Ctrl+Shift+\` split vertical · `Ctrl+Shift+W` close pane · `Ctrl+,` settings. *(On macOS, `Cmd` in place of `Ctrl`.)*
