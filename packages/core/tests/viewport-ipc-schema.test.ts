import { describe, expect, it } from 'vitest';
import { IpcChannel, LayoutViewportSizePayloadSchema } from '@awakon/contracts';

describe('viewport IPC channel', () => {
  it('exposes the new channel name', () => {
    expect(IpcChannel.LayoutViewportSize).toBe('core.layout.viewport-size');
  });
});

describe('LayoutViewportSizePayloadSchema', () => {
  it('accepts non-negative integer width and height', () => {
    expect(LayoutViewportSizePayloadSchema.safeParse({ width: 1280, height: 720 }).success).toBe(
      true,
    );
    expect(LayoutViewportSizePayloadSchema.safeParse({ width: 0, height: 0 }).success).toBe(true);
  });

  it('rejects negative dimensions', () => {
    expect(LayoutViewportSizePayloadSchema.safeParse({ width: -1, height: 720 }).success).toBe(
      false,
    );
    expect(LayoutViewportSizePayloadSchema.safeParse({ width: 1280, height: -1 }).success).toBe(
      false,
    );
  });

  it('rejects non-integer dimensions', () => {
    expect(LayoutViewportSizePayloadSchema.safeParse({ width: 1280.5, height: 720 }).success).toBe(
      false,
    );
  });

  it('rejects missing or non-numeric keys', () => {
    expect(LayoutViewportSizePayloadSchema.safeParse({ width: 1280 }).success).toBe(false);
    expect(LayoutViewportSizePayloadSchema.safeParse({ width: '1280', height: 720 }).success).toBe(
      false,
    );
    expect(LayoutViewportSizePayloadSchema.safeParse({}).success).toBe(false);
  });
});
