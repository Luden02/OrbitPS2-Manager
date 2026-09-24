export const PS1_GAME_ID_PREFIXES = [
  "SCUS",
  "SLUS",
  "SCES",
  "SLES",
  "SCPS",
  "SLPS",
  "SLPM",
  "SIPS",
  "SCAJ",
  "PAPX",
  "PCPX",
  "SCED",
  "SLED",
];

export const PS1_GAME_ID_REGEX = new RegExp(
  `(?:${PS1_GAME_ID_PREFIXES.join("|")})[_-][0-9]{3}\\.[0-9]{2}`,
  "g"
);

export const PS2_GAME_ID_PREFIXES = [
  "SLUS",
  "SCUS",
  "SLES",
  "SCES",
  "SLPM",
  "SLPS",
  "SCPS",
  "SCPM",
  "SLAJ",
  "SCAJ",
  "SLKA",
  "SCKA",
  "SCED",
  "SCCS",
];

export const PS2_GAME_ID_REGEX = new RegExp(
  `(?:${PS2_GAME_ID_PREFIXES.join("|")})_[0-9]{3}\\.[0-9]{2}(?:;1)?`,
  "g"
);

export const FILE_SCAN_CHUNK_BYTES = 1024 * 1024; // 1 MB chunks keep memory usage predictable.
export const FILE_SCAN_OVERLAP_BYTES = 64; // Overlap to catch IDs spanning chunk boundaries.
export const VCD_HEADER_SIZE = 1048576; // 1 MB — VCD header before disc data

export function normaliseGameIdForLookup(rawId: string): string {
  return rawId.replace("_", "-").replace(/\./g, "").toUpperCase();
}

/**
 * Returns `rawId` in canonical PS1 form (`XXXX_###.##`, uppercase) when it
 * looks like a PS1 serial — including a malformed `-` separator or lowercase
 * prefix. Any other value (homebrew ids, junk) is passed through unchanged so
 * unrelated title.cfg `GameID=` data is never altered.
 */
export function normalisePs1GameIdFromTitleCfg(rawId: string): string {
  const trimmed = rawId.trim();
  const match = trimmed.match(/^([A-Za-z]{4})[-_]([0-9]{3})\.([0-9]{2})$/);
  if (!match || !PS1_GAME_ID_PREFIXES.includes(match[1].toUpperCase())) {
    return trimmed;
  }
  return `${match[1].toUpperCase()}_${match[2]}.${match[3]}`;
}
