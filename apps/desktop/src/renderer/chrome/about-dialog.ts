import { IpcChannel, type ChromeAppInfoResponse } from '@awakon/contracts';
import { renderAwakonMark } from './icon.js';

interface Bridge {
  send: (channel: string, payload?: unknown) => Promise<unknown>;
}

const APP_NAME = 'Awakon';
const TAGLINE  = 'Run many agents · never miss a prompt';
const REPO     = 'https://github.com/ecogs-sys/Awakon';
/** Acknowledgements has no URL: it opens the THIRD_PARTY_NOTICES.md copy shipped
 * with the app (main resolves the path) — the repo is private, so a GitHub blob
 * URL would 404 for end users, and the shipped copy also works offline. */
const LINKS: Array<{ label: string; url?: string }> = [
  { label: 'Website',          url: REPO },
  { label: 'Release notes',    url: `${REPO}/releases` },
  { label: 'Acknowledgements' },
  { label: 'Report an issue',  url: `${REPO}/issues` },
];

/**
 * Show the About dialog. Mirrors showSettingsDialog / showNewSessionDialog: renders
 * into the single #dialog-mount element so opening twice never stacks modals.
 * Resolves when the user dismisses (OK / × / Esc / backdrop click).
 */
export function showAboutDialog(
  mount: HTMLElement,
  info: ChromeAppInfoResponse,
): Promise<void> {
  return new Promise((resolve) => {
    mount.innerHTML = '';
    mount.classList.add('open');

    const bridge = (window as unknown as { awakon: Bridge }).awakon;

    const root = document.createElement('div');
    root.className = 'aip-modal aip-modal--about';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', `About ${APP_NAME}`);
    root.innerHTML = `
      <div class="aip-modal__header">
        <span class="aip-modal__crumb">About</span>
        <button class="aip-modal__close" id="ab-close" title="Close" type="button">×</button>
      </div>

      <div class="aip-about__identity">
        <div class="aip-about__icon" id="ab-icon"></div>
        <div class="aip-about__id-text">
          <div class="aip-about__name"></div>
          <div class="aip-about__version"></div>
          <div class="aip-about__tagline"></div>
        </div>
      </div>

      <div class="aip-about__details" id="ab-details"></div>

      <div class="aip-about__links" id="ab-links"></div>

      <div class="aip-modal__footer">
        <div class="aip-about__legal">
          <div class="aip-about__legal-line">© ${new Date().getFullYear()} ${APP_NAME} contributors</div>
          <div class="aip-about__legal-line">Released under the MIT License</div>
        </div>
        <div class="aip-about__actions">
          <button class="aip-btn aip-btn--ghost"   id="ab-copy" type="button">Copy info</button>
          <button class="aip-btn aip-btn--primary" id="ab-ok"   type="button">OK</button>
        </div>
      </div>
    `;
    mount.appendChild(root);

    root.querySelector<HTMLDivElement>('.aip-about__name')!.textContent = APP_NAME;
    root.querySelector<HTMLDivElement>('.aip-about__tagline')!.textContent = TAGLINE;
    const versionEl = root.querySelector<HTMLDivElement>('.aip-about__version')!;
    versionEl.textContent = `Version ${info.version}`;
    root.querySelector<HTMLDivElement>('#ab-icon')!.appendChild(renderAwakonMark(64));

    const details = root.querySelector<HTMLDivElement>('#ab-details')!;
    appendRow(details, 'Electron', info.electron);
    appendRow(details, 'Chromium', info.chromium);
    appendRow(details, 'Node',     info.node);
    appendRow(details, 'V8',       info.v8);
    appendRow(details, 'OS',       info.os);

    const linksEl = root.querySelector<HTMLDivElement>('#ab-links')!;
    for (const link of LINKS) {
      const a = document.createElement('button');
      a.type = 'button';
      a.className = 'aip-about__link';
      a.textContent = link.label;
      a.addEventListener('click', () => {
        if (link.url) void bridge.send(IpcChannel.ChromeOpenExternal, { url: link.url });
        else void bridge.send(IpcChannel.ChromeOpenAcknowledgements);
      });
      linksEl.appendChild(a);
    }

    const okEl    = root.querySelector<HTMLButtonElement>('#ab-ok')!;
    const closeEl = root.querySelector<HTMLButtonElement>('#ab-close')!;
    const copyEl  = root.querySelector<HTMLButtonElement>('#ab-copy')!;

    copyEl.addEventListener('click', () => { void copyInfo(info, copyEl); });
    okEl.addEventListener('click', () => cleanup());
    closeEl.addEventListener('click', () => cleanup());

    const onMountClick = (ev: MouseEvent): void => {
      if (ev.target === mount) cleanup();
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') { ev.preventDefault(); cleanup(); }
      else if (ev.key === 'Enter' && (ev.target as HTMLElement).tagName !== 'BUTTON') {
        ev.preventDefault(); cleanup();
      }
    };
    document.addEventListener('keydown', onKey);
    mount.addEventListener('click', onMountClick);

    function cleanup(): void {
      mount.classList.remove('open');
      mount.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      mount.removeEventListener('click', onMountClick);
      resolve();
    }

    okEl.focus();
  });
}

function appendRow(parent: HTMLElement, key: string, value: string): void {
  if (!value) return;
  const row = document.createElement('div');
  row.className = 'aip-about__row';
  const k = document.createElement('span');
  k.className = 'aip-about__key';
  k.textContent = key;
  const v = document.createElement('span');
  v.className = 'aip-about__val';
  v.textContent = value;
  row.appendChild(k);
  row.appendChild(v);
  parent.appendChild(row);
}

async function copyInfo(info: ChromeAppInfoResponse, btn: HTMLButtonElement): Promise<void> {
  const text = [
    `${APP_NAME} ${info.version}`,
    `Electron ${info.electron}`,
    `Chromium ${info.chromium}`,
    `Node ${info.node}`,
    `V8 ${info.v8}`,
    `OS ${info.os}`,
  ].join('\n');
  try {
    await navigator.clipboard.writeText(text);
    const original = btn.textContent;
    btn.textContent = 'Copied';
    btn.disabled = true;
    window.setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 1200);
  } catch (err) {
    console.warn('[about] copy failed:', err);
  }
}
