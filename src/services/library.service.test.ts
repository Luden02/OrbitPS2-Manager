import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { renameGamefile, moveFile } from "./library.service";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-rename-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// Regression: https://github.com/Luden02/OrbitPS2-Manager/issues/55 — under the
// "new" convention both regional releases reduce to "SSX 3.iso" and the second
// rename silently destroyed the first.
test("renaming onto an existing different file is refused, not overwritten", async () => {
  await withTempDir(async (dir) => {
    const ntsc = path.join(dir, "SSX 3 (NTSC).iso");
    const pal = path.join(dir, "SSX 3 (PAL).iso");
    await fs.writeFile(ntsc, "ntsc");
    await fs.writeFile(pal, "pal");

    const first = await renameGamefile(ntsc, "SLUS-20772", "SSX 3", true);
    assert.equal(first.success, true);

    const second = await renameGamefile(pal, "SLES-51634", "SSX 3", true);

    assert.equal(second.success, false);
    assert.match(String(second.message), /already exists/i);
    assert.equal(await fs.readFile(path.join(dir, "SSX 3.iso"), "utf8"), "ntsc");
    assert.equal(await fs.readFile(pal, "utf8"), "pal");
  });
});

test("renaming to a free name still works", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "SLUS-20772.SSX3.iso");
    await fs.writeFile(src, "ntsc");

    const result = await renameGamefile(src, "SLUS-20772", "SSX 3", true);

    assert.equal(result.success, true);
    assert.equal(result.newPath, path.join(dir, "SSX 3.iso"));
    assert.deepEqual(await fs.readdir(dir), ["SSX 3.iso"]);
  });
});

// On a case-insensitive volume (macOS, exFAT, NTFS) the target "exists"
// because it is the source — that must stay allowed.
test("a case-only rename is not treated as a collision", async () => {
  await withTempDir(async (dir) => {
    const src = path.join(dir, "ssx 3.iso");
    await fs.writeFile(src, "ntsc");

    const result = await renameGamefile(src, "SLUS-20772", "SSX 3", true);

    assert.equal(result.success, true);
    assert.equal(await fs.readFile(result.newPath!, "utf8"), "ntsc");
    assert.equal((await fs.readdir(dir)).length, 1);
  });
});

test("moving onto an existing file in the destination is refused", async () => {
  await withTempDir(async (dir) => {
    const destDir = path.join(dir, "DVD");
    await fs.mkdir(destDir);
    await fs.writeFile(path.join(destDir, "SSX 3.iso"), "existing");

    const incoming = path.join(dir, "SSX 3.iso");
    await fs.writeFile(incoming, "incoming");

    const result = await moveFile(incoming, destDir);

    assert.equal(result.success, false);
    assert.match(String(result.message), /already exists/i);
    assert.equal(await fs.readFile(path.join(destDir, "SSX 3.iso"), "utf8"), "existing");
    assert.equal(await fs.readFile(incoming, "utf8"), "incoming");
  });
});

test("moving into a destination with no conflict still works", async () => {
  await withTempDir(async (dir) => {
    const destDir = path.join(dir, "DVD");
    await fs.mkdir(destDir);
    const incoming = path.join(dir, "SSX 3.iso");
    await fs.writeFile(incoming, "incoming");

    const result = await moveFile(incoming, destDir);

    assert.equal(result.success, true);
    assert.equal(await fs.readFile(path.join(destDir, "SSX 3.iso"), "utf8"), "incoming");
  });
});
