import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { downloadArtByGameId } from "./artwork.service";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-art-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("SCR downloads indexed remote and saves classic local name", async () => {
  await withTempDir(async (dir) => {
    const requested: string[] = [];
    const result = await downloadArtByGameId(
      dir,
      "SLUS_208.51",
      "PS2",
      undefined,
      ["SCR"],
      async (url, fileName) => {
        requested.push(fileName);
        if (fileName.endsWith("_SCR_00.png")) {
          return Buffer.from("scr-bytes");
        }
        throw new Error(`unexpected ${fileName} via ${url}`);
      }
    );

    assert.equal(result.success, true);
    assert.deepEqual(requested, ["SLUS_208.51_SCR_00.png"]);
    const saved = path.join(dir, "SLUS_208.51_SCR.png");
    assert.equal(await fs.readFile(saved, "utf8"), "scr-bytes");
    assert.equal(result.data[0].savedPath, saved);
  });
});

test("SCR falls back to classic remote when indexed 404s", async () => {
  await withTempDir(async (dir) => {
    const requested: string[] = [];
    const result = await downloadArtByGameId(
      dir,
      "SLUS_208.51",
      "PS2",
      undefined,
      ["SCR"],
      async (_url, fileName) => {
        requested.push(fileName);
        if (fileName.endsWith("_SCR_00.png")) {
          throw new Error(`Failed to download ${fileName}: 404`);
        }
        if (fileName.endsWith("_SCR.png")) {
          return Buffer.from("classic");
        }
        throw new Error(`unexpected ${fileName}`);
      }
    );

    assert.equal(result.success, true);
    assert.deepEqual(requested, [
      "SLUS_208.51_SCR_00.png",
      "SLUS_208.51_SCR.png",
    ]);
    assert.equal(
      await fs.readFile(path.join(dir, "SLUS_208.51_SCR.png"), "utf8"),
      "classic"
    );
  });
});

test("SCR_00 downloads and saves under the indexed local type", async () => {
  await withTempDir(async (dir) => {
    const requested: string[] = [];
    const result = await downloadArtByGameId(
      dir,
      "SLUS_208.51",
      "PS2",
      undefined,
      ["SCR_00"],
      async (_url, fileName) => {
        requested.push(fileName);
        return Buffer.from("indexed");
      }
    );

    assert.equal(result.success, true);
    assert.deepEqual(requested, ["SLUS_208.51_SCR_00.png"]);
    const saved = path.join(dir, "SLUS_208.51_SCR_00.png");
    assert.equal(await fs.readFile(saved, "utf8"), "indexed");
    assert.equal(result.data[0].savedPath, saved);
  });
});

test("BG tries indexed first and does not request classic when indexed succeeds", async () => {
  await withTempDir(async (dir) => {
    const requested: string[] = [];
    const result = await downloadArtByGameId(
      dir,
      "SLUS_204.86",
      "PS2",
      undefined,
      ["BG"],
      async (_url, fileName) => {
        requested.push(fileName);
        return Buffer.from("bg");
      }
    );

    assert.equal(result.success, true);
    assert.deepEqual(requested, ["SLUS_204.86_BG_00.png"]);
    assert.equal(
      await fs.readFile(path.join(dir, "SLUS_204.86_BG.png"), "utf8"),
      "bg"
    );
  });
});
