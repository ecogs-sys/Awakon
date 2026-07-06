import { z } from 'zod';

export const SessionIdSchema = z.string().min(1);
export type SessionId = z.infer<typeof SessionIdSchema>;

export const SessionStatusSchema = z.enum([
  'starting',
  'running',
  'awaiting-input',
  'exited',
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const ShellSchema = z.enum(['pwsh', 'powershell', 'cmd', 'bash', 'zsh', 'wsl', 'git-bash']);
export type Shell = z.infer<typeof ShellSchema>;

/** Whether a session backs a top-level tab or a pane inside a split tab. The chrome
 * renderer only renders tabs; pane sessions are owned by a tab's terminal renderer. */
export const SessionKindSchema = z.enum(['tab', 'pane']);
export type SessionKind = z.infer<typeof SessionKindSchema>;

export const SessionCreateOptionsSchema = z.object({
  shell: ShellSchema,
  cwd: z.string().min(1),
  title: z.string().min(1).optional(),
  cols: z.number().int().positive().default(80),
  rows: z.number().int().positive().default(24),
});
export type SessionCreateOptions = z.infer<typeof SessionCreateOptionsSchema>;

export const SessionInfoSchema = z.object({
  id: SessionIdSchema,
  title: z.string(),
  shell: ShellSchema,
  cwd: z.string(),
  status: SessionStatusSchema,
  kind: SessionKindSchema,
  pid: z.number().int().nullable(),
  exitCode: z.number().int().nullable(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

/** Maximum length of an attention event's snippet field. Shared between the producer
 * (AttentionDetector OSC payload accumulator) and the schema validator so the two never
 * diverge. Increase here to relax both. */
export const ATTENTION_SNIPPET_MAX_LEN = 256;

export const AttentionSignalSchema = z.enum(['bell', 'idle', 'osc']);
export type AttentionSignal = z.infer<typeof AttentionSignalSchema>;

export const AttentionEventSchema = z.object({
  sessionId: SessionIdSchema,
  signal: AttentionSignalSchema,
  confidence: z.number().min(0).max(1),
  snippet: z.string().max(ATTENTION_SNIPPET_MAX_LEN).optional(),
  timestamp: z.number().int(),
});
export type AttentionEvent = z.infer<typeof AttentionEventSchema>;

export const TabIdSchema = z.string().min(1);
export type TabId = z.infer<typeof TabIdSchema>;
