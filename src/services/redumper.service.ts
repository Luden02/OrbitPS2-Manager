import { spawn } from "child_process";
import * as fs from "fs/promises";
import path from "path";
import { app } from "electron";
import { createLogger } from "../logger";
import { TEMP_RIP_PREFIX } from "./optical-drive.service";

const log = createLogger("redumper");

function platformDirName(): string {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

/**
 * Path to the bundled redumper binary. Packaged builds get it copied into
 * `resourcesPath/redumper/bin/` by scripts/after-pack.js (one arch per
 * build); in dev it's read straight from the per-arch folder the fetch
 * script downloads into `resources/`.
 */
export function resolveRedumperBinary(): string {
  const binName = process.platform === "win32" ? "redumper.exe" : "redumper";
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, "redumper")
    : path.join(__dirname, "..", "..", "..", "resources", "redumper", `${platformDirName()}-${process.arch}`);
  return path.join(dir, "bin", binName);
}

export interface RipCdResult {
  success: boolean;
  message?: string;
  cuePath?: string;
}

/**
 * Rip a PS2 CD via the bundled redumper tool. redumper's `disc` command
 * chains dump + split internally, producing a plain `<imageName>.cue`
 * (+ one or more track `.bin` files) under destDir — the same shape
 * importPs2CdGame already consumes from a user-picked CUE.
 */
export async function ripOpticalCd(
  devicePath: string,
  destDir: string,
  onLine?: (line: string) => void
): Promise<RipCdResult> {
  const binary = resolveRedumperBinary();
  try {
    await fs.access(binary);
  } catch {
    return {
      success: false,
      message: "redumper is not bundled for this platform/build — CD import from drive is unavailable.",
    };
  }

  await fs.mkdir(destDir, { recursive: true });
  const imageName = `${TEMP_RIP_PREFIX}${Date.now()}`;

  return new Promise((resolve) => {
    const args = [
      "disc",
      `--drive=${devicePath}`,
      `--image-name=${imageName}`,
      `--image-path=${destDir}`,
      "--overwrite",
    ];
    log.info(`Starting redumper: ${binary} ${args.join(" ")}`);

    let child;
    try {
      child = spawn(binary, args, { windowsHide: true });
    } catch (err: any) {
      resolve({ success: false, message: err?.message || String(err) });
      return;
    }

    let lastOutput = "";
    const forward = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) {
          lastOutput = trimmed;
          onLine?.(trimmed);
        }
      }
    };
    child.stdout?.on("data", forward);
    child.stderr?.on("data", forward);

    child.on("error", (err) => {
      log.error("Failed to launch redumper:", err?.message || err);
      resolve({ success: false, message: err?.message || String(err) });
    });

    child.on("close", async (code) => {
      const cuePath = path.join(destDir, `${imageName}.cue`);
      try {
        await fs.access(cuePath);
        log.info(`redumper CD rip complete: ${cuePath}`);
        resolve({ success: true, cuePath });
      } catch {
        log.error(`redumper exited with code ${code}, no .cue produced. Last output: ${lastOutput}`);
        resolve({
          success: false,
          message: lastOutput || `redumper exited with code ${code} and produced no output.`,
        });
      }
    });
  });
}
