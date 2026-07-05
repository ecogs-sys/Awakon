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

  it('defaults to disabled (opt-in), but preconfigured for Claude Code\'s rate-limit menu selecting "wait"', () => {
    expect(DEFAULT_APP_SETTINGS.autoResume.enabled).toBe(false);
    expect(DEFAULT_APP_SETTINGS.autoResume.detectText).toBe('Stop and wait for limit to reset');
    expect(DEFAULT_APP_SETTINGS.autoResume.responseText).toBe('1');
    expect(DEFAULT_APP_SETTINGS.autoResume.resumeText).toBe('continue');
  });

  it('defaults resumeText to "continue" (M6) so a persisted settings object saved before this field existed still parses', () => {
    const persistedBeforeM6 = {
      autoResume: { enabled: true, detectText: "You've hit your limit", responseText: '1' },
    };
    const parsed = AppSettingsSchema.safeParse(persistedBeforeM6);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.autoResume.resumeText).toBe('continue');
  });

  it('rejects a resumeText longer than 200 characters', () => {
    const bad = {
      autoResume: {
        enabled: true, detectText: 'x', responseText: '1', resumeText: 'x'.repeat(201),
      },
    };
    expect(AppSettingsSchema.safeParse(bad).success).toBe(false);
  });
});
