import * as fs from "fs/promises";
import path from "path";
import { createLogger } from "../logger";
import { isDirectoryEntry, resolveEntryType } from "../utils/fs-entry";
import { normalisePs1GameIdFromTitleCfg } from "../utils/game-id-patterns";

const log = createLogger("apps");

/**
 * Homebrew "APPS" support.
 *
 * OPL launches homebrew from the `APPS/` folder: each app lives in its own
 * subfolder containing a `title.cfg` (`title=...` / `boot=<file>.ELF`) and the
 * ELF it points to. This module enumerates those folders and imports new ones.
 */

export interface AppInfo {
  /** Subfolder name under APPS/ (used as the stable id / delete key). */
  folder: string;
  title: string;
  boot: string;
  /** Absolute path to the boot ELF, when it exists. */
  path: string;
  sizeBytes: number;
  /** Optional PS1 game ID from title.cfg GameID= attribute. */
  gameId?: string;
}

function appsDir(oplRoot: string): string {
  return path.join(oplRoot, "APPS");
}

function sanitizeAppName(name: string): string {
  return (
    name
      .trim()
      .replace(/\.elf$/i, "")
      .replace(/[^A-Za-z0-9._ -]/g, "_")
      .slice(0, 48)
      .trim() || "App"
  );
}

export interface TitleCfgData {
  title?: string;
  boot?: string;
  gameId?: string;
  developer?: string;
  genre?: string;
  release?: string;
  ratingText?: string;
  rating?: string;
  description?: string;
  parentalText?: string;
  parental?: string;
  playersText?: string;
}

function parseTitleCfg(raw: string): TitleCfgData {
  const out: TitleCfgData = {};
  for (const line of raw.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const val = line.slice(eq + 1).trim();
    if (key === "title") out.title = val;
    else if (key === "boot") out.boot = val;
    else if (key === "gameid") out.gameId = normalisePs1GameIdFromTitleCfg(val);
    else if (key === "developer") out.developer = val;
    else if (key === "genre") out.genre = val;
    else if (key === "release") out.release = val;
    else if (key === "ratingtext") out.ratingText = val;
    else if (key === "rating") out.rating = val;
    else if (key === "description") out.description = val;
    else if (key === "parentaltext") out.parentalText = val;
    else if (key === "parental") out.parental = val;
    else if (key === "playerstext") out.playersText = val;
  }
  return out;
}

/**
 * Shared enumeration for APPS subfolders, filtered by `match`.
 * Returns {@link AppInfo} for every subfolder matching the predicate.
 */
async function enumerateApps(
  oplRoot: string,
  match: (name: string) => boolean,
): Promise<AppInfo[]> {
  const dir = appsDir(oplRoot);
  const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const apps: AppInfo[] = [];

  for (const item of items) {
    if (!match(item.name)) continue;
    // Resolve symlinked / DT_UNKNOWN (SMB, NFS) entries via stat, not d_type.
    if (!(await isDirectoryEntry(item, dir))) continue;
    const folderPath = path.join(dir, item.name);

    let title = item.name;
    let boot = "";
    let gameId: string | undefined;
    try {
      const cfg = parseTitleCfg(
        await fs.readFile(path.join(folderPath, "title.cfg"), "utf-8")
      );
      if (cfg.title) title = cfg.title;
      if (cfg.boot) boot = cfg.boot;
      if (cfg.gameId) gameId = cfg.gameId;
    } catch {
      // No title.cfg — fall back to the first ELF in the folder.
    }

    if (!boot) {
      const elf = (await fs.readdir(folderPath).catch(() => [])).find((f) =>
        /\.elf$/i.test(f)
      );
      if (!elf) continue;
      boot = elf;
    }

    const elfPath = path.join(folderPath, boot);
    let sizeBytes = 0;
    try {
      sizeBytes = (await fs.stat(elfPath)).size;
    } catch {
      continue;
    }

    apps.push({ folder: item.name, title, boot, path: elfPath, sizeBytes, gameId });
  }

  apps.sort((a, b) => a.title.localeCompare(b.title));
  return apps;
}

/**
 * Returns PS1 POPStarter launchers from the APPS folder.
 *
 * These are the APPS/POPS_* folders normally skipped by getApps() — they
 * correspond to PS1 VCD files in POPS/ and carry the POPStarter ELF along
 * with the game title. The caller pairs them with VCD files to build proper
 * PS1 game entries.
 */
export async function getPs1Launchers(
  oplRoot: string
): Promise<{ success: boolean; launchers: AppInfo[]; message?: string }> {
  try {
    const launchers = await enumerateApps(oplRoot, (name) => /^POPS_/i.test(name));
    log.verbose(`Found ${launchers.length} PS1 POPStarter launcher(s) in APPS/POPS_*`);
    return { success: true, launchers };
  } catch (err: any) {
    log.error(`Failed to enumerate PS1 launchers:`, err?.message || err);
    return { success: false, launchers: [], message: err?.message || String(err) };
  }
}

export async function getApps(
  oplRoot: string
): Promise<{ success: boolean; apps: AppInfo[]; message?: string }> {
  try {
    // Skip POPStarter launchers for PS1 games — those folders are created
    // alongside each PS1 VCD and are already represented by their PS1 entry
    // in the library. Showing them here would duplicate every PS1 title.
    const apps = await enumerateApps(oplRoot, (name) => !/^POPS_/i.test(name));
    log.verbose(`Found ${apps.length} homebrew app(s) in ${appsDir(oplRoot)}`);
    return { success: true, apps };
  } catch (err: any) {
    log.error(`Failed to enumerate apps in ${appsDir(oplRoot)}:`, err?.message || err);
    return { success: false, apps: [], message: err?.message || String(err) };
  }
}

export async function importApp(
  oplRoot: string,
  elfPath: string,
  title: string
): Promise<{ success: boolean; folder?: string; message?: string }> {
  try {
    const folderName = sanitizeAppName(title || path.basename(elfPath));
    const targetDir = path.join(appsDir(oplRoot), folderName);

    try {
      await fs.access(targetDir);
      log.warn(`App folder "${folderName}" already exists — import aborted`);
      return { success: false, message: `An app folder "${folderName}" already exists.` };
    } catch {
      // good — does not exist
    }

    log.info(`Importing homebrew app "${title || folderName}" from ${elfPath}`);
    await fs.mkdir(targetDir, { recursive: true });
    const elfBase = path.basename(elfPath);
    await fs.copyFile(elfPath, path.join(targetDir, elfBase));
    await fs.writeFile(
      path.join(targetDir, "title.cfg"),
      `title=${title || folderName}\nboot=${elfBase}\n`,
      "utf-8"
    );
    log.info(`Imported app into APPS/${folderName} (boot=${elfBase})`);
    return { success: true, folder: folderName };
  } catch (err: any) {
    log.error(`Failed to import app from ${elfPath}:`, err?.message || err);
    return { success: false, message: err?.message || String(err) };
  }
}

/**
 * Reads the title.cfg from an APPS subfolder and returns its parsed values.
 */
export async function readAppTitleCfg(
  oplRoot: string,
  folder: string
): Promise<{ success: boolean } & TitleCfgData & { message?: string }> {
  try {
    const cfgPath = path.join(appsDir(oplRoot), folder, "title.cfg");
    const raw = await fs.readFile(cfgPath, "utf-8");
    return { success: true, ...parseTitleCfg(raw) };
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { success: false, message: "title.cfg not found" };
    }
    return { success: false, message: err?.message || String(err) };
  }
}

/**
 * Updates the `title=` / `Title=` lines in a PS1 launcher's `title.cfg`,
 * preserving the original key casing. Adds both lines if neither exists.
 * Creates a new `title.cfg` if one does not exist.
 */
export async function updatePs1TitleCfg(
  launcherPath: string,
  newTitle: string,
  gameId?: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const cfgPath = path.join(launcherPath, "title.cfg");
    let oldContent: string;
    try {
      oldContent = await fs.readFile(cfgPath, "utf-8");
    } catch {
      await fs.writeFile(cfgPath, `title=${newTitle}\nTitle=${newTitle}\n${gameId ? `GameID=${gameId}\n` : ''}`, "utf-8");
      log.info(`Created title.cfg for ${path.basename(launcherPath)}`);
      return { success: true };
    }

    const seenKeys = new Map<string, string>();
    const cfgLines = oldContent.split("\n").map((line) => {
      const t = line.trimEnd();
      const eq = t.indexOf("=");
      if (eq === -1) return line;
      const k = t.slice(0, eq).trim();
      const lower = k.toLowerCase();
      if (!seenKeys.has(lower)) seenKeys.set(lower, k);
      if (lower === "title") {
        return k === "Title" ? `Title=${newTitle}` : `title=${newTitle}`;
      }
      return line;
    });

    if (!seenKeys.has("title")) {
      cfgLines.push(`title=${newTitle}`);
      cfgLines.push(`Title=${newTitle}`);
    }

    await fs.writeFile(cfgPath, cfgLines.join("\n"), "utf-8");
    log.info(`Updated title.cfg for ${path.basename(launcherPath)}`);
    return { success: true };
  } catch (err: any) {
    log.error(`Failed to update title.cfg:`, err?.message || err);
    return { success: false, message: err?.message || String(err) };
  }
}

export async function deleteApp(
  oplRoot: string,
  folder: string
): Promise<{ success: boolean; message?: string }> {
  try {
    // Guard against path traversal — only a direct child of APPS/ is allowed.
    if (!folder || folder.includes("/") || folder.includes("\\") || folder.includes("..")) {
      log.warn(`Rejected app delete for suspicious folder name: "${folder}"`);
      return { success: false, message: "Invalid app folder." };
    }
    const target = path.resolve(appsDir(oplRoot), folder);
    if (!target.startsWith(appsDir(oplRoot) + path.sep)) {
      log.warn(`Path traversal blocked for app folder: "${folder}"`);
      return { success: false, message: "Invalid app folder." };
    }
    await fs.rm(target, {
      recursive: true,
      force: true,
    });
    log.info(`Deleted app APPS/${folder}`);
    return { success: true };
  } catch (err: any) {
    log.error(`Failed to delete app APPS/${folder}:`, err?.message || err);
    return { success: false, message: err?.message || String(err) };
  }
}

export interface DeleteAppEntry {
  label: string;
  path?: string;
  success: boolean;
  error?: string;
}

/**
 * Delete an app folder with per-file progress reporting and optional ART cleanup.
 * Reports each deleted file via `onProgress` and returns the full entry list.
 */
export async function deleteAppWithProgress(
  oplRoot: string,
  folder: string,
  bootName?: string,
  onProgress?: (entry: DeleteAppEntry) => void
): Promise<{ success: boolean; entries: DeleteAppEntry[] }> {
  const entries: DeleteAppEntry[] = [];
  const addEntry = (label: string, success: boolean, path?: string, error?: string) => {
    const entry: DeleteAppEntry = { label, path, success, error };
    entries.push(entry);
    if (onProgress) onProgress(entry);
  };

  const rel = (p: string) => path.relative(oplRoot, p);

  try {
    // Guard against path traversal
    if (!folder || folder.includes("/") || folder.includes("\\") || folder.includes("..")) {
      addEntry("App folder", false, folder, "Invalid app folder.");
      log.warn(`Rejected app delete for suspicious folder name: "${folder}"`);
      return { success: false, entries };
    }
    const target = path.resolve(appsDir(oplRoot), folder);
    if (!target.startsWith(appsDir(oplRoot) + path.sep)) {
      addEntry("App folder", false, folder, "Path traversal blocked");
      log.warn(`Path traversal blocked for app folder: "${folder}"`);
      return { success: false, entries };
    }

    // Recursively collect all files and folders
    const allFiles: string[] = [];
    const allDirs: string[] = [];
    const collect = async (dir: string) => {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        // follow:false — a symlink must be removed as a leaf, never descended
        // into. lstat also classifies DT_UNKNOWN entries on SMB/NFS shares.
        if ((await resolveEntryType(item, dir, { follow: false })) === "directory") {
          allDirs.push(fullPath);
          await collect(fullPath);
        } else {
          allFiles.push(fullPath);
        }
      }
    };
    await collect(target);

    // Delete files (deepest first)
    for (const filePath of allFiles) {
      const label = path.basename(filePath).toLowerCase() === "title.cfg"
        ? "CONFIG FILE"
        : "App file";
      try {
        await fs.unlink(filePath);
        addEntry(label, true, rel(filePath));
      } catch (err: any) {
        addEntry(label, false, rel(filePath), err?.message || String(err));
      }
    }

    // Delete subdirectories (reverse order = deepest first)
    allDirs.reverse();
    for (const dirPath of allDirs) {
      try {
        await fs.rmdir(dirPath);
        addEntry("App folder", true, rel(dirPath));
      } catch (err: any) {
        addEntry("App folder", false, rel(dirPath), err?.message || String(err));
      }
    }

    // Delete the top-level app folder
    try {
      await fs.rmdir(target);
      addEntry("App folder", true, rel(target));
    } catch (err: any) {
      addEntry("App folder", false, rel(target), err?.message || String(err));
    }

    // Delete ART files matching the boot ELF name (only when user opted in)
    if (bootName) {
      const artDir = path.join(oplRoot, "ART");
      try {
        const artFiles = await fs.readdir(artDir);
        const matchingArt = artFiles.filter((f) =>
          f.startsWith(bootName + "_")
        );
        if (matchingArt.length === 0) {
          addEntry("Artwork", true, "None found");
        } else {
          for (const artFile of matchingArt) {
            const artPath = path.join(artDir, artFile);
            try {
              await fs.unlink(artPath);
              addEntry("Artwork", true, rel(artPath));
            } catch (err: any) {
              addEntry("Artwork", false, rel(artPath), err?.message || String(err));
            }
          }
        }
      } catch {
        addEntry("Artwork", true, "No artwork directory");
      }
    }

    log.info(`Deleted app APPS/${folder} (${allFiles.length} file(s))`);
    const allSuccess = entries.every((e) => e.success);
    return { success: allSuccess, entries };
  } catch (err: any) {
    log.error(`Failed to delete app APPS/${folder}:`, err?.message || err);
    addEntry("App folder", false, folder, err?.message || String(err));
    return { success: false, entries };
  }
}
