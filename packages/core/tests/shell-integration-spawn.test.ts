import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { shellIntegrationSpawn, encodePwshCommand } from '../src/shell-integration-spawn.js';
import { PWSH_SHELL_INTEGRATION } from '../src/shell-integration/pwsh.js';
import { BASH_SHELL_INTEGRATION } from '../src/shell-integration/bash.js';
import { ZSH_SHELL_INTEGRATION } from '../src/shell-integration/zsh.js';

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

  it.each(['bash', 'git-bash'] as const)('injects %s via --init-file', (shell) => {
    const spawn = shellIntegrationSpawn(shell);
    expect(spawn?.args[0]).toBe('--init-file');
    const path = spawn!.args[1]!;
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain('133;C');
  });

  // --init-file REPLACES ~/.bashrc. Forgetting to source the user's rc would silently
  // drop their aliases, prompt and exports the moment they open Awakon.
  it('sources the user bashrc before anything else', () => {
    const path = shellIntegrationSpawn('bash')!.args[1]!;
    const body = readFileSync(path, 'utf8');
    const sourceLine = body.indexOf('$HOME/.bashrc');
    const firstHook = body.indexOf('__awakon_osc()');
    expect(sourceLine).toBeGreaterThan(-1);
    expect(sourceLine).toBeLessThan(firstHook);
  });

  it('injects zsh via ZDOTDIR with a .zshrc', () => {
    const spawn = shellIntegrationSpawn('zsh');
    expect(spawn?.args).toEqual([]);
    const dir = spawn!.env!['ZDOTDIR']!;
    expect(existsSync(join(dir, '.zshrc'))).toBe(true);
    expect(readFileSync(join(dir, '.zshrc'), 'utf8')).toContain('add-zsh-hook preexec');
  });

  it('forwards an existing ZDOTDIR so the user rc can still be found', () => {
    const prev = process.env['ZDOTDIR'];
    process.env['ZDOTDIR'] = '/home/dines/zdot';
    try {
      expect(shellIntegrationSpawn('zsh')!.env!['AWAKON_USER_ZDOTDIR']).toBe('/home/dines/zdot');
    } finally {
      if (prev === undefined) delete process.env['ZDOTDIR']; else process.env['ZDOTDIR'] = prev;
    }
  });

  it('reuses one temp file rather than writing per session', () => {
    const a = shellIntegrationSpawn('bash')!.args[1];
    const b = shellIntegrationSpawn('bash')!.args[1];
    expect(a).toBe(b);
  });
});

describe('POSIX integration scripts', () => {
  it('bash collapses the DEBUG trap to one report per command line', () => {
    // DEBUG fires for every simple command, including inside PROMPT_COMMAND.
    expect(BASH_SHELL_INTEGRATION).toContain('__awakon_at_prompt');
    expect(BASH_SHELL_INTEGRATION).toContain('[ -n "$COMP_LINE" ] && return');
  });

  // Regression: starting armed made the trap fire on the rest of the init script
  // itself, reporting `case` as the foreground program before the user typed anything.
  it('bash starts the DEBUG guard disarmed', () => {
    expect(BASH_SHELL_INTEGRATION).toContain('__awakon_at_prompt=0');
    expect(BASH_SHELL_INTEGRATION).not.toMatch(/^__awakon_at_prompt=1$/m);
  });

  it('bash reads $? as the first statement of precmd', () => {
    const precmd = BASH_SHELL_INTEGRATION.slice(BASH_SHELL_INTEGRATION.indexOf('__awakon_precmd() {'));
    const first = precmd.split('\n').slice(1).find((l) => l.trim() && !l.trim().startsWith('#'));
    expect(first).toContain('local __awakon_exit=$?');
  });

  it('bash prepends to PROMPT_COMMAND without clobbering it', () => {
    expect(BASH_SHELL_INTEGRATION).toContain('PROMPT_COMMAND="__awakon_precmd;$PROMPT_COMMAND"');
  });

  it('zsh restores the real ZDOTDIR and sources the user rc', () => {
    expect(ZSH_SHELL_INTEGRATION).toContain('ZDOTDIR="$__awakon_user_zdotdir"');
    expect(ZSH_SHELL_INTEGRATION).toContain('.zshrc"');
  });

  it.each([
    ['bash', BASH_SHELL_INTEGRATION],
    ['zsh', ZSH_SHELL_INTEGRATION],
  ])('%s escapes %% before introducing its own escapes', (_name, script) => {
    const enc = script.slice(script.indexOf('__awakon_encode_path'));
    expect(enc.indexOf('%25')).toBeLessThan(enc.indexOf('%20'));
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
