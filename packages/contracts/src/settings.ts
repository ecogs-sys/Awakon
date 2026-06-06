import { z } from 'zod';
import { RecentTabSchema } from './recent.js';

/** Per-feature configuration for rate-limit auto-resume. */
export const AutoResumeSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Literal substring that marks a rate-limit message. Empty = feature inert. */
  detectText: z.string().max(200),
  /** Text typed (followed by Enter) into the tab when the limit resets. */
  responseText: z.string().max(200),
});
export type AutoResumeSettings = z.infer<typeof AutoResumeSettingsSchema>;

/** Top-level persisted application settings. */
export const AppSettingsSchema = z.object({
  autoResume:  AutoResumeSettingsSchema,
  defaultCwd:  z.string().default(''),
  recentTabs:  z.array(RecentTabSchema).max(10).default([]),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = Object.freeze({
  autoResume: Object.freeze({
    enabled: true,
    detectText: "You've hit your limit",
    responseText: 'continue',
  }),
  defaultCwd: '',
  recentTabs: Object.freeze([]) as unknown as AppSettings['recentTabs'],
});
