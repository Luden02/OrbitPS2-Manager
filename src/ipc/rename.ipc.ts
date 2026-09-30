import { ipcMain } from "electron";
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
      return normalizeRiptOplPs1Storage(params);
    }
  );
}
