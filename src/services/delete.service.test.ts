import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { deleteEmberGameAndRelatedFiles } from "./delete.service";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-ember-delete-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("Ember deletion removes the game folder and only matching folder-keyed art", async () => {
  await withTempDir(async (dir) => {
    const gamePath = path.join(dir, "EMBER", "games", "Spyro Custom");
    const artDir = path.join(dir, "ART");
    await fs.mkdir(gamePath, { recursive: true });
    await fs.mkdir(artDir, { recursive: true });
    await fs.writeFile(path.join(gamePath, "game.cue"), "cue");
    await fs.writeFile(path.join(artDir, "Spyro Custom_COV.png"), "match");
    await fs.writeFile(path.join(artDir, "SCUS_944.25_COV.png"), "other");

    const result = await deleteEmberGameAndRelatedFiles(
      gamePath,
      artDir,
      "Spyro Custom",
    );

    assert.equal(result.success, true);
    await assert.rejects(() => fs.access(gamePath));
    await assert.rejects(() =>
      fs.access(path.join(artDir, "Spyro Custom_COV.png")),
    );
    assert.equal(
      await fs.readFile(path.join(artDir, "SCUS_944.25_COV.png"), "utf8"),
      "other",
    );
  });
});

test("Ember deletion leaves artwork untouched when folder deletion fails", async () => {
  await withTempDir(async (dir) => {
    const gamePath = path.join(dir, "EMBER", "games", "Missing");
    const artDir = path.join(dir, "ART");
    await fs.mkdir(artDir, { recursive: true });
    await fs.writeFile(path.join(artDir, "Missing_COV.png"), "keep");

    const result = await deleteEmberGameAndRelatedFiles(
      gamePath,
      artDir,
      "Missing",
    );

    assert.equal(result.success, false);
    assert.equal(
      await fs.readFile(path.join(artDir, "Missing_COV.png"), "utf8"),
      "keep",
    );
  });
});
