# Handoff: Markdown Doc Reader — right-side overlay (AI.Pad)

## Overview
AI.Pad is an Electron terminal app for running multiple AI coding agents (Claude Code, Codex, plus plain PowerShell shells) side by side, each in its own session/tab, with split panes. This handoff covers **one signed-off feature**: how a proposed Markdown document (e.g. a migration plan an agent writes) is **reviewed** inside the app.

The signed-off interaction is a **right-side overlay reader**:
- An agent proposes one or more `.md` files; they appear as underlined links in that agent's terminal output.
- Clicking a link slides a **reader panel in from the right that covers ~90% of the console** — every split included (the agent pane *and* the user's own shell pane sit behind it).
- The reader is **modal**: the dimmed ~10% strip of terminal still visible behind it is purely a dismiss target. Click it or press `esc` to drop back to the live split.
- The reader is **owned by its tab**, not by a pane. Switching tabs parks it; the original tab keeps an `M↓` marker indicating a doc is open there. Returning to that tab restores the reader exactly as left.
- Multiple proposed files share a tab strip inside the reader; `⌘[` / `⌘]` move between them. Each file carries provenance ("proposed by claude · refactor") and **Approve / Request changes** actions.

> **Design decision / sign-off note:** An earlier alternative was explored — docking the doc *over only the agent pane* so the user's shell stayed interactive while reading. **That alternative was rejected.** The reader is intentionally a full modal read mode, not a work-while-reading mode. If the user needs their shell while a doc is open, they dismiss the reader (`esc`) and the split — shell included — is right there, still live. Do **not** reintroduce a docked / pane-local variant.

## About the design files
The files in this bundle are **design references created in HTML/React (via Babel in the browser)** — prototypes that show the intended look and behavior. They are **not** production code to copy verbatim. The task is to **recreate this design inside AI.Pad's real codebase** (Electron + its existing renderer framework and component patterns), reusing the app's real terminal pane, tab strip, sidebar, and theming. Where this prototype inlines styles or fakes a Markdown render, production should use the app's actual styling system and a real Markdown AST renderer.

## Fidelity
**High-fidelity.** Colors, typography, spacing, borders, and layout are intended to be matched closely. Exact token values are listed below. The one deliberate fake: Markdown bodies are hand-built JSX rather than parsed — production should feed a real parsed Markdown AST through equivalent element styles.

---

## Screens / Views
There are three storyboard frames for the signed-off flow, plus a behavior legend. All frames render inside the same app chrome: custom title bar → tab strip → (sidebar + content).

### Frame ① — Agent proposes files · shell runs alongside
- **Purpose:** Starting state. The user sees the agent's proposal in context, with their own shell live in the other split.
- **Layout:** App chrome on top. Content area is a horizontal split: left pane = agent terminal ("claude · refactor", `awaiting` status), 1px vertical divider, right pane = user shell ("pwsh · git / dotnet", `running`).
- **Key elements:**
  - Each pane has a small uppercase corner label (top-left, `position:absolute`, 10px mono, `--text-4`, on a `--term-bg` chip) with a leading status dot.
  - The agent terminal output contains three **file-reference links** rendered with an accent-colored underline (`textDecorationColor: accent + '66'`, `text-underline-offset: 3px`): `docs/migration.md`, `docs/api-changes.md (proposed)`, `README.md (updated install steps)`.
  - A **hint callout** floats over the agent pane (~`left:64 top:150`): a ringed accent dot + a small tooltip "click → slides the reader in".

### Frame ② — Reader slid in from the right (the core state)
- **Purpose:** Reading/reviewing the proposed doc.
- **Layout:** Same split behind, but covered by:
  1. A **full-bleed scrim** over the whole content area: `background: rgba(8,7,11,.55)`, `z-index:5`. On its left edge a vertical-text hint ("click or esc to close", `writing-mode: vertical-rl`, 10px mono).
  2. The **reader panel**, `position:absolute; top:0; bottom:0; right:0; width:90%`, `z-index:6`, `background: --bg-0`, `border-left: 1px solid --border-2`, `box-shadow: -24px 0 60px rgba(0,0,0,.5)`.
- **Reader panel internals (top → bottom):**
  - **File tab strip** — height 36, `--bg-1`, bottom border. Each tab: `M↓` glyph (accent if active) + filename + a hover-highlight `×` close. Active tab gets `--bg-0` background and a 2px accent top-border. A right-aligned `×` (Close, esc) sits in a 40px cell with a left border.
  - **Doc review bar** — height ~`8px 14px` padding, `--bg-1`. Left: path `~/AI.Pad/docs/migration.md` (the `~/AI.Pad/` prefix dimmed to `--text-4`). Middle: provenance — a status dot + "proposed by claude · refactor" (10.5px mono, `--text-4`). Right: two pills — **✓ Approve** (`--st-running` text on `--st-running-bg`) and **✎ Request changes** (`--text-2` on `--bg-2`, `--border-1` border). Both `border-radius:5`, 11px mono.
  - **Rendered Markdown body** — `--bg-0`, content centered with `max-width: 780px`, padding `28px 24px`. (See Markdown typography below.)
  - **Footer** — `--bg-1`, top border, 10.5px mono `--text-4`. Left: keyboard hints `esc close · ⌘[ prev file · ⌘] next file` (the keys themselves in `--text-3`). Right: `342 LOC · 6 KB`.

### Frame ③ — Per-tab persistence
- **Purpose:** Show that the reader is tab-scoped. User has switched to a *different* tab; the reader is gone from view but the original "claude + pwsh · split" tab keeps an `M↓` badge.
- **Layout:** App chrome + a tab strip where the split tab shows an `M↓` pill (accent text on `accent+22` bg, `accent+44` border), the now-active `pwsh.exe` tab is highlighted, and the content area shows that other tab's own plain terminal. No scrim, no reader — it's parked.

### Behavior legend ("Model" section)
A 620×440 card summarizing the five rules: **Open**, **Read mode**, **Per tab**, **Files**, **Need shell?**. Use it as the canonical behavioral spec. The "Need shell?" rule documents the rejected-alternative decision (dismiss the modal to get back to the live split).

---

## Interactions & Behavior
- **Open reader:** Click a proposed `.md` link in terminal output → reader slides in from the right (translateX from 100% → 0). Suggested transition: ~180–220ms ease-out. Scrim fades in underneath.
- **Dismiss:** Click the visible terminal sliver / scrim, or press `esc` → reader slides back out, scrim fades.
- **Switch files inside reader:** `⌘[` / `⌘]`, or click a file tab. Each file has its own provenance + approve/request state.
- **Close one file:** `×` on a file tab (hover state: `--bg-3` background, `--text-1` color).
- **Approve / Request changes:** Per-file actions in the review bar. (Wire to whatever the real review/commit flow is.)
- **Tab switching:** Reader state is stored per tab. Leaving a tab parks the reader and shows `M↓` on that tab; returning restores it.
- **Status semantics (dots/badges):** `running` (green), `awaiting` input (amber, gets a soft glow ring), `limited` rate-limited (red), `idle` (grey).

## State Management
Per **tab**, track:
- `openDocs: { name, path, provenanceAgentId, modified }[]` — files proposed/opened in this tab.
- `activeDocIndex: number | null` — which file is showing; `null` = reader closed/parked.
- `readerVisible: boolean` — whether the overlay is currently shown on the *active* tab (an inactive tab with `activeDocIndex != null` shows the `M↓` marker).
- Per doc: `reviewState: 'proposed' | 'approved' | 'changes-requested'`.

Triggers: clicking a file link sets `activeDocIndex` + `readerVisible`; `esc`/scrim click sets `readerVisible=false` (keeps `activeDocIndex` so the marker persists); switching tabs swaps the active tab's reader view in/out.

## Design Tokens
All defined as CSS custom properties on `:root` (OKLCH). Copy verbatim — see `AI.Pad Split Docs.html` `<style>` block.

### Surfaces / neutrals
| Token | Value | Use |
|---|---|---|
| `--bg-0` | `oklch(0.155 0.008 250)` | app/content background, reader bg |
| `--bg-1` | `oklch(0.195 0.008 250)` | bars: title, tab strip, review bar, footer, sidebar |
| `--bg-2` | `oklch(0.235 0.008 250)` | inputs, secondary pills, flyouts |
| `--bg-3` | `oklch(0.275 0.009 250)` | active session row, hover, inline code bg |
| `--bg-4` | `oklch(0.325 0.010 250)` | scrollbar thumb |
| `--bg-overlay` | `oklch(0.10 0.008 250 / 0.7)` | modal scrim (for centered modals) |
| `--term-bg` | `oklch(0.165 0.008 250)` | terminal surface, code blocks |

### Text
| Token | Value |
|---|---|
| `--text-1` | `oklch(0.97 0.003 250)` (primary) |
| `--text-2` | `oklch(0.74 0.006 250)` (secondary) |
| `--text-3` | `oklch(0.56 0.008 250)` (tertiary) |
| `--text-4` | `oklch(0.42 0.008 250)` (faint / metadata) |

### Borders
| Token | Value |
|---|---|
| `--border-1` | `oklch(0.30 0.010 250 / 0.6)` |
| `--border-2` | `oklch(0.36 0.012 250 / 0.5)` |

### Accent (themeable — default "ocean blue")
| Token | Value |
|---|---|
| `--accent` | `oklch(0.72 0.12 230)` — default hex `#7CA8E0` |
| `--accent-soft` | accent @ ~18% (`accent + '2e'`) |
| `--accent-glow` | accent @ ~35% (`accent + '59'`) |

Accent is user-selectable. Options: `#7CA8E0` (blue), `#9BC8A3` (green), `#C9A56B` (sand), `#B89BD9` (violet), `#7BC1C5` (teal). All share roughly equal lightness/chroma, hue varies. Active-tab top borders, links, primary buttons, `M↓` markers, and focus rings all use accent.

### Status colors
| Token | Value |
|---|---|
| `--st-running` / `-bg` | `oklch(0.78 0.15 155)` / same @14% |
| `--st-awaiting` / `-bg` | `oklch(0.82 0.13 88)` / same @16% |
| `--st-limited` / `-bg` | `oklch(0.70 0.18 25)` / same @16% |
| `--st-idle` / `-bg` | `oklch(0.55 0.008 250)` / same @14% |

### Terminal syntax colors
`--term-fg oklch(0.92 0.004 250)`, `--term-dim oklch(0.62 0.006 250)`, `--term-green oklch(0.82 0.16 145)`, `--term-cyan oklch(0.80 0.12 200)`, `--term-yellow oklch(0.86 0.14 92)`, `--term-blue oklch(0.78 0.13 240)`, `--term-magenta oklch(0.74 0.14 320)`, `--term-red oklch(0.72 0.16 25)`.

### Typography
- **Sans (UI + rendered Markdown):** `Inter`, fallback `system-ui, -apple-system, 'Segoe UI', sans-serif`.
- **Mono (terminal, paths, badges, metadata, keycaps):** `JetBrains Mono`, fallback `ui-monospace, 'SF Mono', Menlo, monospace`.
- **Markdown body scale:** h1 20px/600/`-0.2` letter-spacing; h2 15px/600 (margin `20px 0 8px`); paragraph 13.5px/1.65; list items 13.5px with a `·` bullet hung at `left:-12`; inline code 12px mono on `--bg-3`, `radius 3`, `1px 5px` pad; code block 11.5px/1.55 mono on `--term-bg`, `1px --border-1` border, `radius 6`, `12px 14px` pad.
- **Terminal lines:** 12.5px mono, line-height 1.6, `white-space: pre`. Prompt = blue path + yellow command + fg args. AI block = left `2px solid --term-magenta` border, `padding-left:12; margin-left:-14`. Tool line = cyan with dim trailing meta. Cursor = blinking 8px-wide fg block (`@keyframes aip-blink`, 1.05s steps(1)).

### Radii / shadows
- Radii: panes & cards `8`, modals `10–12`, pills `5`, badges/keycaps `4`, status pills `999`, inline code `3`.
- Reader shadow: `-24px 0 60px rgba(0,0,0,.5)`. Flyout/modal shadows: `0 12px 32px` → `0 32px 80px rgba(0,0,0,.45–.6)` plus a `0 0 0 1px rgba(255,255,255,.04)` hairline.
- Scrim behind reader: `rgba(8,7,11,.55)`.

## Components (reusable, from the app shell)
These already exist in the prototype and should map to real app components:
- `TitleBar` — custom VS-Code-style title bar: app glyph, menu (File/Tabs/View/Window/Help), centered title + subtitle, Windows window controls. Height 32.
- `TabBar` / `Tab` — session tab strip, height 36, status dot + label + `×`, active tab has accent 2px top border. (For the doc reader, tabs also support an `M↓` doc marker variant.)
- `Sidebar` — 260px sessions list with a status-overview header (counts by status) and per-session rows (kind chip, name, cwd, status badge). Also a 56px `CollapsedSidebar` rail with hover flyouts.
- `StatusBadge` — pill / dot / icon variants keyed off the four statuses.
- `TerminalPane` + `TermLine` — token-array terminal renderer (prompt/out/dim/color/ai/tool/blank/cursor/ai-link). The `ai-link` token is what makes a `.md` path clickable.
- `AppGlyph` — the app icon (rounded square, three status dots, a chevron + line motif).

Doc-reader-specific components (in `split-md.jsx`): `OverlayDoc` (the sliding panel), `OverlayModelScreen` (frame ②), `TabPersistScreen` (frame ③), `DocReviewBar`, `MigrationDoc` (sample rendered body), `Legend`.

## Assets
No raster/image assets. The only artwork is the inline SVG `AppGlyph` (rounded-rect + dots + chevron) and the bundle thumbnail in the HTML. Fonts load from Google Fonts (Inter, JetBrains Mono) — production should bundle these locally for an offline Electron app.

## Files in this bundle
- `AI.Pad Split Docs.html` — entry point; defines all CSS tokens + loads the scripts.
- `split-md.jsx` — **the signed-off feature**: overlay reader, storyboard frames, behavior legend, and the `App` (design-canvas layout).
- `app.jsx` — shared chrome: title bar, tabs, sidebar, status badges, app glyph.
- `screens.jsx` — terminal renderer + sample terminal content (incl. the `ai-link` tokens) + other app screens (settings, about, command palette, empty state) for context.
- `design-canvas.jsx`, `tweaks-panel.jsx` — prototype scaffolding only (pan/zoom canvas + accent-color tweak). **Not part of the product** — ignore when implementing.

### How to view the reference
Open `AI.Pad Split Docs.html` in a browser. It lays the three frames + legend on a pannable canvas. The "Tweaks" panel (top-right) only changes the accent color.
