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
import { AttentionDetector } from './attention-detector.js';
import { RateLimitDetector } from './rate-limit-detector.js';
import { RingBuffer } from './ring-buffer.js';

export interface SessionEvents {
  data: (chunk: Buffer) => void;
  exit: (info: { exitCode: number | null; signal: string | null }) => void;
  titleChanged: (title: string) => void;
  attention: (ev: AttentionEvent) => void;
  rateLimitDetected: (resetText: string) => void;
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
    case 'git-bash': return 'bash.exe';
  }
}

/** xterm.js emits these when its DOM element gains/loses focus. They are not
 * user typing — treat them as transparent passthrough to the PTY. */
function isXtermFocusReport(data: string): boolean {
  return data === '\x1b[I' || data === '\x1b[O';
}

export class Session extends EventEmitter {
  readonly id: SessionId;
  readonly opts: SessionCreateOptions;
  readonly kind: SessionKind;
  readonly ringBuffer: RingBuffer;
  private readonly pty: pty.IPty;
  private readonly detector = new AttentionDetector();
  private readonly rateLimitDetector = new RateLimitDetector('');
  private _title: string;
  private _status: SessionStatus = 'starting';
  private _exitCode: number | null = null;
  private hasReceivedUserInput = false;

  constructor(id: SessionId, opts: SessionCreateOptions, kind: SessionKind = 'tab') {
    super();
    this.id = id;
    this.opts = opts;
    this.kind = kind;
    this.ringBuffer = new RingBuffer(DEFAULT_RING_CAPACITY);
    this._title = opts.title ?? shellCommand(opts.shell);

    this.pty = pty.spawn(shellCommand(opts.shell), [], {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
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

    this.pty.onData((data: string) => {
      // node-pty delivers a decoded string; re-encode to Buffer for the ring buffer + downstream consumers.
      const buf = Buffer.from(data, 'utf8');
      this.ringBuffer.write(buf);
      this.detector.process(buf);
      this.rateLimitDetector.process(buf);
      this.emit('data', buf);
    });

    this.pty.onExit(({ exitCode, signal }) => {
      this._status = 'exited';
      this._exitCode = exitCode;
      // The session is done — clear the detector's pending idle timer.
      this.detector.dispose();
      this.rateLimitDetector.dispose();
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
    }
    this.pty.write(str);
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

  setTitle(title: string): void {
    if (this._title === title) return;
    this._title = title;
    this.emit('titleChanged', title);
  }

  /** Update the rate-limit phrase scanned in this session's output. Empty = off. */
  setRateLimitDetectText(text: string): void {
    this.rateLimitDetector.setDetectText(text);
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
    };
  }
}

export interface Session {
  on<K extends keyof SessionEvents>(event: K, listener: SessionEvents[K]): this;
  emit<K extends keyof SessionEvents>(event: K, ...args: Parameters<SessionEvents[K]>): boolean;
}
