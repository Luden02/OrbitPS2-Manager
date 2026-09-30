import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { normalizeRiptOplPs1Storage } from "./rename.service";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-riptopl-rename-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("occupied canonical art stops normalization before storage is renamed", async () => {
  await withTempDir(async (dir) => {
    const popsDir = path.join(dir, "POPS");
    const artDir = path.join(dir, "ART");
    await fs.mkdir(popsDir, { recursive: true });
    await fs.mkdir(artDir, { recursive: true });

    const oldVcd = path.join(popsDir, "SPyro 4.VCD");
    await fs.writeFile(oldVcd, "vcd");
    await fs.writeFile(path.join(artDir, "SPyro 4_COV.png"), "old");
    await fs.writeFile(
      path.join(artDir, "SPYRO 2 - RIPTO'S RAGE_COV.png"),
      "canonical"
    );

    const result = await normalizeRiptOplPs1Storage({
      kind: "VCD",
      sourcePath: oldVcd,
      gameId: "SCUS_944.25",
      canonicalTitle: "SPYRO 2 - RIPTO'S RAGE",
      artDir,
    });

    assert.equal(result.success, false);
    assert.match(result.message ?? "", /already occupies the target slot/i);
    assert.equal(await fs.readFile(oldVcd, "utf8"), "vcd");
    assert.equal(
      await fs.readFile(path.join(artDir, "SPyro 4_COV.png"), "utf8"),
      "old"
    );
    assert.equal(
      await fs.readFile(
        path.join(artDir, "SPYRO 2 - RIPTO'S RAGE_COV.png"),
        "utf8"
      ),
      "canonical"
    );
  });
});

test("canonical storage still migrates GameID-keyed artwork", async () => {
  await withTempDir(async (dir) => {
    const popsDir = path.join(dir, "POPS");
    const artDir = path.join(dir, "ART");
    await fs.mkdir(popsDir, { recursive: true });
    await fs.mkdir(artDir, { recursive: true });

    const vcd = path.join(popsDir, "SPYRO 2 - RIPTO'S RAGE.VCD");
    await fs.writeFile(vcd, "vcd");
    await fs.writeFile(path.join(artDir, "SCUS_944.25_COV.png"), "cover");

    const result = await normalizeRiptOplPs1Storage({
      kind: "VCD",
      sourcePath: vcd,
      gameId: "SCUS_944.25",
      canonicalTitle: "SPYRO 2 - RIPTO'S RAGE",
      artDir,
    });

    assert.equal(result.success, true);
    assert.equal(result.changed, true);
    assert.equal(await fs.readFile(vcd, "utf8"), "vcd");
    assert.equal(
      await fs.readFile(
        path.join(artDir, "SPYRO 2 - RIPTO'S RAGE_COV.png"),
        "utf8"
      ),
      "cover"
    );
    await assert.rejects(() =>
      fs.access(path.join(artDir, "SCUS_944.25_COV.png"))
    );
  });
});

test("GameID artwork is skipped when storage-identity artwork owns the slot", async () => {
  await withTempDir(async (dir) => {
    const gamesDir = path.join(dir, "EMBER", "games");
    const artDir = path.join(dir, "ART");
    await fs.mkdir(gamesDir, { recursive: true });
    await fs.mkdir(artDir, { recursive: true });

    const gameFolder = path.join(gamesDir, "Spyro4");
    await fs.mkdir(gameFolder);
    await fs.writeFile(path.join(artDir, "Spyro4_COV.png"), "folder-art");
    await fs.writeFile(path.join(artDir, "SCUS_944.25_COV.jpg"), "id-art");

    const result = await normalizeRiptOplPs1Storage({
      kind: "EMBER",
      sourcePath: gameFolder,
      gameId: "SCUS_944.25",
      canonicalTitle: "SPYRO 2 - RIPTO'S RAGE",
      artDir,
    });

    assert.equal(result.success, true);
    await fs.access(path.join(gamesDir, "SPYRO 2 - RIPTO'S RAGE"));
    assert.equal(
      await fs.readFile(
        path.join(artDir, "SPYRO 2 - RIPTO'S RAGE_COV.png"),
        "utf8",
      ),
      "folder-art",
    );
    assert.equal(
      await fs.readFile(path.join(artDir, "SCUS_944.25_COV.jpg"), "utf8"),
      "id-art",
    );
  });
});


test("indexed artwork suffixes migrate with the full type intact", async () => {
  await withTempDir(async (dir) => {
    const gamesDir = path.join(dir, "EMBER", "games");
    const artDir = path.join(dir, "ART");
    await fs.mkdir(gamesDir, { recursive: true });
    await fs.mkdir(artDir, { recursive: true });

    const gameFolder = path.join(gamesDir, "Spyro4");
    await fs.mkdir(gameFolder);
    await fs.writeFile(path.join(artDir, "Spyro4_SCR_00.png"), "shot");
    await fs.writeFile(path.join(artDir, "Spyro4_BG_02.png"), "bg");

    const result = await normalizeRiptOplPs1Storage({
      kind: "EMBER",
      sourcePath: gameFolder,
      gameId: "SCUS_944.25",
      canonicalTitle: "SPYRO 2 - RIPTO'S RAGE",
      artDir,
    });

    assert.equal(result.success, true);
    assert.equal(
      await fs.readFile(
        path.join(artDir, "SPYRO 2 - RIPTO'S RAGE_SCR_00.png"),
        "utf8"
      ),
      "shot"
    );
    assert.equal(
      await fs.readFile(
        path.join(artDir, "SPYRO 2 - RIPTO'S RAGE_BG_02.png"),
        "utf8"
      ),
      "bg"
    );
  });
});

test("VMC target collision stops VCD normalization before any rename", async () => {
  await withTempDir(async (dir) => {
    const popsDir = path.join(dir, "POPS");
    const artDir = path.join(dir, "ART");
    await fs.mkdir(popsDir, { recursive: true });
    await fs.mkdir(artDir, { recursive: true });

    const oldVcd = path.join(popsDir, "Spyro4.VCD");
    await fs.writeFile(oldVcd, "vcd");
    await fs.mkdir(path.join(popsDir, "Spyro4"));
    await fs.mkdir(path.join(popsDir, "SPYRO 2 - RIPTO'S RAGE"));
    await fs.writeFile(path.join(artDir, "Spyro4_COV.png"), "cover");

    const result = await normalizeRiptOplPs1Storage({
      kind: "VCD",
      sourcePath: oldVcd,
      gameId: "SCUS_944.25",
      canonicalTitle: "SPYRO 2 - RIPTO'S RAGE",
      artDir,
    });

    assert.equal(result.success, false);
    assert.match(result.message ?? "", /VMC folder.*already exists/i);
    await fs.access(oldVcd);
    await fs.access(path.join(popsDir, "Spyro4"));
    await fs.access(path.join(artDir, "Spyro4_COV.png"));
  });
});

test("VMC folder follows a successful canonical VCD rename", async () => {
  await withTempDir(async (dir) => {
    const popsDir = path.join(dir, "POPS");
    const artDir = path.join(dir, "ART");
    await fs.mkdir(popsDir, { recursive: true });
    await fs.mkdir(artDir, { recursive: true });

    const oldVcd = path.join(popsDir, "Spyro4.VCD");
    await fs.writeFile(oldVcd, "vcd");
    await fs.mkdir(path.join(popsDir, "Spyro4"));

    const result = await normalizeRiptOplPs1Storage({
      kind: "VCD",
      sourcePath: oldVcd,
      gameId: "SCUS_944.25",
      canonicalTitle: "SPYRO 2 - RIPTO'S RAGE",
      artDir,
    });

    assert.equal(result.success, true);
    await fs.access(path.join(popsDir, "SPYRO 2 - RIPTO'S RAGE.VCD"));
    await fs.access(path.join(popsDir, "SPYRO 2 - RIPTO'S RAGE"));
    await assert.rejects(() => fs.access(path.join(popsDir, "Spyro4")));
  });
});


test("COV2 back cover and COV3 3D art each keep their own slot on rename", async () => {
  await withTempDir(async (dir) => {
    const popsDir = path.join(dir, "POPS");
    const artDir = path.join(dir, "ART");
    await fs.mkdir(popsDir, { recursive: true });
    await fs.mkdir(artDir, { recursive: true });

    const vcd = path.join(popsDir, "Spyro.VCD");
    await fs.writeFile(vcd, "vcd");
    await fs.writeFile(path.join(artDir, "Spyro_COV2.png"), "back");
    await fs.writeFile(path.join(artDir, "Spyro_COV3.png"), "3d");

    const result = await normalizeRiptOplPs1Storage({
      kind: "VCD",
      sourcePath: vcd,
      gameId: "SCUS_942.28",
      canonicalTitle: "SPYRO THE DRAGON",
      artDir,
    });

    assert.equal(result.success, true);
    assert.equal(
      await fs.readFile(path.join(artDir, "SPYRO THE DRAGON_COV2.png"), "utf8"),
      "back",
    );
    assert.equal(
      await fs.readFile(path.join(artDir, "SPYRO THE DRAGON_COV3.png"), "utf8"),
      "3d",
    );
    await assert.rejects(() => fs.access(path.join(artDir, "Spyro_COV2.png")));
    await assert.rejects(() => fs.access(path.join(artDir, "Spyro_COV3.png")));
  });
});


test("leftover GameID artwork does not block canonical artwork", async () => {
  await withTempDir(async (dir) => {
    const popsDir = path.join(dir, "POPS");
    const artDir = path.join(dir, "ART");
    await fs.mkdir(popsDir, { recursive: true });
    await fs.mkdir(artDir, { recursive: true });

    const vcd = path.join(popsDir, "SPYRO 2 - RIPTO'S RAGE.VCD");
    await fs.writeFile(vcd, "vcd");
    await fs.writeFile(
      path.join(artDir, "SPYRO 2 - RIPTO'S RAGE_COV.png"),
      "canonical",
    );
    await fs.writeFile(path.join(artDir, "SCUS_944.25_COV.png"), "legacy");

    const result = await normalizeRiptOplPs1Storage({
      kind: "VCD",
      sourcePath: vcd,
      gameId: "SCUS_944.25",
      canonicalTitle: "SPYRO 2 - RIPTO'S RAGE",
      artDir,
    });

    assert.equal(result.success, true);
    assert.equal(result.changed, false);
    assert.equal(
      await fs.readFile(
        path.join(artDir, "SPYRO 2 - RIPTO'S RAGE_COV.png"),
        "utf8",
      ),
      "canonical",
    );
    assert.equal(
      await fs.readFile(path.join(artDir, "SCUS_944.25_COV.png"), "utf8"),
      "legacy",
    );
  });
});
