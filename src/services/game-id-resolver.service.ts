import * as fs from "fs/promises";
import path from "path";
import { getCachedGameId, setCachedGameId } from "./iso-cache.service";
import { createLogger, formatBytes } from "../logger";
import { describeFileAccessError } from "../utils/file-access-error";
import {
  PS1_GAME_ID_PREFIXES,
  PS2_GAME_ID_REGEX,
  FILE_SCAN_CHUNK_BYTES,
  FILE_SCAN_OVERLAP_BYTES,
  VCD_HEADER_SIZE,
  normaliseGameIdForLookup,
} from "../utils/game-id-patterns";
import {
  findPs1GameName,
  findPs2GameName,
  isPs1GameIdAmbiguous,
} from "../utils/games-list";
import { parseCueSheet, getCueDirectory, msfToSectors } from "../utils/cue-parser";
import { streamZsoContents } from "./zso.service";
import { extractDiscZip, cleanupExtractedZip } from "../utils/zip-extract";
import {
  lookupPs1GameIdByPvdTimestamp,
  ps1PvdDiscTitle,
} from "../utils/ps1-pvd-game-id";
import {
  isKnownPs1Conflict,
  matchPs1Conflict,
} from "../utils/ps1-disc-identity";

const log = createLogger("game-id");

export interface Ps1GameIdResult {
  success: boolean;
  gameId?: string;
  formattedGameId?: string;
  gameName?: string;
  message?: string;
  identificationStatus?: "identified" | "ambiguous" | "unidentified";
  identificationMethod?: "boot" | "pvd" | "md5";
  internalGameId?: string;
  /** Disc identity may be a GDX-X alias; gameId remains the artwork lookup key. */
  discId?: string;
}

function readLe32(buffer: Buffer, offset: number): number {
  return (
    buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16) |
    (buffer[offset + 3] << 24)
  ) >>> 0;
}

const ISO_BLOCK_SIZE = 2048;


function fromBcd(value: number): number {
  return Math.floor(value / 16) * 10 + (value % 16);
}

/**
 * POPS VCD payloads normally begin with track 1 at byte 0, but a CUE may
 * preserve a non-zero INDEX 01 pregap in the BIN. cue2pops stores track 1's
 * INDEX 01 in the VCD header with its +2 second adjustment, so undo that here
 * before traversing ISO9660 structures inside the payload.
 */
async function ps1VcdDataOffset(fileHandle: fs.FileHandle): Promise<number> {
  const header = Buffer.alloc(40);
  const signature = Buffer.alloc(4);
  const [headRead, sigRead] = await Promise.all([
    fileHandle.read(header, 0, header.length, 0),
    fileHandle.read(signature, 0, signature.length, 1024),
  ]);

  if (
    headRead.bytesRead < header.length ||
    sigRead.bytesRead < signature.length ||
    signature.toString("ascii") !== "kHn "
  ) {
    return VCD_HEADER_SIZE;
  }

  const trackCount = fromBcd(header[17]);
  if (!trackCount || header[30] !== 0x41) {
    return VCD_HEADER_SIZE;
  }

  const mm = fromBcd(header[37]);
  const ss = fromBcd(header[38]);
  const ff = fromBcd(header[39]);
  const adjustedFrames = mm * 60 * 75 + ss * 75 + ff;
  const payloadFrames = Math.max(0, adjustedFrames - 2 * 75);
  return VCD_HEADER_SIZE + payloadFrames * 2352;
}

/**
 * Sector layouts a PS1 image can use. `dataOffset` is where the 2048 bytes of
 * user data start inside each physical sector:
 * - plain ISO: 2048-byte sectors, no framing;
 * - MODE1/2352: 12-byte sync + 4-byte header;
 * - MODE2/2352 (CD-XA Form 1 — every pressed PS1 disc and POPS VCD payload):
 *   12-byte sync + 4-byte header + 8-byte subheader.
 */
const SECTOR_LAYOUTS = [
  { sectorSize: 2048, dataOffset: 0 },
  { sectorSize: 2352, dataOffset: 24 },
  { sectorSize: 2352, dataOffset: 16 },
];

/**
 * Read `length` bytes of logical (user) data starting at logical block `lba`,
 * skipping per-sector framing so multi-sector reads stay contiguous.
 */
async function readUserData(
  fileHandle: fs.FileHandle,
  baseOffset: number,
  layout: { sectorSize: number; dataOffset: number },
  lba: number,
  length: number
): Promise<Buffer | null> {
  const out = Buffer.alloc(length);
  let written = 0;
  let block = lba;

  while (written < length) {
    const chunk = Math.min(ISO_BLOCK_SIZE, length - written);
    const position = baseOffset + block * layout.sectorSize + layout.dataOffset;
    const { bytesRead } = await fileHandle.read(out, written, chunk, position);
    if (bytesRead !== chunk) return null;
    written += chunk;
    block++;
  }

  return out;
}

/**
 * RetroGem-compatible primary PS1 identity path: locate the ISO9660 PVD,
 * traverse the root directory for SYSTEM.CNF, then read the BOOT target.
 *
 * Supports 2048-byte ISO sectors and raw 2352-byte MODE1/MODE2 BIN sectors.
 * The base offset lets the same parser operate on POPS VCD payloads after the
 * 1 MiB header.
 */
async function tryReadPs1IdFromSystemCnf(
  fileHandle: fs.FileHandle,
  baseOffset = 0
): Promise<string | null> {
  for (const layout of SECTOR_LAYOUTS) {
    const pvd = await readUserData(fileHandle, baseOffset, layout, 16, ISO_BLOCK_SIZE);
    if (
      !pvd ||
      pvd[0] !== 0x01 ||
      pvd.subarray(1, 6).toString("ascii") !== "CD001"
    ) {
      continue;
    }

    const rootLba = readLe32(pvd, 158);
    const rootLen = readLe32(pvd, 166);
    if (rootLen <= 0 || rootLen > 32768) continue;

    const dirBuf = await readUserData(fileHandle, baseOffset, layout, rootLba, rootLen);
    if (!dirBuf) continue;

    let off = 0;
    while (off < rootLen) {
      const recLen = dirBuf[off];
      if (recLen === 0) {
        // Directory records never straddle a logical block; zero padding means
        // "continue at the next 2048-byte block".
        off = (Math.floor(off / ISO_BLOCK_SIZE) + 1) * ISO_BLOCK_SIZE;
        continue;
      }
      if (recLen < 34 || off + recLen > rootLen || off + 33 > rootLen) break;

      const nameLen = dirBuf[off + 32];
      if (nameLen > 0 && 33 + nameLen <= recLen) {
        const name = dirBuf
          .subarray(off + 33, off + 33 + nameLen)
          .toString("ascii")
          .toUpperCase();

        if (/^SYSTEM\.CNF(?:;1)?$/.test(name)) {
          const sysLba = readLe32(dirBuf, off + 2);
          const sysSize = readLe32(dirBuf, off + 10);
          if (sysSize > 0 && sysSize < 4096) {
            const sysBuf = await readUserData(
              fileHandle,
              baseOffset,
              layout,
              sysLba,
              sysSize
            );
            if (sysBuf) {
              const text = sysBuf.toString("latin1");
              // Only the BOOT assignment identifies the launched executable.
              // Comments and unrelated keys can contain serial-looking strings
              // belonging to demos, menus, or another disc.
              const boots = Array.from(
                text.matchAll(/^[\t ]*BOOT[\t ]*=[\t ]*([^\r\n]+)/gim),
              );
              if (boots.length !== 1) return null;
              const target = boots[0][1].trim().replace(/^"(.*)"$/, "$1");
              const executable = target.match(
                /^cdrom\d*:[\\/]*(?:[^\\/\s]+[\\/])*([A-Z]{4})[_-](\d{3})\.?(\d{2})(?:;1)?[\t ]*$/i,
              );
              if (
                executable &&
                PS1_GAME_ID_PREFIXES.includes(executable[1].toUpperCase())
              ) {
                return (
                  executable[1].toUpperCase() +
                  "_" +
                  executable[2] +
                  "." +
                  executable[3]
                );
              }
            }
          }
        }
      }
      off += recLen;
    }
  }

  return null;
}

/**
 * Generic-boot PS1 identity fallback used by pcm720/OSDMenu: when SYSTEM.CNF
 * does not contain a serial-shaped executable name, use the ISO9660 Primary
 * Volume Descriptor's 16-byte creation timestamp to resolve a known disc ID.
 *
 * A generic-boot disc can contain unrelated serial-looking strings elsewhere
 * in its data, so the verified PVD timestamp table is the only automatic
 * fallback after SYSTEM.CNF. Orbit does not guess from arbitrary raw serial
 * text when structured identification fails.
 */
async function tryReadPs1IdFromPvdTimestamp(
  fileHandle: fs.FileHandle,
  baseOffset = 0
): Promise<{ gameId: string; timestamp: string } | null> {
  for (const layout of SECTOR_LAYOUTS) {
    const pvd = await readUserData(
      fileHandle,
      baseOffset,
      layout,
      16,
      ISO_BLOCK_SIZE
    );
    if (
      !pvd ||
      pvd[0] !== 0x01 ||
      pvd.subarray(1, 6).toString("ascii") !== "CD001"
    ) {
      continue;
    }

    // ISO9660 PVD volume creation date: byte offset 0x32D, 16 ASCII digits.
    const timestamp = pvd.subarray(0x32d, 0x32d + 16).toString("ascii");
    if (!/^\d{16}$/.test(timestamp)) continue;

    const gameId = lookupPs1GameIdByPvdTimestamp(timestamp);
    if (gameId) return { gameId, timestamp };
  }

  return null;
}

/**
 * Resolves the PS2 game ID for an ISO that doesn't carry the GAMEID prefix
 * in its filename (the "new" OPL naming convention — OPL reads the ID from
 * the disc's SYSTEM.CNF). Results are cached per (path, size, mtime) so
 * library scans only pay the hex-scan cost the first time.
 */
export async function resolveIsoGameId(
  filepath: string
): Promise<{
  success: boolean;
  gameId?: string;
  gameName?: string;
  message?: string;
}> {
  let stat;
  try {
    stat = await fs.stat(filepath);
  } catch (err: any) {
    log.error(`Cannot stat ${filepath} for ID resolution:`, err?.message || err);
    return { success: false, message: describeFileAccessError(err, filepath) };
  }

  const cached = getCachedGameId(filepath, stat.size, stat.mtimeMs);
  if (cached) {
    log.verbose(`Resolved ${path.basename(filepath)} from cache → ${cached.gameId}`);
    return { success: true, gameId: cached.gameId, gameName: cached.gameName };
  }

  const isZso = path.extname(filepath).toLowerCase() === ".zso";
  log.verbose(
    `Cache miss for ${path.basename(filepath)} (${formatBytes(stat.size)}) — ` +
      `scanning ${isZso ? "decompressed ZSO" : "raw image"} for game ID`
  );
  const result = isZso
    ? await tryDetermineGameIdFromZso(filepath)
    : await tryDetermineGameIdFromHex(filepath);
  if (result && (result as any).success) {
    const r = result as any;
    setCachedGameId(filepath, stat.size, stat.mtimeMs, r.gameId, r.gameName);
    const titleSuffix = r.gameName ? ` (${r.gameName})` : "";
    log.info(`Resolved ${path.basename(filepath)} → ${r.gameId}${titleSuffix}`);
    return { success: true, gameId: r.gameId, gameName: r.gameName };
  }
  log.warn(`Could not resolve a game ID for ${path.basename(filepath)}`);
  return {
    success: false,
    message: (result as any)?.message || "Could not resolve game ID.",
  };
}

export async function tryDetermineGameIdFromHex(filepath: string) {
  let scanPath = filepath;

  if (path.extname(filepath).toLowerCase() === ".cue") {
    try {
      const cueSheet = await parseCueSheet(filepath);
      const dataFile =
        cueSheet.files.find((file) =>
          file.tracks.some((track) => /^MODE[12]\//i.test(track.type))
        )?.filename || cueSheet.files[0]?.filename;
      if (!dataFile) {
        return {
          success: false,
          message: "CUE sheet does not reference a readable data track.",
        };
      }
      scanPath = path.join(getCueDirectory(filepath), dataFile);
      log.verbose(`PS2 hex scan: resolved CUE data track to ${dataFile}`);
    } catch (err: any) {
      log.error(`PS2 hex scan: failed to parse CUE ${filepath}:`, err?.message || err);
      return {
        success: false,
        message: err?.message || "Failed to parse CUE sheet.",
      };
    }
  }

  let fileHandle: fs.FileHandle | undefined;

  try {
    fileHandle = await fs.open(scanPath, "r");
  } catch (err: any) {
    log.error(`PS2 hex scan: cannot open ${scanPath}:`, err?.code || err?.message || err);
    return {
      success: false,
      message: describeFileAccessError(err, scanPath),
    };
  }

  try {
    log.verbose(`PS2 hex scan: reading ${path.basename(scanPath)} in ${FILE_SCAN_CHUNK_BYTES / 1024}KB chunks`);
    const buffer = Buffer.alloc(FILE_SCAN_CHUNK_BYTES);
    let position = 0;
    let carry = "";

    while (true) {
      const { bytesRead } = await fileHandle.read(
        buffer,
        0,
        FILE_SCAN_CHUNK_BYTES,
        position
      );

      if (bytesRead === 0) {
        break;
      }

      position += bytesRead;

      const chunk = carry + buffer.subarray(0, bytesRead).toString("latin1");
      PS2_GAME_ID_REGEX.lastIndex = 0;
      const matches = chunk.match(PS2_GAME_ID_REGEX);

      if (matches && matches.length > 0) {
        const gameId = matches[0].replace(/;1$/, "");
        const lookupId = normaliseGameIdForLookup(gameId);
        const gameName = await findPs2GameName(lookupId);

        log.verbose(
          `PS2 hex scan: matched ${gameId} within first ${formatBytes(position)}` +
            (gameName ? ` (${gameName})` : " (no title in games list)")
        );
        return {
          success: true,
          gameId,
          formattedGameId: lookupId,
          ...(gameName ? { gameName } : {}),
        };
      }

      carry =
        chunk.length > FILE_SCAN_OVERLAP_BYTES
          ? chunk.slice(-FILE_SCAN_OVERLAP_BYTES)
          : chunk;
    }

    log.verbose(`PS2 hex scan: no game ID found after reading ${formatBytes(position)}`);
    return {
      success: false,
      message: "Could not locate a PS2 game ID inside the provided file.",
    };
  } catch (err: any) {
    log.error(`PS2 hex scan: read error on ${path.basename(scanPath)}:`, err?.message || err);
    return {
      success: false,
      message: err?.message || "Failed while reading file contents.",
    };
  } finally {
    if (fileHandle) {
      await fileHandle.close();
    }
  }
}

export async function tryDetermineGameIdFromZso(filepath: string) {
  const SCAN_FLUSH_BYTES = FILE_SCAN_CHUNK_BYTES;
  const SCAN_LIMIT_BYTES = 64 * 1024 * 1024;
  let pending = "";
  let foundId: string | null = null;

  const scan = (text: string): boolean => {
    PS2_GAME_ID_REGEX.lastIndex = 0;
    const matches = text.match(PS2_GAME_ID_REGEX);
    if (matches && matches.length > 0) {
      foundId = matches[0].replace(/;1$/, "");
      return true;
    }
    return false;
  };

  const result = await streamZsoContents(
    filepath,
    (chunk) => {
      pending += chunk.toString("latin1");
      if (pending.length < SCAN_FLUSH_BYTES) {
        return false;
      }
      if (scan(pending)) {
        return true;
      }
      pending = pending.slice(-FILE_SCAN_OVERLAP_BYTES);
      return false;
    },
    SCAN_LIMIT_BYTES
  );

  if (!foundId && pending) {
    scan(pending);
  }

  if (foundId) {
    const lookupId = normaliseGameIdForLookup(foundId);
    const gameName = await findPs2GameName(lookupId);
    log.verbose(
      `ZSO scan: matched ${foundId}` +
        (gameName ? ` (${gameName})` : " (no title in games list)")
    );
    return {
      success: true,
      gameId: foundId,
      formattedGameId: lookupId,
      ...(gameName ? { gameName } : {}),
    };
  }

  if (!result.success) {
    log.error(`ZSO scan: failed to read ${path.basename(filepath)}: ${result.message}`);
    return {
      success: false,
      message: result.message || "Failed while reading ZSO contents.",
    };
  }

  log.verbose(`ZSO scan: no game ID found in ${path.basename(filepath)}`);
  return {
    success: false,
    message: "Could not locate a PS2 game ID inside the ZSO image.",
  };
}

async function resolvePs1Candidate(
  filePath: string,
  internalGameId: string,
  dataTrackOffset: number,
  method: "boot" | "pvd",
  pvdTitle?: string | null,
): Promise<Ps1GameIdResult> {
  const lookupId = normaliseGameIdForLookup(internalGameId);
  const ambiguous =
    isKnownPs1Conflict(internalGameId) ||
    (await isPs1GameIdAmbiguous(lookupId));

  if (ambiguous && !pvdTitle) {
    const match = await matchPs1Conflict(
      filePath,
      internalGameId,
      dataTrackOffset,
    );
    if (!match) {
      return {
        success: true,
        gameId: internalGameId,
        formattedGameId: lookupId,
        identificationStatus: "ambiguous",
        identificationMethod: method,
        internalGameId,
        message:
          "This PS1 serial is shared by multiple discs or editions and its checksum did not match a verified conflict rule.",
      };
    }

    const resolvedLookup = normaliseGameIdForLookup(match.discId);
    const gameName = (await findPs1GameName(resolvedLookup)) || match.title;
    return {
      success: true,
      gameId: internalGameId,
      formattedGameId: lookupId,
      gameName,
      identificationStatus: "identified",
      identificationMethod: "md5",
      internalGameId,
      discId: match.discId,
    };
  }

  const gameName = pvdTitle || (await findPs1GameName(lookupId));
  return {
    success: true,
    gameId: internalGameId,
    formattedGameId: lookupId,
    ...(gameName ? { gameName } : {}),
    identificationStatus: "identified",
    identificationMethod: method,
    internalGameId,
    discId: internalGameId,
  };
}

function cueTrackByteOffset(track: {
  type: string;
  indexes: Array<{
    number: number;
    minutes: number;
    seconds: number;
    frames: number;
  }>;
}): number {
  const index = track.indexes.find((entry) => entry.number === 1);
  if (!index) return 0;
  const sectorSize = /\/2048$/i.test(track.type) ? 2048 : 2352;
  return (
    msfToSectors(index.minutes, index.seconds, index.frames) * sectorSize
  );
}

export async function tryDeterminePs1GameIdFromVcd(
  filepath: string,
): Promise<Ps1GameIdResult> {
  let fileHandle: fs.FileHandle | undefined;

  try {
    fileHandle = await fs.open(filepath, "r");
  } catch (err: any) {
    log.error(`PS1 VCD scan: cannot open ${filepath}:`, err?.code || err?.message || err);
    return {
      success: false,
      identificationStatus: "unidentified",
      message: describeFileAccessError(err, filepath),
    };
  }

  try {
    const dataOffset = await ps1VcdDataOffset(fileHandle);
    const systemCnfId = await tryReadPs1IdFromSystemCnf(
      fileHandle,
      dataOffset,
    );
    if (systemCnfId) {
      const result = await resolvePs1Candidate(
        filepath,
        systemCnfId,
        dataOffset,
        "boot",
      );
      log.verbose(
        `PS1 VCD scan: SYSTEM.CNF resolved ${systemCnfId}` +
          (result.gameName ? ` (${result.gameName})` : ""),
      );
      return result;
    }

    const pvd = await tryReadPs1IdFromPvdTimestamp(
      fileHandle,
      dataOffset,
    );
    if (pvd) {
      const result = await resolvePs1Candidate(
        filepath,
        pvd.gameId,
        dataOffset,
        "pvd",
        ps1PvdDiscTitle(pvd.timestamp),
      );
      log.verbose(
        `PS1 VCD scan: PVD timestamp resolved ${pvd.gameId}` +
          (result.gameName ? ` (${result.gameName})` : ""),
      );
      return result;
    }

    log.verbose(
      `PS1 VCD scan: no structured disc identity found in ${path.basename(filepath)}`,
    );
    return {
      success: false,
      identificationStatus: "unidentified",
      message:
        "Could not identify this PS1 disc from SYSTEM.CNF or the verified PVD timestamp table.",
    };
  } catch (err: any) {
    log.error(`PS1 VCD scan: read error on ${path.basename(filepath)}:`, err?.message || err);
    return {
      success: false,
      identificationStatus: "unidentified",
      message: err?.message || "Failed while reading VCD file contents.",
    };
  } finally {
    if (fileHandle) await fileHandle.close();
  }
}

export async function tryDeterminePs1GameIdFromHex(
  filepath: string,
): Promise<Ps1GameIdResult> {
  let scanPath = filepath;
  let zipTempDir: string | null = null;
  let dataTrackOffset = 0;

  try {
    if (path.extname(filepath).toLowerCase() === ".zip") {
      let extracted;
      try {
        extracted = await extractDiscZip(filepath);
      } catch (err: any) {
        log.error(
          `PS1 identification: failed to extract ZIP ${filepath}:`,
          err?.message || err,
        );
        return {
          success: false,
          identificationStatus: "unidentified",
          message: err?.message || "Failed to extract ZIP archive.",
        };
      }
      zipTempDir = extracted.tempDir;
      if (!extracted.cuePath && !extracted.binPath) {
        return {
          success: false,
          identificationStatus: "unidentified",
          message: "ZIP archive does not contain a .cue or .bin file.",
        };
      }
      scanPath = extracted.cuePath || (extracted.binPath as string);
    }

    if (path.extname(scanPath).toLowerCase() === ".cue") {
      try {
        const cueSheet = await parseCueSheet(scanPath);
        const dataFile = cueSheet.files.find((file) =>
          file.tracks.some((track) => /^MODE[12]\//i.test(track.type)),
        );
        const selectedFile = dataFile || cueSheet.files[0];
        const dataTrack = selectedFile?.tracks.find((track) =>
          /^MODE[12]\//i.test(track.type),
        );
        if (!selectedFile?.filename || !dataTrack) {
          return {
            success: false,
            identificationStatus: "unidentified",
            message: "CUE sheet does not reference a readable PS1 data track.",
          };
        }

        dataTrackOffset = cueTrackByteOffset(dataTrack);
        scanPath = path.join(getCueDirectory(scanPath), selectedFile.filename);
        log.verbose(
          `PS1 identification: resolved CUE data track to ${selectedFile.filename} at byte offset ${dataTrackOffset}`,
        );
      } catch (err: any) {
        log.error(
          `PS1 identification: failed to parse CUE ${scanPath}:`,
          err?.message || err,
        );
        return {
          success: false,
          identificationStatus: "unidentified",
          message: err?.message || "Failed to parse CUE sheet.",
        };
      }
    }

    let fileHandle: fs.FileHandle | undefined;
    try {
      fileHandle = await fs.open(scanPath, "r");
    } catch (err: any) {
      log.error(
        `PS1 identification: cannot open ${scanPath}:`,
        err?.code || err?.message || err,
      );
      return {
        success: false,
        identificationStatus: "unidentified",
        message: describeFileAccessError(err, scanPath),
      };
    }

    try {
      const systemCnfId = await tryReadPs1IdFromSystemCnf(
        fileHandle,
        dataTrackOffset,
      );
      if (systemCnfId) {
        const result = await resolvePs1Candidate(
          scanPath,
          systemCnfId,
          dataTrackOffset,
          "boot",
        );
        log.verbose(
          `PS1 identification: SYSTEM.CNF resolved ${systemCnfId}` +
            (result.gameName ? ` (${result.gameName})` : ""),
        );
        return result;
      }

      const pvd = await tryReadPs1IdFromPvdTimestamp(
        fileHandle,
        dataTrackOffset,
      );
      if (pvd) {
        const result = await resolvePs1Candidate(
          scanPath,
          pvd.gameId,
          dataTrackOffset,
          "pvd",
          ps1PvdDiscTitle(pvd.timestamp),
        );
        log.verbose(
          `PS1 identification: PVD timestamp resolved ${pvd.gameId}` +
            (result.gameName ? ` (${result.gameName})` : ""),
        );
        return result;
      }

      log.verbose(
        `PS1 identification: no structured identity found in ${path.basename(scanPath)}`,
      );
      return {
        success: false,
        identificationStatus: "unidentified",
        message:
          "Could not identify this PS1 disc from SYSTEM.CNF or the verified PVD timestamp table.",
      };
    } catch (err: any) {
      log.error(
        `PS1 identification: read error on ${path.basename(scanPath)}:`,
        err?.message || err,
      );
      return {
        success: false,
        identificationStatus: "unidentified",
        message: err?.message || "Failed while reading file contents.",
      };
    } finally {
      if (fileHandle) await fileHandle.close();
    }
  } finally {
    if (zipTempDir) await cleanupExtractedZip(zipTempDir);
  }
}
