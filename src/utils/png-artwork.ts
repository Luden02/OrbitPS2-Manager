export type ArtworkSystem = 'PS1' | 'PS2';

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * The exact dimensions each art type must be for RiptOPL/OPL to display it.
 * Only COV and ICO use doubled dimensions; every other type is single-sized.
 */
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

export function readPngInfo(buffer: Buffer): PngInfo {
  if (
    buffer.length < PNG_SIGNATURE.length ||
    !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw new Error('Artwork source is not a PNG file.');
  }

  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const next = dataEnd + 4;

    if (next > buffer.length) {
      throw new Error('Artwork PNG is truncated.');
    }

    if (type === 'IHDR') {
      const data = buffer.subarray(dataStart, dataEnd);
      if (data.length !== 13) {
        throw new Error('Artwork PNG has no valid IHDR chunk.');
      }
      return {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    }

    offset = next;
  }

  throw new Error('Artwork PNG has no IHDR chunk.');
}

/** The 8-bit indexed, non-interlaced encoding OPL renders from palette. */
const INDEXED_8BIT = 3;
const BIT_DEPTH = 8;

/**
 * Returns the RiptOPL/OPL name for a save base, or `undefined` when the type
 * has no enforced dimension. Advisory only — the bytes are always written.
 */
type PngValidationResult = {
  expected?: { width: number; height: number };
  failures: string[];
};

export function validateArtworkPng(
  buffer: Buffer,
  system: ArtworkSystem,
  saveType: string,
): PngValidationResult {
  const failures: string[] = [];
  const expected = EXPECTED_DIMENSIONS[system][saveType.toUpperCase()];

  try {
    const info = readPngInfo(buffer);

    if (info.bitDepth !== BIT_DEPTH || info.colorType !== INDEXED_8BIT) {
      failures.push(
        `not an 8-bit indexed PNG (bit depth ${info.bitDepth}, color type ${info.colorType})`,
      );
    }

    if (info.interlace !== 0) {
      failures.push('interlaced PNGs are not supported by OPL');
    }

    if (
      expected &&
      (info.width !== expected.width || info.height !== expected.height)
    ) {
      failures.push(
        `${info.width}x${info.height} instead of expected ${expected.width}x${expected.height}`,
      );
    }
  } catch (err: any) {
    failures.push(err?.message || 'unreadable PNG');
  }

  return { expected, failures };
}