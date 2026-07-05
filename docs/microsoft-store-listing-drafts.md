# Microsoft Store submission — draft text (B4)

Drafts for the Partner Center fields that need copy but not code. **These are drafts to
review and paste in yourself** — I can't submit the Partner Center forms (age rating
questionnaire, name reservation, account verification) for you; those need your account.

Every factual claim below is traced to code so you can spot-check it before publishing:

- **No telemetry / analytics**: `grep -rn "fetch(\|https://" apps/desktop/src` finds only
  the static GitHub link constants in `apps/desktop/src/renderer/chrome/about-dialog.ts:10-15`
  (Website / Release notes / Acknowledgements / Report an issue).
- **Auto-updater disabled in the Store build**: `apps/desktop/src/main/auto-update.ts`
  returns early when `process.windowsStore` is set (see B2, resolved 2026-07-06).
- **Shells spawned via node-pty**: `pwsh`, `powershell`, `cmd`, `bash`, `zsh`, `wsl`,
  `git-bash` — `packages/contracts/src/session.ts:14` (`ShellSchema`), spawned in
  `packages/core/src/session.ts:68` (`pty.spawn`).
- **Support contact**: `apps/desktop/package.json` author email (`ecogs.ltd@gmail.com`)
  and the repo's issue tracker (`about-dialog.ts:14` — `${REPO}/issues`).

---

## 1. Privacy policy page

Partner Center requires a URL, not inline text — host this wherever's convenient (a
GitHub Pages page off this repo, a gist, a page on your own site) and paste the URL into
the submission form's "Privacy policy URL" field.

```markdown
# Awakon Privacy Policy

*Last updated: [DATE YOU PUBLISH THIS]*

Awakon is a terminal session manager. It does not collect, transmit, or store any
personal data, usage analytics, or telemetry of any kind.

## What Awakon does on your machine

- Runs shell processes you choose (PowerShell, Command Prompt, WSL, bash, zsh, or a
  custom command) using your operating system's own process-spawning APIs.
- Reads and displays files you open (e.g. Markdown files referenced in terminal output)
  from your local filesystem, within the working directory of the session you opened
  them from.
- Saves your session layout (open tabs, shells, working directories, and window
  arrangement) to a local settings file on your device, so it can be restored the next
  time you launch the app. This data never leaves your device.

## What Awakon sends over the network

Nothing, by default. The Microsoft Store build does not check for updates, phone home,
or make any network request of its own accord — the Microsoft Store handles update
delivery instead.

[If you ship a non-Store build too, keep this paragraph instead/also:]
The non-Store (direct download) build checks GitHub Releases for a newer version on
startup and downloads updates in the background if one is found. No other data is sent
with that request beyond what's needed to fetch the release manifest (no usage stats,
no identifiers).

## Third-party services

None. Awakon does not integrate with any third-party analytics, advertising, or data
platform.

## Contact

Questions about this policy: ecogs.ltd@gmail.com, or open an issue at
https://github.com/ecogs-sys/Awakon/issues.
```

---

## 2. `runFullTrust` capability justification

Paste (and adjust to Partner Center's field length/format) into the submission's
restricted-capability justification for `runFullTrust`:

```text
Awakon is a developer terminal / session manager (comparable to Windows Terminal). Its
core function is to launch and manage local shell processes on the user's behalf —
PowerShell, Command Prompt, WSL, bash, zsh, and git-bash — so the user can run and
monitor multiple command-line sessions (including AI coding assistants such as Claude
Code and Codex CLI) side by side. This requires full-trust process-spawning access; it
cannot be implemented within the UWP sandbox, which prohibits launching arbitrary child
processes. The app itself performs no network access beyond what the Microsoft Store
already handles (update delivery) and collects no telemetry — see the privacy policy for
details.
```

---

## 3. Store listing copy

### App name
Awakon

### Short description / subtitle (~100 chars)

```text
Run many terminal sessions in parallel — and never miss the moment one needs you.
```

### Full description

```text
Awakon is a terminal session manager built for working with several command-line tools
and AI coding agents (Claude Code, Codex CLI, and similar) at once.

Every project gets its own tab, every tab runs a real shell — PowerShell, Command
Prompt, WSL, bash, zsh, or a custom command — and Awakon watches all of them for you.
When a background session prints a prompt, hits a rate limit, or rings the terminal
bell, Awakon badges the tab and fires a native Windows notification, so you can focus on
one session while the others quietly wait their turn. It can even resume a rate-limited
agent automatically once the limit clears.

FEATURES

• Tabbed sessions — run many shells side by side; create, close, switch, and reorder
  tabs entirely from the keyboard.
• Pick your shell per tab — PowerShell, Command Prompt, WSL, bash, or a custom command,
  each with its own working directory.
• Attention awareness — a background session that needs input badges its tab and
  highlights in the sidebar.
• Native notifications — get a desktop notification when a session needs you and the
  window isn't focused; click it to jump straight there.
• Rate-limit auto-resume (opt-in) — detects when an AI agent reports it's hit a usage
  limit, reads the reset time, and can automatically resume the session once the limit
  clears.
• Split panes — split any tab horizontally or vertically to watch two sessions in one
  view.
• Live sidebar — see every session's shell, status, and time-in-state at a glance.
• Markdown reader — click a Markdown file referenced in terminal output to read it in a
  built-in reader pane, without leaving the app.
• Session persistence — your open tabs, shells, working directories, and layout are
  restored the next time you launch Awakon.
• Keyboard-first — every common action has a shortcut.

Awakon runs no telemetry and makes no network calls beyond what the Microsoft Store
itself handles for updates.
```

### Category
Developer tools

### Suggested age rating questionnaire answers

You still have to fill this in yourself in Partner Center, but functionally: Awakon
displays no user-generated content sharing, no violence/mature themes, no ads, no
in-app purchases, no location data, no user-to-user communication. Expect this to
qualify for the lowest/broadest rating tier (e.g. "PEGI 3" / "Everyone") — but answer
the actual questionnaire honestly since Microsoft's wording and categories change.

### Screenshots

Reuse (or refresh) the images already in `docs/images/` (`main.png`, `new-session.png`,
`multi-tab.png`, `sidebar.png`, `auto-resume.png`, plus whatever the splits/reader
screenshots are named) — see `README.md`'s Screenshots section for the current set and
their captions, which double as good screenshot-caption copy for the listing.
