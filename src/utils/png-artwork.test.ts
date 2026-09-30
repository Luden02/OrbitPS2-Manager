import assert from "node:assert/strict";
import { test } from "node:test";
import { readPngInfo, validateArtworkPng } from "./png-artwork";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function makePng(
  width: number,
  height: number,
  opts: { bitDepth?: number; colorType?: number; interlace?: number } = {},
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = opts.bitDepth ?? 8;
  ihdr[9] = opts.colorType ?? 3;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = opts.interlace ?? 0;

  const length = Buffer.alloc(4);
  length.writeUInt32BE(ihdr.length, 0);
  const crc = Buffer.alloc(4);

  return Buffer.concat([
    PNG_SIGNATURE,
    length,
    Buffer.from("IHDR", "ascii"),
    ihdr,
    crc,
  ]);
}

test("readPngInfo parses the IHDR fields", () => {
  assert.deepEqual(readPngInfo(makePng(400, 400)), {
    width: 400,
    height: 400,
    bitDepth: 8,
    colorType: 3,
    interlace: 0,
  });
});

test("a valid 8-bit indexed PS1 COV passes with no failures", () => {
  const result = validateArtworkPng(makePng(400, 400), "PS1", "COV");
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.expected, { width: 400, height: 400 });
});

test("a valid 8-bit indexed PS2 COV is 280x400", () => {
  const result = validateArtworkPng(makePng(280, 400), "PS2", "COV");
  assert.deepEqual(result.failures, []);
});

test("non-indexed color types are reported", () => {
  const png = makePng(400, 400, { bitDepth: 8, colorType: 6 });
  assert.match(validateArtworkPng(png, "PS1", "COV").failures.join("; "), /indexed/);
});

test("non-8-bit depths are reported", () => {
  const png = makePng(400, 400, { bitDepth: 16, colorType: 3 });
  assert.match(
    validateArtworkPng(png, "PS1", "COV").failures.join("; "),
    /8-bit indexed/,
  );
});

test("wrong dimensions are reported with the expected size", () => {
  const failures = validateArtworkPng(makePng(300, 300), "PS1", "COV")
    .failures.join("; ");
  assert.match(failures, /300x300/);
  assert.match(failures, /400x400/);
});

test("interlaced PNGs are reported", () => {
  const png = makePng(400, 400, { interlace: 1 });
  assert.match(
    validateArtworkPng(png, "PS1", "COV").failures.join("; "),
    /interlaced/,
  );
});

test("non-PNG bytes are reported as unreadable", () => {
  const failures = validateArtworkPng(
    Buffer.from("not a png"),
    "PS1",
    "COV",
  ).failures;
  assert.match(failures.join("; "), /not a PNG/);
});

test("unknown save types skip the dimension check", () => {
  const result = validateArtworkPng(makePng(123, 456), "PS2", "XYZ_01");
  assert.strictEqual(result.expected, undefined);
  assert.deepEqual(result.failures, []);
});