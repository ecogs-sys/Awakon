import { describe, expect, it } from 'vitest';
import { RecentTabSchema, AppSettingsSchema, DEFAULT_APP_SETTINGS } from '@awakon/contracts';

describe('RecentTabSchema', () => {
  it('accepts a valid entry', () => {
    const ok = { title: 'my-project', cwd: '/home/me/proj', shell: 'zsh', closedAt: 1000 };
    expect(RecentTabSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects an unknown shell', () => {
    const bad = { title: 'x', cwd: '/tmp', shell: 'fish', closedAt: 1000 };
    expect(RecentTabSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a missing cwd', () => {
    const bad = { title: 'x', shell: 'bash', closedAt: 1000 };
    expect(RecentTabSchema.safeParse(bad).success).toBe(false);
  });
});

describe('AppSettingsSchema — recentTabs', () => {
  it('defaults recentTabs to an empty array when the field is absent', () => {
    const input = { autoResume: { enabled: false, detectText: '', responseText: '' } };
    const result = AppSettingsSchema.safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data?.recentTabs).toEqual([]);
  });

  it('accepts a settings object with a populated recentTabs list', () => {
    const input = {
      autoResume: { enabled: false, detectText: '', responseText: '' },
      recentTabs: [{ title: 'proj', cwd: '/tmp', shell: 'bash', closedAt: 9000 }],
    };
    expect(AppSettingsSchema.safeParse(input).success).toBe(true);
  });

  it('DEFAULT_APP_SETTINGS includes recentTabs as empty array', () => {
    expect(DEFAULT_APP_SETTINGS.recentTabs).toEqual([]);
  });
});
