const path = require('path');
const fs = require('fs');

/**
 * Wrap the Linux Electron binary in a shell script that passes --no-sandbox —
 * AppImage-only.
 *
 * The chrome-sandbox SUID check runs during C++ startup before Node.js loads, so
 * app.commandLine.appendSwitch('no-sandbox') is always too late; a wrapper script
 * is the only reliable way to add --no-sandbox to argv. AppImage genuinely needs
 * this: it extracts/mounts at an arbitrary user-writable path at runtime, where the
 * SUID bit electron-builder sets on chrome-sandbox typically does not survive (or
 * the mount is `nosuid`), so the renderer sandbox cannot initialize there.
 *
 * The deb target does NOT need this: electron-builder's deb postinst script chmods
 * chrome-sandbox to 4755 (root-owned SUID) at a fixed system path, so the sandbox
 * works there without disabling it. Since electron-builder packs AppImage and deb
 * from the SAME appOutDir when built together (afterPack.cjs afterPack runs once
 * per arch, not per target), unconditionally wrapping the binary here disabled the
 * sandbox for deb installs too (H4). Only apply the wrapper when every target
 * sharing this appOutDir is AppImage — i.e. skip it whenever a deb build is part of
 * this pack, so `electron-builder --linux AppImage deb` in one invocation leaves
 * the sandbox enabled for both. Building AppImage alone in its own invocation still
 * gets the --no-sandbox wrapper it needs.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const targetNames = context.targets.map((t) => t.name);
  if (!targetNames.includes('appImage')) return;
  if (targetNames.includes('deb')) return;

  const { appOutDir, packager } = context;
  const execName = packager.executableName; // 'awakon'
  const binaryPath = path.join(appOutDir, execName);
  const actualName = `${execName}.bin`;
  const actualBinaryPath = path.join(appOutDir, actualName);

  fs.renameSync(binaryPath, actualBinaryPath);

  fs.writeFileSync(
    binaryPath,
    `#!/bin/bash\nexec "$(dirname "$0")/${actualName}" --no-sandbox "$@"\n`,
  );
  fs.chmodSync(binaryPath, 0o755);
};
