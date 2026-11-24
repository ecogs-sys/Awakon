import { describe, expect, it } from 'vitest';
import { shellIntegrationSpawn, encodePwshCommand } from '../src/shell-integration-spawn.js';
import { PWSH_SHELL_INTEGRATION } from '../src/shell-integration/pwsh.js';

describe('shellIntegrationSpawn()', () => {
  it('injects pwsh via -NoExit -EncodedCommand', () => {
    const spawn = shellIntegrationSpawn('pwsh');
    expect(spawn).not.toBeNull();
    expect(spawn!.args[0]).toBe('-NoExit');
    expect(spawn!.args[1]).toBe('-EncodedCommand');
    expect(spawn!.args).toHaveLength(3);
  });

  it('uses the same mechanism for Windows PowerShell', () => {
    expect(shellIntegrationSpawn('powershell')?.args[1]).toBe('-EncodedCommand');
  });

  // Not a .ps1 path: ExecutionPolicy blocks loading script files on a default Windows
  // install, which is the whole reason the script is injected as encoded source.
  it('passes encoded source, never a file path', () => {
    const args = shellIntegrationSpawn('pwsh')!.args;
    expect(args.join(' ')).not.toMatch(/\.ps1/);
    const decoded = Buffer.from(args[2]!, 'base64').toString('utf16le');
    expect(decoded).toContain('133;A');
    expect(decoded).toContain('awakonCommand');
  });

  it('round-trips the integration source through the encoding', () => {
    const decoded = Buffer.from(encodePwshCommand(PWSH_SHELL_INTEGRATION), 'base64').toString('utf16le');
    expect(decoded).toBe(PWSH_SHELL_INTEGRATION);
  });

  // cmd has no prompt hook or init-file mechanism; wsl's processes live in a separate
  // Linux PID namespace. Both degrade to terminal-mode detection rather than breaking.
  it.each(['cmd', 'wsl'] as const)('returns null for %s (cannot be instrumented)', (shell) => {
    expect(shellIntegrationSpawn(shell)).toBeNull();
  });

  // Phase 3 — absent rather than half-working until their scripts land.
  it.each(['bash', 'zsh', 'git-bash'] as const)('returns null for %s (not yet implemented)', (shell) => {
    expect(shellIntegrationSpawn(shell)).toBeNull();
  });
});

describe('PWSH_SHELL_INTEGRATION', () => {
  it('defines ESC and BEL (without them every marker emits empty)', () => {
    expect(PWSH_SHELL_INTEGRATION).toMatch(/\$ESC\s*=\s*\[char\]27/);
    expect(PWSH_SHELL_INTEGRATION).toMatch(/\$BEL\s*=\s*\[char\]7/);
  });

  it('reads $? before anything else can clobber it', () => {
    const body = PWSH_SHELL_INTEGRATION.slice(PWSH_SHELL_INTEGRATION.indexOf('function global:prompt'));
    const firstStatement = body.split('\n').find((l) => l.trim() && !l.includes('function') && !l.trim().startsWith('#'));
    expect(firstStatement).toContain('$lastSucceeded = $?');
  });

  it('wraps the existing prompt instead of replacing it', () => {
    expect(PWSH_SHELL_INTEGRATION).toContain('$global:__awakonOrigPrompt');
    expect(PWSH_SHELL_INTEGRATION).toContain('& $global:__awakonOrigPrompt');
  });

  it('is idempotent — a second injection must not wrap the wrapper', () => {
    expect(PWSH_SHELL_INTEGRATION).toContain("Test-Path variable:global:__awakonOrigPrompt");
    expect(PWSH_SHELL_INTEGRATION).toContain("Test-Path variable:global:__awakonOrigReadLine");
  });

  it('builds the cwd URI via .NET so paths are percent-encoded', () => {
    expect(PWSH_SHELL_INTEGRATION).toContain('[uri]$PWD.ProviderPath).AbsoluteUri');
  });

  it('guards PSReadLine being absent', () => {
    expect(PWSH_SHELL_INTEGRATION).toContain('Get-Command PSConsoleHostReadLine -ErrorAction SilentlyContinue');
  });
});
