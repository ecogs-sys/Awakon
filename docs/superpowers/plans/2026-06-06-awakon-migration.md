# Awakon Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Awakon Electron monorepo to `C:\Work\ecogs\projects\Awakon` with full rebranding to Awakon, preserving complete git history.

**Architecture:** Push Awakon's git history to the Awakon GitHub remote, pull it into the local Awakon clone, apply three targeted bulk search-and-replace passes across all source/config/docs files, regenerate the pnpm lock file, verify, then commit and push.

**Tech Stack:** pnpm monorepo, Electron (electron-vite), TypeScript, PowerShell (Windows), GitHub Actions, release-please

---

### Task 1: Push Awakon history to the Awakon GitHub remote

**Files:**
- Modify: `.git/config` in the Awakon repo (adds a temporary remote)

- [ ] **Step 1: Switch to the Awakon repo and add the Awakon remote**

```powershell
Set-Location "C:\Work\ecogs\projects\Awakon"
git remote add awakon https://github.com/ecogs-sys/Awakon.git
```

Expected: no output (success).

- [ ] **Step 2: Push main to the Awakon remote**

```powershell
git push awakon main
```

Expected output (approximate):
```
Enumerating objects: ...
Writing objects: 100% ...
To https://github.com/ecogs-sys/Awakon.git
 * [new branch]      main -> main
```

---

### Task 2: Pull history into the Awakon local repo

**Files:**
- Pulls full Awakon source tree into `C:\Work\ecogs\projects\Awakon`

All remaining tasks run from `C:\Work\ecogs\projects\Awakon`.

- [ ] **Step 1: Pull**

```powershell
Set-Location "C:\Work\ecogs\projects\Awakon"
git pull origin main --allow-unrelated-histories
```

Expected: git applies all Awakon commits. You will see many files listed.

- [ ] **Step 2: Verify the source tree**

```powershell
Get-ChildItem -Name
```

Expected output includes: `apps`, `packages`, `tests`, `package.json`, `README.md`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`.

If the tree is missing, re-check Task 1 Step 2 completed without error.

---

### Task 3: Bulk replace `@awakon/` → `@awakon/`

**Files:** All `.ts`, `.tsx`, `.html`, `.json`, `.yml`, `.yaml`, `.md`, `.mjs`, `.cjs`, `.ps1`, `.sh` under `C:\Work\ecogs\projects\Awakon`, excluding `node_modules`, `.git`, `release/`, and `out/`.

- [ ] **Step 1: Run the replacement**

```powershell
Set-Location "C:\Work\ecogs\projects\Awakon"
$files = Get-ChildItem -Path . -Recurse -File -Include *.ts,*.tsx,*.html,*.json,*.yml,*.yaml,*.md,*.mjs,*.cjs,*.ps1,*.sh |
    Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.git\\|\\release\\|\\out\\' -and $_.Name -ne 'pnpm-lock.yaml' }

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw -Encoding UTF8
    if ($content -match '@awakon/') {
        $newContent = $content -replace '@awakon/', '@awakon/'
        [System.IO.File]::WriteAllText($file.FullName, $newContent, [System.Text.Encoding]::UTF8)
        Write-Host "Updated: $($file.FullName)"
    }
}
```

Expected: Several files printed. Key ones:
```
Updated: ...\apps\desktop\package.json
Updated: ...\packages\core\package.json
Updated: ...\packages\terminal-host\package.json
Updated: ...\tests\integration\package.json
Updated: ...\apps\desktop\src\...
```

- [ ] **Step 2: Spot-check `packages/core/package.json`**

```powershell
Get-Content "packages\core\package.json"
```

Expected:
```json
{
  "name": "@awakon/core",
  ...
  "dependencies": {
    "@awakon/contracts": "workspace:*",
    ...
  }
}
```

---

### Task 4: Bulk replace `Awakon` → `Awakon`

**Files:** Same scope as Task 3.

- [ ] **Step 1: Run the replacement**

Note: PowerShell's `-replace` uses regex — `AI\.Pad` escapes the dot to match the literal string `Awakon`.

```powershell
Set-Location "C:\Work\ecogs\projects\Awakon"
$files = Get-ChildItem -Path . -Recurse -File -Include *.ts,*.tsx,*.html,*.json,*.yml,*.yaml,*.md,*.mjs,*.cjs,*.ps1,*.sh |
    Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.git\\|\\release\\|\\out\\' -and $_.Name -ne 'pnpm-lock.yaml' }

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw -Encoding UTF8
    if ($content -match 'AI\.Pad') {
        $newContent = $content -replace 'AI\.Pad', 'Awakon'
        [System.IO.File]::WriteAllText($file.FullName, $newContent, [System.Text.Encoding]::UTF8)
        Write-Host "Updated: $($file.FullName)"
    }
}
```

Expected: Key files printed:
```
Updated: ...\apps\desktop\electron-builder.json
Updated: ...\apps\desktop\package.json
Updated: ...\README.md
Updated: ...\CHANGELOG.md
Updated: ...\apps\desktop\CHANGELOG.md
Updated: ...\apps\desktop\src\renderer\chrome\about-dialog.ts
Updated: ...\apps\desktop\src\main\app-menu.ts
...
```

- [ ] **Step 2: Spot-check `apps/desktop/electron-builder.json`**

```powershell
Get-Content "apps\desktop\electron-builder.json"
```

Expected (note `appId` still says `awakon` — fixed in Task 5):
```json
{
  "appId": "com.ecogs.awakon",
  "productName": "Awakon",
  ...
  "publish": [
    {
      "provider": "github",
      "owner": "ecogs-sys",
      "repo": "Awakon"
    }
  ]
}
```

---

### Task 5: Bulk replace `awakon` → `awakon`

**Files:** Same scope as Task 3.

- [ ] **Step 1: Run the replacement**

```powershell
Set-Location "C:\Work\ecogs\projects\Awakon"
$files = Get-ChildItem -Path . -Recurse -File -Include *.ts,*.tsx,*.html,*.json,*.yml,*.yaml,*.md,*.mjs,*.cjs,*.ps1,*.sh |
    Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.git\\|\\release\\|\\out\\' -and $_.Name -ne 'pnpm-lock.yaml' }

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw -Encoding UTF8
    if ($content -match 'awakon') {
        $newContent = $content -replace 'awakon', 'awakon'
        [System.IO.File]::WriteAllText($file.FullName, $newContent, [System.Text.Encoding]::UTF8)
        Write-Host "Updated: $($file.FullName)"
    }
}
```

Expected: Key files printed:
```
Updated: ...\package.json
Updated: ...\apps\desktop\package.json
Updated: ...\apps\desktop\electron-builder.json
Updated: ...\release-please-config.json
Updated: ...\apps\desktop\src\...
...
```

- [ ] **Step 2: Spot-check `apps/desktop/electron-builder.json`**

```powershell
Get-Content "apps\desktop\electron-builder.json"
```

Expected full content:
```json
{
  "appId": "com.ecogs.awakon",
  "productName": "Awakon",
  "directories": {
    "buildResources": "build",
    "output": "release/${version}"
  },
  "files": [
    "out/**/*",
    "package.json"
  ],
  "asarUnpack": [
    "node_modules/node-pty/**/*"
  ],
  "extraResources": [
    { "from": "build/icon.png", "to": "icon.png" }
  ],
  "nodeGypRebuild": false,
  "npmRebuild": false,
  "win": {
    "target": ["nsis"]
  },
  "mac": {
    "target": ["dmg"],
    "category": "public.app-category.developer-tools",
    "identity": null
  },
  "linux": {
    "target": ["AppImage", "deb"],
    "category": "Development",
    "executableName": "awakon",
    "artifactName": "${productName}-${version}-${arch}.${ext}"
  },
  "publish": [
    {
      "provider": "github",
      "owner": "ecogs-sys",
      "repo": "Awakon"
    }
  ]
}
```

- [ ] **Step 3: Spot-check root `package.json`**

```powershell
Get-Content "package.json" | Select-String "name|url"
```

Expected:
```
  "name": "awakon",
    "url": "https://github.com/ecogs-sys/Awakon.git"
```

- [ ] **Step 4: Spot-check `release-please-config.json`**

```powershell
Get-Content "release-please-config.json"
```

Expected: `"package-name": "awakon"`, `"package-name": "@awakon/desktop"`, `"groupName": "awakon"`.

---

### Task 6: Regenerate pnpm lock file

- [ ] **Step 1: Delete the existing lock file**

```powershell
Set-Location "C:\Work\ecogs\projects\Awakon"
Remove-Item "pnpm-lock.yaml"
```

- [ ] **Step 2: Install to regenerate**

```powershell
pnpm install
```

Expected: pnpm resolves all `@awakon/` workspace packages. Final line:
```
Done in Xs
```

If pnpm errors with `"workspace package not found for '@awakon/...'"` — a `package.json` was missed in the rename. Re-run the spot-checks from Task 3 Step 2 to find the missed file, fix it manually, then re-run `pnpm install`.

---

### Task 7: Verify no Awakon / awakon references remain in source

- [ ] **Step 1: Search for remaining `@awakon/` references**

```powershell
Set-Location "C:\Work\ecogs\projects\Awakon"
Select-String -Path . -Pattern "@awakon/" -Recurse -Include *.ts,*.tsx,*.json,*.yml,*.yaml,*.md,*.html -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -notmatch '\\node_modules\\|\\\.git\\|\\release\\|\\out\\' }
```

Expected: **no output** (zero matches). If matches are found, edit those files manually and re-run.

- [ ] **Step 2: Search for remaining `Awakon` references**

```powershell
Select-String -Path . -Pattern "AI\.Pad" -Recurse -Include *.ts,*.tsx,*.json,*.yml,*.yaml,*.md,*.html -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -notmatch '\\node_modules\\|\\\.git\\|\\release\\|\\out\\' }
```

Expected: **no output**. If matches are found, edit those files manually and re-run.

- [ ] **Step 3: Search for remaining lowercase `awakon` references**

```powershell
Select-String -Path . -Pattern "awakon" -Recurse -Include *.ts,*.tsx,*.json,*.yml,*.yaml,*.md,*.html -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -notmatch '\\node_modules\\|\\\.git\\|\\release\\|\\out\\' }
```

Expected: **no output**. Any matches in source/config/docs must be fixed manually. Matches in `pnpm-lock.yaml` are acceptable only if you skipped deleting it — in that case delete and regenerate (Task 6) now.

---

### Task 8: Build verification

- [ ] **Step 1: Build all workspace packages**

```powershell
Set-Location "C:\Work\ecogs\projects\Awakon"
pnpm -r --filter './packages/*' build
```

Expected: TypeScript compiles `contracts`, `core`, `keymap`, `terminal-host` without errors.

- [ ] **Step 2: Build the desktop app**

```powershell
pnpm --filter @awakon/desktop build
```

Expected: electron-vite builds successfully. Final line:
```
✓ built in ...s
```

If this fails with `"Cannot find module '@awakon/...'"` — a `package.json` devDependency was missed. Find it with:
```powershell
Select-String -Path . -Pattern "@awakon/" -Recurse -Include *.json | Where-Object { $_.Path -notmatch '\\node_modules\\' }
```
Fix the file and re-run.

---

### Task 9: Test verification

- [ ] **Step 1: Run unit tests**

```powershell
Set-Location "C:\Work\ecogs\projects\Awakon"
pnpm test
```

Expected: All vitest tests pass. No failures.

- [ ] **Step 2: Run typecheck**

```powershell
pnpm typecheck
```

Expected: No TypeScript errors across all packages.

---

### Task 10: Commit rebranding and push

- [ ] **Step 1: Stage all changes**

```powershell
Set-Location "C:\Work\ecogs\projects\Awakon"
git add -A
```

- [ ] **Step 2: Review what is staged**

```powershell
git status
```

Expected: Many modified files across `apps/`, `packages/`, `tests/`, `docs/`, root config files, and `pnpm-lock.yaml`. No untracked surprises.

- [ ] **Step 3: Commit**

```powershell
git commit -m "chore: rebrand Awakon to Awakon"
```

- [ ] **Step 4: Push to Awakon remote**

```powershell
git push origin main
```

Expected:
```
To https://github.com/ecogs-sys/Awakon.git
   <hash>..<hash>  main -> main
```

---

### Task 11: Cleanup — remove temporary remote from Awakon repo

- [ ] **Step 1: Remove the awakon remote**

```powershell
Set-Location "C:\Work\ecogs\projects\Awakon"
git remote remove awakon
```

Expected: no output (success).

- [ ] **Step 2: Verify remotes**

```powershell
git remote -v
```

Expected: Only `origin` pointing to `https://github.com/ecogs-sys/Awakon.git` remains.
