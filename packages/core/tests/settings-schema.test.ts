import { describe, expect, it } from 'vitest';
import { AppSettingsSchema, DEFAULT_APP_SETTINGS } from '@awakon/contracts';

describe('AppSettingsSchema', () => {
  it('accepts the default settings', () => {
    expect(AppSettingsSchema.safeParse(DEFAULT_APP_SETTINGS).success).toBe(true);
  });

  it('rejects a missing autoResume block', () => {
    expect(AppSettingsSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-boolean enabled flag', () => {
    const bad = { autoResume: { enabled: 'yes', detectText: 'x', responseText: 'continue' } };
    expect(AppSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a detectText longer than 200 characters', () => {
    const bad = {
      autoResume: { enabled: true, detectText: 'x'.repeat(201), responseText: 'continue' },
    };
    expect(AppSettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts an empty detectText and empty responseText', () => {
    const ok = { autoResume: { enabled: false, detectText: '', responseText: '' } };
    expect(AppSettingsSchema.safeParse(ok).success).toBe(true);
  });

  it('defaults to enabled, matching Claude Code\'s rate-limit menu and selecting "wait"', () => {
    expect(DEFAULT_APP_SETTINGS.autoResume.enabled).toBe(true);
    expect(DEFAULT_APP_SETTINGS.autoResume.detectText).toBe('Stop and wait for limit to reset');
    expect(DEFAULT_APP_SETTINGS.autoResume.responseText).toBe('1');
  });
});
