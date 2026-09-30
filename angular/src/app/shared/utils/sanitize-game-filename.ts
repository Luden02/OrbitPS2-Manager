const WINDOWS_RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/**
 * Renderer-side mirror of the backend filename sanitizer. Canonical display
 * titles may contain characters that cannot be used as RiptOPL storage names.
 */
export function sanitizeGameFilename(name: string): string {
  if (!name) return '_';

  let cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '');

  if (!cleaned) return '_';

  const baseUpper = cleaned.toUpperCase().split('.')[0];
  if (WINDOWS_RESERVED_NAMES.has(baseUpper)) {
    cleaned = `${cleaned}_`;
  }

  return cleaned;
}


export type RiptOplPs1StorageKind = 'VCD' | 'EMBER';

const RIPTOPL_PS1_STORAGE_MAX_BYTES: Record<RiptOplPs1StorageKind, number> = {
  VCD: 160,
  EMBER: 180,
};

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function truncateUtf8Bytes(value: string, maxBytes: number): string {
  if (utf8Length(value) <= maxBytes) return value;

  let result = '';
  for (const char of value) {
    const candidate = result + char;
    if (utf8Length(candidate) > maxBytes) break;
    result = candidate;
  }
  return result;
}

/** Renderer-side mirror of the backend RiptOPL PS1 storage-name rules. */
export function sanitizeRiptOplPs1StorageName(
  name: string,
  kind: RiptOplPs1StorageKind,
): string {
  let cleaned = sanitizeGameFilename(name);
  cleaned = truncateUtf8Bytes(
    cleaned,
    RIPTOPL_PS1_STORAGE_MAX_BYTES[kind],
  ).replace(/^[.\s]+|[.\s]+$/g, '');

  if (!cleaned) cleaned = '_';
  if (kind === 'VCD' && cleaned.toUpperCase() === 'POPSTARTER') {
    cleaned = 'POPSTARTER_';
  }
  return cleaned;
}