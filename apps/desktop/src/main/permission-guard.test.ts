import { describe, expect, it } from 'vitest';
import { isAllowedPermission } from './permission-guard.js';

describe('isAllowedPermission', () => {
  it('allows clipboard-read', () => {
    expect(isAllowedPermission('clipboard-read')).toBe(true);
  });

  it('allows clipboard-sanitized-write', () => {
    expect(isAllowedPermission('clipboard-sanitized-write')).toBe(true);
  });

  it('denies camera', () => {
    expect(isAllowedPermission('media')).toBe(false);
  });

  it('denies notifications', () => {
    expect(isAllowedPermission('notifications')).toBe(false);
  });

  it('denies geolocation', () => {
    expect(isAllowedPermission('geolocation')).toBe(false);
  });

  it('denies an unrecognized permission string', () => {
    expect(isAllowedPermission('some-future-permission')).toBe(false);
  });
});
