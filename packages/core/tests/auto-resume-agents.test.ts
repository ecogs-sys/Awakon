import { describe, expect, it } from 'vitest';
import { AUTO_RESUME_AGENT_COMMANDS, isAutoResumeAgent } from '../src/auto-resume-agents.js';

describe('isAutoResumeAgent()', () => {
  it('matches Claude Code, which shows an answerable rate-limit menu', () => {
    expect(isAutoResumeAgent('claude')).toBe(true);
  });

  // Researched against the real binaries. Codex either self-switches model
  // ("Automatically switched to … due to usage limits") or hard-stops ("You've hit
  // your usage limit. Upgrade to Plus…"); Gemini self-downgrades ("Switching to the
  // … model for the rest of this session") or hard-stops ("Rate limit exceeded. Try
  // again later."). Neither leaves a prompt waiting, so typing at them would not
  // resume anything — they must NOT be armed.
  it.each(['codex', 'gemini'])('does not match %s (nothing to answer)', (cmd) => {
    expect(isAutoResumeAgent(cmd)).toBe(false);
  });

  it('is false at the prompt and when integration is unavailable', () => {
    expect(isAutoResumeAgent(null)).toBe(false);
    expect(isAutoResumeAgent(undefined)).toBe(false);
  });

  it('does not match ordinary commands', () => {
    expect(isAutoResumeAgent('git')).toBe(false);
    expect(isAutoResumeAgent('npm')).toBe(false);
  });

  it('exposes the agent set for inspection', () => {
    expect(AUTO_RESUME_AGENT_COMMANDS.has('claude')).toBe(true);
    expect(AUTO_RESUME_AGENT_COMMANDS.has('codex')).toBe(false);
  });
});
