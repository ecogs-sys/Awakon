import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_APP_PROFILES,
  isAppInControl,
  matchAppProfile,
  resolveRightClick,
  type AppProfile,
} from './app-profiles.js';

/** Mode state of an idle shell prompt, per real-pty capture of pwsh/cmd/bash. */
const IDLE_SHELL = { bufferType: 'normal' as const, mouseTrackingMode: 'none' };

describe('isAppInControl()', () => {
  it('is false at an idle shell prompt', () => {
    expect(isAppInControl(IDLE_SHELL)).toBe(false);
  });

  it('is true on the alternate screen (vim, htop, less)', () => {
    expect(isAppInControl({ bufferType: 'alternate', mouseTrackingMode: 'none' })).toBe(true);
  });

  it('is true when an app is tracking the mouse', () => {
    expect(isAppInControl({ bufferType: 'normal', mouseTrackingMode: 'any' })).toBe(true);
  });

  it('is true for Claude Code, which sets both', () => {
    expect(isAppInControl({ bufferType: 'alternate', mouseTrackingMode: 'any' })).toBe(true);
  });
});

describe('matchAppProfile()', () => {
  it('matches Claude Code by either title it sets', () => {
    expect(matchAppProfile('claude')?.id).toBe('claude-code');
    expect(matchAppProfile('✳ Claude Code')?.id).toBe('claude-code');
  });

  it('returns null for an unknown app title', () => {
    expect(matchAppProfile('htop')).toBeNull();
  });

  it('returns null for an empty title', () => {
    expect(matchAppProfile('')).toBeNull();
  });

  it('returns the first match when several profiles apply', () => {
    const profiles: AppProfile[] = [
      { id: 'first', match: /claude/i, rightClick: 'paste' },
      { id: 'second', match: /claude/i, rightClick: 'menu' },
    ];
    expect(matchAppProfile('claude', profiles)?.id).toBe('first');
  });

  it('is not order-dependent across calls for a /g pattern', () => {
    // A stateful lastIndex would make the second call miss.
    const profiles: AppProfile[] = [{ id: 'g', match: /claude/gi, rightClick: 'paste' }];
    expect(matchAppProfile('claude', profiles)?.id).toBe('g');
    expect(matchAppProfile('claude', profiles)?.id).toBe('g');
  });
});

describe('resolveRightClick()', () => {
  it('shows the menu at a shell prompt', () => {
    expect(resolveRightClick({ ...IDLE_SHELL, platform: 'windows', title: 'pwsh.exe' })).toBe('menu');
  });

  it('pastes when Claude Code is running', () => {
    expect(
      resolveRightClick({ bufferType: 'alternate', mouseTrackingMode: 'any', title: '✳ Claude Code', platform: 'windows' }),
    ).toBe('paste');
  });

  it('passes the click through for an unknown full-screen app', () => {
    expect(
      resolveRightClick({ bufferType: 'alternate', mouseTrackingMode: 'none', title: 'vim README.md', platform: 'windows' }),
    ).toBe('passthrough');
  });

  // The gate that makes a spoofed/stale title harmless: bash sets the window title
  // to the command being run, so merely typing `claude` at a prompt makes the title
  // read "claude" while no app is in control. That must stay a menu, not a paste.
  it('still shows the menu when the title says claude but no app is in control', () => {
    expect(resolveRightClick({ ...IDLE_SHELL, platform: 'windows', title: 'claude' })).toBe('menu');
  });

  it('ships a Claude Code profile by default', () => {
    expect(BUILT_IN_APP_PROFILES.some((p) => p.id === 'claude-code')).toBe(true);
  });
});

// Right-click is a native convention, and only Windows pastes. On mac/Linux the
// context menu is what Terminal.app / iTerm2 / GNOME Terminal give you, and since
// Electron ships no menu of its own, ours is the only one available — suppressing
// it there would leave right-click dead rather than falling back to a native menu.
describe('resolveRightClick() platform policy', () => {
  const CLAUDE_RUNNING = {
    bufferType: 'alternate' as const,
    mouseTrackingMode: 'any',
    title: '✳ Claude Code',
  };

  it('pastes for Claude Code on Windows', () => {
    expect(resolveRightClick({ ...CLAUDE_RUNNING, platform: 'windows' })).toBe('paste');
  });

  it('still shows the menu on macOS even while Claude Code runs', () => {
    expect(resolveRightClick({ ...CLAUDE_RUNNING, platform: 'mac' })).toBe('menu');
  });

  it('still shows the menu on Linux even while Claude Code runs', () => {
    expect(resolveRightClick({ ...CLAUDE_RUNNING, platform: 'linux' })).toBe('menu');
  });

  it('shows the menu on mac/Linux even with a known foreground command', () => {
    const codex = { ...IDLE_SHELL, title: '', foregroundCommand: 'codex' };
    expect(resolveRightClick({ ...codex, platform: 'mac' })).toBe('menu');
    expect(resolveRightClick({ ...codex, platform: 'linux' })).toBe('menu');
  });

  it('shows the menu on mac/Linux for an unknown full-screen app too', () => {
    const vim = { bufferType: 'alternate' as const, mouseTrackingMode: 'none', title: 'vim' };
    expect(resolveRightClick({ ...vim, platform: 'mac' })).toBe('menu');
    expect(resolveRightClick({ ...vim, platform: 'linux' })).toBe('menu');
    // ...but passes it to the app on Windows.
    expect(resolveRightClick({ ...vim, platform: 'windows' })).toBe('passthrough');
  });
});

// Shell integration is the only signal that sees Codex or Gemini: both render inline
// in the normal buffer without taking the alternate screen or the mouse, and Codex
// sets no OSC title at all. Terminal-mode detection is blind to them by construction.
describe('resolveRightClick() with shell integration', () => {
  const WIN = { platform: 'windows' as const, title: '' };

  it.each(['claude', 'codex', 'gemini'])('pastes for %s via foreground command', (cmd) => {
    expect(resolveRightClick({ ...IDLE_SHELL, ...WIN, foregroundCommand: cmd })).toBe('paste');
  });

  // The whole point: Codex looks exactly like a shell prompt to mode detection.
  it('catches Codex even though it never takes the screen', () => {
    const state = { ...IDLE_SHELL, ...WIN, foregroundCommand: 'codex' };
    expect(isAppInControl(state)).toBe(false);   // invisible to mode detection
    expect(resolveRightClick(state)).toBe('paste'); // but caught anyway
  });

  it('shows the menu at the prompt (null command)', () => {
    expect(resolveRightClick({ ...IDLE_SHELL, ...WIN, foregroundCommand: null })).toBe('menu');
  });

  // An ordinary command must NOT suppress the menu just because it is running —
  // `git status` holds the foreground but does not take over the pane.
  it('keeps the menu for an ordinary command that does not take the screen', () => {
    expect(resolveRightClick({ ...IDLE_SHELL, ...WIN, foregroundCommand: 'git' })).toBe('menu');
  });

  it('passes through for an unprofiled app that DID take the screen', () => {
    const vim = { bufferType: 'alternate' as const, mouseTrackingMode: 'none', ...WIN, foregroundCommand: 'vim' };
    expect(resolveRightClick(vim)).toBe('passthrough');
  });

  // Falling back matters for cmd/wsl sessions and for anyone who opted out.
  it('falls back to title matching when no command is available', () => {
    const claudeByTitle = {
      bufferType: 'alternate' as const,
      mouseTrackingMode: 'any',
      title: '✳ Claude Code',
      platform: 'windows' as const,
      foregroundCommand: null,
    };
    expect(resolveRightClick(claudeByTitle)).toBe('paste');
  });

  it('is case-insensitive about the program name', () => {
    expect(resolveRightClick({ ...IDLE_SHELL, ...WIN, foregroundCommand: 'CODEX' })).toBe('paste');
  });
});
