import { describe, expect, it } from 'vitest';
import { ChromeOpenExternalPayloadSchema, isHttpUrl } from '@awakon/contracts';

describe('isHttpUrl (C2)', () => {
  it('accepts http and https URLs', () => {
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('https://example.com')).toBe(true);
  });

  it('rejects other schemes', () => {
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpUrl('smb://server/share')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });
});

describe('ChromeOpenExternalPayloadSchema (C2)', () => {
  it('accepts an http(s) URL', () => {
    expect(ChromeOpenExternalPayloadSchema.safeParse({ url: 'https://example.com' }).success).toBe(true);
  });

  it('rejects a well-formed non-http(s) URL (M3 boundary lives in the schema now)', () => {
    expect(ChromeOpenExternalPayloadSchema.safeParse({ url: 'file:///etc/passwd' }).success).toBe(false);
  });

  it('rejects a malformed URL', () => {
    expect(ChromeOpenExternalPayloadSchema.safeParse({ url: 'not a url' }).success).toBe(false);
  });
});
