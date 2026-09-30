import * as electron from "electron";
import path from "path";

/**
 * Path to the bundled "assets" directory, both in dev (project root) and
 * packaged builds (inside app.asar, next to package.json). Plain Node tooling
 * and tests do not expose Electron's `app` object, so they resolve assets from
 * the repository working directory instead.
 */
export function getAssetsDir(): string {
  const electronApp = (electron as any).app;
  const appPath =
    electronApp && typeof electronApp.getAppPath === "function"
      ? electronApp.getAppPath()
      : process.cwd();
  return path.join(appPath, "assets");
}
