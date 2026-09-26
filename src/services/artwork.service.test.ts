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

test("without the wide fallback a missing slot never reaches the other indexed variants", async () => {
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
        throw new Error(`Failed to download ${fileName}: 404`);
      }
    );

    assert.equal(result.success, false);
    assert.deepEqual(requested, [
      "SLUS_208.51_SCR_00.png",
      "SLUS_208.51_SCR.png",
    ]);
  });
});

test("wide fallback keeps the classic name ahead of the other indexed variants", async () => {
  await withTempDir(async (dir) => {
    const requested: string[] = [];
    // SCR_00 is missing but the classic file is not: the classic hit must win
    // over the extra indexed variants the wide fallback appends behind it.
    await downloadArtByGameId(
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
        if (fileName.endsWith("_SCR.png")) return Buffer.from("classic");
        if (fileName.endsWith("_SCR_01.png")) return Buffer.from("shot-1");
        throw new Error(`Failed to download ${fileName}: 404`);
      },
      undefined,
      true
    );

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

test("wide fallback fills a slot from a non-zero indexed screenshot", async () => {
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
        if (fileName.endsWith("_SCR_05.png")) return Buffer.from("shot-5");
        throw new Error(`Failed to download ${fileName}: 404`);
      },
      undefined,
      true
    );

    assert.equal(result.success, true);
    // SCR_00 first, classic second, then the remaining indexed variants.
    assert.deepEqual(requested, [
      "SLUS_208.51_SCR_00.png",
      "SLUS_208.51_SCR.png",
      "SLUS_208.51_SCR_01.png",
      "SLUS_208.51_SCR_02.png",
      "SLUS_208.51_SCR_03.png",
      "SLUS_208.51_SCR_04.png",
      "SLUS_208.51_SCR_05.png",
    ]);
    const saved = path.join(dir, "SLUS_208.51_SCR.png");
    assert.equal(await fs.readFile(saved, "utf8"), "shot-5");
    assert.equal(result.data[0].savedPath, saved);
    assert.equal(result.data[0].source, "SCR_05");
  });
});

test("wide fallback never reuses a sibling slot's indexed screenshot", async () => {
  await withTempDir(async (dir) => {
    const requested: string[] = [];
    // Only SCR_00 exists: SCR2 must stay empty rather than duplicate the shot
    // that SCR already saved.
    await downloadArtByGameId(
      dir,
      "SLUS_208.51",
      "PS2",
      undefined,
      ["SCR", "SCR2"],
      async (_url, fileName) => {
        requested.push(fileName);
        if (fileName.endsWith("_SCR_00.png")) return Buffer.from("only-shot");
        throw new Error(`Failed to download ${fileName}: 404`);
      },
      undefined,
      true
    );

    assert.equal(requested.includes("SLUS_208.51_SCR_00.png"), true);
    assert.equal(
      requested.filter((f) => f.endsWith("_SCR_00.png")).length,
      1,
      "SCR_00 belongs to SCR and must not be probed for SCR2"
    );
    assert.equal(await fs.readFile(path.join(dir, "SLUS_208.51_SCR.png"), "utf8"), "only-shot");
    await assert.rejects(() => fs.readFile(path.join(dir, "SLUS_208.51_SCR2.png")));
  });
});

test("wide fallback fills BG from a later indexed background", async () => {
  await withTempDir(async (dir) => {
    const requested: string[] = [];
    await downloadArtByGameId(
      dir,
      "SLUS_204.86",
      "PS2",
      undefined,
      ["BG"],
      async (_url, fileName) => {
        requested.push(fileName);
        if (fileName.endsWith("_BG_02.png")) return Buffer.from("bg-2");
        throw new Error(`Failed to download ${fileName}: 404`);
      },
      undefined,
      true
    );

    assert.deepEqual(requested, [
      "SLUS_204.86_BG_00.png",
      "SLUS_204.86_BG.png",
      "SLUS_204.86_BG_01.png",
      "SLUS_204.86_BG_02.png",
    ]);
    assert.equal(
      await fs.readFile(path.join(dir, "SLUS_204.86_BG.png"), "utf8"),
      "bg-2"
    );
  });
});

test("saveAsByType only renames the local file, not the request", async () => {
  await withTempDir(async (dir) => {
    const requested: string[] = [];
    const result = await downloadArtByGameId(
      dir,
      "SLUS_208.51",
      "PS2",
      undefined,
      ["SCR_05", "BG_02"],
      async (_url, fileName) => {
        requested.push(fileName);
        return Buffer.from(fileName);
      },
      { SCR_05: "SCR", BG_02: "BG" }
    );

    assert.equal(result.success, true);
    assert.deepEqual(requested, [
      "SLUS_208.51_SCR_05.png",
      "SLUS_208.51_BG_02.png",
    ]);
    assert.equal(
      await fs.readFile(path.join(dir, "SLUS_208.51_SCR.png"), "utf8"),
      "SLUS_208.51_SCR_05.png"
    );
    assert.equal(
      await fs.readFile(path.join(dir, "SLUS_208.51_BG.png"), "utf8"),
      "SLUS_208.51_BG_02.png"
    );
  });
});

test("a type missing from saveAsByType is still saved under its own code", async () => {
  await withTempDir(async (dir) => {
    const result = await downloadArtByGameId(
      dir,
      "SLUS_208.51",
      "PS2",
      undefined,
      ["SCR_00", "SCR_05"],
      async (_url, fileName) => Buffer.from(fileName),
      { SCR_00: "SCR" }
    );

    assert.equal(result.success, true);
    assert.equal(
      await fs.readFile(path.join(dir, "SLUS_208.51_SCR.png"), "utf8"),
      "SLUS_208.51_SCR_00.png"
    );
    assert.equal(
      await fs.readFile(path.join(dir, "SLUS_208.51_SCR_05.png"), "utf8"),
      "SLUS_208.51_SCR_05.png"
    );
  });
});

test("saveAsName still drives the local stem of an overridden type", async () => {
  await withTempDir(async (dir) => {
    await downloadArtByGameId(
      dir,
      "SLUS_208.51",
      "PS2",
      "XX.SLUS_208.51.Game.ELF",
      ["SCR_05"],
      async (_url, fileName) => Buffer.from("shot"),
      { SCR_05: "SCR" }
    );

    assert.equal(
      await fs.readFile(
        path.join(dir, "XX.SLUS_208.51.Game.ELF_SCR.png"),
        "utf8"
      ),
      "shot"
    );
  });
});
