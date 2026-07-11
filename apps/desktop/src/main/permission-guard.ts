/**
 * The terminal's clipboard context menu (split-container.ts) uses the async clipboard
 * API, which Chromium gates behind these two permissions. Everything else in this app
 * (camera/mic/geolocation/notifications/etc.) must stay denied — see the deny-all
 * rationale at index.ts's web-contents-created handler.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write']);

export function isAllowedPermission(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}
