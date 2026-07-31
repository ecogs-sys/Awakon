import type { Shell } from '@awakon/contracts';
import { IpcChannel } from '@awakon/contracts';

export interface NewSessionResult {
  shell: Shell;
  cwd: string;
}

export interface NewSessionDialogOptions {
  defaultShell: Shell;
  defaultCwd: string;
}

interface Bridge {
  send: (channel: string, payload?: unknown) => Promise<unknown>;
}

interface State {
  shell: Shell;
  cwd: string;
  error: string | null;
}

/**
 * Show the redesigned New Session dialog. Resolves with the user's choice, or
 * null if they cancel. Re-uses a single mount element — opening twice doesn't
 * stack modals.
 */
export function showNewSessionDialog(
  mount: HTMLElement,
  opts: NewSessionDialogOptions,
): Promise<NewSessionResult | null> {
  return new Promise((resolve) => {
    mount.innerHTML = '';
    mount.classList.add('open');

    const state: State = {
      shell: opts.defaultShell,
      cwd: opts.defaultCwd,
      error: null,
    };

    const root = document.createElement('div');
    root.className = 'aip-modal aip-modal--newsession';
    root.innerHTML = `
      <div class="aip-modal__header">
        <div class="aip-modal__header-left">
          <span class="aip-modal__crumb">New session</span>
          <span class="aip-modal__crumb-dot"></span>
          <span class="aip-modal__title">Configure</span>
        </div>
        <button class="aip-modal__close" id="ns-close" title="Close" type="button">×</button>
      </div>
      <div class="aip-modal__body"></div>
      <div class="aip-modal__footer">
        <div class="aip-modal__footer-hint">Press Enter to start  ·  Esc to cancel</div>
        <div class="aip-modal__footer-actions">
          <button class="aip-btn aip-btn--ghost"   id="ns-cancel" type="button">Cancel</button>
          <button class="aip-btn aip-btn--primary" id="ns-start"  type="button">Start session</button>
        </div>
      </div>
    `;
    mount.appendChild(root);

    const bridge = (window as unknown as { awakon: Bridge }).awakon;
    const body = root.querySelector<HTMLDivElement>('.aip-modal__body')!;

    // ── Working directory section ───────────────────────────────────
    const wdSection = document.createElement('div');
    wdSection.className = 'aip-modal__section';
    wdSection.innerHTML = `
      <div class="aip-label">Working directory</div>
      <div class="aip-path-input">
        <div class="aip-path-input__field" id="ns-cwd-field"></div>
        <button class="aip-path-input__browse" id="ns-browse" type="button">
          <span>🗁</span><span>Browse…</span>
        </button>
      </div>
      <div class="aip-cwd-error" id="ns-cwd-error" hidden></div>
    `;
    body.appendChild(wdSection);

    const pathInput = wdSection.querySelector<HTMLDivElement>('.aip-path-input')!;
    const pathField = wdSection.querySelector<HTMLDivElement>('#ns-cwd-field')!;
    const errEl = wdSection.querySelector<HTMLDivElement>('#ns-cwd-error')!;

    function clearError(): void {
      if (state.error === null) return;
      state.error = null;
      pathInput.classList.remove('aip-path-input--invalid');
      errEl.hidden = true;
    }

    function showError(msg: string): void {
      state.error = msg;
      pathInput.classList.add('aip-path-input--invalid');
      errEl.textContent = msg;
      errEl.hidden = false;
    }

    function splitPath(p: string): { head: string; tail: string } {
      const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
      if (idx < 0) return { head: '', tail: p };
      return { head: p.slice(0, idx + 1), tail: p.slice(idx + 1) };
    }

    function renderDisplay(): void {
      const { head, tail } = splitPath(state.cwd);
      pathField.replaceChildren();
      if (head) {
        const dim = document.createElement('span');
        dim.className = 'dim';
        dim.textContent = head;
        pathField.appendChild(dim);
      }
      pathField.append(tail);
    }

    function renderEdit(opts: { focus: boolean; select?: boolean }): void {
      pathField.replaceChildren();
      const input = document.createElement('input');
      input.type = 'text';
      input.value = state.cwd;
      input.addEventListener('input', () => {
        state.cwd = input.value;
        clearError();
        startBtn.disabled = state.cwd.trim().length === 0;
      });
      input.addEventListener('blur', () => {
        if (state.cwd.trim().length === 0) {
          // Stay in edit state if empty — display state of "" is jarring.
          return;
        }
        renderDisplay();
      });
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          void submit();
        }
      });
      pathField.appendChild(input);
      if (opts.focus) input.focus();
      if (opts.select) input.select();
    }

    pathField.addEventListener('click', (ev) => {
      // Don't re-mount the input if we clicked inside the existing input.
      if ((ev.target as HTMLElement).tagName === 'INPUT') return;
      renderEdit({ focus: true });
    });

    wdSection.querySelector<HTMLButtonElement>('#ns-browse')!.addEventListener('click', () => {
      void (async () => {
        try {
          const resp = await bridge.send(IpcChannel.FsPickDirectory, { startPath: state.cwd });
          const r = resp as { path?: string; cancelled?: true };
          if (r && typeof r.path === 'string') {
            state.cwd = r.path;
            clearError();
            renderEdit({ focus: false });
            startBtn.disabled = state.cwd.trim().length === 0;
          }
        } catch (err) {
          console.warn('[new-session] Browse failed:', err);
        }
      })();
    });

    const cleanup = (result: NewSessionResult | null): void => {
      mount.classList.remove('open');
      mount.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      // A5-I2: without this, every open of this dialog left another 'click' listener
      // on the persistent #dialog-mount element — they never fire the wrong dialog's
      // cleanup (each closure is independently resolved/no-op-safe), but they
      // accumulate for the life of the window, one per dialog ever opened.
      mount.removeEventListener('click', onMountClick);
      resolve(result);
    };

    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') { ev.preventDefault(); cleanup(null); }
    };
    document.addEventListener('keydown', onKey);

    const onMountClick = (ev: MouseEvent): void => {
      if (ev.target === mount) cleanup(null);
    };
    mount.addEventListener('click', onMountClick);

    root.querySelector<HTMLButtonElement>('#ns-close')!.addEventListener('click', () => cleanup(null));
    root.querySelector<HTMLButtonElement>('#ns-cancel')!.addEventListener('click', () => cleanup(null));

    // ── Shell section ───────────────────────────────────────────────
    interface ShellOpt { value: Shell; label: string; }
    function detectShells(): ShellOpt[] {
      const ua = navigator.userAgent;
      if (ua.includes('Windows')) return [
        { value: 'pwsh',     label: 'pwsh.exe' },
        { value: 'cmd',      label: 'cmd.exe'  },
        { value: 'git-bash', label: 'git-bash' },
      ];
      if (ua.includes('Mac OS')) return [
        { value: 'zsh',  label: 'zsh'  },
        { value: 'bash', label: 'bash' },
      ];
      return [
        { value: 'bash', label: 'bash' },
        { value: 'zsh',  label: 'zsh'  },
      ];
    }
    const shellOpts = detectShells();

    // If defaultShell isn't available on this OS, fall back to the first option.
    if (!shellOpts.some((o) => o.value === state.shell)) {
      state.shell = shellOpts[0]!.value;
    }

    const shellSection = document.createElement('div');
    shellSection.className = 'aip-modal__section';
    shellSection.innerHTML = `
      <div class="aip-label">Shell</div>
      <div class="aip-radio-row" role="radiogroup" aria-label="Shell"></div>
    `;
    body.appendChild(shellSection);
    const radioRow = shellSection.querySelector<HTMLDivElement>('.aip-radio-row')!;

    function renderRadios(): void {
      radioRow.replaceChildren();
      shellOpts.forEach((opt, i) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'aip-radio' + (state.shell === opt.value ? ' aip-radio--active' : '');
        el.setAttribute('role', 'radio');
        el.setAttribute('aria-checked', state.shell === opt.value ? 'true' : 'false');
        // Single tab stop: only the active radio is tabbable.
        el.tabIndex = state.shell === opt.value ? 0 : -1;
        el.innerHTML = `<span class="aip-radio__dot"></span><span>${opt.label}</span>`;
        el.addEventListener('click', () => selectShell(i));
        el.addEventListener('keydown', (ev) => onRadioKey(ev, i));
        radioRow.appendChild(el);
      });
    }

    function updateRadioStates(): void {
      const els = radioRow.querySelectorAll<HTMLElement>('.aip-radio');
      els.forEach((el, i) => {
        const active = shellOpts[i]!.value === state.shell;
        el.classList.toggle('aip-radio--active', active);
        el.setAttribute('aria-checked', active ? 'true' : 'false');
        el.tabIndex = active ? 0 : -1;
      });
    }

    function selectShell(index: number): void {
      const opt = shellOpts[index];
      if (!opt) return;
      state.shell = opt.value;
      updateRadioStates();
      const radios = radioRow.querySelectorAll<HTMLElement>('.aip-radio');
      radios[index]?.focus();
    }

    function onRadioKey(ev: KeyboardEvent, index: number): void {
      const last = shellOpts.length - 1;
      switch (ev.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          ev.preventDefault();
          selectShell(index === last ? 0 : index + 1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          ev.preventDefault();
          selectShell(index === 0 ? last : index - 1);
          break;
        case 'Home':
          ev.preventDefault();
          selectShell(0);
          break;
        case 'End':
          ev.preventDefault();
          selectShell(last);
          break;
        case 'Enter':
          ev.preventDefault();
          void submit();
          break;
      }
    }

    renderRadios();

    // ── Start button + submit ───────────────────────────────────────
    const startBtn = root.querySelector<HTMLButtonElement>('#ns-start')!;
    startBtn.disabled = state.cwd.trim().length === 0;
    startBtn.addEventListener('click', () => { void submit(); });

    let submitting = false;
    async function submit(): Promise<void> {
      const cwd = state.cwd.trim();
      if (cwd.length === 0 || submitting) return;
      submitting = true;
      startBtn.disabled = true;
      try {
        const resp = await bridge.send(IpcChannel.FsPathExists, { path: cwd });
        const r = resp as { exists: boolean; isDirectory: boolean };
        if (!r.exists) {
          showError('directory not found');
          return;
        }
        if (!r.isDirectory) {
          showError('not a directory');
          return;
        }
        cleanup({ shell: state.shell, cwd });
      } catch (err) {
        console.warn('[new-session] cwd check failed:', err);
        showError('directory not found');
      } finally {
        submitting = false;
        startBtn.disabled = state.cwd.trim().length === 0;
      }
    }

    // Initial mount: edit state, focused + selected.
    renderEdit({ focus: true, select: true });
  });
}

/**
 * Show a modal that prompts for a new tab title. Resolves with the trimmed title, or
 * null if cancelled. Used instead of window.prompt(), which Electron renderers disable.
 */
export function showRenameDialog(
  mount: HTMLElement,
  currentTitle: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    mount.innerHTML = '';
    mount.classList.add('open');

    const root = document.createElement('div');
    root.className = 'dialog dialog-rename';
    root.innerHTML = `
      <div class="dlg-titlebar">
        <div class="dlg-eyebrow">
          <span class="dlg-eyebrow-label">RENAME</span>
          <span class="dlg-eyebrow-dot"></span>
          <span class="dlg-eyebrow-title">Tab</span>
        </div>
        <button class="dlg-close" id="rn-close" title="Close">×</button>
      </div>

      <section class="dlg-section">
        <div class="dlg-label">TITLE</div>
        <input id="rn-title" type="text" class="dlg-input" />
      </section>

      <div class="dlg-footer">
        <button id="rn-cancel" class="dlg-btn">Cancel</button>
        <button id="rn-ok" class="dlg-btn dlg-btn-primary">Rename</button>
      </div>
    `;
    mount.appendChild(root);

    const titleEl = root.querySelector<HTMLInputElement>('#rn-title')!;
    const okEl = root.querySelector<HTMLButtonElement>('#rn-ok')!;
    const cancelEl = root.querySelector<HTMLButtonElement>('#rn-cancel')!;
    root.querySelector<HTMLButtonElement>('#rn-close')!.addEventListener('click', () => cleanup(null));

    titleEl.value = currentTitle;
    titleEl.focus();
    titleEl.select();

    const cleanup = (result: string | null): void => {
      mount.classList.remove('open');
      mount.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      mount.removeEventListener('click', onMountClick); // A5-I2
      resolve(result);
    };

    function submit(): void {
      const title = titleEl.value.trim();
      if (!title) return;
      cleanup(title);
    }

    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') { ev.preventDefault(); cleanup(null); }
      else if (ev.key === 'Enter' && (ev.target as HTMLElement).tagName !== 'BUTTON') {
        ev.preventDefault();
        submit();
      }
    };
    document.addEventListener('keydown', onKey);

    const onMountClick = (ev: MouseEvent): void => {
      if (ev.target === mount) cleanup(null);
    };
    mount.addEventListener('click', onMountClick);

    okEl.addEventListener('click', submit);
    cancelEl.addEventListener('click', () => cleanup(null));
  });
}
