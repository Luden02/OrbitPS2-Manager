import { ipcMain } from "electron";
import {
  downloadArtByGameId,
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
      wideSlotFallback?: boolean,
    ) => {
      return downloadArtByGameId(
        dirPath,
        gameId,
        system || "PS2",
        saveAsName,
        artTypes,
        // The injectable downloader is for tests; the renderer always takes the
        // real HTTPS path, so it stays `undefined` here.
        undefined,
        saveAsByType,
        wideSlotFallback,
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
    "list-available-art",
    async (_event, gameId: string, system?: "PS1" | "PS2") => {
      return listAvailableArt(gameId, system || "PS2");
    },
  );
}
