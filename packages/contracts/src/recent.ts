import { z } from 'zod';
import { ShellSchema } from './session.js';

export const RecentTabSchema = z.object({
  title:    z.string().min(1),
  cwd:      z.string().min(1),
  shell:    ShellSchema,
  closedAt: z.number().int(),
});
export type RecentTab = z.infer<typeof RecentTabSchema>;
