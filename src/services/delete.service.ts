import * as fs from "fs/promises";
import path from "path";
import { createLogger } from "../logger";

const log = createLogger("delete");

export interface DeleteEntry {
  label: string;
  path?: string;
  success: boolean;
  error?: string;
}

export interface DeleteGameResult {
  success: boolean;
  message?: string;
  entries: DeleteEntry[];
}

export async function deleteGameAndRelatedFiles(
  gamePath: string,
  artDir: string,
  gameId: string,
  launcherFolder?: string,
  onProgress?: (entry: DeleteEntry) => void,
  bootName?: string,
): Promise<DeleteGameResult> {
  log.info(`Deleting ${gameId} and related files: ${gamePath}`);
  const entries: DeleteEntry[] = [];

  const addEntry = (label: string, success: boolean, path?: string, error?: string) => {
    const entry: DeleteEntry = { label, path, success, error };
    entries.push(entry);
    if (onProgress) onProgress(entry);
  };

  const oplRoot = path.dirname(artDir);

  const rel = (p: string) => path.relative(oplRoot, p);

  let hasCriticalError = false;
  try {
    await fs.unlink(gamePath);
    log.verbose(`Removed game file ${path.basename(gamePath)}`);
    addEntry("VCD", true, rel(gamePath));
  } catch (err: any) {
    hasCriticalError = true;
    log.error(`Failed to remove game file ${path.basename(gamePath)}:`, err?.message || err);
    addEntry("VCD", false, rel(gamePath), err?.message || String(err));
  }

  if (launcherFolder) {
    const appsBase = path.join(oplRoot, "APPS");
    const resolved = path.resolve(appsBase, launcherFolder);
    if (!resolved.startsWith(appsBase + path.sep)) {
      log.warn(`Path traversal attempt blocked: "${launcherFolder}" — refusing to delete`);
      addEntry("Launcher folder", false, launcherFolder, "Path traversal blocked");
    } else {
      try {
        await fs.rm(resolved, { recursive: true, force: true });
        log.verbose(`Removed launcher folder ${rel(resolved)}`);
        addEntry("Launcher folder", true, rel(resolved));
      } catch (err: any) {
        log.error(`Failed to remove launcher ${rel(resolved)}:`, err?.message || err);
        addEntry("Launcher folder", false, rel(resolved), err?.message || String(err));
      }
    }
  }

  if (launcherFolder) {
    const vcdName = path.basename(gamePath);
    const ext = path.extname(vcdName);
    const gameTitle = vcdName.slice(0, -ext.length);
    const popsDir = path.dirname(gamePath);
    const popsSubdir = path.join(popsDir, gameTitle);

    try {
      await fs.access(popsSubdir);
      const files = await fs.readdir(popsSubdir);
      for (const f of files) {
        const filePath = path.join(popsSubdir, f);
        try {
          await fs.unlink(filePath);
          log.verbose(`Removed file ${rel(filePath)}`);
          addEntry("POPS subfolder file", true, rel(filePath));
        } catch (err: any) {
          addEntry("POPS subfolder file", false, rel(filePath), err?.message || String(err));
        }
      }
      try {
        await fs.rmdir(popsSubdir);
        log.verbose(`Removed POPS subfolder ${rel(popsSubdir)}`);
        addEntry("POPS subfolder", true, rel(popsSubdir));
      } catch (err: any) {
        addEntry("POPS subfolder", false, rel(popsSubdir), err?.message || String(err));
      }
    } catch {
      addEntry("POPS subfolder", true, "Not present");
    }
  }

  if (launcherFolder && !bootName) {
    // Artwork intentionally omitted — user unchecked the option.
  } else {
    const artPrefix = bootName || gameId;
    try {
      const artFiles = await fs.readdir(artDir);
    const relatedArt = artFiles.filter((f) =>
      f.startsWith(artPrefix + "_") && !f.startsWith(".")
    );
      if (relatedArt.length > 0) {
        log.verbose(`Removing ${relatedArt.length} artwork file(s) for ${artPrefix}`);
        for (const artFile of relatedArt) {
          const artPath = path.join(artDir, artFile);
          try {
            await fs.unlink(artPath);
            addEntry("Artwork", true, rel(artPath));
          } catch (err: any) {
            addEntry("Artwork", false, rel(artPath), err?.message || String(err));
          }
        }
      } else {
        addEntry("Artwork", true, "None found");
      }
    } catch {
      addEntry("Artwork", true, "No artwork directory");
    }
  }

  if (hasCriticalError) {
    log.error(`Failed to delete game file for ${gameId}`);
    return { success: false, message: entries.find((e) => e.label === "VCD")?.error ?? "VCD deletion failed", entries };
  }

  const allSuccess = entries.every((e) => e.success);
  if (!allSuccess) {
    log.info(`Deleted ${gameId} with some non-critical errors`);
  } else {
    log.info(`Deleted ${gameId} successfully`);
  }
  return { success: true, entries };
}


/**
 * Delete one Ember game folder and artwork keyed by its folder identity.
 * Artwork is touched only after the game folder itself has been removed.
 */
export async function deleteEmberGameAndRelatedFiles(
  gamePath: string,
  artDir: string,
  identity: string,
  onProgress?: (entry: DeleteEntry) => void,
): Promise<DeleteGameResult> {
  const entries: DeleteEntry[] = [];
  const oplRoot = path.dirname(artDir);
  const rel = (p: string) => path.relative(oplRoot, p);
  const addEntry = (label: string, success: boolean, entryPath?: string, error?: string) => {
    const entry: DeleteEntry = { label, path: entryPath, success, error };
    entries.push(entry);
    onProgress?.(entry);
  };

  try {
    await fs.rm(gamePath, { recursive: true, force: false });
    addEntry("Ember game folder", true, rel(gamePath));
  } catch (err: any) {
    const message = err?.message || String(err);
    addEntry("Ember game folder", false, rel(gamePath), message);
    return { success: false, message, entries };
  }

  try {
    const artFiles = await fs.readdir(artDir);
    const prefix = identity + "_";
    for (const artFile of artFiles) {
      if (artFile.startsWith(".") || !artFile.startsWith(prefix)) continue;
      const artPath = path.join(artDir, artFile);
      try {
        await fs.unlink(artPath);
        addEntry("Artwork", true, rel(artPath));
      } catch (err: any) {
        addEntry("Artwork", false, rel(artPath), err?.message || String(err));
      }
    }
  } catch {
    addEntry("Artwork", true, "No artwork directory");
  }

  return { success: true, entries };
}
