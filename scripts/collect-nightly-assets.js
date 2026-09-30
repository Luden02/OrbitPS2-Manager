/**
 * Renames electron-builder output to stable Nightly filenames and writes
 * SHA256SUMS. Platform comes from the Actions artifact directory, because the
 * linux zip rename hook can also rewrite a Windows zip.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STABLE = {
  'win-exe': 'OrbitPS2Manager-Nightly-win-x64.exe',
  'win-zip': 'OrbitPS2Manager-Nightly-win-x64.zip',
  'mac-arm64': 'OrbitPS2Manager-Nightly-mac-arm64.dmg',
  'mac-x64': 'OrbitPS2Manager-Nightly-mac-x64.dmg',
  'linux-appimage': 'OrbitPS2Manager-Nightly-linux-x64.AppImage',
  'linux-deb': 'OrbitPS2Manager-Nightly-linux-x64.deb',
  'linux-rpm': 'OrbitPS2Manager-Nightly-linux-x64.rpm',
  'linux-zip': 'OrbitPS2Manager-Nightly-linux-x64.zip',
};

function platformOf(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.includes('/nightly-windows')) return 'win';
  if (normalized.includes('/nightly-macos')) return 'mac';
  if (normalized.includes('/nightly-ubuntu') || normalized.includes('/nightly-linux')) return 'linux';
  return null;
}

function classify(filePath) {
  const base = path.basename(filePath);
  if (
    base === 'SHA256SUMS' ||
    base.endsWith('.blockmap') ||
    base.endsWith('.yml') ||
    base.endsWith('.yaml')
  ) {
    return null;
  }

  const platform = platformOf(filePath);
  if (base.endsWith('.exe')) return 'win-exe';
  if (base.endsWith('.dmg')) {
    if (/arm64|aarch64/i.test(base)) return 'mac-arm64';
    if (/x64|x86_64|amd64/i.test(base)) return 'mac-x64';
    // electron-builder leaves the arch off the x64 DMG: "Product-1.3.1.dmg".
    if (platform === 'mac') return 'mac-x64';
    return null;
  }
  if (base.endsWith('.AppImage')) return 'linux-appimage';
  if (base.endsWith('.deb')) return 'linux-deb';
  if (base.endsWith('.rpm')) return 'linux-rpm';
  if (base.endsWith('.zip')) {
    if (platform === 'win') return 'win-zip';
    if (platform === 'linux') return 'linux-zip';
    if (/-win/i.test(base)) return 'win-zip';
    if (/-linux-/i.test(base)) return 'linux-zip';
  }
  return null;
}

function planNightlyAssets(files) {
  const assigned = new Map();
  for (const file of files) {
    const kind = classify(file);
    if (!kind) continue;
    if (assigned.has(kind)) {
      throw new Error(`duplicate ${kind}: ${assigned.get(kind)} and ${file}`);
    }
    assigned.set(kind, file);
  }

  const missing = Object.keys(STABLE)
    .filter((kind) => !assigned.has(kind))
    .map((kind) => STABLE[kind]);
  const outputs = [...assigned.entries()].map(([kind, source]) => ({
    source,
    name: STABLE[kind],
  }));
  return { outputs, missing };
}

async function materializeNightlyAssets(files, dest) {
  const plan = planNightlyAssets(files);
  if (plan.missing.length > 0) {
    throw new Error(`missing nightly assets: ${plan.missing.join(', ')}`);
  }

  await fs.promises.mkdir(dest, { recursive: true });
  const lines = [];
  const sorted = [...plan.outputs].sort((a, b) => a.name.localeCompare(b.name));
  for (const item of sorted) {
    const target = path.join(dest, item.name);
    await fs.promises.copyFile(item.source, target);
    const hash = crypto.createHash('sha256').update(await fs.promises.readFile(target)).digest('hex');
    lines.push(`${hash}  ${item.name}`);
  }
  await fs.promises.writeFile(path.join(dest, 'SHA256SUMS'), `${lines.join('\n')}\n`);
  return plan;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

async function run(argv) {
  const [src, dest] = argv;
  if (!src || !dest) {
    return {
      code: 2,
      error: 'usage: node scripts/collect-nightly-assets.js <artifact-dir> <dest-dir>',
    };
  }
  try {
    await materializeNightlyAssets(walk(src), dest);
    return { code: 0 };
  } catch (error) {
    return { code: 1, error: error.message || String(error) };
  }
}

function main() {
  run(process.argv.slice(2)).then((result) => {
    if (result.error) console.error(result.error);
    if (result.code !== 0) process.exit(result.code);
  });
}

if (require.main === module) {
  main();
}

module.exports = { planNightlyAssets, materializeNightlyAssets, classify, run };
