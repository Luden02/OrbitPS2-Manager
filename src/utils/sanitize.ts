const WINDOWS_RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

/**
 * Strips characters from `name` that are illegal in filenames on Windows, macOS, or Linux.
 * - Removes: < > : " / \ | ? * and ASCII control characters (0x00–0x1F)
 * - Collapses whitespace and trims leading/trailing dots and spaces (Windows trims these silently)
 * - Renames Windows reserved device names by appending an underscore
 * - Returns an underscore if the result would otherwise be empty
 *
 * Intended for the *name* portion only — do not pass a full path, and re-append the extension yourself.
 */
export function sanitizeGameFilename(name: string): string {
  if (!name) return "_";

  let cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "");

  if (!cleaned) return "_";

  const upper = cleaned.toUpperCase();
  const baseUpper = upper.split(".")[0];
  if (WINDOWS_RESERVED_NAMES.has(baseUpper)) {
    cleaned = `${cleaned}_`;
  }

  return cleaned;
}

export type RiptOplPs1StorageKind = "VCD" | "EMBER";

const RIPTOPL_PS1_STORAGE_MAX_BYTES: Record<RiptOplPs1StorageKind, number> = {
  VCD: 160,
  EMBER: 180,
};

function truncateUtf8Bytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;

  let result = "";
  let bytes = 0;
  for (const char of value) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (bytes + charBytes > maxBytes) break;
    result += char;
    bytes += charBytes;
  }
  return result;
}

/**
 * Produces a storage identity that RiptOPL can actually round-trip.
 *
 * RiptOPL's VCD list stores at most 160 bytes of the filename stem and rejects
 * the reserved POPSTARTER.VCD entry. Ember passes the bare game-folder name to
 * its launcher and caps that argument at 180 bytes. Generic filesystem
 * sanitization alone is therefore insufficient for PS1 storage names.
 */
export function sanitizeRiptOplPs1StorageName(
  name: string,
  kind: RiptOplPs1StorageKind,
): string {
  const maxBytes = RIPTOPL_PS1_STORAGE_MAX_BYTES[kind];
  let cleaned = sanitizeGameFilename(name);
  cleaned = truncateUtf8Bytes(cleaned, maxBytes)
    .replace(/^[.\s]+|[.\s]+$/g, "");

  if (!cleaned) cleaned = "_";

  if (kind === "VCD" && cleaned.toUpperCase() === "POPSTARTER") {
    cleaned = "POPSTARTER_";
  }

  return cleaned;
}
