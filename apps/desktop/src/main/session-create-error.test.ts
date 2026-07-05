import { describe, expect, it } from 'vitest';
import { formatSessionCreateError } from './session-create-error.js';

describe('formatSessionCreateError', () => {
  it('names the shell the user picked and includes the underlying error (B3)', () => {
    // A certification tester (or any user) on a clean machine picks a shell that
    // doesn't exist and must see *which* shell failed and why, not a dead tab with
    // only a devtools console.error.
    const { title, message } = formatSessionCreateError('wsl', new Error('spawn wsl.exe ENOENT'));
    expect(title).toBe('Could not start session');
    expect(message).toContain('wsl');
    expect(message).toContain('spawn wsl.exe ENOENT');
  });

  it('stringifies a non-Error throw', () => {
    const { message } = formatSessionCreateError('cmd', 'boom');
    expect(message).toContain('boom');
  });
});
