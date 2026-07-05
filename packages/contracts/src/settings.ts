import { z } from 'zod';
import { RecentTabSchema } from './recent.js';

/** Per-feature configuration for rate-limit auto-resume. */
export const AutoResumeSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Literal substring that marks a rate-limit message. Empty = feature inert. */
  detectText: z.string().max(200),
  /** Text typed (followed by Enter) into the tab when the limit resets. */
  responseText: z.string().max(200),
  /** Stage 2 (M6): text typed (followed by Enter) once the reset time has passed, to
   * nudge the session in case Claude Code did not already self-resume. `.default` keeps
   * existing users' persisted settings parsing without a migration. */
  resumeText: z.string().max(200).default('continue'),
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
    // Claude Code shows an interactive menu on hitting the session limit:
    //   1. Stop and wait for limit to reset   2. Upgrade your plan
    // Matching the option-1 label fires only when that actionable menu is on
    // screen (not on the "used NN% of your session limit" warnings, nor on
    // nested subagent result lines). responseText '1' selects option 1, which
    // makes Claude wait and resume itself when the limit resets.
    //
    // Off by default (M7): RateLimitDetector scans ALL PTY output, so any program
    // that happens to print this phrase — cat of a file, a log line, a remote
    // command's output — would make the app type responseText into that session.
    // Users opt in from Settings once they understand the trade-off.
    enabled: false,
    detectText: 'Stop and wait for limit to reset',
    responseText: '1',
    resumeText: 'continue',
  }),
  defaultCwd: '',
  recentTabs: Object.freeze([]) as unknown as AppSettings['recentTabs'],
});
