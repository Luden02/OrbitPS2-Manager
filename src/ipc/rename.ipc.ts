import { ipcMain } from "electron";
import path from "path";
import { getSettings } from "../services/settings.service";
import {
  renamePs1LauncherStep1,
  renamePs1LauncherStep2,
  convertPs1LauncherToPopsLoader,
  convertPs1LauncherToPopstarter,
  normalizeRiptOplPs1Storage,
} from "../services/rename.service";

export function registerRenameIpc(): void {
  ipcMain.handle(
    "rename-ps1-launcher-step1",
    async (
      event,
      vcdPath: string,
      gameId: string,
      newTitle: string
    ) => {
      return renamePs1LauncherStep1(vcdPath, gameId, newTitle, (percent, stage) => {
        event.sender.send("rename-ps1-progress", { percent, stage });
      });
    }
  );

  ipcMain.handle(
    "rename-ps1-launcher-step2",
    async (
      event,
      params: {
        newAppsFolder: string;
        oldElfFile?: string;
        newElfFile?: string;
        newCfgContent?: string;
        newTitle: string;
      }
    ) => {
      return renamePs1LauncherStep2(params, (percent, stage) => {
        event.sender.send("rename-ps1-progress", { percent, stage });
      });
    }
  );

  ipcMain.handle(
    "normalize-riptopl-ps1-storage",
    async (
      _event,
      params: {
        kind: "VCD" | "EMBER";
        sourcePath: string;
        gameId: string;
        canonicalTitle: string;
        artDir: string;
      }
    ) => {
      if (
        !params ||
        (params.kind !== "VCD" && params.kind !== "EMBER") ||
        typeof params.sourcePath !== "string" ||
        typeof params.gameId !== "string" ||
        typeof params.canonicalTitle !== "string" ||
        typeof params.artDir !== "string" ||
        params.sourcePath.length === 0 ||
        params.sourcePath.length > 4096 ||
        params.artDir.length === 0 ||
        params.artDir.length > 4096 ||
        params.gameId.length === 0 ||
        params.gameId.length > 128 ||
        params.canonicalTitle.length === 0 ||
        params.canonicalTitle.length > 512
      ) {
        return { success: false, message: "Invalid PS1 normalization request." };
      }

      const settings = getSettings();
      if (!settings.lastDirectory) {
        return { success: false, message: "No mounted library is available for normalization." };
      }

      const root = path.resolve(settings.lastDirectory);
      const sourcePath = path.resolve(params.sourcePath);
      const artDir = path.resolve(params.artDir);
      const equalPath = (a: string, b: string) =>
        process.platform === "win32"
          ? a.toLocaleLowerCase() === b.toLocaleLowerCase()
          : a === b;

      if (!equalPath(artDir, path.join(root, "ART"))) {
        return { success: false, message: "Artwork path is outside the mounted library." };
      }

      let sourceAllowed = false;
      if (params.kind === "VCD") {
        sourceAllowed =
          equalPath(path.dirname(sourcePath), path.join(root, "POPS")) &&
          path.extname(sourcePath).toLocaleLowerCase() === ".vcd";
      } else {
        const defaultGames = path.join(root, "EMBER", "games");
        const configured =
          settings.emberDirectories?.[settings.lastDirectory] ??
          settings.emberDirectories?.[root];
        const configuredGames = configured
          ? path.basename(path.resolve(configured)).toLocaleLowerCase() === "games"
            ? path.resolve(configured)
            : path.join(path.resolve(configured), "games")
          : undefined;
        sourceAllowed =
          equalPath(path.dirname(sourcePath), defaultGames) ||
          (!!configuredGames && equalPath(path.dirname(sourcePath), configuredGames));
      }

      if (!sourceAllowed) {
        return { success: false, message: "PS1 storage path is outside the mounted library." };
      }

      return normalizeRiptOplPs1Storage({
        ...params,
        sourcePath,
        artDir,
      });
    }
  );

  ipcMain.handle(
    "convert-ps1-to-popsloader",
    async (event, vcdPath: string, gameId: string) => {
      return convertPs1LauncherToPopsLoader(vcdPath, gameId, (percent, stage) => {
        event.sender.send("convert-ps1-popsloader-progress", { percent, stage });
      });
    }
  );

  ipcMain.handle(
    "convert-ps1-to-popstarter",
    async (
      event,
      vcdPath: string,
      gameId: string,
      gameName: string,
      elfPrefix: string
    ) => {
      return convertPs1LauncherToPopstarter(
        vcdPath,
        gameId,
        gameName,
        elfPrefix,
        (percent, stage) => {
          event.sender.send("convert-ps1-popstarter-progress", { percent, stage });
        }
      );
    }
  );
}
