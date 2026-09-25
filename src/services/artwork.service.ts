import * as fs from "fs/promises";
import path from "path";
import https from "https";
import { createLogger, formatBytes } from "../logger";
import { artRemoteFileNames } from "./artwork-filenames";

const log = createLogger("artwork");

export type ArtDownloader = (url: string, fileName: string) => Promise<Buffer>;

async function downloadBuffer(url: string, fileName: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          return reject(
            new Error(`Failed to download ${fileName}: ${res.statusCode}`)
          );
        }
        const data: Buffer[] = [];
        res.on("data", (chunk) => data.push(chunk));
        res.on("end", () => resolve(Buffer.concat(data)));
      })
      .on("error", reject);
  });
}

export async function downloadArtByGameId(
  dirPath: string,
  gameId: string,
  system: "PS1" | "PS2" = "PS2",
  saveAsName?: string,
  artTypes?: string[],
  downloader: ArtDownloader = downloadBuffer
) {
  const baseUrl = `https://raw.githubusercontent.com/Luden02/psx-ps2-opl-art-database/refs/heads/main/${system}`;
  const types = artTypes ?? ["COV", "ICO", "SCR"];
  const results: any[] = [];
  const localName = saveAsName || gameId;

  log.info(
    `Downloading ${system} artwork for ${gameId} (${types.join(", ")}) into ${dirPath}`
  );

  for (const type of types) {
    const candidates = artRemoteFileNames(gameId, type);
    let lastUrl = "";
    let lastError: Error | null = null;
    let saved = false;

    for (const fileName of candidates) {
      const url = `${baseUrl}/${gameId}/${fileName}`;
      lastUrl = url;
      log.verbose(`GET ${url}`);

      try {
        const buffer = await downloader(url, fileName);
        const savePath = path.join(dirPath, `${localName}_${type}.png`);
        await fs.writeFile(savePath, buffer);
        log.verbose(`Saved ${type} artwork (${formatBytes(buffer.length)}) → ${savePath}`);
        results.push({
          name: localName,
          type,
          url,
          savedPath: savePath,
        });
        saved = true;
        break;
      } catch (err: any) {
        lastError = err;
        const isLastCandidate = fileName === candidates[candidates.length - 1];
        if (!isLastCandidate) {
          log.verbose(
            `${type} candidate ${fileName} failed for ${gameId}, trying next: ${err.message}`
          );
        }
      }
    }

    if (!saved) {
      log.verbose(
        `${type} artwork unavailable for ${gameId}: ${lastError?.message ?? `Failed to download ${type}`}`
      );
      results.push({
        name: localName,
        type,
        url: lastUrl,
        error: lastError?.message ?? `Failed to download ${type}`,
      });
    }
  }

  const saved = results.filter((r) => r.savedPath).length;
  log.info(`Artwork for ${gameId}: ${saved}/${types.length} file(s) downloaded`);
  if (saved === 0) {
    const msg = `No artwork found for ${gameId} in ${system} database.`;
    log.warn(msg);
    return { success: false, data: results, message: msg };
  }
  return { success: true, data: results };
}

export interface AvailableArtEntry {
  type: string;
  fileName: string;
  downloadUrl: string;
}

export async function listAvailableArt(
  gameId: string,
  system: "PS1" | "PS2" = "PS2"
): Promise<{ success: boolean; data: AvailableArtEntry[]; message?: string }> {
  const url = `https://api.github.com/repos/Luden02/psx-ps2-opl-art-database/contents/${system}/${gameId}`;
  log.verbose(`GET ${url}`);

  try {
    const body = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      https
        .get(
          url,
          {
            headers: {
              "User-Agent": "OrbitPS2-Manager",
              Accept: "application/vnd.github+json",
            },
          },
          (res) => {
            const data: Buffer[] = [];
            res.on("data", (chunk) => data.push(chunk));
            res.on("end", () =>
              resolve({ status: res.statusCode ?? 0, text: Buffer.concat(data).toString("utf-8") })
            );
          }
        )
        .on("error", reject);
    });

    if (body.status === 404) {
      return { success: true, data: [], message: `No artwork available for ${gameId} yet.` };
    }

    if (body.status === 403) {
      log.warn(`GitHub API rate limit hit while listing art for ${gameId}`);
      return {
        success: false,
        data: [],
        message: "GitHub API rate limit exceeded — try again later.",
      };
    }

    if (body.status !== 200) {
      return {
        success: false,
        data: [],
        message: `Failed to list artwork for ${gameId}: ${body.status}`,
      };
    }

    const json = JSON.parse(body.text);
    if (!Array.isArray(json)) {
      return { success: true, data: [], message: `No artwork available for ${gameId} yet.` };
    }

    const prefix = `${gameId}_`;
    const entries: AvailableArtEntry[] = json
      .filter((entry: any) => entry?.type === "file" && typeof entry.name === "string")
      .filter((entry: any) => entry.name.startsWith(prefix))
      .map((entry: any) => ({
        type: entry.name.slice(prefix.length).replace(/\.(png|jpg|jpeg)$/i, ""),
        fileName: entry.name,
        downloadUrl: entry.download_url,
      }));

    log.info(`Found ${entries.length} artwork file(s) for ${gameId} in ${system} database`);
    return { success: true, data: entries };
  } catch (err: any) {
    log.warn(`Failed to list artwork for ${gameId}: ${err.message}`);
    return { success: false, data: [], message: err.message };
  }
}

export async function checkArtFilesExist(artDir: string, filenames: string[]) {
  const existing: string[] = [];
  for (const name of filenames) {
    try {
      await fs.access(path.join(artDir, name));
      existing.push(name);
    } catch {
      // File does not exist — skip.
    }
  }
  return existing;
}
