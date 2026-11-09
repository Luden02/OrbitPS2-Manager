import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { importPs1Game } from "./ps1-import.service";

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
