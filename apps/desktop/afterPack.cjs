const path = require('path');
const fs = require('fs');

/**
 * Wrap the Linux Electron binary in a shell script that passes --no-sandbox — needed
 * for AppImage and `--dir` (unpacked) builds, NOT for deb.
 *
 * The chrome-sandbox SUID check runs during C++ startup before Node.js loads, so
 * app.commandLine.appendSwitch('no-sandbox') is always too late; a wrapper script
 * is the only reliable way to add --no-sandbox to argv. AppImage and unpacked builds
 * genuinely need this: they run from an arbitrary user-writable path (an AppImage
 * mount, or wherever `--dir` output was copied) where the SUID bit electron-builder
 * sets on chrome-sandbox typically does not survive (or the mount is `nosuid`).
 *
 * deb does NOT need this: its postinst script chmods chrome-sandbox to 4755
 * (root-owned SUID) at a fixed system path, so the sandbox works without disabling
 * it — wrapping it would needlessly turn the sandbox off. Since electron-builder
 * packs every target given to ONE invocation from the SAME appOutDir (afterPack runs
 * once per arch, not per target), deb must never be built in the same invocation as
 * AppImage/`--dir` (H4/N7) — `dist:linux` (package.json) runs them as two separate
 * `electron-builder` invocations for exactly this reason. Fail loudly instead of
 * silently under- or over-wrapping if that convention is ever violated.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const targetNames = context.targets.map((t) => t.name);
  const needsWrapper = targetNames.includes('appImage') || targetNames.includes('dir');
  if (targetNames.includes('deb') && needsWrapper) {
    throw new Error(
      `AppImage/--dir and deb must be built in separate electron-builder invocations (see dist:linux) — ` +
      `got both in one pack: ${targetNames.join(', ')}`,
    );
  }
  if (!needsWrapper) return;

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
