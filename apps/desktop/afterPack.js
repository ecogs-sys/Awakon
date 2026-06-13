const path = require('path');
const fs = require('fs');

/**
 * Wrap the Linux Electron binary in a shell script that passes --no-sandbox.
 *
 * The chrome-sandbox SUID check runs during C++ startup before Node.js loads,
 * so app.commandLine.appendSwitch('no-sandbox') is always too late. Putting
 * --no-sandbox in argv via a wrapper script is the only reliable fix for AppImage
 * and linux-unpacked builds alike.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;

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
