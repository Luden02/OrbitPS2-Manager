// Downloads the bundled `redumper` CLI (used for CD-from-drive import) into
// resources/redumper/<platform>-<arch>/ so it can be picked up by
// src/services/redumper.service.ts (dev) or scripts/after-pack.js (packaged).
//
// Pinned to one redumper release so builds stay reproducible; bump
// package.json's "redumper".version deliberately to pick up a newer one.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');

const REDUMPER_VERSION = require('../package.json').redumper.version;
const RESOURCES_DIR = path.join(__dirname, '..', 'resources', 'redumper');

// Maps our short platform/arch args to redumper's release asset naming.
const PLATFORM_NAMES = { win: 'windows', mac: 'macos', linux: 'linux' };

function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? true];
    })
  );
  const platform =
    args.platform || (process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux');
  const arch = args.arch || process.arch;
  return { platform, arch };
}

async function downloadToBuffer(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}): ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function fetchRedumper(platform, arch) {
  const destDir = path.join(RESOURCES_DIR, `${PLATFORM_NAMES[platform]}-${arch}`);
  const binName = platform === 'win' ? 'redumper.exe' : 'redumper';
  const binPath = path.join(destDir, 'bin', binName);
  const stampPath = path.join(destDir, '.version');
  const stamped = fs.existsSync(stampPath) ? fs.readFileSync(stampPath, 'utf8').trim() : '';

  if (fs.existsSync(binPath) && stamped === REDUMPER_VERSION) {
    console.log(`[fetch-redumper] already present (${REDUMPER_VERSION}): ${binPath}`);
    return;
  }
  // Bumping the pin has to replace a previously fetched version, not keep it.
  fs.rmSync(destDir, { recursive: true, force: true });

  const assetName = `redumper-${REDUMPER_VERSION}-${PLATFORM_NAMES[platform]}-${arch}.zip`;
  const url = `https://github.com/superg/redumper/releases/download/${REDUMPER_VERSION}/${assetName}`;
  console.log(`[fetch-redumper] downloading ${assetName}…`);

  const zipBuffer = await downloadToBuffer(url);
  fs.mkdirSync(destDir, { recursive: true });
  new AdmZip(zipBuffer).extractAllTo(destDir, true);

  // The release zip wraps its "bin/"+"lib/" payload in a single top-level
  // "redumper-<version>-<platform>-<arch>/" folder — flatten it into destDir.
  const entries = fs.readdirSync(destDir, { withFileTypes: true });
  if (!fs.existsSync(binPath) && entries.length === 1 && entries[0].isDirectory()) {
    const nested = path.join(destDir, entries[0].name);
    for (const child of fs.readdirSync(nested)) {
      fs.renameSync(path.join(nested, child), path.join(destDir, child));
    }
    fs.rmdirSync(nested);
  }

  if (!fs.existsSync(binPath)) {
    throw new Error(`Extracted ${assetName} but ${binPath} is missing — archive layout may have changed.`);
  }

  // adm-zip doesn't materialize zip-stored symlinks (macOS's versioned
  // "libc++.1.dylib -> libc++.1.0.dylib" style links) — it writes the link
  // target string as a plain text file instead. Fix those up so dyld can
  // actually resolve them.
  const libDir = path.join(destDir, 'lib');
  if (fs.existsSync(libDir)) {
    const siblings = new Set(fs.readdirSync(libDir));
    for (const name of siblings) {
      const full = path.join(libDir, name);
      const stat = fs.lstatSync(full);
      if (!stat.isFile() || stat.size > 256) continue;
      const content = fs.readFileSync(full, 'utf8').trim();
      if (content && content !== name && siblings.has(content)) {
        fs.rmSync(full);
        fs.symlinkSync(content, full);
      }
    }
  }

  if (platform !== 'win') {
    fs.chmodSync(binPath, 0o755);
  }
  if (platform === 'mac') {
    try {
      execFileSync('codesign', ['--force', '--sign', '-', binPath]);
    } catch (err) {
      console.warn(`[fetch-redumper] ad-hoc codesign failed (non-fatal): ${err.message}`);
    }
  }

  fs.writeFileSync(stampPath, REDUMPER_VERSION);
  console.log(`[fetch-redumper] ready (${REDUMPER_VERSION}): ${binPath}`);
}

const { platform, arch } = parseArgs();
if (!PLATFORM_NAMES[platform]) {
  console.error(`[fetch-redumper] unknown platform "${platform}" (expected win/mac/linux)`);
  process.exit(1);
}

fetchRedumper(platform, arch).catch((err) => {
  console.error(`[fetch-redumper] ${err.message}`);
  process.exit(1);
});
