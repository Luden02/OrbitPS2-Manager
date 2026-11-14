import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { importPs1Game, convertEmberGameToVcd, convertVcdGameToEmber } from "./ps1-import.service";

const SECTOR = 2352;

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-ember-import-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("Ember import merges a multi-track, multi-BIN dump into one game folder", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "src");
    const root = path.join(dir, "OPL");
    await fs.mkdir(src);
    await fs.writeFile(path.join(src, "Track 01.bin"), Buffer.alloc(SECTOR * 4, 1));
    await fs.writeFile(path.join(src, "Track 02.bin"), Buffer.alloc(SECTOR * 2, 2));
    const cuePath = path.join(src, "Demo.cue");
    await fs.writeFile(
      cuePath,
      [
        'FILE "Track 01.bin" BINARY',
        "  TRACK 01 MODE2/2352",
        "    INDEX 01 00:00:00",
        'FILE "Track 02.bin" BINARY',
        "  TRACK 02 AUDIO",
        "    INDEX 00 00:00:00",
        "    INDEX 01 00:00:01",
      ].join("\n")
    );

    const result = await importPs1Game(cuePath, root, "XX.", false, undefined, "Demo Game", "ember");
    assert.equal(result.success, true, result.message);

    const folder = path.join(root, "EMBER", "games", "Demo Game");
    assert.deepEqual((await fs.readdir(folder)).sort(), ["Demo.bin", "Demo.cue"]);
    assert.equal((await fs.stat(path.join(folder, "Demo.bin"))).size, SECTOR * 6);
    const cue = await fs.readFile(path.join(folder, "Demo.cue"), "utf-8");
    assert.equal(cue.match(/^FILE /gm)?.length, 1);
    assert.equal(cue.match(/TRACK /g)?.length, 2);
    assert.match(cue, /TRACK 02 AUDIO[\s\S]*INDEX 01 00:00:05/);
    assert.deepEqual(
      (await fs.readdir(path.join(root, "POPS"))).filter((f) => /\.vcd$/i.test(f)),
      []
    );

    // A second import under the same title must not touch the existing game.
    const again = await importPs1Game(cuePath, root, "XX.", false, undefined, "Demo Game", "ember");
    assert.equal(again.success, false);
    assert.match(again.message ?? "", /already exists/);
    assert.equal((await fs.stat(path.join(folder, "Demo.bin"))).size, SECTOR * 6);
  });
});

test("convertEmberGameToVcd converts the Ember folder to a VCD and migrates its art", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "src");
    const root = path.join(dir, "OPL");
    await fs.mkdir(src);
    await fs.writeFile(path.join(src, "Demo.bin"), Buffer.alloc(SECTOR * 4, 1));
    const cuePath = path.join(src, "Demo.cue");
    await fs.writeFile(
      cuePath,
      ['FILE "Demo.bin" BINARY', "  TRACK 01 MODE2/2352", "    INDEX 01 00:00:00"].join("\n")
    );

    const imported = await importPs1Game(cuePath, root, "XX.", false, undefined, "Demo Game", "ember");
    assert.equal(imported.success, true, imported.message);
    const emberFolder = path.join(root, "EMBER", "games", "Demo Game");

    const artDir = path.join(root, "ART");
    await fs.mkdir(artDir, { recursive: true });
    await fs.writeFile(path.join(artDir, "Demo Game_COV.png"), Buffer.from([1, 2, 3]));

    const result = await convertEmberGameToVcd(
      emberFolder,
      root,
      "TEST_001.01",
      "Renamed Game",
      "XX.",
      "popsloader"
    );
    assert.equal(result.success, true, result.message);
    assert.match(result.vcdPath ?? "", /Renamed Game\.VCD$/i);

    await assert.rejects(fs.access(emberFolder));
    assert.equal((await fs.readdir(path.join(root, "POPS"))).length, 1);
    assert.deepEqual(await fs.readdir(artDir), ["Renamed Game_COV.png"]);
  });
});

test("convertVcdGameToEmber converts a POPStarter VCD to Ember, removing its launcher and migrating art", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "src");
    const root = path.join(dir, "OPL");
    await fs.mkdir(src);
    await fs.writeFile(path.join(src, "Demo.bin"), Buffer.alloc(SECTOR * 4, 1));
    const cuePath = path.join(src, "Demo.cue");
    await fs.writeFile(
      cuePath,
      ['FILE "Demo.bin" BINARY', "  TRACK 01 MODE2/2352", "    INDEX 01 00:00:00"].join("\n")
    );

    const imported = await importPs1Game(cuePath, root, "XX.", false, "TEST_001.01", "Demo Game", "popstarter");
    assert.equal(imported.success, true, imported.message);
    assert.ok(imported.vcdPath);
    const launcherFolder = path.join(root, "APPS", "POPS_Demo Game");
    await assert.doesNotReject(fs.access(launcherFolder));

    const artDir = path.join(root, "ART");
    const vcdStem = path.basename(imported.vcdPath!, path.extname(imported.vcdPath!));
    await fs.writeFile(path.join(artDir, `${vcdStem}_COV.png`), Buffer.from([1, 2, 3]));

    const result = await convertVcdGameToEmber(
      imported.vcdPath!,
      root,
      "TEST_001.01",
      "Demo Game",
      launcherFolder
    );
    assert.equal(result.success, true, result.message);

    const emberFolder = path.join(root, "EMBER", "games", "Demo Game");
    assert.equal(result.emberFolder, emberFolder);
    assert.deepEqual((await fs.readdir(emberFolder)).sort(), ["Demo Game.bin", "Demo Game.cue"]);
    await assert.rejects(fs.access(imported.vcdPath!));
    await assert.rejects(fs.access(launcherFolder));
    assert.deepEqual(await fs.readdir(artDir), ["Demo Game_COV.png"]);
  });
});
