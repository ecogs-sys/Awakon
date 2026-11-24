// Per-app right-click behaviour for a terminal pane.
//
// Two independent signals decide what a right-click means, and the layering is
// load-bearing:
//
//   1. IS an app in control of the screen?  Derived from terminal MODE state —
//      the alternate-screen buffer, or mouse tracking. Full-screen apps set one
//      or both, and plain shells (pwsh, cmd, bash, zsh) set neither, verified
//      against real ptys. Both are reset when the app exits.
//
//   2. WHICH app is it?  Derived from the OSC window title the app sets
//      (Claude Code announces "✳ Claude Code"; the shell restores its own title
//      afterwards). This is only ever used to SELECT a profile.
//
// The mode check gates the title check, never the other way around. A title
// alone can't trigger anything — which matters because a title is easy to spoof
// or leave stale: bash sets the window title to the command being run, so merely
// typing `claude` at a prompt makes the title say "claude" while no app is
// running at all. Gating on mode state means that can't turn a right-click into
// a surprise paste.
//
// Deliberately NOT used as "app in control" signals, both confirmed false
// positives against idle shells:
//   • focus-reporting (DECSET 1004)  — on for every idle shell under ConPTY
//   • bracketed paste (DECSET 2004)  — on at an idle bash/zsh prompt (readline)
//   • synchronized output (DECSET 2026) — transient; apps toggle it on and off
//     around each frame repaint, so it reads false between frames anyway.

/** What a right-click does in a pane.
 *  • 'menu'        — show the terminal context menu (plain shell prompt)
 *  • 'paste'       — paste the clipboard immediately, no menu
 *  • 'passthrough' — no menu, no paste; the click belongs to the running app */
export type RightClickAction = 'menu' | 'paste' | 'passthrough';

export interface AppProfile {
  id: string;
  /** Matched against the pane's current OSC window title. Used only when the
   *  foreground program name is unavailable (no shell integration). */
  match: RegExp;
  /** Foreground program names this profile claims, lowercased and without
   *  extension (see Session.programName). Preferred over `match` because it is
   *  reported by the shell rather than inferred from what the app drew. */
  commands?: readonly string[];
  rightClick: RightClickAction;
}

/** Built-in profiles. Shaped so a user-configurable list can be layered on top
 *  later (first match wins, so user entries would be prepended). */
export const BUILT_IN_APP_PROFILES: readonly AppProfile[] = [
  // Claude Code sets its title to "claude", then "✳ Claude Code".
  { id: 'claude-code', match: /claude/i, commands: ['claude'], rightClick: 'paste' },
  // Codex and Gemini are invisible to terminal-mode detection: both render inline in
  // the normal buffer without taking the alternate screen or the mouse, and Codex sets
  // no OSC title at all. They are reachable ONLY via shell integration, which is why
  // they carry no `match` pattern — there is nothing in the byte stream to match on.
  { id: 'codex', match: /$^/, commands: ['codex'], rightClick: 'paste' },
  { id: 'gemini', match: /$^/, commands: ['gemini'], rightClick: 'paste' },
];

/** Which platform the pane is rendering on. Right-click means different things on
 *  each, and the difference is a native convention, not a preference:
 *    • Windows — Windows Terminal and conhost PASTE on right-click, no menu.
 *    • macOS   — Terminal.app and iTerm2 open a context menu.
 *    • Linux   — GNOME Terminal and Konsole open a context menu.
 *  VS Code's terminal follows exactly this split too. */
export type RightClickPlatform = 'windows' | 'mac' | 'linux';

/** Terminal mode state a pane exposes, narrowed to just what this module reads
 *  so it stays testable without constructing an xterm Terminal. */
export interface TerminalModeState {
  bufferType: 'normal' | 'alternate';
  /** xterm's IModes.mouseTrackingMode: 'none' when no app is tracking the mouse. */
  mouseTrackingMode: string;
}

/** True when a full-screen app owns the pane rather than a shell prompt. */
export function isAppInControl(modes: TerminalModeState): boolean {
  return modes.bufferType === 'alternate' || modes.mouseTrackingMode !== 'none';
}

/** First profile whose pattern matches the title, or null. */
export function matchAppProfile(
  title: string,
  profiles: readonly AppProfile[] = BUILT_IN_APP_PROFILES,
): AppProfile | null {
  if (!title) return null;
  // .test() on a shared RegExp is stateful when the pattern carries /g — profiles
  // are authored without it, but reset lastIndex so a user-supplied /g pattern
  // can't make matching depend on how many times it has run before.
  for (const p of profiles) {
    p.match.lastIndex = 0;
    if (p.match.test(title)) return p;
  }
  return null;
}

/** Profile claiming `command` (a lowercased program name), or null. */
export function matchAppProfileByCommand(
  command: string,
  profiles: readonly AppProfile[] = BUILT_IN_APP_PROFILES,
): AppProfile | null {
  const name = command.toLowerCase();
  for (const p of profiles) {
    if (p.commands?.includes(name)) return p;
  }
  return null;
}

export interface PaneAppState extends TerminalModeState {
  /** Current OSC window title, or '' if the pane has never reported one. */
  title: string;
  platform: RightClickPlatform;
  /** Foreground program name from shell integration, or null/undefined when the
   *  session has none (cmd, wsl, opted out, or a shell still at its prompt). */
  foregroundCommand?: string | null;
}

/** Decide what a right-click should do in a pane. */
export function resolveRightClick(
  state: PaneAppState,
  profiles: readonly AppProfile[] = BUILT_IN_APP_PROFILES,
): RightClickAction {
  // Outside Windows the context menu IS the native convention, and Electron ships
  // no menu of its own — ours is the only one a user can get. Suppressing it on
  // mac/Linux would leave right-click dead rather than restoring a platform menu,
  // so the app-profile policy is Windows-only. This also removes the macOS
  // Ctrl+click problem by construction: with no paste path there, there is no
  // button-2-only gesture left to miss.
  if (state.platform !== 'windows') return 'menu';

  // Shell integration, when present, is authoritative: the shell TOLD us what it ran,
  // rather than us inferring it from what the app drew. It is also the only way to see
  // Codex or Gemini at all. A null command means the shell is at its prompt.
  if (state.foregroundCommand) {
    const byCommand = matchAppProfileByCommand(state.foregroundCommand, profiles);
    if (byCommand) return byCommand.rightClick;
    // A known-but-unprofiled program is still an app holding the pane — but only
    // treat it as such if it also took the screen, so that ordinary commands
    // (`git status`, `npm test`) keep the menu while they run.
    return isAppInControl(state) ? 'passthrough' : 'menu';
  }

  // No app in control — a shell prompt. Menu, exactly as before.
  if (!isAppInControl(state)) return 'menu';
  // An app owns the pane: a known one gets its configured behaviour, an unknown
  // one (vim, htop, less…) gets the click passed through to it.
  return matchAppProfile(state.title, profiles)?.rightClick ?? 'passthrough';
}
