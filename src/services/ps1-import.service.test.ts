import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { importPs1Game } from "./ps1-import.service";

async function withOplRoot(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-ps1-import-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** A minimal single-track disc that identification will fail to resolve. */
async function writeDisc(dir: string, stem: string): Promise<string> {
  const cuePath = path.join(dir, `${stem}.cue`);
  await fs.writeFile(path.join(dir, `${stem}.bin`), "disc-data");
  await fs.writeFile(
    cuePath,
    `FILE "${stem}.bin" BINARY\r\n  TRACK 01 MODE2/2352\r\n    INDEX 01 00:00:00\r\n`,
    "utf-8",
  );
  return cuePath;
}

test("Ember import copies the BIN/CUE pair into EMBER/games/<title>", async () => {
  await withOplRoot(async (dir) => {
    const source = path.join(dir, "source");
    await fs.mkdir(source);
    const cuePath = await writeDisc(source, "Test Game");

    const result = await importPs1Game(
      cuePath,
      dir,
      "XX.",
      false,
      undefined,
      undefined,
      "ember",
    );

    assert.equal(result.success, true, result.message);
    const gameDir = path.join(dir, "EMBER", "games", "Test Game");
    assert.deepEqual((await fs.readdir(gameDir)).sort(), [
      "Test Game.bin",
      "Test Game.cue",
    ]);
    assert.equal(
      await fs.readFile(path.join(gameDir, "Test Game.bin"), "utf8"),
      "disc-data",
    );
    // No VCD and no launcher app are produced in Ember mode.
    assert.deepEqual(await fs.readdir(path.join(dir, "POPS")), []);
    await assert.rejects(fs.readdir(path.join(dir, "APPS")));
  });
});

test("Ember import refuses to write into an occupied game folder", async () => {
  await withOplRoot(async (dir) => {
    const source = path.join(dir, "source");
    await fs.mkdir(source);
    const cuePath = await writeDisc(source, "Test Game");

    const first = await importPs1Game(cuePath, dir, "XX.", false, undefined, undefined, "ember");
    assert.equal(first.success, true, first.message);

    const other = path.join(dir, "other");
    await fs.mkdir(other);
    const otherCue = await writeDisc(other, "Test Game");

    const second = await importPs1Game(otherCue, dir, "XX.", false, undefined, undefined, "ember");

    assert.equal(second.success, false);
    assert.match(String(second.message), /already exists/i);
    // The first import's data is untouched.
    assert.equal(
      await fs.readFile(
        path.join(dir, "EMBER", "games", "Test Game", "Test Game.bin"),
        "utf8",
      ),
      "disc-data",
    );
  });
});
