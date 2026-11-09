const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Homebrew's rpm (6.x) ignores fpm's "--define buildroot ..." override and
// resolves its own internal build root, so every file in %files comes back
// "not found". Only the deprecated "--buildroot" CLI flag still works. fpm
// (bundled by electron-builder, last updated 2015) never got fixed for this.
const BROKEN = '"--define", "buildroot #{build_path}/BUILD",';
const FIXED = '"--buildroot", "#{build_path}/BUILD",';

if (process.platform !== 'darwin') process.exit(0);

// On a cold cache electron-builder only downloads fpm mid-build, after this
// script ran, so fetch it up front with the same tool (a no-op when cached).
const FPM = 'fpm-1.9.3-20150715-2.2.2-mac';
execFileSync(require('app-builder-bin').appBuilderPath, [
  'download-artifact',
  '--name', FPM,
  '--url', `https://github.com/electron-userland/electron-builder-binaries/releases/download/${FPM}/${FPM}.7z`,
], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, SZA_PATH: require('7zip-bin').path7za } });

const cacheDir = path.join(os.homedir(), 'Library', 'Caches', 'electron-builder', 'fpm');

for (const entry of fs.readdirSync(cacheDir)) {
  const rpmRb = path.join(cacheDir, entry, 'lib/app/lib/fpm/package/rpm.rb');
  if (!fs.existsSync(rpmRb)) continue;
  const original = fs.readFileSync(rpmRb, 'utf8');
  if (!original.includes(BROKEN)) continue;
  fs.writeFileSync(rpmRb, original.replace(BROKEN, FIXED));
  console.log(`Patched ${rpmRb} for rpm 6.x --buildroot compatibility`);
}
