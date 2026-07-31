const path = require('path');
const fs = require('fs');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

/** Overridable in tests so they don't need a real Electron binary (flipFuses reads/
 * writes an actual fuse sentinel embedded in the packaged executable). A plain object
 * property, not a top-level export, because Node's ESM interop exposes a .cjs
 * module's top-level exports as read-only namespace bindings — tests importing this
 * file via dynamic import() cannot reassign `exports.flipFusesImpl` directly, only
 * mutate a property on an object that binding points to. */
exports.testHooks = { flipFusesImpl: flipFuses };

/** Where electron-builder places the actual Electron executable inside appOutDir, per
 * platform — the Linux wrap-for-sandbox logic below renames/replaces this file, so
 * fuses must be flipped on it BEFORE that happens.
 *
 * `packager.executableName` is a LinuxPackager-only property (set in its constructor)
 * — WinPackager/MacPackager never set it, so using it for those platforms silently
 * produces `undefined.exe`. Windows/mac name their binary/bundle after
 * `packager.appInfo.productFilename` instead (winPackager.js: `${appInfo.productFilename}.exe`;
 * macPackager.js: `${appInfo.productFilename}.app`, with the same name for the binary
 * inside Contents/MacOS). */
function electronBinaryPath(appOutDir, electronPlatformName, packager) {
  if (electronPlatformName === 'darwin' || electronPlatformName === 'mas') {
    const name = packager.appInfo.productFilename;
    return path.join(appOutDir, `${name}.app`, 'Contents', 'MacOS', name);
  }
  if (electronPlatformName === 'win32') {
    return path.join(appOutDir, `${packager.appInfo.productFilename}.exe`);
  }
  return path.join(appOutDir, packager.executableName);
}

/**
 * Harden the packaged Electron binary against the well-known post-packaging escape
 * hatches (A7-I1): without these fuses flipped, ELECTRON_RUN_AS_NODE, --inspect, and
 * NODE_OPTIONS all still work against the shipped binary, and the app can be pointed
 * at an unpacked/tampered app directory instead of its own asar.
 */
async function applyElectronFuses(context) {
  const binaryPath = electronBinaryPath(context.appOutDir, context.electronPlatformName, context.packager);
  await exports.testHooks.flipFusesImpl(binaryPath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
}

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
  await applyElectronFuses(context);

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
