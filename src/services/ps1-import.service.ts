import * as fs from "fs/promises";
import path from "path";
import { mergeMultiBin } from "../utils/binmerge";
import { convertToVcd } from "../utils/cue2pops";
import { parseCueSheet, getCueDirectory } from "../utils/cue-parser";
import { extractDiscZip } from "../utils/zip-extract";
import { tryDeterminePs1GameIdFromHex } from "./game-id-resolver.service";
import { resolveEmberGamesDir } from "./library.service";
import { downloadArtByGameId } from "./artwork.service";
import {
  sanitizeGameFilename,
  sanitizeRiptOplPs1StorageName,
} from "../utils/sanitize";
import { describeFileAccessError } from "../utils/file-access-error";
import { getAssetsDir } from "../utils/resource-path";
import { createLogger } from "../logger";

const log = createLogger("ps1-import");

// Prefix for auto-assigned IDs given to homebrew discs that carry no
// Sony-registered serial. Distinct from every prefix in PS1_GAME_ID_PREFIXES
// so it can never collide with a real detected game ID, while still matching
// the "<4 letters>_<3 digits>.<2 digits>" shape the library scanner expects
// to find at the front of a POPS/*.VCD filename.
const HOMEBREW_GAME_ID_PREFIX = "HBRW";

/**
 * Pick the lowest-numbered HBRW_###.## id that isn't already used by a file
 * in the POPS directory, so batch-importing many homebrew discs doesn't
 * assign the same id twice.
 */
async function generateHomebrewGameId(popsDir: string): Promise<string> {
  let existing: string[] = [];
  try {
    existing = await fs.readdir(popsDir);
  } catch {
    // POPS directory doesn't exist yet — nothing to conflict with.
  }

  const used = new Set<number>();
  const pattern = new RegExp(`^${HOMEBREW_GAME_ID_PREFIX}_(\\d{3})\\.(\\d{2})\\.`, "i");
  for (const name of existing) {
    const match = name.match(pattern);
    if (match) used.add(Number(match[1]) * 100 + Number(match[2]));
  }

  for (let n = 0; n < 10000; n++) {
    if (!used.has(n)) {
      const major = Math.floor(n / 100).toString().padStart(3, "0");
      const minor = (n % 100).toString().padStart(2, "0");
      return `${HOMEBREW_GAME_ID_PREFIX}_${major}.${minor}`;
    }
  }
  throw new Error("Exhausted available homebrew game ID slots.");
}

const POPSTARTER_ELF_CANDIDATE_PATHS = [
  path.join(getAssetsDir(), "POPSTARTER.ELF"),
  path.resolve(__dirname, "../assets/POPSTARTER.ELF"),
  path.resolve(__dirname, "../../assets/POPSTARTER.ELF"),
  path.resolve(process.cwd(), "assets/POPSTARTER.ELF"),
];

export async function findPopstarterElf(): Promise<string | null> {
  for (const candidate of POPSTARTER_ELF_CANDIDATE_PATHS) {
    try {
      await fs.access(candidate);
      log.verbose(`Using POPSTARTER.ELF at ${candidate}`);
      return candidate;
    } catch {
      // Try next candidate
    }
  }
  return null;
}

/**
 * Node's copyFile has no byte-progress callback, so poll the growing target —
 * the same approach the cross-device move in library.service.ts uses.
 */
async function copyFileReportingProgress(
  sourcePath: string,
  targetPath: string,
  onPercent: (percent: number) => void
): Promise<void> {
  const totalSize = (await fs.stat(sourcePath)).size;
  const poll =
    totalSize > 0
      ? setInterval(() => {
          fs.stat(targetPath).then(
            (written) => onPercent(Math.min(99, (written.size / totalSize) * 100)),
            () => {
              /* target not visible yet — next tick reports it */
            }
          );
        }, 500)
      : undefined;
  try {
    await fs.copyFile(sourcePath, targetPath);
  } finally {
    if (poll) clearInterval(poll);
  }
  onPercent(100);
}

export interface ImportPs1Result {
  success: boolean;
  message?: string;
  vcdPath?: string;
  gameId?: string;
  gameName?: string;
  identificationStatus?: "identified" | "ambiguous" | "unidentified";
}

export async function importPs1Game(
  cueFilePath: string,
  oplRoot: string,
  elfPrefix: string,
  downloadArtwork: boolean,
  overrideGameId?: string,
  overrideGameName?: string,
  launcherMode: "popstarter" | "popsloader" | "ember" = "popstarter",
  onProgress?: (percent: number, stage: string) => void
): Promise<ImportPs1Result> {
  let zipTempDir: string | null = null;
  try {
    log.info(
      `PS1 import started: ${cueFilePath} (ELF prefix "${elfPrefix}", launcher mode "${launcherMode}")`
    );
    const popsDir = path.join(oplRoot, "POPS");
    const artDir = path.join(oplRoot, "ART");

    // Ensure POPS directory exists
    await fs.mkdir(popsDir, { recursive: true });
    await fs.mkdir(artDir, { recursive: true });

    if (onProgress) onProgress(0, "Parsing CUE sheet");

    // Step 0: If a ZIP was picked, extract it and locate the CUE inside —
    // everything below operates on the extracted CUE as if it had been
    // picked directly.
    let resolvedCueFilePath = cueFilePath;
    if (path.extname(cueFilePath).toLowerCase() === ".zip") {
      if (onProgress) onProgress(2, "Extracting ZIP archive");
      log.verbose(`Extracting PS1 ZIP archive ${cueFilePath}`);
      const extracted = await extractDiscZip(cueFilePath);
      zipTempDir = extracted.tempDir;
      if (!extracted.cuePath) {
        return {
          success: false,
          message: "ZIP archive does not contain a .cue file alongside the .bin.",
        };
      }
      resolvedCueFilePath = extracted.cuePath;
    }

    // Step 1: Parse the CUE sheet. Identification runs straight off it — the
    // resolver picks the data track out of a multi-file sheet itself, so it
    // does not need the merged copy the VCD path builds further down.
    const cueSheet = await parseCueSheet(resolvedCueFilePath);

    // Step 2: Resolve game ID + name (use overrides if provided, else detect;
    // fall back to an auto-assigned homebrew ID if neither works, since
    // VCD conversion itself has no dependency on a real Sony-registered ID).
    if (onProgress) onProgress(10, "Detecting PS1 game ID");

    let gameId = overrideGameId?.trim();
    let gameName = overrideGameName?.trim();
    const idResult = await tryDeterminePs1GameIdFromHex(resolvedCueFilePath);
    const identificationStatus =
      idResult.identificationStatus ??
      (idResult.success ? "identified" : "unidentified");
    const manualIdentityOverride = !!gameId && !!gameName;

    if (idResult.success && idResult.gameId) {
      if (!gameId) gameId = idResult.gameId;
      if (
        !gameName &&
        identificationStatus === "identified" &&
        idResult.gameName
      ) {
        gameName = idResult.gameName;
      }
      if (identificationStatus === "ambiguous") {
        log.warn(
          `PS1 import: ${idResult.message || "shared serial could not be resolved"} — preserving the disc without automatic canonical naming/artwork`,
        );
      }
    } else {
      log.verbose(
        `PS1 import: ${idResult.message || "could not determine game ID"} — treating as homebrew`,
      );
    }

    if (!gameId) {
      gameId = await generateHomebrewGameId(popsDir);
      log.info(`No registered PS1 game ID found — auto-assigned homebrew ID ${gameId}`);
    }
    if (!gameName) {
      gameName = path.basename(resolvedCueFilePath, path.extname(resolvedCueFilePath));
    }
    log.verbose(`Resolved PS1 game ${gameId} (${gameName})`);

    const sanitizedName = sanitizeGameFilename(gameName);
    // Artwork is only safe to key automatically when disc identity is certain.
    // A manual game-ID + title override is explicit user input and may opt in.
    const canDownloadArtwork =
      identificationStatus === "identified" || manualIdentityOverride;

    // Step 3: Ember plays the disc as BIN/CUE, so its import is a file copy
    // into EMBER/games/<folder> — no conversion and no launcher app.
    if (launcherMode === "ember") {
      const folderName = sanitizeRiptOplPs1StorageName(sanitizedName, "EMBER");
      const gameDir = path.join(resolveEmberGamesDir(oplRoot), folderName);

      const existing = await fs.readdir(gameDir).catch(() => [] as string[]);
      if (existing.some((name) => name.toLowerCase().endsWith(".cue"))) {
        log.error(`Ember game folder already in use: ${gameDir}`);
        return {
          success: false,
          message: `An Ember game folder named "${folderName}" already exists. Rename or delete it first.`,
        };
      }
      await fs.mkdir(gameDir, { recursive: true });

      if (cueSheet.files.length > 1) {
        // Merging writes the final CUE/BIN pair straight into the game folder,
        // so a multi-track disc is never written to disk twice.
        if (onProgress) onProgress(20, "Merging multi-BIN files");
        log.verbose(`Merging ${cueSheet.files.length} BIN files into ${gameDir}`);
        await mergeMultiBin(resolvedCueFilePath, gameDir, (percent, stage) =>
          onProgress?.(20 + Math.round(percent * 0.7), stage)
        );
      } else {
        const binName = cueSheet.files[0].filename;
        const targetBin = path.join(gameDir, binName);
        // The CUE is copied under its original name and the BIN keeps the name
        // the CUE's FILE line references, so the pair still resolves.
        await fs.mkdir(path.dirname(targetBin), { recursive: true });
        await copyFileReportingProgress(
          path.join(getCueDirectory(resolvedCueFilePath), binName),
          targetBin,
          (percent) =>
            onProgress?.(20 + Math.round(percent * 0.7), "Copying disc track")
        );
        await fs.copyFile(
          resolvedCueFilePath,
          path.join(gameDir, path.basename(resolvedCueFilePath))
        );
      }

      if (downloadArtwork && canDownloadArtwork) {
        if (onProgress) onProgress(93, "Downloading artwork");
        try {
          // RiptOPL keys Ember artwork by the game-folder name.
          await downloadArtByGameId(artDir, gameId, "PS1", folderName, ["COV"]);
        } catch {
          // Art download failure is non-critical
        }
      }

      if (onProgress) onProgress(100, "Import complete");
      log.info(`PS1 import complete: ${gameId} (${gameName}) → ${gameDir}`);
      return { success: true, gameId, gameName, identificationStatus };
    }

    // Step 4: Check if multi-BIN and merge if needed — VCD conversion needs a
    // single BIN.
    let binPath: string;
    let cuePath: string;
    let tempDir: string | null = null;

    if (cueSheet.files.length > 1) {
      if (onProgress) onProgress(15, "Merging multi-BIN files");
      log.verbose(`Merging ${cueSheet.files.length} BIN files into one`);

      // Create temp directory for merged output
      tempDir = path.join(popsDir, `.tmp_merge_${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });

      const mergeResult = await mergeMultiBin(
        resolvedCueFilePath,
        tempDir,
        (percent, stage) => onProgress?.(15 + Math.round(percent * 0.2), stage)
      );
      binPath = mergeResult.mergedBinPath;
      cuePath = mergeResult.mergedCuePath;
    } else {
      binPath = path.join(getCueDirectory(resolvedCueFilePath), cueSheet.files[0].filename);
      cuePath = resolvedCueFilePath;
    }

    // Step 5: Convert BIN/CUE to VCD
    if (onProgress) onProgress(35, "Converting to VCD format");

    const vcdStem = sanitizeRiptOplPs1StorageName(
      launcherMode === "popsloader"
        ? sanitizedName
        : `${gameId}.${sanitizedName}`,
      "VCD",
    );
    const vcdFilename = `${vcdStem}.VCD`;
    const vcdPath = path.join(popsDir, vcdFilename);
    log.verbose(`Converting to VCD → POPS/${vcdFilename}`);

    await convertToVcd(binPath, cuePath, vcdPath, (percent, stage) => {
      if (onProgress) {
        // Map the 0-100 range from convertToVcd to 35-85 of our overall progress
        const mappedPercent = 35 + Math.round(percent * 0.5);
        onProgress(mappedPercent, stage);
      }
    });

    // Step 6: Clean up temp directory if we created one
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Non-critical cleanup failure
      }
    }

    // Step 7: Copy POPStarter ELF with XX. prefix (POPStarter mode only —
    // POPSLoader reads VCDs directly out of POPS/ and needs no launcher app).
    let elfFilename: string | undefined;
    if (launcherMode === "popstarter") {
      if (onProgress) onProgress(86, "Setting up Popstarter launcher");

      const popstarterElf = await findPopstarterElf();
      if (!popstarterElf) {
        log.error("POPSTARTER.ELF not found in assets — cannot create PS1 launcher");
        return {
          success: false,
          message:
            "POPSTARTER.ELF not found in assets. Please place the Popstarter ELF file at assets/POPSTARTER.ELF.",
        };
      }

      const vcdBasename = vcdFilename.replace(/\.VCD$/i, "");
      elfFilename = elfPrefix
        ? `${elfPrefix}${vcdBasename}.ELF`
        : `${vcdBasename}.ELF`;
      const appsFolderName = `POPS_${sanitizedName}`;
      const appsGameDir = path.join(oplRoot, "APPS", appsFolderName);
      await fs.mkdir(appsGameDir, { recursive: true });
      await fs.copyFile(popstarterElf, path.join(appsGameDir, elfFilename));
      await fs.writeFile(
        path.join(appsGameDir, "title.cfg"),
        `title=${gameName}\nboot=${elfFilename}\nGameID=${gameId}\n`,
        "utf-8"
      );
      log.verbose(`Created POPStarter launcher APPS/${appsFolderName}/${elfFilename}`);
    } else {
      if (onProgress) onProgress(86, "Skipping launcher (POPSLoader mode)");
      log.verbose("POPSLoader mode — no APPS launcher created");
    }

    // Step 8: Download artwork only when disc identity is safe.
    if (downloadArtwork && canDownloadArtwork) {
      if (onProgress) onProgress(93, "Downloading artwork");
      try {
        // RiptOPL's VCD row is keyed by the exact VCD filename stem.
        await downloadArtByGameId(artDir, gameId, "PS1", vcdStem, ["COV"]);

        // POPStarter mode also creates an Apps row. RiptOPL keys App artwork by
        // the complete boot ELF filename, including the .ELF extension, so keep
        // a second copy under that identity instead of sacrificing the VCD art.
        if (elfFilename) {
          await downloadArtByGameId(
            artDir,
            gameId,
            "PS1",
            elfFilename,
            ["COV"],
          );
        }
      } catch {
        // Art download failure is non-critical
      }
    }

    if (onProgress) onProgress(100, "Import complete");

    log.info(`PS1 import complete: ${gameId} (${gameName}) → POPS/${vcdFilename}`);
    return {
      success: true,
      vcdPath,
      gameId,
      gameName,
      identificationStatus,
    };
  } catch (err: any) {
    log.error(`PS1 import failed for ${cueFilePath}:`, err?.message || err);
    return {
      success: false,
      message: describeFileAccessError(err),
    };
  } finally {
    if (zipTempDir) {
      try {
        await fs.rm(zipTempDir, { recursive: true, force: true });
      } catch {
        // Non-critical cleanup failure
      }
    }
  }
}

