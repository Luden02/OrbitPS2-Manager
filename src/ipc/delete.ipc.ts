import { ipcMain } from "electron";
import { deleteEmberGameAndRelatedFiles, deleteGameAndRelatedFiles } from "../services/delete.service";
import path from "path";
import { getSettings } from "../services/settings.service";
import {
  deleteApp,
  deleteAppWithProgress,
} from "../services/apps.service";

export function registerDeleteIpc(): void {
  ipcMain.handle(
    "delete-game-and-related-files",
    async (
      event,
      gamePath: string,
      artDir: string,
      gameId: string,
      launcherFolder?: string,
      bootName?: string
    ) => {
      return deleteGameAndRelatedFiles(gamePath, artDir, gameId, launcherFolder, (entry) => {
        event.sender.send("delete-ps1-progress", entry);
      }, bootName);
    }
  );


  ipcMain.handle(
    "delete-ember-game-and-related-files",
    async (
      event,
      gamePath: string,
      artDir: string,
      identity: string,
    ) => {
      if (
        typeof gamePath !== "string" ||
        typeof artDir !== "string" ||
        typeof identity !== "string" ||
        !gamePath ||
        !artDir ||
        !identity
      ) {
        return { success: false, entries: [], message: "Invalid Ember delete request." };
      }

      const settings = getSettings();
      if (!settings.lastDirectory) {
        return { success: false, entries: [], message: "No mounted library is available." };
      }

      const root = path.resolve(settings.lastDirectory);
      const resolvedGame = path.resolve(gamePath);
      const resolvedArt = path.resolve(artDir);
      const equalPath = (a: string, b: string) =>
        process.platform === "win32"
          ? a.toLocaleLowerCase() === b.toLocaleLowerCase()
          : a === b;

      if (!equalPath(resolvedArt, path.join(root, "ART"))) {
        return { success: false, entries: [], message: "Artwork path is outside the mounted library." };
      }

      const defaultGames = path.join(root, "EMBER", "games");
      const configured =
        settings.emberDirectories?.[settings.lastDirectory] ??
        settings.emberDirectories?.[root];
      const configuredGames = configured
        ? path.basename(path.resolve(configured)).toLocaleLowerCase() === "games"
          ? path.resolve(configured)
          : path.join(path.resolve(configured), "games")
        : undefined;
      const allowed =
        equalPath(path.dirname(resolvedGame), defaultGames) ||
        (!!configuredGames && equalPath(path.dirname(resolvedGame), configuredGames));
      if (!allowed) {
        return { success: false, entries: [], message: "Ember game path is outside the configured games directory." };
      }

      return deleteEmberGameAndRelatedFiles(
        resolvedGame,
        resolvedArt,
        identity,
        (entry) => event.sender.send("delete-ps1-progress", entry),
      );
    }
  );

  ipcMain.handle(
    "delete-app",
    async (_event, oplRoot: string, folder: string) => {
      return deleteApp(oplRoot, folder);
    }
  );

  ipcMain.handle(
    "delete-app-with-progress",
    async (event, oplRoot: string, folder: string, bootName: string) => {
      return deleteAppWithProgress(oplRoot, folder, bootName, (entry) => {
        event.sender.send("delete-app-progress", entry);
      });
    }
  );
}
