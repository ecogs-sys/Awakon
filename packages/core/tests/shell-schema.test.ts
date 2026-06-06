import { describe, expect, it } from 'vitest';
import { ShellSchema } from '@awakon/contracts';

describe('ShellSchema', () => {
  it('accepts existing shells', () => {
    for (const shell of ['pwsh', 'powershell', 'cmd', 'bash', 'zsh', 'wsl'] as const) {
      expect(ShellSchema.safeParse(shell).success).toBe(true);
    }
  });

  it('accepts git-bash', () => {
    expect(ShellSchema.safeParse('git-bash').success).toBe(true);
  });

  it('rejects unknown shells', () => {
    expect(ShellSchema.safeParse('fish').success).toBe(false);
    expect(ShellSchema.safeParse('').success).toBe(false);
  });
});
