import type { AppSettings } from '@awakon/contracts';
import { IpcChannel } from '@awakon/contracts';

interface Bridge {
  send: (channel: string, payload?: unknown) => Promise<unknown>;
}

/**
 * Show the settings modal pre-filled from `current`. Resolves with the new
 * AppSettings on Save, or null on Cancel/Escape. Mirrors new-session-dialog.ts:
 * re-uses the single #dialog-mount element so opening twice never stacks modals.
 */
export function showSettingsDialog(
  mount: HTMLElement,
  current: AppSettings,
): Promise<AppSettings | null> {
  return new Promise((resolve) => {
    mount.innerHTML = '';
    mount.classList.add('open');

    const root = document.createElement('div');
    root.className = 'dialog dialog-settings';
    root.innerHTML = `
      <div class="dlg-titlebar">
        <div class="dlg-eyebrow">
          <span class="dlg-eyebrow-label">SETTINGS</span>
          <span class="dlg-eyebrow-dot"></span>
          <span class="dlg-eyebrow-title">Auto-resume</span>
        </div>
        <button class="dlg-close" id="set-close" title="Close">×</button>
      </div>

      <section class="dlg-section dlg-toggle-row">
        <button id="set-enabled-toggle" type="button" class="dlg-switch" role="switch" aria-checked="false"><i></i></button>
        <input id="set-enabled" type="checkbox" hidden />
        <div>
          <div class="dlg-toggle-title">Auto-resume rate-limited tabs</div>
          <div class="dlg-toggle-help">When an agent hits its usage limit and shows its prompt, Awakon answers it for you by sending the response below — for Claude Code that selects “Stop and wait for limit to reset”, so the agent resumes on its own once the limit refreshes.</div>
        </div>
      </section>

      <section class="dlg-section">
        <div class="dlg-label">TEXT TO DETECT</div>
        <input id="set-detect" type="text" maxlength="200" class="dlg-input" />
        <div class="dlg-chips" id="set-detect-chips">
          <button type="button" class="dlg-chip" data-detect="Stop and wait for limit to reset">Claude Code</button>
          <button type="button" class="dlg-chip" data-detect="rate limit reached">rate limit reached</button>
          <button type="button" class="dlg-chip" data-detect="quota exceeded">quota exceeded</button>
        </div>
      </section>

      <section class="dlg-section">
        <div class="dlg-label">RESPONSE TO SEND</div>
        <input id="set-response" type="text" maxlength="200" class="dlg-input" />
        <div class="dlg-help">Sent (followed by Enter) the moment the phrase appears. For Claude Code’s menu, “1” selects “Stop and wait for limit to reset”.</div>
      </section>

      <section class="dlg-section">
        <div class="dlg-label">RESUME TEXT</div>
        <input id="set-resume" type="text" maxlength="200" class="dlg-input" />
        <div class="dlg-help">Sent (followed by Enter) once the limit's reset time has passed — a nudge in case the agent didn't already resume on its own.</div>
      </section>

      <section class="dlg-section">
        <div class="dlg-label">DEFAULT WORKING DIRECTORY</div>
        <div class="aip-path-input">
          <div class="aip-path-input__field" id="set-default-cwd-field"></div>
          <button class="aip-path-input__browse" id="set-default-cwd-browse" type="button">
            <span>🗁</span><span>Browse…</span>
          </button>
        </div>
        <div class="dlg-help">Leave blank to use your home directory.</div>
      </section>

      <div class="dlg-footer">
        <button id="set-cancel" class="dlg-btn">Cancel</button>
        <button id="set-save" class="dlg-btn dlg-btn-primary">Save</button>
      </div>
    `;
    mount.appendChild(root);

    const enabledEl = root.querySelector<HTMLInputElement>('#set-enabled')!;
    const detectEl = root.querySelector<HTMLInputElement>('#set-detect')!;
    const responseEl = root.querySelector<HTMLInputElement>('#set-response')!;
    const resumeEl = root.querySelector<HTMLInputElement>('#set-resume')!;
    const pathField = root.querySelector<HTMLDivElement>('#set-default-cwd-field')!;
    const saveEl = root.querySelector<HTMLButtonElement>('#set-save')!;
    const cancelEl = root.querySelector<HTMLButtonElement>('#set-cancel')!;

    let cwdValue = current.defaultCwd;

    function splitPath(p: string): { head: string; tail: string } {
      const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
      if (idx < 0) return { head: '', tail: p };
      return { head: p.slice(0, idx + 1), tail: p.slice(idx + 1) };
    }

    function renderDisplay(): void {
      const { head, tail } = splitPath(cwdValue);
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
      input.value = cwdValue;
      input.addEventListener('input', () => { cwdValue = input.value; });
      input.addEventListener('blur', () => {
        if (cwdValue.trim().length > 0) {
          renderDisplay();
        }
      });
      pathField.appendChild(input);
      if (opts.focus) input.focus();
      if (opts.select) input.select();
    }

    pathField.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).tagName !== 'INPUT') renderEdit({ focus: true });
    });

    const toggleEl = root.querySelector<HTMLButtonElement>('#set-enabled-toggle')!;
    const setToggle = (on: boolean): void => {
      enabledEl.checked = on;
      toggleEl.setAttribute('aria-checked', on ? 'true' : 'false');
      toggleEl.dataset['on'] = on ? '1' : '0';
    };
    setToggle(current.autoResume.enabled);
    toggleEl.addEventListener('click', () => setToggle(!enabledEl.checked));
    root.querySelector<HTMLButtonElement>('#set-close')!.addEventListener('click', () => cleanup(null));

    root.querySelectorAll<HTMLButtonElement>('#set-detect-chips .dlg-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const phrase = chip.dataset['detect'] ?? '';
        detectEl.value = phrase;
        detectEl.focus();
      });
    });

    detectEl.value = current.autoResume.detectText;
    responseEl.value = current.autoResume.responseText;
    resumeEl.value = current.autoResume.resumeText;
    renderEdit({ focus: false, select: cwdValue.length > 0 });
    detectEl.focus();
    detectEl.select();

    root.querySelector<HTMLButtonElement>('#set-default-cwd-browse')!.addEventListener('click', () => {
      void (async () => {
        const b = (window as unknown as { awakon: Bridge }).awakon;
        if (!b) return;
        try {
          const resp = await b.send(IpcChannel.FsPickDirectory, { startPath: cwdValue });
          const r = resp as { path?: string; cancelled?: true };
          if (r && typeof r.path === 'string') {
            cwdValue = r.path;
            renderEdit({ focus: false });
          }
        } catch (err) {
          console.warn('[settings] Browse failed:', err);
        }
      })();
    });

    const cleanup = (result: AppSettings | null): void => {
      mount.classList.remove('open');
      mount.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      mount.removeEventListener('click', onMountClick); // A5-I2
      resolve(result);
    };

    function submit(): void {
      const enabled = enabledEl.checked;
      const detectText = detectEl.value.trim();
      const responseText = responseEl.value;
      const resumeText = resumeEl.value;
      // Read from the active input if in edit mode, else from cwdValue (display mode).
      const activeInput = pathField.querySelector<HTMLInputElement>('input');
      const defaultCwd = (activeInput ? activeInput.value : cwdValue).trim();
      // When enabled, a non-empty detect phrase is required.
      if (enabled && !detectText) {
        detectEl.focus();
        return;
      }
      cleanup({ autoResume: { enabled, detectText, responseText, resumeText }, defaultCwd, recentTabs: current.recentTabs });
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

    saveEl.addEventListener('click', submit);
    cancelEl.addEventListener('click', () => cleanup(null));
  });
}
