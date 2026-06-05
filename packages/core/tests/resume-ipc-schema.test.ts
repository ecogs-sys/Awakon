import { describe, expect, it } from 'vitest';
import {
  IpcChannel,
  ResumeCancelPayloadSchema,
  ResumeScheduledEventSchema,
} from '@awakon/contracts';

describe('resume + settings IPC contracts', () => {
  it('exposes the new channel names', () => {
    expect(IpcChannel.SettingsGet).toBe('core.settings.get');
    expect(IpcChannel.SettingsUpdate).toBe('core.settings.update');
    expect(IpcChannel.ResumeCancel).toBe('core.resume.cancel');
    expect(IpcChannel.SettingsChanged).toBe('event.settings.changed');
    expect(IpcChannel.ResumeScheduled).toBe('event.resume.scheduled');
    expect(IpcChannel.ResumeCancelled).toBe('event.resume.cancelled');
    expect(IpcChannel.ResumeFired).toBe('event.resume.fired');
  });

  it('validates a resume-cancel payload', () => {
    expect(ResumeCancelPayloadSchema.safeParse({ sessionId: 'abc' }).success).toBe(true);
    expect(ResumeCancelPayloadSchema.safeParse({ sessionId: '' }).success).toBe(false);
  });

  it('validates a resume-scheduled event', () => {
    expect(ResumeScheduledEventSchema.safeParse({ sessionId: 'a', resetAt: 1_700_000_000_000 }).success).toBe(true);
    expect(ResumeScheduledEventSchema.safeParse({ sessionId: 'a', resetAt: 'soon' }).success).toBe(false);
  });
});
