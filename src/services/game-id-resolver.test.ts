import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  tryDeterminePs1GameIdFromHex,
  tryDeterminePs1GameIdFromVcd,
} from "./game-id-resolver.service";
import { VCD_HEADER_SIZE } from "../utils/game-id-patterns";

type Layout = "iso" | "mode1" | "mode2";

const BLOCK = 2048;

function directoryRecord(lba: number, size: number, name: string): Buffer {
  const nameBytes = Buffer.from(name, "latin1");
  const length = 33 + nameBytes.length + (nameBytes.length % 2 === 0 ? 1 : 0);
  const record = Buffer.alloc(length);
  record[0] = length;
  record.writeUInt32LE(lba, 2);
  record.writeUInt32BE(lba, 6);
  record.writeUInt32LE(size, 10);
  record.writeUInt32BE(size, 14);
  record[25] = name === "\0" || name === "\x01" ? 2 : 0;
  record[32] = nameBytes.length;
  nameBytes.copy(record, 33);
  return record;
}

/**
 * Build a minimal ISO9660 PS1 image whose SYSTEM.CNF boots `bootId`, with a
 * decoy serial placed earlier on the disc so a raw hex scan would pick it up
 * first. `padRootDirectory` pushes SYSTEM.CNF into the root directory's second
 * logical block to exercise multi-sector directory reads.
 */
function buildPs1Image(
  layout: Layout,
  bootId: string,
  decoyId: string,
  padRootDirectory = false,
  pvdTimestamp?: string
): Buffer {
  const sectorSize = layout === "iso" ? BLOCK : 2352;
  const dataOffset = layout === "iso" ? 0 : layout === "mode1" ? 16 : 24;
  const sectors = 40;
  const image = Buffer.alloc(sectors * sectorSize);
  const block = (lba: number) =>
    image.subarray(lba * sectorSize + dataOffset, lba * sectorSize + dataOffset + BLOCK);

  if (layout === "mode2") {
    // Fill in plausible sync/header/subheader bytes so offset mistakes land on
    // non-zero, non-PVD data.
    for (let lba = 0; lba < sectors; lba++) {
      const start = lba * sectorSize;
      image.fill(0xff, start + 1, start + 11);
      image[start + 15] = 2;
      image[start + 18] = 0x08;
      image[start + 22] = 0x08;
    }
  }

  block(10).write(`MENU ${decoyId} DEMO`, "latin1");

  const rootLba = 18;
  const rootLen = padRootDirectory ? 2 * BLOCK : BLOCK;
  const systemCnfLba = 22;
  const systemCnf = `BOOT = cdrom:\\${bootId};1\r\nTCB = 4\r\nEVENT = 10\r\n`;

  const pvd = block(16);
  pvd[0] = 1;
  pvd.write("CD001", 1, "ascii");
  if (pvdTimestamp) {
    if (!/^\d{16}$/.test(pvdTimestamp)) {
      throw new Error("PVD timestamp must be exactly 16 ASCII digits.");
    }
    pvd.write(pvdTimestamp, 0x32d, "ascii");
  }
  directoryRecord(rootLba, rootLen, "\0").copy(pvd, 156);

  let offset = 0;
  const root = block(rootLba);
  offset += directoryRecord(rootLba, rootLen, "\0").copy(root, offset);
  offset += directoryRecord(rootLba, rootLen, "\x01").copy(root, offset);
  const cnfRecord = directoryRecord(systemCnfLba, systemCnf.length, "SYSTEM.CNF;1");
  if (padRootDirectory) {
    // Rest of the first block is zero padding; the record lives in block 2.
    cnfRecord.copy(block(rootLba + 1), 0);
  } else {
    cnfRecord.copy(root, offset);
  }

  block(systemCnfLba).write(systemCnf, "latin1");
  return image;
}

async function withTempFile(
  name: string,
  contents: Buffer,
  run: (filePath: string) => Promise<void>
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-ps1-id-"));
  try {
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, contents);
    await run(filePath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

for (const layout of ["iso", "mode1", "mode2"] as const) {
  test(`SYSTEM.CNF wins over earlier decoy serials (${layout} BIN)`, async () => {
    await withTempFile(
      "game.bin",
      buildPs1Image(layout, "SLUS_000.67", "SCUS_941.63"),
      async (filePath) => {
        const result = await tryDeterminePs1GameIdFromHex(filePath);
        assert.equal(result.success, true);
        assert.equal("gameId" in result && result.gameId, "SLUS_000.67");
      }
    );
  });
}

test("SYSTEM.CNF is read from a MODE2 POPS VCD payload", async () => {
  const payload = buildPs1Image("mode2", "SLUS_000.67", "SCUS_941.63");
  const vcd = Buffer.concat([Buffer.alloc(VCD_HEADER_SIZE), payload]);
  await withTempFile("game.VCD", vcd, async (filePath) => {
    const result = await tryDeterminePs1GameIdFromVcd(filePath);
    assert.equal(result.success, true);
    assert.equal(result.gameId, "SLUS_000.67");
  });
});

test("SYSTEM.CNF in a multi-block MODE2 root directory is found", async () => {
  await withTempFile(
    "game.bin",
    buildPs1Image("mode2", "SLUS_000.67", "SCUS_941.63", true),
    async (filePath) => {
      const result = await tryDeterminePs1GameIdFromHex(filePath);
      assert.equal(result.success, true);
      assert.equal("gameId" in result && result.gameId, "SLUS_000.67");
    }
  );
});


test("generic PSX.EXE uses the PVD timestamp before a decoy serial", async () => {
  await withTempFile(
    "generic.bin",
    buildPs1Image(
      "iso",
      "PSX.EXE",
      "SCUS_941.63",
      false,
      "1994111009000000",
    ),
    async (filePath) => {
      const result = await tryDeterminePs1GameIdFromHex(filePath);
      assert.equal(result.success, true);
      assert.equal("gameId" in result && result.gameId, "SLPS_000.01");
    },
  );
});

test("generic PSX.EXE PVD timestamp is read through the POPS VCD header", async () => {
  const payload = buildPs1Image(
    "mode2",
    "PSX.EXE",
    "SCUS_941.63",
    false,
    "1994111009000000",
  );
  const vcd = Buffer.concat([Buffer.alloc(VCD_HEADER_SIZE), payload]);
  await withTempFile("generic.VCD", vcd, async (filePath) => {
    const result = await tryDeterminePs1GameIdFromVcd(filePath);
    assert.equal(result.success, true);
    assert.equal(result.gameId, "SLPS_000.01");
  });
});
