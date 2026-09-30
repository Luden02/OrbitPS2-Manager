import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  PS1_DIGEST_CACHE_VERSION,
  getCachedPs1Digests,
  setCachedPs1Digests,
  setPersistentCacheDirectory,
} from "./iso-cache.service";
import {
  clearPs1DigestMemoryCache,
  matchPs1Conflict,
} from "../utils/ps1-disc-identity";

async function withCacheDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-cache-"));
  setPersistentCacheDirectory(dir);
  clearPs1DigestMemoryCache();
  try {
    await run(dir);
  } finally {
    setPersistentCacheDirectory(undefined);
    clearPs1DigestMemoryCache();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("PS1 digests round-trip and miss when the file changes", async () => {
  await withCacheDir(async () => {
    setCachedPs1Digests("/games/a.VCD", 100, 5000, ["aa", "bb"]);

    assert.deepEqual(getCachedPs1Digests("/games/a.VCD", 100, 5000), ["aa", "bb"]);
    assert.equal(getCachedPs1Digests("/games/a.VCD", 101, 5000), undefined);
    assert.equal(getCachedPs1Digests("/games/a.VCD", 100, 9000), undefined);
    assert.equal(getCachedPs1Digests("/games/b.VCD", 100, 5000), undefined);
  });
});

test("PS1 digests from an older hashing scheme are ignored", async () => {
  await withCacheDir(async (dir) => {
    await fs.writeFile(
      path.join(dir, "ps1-digest-cache.json"),
      JSON.stringify({
        "/games/a.VCD": {
          version: PS1_DIGEST_CACHE_VERSION - 1,
          digests: ["aa"],
          size: 100,
          mtimeMs: 5000,
        },
      }),
    );

    assert.equal(getCachedPs1Digests("/games/a.VCD", 100, 5000), undefined);
  });
});

test("conflict resolution reuses persisted digests instead of rehashing", async () => {
  await withCacheDir(async (dir) => {
    const disc = path.join(dir, "Alive Disc 2.VCD");
    await fs.writeFile(disc, "not the real disc");
    const stat = await fs.stat(disc);

    // Plant the verified GDX-X digest for Alive (Disc 2). The file's real
    // content hashes to something else, so a match proves the persisted
    // entry was used rather than a fresh hash.
    setCachedPs1Digests(path.resolve(disc), stat.size, stat.mtimeMs, [
      "4a1f0b0c83af1f0b86c148d7fcbbd683",
    ]);

    const match = await matchPs1Conflict(disc, "SLPS_015.27");

    assert.equal(match?.title, "Alive (Disc 2)");
    assert.equal(match?.discId, "SLPS_015.28");
  });
});

test("freshly hashed PS1 conflict digests are persisted", async () => {
  await withCacheDir(async (dir) => {
    const disc = path.join(dir, "Unknown.VCD");
    await fs.writeFile(disc, "some other disc");
    const stat = await fs.stat(disc);

    assert.equal(await matchPs1Conflict(disc, "SLPS_015.27"), null);

    const digests = getCachedPs1Digests(path.resolve(disc), stat.size, stat.mtimeMs);
    assert.ok(digests && digests.length > 0);
  });
});
