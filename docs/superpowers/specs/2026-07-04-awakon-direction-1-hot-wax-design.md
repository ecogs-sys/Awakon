# Awakon · Direction 1 "Hot Wax" — Design Spec

**Date:** 2026-07-04
**Branch:** `feat/design-1`
**Source design:** `docs/Design/Electon App AI.Pad-handoff/electon-app-ai-pad/project/Awakon.html`
(Direction 1 "Hot Wax" — `awakon-d1.jsx`, `awakon-shared.jsx`, `app.jsx`, `screens.jsx`)

## Context

The Awakon desktop app (Electron, vanilla-TS renderer under
`apps/desktop/src/renderer/chrome/`) already implements the sibling **AI.Pad**
layout: a VS-Code-style titlebar, tab strip, status sidebar (expanded + collapsed
rail), terminal panes, split panes, settings/about/new-session modals, a markdown
doc-reader, and an empty state. All of these already consume the design tokens in
`styles/tokens.css` via `var(--*)`.

Direction 1 "Hot Wax" is therefore **not a rewrite**. It is:
1. a **re-theme** (blue hue-250 → violet hue-288/300, accent `#7CA8E0` → `#C36BEF`),
2. a **new brand icon** (the "aperture" mark), incl. regenerated packaged app icons,
3. a **top-bar restructure** (VS-Code menu strip → platform-neutral bar), and
4. one **new feature** — a Command Palette (`Ctrl/⌘+K`).

## Decisions (locked with the user)

- **Menu strip:** replaced by the platform-neutral bar; the five native menus
  (File/Tabs/View/Window/Help) remain reachable via a single **hamburger (⋯)**
  button that pops the full application menu. No functionality lost.
- **Command palette:** **fully functional** this pass (not a visual stub).
- **Icon:** in-app SVG glyph **and** all packaged app icons regenerated.
- **Shortcuts:** OS-resolved. One `formatAccelerator` helper drives **both** the
  displayed label and (via the existing `parseAccelerator`) the binding, so they
  can never drift. Zero hardcoded `⌘` in shipped UI. macOS shows `⌘⇧⌥⌃`,
  Windows/Linux show `Ctrl+/Shift+/Alt+`.
- **Delivery:** 4 commits on `feat/design-1`, one PR.

## Non-goals

- Direction 2 "Studio" (separate design, out of scope).
- Redesigning terminal rendering, PTY, IPC transport, or session persistence.
- Inventing shortcuts the app doesn't have: palette rows map to **real**
  accelerators (e.g. "Split pane right" → `Ctrl+\`, the app's real split binding),
  not the mockup's illustrative `⌘D`.
- No fabricated breadcrumb data (see Phase 2).

---

## Phase 1 — Hot Wax theme + aperture icon

### 1a. Theme (`styles/tokens.css`)
Swap the `:root` values to the D1 palette (from `Awakon.html` `.awk-d1` + `screens`/
`tokens` cross-reference):

- **Surfaces** `--bg-0…4`, `--bg-overlay`: violet hue 288 (overlay hue 300).
- **Text** `--text-1…4`: hue 300.
- **Borders** `--border-1/2`: hue 300.
- **Accent:** `--accent:#C36BEF`, `--accent-soft:#C36BEF2e`, `--accent-glow:#C36BEF59`.
- **Status** running (158), awaiting (86), limited (22), idle (hue 300) + keep the
  `-bg` and `-ring` variants the current CSS relies on.
- **Terminal ANSI** `--term-*`: D1 values (hue 288).
- **Layout constants:** `--titlebar-h: 44px;` `--tabbar-h: 39px;` `--sidebar-w: 260px`.

Keep fonts (Inter + JetBrains Mono). Keep the `aip-blink` / `aip-pulse` / drag-region
rules.

### 1b. Aperture mark (in-app)
Add a canonical Awakon mark generator producing the `awakon-shared.jsx` `AwakonMark`
SVG: rounded tile (`--bg-2` + faint top-white gradient + 1.5px inner stroke), an
**open accent aperture ring** (`r=27`, `stroke-width 8`, `stroke-dasharray` for the
top notch, `rotate(-72)`), and a **rising caret** (`M39 56 L50 45 L61 56`,
`stroke=--text-1`, `stroke-width 7.5`). A `tile=false` variant (ring+caret only) is
available for contexts that supply their own container.

Replace the 3-dot glyph in:
- `titlebar.ts` `renderGlyphSvg()` — 20px tiled mark for the wordmark.
- `about-dialog.ts` — 64px mark.
- `empty-state.ts` — 40–64px mark.

### 1c. Packaged icons (`scripts/gen-icons.mjs`)
New reproducible Node script (deps already present: `sharp`, `png-to-ico`; add
`png2icons` for `.icns`). It rasterizes the mark master and writes:
- `apps/desktop/build/icons/{16,32,48,64,128,256,512,1024}x{…}.png`
- `apps/desktop/build/icon.png` (512)
- `apps/desktop/build/icon.ico` (png-to-ico)
- `apps/desktop/build/icon.icns` (png2icons)

Add an npm script (e.g. `pnpm --filter @awakon/desktop icons`) and run it to commit
regenerated binaries.

---

## Phase 2 — Neutral top bar + rounded tabs + hamburger

### 2a. Top bar (`titlebar.ts`, `chrome.css`) — 44px
Left→right: **wordmark** (aperture mark 20 + "Awakon" 14.5) │ vertical divider │
**project · ⎇ branch** breadcrumb (mono, `--text-2/3`) │ flexible centered
**subtitle** (active session, `--text-4`) │ **Ctrl+K/⌘K chip** (opens palette) │
**gear** (opens Settings) │ **⋯ hamburger** (pops full app menu) │ neutral window
controls (min/max/close, 44×30).

- **Breadcrumb honesty:** `project` = basename of the active session's cwd; `branch`
  shown only if cheaply derivable, otherwise omitted. No placeholder/fake values.
- **macOS:** keep the OS menu bar; keep the traffic-light left offset; hide the
  in-window window controls (as today). Hamburger optional on mac (menus already in
  the system bar) — keep gear + palette chip.
- Preserve `-webkit-app-region: drag` on the bar and `no-drag` on all interactive
  children (chip, gear, hamburger, controls).

### 2b. Hamburger → full app menu (IPC)
Add `IpcChannel.ChromeAppMenuPopup` (contracts) + a main-process handler that calls
`Menu.getApplicationMenu()?.popup({ x, y })`. Hamburger click sends the button's
bottom-left coords. (Distinct from the existing per-menu `ChromeMenuPopup`.)

### 2c. Rounded tabs (`tab-strip.ts`, `chrome.css`)
Tab bar 39px, `align-items:flex-end`, `padding-left:8px`, `gap:4px`. Tabs 34px,
`margin-top:5px`, `border-radius:9px 9px 0 0`, active = `background:--term-bg` +
`box-shadow: inset 0 2px 0 --accent` (replaces the separate stripe element and the
per-tab right borders). "+" button 30×30 rounded. **All existing behavior preserved:**
close button, drag-reorder, status dot (awaiting ring), resume-badge, doc-marker.

### 2d. Grid (`chrome.css`)
`#chrome-root` rows already use `var(--titlebar-h) var(--tabbar-h) 1fr`; new heights
flow from the token change. Adjust any hardcoded 32/36 references.

---

## Phase 3 — Re-skin fixes

Sidebar, settings/about/new-session modals, doc-reader, splits, context menu already
reference theme tokens and re-skin automatically. Targeted corrections:

- **Empty state:** `.aip-empty*` currently uses a *separate* hardcoded fallback set
  (`--color-bg #0e0e10`, `--color-accent #7b61ff`, `--color-fg`, …). Rewire to the
  theme tokens (`--bg-*`, `--accent`, `--text-*`) so it picks up Hot Wax.
- **Primary button hover:** `.dlg-btn-primary:hover` hardcodes blue `#6a96cd` →
  replace with an accent-derived hover (`filter: brightness(1.08)`).
- **Hex sweep:** grep chrome for stray literals (`#7CA8E0`, `#6a96cd`, `#2a2f38`,
  `#0d1117`, `#7b61ff`, `#0e0e10`, etc.) and route through tokens where they are
  theme surfaces/accents. (`#0d1117` on-accent button text may stay as an intentional
  near-black "ink on accent"; decide per-instance.)

---

## Phase 4 — Command palette + OS shortcut helper

### 4a. `formatAccelerator` (`packages/keymap`)
Export `formatAccelerator(accelerator: string, platform: string): string`.
- macOS: `Cmd→⌘`, `Shift→⇧`, `Alt→⌥`, `Ctrl→⌃`, joined with no separators (`⌘K`,
  `⌘⇧\`).
- Win/Linux: `CmdOrCtrl/Ctrl→"Ctrl+"`, `Shift→"Shift+"`, `Alt→"Alt+"` (`Ctrl+K`).
- Normalizes `CmdOrCtrl`. Handles the literal keys used in `Bindings` (letters,
  digits, `Tab`, `\`).
Add binding `commandPalette: { accelerator: 'CmdOrCtrl+K' }`.

### 4b. Command palette (`command-palette.ts` + `chrome.css`)
Overlay (reuse the `#dialog-mount` scrim pattern or a dedicated mount). 620px card:
- **Input** row with live cursor + `esc` chip.
- **Sections:**
  - *Switch to session* — live from `LayoutManager` sessions; status pill + jump
    accelerator (`Ctrl+1…9`).
  - *Start session* — New Claude Code / Codex / PowerShell → `manager.newTab({shell})`.
  - *Actions* — Split pane right (`splitHorizontal`), Settings… (`openSettings`),
    Toggle sidebar (`toggleSidebar`).
- **Interaction:** type-to-fuzzy-filter, `↑/↓` move highlight, `↵` execute + close,
  `esc`/scrim-click close, `Tab` no-op-or-filter. Footer hints + live result count.
- Opens on `commandPalette` binding via `keyboard.ts`; also from the top-bar chip and
  sidebar footer.

### 4c. Route every shortcut label through `formatAccelerator`
Top-bar chip, sidebar footer ("… palette"), empty-state cards (New/Resume), doc-reader
hints (esc / prev / next file), palette rows/footer. Palette actions map to the app's
**real** bindings.

### 4d. Tests (vitest + jsdom, matching existing `*.test.ts`)
- `formatAccelerator`: macOS / win32 / linux for `CmdOrCtrl+K`, `CmdOrCtrl+Shift+\`,
  `CmdOrCtrl+1`, `CmdOrCtrl+Tab`.
- `command-palette`: renders sections from a fake manager, filters on input, arrow-key
  highlight wraps, `↵` dispatches the right action, `esc` closes.
- `titlebar`: renders breadcrumb from active session, omits branch when absent,
  hamburger sends `ChromeAppMenuPopup`.

Keep `pnpm typecheck`, `pnpm lint`, `pnpm test` green after every phase.

---

## Risks / open items

- **`.icns` on Windows:** generated via `png2icons` (pure JS); verify electron-builder
  accepts it. Fallback: electron-builder derives `.icns` from `icon.png` at mac
  packaging time.
- **Fonts:** Inter/JetBrains Mono are referenced today; if not bundled they fall back
  to `system-ui`/`ui-monospace`. Not changed here, but note if visuals depend on it.
- **Branch in breadcrumb:** no synchronous git in the renderer; keep it omitted unless
  a cheap source exists, to preserve the "no fake data" rule.
