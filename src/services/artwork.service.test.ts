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

test("wide fallback leaves a sibling slot empty when only a later variant exists", async () => {
  await withTempDir(async (dir) => {
    const requested: string[] = [];
    // `reserved` cannot help here: neither slot owns SCR_05, so SCR walks the
    // whole tail and claims it. SCR2 must not then save that same image a second
    // time — that would overwrite a real SCR2 with a copy of SCR.
    await downloadArtByGameId(
      dir,
      "SLUS_208.51",
      "PS2",
      undefined,
      ["SCR", "SCR2"],
      async (_url, fileName) => {
        requested.push(fileName);
        if (fileName.endsWith("_SCR_05.png")) return Buffer.from("shot-5");
        throw new Error(`Failed to download ${fileName}: 404`);
      },
      undefined,
      true
    );

    assert.equal(requested.includes("SLUS_208.51_SCR_05.png"), true);
    assert.equal(
      requested.filter((f) => f.endsWith("_SCR_05.png")).length,
      1,
      "SCR_05 belongs to whichever slot reached it first"
    );
    assert.equal(await fs.readFile(path.join(dir, "SLUS_208.51_SCR.png"), "utf8"), "shot-5");
    await assert.rejects(
      () => fs.readFile(path.join(dir, "SLUS_208.51_SCR2.png")),
      "SCR2 must stay missing rather than hold a copy of SCR"
    );
  });
});

test("one image is never written into two slots across a whole bulk call", async () => {
  await withTempDir(async (dir) => {
    const requested: string[] = [];
    const result = await downloadArtByGameId(
      dir,
      "SLUS_208.51",
      "PS2",
      undefined,
      ["COV", "SCR", "SCR2", "SCR3", "BG"],
      async (_url, fileName) => {
        requested.push(fileName);
        if (fileName.endsWith("_SCR_05.png")) return Buffer.from("shot-5");
        if (fileName.endsWith("_BG_03.png")) return Buffer.from("bg-3");
        if (fileName.endsWith("_COV.png")) return Buffer.from("cover");
        throw new Error(`Failed to download ${fileName}: 404`);
      },
      undefined,
      true
    );

    // Only a written file is a claim: a 404 is retried by the next slot, since
    // the failure may be a transient one rather than a missing database entry.
    assert.equal(
      requested.filter((f) => f.endsWith("_SCR_05.png")).length,
      1,
      "SCR_05 was saved by SCR and must not be fetched again for SCR2 or SCR3"
    );

    const saved = result.data.filter((r: any) => r.savedPath);
    const sources = saved.map((r: any) => r.source);
    assert.equal(
      new Set(sources).size,
      sources.length,
      `one image saved into two slots: ${sources.join(", ")}`
    );
    // The single screenshot fills the first slot; the other two stay missing
    // instead of each saving their own copy of it.
    assert.deepEqual(saved.map((r: any) => r.type).sort(), ["BG", "COV", "SCR"]);
    await assert.rejects(() => fs.readFile(path.join(dir, "SLUS_208.51_SCR2.png")));
    await assert.rejects(() => fs.readFile(path.join(dir, "SLUS_208.51_SCR3.png")));
  });
});

test("a slot with no unique candidate left is reported as missing", async () => {
  await withTempDir(async (dir) => {
    // The same code twice: the second pass has nothing left to try and must
    // report the miss rather than write a second copy.
    const result = await downloadArtByGameId(
      dir,
      "SLUS_208.51",
      "PS2",
      undefined,
      ["SCR_05", "SCR_05"],
      async (_url, fileName) => Buffer.from("shot-5"),
      undefined,
      true
    );

    assert.equal(result.success, true);
    assert.equal(result.data[0].savedPath, path.join(dir, "SLUS_208.51_SCR_05.png"));
    assert.equal(result.data[1].savedPath, undefined);
    assert.match(result.data[1].error, /No unique SCR_05 artwork left/);
  });
});

test("slots with distinct images still both fill", async () => {
  await withTempDir(async (dir) => {
    await downloadArtByGameId(
      dir,
      "SLUS_208.51",
      "PS2",
      undefined,
      ["SCR", "SCR2"],
      async (_url, fileName) => {
        if (fileName.endsWith("_SCR_00.png")) return Buffer.from("shot-0");
        if (fileName.endsWith("_SCR_01.png")) return Buffer.from("shot-1");
        throw new Error(`Failed to download ${fileName}: 404`);
      },
      undefined,
      true
    );

    assert.equal(await fs.readFile(path.join(dir, "SLUS_208.51_SCR.png"), "utf8"), "shot-0");
    assert.equal(await fs.readFile(path.join(dir, "SLUS_208.51_SCR2.png"), "utf8"), "shot-1");
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

test("a local write failure ends that type instead of re-fetching", async () => {
  await withTempDir(async (dir) => {
    // A directory sitting where the file must go: the download succeeds, the
    // write cannot. The bytes are already in hand, so walking the remaining
    // candidates would only re-fetch this same image once per URL left.
    const artDir = path.join(dir, "ART");
    await fs.mkdir(path.join(artDir, "SLUS_208.51_SCR.png"), { recursive: true });
    const requested: string[] = [];

    const result = await downloadArtByGameId(
      artDir,
      "SLUS_208.51",
      "PS2",
      undefined,
      ["SCR"],
      async (_url, fileName) => {
        requested.push(fileName);
        if (fileName.endsWith("_SCR_00.png")) return Buffer.from("shot");
        throw new Error(`Failed to download ${fileName}: 404`);
      },
      undefined,
      true
    );

    assert.deepEqual(requested, ["SLUS_208.51_SCR_00.png"]);
    assert.equal(result.success, false);
    assert.equal(result.data[0].savedPath, undefined);
    assert.match(result.data[0].error, /Failed to save SCR artwork/);
  });
});

test("a write failure on one type does not abandon the rest", async () => {
  await withTempDir(async (dir) => {
    const artDir = path.join(dir, "ART");
    await fs.mkdir(path.join(artDir, "SLUS_208.51_SCR.png"), { recursive: true });

    const result = await downloadArtByGameId(
      artDir,
      "SLUS_208.51",
      "PS2",
      undefined,
      ["SCR", "COV"],
      async (_url, fileName) => {
        if (fileName.endsWith("_SCR_00.png")) return Buffer.from("shot");
        if (fileName.endsWith("_COV.png")) return Buffer.from("cover");
        throw new Error(`Failed to download ${fileName}: 404`);
      }
    );

    assert.equal(result.success, true);
    assert.equal(
      await fs.readFile(path.join(artDir, "SLUS_208.51_COV.png"), "utf8"),
      "cover"
    );
    assert.equal(result.data.length, 2);
    assert.match(result.data[0].error, /Failed to save SCR artwork/);
  });
});

test("creates the artwork folder when it does not exist yet", async () => {
  await withTempDir(async (dir) => {
    const artDir = path.join(dir, "ART");

    const result = await downloadArtByGameId(
      artDir,
      "SLUS_208.51",
      "PS2",
      undefined,
      ["COV"],
      async () => Buffer.from("cover")
    );

    assert.equal(result.success, true);
    assert.equal(
      await fs.readFile(path.join(artDir, "SLUS_208.51_COV.png"), "utf8"),
      "cover"
    );
  });
});

test("reports a folder it cannot create instead of downloading into nothing", async () => {
  await withTempDir(async (dir) => {
    // A plain file where the folder should be: nothing can be written into it.
    const blocked = path.join(dir, "ART");
    await fs.writeFile(blocked, "not a folder");
    const requested: string[] = [];

    const result = await downloadArtByGameId(
      blocked,
      "SLUS_208.51",
      "PS2",
      undefined,
      ["COV", "SCR"],
      async (_url, fileName) => {
        requested.push(fileName);
        return Buffer.from("bytes");
      }
    );

    assert.equal(result.success, false);
    assert.match(result.message ?? "", /Could not create artwork folder/);
    assert.deepEqual(requested, [], "nothing may be fetched when nothing can be written");
    assert.equal(result.data.length, 2);
    for (const entry of result.data) {
      assert.match(entry.error, /Could not create artwork folder/);
    }
  });
});
