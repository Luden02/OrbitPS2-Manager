import * as fs from "fs/promises";
import path from "path";
import { createLogger } from "../logger";
import {
  sanitizeGameFilename,
  sanitizeRiptOplPs1StorageName,
} from "../utils/sanitize";
import { parseArtworkBaseName } from "../utils/artwork-name";
import { findPopstarterElf } from "./ps1-import.service";

const log = createLogger("rename");

// ── PS1 rename progress percentages ──────────────────────────────
const PROGRESS_APPS_WAIT = 10;
const PROGRESS_VCD_RENAME = 15;
const PROGRESS_POPS_SUBFOLDER = 25;
const PROGRESS_READ_APPS = 35;
const PROGRESS_ELF_RENAME = 40;
const PROGRESS_APPS_RENAME = 50;
const PROGRESS_CFG_WRITE = 70;
const PROGRESS_DONE = 100;

// ── PS1 rename retry timing (ms) ─────────────────────────────────
const RENAME_STEP2_RETRY_MAX = 10;
const RENAME_STEP2_RETRY_DELAY_MS = 500;
const RENAME_ELF_RETRY_MAX = 5;
const RENAME_ELF_RETRY_DELAY_MS = 300;
const TITLE_CFG_POST_WRITE_DELAY_MS = 800;

function deriveOldTitle(vcdPath: string, gameId: string): string | null {
  const vcdBasename = path.basename(vcdPath);
  const vcdExt = path.extname(vcdBasename);
  const vcdStem = vcdBasename.slice(0, -vcdExt.length);
  const prefix = `${gameId}.`;
  const oldTitle = vcdStem.startsWith(prefix) ? vcdStem.slice(prefix.length) : vcdStem;
  return oldTitle || null;
}

async function renameVcdFile(
  vcdPath: string,
  newVcdPath: string,
  vcdBasename: string,
  newVcdBasename: string,
  onProgress?: (percent: number, stage: string) => void,
): Promise<string | null> {
  onProgress?.(PROGRESS_VCD_RENAME, `Renaming VCD: ${vcdBasename} → ${newVcdBasename}`);
  log.info(`Renaming VCD: ${vcdBasename} → ${newVcdBasename}`);
  try {
    await fs.rename(vcdPath, newVcdPath);
    log.info(`VCD renamed: ${vcdBasename} → ${newVcdBasename}`);
    return null;
  } catch (err: unknown) {
    const msg = `Failed to rename VCD: ${err instanceof Error ? err.message : String(err)}`;
    log.error(msg);
    return msg;
  }
}

/**
 * Renames every cover-art file in ART/ that belongs to this game (per
 * `matches`, tested against the filename portion before its `_TYPE` suffix)
 * to `<newBaseName>_TYPE.ext`, preserving each file's type suffix.
 */
async function renameMatchingCoverArt(
  artDir: string,
  matches: (nameBeforeType: string) => boolean,
  newBaseName: string,
  onProgress?: (percent: number, stage: string) => void,
): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(artDir);
  } catch {
    return 0;
  }

  let renamed = 0;
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const ext = path.extname(name);
    if (!/^\.(png|jpe?g)$/i.test(ext)) continue;
    const baseName = name.slice(0, -ext.length);
    const parsed = parseArtworkBaseName(baseName);
    if (!parsed || !matches(parsed.identity)) continue;

    const targetType = parsed.type;
    const newName = `${newBaseName}_${targetType}${ext}`;
    if (newName === name) continue;

    const sourcePath = path.join(artDir, name);
    const targetPath = path.join(artDir, newName);
    const caseOnly =
      sourcePath !== targetPath &&
      sourcePath.toLocaleLowerCase() === targetPath.toLocaleLowerCase();
    if (!caseOnly) {
      try {
        await fs.access(targetPath);
        log.warn(
          `Artwork target already exists, keeping both files: ${newName} (source ${name} left in place)`
        );
        continue;
      } catch {
        // Target is free.
      }
    }

    try {
      await renameCaseAware(sourcePath, targetPath, "cover-art");
      log.verbose(`Renamed artwork: ${name} → ${newName}`);
      renamed++;
    } catch (err: unknown) {
      log.warn(
        `Failed to rename artwork ${name} → ${newName}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  if (renamed > 0) {
    onProgress?.(90, `Renamed ${renamed} artwork file(s): *_TYPE → ${newBaseName}_TYPE`);
    log.info(`Renamed ${renamed} artwork file(s) in ${artDir} to "${newBaseName}_*"`);
  }
  return renamed;
}

async function copyMatchingCoverArt(
  artDir: string,
  matches: (nameBeforeType: string) => boolean,
  newBaseName: string,
): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(artDir);
  } catch {
    return 0;
  }

  let copied = 0;
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const ext = path.extname(name);
    if (!/^\.(png|jpe?g)$/i.test(ext)) continue;
    const baseName = name.slice(0, -ext.length);
    const parsed = parseArtworkBaseName(baseName);
    if (!parsed || !matches(parsed.identity)) continue;

    const targetType = parsed.type;
    const targetName = `${newBaseName}_${targetType}${ext}`;
    if (targetName.toLocaleLowerCase() === name.toLocaleLowerCase()) continue;

    const sourcePath = path.join(artDir, name);
    const targetPath = path.join(artDir, targetName);
    try {
      await fs.access(targetPath);
      log.verbose(`Artwork copy target already exists, keeping it: ${targetName}`);
      continue;
    } catch {
      // Missing target is expected; create it below.
    }

    try {
      await fs.copyFile(sourcePath, targetPath);
      log.verbose(`Copied artwork: ${name} → ${targetName}`);
      copied++;
    } catch (err: unknown) {
      log.warn(
        `Failed to copy artwork ${name} → ${targetName}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return copied;
}

interface ArtworkRenameOperation {
  sourcePath: string;
  targetPath: string;
  sourceName: string;
  targetName: string;
}

/**
 * Plan renames of the artwork belonging to a single game identity.
 *
 * Every destination is validated up front, so a conflicting or already
 * occupied slot aborts the whole plan instead of overwriting an existing file.
 * The art type is preserved verbatim: RiptOPL's indexed screenshot/background
 * suffixes (`SCR_00`, `BG_02`) and 3D-cover variants are storage identities of
 * their own and must never be remapped onto a different slot.
 */
async function planMatchingCoverArtRenames(
  artDir: string,
  primaryMatches: (nameBeforeType: string) => boolean,
  fallbackMatches: (nameBeforeType: string) => boolean,
  newBaseName: string,
): Promise<{ operations: ArtworkRenameOperation[]; message?: string }> {
  let entries: string[];
  try {
    entries = await fs.readdir(artDir);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { operations: [] };
    }
    return {
      operations: [],
      message:
        "Could not inspect existing artwork: " +
        (err instanceof Error ? err.message : String(err)),
    };
  }

  const imageEntries = entries.filter((name) =>
    /^\.(png|jpe?g)$/i.test(path.extname(name))
  );
  const classify = (name: string): "primary" | "fallback" | null => {
    const ext = path.extname(name);
    const parsed = parseArtworkBaseName(name.slice(0, -ext.length));
    if (!parsed) return null;
    if (primaryMatches(parsed.identity)) return "primary";
    if (fallbackMatches(parsed.identity)) return "fallback";
    return null;
  };

  const plannedLogicalTargets = new Map<
    string,
    { sourceName: string; kind: "primary" | "fallback" }
  >();
  const operations: ArtworkRenameOperation[] = [];

  // Plan primary storage-identity artwork first. GameID-keyed files are
  // fallbacks and must never block or overwrite an already-populated slot.
  const ordered = [
    ...imageEntries.filter((name) => classify(name) === "primary"),
    ...imageEntries.filter((name) => classify(name) === "fallback"),
  ];

  for (const name of ordered) {
    if (name.startsWith(".")) continue;

    const kind = classify(name);
    if (!kind) continue;

    const ext = path.extname(name);
    const baseName = name.slice(0, -ext.length);
    const parsed = parseArtworkBaseName(baseName);
    if (!parsed) continue;

    const targetType = parsed.type;
    const targetName = newBaseName + "_" + targetType + ext;
    if (targetName === name) continue;

    const sourceLower = name.toLocaleLowerCase();
    const targetLogicalKey = path.parse(targetName).name.toLocaleLowerCase();

    const duplicatePlanned = plannedLogicalTargets.get(targetLogicalKey);
    if (duplicatePlanned) {
      if (kind === "fallback" || duplicatePlanned.kind === "primary") {
        if (kind === "fallback") {
          log.verbose(
            `Skipping fallback artwork ${name}; ${duplicatePlanned.sourceName} already fills ${targetName}`
          );
          continue;
        }
        return {
          operations: [],
          message:
            'Cannot normalize artwork because both "' +
            duplicatePlanned.sourceName +
            '" and "' +
            name +
            '" would become the same "' +
            path.parse(targetName).name +
            '" artwork slot.',
        };
      }
    }

    const existingCollision = imageEntries.find((existing) => {
      if (existing.toLocaleLowerCase() === sourceLower) return false;
      if (path.parse(existing).name.toLocaleLowerCase() !== targetLogicalKey) {
        return false;
      }
      // A leftover GameID-keyed file is a fallback, not a blocker for the
      // storage-identity file that owns the slot.
      return classify(existing) !== "fallback";
    });
    if (existingCollision) {
      if (kind === "fallback") {
        log.verbose(
          `Skipping fallback artwork ${name}; ${existingCollision} already occupies ${targetName}`
        );
        continue;
      }
      return {
        operations: [],
        message:
          'Cannot normalize artwork because "' +
          existingCollision +
          '" already occupies the target slot for "' +
          targetName +
          '".',
      };
    }

    plannedLogicalTargets.set(targetLogicalKey, { sourceName: name, kind });
    operations.push({
      sourcePath: path.join(artDir, name),
      targetPath: path.join(artDir, targetName),
      sourceName: name,
      targetName,
    });
  }

  return { operations };
}

async function renameCaseAware(
  sourcePath: string,
  targetPath: string,
  token: string,
): Promise<void> {
  if (
    sourcePath !== targetPath &&
    sourcePath.toLocaleLowerCase() === targetPath.toLocaleLowerCase()
  ) {
    const tempPath =
      sourcePath + ".orbit-rename-" + process.pid + "-" + token;
    await fs.rename(sourcePath, tempPath);
    try {
      await fs.rename(tempPath, targetPath);
    } catch (err) {
      await fs.rename(tempPath, sourcePath).catch(() => undefined);
      throw err;
    }
    return;
  }

  await fs.rename(sourcePath, targetPath);
}

async function executeArtworkRenamePlan(
  operations: ArtworkRenameOperation[],
): Promise<{ success: boolean; renamed: number; message?: string }> {
  const completed: ArtworkRenameOperation[] = [];

  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index];
    try {
      await renameCaseAware(
        operation.sourcePath,
        operation.targetPath,
        "art-" + index,
      );
      completed.push(operation);
      log.verbose(
        "Renamed artwork: " +
          operation.sourceName +
          " → " +
          operation.targetName
      );
    } catch (err: unknown) {
      let rollbackFailed = false;
      for (
        let rollbackIndex = completed.length - 1;
        rollbackIndex >= 0;
        rollbackIndex--
      ) {
        const done = completed[rollbackIndex];
        try {
          await renameCaseAware(
            done.targetPath,
            done.sourcePath,
            "art-rollback-" + rollbackIndex,
          );
        } catch {
          rollbackFailed = true;
        }
      }

      return {
        success: false,
        renamed: 0,
        message:
          'Failed to rename artwork "' +
          operation.sourceName +
          '" → "' +
          operation.targetName +
          '": ' +
          (err instanceof Error ? err.message : String(err)) +
          (rollbackFailed
            ? " Some earlier artwork could not be rolled back automatically."
            : " Earlier artwork changes were rolled back."),
      };
    }
  }

  return { success: true, renamed: completed.length };
}

async function renamePopsSubfolder(
  popsDir: string,
  oldTitle: string,
  safeNewTitle: string,
  onProgress?: (percent: number, stage: string) => void,
): Promise<void> {
  onProgress?.(PROGRESS_POPS_SUBFOLDER, `Renaming VMC folder: ${oldTitle}/ → ${safeNewTitle}/`);
  log.info(`Renaming VMC folder: ${oldTitle}/ → ${safeNewTitle}/`);
  try {
    await fs.access(path.join(popsDir, oldTitle));
    await fs.rename(path.join(popsDir, oldTitle), path.join(popsDir, safeNewTitle));
    log.verbose(`POPS VMC subfolder renamed`);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      log.verbose(`POPS VMC subfolder does not exist — skipping`);
    } else {
      log.warn(`Failed to rename POPS VMC subfolder: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

interface AppsFolderContents {
  oldElfFile?: string;
  oldTitleCfgContent: string;
}

async function readAppsFolderContents(oldAppsFolder: string): Promise<AppsFolderContents | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const files = await fs.readdir(oldAppsFolder);
      const oldElfFile = files.find((f) => /\.ELF$/i.test(f));
      let oldTitleCfgContent = "";
      try {
        oldTitleCfgContent = await fs.readFile(path.join(oldAppsFolder, "title.cfg"), "utf-8");
      } catch { /* no title.cfg — fine */ }
      return { oldElfFile, oldTitleCfgContent };
    } catch {
      if (attempt < 4) await new Promise((r) => setTimeout(r, 200));
    }
  }
  return null;
}

function computeNewElfName(
  oldElfFile: string | undefined,
  gameId: string,
  oldTitle: string,
  safeNewTitle: string,
): string | undefined {
  if (!oldElfFile || !/\.ELF$/i.test(oldElfFile)) return undefined;

  const elfExt = path.extname(oldElfFile);
  const elfStem = oldElfFile.slice(0, -elfExt.length);
  const gIdx = elfStem.indexOf(gameId);
  if (gIdx !== -1) {
    return `${elfStem.slice(0, gIdx)}${gameId}.${safeNewTitle}${elfExt}`;
  }

  const tIdx = elfStem.lastIndexOf(oldTitle);
  if (tIdx !== -1) {
    const newName = `${elfStem.slice(0, tIdx)}${safeNewTitle}${elfExt}`;
    log.verbose(`ELF name derived via oldTitle fallback: ${oldElfFile} → ${newName}`);
    return newName;
  }

  log.warn(`ELF name lacks gameId "${gameId}" and oldTitle "${oldTitle}" — keeping existing`);
  return oldElfFile;
}

interface CfgBuildResult {
  content: string;
  bootVal?: string;
}

function buildNewCfgContent(
  oldTitleCfgContent: string,
  newTitle: string,
  newElfFile: string | undefined,
  gameId: string,
): CfgBuildResult {
  const bootVal = newElfFile ? `boot=${newElfFile}` : undefined;
  const seenKeys = new Map<string, string>();

  const cfgLines = oldTitleCfgContent.split("\n").map((line) => {
    const t = line.trimEnd();
    const eq = t.indexOf("=");
    if (eq === -1) return line;
    const k = t.slice(0, eq).trim();
    const lower = k.toLowerCase();
    if (!seenKeys.has(lower)) seenKeys.set(lower, k);
    if (lower === "title") {
      return k === "Title" ? `Title=${newTitle}` : `title=${newTitle}`;
    }
    if (lower === "boot" && bootVal) return bootVal;
    return line;
  });

  const add: string[] = [];
  if (!seenKeys.has("title")) { add.push(`title=${newTitle}`); add.push(`Title=${newTitle}`); }
  if (!seenKeys.has("boot") && bootVal) add.push(bootVal);
  if (!seenKeys.has("gameid")) add.push(`GameID=${gameId}`);

  const content =
    add.length > 0
      ? cfgLines.join("\n") + (cfgLines.length && cfgLines[cfgLines.length - 1] !== "" ? "\n" : "") + add.join("\n") + "\n"
      : cfgLines.join("\n");

  return { content, bootVal };
}

export async function renamePs1LauncherStep1(
  vcdPath: string,
  gameId: string,
  newTitle: string,
  onProgress?: (percent: number, stage: string) => void
): Promise<{
  success: boolean;
  newVcdPath?: string;
  oldElfFile?: string;
  newElfFile?: string;
  newCfgContent?: string;
  newAppsFolder?: string;
  safeNewTitle?: string;
  message?: string;
}> {
  const safeNewTitle = sanitizeRiptOplPs1StorageName(newTitle, "VCD");
  if (!safeNewTitle) {
    return { success: false, message: "The new name is empty or invalid after sanitization." };
  }

  const popsDir = path.dirname(vcdPath);
  const oplRoot = path.resolve(popsDir, "..");

  const oldTitle = deriveOldTitle(vcdPath, gameId);
  if (!oldTitle) {
    return { success: false, message: "Could not derive the current game title from the VCD filename." };
  }
  if (oldTitle === safeNewTitle) {
    return { success: false, message: "The new name is identical to the current name." };
  }

  log.info(`PS1 rename step 1: "${oldTitle}" → "${safeNewTitle}" (gameId=${gameId})`);

  const vcdBasename = path.basename(vcdPath);
  const vcdExt = path.extname(vcdBasename);
  const newVcdBasename = `${safeNewTitle}${vcdExt}`;
  const newVcdPath = path.join(popsDir, newVcdBasename);
  const appsDir = path.join(oplRoot, "APPS");
  const oldAppsFolder = path.join(appsDir, `POPS_${oldTitle}`);
  const newAppsFolder = path.join(appsDir, `POPS_${safeNewTitle}`);

  const vcdError = await renameVcdFile(vcdPath, newVcdPath, vcdBasename, newVcdBasename, onProgress);
  if (vcdError) return { success: false, message: vcdError };

  await renamePopsSubfolder(popsDir, oldTitle, safeNewTitle, onProgress);

  onProgress?.(PROGRESS_READ_APPS, "Reading APPS launcher folder contents…");
  const appsContents = await readAppsFolderContents(oldAppsFolder);
  if (!appsContents) {
    return { success: false, message: `Cannot read APPS folder "${oldAppsFolder}".` };
  }

  const newElfFile = computeNewElfName(appsContents.oldElfFile, gameId, oldTitle, safeNewTitle);

  const { content: newCfgContent } = buildNewCfgContent(
    appsContents.oldTitleCfgContent,
    newTitle,
    newElfFile,
    gameId,
  );

  onProgress?.(PROGRESS_APPS_RENAME, `Renaming APPS folder: POPS_${oldTitle}/ → POPS_${safeNewTitle}/`);
  log.info(`Renaming APPS folder: POPS_${oldTitle}/ → POPS_${safeNewTitle}/`);
  try {
    await fs.rename(oldAppsFolder, newAppsFolder);
    log.info(`APPS folder renamed: POPS_${oldTitle}/ → POPS_${safeNewTitle}/`);
  } catch (err: unknown) {
    const msg = `Failed to rename APPS launcher folder: ${err instanceof Error ? err.message : String(err)}`;
    log.error(msg);
    return { success: false, message: msg };
  }

  log.info(`PS1 rename step 1 complete for "${oldTitle}" → "${safeNewTitle}"`);
  return {
    success: true,
    newVcdPath,
    oldElfFile: appsContents.oldElfFile,
    newElfFile,
    newCfgContent,
    newAppsFolder,
    safeNewTitle,
  };
}

export async function renamePs1LauncherStep2(
  params: {
    newAppsFolder: string;
    oldElfFile?: string;
    newElfFile?: string;
    newCfgContent?: string;
    newTitle: string;
  },
  onProgress?: (percent: number, stage: string) => void
): Promise<{
  success: boolean;
  message?: string;
}> {
  const { newAppsFolder, oldElfFile, newElfFile, newCfgContent, newTitle } = params;

  log.info(`PS1 rename step 2: applying internal changes to ${newAppsFolder}`);

  onProgress?.(PROGRESS_APPS_WAIT, "Waiting for APPS folder to be ready…");
  await new Promise((r) => setTimeout(r, TITLE_CFG_POST_WRITE_DELAY_MS));

  let appsReady = false;
  for (let attempt = 0; attempt < RENAME_STEP2_RETRY_MAX; attempt++) {
    try {
      await fs.access(newAppsFolder, fs.constants.F_OK);
      const files = await fs.readdir(newAppsFolder);
      if (oldElfFile && !files.some((f) => /\.ELF$/i.test(f))) {
        throw new Error("ELF not yet visible");
      }
      appsReady = true;
      break;
    } catch {
      if (attempt < RENAME_STEP2_RETRY_MAX - 1) await new Promise((r) => setTimeout(r, RENAME_STEP2_RETRY_DELAY_MS));
    }
  }
  if (!appsReady) {
    return { success: false, message: `APPS folder "${newAppsFolder}" is not ready.` };
  }

  if (oldElfFile && newElfFile && oldElfFile !== newElfFile) {
    onProgress?.(PROGRESS_ELF_RENAME, `Renaming ELF: ${oldElfFile} → ${newElfFile}`);
    log.info(`Renaming ELF: ${oldElfFile} → ${newElfFile}`);
    const oldPath = path.join(newAppsFolder, oldElfFile);
    const newPath = path.join(newAppsFolder, newElfFile);
    let done = false;
    for (let attempt = 0; attempt < RENAME_ELF_RETRY_MAX; attempt++) {
      try {
        await fs.rename(oldPath, newPath);
        await fs.access(newPath, fs.constants.F_OK);
        done = true;
        break;
      } catch {
        if (attempt < RENAME_ELF_RETRY_MAX - 1) await new Promise((r) => setTimeout(r, RENAME_ELF_RETRY_DELAY_MS));
      }
    }
    if (!done) {
      log.error(`ELF rename failed after retries: ${oldElfFile} → ${newElfFile}`);
      return { success: false, message: `Failed to rename ELF after multiple attempts.` };
    }
    log.info(`ELF renamed: ${oldElfFile} → ${newElfFile}`);
  }

  if (newCfgContent !== undefined) {
    onProgress?.(PROGRESS_CFG_WRITE, "Updating title.cfg (title, Title, boot)");
    log.info("Updating title.cfg (title, Title, boot)");
    const cfgPath = path.join(newAppsFolder, "title.cfg");
    let done = false;
    for (let attempt = 0; attempt < RENAME_ELF_RETRY_MAX; attempt++) {
      try {
        await fs.writeFile(cfgPath, newCfgContent, "utf-8");
        const verify = await fs.readFile(cfgPath, "utf-8");
        if (verify === newCfgContent) {
          done = true;
          break;
        }
      } catch {
        if (attempt < RENAME_ELF_RETRY_MAX - 1) await new Promise((r) => setTimeout(r, RENAME_ELF_RETRY_DELAY_MS));
      }
    }
    if (!done) {
      log.error(`title.cfg write failed after retries`);
      return { success: false, message: `Failed to update title.cfg after multiple attempts.` };
    }
    log.info(`title.cfg updated`);
  }

  onProgress?.(PROGRESS_DONE, "Rename complete");
  log.info(`PS1 rename step 2 complete`);
  return { success: true };
}

/**
 * Normalize a RiptOPL PS1 storage identity before artwork is downloaded.
 *
 * VCD artwork keys off the VCD filename stem, while Ember artwork keys off the
 * per-game folder name. Identification is handled separately from disc data;
 * this function only makes the on-disk identity match the canonical title.
 */
export async function normalizeRiptOplPs1Storage(params: {
  kind: "VCD" | "EMBER";
  sourcePath: string;
  gameId: string;
  canonicalTitle: string;
  artDir: string;
}): Promise<{
  success: boolean;
  changed?: boolean;
  newPath?: string;
  localName?: string;
  message?: string;
}> {
  const safeTitle = sanitizeRiptOplPs1StorageName(
    params.canonicalTitle,
    params.kind,
  );
  if (!safeTitle) {
    return {
      success: false,
      message: "Canonical PS1 title is empty after sanitization.",
    };
  }

  const sourcePath = path.resolve(params.sourcePath);
  const currentName =
    params.kind === "VCD"
      ? path.basename(sourcePath, path.extname(sourcePath))
      : path.basename(sourcePath);
  const storageNeedsRename = currentName !== safeTitle;
  const targetPath =
    params.kind === "VCD"
      ? path.join(
          path.dirname(sourcePath),
          safeTitle + path.extname(sourcePath)
        )
      : path.join(path.dirname(sourcePath), safeTitle);

  const currentUpper = currentName.toUpperCase();
  const gameIdUpper = params.gameId.toUpperCase();

  // Preflight every art destination before touching the VCD/folder. This
  // prevents existing canonical art from being overwritten and also catches
  // duplicate old-name/GameID art that would collapse onto the same slot.
  const artworkPlan = await planMatchingCoverArtRenames(
    params.artDir,
    (nameBeforeType) => nameBeforeType.toUpperCase() === currentUpper,
    (nameBeforeType) =>
      !!gameIdUpper && nameBeforeType.toUpperCase() === gameIdUpper,
    safeTitle,
  );
  if (artworkPlan.message) {
    return { success: false, message: artworkPlan.message };
  }

  let vmcOldPath: string | undefined;
  let vmcTargetPath: string | undefined;
  let vmcNeedsRename = false;

  if (storageNeedsRename && params.kind === "VCD") {
    vmcOldPath = path.join(path.dirname(sourcePath), currentName);
    vmcTargetPath = path.join(path.dirname(sourcePath), safeTitle);

    try {
      const vmcStat = await fs.stat(vmcOldPath);
      vmcNeedsRename = vmcStat.isDirectory();
    } catch (err: unknown) {
      if (
        !(err instanceof Error) ||
        !("code" in err) ||
        (err as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        return {
          success: false,
          message:
            "Could not inspect the existing PS1 VMC folder: " +
            (err instanceof Error ? err.message : String(err)),
        };
      }
    }

    if (vmcNeedsRename && vmcTargetPath) {
      const vmcCaseOnly =
        vmcOldPath !== vmcTargetPath &&
        vmcOldPath.toLocaleLowerCase() ===
          vmcTargetPath.toLocaleLowerCase();

      if (!vmcCaseOnly) {
        try {
          await fs.access(vmcTargetPath);
          return {
            success: false,
            message:
              'Cannot normalize VMC folder "' +
              currentName +
              '" because "' +
              safeTitle +
              '" already exists.',
          };
        } catch (err: unknown) {
          if (
            !(err instanceof Error) ||
            !("code" in err) ||
            (err as NodeJS.ErrnoException).code !== "ENOENT"
          ) {
            return {
              success: false,
              message:
                "Could not check the VMC normalization target: " +
                (err instanceof Error ? err.message : String(err)),
            };
          }
        }
      }
    }
  }

  if (storageNeedsRename) {
    const caseOnlyRename =
      sourcePath !== targetPath &&
      sourcePath.toLocaleLowerCase() === targetPath.toLocaleLowerCase();

    if (!caseOnlyRename) {
      try {
        await fs.access(targetPath);
        return {
          success: false,
          message:
            'Cannot normalize "' +
            currentName +
            '" because "' +
            safeTitle +
            '" already exists.',
        };
      } catch (err: unknown) {
        if (
          !(err instanceof Error) ||
          !("code" in err) ||
          (err as NodeJS.ErrnoException).code !== "ENOENT"
        ) {
          return {
            success: false,
            message:
              "Could not check normalization target: " +
              (err instanceof Error ? err.message : String(err)),
          };
        }
      }
    }

    try {
      await renameCaseAware(sourcePath, targetPath, "storage");
    } catch (err: unknown) {
      return {
        success: false,
        message:
          "Failed to normalize " +
          params.kind +
          " identity: " +
          (err instanceof Error ? err.message : String(err)),
      };
    }
  }

  let vmcRenamed = false;
  if (vmcNeedsRename && vmcOldPath && vmcTargetPath) {
    try {
      await renameCaseAware(vmcOldPath, vmcTargetPath, "vmc");
      vmcRenamed = true;
    } catch (err: unknown) {
      if (storageNeedsRename) {
        await renameCaseAware(
          targetPath,
          sourcePath,
          "storage-rollback-vmc"
        ).catch(() => undefined);
      }
      return {
        success: false,
        message:
          "Failed to normalize the PS1 VMC folder: " +
          (err instanceof Error ? err.message : String(err)),
      };
    }
  }

  const artworkResult = await executeArtworkRenamePlan(
    artworkPlan.operations
  );
  if (!artworkResult.success) {
    let rollbackMessage = "";

    if (vmcRenamed && vmcOldPath && vmcTargetPath) {
      try {
        await renameCaseAware(
          vmcTargetPath,
          vmcOldPath,
          "vmc-rollback"
        );
      } catch (rollbackErr: unknown) {
        rollbackMessage +=
          " VMC rollback failed: " +
          (rollbackErr instanceof Error
            ? rollbackErr.message
            : String(rollbackErr));
      }
    }

    if (storageNeedsRename) {
      try {
        await renameCaseAware(
          targetPath,
          sourcePath,
          "storage-rollback"
        );
      } catch (rollbackErr: unknown) {
        rollbackMessage +=
          " Storage rollback failed: " +
          (rollbackErr instanceof Error
            ? rollbackErr.message
            : String(rollbackErr));
      }
    }

    return {
      success: false,
      message: (artworkResult.message ?? "Artwork migration failed.") +
        rollbackMessage,
    };
  }

  const changed =
    storageNeedsRename ||
    vmcRenamed ||
    artworkResult.renamed > 0;

  if (vmcRenamed) {
    log.info(
      'Normalized PS1 VMC folder: "' +
        currentName +
        '" → "' +
        safeTitle +
        '"'
    );
  }

  if (artworkResult.renamed > 0) {
    log.info(
      "Renamed " +
        artworkResult.renamed +
        ' artwork file(s) in ' +
        params.artDir +
        ' to "' +
        safeTitle +
        '_*"'
    );
  }

  if (changed) {
    log.info(
      "Normalized RiptOPL " +
        params.kind +
        ' identity: "' +
        currentName +
        '" → "' +
        safeTitle +
        '"'
    );
  }

  return {
    success: true,
    changed,
    newPath: storageNeedsRename ? targetPath : sourcePath,
    localName: safeTitle,
  };
}

/**
 * Converts a POPStarter-launched PS1 game to POPSLoader style: strips the
 * "<GameID>." prefix from the VCD filename, deletes the APPS launcher
 * folder, and renames any matching ART/ files (previously keyed by GameID
 * or the launcher's ELF filename) to the "<Title>_TYPE.png" convention
 * POPSLoader/RiptOPL expects.
 */
export async function convertPs1LauncherToPopsLoader(
  vcdPath: string,
  gameId: string,
  onProgress?: (percent: number, stage: string) => void,
): Promise<{
  success: boolean;
  newVcdPath?: string;
  message?: string;
}> {
  const popsDir = path.dirname(vcdPath);
  const oplRoot = path.resolve(popsDir, "..");

  const oldTitle = deriveOldTitle(vcdPath, gameId);
  if (!oldTitle) {
    return { success: false, message: "Could not derive the current game title from the VCD filename." };
  }

  const vcdBasename = path.basename(vcdPath);
  const vcdExt = path.extname(vcdBasename);
  if (vcdBasename === `${oldTitle}${vcdExt}`) {
    return { success: false, message: "This game's VCD filename already has no GameID prefix." };
  }

  log.info(`PS1 convert-to-POPSLoader: "${vcdBasename}" (gameId=${gameId})`);

  const targetTitle = sanitizeRiptOplPs1StorageName(oldTitle, "VCD");
  const newVcdBasename = `${targetTitle}${vcdExt}`;
  const newVcdPath = path.join(popsDir, newVcdBasename);

  const vcdError = await renameVcdFile(vcdPath, newVcdPath, vcdBasename, newVcdBasename, onProgress);
  if (vcdError) return { success: false, message: vcdError };

  const appsFolder = path.join(oplRoot, "APPS", `POPS_${oldTitle}`);
  onProgress?.(80, `Removing APPS launcher: POPS_${oldTitle}/`);
  try {
    await fs.rm(appsFolder, { recursive: true, force: true });
    log.info(`Removed APPS launcher folder: POPS_${oldTitle}/`);
  } catch (err: unknown) {
    const msg = `VCD renamed, but failed to remove APPS launcher folder: ${err instanceof Error ? err.message : String(err)}`;
    log.error(msg);
    return { success: false, newVcdPath, message: msg };
  }

  onProgress?.(88, "Renaming VCD artwork to match the new filename…");
  const artDir = path.join(oplRoot, "ART");
  const oldVcdStem = vcdBasename.slice(0, -vcdExt.length);
  const oldVcdStemLower = oldVcdStem.toLowerCase();
  const renamedVcdArt = await renameMatchingCoverArt(
    artDir,
    (nameBeforeType) => nameBeforeType.toLowerCase() === oldVcdStemLower,
    targetTitle,
    onProgress,
  );

  // Older layouts may only have the strict GameID fallback file. Use it only
  // when no exact VCD-stem art was available; launcher ELF art is deliberately
  // not folded in because it is a separate Apps identity and may be customized.
  if (renamedVcdArt === 0) {
    const gameIdLower = gameId.toLowerCase();
    await renameMatchingCoverArt(
      artDir,
      (nameBeforeType) => nameBeforeType.toLowerCase() === gameIdLower,
      targetTitle,
      onProgress,
    );
  }

  onProgress?.(PROGRESS_DONE, "Conversion complete");
  log.info(`PS1 convert-to-POPSLoader complete: "${vcdBasename}" → "${newVcdBasename}"`);
  return { success: true, newVcdPath };
}

/**
 * Reverses `convertPs1LauncherToPopsLoader`: prefixes the VCD filename with
 * "<GameID>.", recreates the APPS/POPStarter launcher (POPSTARTER.ELF +
 * title.cfg), moves VCD artwork to the new VCD-stem identity, and duplicates
 * that artwork under the full launcher ELF filename for the Apps row.
 */
export async function convertPs1LauncherToPopstarter(
  vcdPath: string,
  gameId: string,
  gameName: string,
  elfPrefix: string,
  onProgress?: (percent: number, stage: string) => void,
): Promise<{
  success: boolean;
  newVcdPath?: string;
  message?: string;
}> {
  const popsDir = path.dirname(vcdPath);
  const oplRoot = path.resolve(popsDir, "..");

  const vcdBasename = path.basename(vcdPath);
  const vcdExt = path.extname(vcdBasename);
  const title = vcdBasename.slice(0, -vcdExt.length);
  const filesystemSafeTitle = sanitizeGameFilename(title) || title;
  const newVcdStem = sanitizeRiptOplPs1StorageName(
    `${gameId}.${filesystemSafeTitle}`,
    "VCD",
  );
  const prefix = `${gameId}.`;
  const safeTitle = newVcdStem.startsWith(prefix)
    ? newVcdStem.slice(prefix.length)
    : filesystemSafeTitle;

  if (title.toLowerCase().startsWith(`${gameId.toLowerCase()}.`)) {
    return { success: false, message: "This game's VCD filename already has a GameID prefix." };
  }

  log.info(`PS1 convert-to-POPStarter: "${vcdBasename}" (gameId=${gameId})`);

  onProgress?.(0, "Setting up POPStarter launcher");
  const popstarterElf = await findPopstarterElf();
  if (!popstarterElf) {
    return {
      success: false,
      message:
        "POPSTARTER.ELF not found in assets. Please place the Popstarter ELF file at assets/POPSTARTER.ELF.",
    };
  }

  const newVcdBasename = `${newVcdStem}${vcdExt}`;
  const newVcdPath = path.join(popsDir, newVcdBasename);

  const vcdError = await renameVcdFile(vcdPath, newVcdPath, vcdBasename, newVcdBasename, onProgress);
  if (vcdError) return { success: false, message: vcdError };

  const elfFilename = elfPrefix
    ? `${elfPrefix}${gameId}.${safeTitle}.ELF`
    : `${gameId}.${safeTitle}.ELF`;
  const appsFolderName = `POPS_${safeTitle}`;
  const appsGameDir = path.join(oplRoot, "APPS", appsFolderName);

  onProgress?.(50, `Creating APPS launcher: ${appsFolderName}/`);
  try {
    await fs.mkdir(appsGameDir, { recursive: true });
    await fs.copyFile(popstarterElf, path.join(appsGameDir, elfFilename));
    await fs.writeFile(
      path.join(appsGameDir, "title.cfg"),
      `title=${gameName}\nboot=${elfFilename}\nGameID=${gameId}\n`,
      "utf-8"
    );
    log.info(`Created POPStarter launcher APPS/${appsFolderName}/${elfFilename}`);
  } catch (err: unknown) {
    const msg = `VCD renamed, but failed to create APPS launcher: ${err instanceof Error ? err.message : String(err)}`;
    log.error(msg);
    return { success: false, newVcdPath, message: msg };
  }

  onProgress?.(88, "Updating VCD and launcher artwork identities…");
  const artDir = path.join(oplRoot, "ART");
  const oldTitleLower = title.toLowerCase();
  await renameMatchingCoverArt(
    artDir,
    (nameBeforeType) => nameBeforeType.toLowerCase() === oldTitleLower,
    newVcdStem,
    onProgress,
  );
  const newVcdStemLower = newVcdStem.toLowerCase();
  await copyMatchingCoverArt(
    artDir,
    (nameBeforeType) => nameBeforeType.toLowerCase() === newVcdStemLower,
    elfFilename,
  );

  onProgress?.(PROGRESS_DONE, "Conversion complete");
  log.info(`PS1 convert-to-POPStarter complete: "${vcdBasename}" → "${newVcdBasename}"`);
  return { success: true, newVcdPath };
}
