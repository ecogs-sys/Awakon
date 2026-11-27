import { EventEmitter } from 'node:events';
import * as pty from 'node-pty';
import type {
  AttentionEvent,
  SessionCreateOptions,
  SessionId,
  SessionInfo,
  SessionKind,
  SessionStatus,
} from '@awakon/contracts';
import { cwdBasename } from '@awakon/contracts';
import { AttentionDetector } from './attention-detector.js';
import { RateLimitDetector } from './rate-limit-detector.js';
import { RingBuffer } from './ring-buffer.js';
import { ShellIntegrationDetector } from './shell-integration-detector.js';
import { shellIntegrationSpawn } from './shell-integration-spawn.js';
import { resolveGitBashPath } from './resolve-git-bash.js';

export interface SessionEvents {
  data: (chunk: Buffer) => void;
  exit: (info: { exitCode: number | null; signal: string | null }) => void;
  titleChanged: (title: string) => void;
  attention: (ev: AttentionEvent) => void;
  rateLimitDetected: (resetText: string) => void;
  /** The program running in the foreground changed — null when back at the prompt.
   *  Only ever the program NAME, never the argument tail (see setForegroundCommand). */
  foregroundCommandChanged: (command: string | null) => void;
}

/** Per-session options that are not part of the create payload. */
export interface SessionRuntimeOptions {
  /** Overrides AttentionDetector's idle window — for tests only (C9). */
  idleAttentionMs?: number;
  /** False disables shell-integration injection for this session (settings opt-out).
   *  Defaults to true. */
  shellIntegration?: boolean;
}

const DEFAULT_RING_CAPACITY = 256 * 1024; // ~256 KB ≈ 5,000 lines

function shellCommand(shell: SessionCreateOptions['shell']): string {
  switch (shell) {
    case 'pwsh': return 'pwsh.exe';
    case 'powershell': return 'powershell.exe';
    case 'cmd': return 'cmd.exe';
    case 'bash': return 'bash';
    case 'zsh': return 'zsh';
    case 'wsl': return 'wsl.exe';
    // NOT the bare name: System32\bash.exe is the WSL launcher, and PATH order decides
    // which one wins. In the packaged app System32 won, so git-bash sessions started
    // WSL and died instantly. See resolve-git-bash.ts.
    case 'git-bash': return resolveGitBashPath();
  }
}

/**
 * First token of a command line, stripped of any path and extension, lowercased:
 *   `claude --continue`                  -> 'claude'
 *   `"C:\Program Files\x\codex.exe" -v`  -> 'codex'
 * Returns null for a blank line (bare Enter at the prompt).
 */
export function programName(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // Honour a quoted first token so paths containing spaces survive.
  const quoted = /^"([^"]+)"/.exec(trimmed) ?? /^'([^']+)'/.exec(trimmed);
  const first = quoted ? quoted[1]! : trimmed.split(/\s+/)[0]!;
  const base = first.split(/[\\/]/).pop() ?? first;
  return base.replace(/\.(exe|cmd|bat|ps1|sh)$/i, '').toLowerCase() || null;
}

/** xterm.js emits these when its DOM element gains/loses focus. They are not
 * user typing — treat them as transparent passthrough to the PTY. */
function isXtermFocusReport(data: string): boolean {
  return data === '\x1b[I' || data === '\x1b[O';
}

export class Session extends EventEmitter {
  readonly id: SessionId;
  readonly opts: SessionCreateOptions;
  /** Not readonly: promoteToTab() flips a pane session to tab role when H2's reparent
   * makes it a tab's new primary — the role can change after creation, the identity can't. */
  kind: SessionKind;
  readonly ringBuffer: RingBuffer;
  private readonly pty: pty.IPty;
  private readonly detector: AttentionDetector;
  private readonly rateLimitDetector = new RateLimitDetector('');
  private readonly shellIntegrationDetector = new ShellIntegrationDetector();
  /** True when this session was spawned with integration hooks installed. */
  readonly shellIntegrationEnabled: boolean = false;
  /** Program name currently in the foreground, or null at the prompt. */
  private _foregroundCommand: string | null = null;
  /** Live cwd as reported by the shell (OSC 7). Falls back to the launch cwd.
   *  Deliberately NOT used for tab labels — those stay on the launch folder. */
  private _liveCwd: string | null = null;
  private _title: string;
  private _status: SessionStatus = 'starting';
  private _exitCode: number | null = null;
  private hasReceivedUserInput = false;
  /** Epoch ms of the last real (non-synthetic, non-focus-report) user write. Lets
   * SessionManager drop a scheduled auto-resume if the user has actually engaged with
   * the session since it was scheduled (A4-I5) — firing a synthetic "continue" over
   * someone's live typing would be surprising and possibly disruptive. */
  private lastUserInputAt = 0;

  /** `runtime` carries test overrides and the shell-integration opt-out. The legacy
   *  number form is still accepted so existing callers/tests keep working. */
  constructor(
    id: SessionId,
    opts: SessionCreateOptions,
    kind: SessionKind = 'tab',
    runtime?: number | SessionRuntimeOptions,
  ) {
    super();
    const runtimeOpts: SessionRuntimeOptions =
      typeof runtime === 'number' ? { idleAttentionMs: runtime } : (runtime ?? {});
    this.id = id;
    this.opts = opts;
    this.kind = kind;
    this.detector = new AttentionDetector(runtimeOpts.idleAttentionMs);
    this.ringBuffer = new RingBuffer(DEFAULT_RING_CAPACITY);
    this._title = opts.title ?? cwdBasename(opts.cwd);

    // Shell integration: extra spawn args that install the OSC-marker hooks. Null when
    // the shell cannot be instrumented (cmd, wsl) or the user opted out — in which case
    // the session simply spawns bare and app detection falls back to terminal modes.
    const integration =
      runtimeOpts.shellIntegration === false ? null : shellIntegrationSpawn(opts.shell);
    this.shellIntegrationEnabled = integration !== null;

    this.pty = pty.spawn(shellCommand(opts.shell), integration?.args ?? [], {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      // Integration env (zsh's ZDOTDIR) layers over the inherited environment.
      env: { ...process.env, ...(integration?.env ?? {}) },
    });
    this._status = 'running';

    this.detector.on('attention', (ev) => {
      // A shell the user has never spoken to cannot legitimately be asking for
      // attention. At app boot the restored panes emit prompts (idle), banner
      // chimes (bell), or startup escapes that the user did not ask for — none
      // are actionable until they have actually engaged with the session.
      if (!this.hasReceivedUserInput) return;
      // Detector emits with sessionId='__pending__'; rewrite with our real id.
      this._status = 'awaiting-input';
      this.emit('attention', { ...ev, sessionId: this.id });
    });

    this.rateLimitDetector.on('rateLimitDetected', (resetText) => {
      this.emit('rateLimitDetected', resetText);
    });

    // Shell integration: a submitted command puts a program in the foreground; the
    // next prompt means it finished and we are idle again.
    this.shellIntegrationDetector.on('commandStart', (line) => {
      this.setForegroundCommand(line);
    });
    this.shellIntegrationDetector.on('promptStart', () => {
      this.setForegroundCommand(null);
    });
    this.shellIntegrationDetector.on('cwdChanged', (cwd) => {
      this._liveCwd = cwd;
    });

    this.pty.onData((data: string) => {
      // node-pty delivers a decoded string; re-encode to Buffer for the ring buffer + downstream consumers.
      const buf = Buffer.from(data, 'utf8');
      this.ringBuffer.write(buf);
      this.detector.process(buf);
      this.rateLimitDetector.process(buf);
      this.shellIntegrationDetector.process(buf);
      this.emit('data', buf);
    });

    this.pty.onExit(({ exitCode, signal }) => {
      this._status = 'exited';
      this._exitCode = exitCode;
      // The session is done — clear the detector's pending idle timer.
      this.detector.dispose();
      this.rateLimitDetector.dispose();
      this.shellIntegrationDetector.dispose();
      this.emit('exit', { exitCode, signal: signal != null ? String(signal) : null });
    });
  }

  /** `synthetic: true` marks a write main generated on the user's behalf (currently
   * only the auto-resume response) rather than something they typed. Synthetic
   * writes must not unlock the attention gate (L1) — a restored session the user
   * never touched would otherwise start emitting attention notifications the
   * instant auto-resume fires, defeating the point of the gate. */
  write(data: Buffer | string, opts?: { synthetic?: boolean }): void {
    if (this._status === 'exited') return;
    // Any user input clears the awaiting-input state.
    if (this._status === 'awaiting-input') this._status = 'running';
    const str = typeof data === 'string' ? data : data.toString('utf8');
    // Record that the user has spoken to this session, so the attention gate
    // can release. Focus-in/out reports (ESC[I / ESC[O) reach this method
    // through term.onData when xterm's DOM element gains or loses focus —
    // they must reach the PTY (apps like vim use them) but must not count as
    // user typing, otherwise opening the app and clicking elsewhere would
    // unlock the gate for every session.
    if (str.length > 0 && !isXtermFocusReport(str) && !opts?.synthetic) {
      this.hasReceivedUserInput = true;
      this.lastUserInputAt = Date.now();
    }
    this.pty.write(str);
  }

  /** Epoch ms of the last real user write, or 0 if there has never been one. */
  getLastUserInputAt(): number {
    return this.lastUserInputAt;
  }

  resize(cols: number, rows: number): void {
    if (this._status === 'exited') return;
    this.pty.resize(cols, rows);
  }

  kill(signal: 'SIGHUP' | 'SIGTERM' | 'SIGKILL' = 'SIGHUP'): void {
    if (this._status === 'exited') return;
    // node-pty's Windows backend throws "Signals not supported on windows." if any
    // signal string is passed. On Windows, call kill() with no argument which
    // triggers the ConPTY-based teardown path instead.
    if (process.platform === 'win32') {
      this.pty.kill();
    } else {
      this.pty.kill(signal);
    }
  }

  /** Program name currently in the foreground, or null when sitting at the prompt. */
  get foregroundCommand(): string | null {
    return this._foregroundCommand;
  }

  /** Live cwd reported by the shell, falling back to the launch cwd when shell
   *  integration is unavailable or has not reported yet. */
  get cwd(): string {
    return this._liveCwd ?? this.opts.cwd;
  }

  /**
   * Record the foreground program from a submitted command line.
   *
   * Only the first token is kept. Command lines routinely carry secrets
   * (`$env:TOKEN='…'`, `curl -H "Authorization: …"`), and this value is broadcast over
   * IPC and held in memory — the argument tail is never needed, since consumers match
   * on the program name. Dropping it here means the secret-bearing part is discarded at
   * the earliest possible point rather than trusted not to leak downstream.
   */
  private setForegroundCommand(line: string | null): void {
    const name = line === null ? null : programName(line);
    if (this._foregroundCommand === name) return;
    this._foregroundCommand = name;
    this.emit('foregroundCommandChanged', name);
  }

  setTitle(title: string): void {
    if (this._title === title) return;
    this._title = title;
    this.emit('titleChanged', title);
  }

  /** Update the rate-limit phrase scanned in this session's output. Empty = off. */
  setRateLimitDetectText(text: string): void {
    this.rateLimitDetector.setDetectText(text);
  }

  /** A pane promoted to be its tab's new primary (H2 reparent) must report kind
   * 'tab' from then on — otherwise a fresh chrome bootstrap (or any other
   * SessionManager.list() consumer) filters it out as a pane (N3). */
  promoteToTab(): void {
    this.kind = 'tab';
  }

  info(): SessionInfo {
    return {
      id: this.id,
      title: this._title,
      shell: this.opts.shell,
      cwd: this.opts.cwd,
      status: this._status,
      kind: this.kind,
      pid: this.pty.pid,
      exitCode: this._exitCode,
      foregroundCommand: this._foregroundCommand,
    };
  }
}

export interface Session {
  on<K extends keyof SessionEvents>(event: K, listener: SessionEvents[K]): this;
  emit<K extends keyof SessionEvents>(event: K, ...args: Parameters<SessionEvents[K]>): boolean;
}
