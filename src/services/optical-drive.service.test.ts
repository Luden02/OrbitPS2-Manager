import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { deleteTempRipFile, TEMP_RIP_PREFIX } from "./optical-drive.service";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-temp-rip-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("deleting a temp cue removes its referenced bin tracks", async () => {
  await withTempDir(async (dir) => {
    const cuePath = path.join(dir, `${TEMP_RIP_PREFIX}1 (Track 1).cue`);
    await fs.writeFile(path.join(dir, `${TEMP_RIP_PREFIX}1 (Track 1).bin`), "t1");
    await fs.writeFile(path.join(dir, `${TEMP_RIP_PREFIX}1 (Track 2).bin`), "t2");
    await fs.writeFile(
      cuePath,
      `FILE "${TEMP_RIP_PREFIX}1 (Track 1).bin" BINARY\nFILE "${TEMP_RIP_PREFIX}1 (Track 2).bin" BINARY\n`,
    );

    const result = await deleteTempRipFile(cuePath);

    assert.equal(result.success, true);
    assert.deepEqual(await fs.readdir(dir), []);
  });
});

test("a cue FILE entry cannot delete anything outside the rip directory", async () => {
  await withTempDir(async (dir) => {
    const ripDir = path.join(dir, "rip");
    await fs.mkdir(ripDir);
    const outsider = path.join(dir, "important.bin");
    await fs.writeFile(outsider, "keep me");

    const cuePath = path.join(ripDir, `${TEMP_RIP_PREFIX}1.cue`);
    await fs.writeFile(cuePath, 'FILE "../important.bin" BINARY\n');

    const result = await deleteTempRipFile(cuePath);

    assert.equal(result.success, true);
    assert.equal(await fs.readFile(outsider, "utf8"), "keep me");
  });
});

test("a path outside our temp naming convention is refused", async () => {
  await withTempDir(async (dir) => {
    const victim = path.join(dir, "game.iso");
    await fs.writeFile(victim, "keep me");

    const result = await deleteTempRipFile(victim);

    assert.equal(result.success, false);
    assert.equal(await fs.readFile(victim, "utf8"), "keep me");
  });
});
