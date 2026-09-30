import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  tryDeterminePs1GameIdFromHex,
  tryDeterminePs1GameIdFromVcd,
} from "./game-id-resolver.service";
import { resolveKnownPs1ConflictDigest } from "../utils/ps1-disc-identity";

type Layout = "iso" | "mode2";
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

function buildPs1Image(
  layout: Layout,
  bootId: string,
  decoyId: string,
  pvdTimestamp?: string,
  systemCnfExtra = "",
): Buffer {
  const sectorSize = layout === "iso" ? BLOCK : 2352;
  const dataOffset = layout === "iso" ? 0 : 24;
  const image = Buffer.alloc(40 * sectorSize);
  const block = (lba: number) =>
    image.subarray(lba * sectorSize + dataOffset, lba * sectorSize + dataOffset + BLOCK);

  block(10).write(`MENU ${decoyId} DEMO`, "latin1");

  const rootLba = 18;
  const systemCnfLba = 22;
  const systemCnf =
    `BOOT = cdrom:\\${bootId};1\r\n` +
    systemCnfExtra +
    "TCB = 4\r\nEVENT = 10\r\n";

  const pvd = block(16);
  pvd[0] = 1;
  pvd.write("CD001", 1, "ascii");
  if (pvdTimestamp) pvd.write(pvdTimestamp, 0x32d, "ascii");
  directoryRecord(rootLba, BLOCK, "\0").copy(pvd, 156);

  const root = block(rootLba);
  let offset = 0;
  offset += directoryRecord(rootLba, BLOCK, "\0").copy(root, offset);
  offset += directoryRecord(rootLba, BLOCK, "\x01").copy(root, offset);
  directoryRecord(systemCnfLba, systemCnf.length, "SYSTEM.CNF;1").copy(root, offset);
  block(systemCnfLba).write(systemCnf, "latin1");
  return image;
}

async function withTempFile(
  name: string,
  contents: Buffer,
  run: (filePath: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-ps1-regression-"));
  try {
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, contents);
    await run(filePath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("unknown generic PSX.EXE cannot fall through to an unrelated raw serial", async () => {
  await withTempFile(
    "generic-unknown.bin",
    buildPs1Image("mode2", "PSX.EXE", "SCUS_941.63", "2000010100000000"),
    async (filePath) => {
      const result = await tryDeterminePs1GameIdFromHex(filePath);
      assert.equal(result.success, false);
      assert.equal(result.identificationStatus, "unidentified");
      assert.equal(result.gameId, undefined);
    },
  );
});

test("SYSTEM.CNF comments cannot override the generic-boot PVD identity", async () => {
  await withTempFile(
    "generic-comment.bin",
    buildPs1Image(
      "iso",
      "PSX.EXE",
      "SCUS_941.63",
      "1994111009000000",
      "# SCUS_941.63 belongs to another menu/demo\r\n",
    ),
    async (filePath) => {
      const result = await tryDeterminePs1GameIdFromHex(filePath);
      assert.equal(result.success, true);
      assert.equal(result.gameId, "SLPS_000.01");
      assert.equal(result.identificationMethod, "pvd");
      assert.equal(result.identificationStatus, "identified");
    },
  );
});

test("CUE INDEX 01 offset is respected for the PS1 data track", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-ps1-cue-offset-"));
  try {
    const binPath = path.join(dir, "shifted.bin");
    const cuePath = path.join(dir, "shifted.cue");
    const payload = buildPs1Image("mode2", "SLUS_000.67", "SCUS_941.63");
    await fs.writeFile(binPath, Buffer.concat([Buffer.alloc(150 * 2352), payload]));
    await fs.writeFile(
      cuePath,
      'FILE "shifted.bin" BINARY\n' +
        "  TRACK 01 MODE2/2352\n" +
        "    INDEX 00 00:00:00\n" +
        "    INDEX 01 00:02:00\n",
    );

    const result = await tryDeterminePs1GameIdFromHex(cuePath);
    assert.equal(result.success, true);
    assert.equal(result.gameId, "SLUS_000.67");
    assert.equal(result.identificationMethod, "boot");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("known shared PS1 serial remains ambiguous when checksum evidence is unknown", async () => {
  await withTempFile(
    "alive-synthetic.bin",
    buildPs1Image("mode2", "SLPS_015.27", "SCUS_941.63"),
    async (filePath) => {
      const result = await tryDeterminePs1GameIdFromHex(filePath);
      assert.equal(result.success, true);
      assert.equal(result.gameId, "SLPS_015.27");
      assert.equal(result.identificationStatus, "ambiguous");
      assert.equal(result.gameName, undefined);
    },
  );
});

test("PVD identification preserves Cyberwar's disc-specific title", async () => {
  await withTempFile(
    "cyberwar-disc2.bin",
    buildPs1Image("mode2", "PSX.EXE", "SCUS_941.63", "1995060319142200"),
    async (filePath) => {
      const result = await tryDeterminePs1GameIdFromHex(filePath);
      assert.equal(result.success, true);
      assert.equal(result.gameId, "SLPS_000.55");
      assert.equal(result.gameName, "CYBERWAR - DISC 2");
      assert.equal(result.identificationStatus, "identified");
      assert.equal(result.identificationMethod, "pvd");
    },
  );
});


test("verified shared-serial digest resolves to the disc-specific identity", () => {
  const match = resolveKnownPs1ConflictDigest(
    "SLPS_015.27",
    "4a1f0b0c83af1f0b86c148d7fcbbd683",
  );
  assert.ok(match);
  assert.equal(match.discId, "SLPS_015.28");
  assert.equal(match.title, "Alive (Disc 2)");
});

test("unknown digest never guesses a disc within a shared serial", () => {
  const match = resolveKnownPs1ConflictDigest(
    "SLPS_015.27",
    "00000000000000000000000000000000",
  );
  assert.equal(match, null);
});


test("shared PVD serial without a verified disc rule remains ambiguous", async () => {
  await withTempFile(
    "3x3-eyes-shared.bin",
    buildPs1Image("mode2", "PSX.EXE", "SCUS_941.63", "1995040719355400"),
    async (filePath) => {
      const result = await tryDeterminePs1GameIdFromHex(filePath);
      assert.equal(result.success, true);
      assert.equal(result.gameId, "SLPS_000.71");
      assert.equal(result.identificationStatus, "ambiguous");
      assert.equal(result.gameName, undefined);
    },
  );
});


test("VCD track 1 INDEX 01 offset is respected", async () => {
  const header = Buffer.alloc(1048576);
  header.write("kHn ", 1024, "ascii");
  header[17] = 0x01;
  header[30] = 0x41;
  header[32] = 0x01;
  // cue2pops stores track 1 INDEX 01 with +2 seconds. Original 00:02:00
  // therefore appears as 00:04:00 in the VCD header.
  header[37] = 0x00;
  header[38] = 0x04;
  header[39] = 0x00;

  const payload = Buffer.concat([
    Buffer.alloc(150 * 2352),
    buildPs1Image("mode2", "SLUS_000.67", "SCUS_941.63"),
  ]);

  await withTempFile(
    "shifted.vcd",
    Buffer.concat([header, payload]),
    async (filePath) => {
      const result = await tryDeterminePs1GameIdFromVcd(filePath);
      assert.equal(result.success, true);
      assert.equal(result.gameId, "SLUS_000.67");
      assert.equal(result.identificationMethod, "boot");
    },
  );
});
