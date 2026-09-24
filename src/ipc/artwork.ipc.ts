import { ipcMain } from "electron";
import {
  downloadArtByGameId,
  downloadArtResolved,
  checkArtFilesExist,
  listAvailableArt,
} from "../services/artwork.service";

export function registerArtworkIpc(): void {
  ipcMain.handle(
    "download-art-by-gameid",
    async (
      _event,
      dirPath: string,
      gameId: string,
      system?: "PS1" | "PS2",
      saveAsName?: string,
      artTypes?: string[],
      saveAsByType?: Record<string, string>,
    ) => {
      return downloadArtByGameId(
        dirPath,
        gameId,
        system || "PS2",
        saveAsName,
        artTypes,
        saveAsByType,
      );
    },
  );

  ipcMain.handle(
    "check-art-files-exist",
    async (_event, artDir: string, filenames: string[]) => {
      return checkArtFilesExist(artDir, filenames);
    },
  );

  ipcMain.handle(
    "download-art-resolved",
    async (
      _event,
      dirPath: string,
      gameId: string,
      system?: "PS1" | "PS2",
      saveAsName?: string,
      artSlots?: string[],
    ) => {
      return downloadArtResolved(
        dirPath,
        gameId,
        system || "PS2",
        saveAsName,
        artSlots,
      );
    },
  );

  ipcMain.handle(
    "list-available-art",
    async (_event, gameId: string, system?: "PS1" | "PS2") => {
      return listAvailableArt(gameId, system || "PS2");
    },
  );
}
