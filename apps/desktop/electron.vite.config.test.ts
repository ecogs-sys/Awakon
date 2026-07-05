import { describe, expect, it } from 'vitest';
import { devCspPlugin } from './electron.vite.config.js';

function transform(html: string): string {
  const plugin = devCspPlugin();
  const fn = plugin.transformIndexHtml as (html: string) => string;
  return fn(html);
}

describe('devCspPlugin (N10)', () => {
  it('relaxes connect-src to allow the HMR websocket in dev', () => {
    const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\';" />';
    const out = transform(html);
    expect(out).toContain("connect-src 'self' ws://localhost:* http://localhost:*;");
  });

  it('throws instead of silently no-opping when the CSP marker is absent (drifted policy)', () => {
    const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\' https://api.example;" />';
    expect(() => transform(html)).toThrow(/expected to find/);
  });

  it('only applies during dev serve, not build', () => {
    const plugin = devCspPlugin();
    expect(plugin.apply).toBe('serve');
  });
});
