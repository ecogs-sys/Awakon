import { z } from 'zod';
import { ShellSchema } from './session.js';

export const RecentTabSchema = z.object({
  title:    z.string(),
  cwd:      z.string(),
  shell:    ShellSchema,
  closedAt: z.number().int(),
});
export type RecentTab = z.infer<typeof RecentTabSchema>;
