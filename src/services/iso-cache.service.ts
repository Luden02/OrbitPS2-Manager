import { app } from "electron";
import fs from "fs";
import path from "path";
import { createLogger } from "../logger";

const log = createLogger("iso-cache");

/**
 * Persistent per-file caches stored in the app's userData folder.
 *
 * Every entry is keyed by absolute path AND validated against size + mtime,
 * so renamed, replaced, or modified files automatically miss and get
 * re-scanned.
 *
 * - ISO game IDs: prefix-less ("new OPL convention") ISOs are hex-scanned at
 *   most once across runs.
 * - PS1 conflict digests: discs whose BOOT serial is shared by several games
 *   are MD5-hashed in full to pick the right one. Only the raw digests are
 *   cached, never the resolved title, so conflict-table updates still apply.
 */

const ISO_CACHE_FILE = "iso-gameid-cache.json";
const PS1_DIGEST_CACHE_FILE = "ps1-digest-cache.json";

/**
 * Bump when the set of digests computed per file changes (e.g. a new VCD
 * payload reconstruction), so older entries miss instead of lacking a
 * candidate.
 */
export const PS1_DIGEST_CACHE_VERSION = 1;

interface CacheEntry {
  gameId: string;
  gameName?: string;
  size: number;
  mtimeMs: number;
}

interface Ps1DigestEntry {
  version: number;
  digests: string[];
  size: number;
  mtimeMs: number;
}

let directoryOverride: string | undefined;

/** Test seam: store caches in `dir` instead of Electron's userData folder. */
export function setPersistentCacheDirectory(dir: string | undefined): void {
  directoryOverride = dir;
}

function cachePath(fileName: string): string | undefined {
  if (directoryOverride) return path.join(directoryOverride, fileName);
  // Outside an Electron main process (e.g. node --test) there is no userData.
  if (!app?.getPath) return undefined;
  return path.join(app.getPath("userData"), fileName);
}

function readAll<T>(fileName: string): Record<string, T> {
  const file = cachePath(fileName);
  if (!file) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, T>;
  } catch {
    return {};
  }
}

function writeAll<T>(fileName: string, data: Record<string, T>): void {
  const file = cachePath(fileName);
  if (!file) return;
  try {
    fs.writeFileSync(file, JSON.stringify(data));
  } catch (error) {
    log.error(`Failed to persist ${fileName}:`, error);
  }
}

function matchesFile(
  entry: { size: number; mtimeMs: number },
  size: number,
  mtimeMs: number
): boolean {
  // mtime in JS is float; compare with small tolerance to survive FS quantisation.
  return entry.size === size && Math.abs(entry.mtimeMs - mtimeMs) <= 1;
}

export function getCachedGameId(
  absPath: string,
  size: number,
  mtimeMs: number
): { gameId: string; gameName?: string } | undefined {
  const entry = readAll<CacheEntry>(ISO_CACHE_FILE)[absPath];
  if (!entry || !matchesFile(entry, size, mtimeMs)) return undefined;
  return { gameId: entry.gameId, gameName: entry.gameName };
}

export function setCachedGameId(
  absPath: string,
  size: number,
  mtimeMs: number,
  gameId: string,
  gameName?: string
): void {
  const data = readAll<CacheEntry>(ISO_CACHE_FILE);
  data[absPath] = { gameId, gameName, size, mtimeMs };
  writeAll(ISO_CACHE_FILE, data);
  log.verbose(`Cached game ID ${gameId} for ${path.basename(absPath)}`);
}

export function getCachedPs1Digests(
  absPath: string,
  size: number,
  mtimeMs: number
): string[] | undefined {
  const entry = readAll<Ps1DigestEntry>(PS1_DIGEST_CACHE_FILE)[absPath];
  if (
    !entry ||
    entry.version !== PS1_DIGEST_CACHE_VERSION ||
    !Array.isArray(entry.digests) ||
    !matchesFile(entry, size, mtimeMs)
  ) {
    return undefined;
  }
  return [...entry.digests];
}

export function setCachedPs1Digests(
  absPath: string,
  size: number,
  mtimeMs: number,
  digests: string[]
): void {
  const data = readAll<Ps1DigestEntry>(PS1_DIGEST_CACHE_FILE);
  data[absPath] = {
    version: PS1_DIGEST_CACHE_VERSION,
    digests: [...digests],
    size,
    mtimeMs,
  };
  writeAll(PS1_DIGEST_CACHE_FILE, data);
  log.verbose(`Cached PS1 conflict digests for ${path.basename(absPath)}`);
}
