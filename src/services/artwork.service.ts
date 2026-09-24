import * as fs from "fs/promises";
import path from "path";
import https from "https";
import { createLogger, formatBytes } from "../logger";

const log = createLogger("artwork");

/**
 * Ordered candidate DB codes for each canonical asset slot. The bulk downloader
 * probes each chain in order and saves the first hit under the slot's canonical
 * name, so assets pulled from fallback variants still follow the OPL naming
 * convention (`<gameID>_SCR.png`, `<gameID>_BG.png`, …).
 *
 * Screenshots and backgrounds use the database's indexed variants; the first
 * available screenshot maps to `SCR`, the second to `SCR2`, and the first
 * background to `BG`.
 */
const ART_SLOT_SOURCES: Record<string, string[]> = {
  COV: ["COV"],
  COV2: ["COV2"],
  ICO: ["ICO"],
  SCR: Array.from({ length: 31 }, (_, i) => `SCR_${String(i).padStart(2, "0")}`),
  SCR2: Array.from({ length: 31 }, (_, i) => `SCR_${String(i).padStart(2, "0")}`),
  BG: Array.from({ length: 20 }, (_, i) => `BG_${String(i).padStart(2, "0")}`),
  LAB: ["LAB"],
  LGO: ["LGO"],
};

function httpGetUrl(url: string): Promise<{ status: number; buffer?: Buffer }> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const data: Buffer[] = [];
        res.on("data", (chunk) => data.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, buffer: Buffer.concat(data) })
        );
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
  saveAsByType?: Record<string, string>
) {
  const baseUrl = `https://raw.githubusercontent.com/Luden02/psx-ps2-opl-art-database/refs/heads/main/${system}`;
  const types = artTypes ?? ["COV", "ICO", "SCR"];
  const results: any[] = [];
  const localName = saveAsName || gameId;

  log.info(
    `Downloading ${system} artwork for ${gameId} (${types.join(", ")}) into ${dirPath}`
  );

  for (const type of types) {
    const urlType = saveAsByType?.[type] ?? type;
    const fileName = `${gameId}_${type}.png`;
    const url = `${baseUrl}/${gameId}/${fileName}`;
    log.verbose(`GET ${url}`);

    try {
      const buffer = await new Promise<Buffer>((resolve, reject) => {
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

      // OPL only reads the base asset file, so indexed codes (e.g. BG_00) are
      // fetched by code but written under their base name (<gameID>_BG.png).
      const savePath = path.join(dirPath, `${localName}_${urlType}.png`);
      await fs.writeFile(savePath, buffer);
      log.verbose(`Saved ${type} artwork (${formatBytes(buffer.length)}) → ${savePath}`);
      results.push({
        name: localName,
        type,
        url,
        savedPath: savePath,
      });
    } catch (err: any) {
      log.verbose(`${type} artwork unavailable for ${gameId}: ${err.message}`);
      results.push({
        name: localName,
        type,
        url,
        error: err.message,
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

/**
 * Download artwork for a game by resolving canonical asset slots against the
 * database's variant chains.
 *
 * For each requested slot the ordered `ART_SLOT_SOURCES` chain is probed over
 * the raw CDN and the first available variant is saved under the slot's
 * canonical OPL name (`<localName>_<slot>.png`). Screenshots are resolved as a
 * family: the first available `SCR_NN` maps to `SCR`, the second to `SCR2`;
 * background slots take the first available `BG_NN`. Keeps the same result
 * shape as `downloadArtByGameId`, with `source` holding the DB code that was
 * actually used.
 */
export async function downloadArtResolved(
  dirPath: string,
  gameId: string,
  system: "PS1" | "PS2" = "PS2",
  saveAsName?: string,
  artSlots?: string[]
) {
  const baseUrl = `https://raw.githubusercontent.com/Luden02/psx-ps2-opl-art-database/refs/heads/main/${system}`;
  const slots = artSlots ?? ["COV", "ICO", "SCR"];
  const localName = saveAsName || gameId;
  const results: any[] = [];

  log.info(
    `Downloading ${system} artwork for ${gameId} (slots: ${slots.join(", ")}) into ${dirPath}`
  );

  async function fetchSlot(slot: string, chain: string[]): Promise<void> {
    for (const code of chain) {
      const url = `${baseUrl}/${gameId}/${gameId}_${code}.png`;
      log.verbose(`GET ${url}`);
      try {
        const res = await httpGetUrl(url);
        if (res.status === 200 && res.buffer) {
          const savePath = path.join(dirPath, `${localName}_${slot}.png`);
          await fs.writeFile(savePath, res.buffer);
          log.verbose(
            `Saved ${slot} from ${code} (${formatBytes(res.buffer.length)}) → ${savePath}`
          );
          results.push({
            name: localName,
            type: slot,
            source: code,
            url,
            savedPath: savePath,
          });
          return;
        }
      } catch (err: any) {
        log.verbose(`${slot} probe failed for ${code}: ${err.message}`);
      }
    }
    results.push({
      name: localName,
      type: slot,
      url: `${baseUrl}/${gameId}/${gameId}_${slot}.png`,
      error: "404 Not Found",
    });
  }

  // Exact-code slots (covers, icons, spine, logo) — a single candidate each.
  for (const slot of slots) {
    if (slot !== "SCR" && slot !== "SCR2" && slot !== "BG") {
      await fetchSlot(slot, ART_SLOT_SOURCES[slot]);
    }
  }

  // Screenshots: probe the shared chain until we've found the allocated slots.
  const scrSlots = slots.filter((s) => s === "SCR" || s === "SCR2");
  if (scrSlots.length > 0) {
    const maxHits = scrSlots.includes("SCR2") ? 2 : 1;
    const hits: string[] = [];
    for (const code of ART_SLOT_SOURCES.SCR) {
      if (hits.length >= maxHits) break;
      const url = `${baseUrl}/${gameId}/${gameId}_${code}.png`;
      log.verbose(`GET ${url}`);
      try {
        const res = await httpGetUrl(url);
        if (res.status === 200 && res.buffer) {
          hits.push(code);
          const slot = hits.length === 1 ? "SCR" : "SCR2";
          if (scrSlots.includes(slot)) {
            await fetchSlot(slot, [code]);
          }
        }
      } catch (err: any) {
        log.verbose(`Screenshot probe failed for ${code}: ${err.message}`);
      }
    }
    for (const slot of scrSlots) {
      if (!results.some((r) => r.type === slot)) {
        results.push({
          name: localName,
          type: slot,
          url: `${baseUrl}/${gameId}/${gameId}_${slot}.png`,
          error: "404 Not Found",
        });
      }
    }
  }

  // Background: take the first available indexed variant.
  if (slots.includes("BG")) {
    await fetchSlot("BG", ART_SLOT_SOURCES.BG);
  }

  const saved = results.filter((r) => r.savedPath).length;
  log.info(`Artwork for ${gameId}: ${saved}/${slots.length} file(s) downloaded`);
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
