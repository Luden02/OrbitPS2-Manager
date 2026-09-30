import { deflateSync, inflateSync } from "zlib";

export type ArtworkSystem = "PS1" | "PS2";

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

interface PngChunk {
  type: string;
  data: Buffer;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const EXPECTED_DIMENSIONS: Record<
  ArtworkSystem,
  Record<string, { width: number; height: number }>
> = {
  PS1: {
    COV: { width: 400, height: 400 },
    ICO: { width: 128, height: 128 },
    SCR: { width: 250, height: 188 },
    SCR2: { width: 250, height: 188 },
    BG: { width: 640, height: 480 },
    LGO: { width: 300, height: 125 },
    LAB: { width: 12, height: 200 },
    COV2: { width: 222, height: 200 },
  },
  PS2: {
    COV: { width: 280, height: 400 },
    ICO: { width: 128, height: 128 },
    SCR: { width: 250, height: 188 },
    SCR2: { width: 250, height: 188 },
    BG: { width: 640, height: 480 },
    LGO: { width: 300, height: 125 },
    LAB: { width: 18, height: 240 },
    COV2: { width: 242, height: 344 },
  },
};

function crc32Buffer(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(
    crc32Buffer(Buffer.concat([typeBuffer, data])),
    0,
  );

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function parsePng(buffer: Buffer): {
  info: PngInfo;
  chunks: PngChunk[];
} {
  if (
    buffer.length < PNG_SIGNATURE.length ||
    !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw new Error("Artwork source is not a PNG file.");
  }

  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.length;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const next = dataEnd + 4;

    if (next > buffer.length) {
      throw new Error("Artwork PNG is truncated.");
    }

    chunks.push({
      type,
      data: Buffer.from(buffer.subarray(dataStart, dataEnd)),
    });
    offset = next;

    if (type === "IEND") break;
  }

  const ihdr = chunks.find((chunk) => chunk.type === "IHDR");
  if (!ihdr || ihdr.data.length !== 13) {
    throw new Error("Artwork PNG has no valid IHDR chunk.");
  }

  return {
    info: {
      width: ihdr.data.readUInt32BE(0),
      height: ihdr.data.readUInt32BE(4),
      bitDepth: ihdr.data[8],
      colorType: ihdr.data[9],
      interlace: ihdr.data[12],
    },
    chunks,
  };
}

export function readPngInfo(buffer: Buffer): PngInfo {
  return parsePng(buffer).info;
}

function channelsForColorType(colorType: number): number {
  switch (colorType) {
    case 0:
    case 3:
      return 1;
    case 2:
      return 3;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      throw new Error(`Unsupported PNG color type ${colorType}.`);
  }
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterRows(
  raw: Buffer,
  width: number,
  height: number,
  bytesPerPixel: number,
): Buffer[] {
  const rowBytes = width * bytesPerPixel;
  const expected = height * (rowBytes + 1);
  if (raw.length !== expected) {
    throw new Error(
      `Unexpected PNG scanline size: expected ${expected}, got ${raw.length}.`,
    );
  }

  const rows: Buffer[] = [];
  let offset = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[offset++];
    const encoded = raw.subarray(offset, offset + rowBytes);
    offset += rowBytes;

    const row = Buffer.alloc(rowBytes);
    const previous = y > 0 ? rows[y - 1] : undefined;

    for (let x = 0; x < rowBytes; x++) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = previous ? previous[x] : 0;
      const upLeft =
        previous && x >= bytesPerPixel
          ? previous[x - bytesPerPixel]
          : 0;

      let predictor = 0;
      switch (filter) {
        case 0:
          predictor = 0;
          break;
        case 1:
          predictor = left;
          break;
        case 2:
          predictor = up;
          break;
        case 3:
          predictor = Math.floor((left + up) / 2);
          break;
        case 4:
          predictor = paethPredictor(left, up, upLeft);
          break;
        default:
          throw new Error(`Unsupported PNG filter type ${filter}.`);
      }

      row[x] = (encoded[x] + predictor) & 0xff;
    }

    rows.push(row);
  }

  return rows;
}

function resizeRowsNearest(
  rows: Buffer[],
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  bytesPerPixel: number,
): Buffer {
  const targetRowBytes = targetWidth * bytesPerPixel;
  const raw = Buffer.alloc(targetHeight * (targetRowBytes + 1));

  let out = 0;
  for (let y = 0; y < targetHeight; y++) {
    raw[out++] = 0;
    const sourceY = Math.min(
      sourceHeight - 1,
      Math.floor((y * sourceHeight) / targetHeight),
    );
    const sourceRow = rows[sourceY];

    for (let x = 0; x < targetWidth; x++) {
      const sourceX = Math.min(
        sourceWidth - 1,
        Math.floor((x * sourceWidth) / targetWidth),
      );
      const sourceOffset = sourceX * bytesPerPixel;
      sourceRow.copy(
        raw,
        out,
        sourceOffset,
        sourceOffset + bytesPerPixel,
      );
      out += bytesPerPixel;
    }
  }

  return raw;
}

function resizeIndexedPng(
  buffer: Buffer,
  targetWidth: number,
  targetHeight: number,
): Buffer {
  const { info, chunks } = parsePng(buffer);

  if (info.bitDepth !== 8 || info.colorType !== 3) {
    throw new Error(
      "Artwork source must be an 8-bit indexed PNG for RiptOPL compatibility.",
    );
  }
  if (info.interlace !== 0) {
    throw new Error("Interlaced PNG artwork is not supported.");
  }

  if (info.width === targetWidth && info.height === targetHeight) {
    return buffer;
  }

  const idatData = Buffer.concat(
    chunks
      .filter((chunk) => chunk.type === "IDAT")
      .map((chunk) => chunk.data),
  );
  if (idatData.length === 0) {
    throw new Error("Artwork PNG has no IDAT data.");
  }

  const bytesPerPixel = channelsForColorType(info.colorType);
  const sourceRows = unfilterRows(
    inflateSync(idatData),
    info.width,
    info.height,
    bytesPerPixel,
  );
  const resizedRaw = resizeRowsNearest(
    sourceRows,
    info.width,
    info.height,
    targetWidth,
    targetHeight,
    bytesPerPixel,
  );
  const resizedIdat = deflateSync(resizedRaw);

  const output: Buffer[] = [PNG_SIGNATURE];
  let idatWritten = false;

  for (const chunk of chunks) {
    if (chunk.type === "IHDR") {
      const ihdr = Buffer.from(chunk.data);
      ihdr.writeUInt32BE(targetWidth, 0);
      ihdr.writeUInt32BE(targetHeight, 4);
      output.push(makeChunk("IHDR", ihdr));
      continue;
    }

    if (chunk.type === "IDAT") {
      if (!idatWritten) {
        output.push(makeChunk("IDAT", resizedIdat));
        idatWritten = true;
      }
      continue;
    }

    output.push(makeChunk(chunk.type, chunk.data));
  }

  return Buffer.concat(output);
}

export function normalizeArtworkPng(
  buffer: Buffer,
  system: ArtworkSystem,
  saveType: string,
): Buffer {
  const info = readPngInfo(buffer);

  if (info.bitDepth !== 8 || info.colorType !== 3) {
    throw new Error(
      "Artwork source must be an 8-bit indexed PNG for RiptOPL compatibility.",
    );
  }

  const expected = EXPECTED_DIMENSIONS[system][saveType.toUpperCase()];
  if (!expected) {
    return buffer;
  }

  return resizeIndexedPng(
    buffer,
    expected.width,
    expected.height,
  );
}
