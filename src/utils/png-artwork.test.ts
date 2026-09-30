import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "zlib";
import {
  normalizeArtworkPng,
  readPngInfo,
} from "./png-artwork";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([len, typeBuffer, data, crc]);
}

function indexedPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;

  const palette = Buffer.from([
    0, 0, 0,
    255, 255, 255,
  ]);

  const raw = Buffer.alloc(height * (width + 1));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < width; x++) {
      raw[offset++] = (x + y) % 2;
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("PLTE", palette),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("PS1 COV is resized to 400x400 while staying indexed 8-bit", () => {
  const output = normalizeArtworkPng(indexedPng(200, 200), "PS1", "COV");
  assert.deepEqual(readPngInfo(output), {
    width: 400,
    height: 400,
    bitDepth: 8,
    colorType: 3,
    interlace: 0,
  });
});

test("PS2 COV is resized to 280x400", () => {
  const output = normalizeArtworkPng(indexedPng(140, 200), "PS2", "COV");
  const info = readPngInfo(output);
  assert.equal(info.width, 280);
  assert.equal(info.height, 400);
});

test("ICO is resized to 128x128", () => {
  const output = normalizeArtworkPng(indexedPng(64, 64), "PS1", "ICO");
  const info = readPngInfo(output);
  assert.equal(info.width, 128);
  assert.equal(info.height, 128);
});

test("already-correct non-doubled artwork is left at the required dimensions", () => {
  const input = indexedPng(250, 188);
  const output = normalizeArtworkPng(input, "PS1", "SCR");
  assert.equal(output, input);
});

test("non-indexed source is rejected instead of writing incompatible art", () => {
  const input = Buffer.from(indexedPng(64, 64));
  // IHDR color type byte. CRC is intentionally now stale; metadata parsing
  // happens before any rewrite and still demonstrates the compatibility gate.
  input[25] = 6;
  assert.throws(
    () => normalizeArtworkPng(input, "PS1", "ICO"),
    /8-bit indexed PNG/,
  );
});


test("COV2 back cover keeps the database back-cover dimensions", () => {
  const input = indexedPng(222, 200);
  const output = normalizeArtworkPng(input, "PS1", "COV2");
  assert.equal(output, input);
});
