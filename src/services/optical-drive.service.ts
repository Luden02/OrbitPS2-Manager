import * as fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createLogger, formatBytes } from "../logger";

const log = createLogger("optical-drive");
const execFileAsync = promisify(execFile);

export interface OpticalDrive {
  /** OS path used to open the device for raw reads. */
  device: string;
  /** Human-readable label for the UI. */
  label: string;
}

export interface RipDvdResult {
  success: boolean;
  message?: string;
  isoPath?: string;
}

const ISO_SECTOR_SIZE = 2048;
const PVD_SECTOR = 16; // ISO9660 Primary Volume Descriptor
const COPY_CHUNK_BYTES = 512 * ISO_SECTOR_SIZE; // 1 MiB
/** Files produced by ripOpticalDvd are named with this prefix so cleanup can
 *  be restricted to our own temp artifacts and never an arbitrary path. */
export const TEMP_RIP_PREFIX = ".tmp_dvd_rip_";

/**
 * List optical drives, best-effort per OS. Never throws — the UI always
 * offers a manual device-path field as a fallback when detection misses.
 */
export async function listOpticalDrives(): Promise<OpticalDrive[]> {
  try {
    if (process.platform === "win32") return await listWindowsDrives();
    if (process.platform === "darwin") return await listMacDrives();
    return await listLinuxDrives();
  } catch (err: any) {
    log.verbose(`Optical drive detection failed: ${err?.message || err}`);
    return [];
  }
}

async function listWindowsDrives(): Promise<OpticalDrive[]> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance -ClassName Win32_CDROMDrive | Select-Object Drive,Caption | ConvertTo-Json -Compress",
    ],
    { windowsHide: true }
  );
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .filter((r) => r?.Drive)
    .map((r) => ({
      device: `\\\\.\\${r.Drive}`,
      label: `${r.Drive} — ${r.Caption || "Optical Drive"}`,
    }));
}

// macOS has no stable device node per optical drive, so this surfaces every
// external/internal physical whole disk (same category a mounted disc shows
// up under) and lets the user pick by media name. It can also list a plain
// external USB stick — acceptable since the manual path field covers misses.
async function listMacDrives(): Promise<OpticalDrive[]> {
  const { stdout } = await execFileAsync("diskutil", ["list"]);
  const deviceRe = /^(\/dev\/disk\d+)\s*\((?:external|internal), physical\):/gm;
  const devices = Array.from(stdout.matchAll(deviceRe)).map((m) => m[1]);

  const drives: OpticalDrive[] = [];
  for (const dev of devices) {
    try {
      const { stdout: info } = await execFileAsync("diskutil", ["info", dev]);
      const nameMatch = info.match(/Device\s*\/\s*Media Name:\s*(.+)/);
      const label = nameMatch?.[1]?.trim() || dev;
      // Raw (character) device avoids the buffer cache for large sequential reads.
      drives.push({ device: dev.replace("/dev/disk", "/dev/rdisk"), label: `${label} (${dev})` });
    } catch (err: any) {
      log.verbose(`diskutil info failed for ${dev}: ${err?.message || err}`);
    }
  }
  return drives;
}

async function listLinuxDrives(): Promise<OpticalDrive[]> {
  const candidates = ["/dev/sr0", "/dev/sr1", "/dev/sr2", "/dev/sr3", "/dev/cdrom", "/dev/dvd"];
  const seenRealPaths = new Set<string>();
  const drives: OpticalDrive[] = [];
  for (const dev of candidates) {
    try {
      const real = await fs.realpath(dev);
      if (seenRealPaths.has(real)) continue;
      seenRealPaths.add(real);
      drives.push({ device: real, label: real });
    } catch {
      // doesn't exist — skip
    }
  }
  return drives;
}

/**
 * Read the ISO9660 Primary Volume Descriptor to get the exact data size in
 * bytes. This avoids any OS-specific "get device length" call — the disc
 * tells us how much to read, and we stop there regardless of platform.
 */
async function readIso9660VolumeSize(handle: fs.FileHandle): Promise<number> {
  const buf = Buffer.alloc(ISO_SECTOR_SIZE);
  const { bytesRead } = await handle.read(buf, 0, ISO_SECTOR_SIZE, PVD_SECTOR * ISO_SECTOR_SIZE);
  if (bytesRead < ISO_SECTOR_SIZE) {
    throw new Error("Could not read the disc's volume descriptor — is a disc inserted?");
  }
  if (buf[0] !== 1 || buf.toString("ascii", 1, 6) !== "CD001") {
    throw new Error("Disc does not contain a valid ISO9660 filesystem.");
  }
  // Volume Space Size (both-endian): LE uint32 at offset 80.
  return buf.readUInt32LE(80) * ISO_SECTOR_SIZE;
}

/**
 * Rip a PS2 DVD straight from an optical drive into a plain .iso under
 * `destDir`, named with TEMP_RIP_PREFIX. The caller is expected to stage,
 * rename and move this file exactly like a user-picked .iso.
 */
export async function ripOpticalDvd(
  devicePath: string,
  destDir: string,
  onProgress?: (percent: number, stage: string) => void
): Promise<RipDvdResult> {
  let handle: fs.FileHandle | null = null;
  let outHandle: fs.FileHandle | null = null;
  const tempPath = path.join(destDir, `${TEMP_RIP_PREFIX}${Date.now()}.iso`);

  try {
    await fs.mkdir(destDir, { recursive: true });
    if (onProgress) onProgress(0, "Opening drive");
    handle = await fs.open(devicePath, "r");

    if (onProgress) onProgress(2, "Reading disc volume size");
    const totalBytes = await readIso9660VolumeSize(handle);
    log.info(`DVD rip: ${devicePath} → ${tempPath} (${formatBytes(totalBytes)})`);

    outHandle = await fs.open(tempPath, "w");
    const readBuffer = Buffer.alloc(COPY_CHUNK_BYTES);
    let position = 0;
    let lastReportedPercent = -1;

    while (position < totalBytes) {
      const bytesToRead = Math.min(COPY_CHUNK_BYTES, totalBytes - position);
      const { bytesRead } = await handle.read(readBuffer, 0, bytesToRead, position);
      if (bytesRead === 0) {
        throw new Error(
          `Drive returned no data at ${formatBytes(position)} of ${formatBytes(totalBytes)} — ` +
            "disc may be dirty/scratched, or was ejected mid-read."
        );
      }
      await outHandle.write(readBuffer, 0, bytesRead);
      position += bytesRead;

      if (onProgress) {
        const percent = Math.min(99, Math.floor((position / totalBytes) * 100));
        if (percent !== lastReportedPercent) {
          onProgress(percent, `Reading disc (${formatBytes(position)} / ${formatBytes(totalBytes)})`);
          lastReportedPercent = percent;
        }
      }
    }

    await outHandle.close();
    outHandle = null;
    await handle.close();
    handle = null;

    if (onProgress) onProgress(100, "Done");
    log.info(`DVD rip complete: ${tempPath}`);
    return { success: true, isoPath: tempPath };
  } catch (err: any) {
    log.error(`DVD rip failed for ${devicePath}:`, err?.message || err);
    try {
      await outHandle?.close();
    } catch {
      // ignore
    }
    try {
      await handle?.close();
    } catch {
      // ignore
    }
    try {
      await fs.rm(tempPath, { force: true });
    } catch {
      // ignore
    }
    return { success: false, message: err?.message || String(err) };
  }
}

/** Delete a temp rip file. Restricted to our own naming convention so a bad
 *  path from the renderer can never delete anything else. */
export async function deleteTempRipFile(isoPath: string): Promise<{ success: boolean; message?: string }> {
  if (!path.basename(isoPath).startsWith(TEMP_RIP_PREFIX)) {
    return { success: false, message: "Refusing to delete a non-temp-rip file." };
  }
  try {
    await fs.rm(isoPath, { force: true });
    return { success: true };
  } catch (err: any) {
    return { success: false, message: err?.message || String(err) };
  }
}
