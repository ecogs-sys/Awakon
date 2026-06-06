# Markdown Doc Reader — right-side modal overlay

**Status:** Approved design — ready for implementation planning
**Date:** 2026-06-07
**Source handoff:** `docs/design_handoff_md_doc_reader/` (README + `*.jsx` prototypes)

## Summary

When an AI coding agent (or any process) prints a `.md` path in a terminal pane,
that path becomes a clickable accent-underlined link. Clicking it slides a
**right-side reader panel that covers ~90% of the content area**, rendering the
parsed Markdown for review. The reader is a **full modal read mode** — every
split (the agent pane *and* the user's own shell pane) sits behind a dimmed
scrim that acts purely as a dismiss target. `esc` or a scrim click drops back to
the live split.

The reader is **owned by its tab**, not by a pane. Switching tabs parks the
reader and leaves an `M↓` marker on the originating tab; returning restores it.
Multiple proposed files share a file-tab strip inside the reader (`Mod+[` /
`Mod+]` to move between them). Each doc carries provenance and Approve / Request
changes actions.

### Explicitly rejected (do not reintroduce)

The earlier redesign handoff (`docs/design_handoff_aipad_redesign/`, section 7)
specified a **460px non-modal sliding pane** where the terminal stayed
interactive. That alternative was **rejected** by this handoff and was never
built. This spec supersedes it. Do **not** build a docked / pane-local /
work-while-reading variant.

## Decisions (resolved during brainstorming)

| Topic | Decision |
|---|---|
| **Approve / Request changes actions** | **Visual state only** in v1. Clicking sets the doc's `reviewState` and restyles the pill; persisted per tab. No write-back to the agent, no filesystem/commit side-effect. |
| **"Peek" strip behind the reader** | **Plain dimmed scrim.** The native terminal view is moved offscreen when the reader opens, so the visible ~10% strip is just the scrim color + the vertical dismiss hint, not a live/snapshotted terminal. |
| **Persistence** | **Persist across restart.** Per-tab open docs + review states + active index are saved to disk (alongside split layout) and restored on launch. File *content* is re-read lazily on open, never stored. |
| **Provenance line** | **Source pane/session.** Provenance shows the emitting session's title + status dot (e.g. "proposed by pwsh · ~/proj"). No agent-identity guessing — Awakon tracks sessions by shell, not by agent. |

## Architecture & data flow

Awakon has two renderer surfaces and a main process:

- **chrome** renderer — titlebar, tab strip, sidebar, modals, empty state.
- **terminal-host** renderer — one `WebContentsView` *per tab*, hosting an
  xterm-based `SplitContainer` (one or more panes). These native views **paint
  on top of the chrome DOM**; a DOM scrim cannot cover them.
- **main** — owns sessions, the `ViewManager`, and IPC routing.

The reader lives **entirely in the chrome renderer**, because that is the only
surface not obscured by native terminal views. Existing modals already use this
pattern: the chrome sends `LayoutModal {open:true}`, main `suspend()`s the
visible terminal view offscreen, the chrome renders the modal, and on close
`LayoutModal {open:false}` resumes the view.

### Click-to-open flow (crosses all three layers)

1. **terminal-host (xterm):** a custom link provider marks `.md` path tokens as
   accent-underlined links. On click it sends a new request
   `core.doc.open { sessionId, path }` to main.
2. **main:** resolves the emitting pane → owning `tabId` (it already tracks
   pane→tab from `SessionCreateForPane`) and the session's `cwd` + `title`.
   Resolves `path` against `cwd`. Emits event
   `event.doc.open-request { tabId, rawPath, resolvedPath, provenanceTitle, provenanceStatus }`
   to the chrome renderer.
3. **chrome:** adds the doc to that tab's reader state, makes it active, shows
   the overlay, and suspends the terminal via the existing `LayoutModal` path.
   `esc` / scrim-click sends `LayoutModal {open:false}` and resumes the terminal.

## File reading (new IPC)

Add one main handler in `apps/desktop/src/main/fs-handlers.ts`:

```
core.fs.read-file { path } -> { content, sizeBytes, mtimeMs }
                            | { tooLarge: true, sizeBytes }
                            | { notFound: true }
                            | { error: string }
```

Rules:
- Only reads files whose path ends in `.md` (reject others with `error`).
- **>1 MB guard:** return `{ tooLarge, sizeBytes }`; the reader shows a
  placeholder instead of rendering.
- **Missing file** (a "proposed" doc not yet created): return `{ notFound }`;
  the reader shows `<path> (not yet created)` in `--text-3`. The terminal link
  stays clickable so re-clicking after the agent writes the file renders it.
- Files outside the workspace are allowed; the absolute path is shown in the
  path bar.

The chrome requests content itself (after receiving `open-request`), keeping
main thin. Define the request/response schemas in
`packages/contracts/src/ipc.ts` with zod, mirroring `FsPathExists*`.

## Markdown rendering

- Parse with **markdown-it** in the chrome; sanitize the resulting HTML with
  **DOMPurify** before insertion (defense against malicious doc content).
- Render into the reader body using the handoff's exact typography:
  - h1 20px/600, letter-spacing -0.2
  - h2 15px/600, margin 20px 0 8px
  - paragraph 13.5px/1.65
  - list items 13.5px with a `·` bullet hung at left:-12
  - inline code 12px mono on `--bg-3`, radius 3, 1px 5px pad
  - code block 11.5px/1.55 mono on `--term-bg`, 1px `--border-1`, radius 6,
    12px 14px pad; horizontal scroll inside the block (never break layout)
  - body `--bg-0`, content `max-width:780px`, padding `28px 24px`
- **No syntax highlighting in v1** (code blocks render plain mono). Can be added
  later.
- Bundle `markdown-it` + `DOMPurify` as dependencies (offline Electron app).
- Fonts (Inter / JetBrains Mono): verify they are already bundled from the
  redesign work; bundle locally if not (do not depend on Google Fonts at
  runtime).

## Reader UI (chrome components)

A new chrome module `DocReader` (e.g. `apps/desktop/src/renderer/chrome/doc-reader.ts`)
renders the overlay per handoff frame ②:

- **Scrim** over the body area: `background: rgba(8,7,11,.55)`, with a vertical
  hint ("click or esc to close", `writing-mode: vertical-rl`, 10px mono) on its
  left edge. The whole scrim is a dismiss target.
- **Panel:** `position:absolute; top:0; bottom:0; right:0; width:90%`, slides in
  (`transform: translateX(100% -> 0)`, ~180–220ms ease-out), `background:
  --bg-0`, `border-left: 1px solid --border-2`, `box-shadow: -24px 0 60px
  rgba(0,0,0,.5)`. Scrim fades in underneath.
- **File tab strip** (height 36, `--bg-1`, bottom border): one tab per open doc,
  each with an `M↓` glyph (accent if active), filename, and a hover-highlight
  `×` close (hover: `--bg-3` bg, `--text-1`). Active tab: `--bg-0` background +
  2px accent top-border. A right-aligned `×` (Close, esc) sits in a 40px cell
  with a left border.
- **Review bar** (`--bg-1`, ~8px 14px pad): left = path with `~/…` prefix dimmed
  to `--text-4`; middle = provenance (status dot + source session title, 10.5px
  mono `--text-4`); right = two pills — **✓ Approve** (`--st-running` on
  `--st-running-bg`) and **✎ Request changes** (`--text-2` on `--bg-2`,
  `--border-1` border), both radius 5, 11px mono. Clicking sets the doc's
  `reviewState` (visual + persisted only) and restyles.
- **Body:** rendered Markdown (see above).
- **Footer** (`--bg-1`, top border, 10.5px mono `--text-4`): left = keyboard
  hints `esc close · Mod+[ prev file · Mod+] next file` (keys in `--text-3`,
  rendered via the cross-platform `kbd()` helper); right = `N LOC · N KB`.

The tab strip component (`apps/desktop/src/renderer/chrome/tab-strip.ts`) gains
an **`M↓` marker variant** for tabs that have a parked reader (accent text on
`accent+22` bg, `accent+44` border).

## State & persistence

Per-tab reader state, extending the chrome state in
`apps/desktop/src/renderer/chrome/state.ts`:

```ts
type ReviewState = 'proposed' | 'approved' | 'changes-requested';

interface OpenDoc {
  rawPath: string;          // as referenced in the terminal
  resolvedPath: string;     // absolute, resolved against session cwd
  provenanceTitle: string;  // emitting session title
  provenanceStatus: Status; // emitting session status (for the dot)
  reviewState: ReviewState;
}

interface TabDocState {
  openDocs: OpenDoc[];
  activeDocIndex: number | null;   // null = no doc / reader fully closed
  readerVisible: boolean;          // only meaningful on the active tab
}
```

Behavior:
- Clicking a `.md` link adds/locates the doc in `openDocs`, sets
  `activeDocIndex`, sets `readerVisible=true`, and suspends the terminal.
- `esc` / scrim click sets `readerVisible=false` but keeps `activeDocIndex` so
  the `M↓` marker persists; resumes the terminal.
- Switching tabs parks the active tab's reader (`readerVisible=false`) and shows
  the new tab's terminal; an inactive tab with `activeDocIndex != null` shows the
  `M↓` marker. Returning to a tab with `readerVisible` previously true restores
  the reader.
- Closing one file (`×` on a file tab) removes it from `openDocs`; if it was
  active, move to a neighbor or close the reader when none remain.

Persistence (across restart):
- Save `openDocs` (without content) + `activeDocIndex` per tab to disk via the
  existing layout-persistence mechanism (the same path that persists split
  trees). Add a new optional field with a **schema migration** in
  `packages/contracts/src/persistence.ts` + the persistence store.
- On launch, restore docs + markers. File **content is re-read lazily** on open
  (so external edits show fresh) — content is never serialized.
- `readerVisible` is **not** persisted as "shown on boot"; restored tabs show the
  `M↓` marker parked, consistent with how tab switching parks the reader.

Keyboard wiring added to `apps/desktop/src/renderer/chrome/keyboard.ts`: `esc`,
`Mod+[`, `Mod+]` active **only while the reader is visible**, using
`matchShortcut()` for cross-platform handling.

## New / changed IPC channels

Add to `packages/contracts/src/ipc.ts`:

- Request `core.fs.read-file` — payload `{ path }`, response union described
  above.
- Request `core.doc.open` — payload `{ sessionId, path }` (terminal-host → main).
- Event `event.doc.open-request` — payload
  `{ tabId, rawPath, resolvedPath, provenanceTitle, provenanceStatus }`
  (main → chrome).
- Extend the persisted layout schema with the per-tab reader doc state.

## Components touched

| Area | File | Change |
|---|---|---|
| contracts | `packages/contracts/src/ipc.ts` | new channels + zod schemas |
| contracts | `packages/contracts/src/persistence.ts` | reader-state field + migration |
| main | `apps/desktop/src/main/fs-handlers.ts` | `read-file` handler |
| main | `apps/desktop/src/main/index.ts` (or router) | `doc.open` request → `doc.open-request` event; pane→tab/cwd resolution |
| terminal-host | `packages/terminal-host/src/terminal-host.ts` | xterm link provider for `.md`; emit `doc.open` on click |
| chrome | `apps/desktop/src/renderer/chrome/doc-reader.ts` (new) | the overlay (scrim, panel, file tabs, review bar, body, footer) + markdown render |
| chrome | `apps/desktop/src/renderer/chrome/layout-manager.ts` | handle `doc.open-request`, suspend/resume via `LayoutModal`, per-tab park/restore, persistence wiring |
| chrome | `apps/desktop/src/renderer/chrome/state.ts` | `TabDocState` |
| chrome | `apps/desktop/src/renderer/chrome/tab-strip.ts` | `M↓` marker variant |
| chrome | `apps/desktop/src/renderer/chrome/keyboard.ts` | reader shortcuts |
| chrome | `apps/desktop/src/renderer/chrome/styles/*.css` | reader styles (tokens already present from redesign) |

## Testing

Follow the repo's colocated `*.test.ts` + vitest convention.

- **contracts / core:** schema tests for `read-file` and `doc.open` payloads;
  persistence-migration test for the new reader field (old persisted state loads
  cleanly).
- **main:** `fs-handlers` read-file tests — `.md`-only filter, >1MB `tooLarge`,
  missing-file `notFound`, outside-workspace allowed, happy path returns content
  + stat.
- **chrome:** `doc-reader` tests — open/park/restore per tab, file-tab
  switching, review-state toggle + persistence, missing-file and large-file
  placeholders, `esc` / scrim dismiss keeps marker; `tab-strip` `M↓` marker
  rendering.
- **terminal-host:** link-provider matcher unit test — which tokens become links
  (`docs/migration.md`, `README.md`, `./a/b.md`; not bare `md`, not
  `something.markdown`), trailing punctuation handling.

## Out of scope (v1)

- Live file-watching / auto-reload of an open doc.
- Syntax highlighting in code blocks.
- "Open in $EDITOR" / "copy path" actions (these were old section-7 elements,
  absent from this handoff).
- Any real approve / commit / write-back-to-agent side-effects.
