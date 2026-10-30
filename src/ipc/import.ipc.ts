import { ipcMain } from "electron";
import { importPs2CdGame } from "../services/cd-import.service";
import { importPs1Game } from "../services/ps1-import.service";
import { importApp } from "../services/apps.service";
import {
  listOpticalDrives,
  listOpticalDrivesForCd,
  ripOpticalDvd,
  deleteTempRipFile,
} from "../services/optical-drive.service";
import { ripOpticalCd } from "../services/redumper.service";

export function registerImportIpc(): void {
  ipcMain.handle(
    "import-ps2-cd-game",
    async (
      event,
      cueFilePath: string,
      oplRoot: string,
      gameId: string | undefined,
      gameName: string | undefined,
      downloadArtwork: boolean
    ) => {
      return importPs2CdGame(
        cueFilePath,
        oplRoot,
        gameId,
        gameName,
        downloadArtwork,
        (percent, stage) => {
          event.sender.send("ps2-cd-import-progress", { percent, stage });
        }
      );
    }
  );

  ipcMain.handle(
    "import-ps1-game",
    async (
      event,
      cueFilePath: string,
      oplRoot: string,
      elfPrefix: string,
      downloadArtwork: boolean,
      gameId?: string,
      gameName?: string,
      launcherMode?: "popstarter" | "popsloader"
    ) => {
      return importPs1Game(
        cueFilePath,
        oplRoot,
        elfPrefix,
        downloadArtwork,
        gameId,
        gameName,
        launcherMode,
        (percent, stage) => {
          event.sender.send("ps1-import-progress", { percent, stage });
        }
      );
    }
  );

  ipcMain.handle(
    "import-app",
    async (_event, oplRoot: string, elfPath: string, title: string) => {
      return importApp(oplRoot, elfPath, title);
    }
  );

  ipcMain.handle("list-optical-drives", async () => {
    return listOpticalDrives();
  });

  ipcMain.handle(
    "rip-ps2-dvd-from-drive",
    async (event, devicePath: string, destDir: string) => {
      return ripOpticalDvd(devicePath, destDir, (percent, stage) => {
        event.sender.send("dvd-rip-progress", { percent, stage });
      });
    }
  );

  ipcMain.handle("list-optical-drives-cd", async () => {
    return listOpticalDrivesForCd();
  });

  ipcMain.handle(
    "rip-ps2-cd-from-drive",
    async (event, devicePath: string, destDir: string) => {
      return ripOpticalCd(devicePath, destDir, (line) => {
        event.sender.send("cd-rip-line", line);
      });
    }
  );

  ipcMain.handle("delete-temp-disc-rip", async (_event, filePath: string) => {
    return deleteTempRipFile(filePath);
  });
}
