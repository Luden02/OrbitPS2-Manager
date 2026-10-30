// electron-builder afterPack hook: copies the bundled redumper binary for
// the target platform/arch into the packaged app's resources, outside the
// asar (binaries can't be spawned from inside an asar archive). Runs once
// per arch, so it also covers mac's single-invocation x64+arm64 build where
// a plain `extraResources` entry can't pick a different source per arch.
const fs = require('fs');
const path = require('path');
const { Arch } = require('electron-builder');

const PLATFORM_DIRS = { darwin: 'macos', win32: 'windows', linux: 'linux' };

module.exports = async function (context) {
  const { electronPlatformName, appOutDir, arch } = context;
  const platformDir = PLATFORM_DIRS[electronPlatformName];
  const archName = Arch[arch];
  if (!platformDir) return;

  const srcDir = path.join(__dirname, '..', 'resources', 'redumper', `${platformDir}-${archName}`);
  if (!fs.existsSync(srcDir)) {
    console.warn(
      `[after-pack] no bundled redumper for ${platformDir}-${archName} ` +
        `(run "node scripts/fetch-redumper.js --platform=... --arch=${archName}") — CD-from-drive will be unavailable in this build.`
    );
    return;
  }

  let resourcesDir;
  if (electronPlatformName === 'darwin') {
    const appBundle = fs.readdirSync(appOutDir).find((e) => e.endsWith('.app'));
    if (!appBundle) {
      console.warn(`[after-pack] no .app bundle found in ${appOutDir}, skipping redumper bundling`);
      return;
    }
    resourcesDir = path.join(appOutDir, appBundle, 'Contents', 'Resources');
  } else {
    resourcesDir = path.join(appOutDir, 'resources');
  }

  const destDir = path.join(resourcesDir, 'redumper');
  fs.cpSync(srcDir, destDir, { recursive: true });
  console.log(`[after-pack] bundled redumper (${platformDir}-${archName}) → ${destDir}`);
};
