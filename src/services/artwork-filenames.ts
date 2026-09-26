const INDEXED_REMOTE_TYPES: Record<string, string> = {
  SCR: "SCR_00",
  SCR2: "SCR_01",
  SCR3: "SCR_02",
  BG: "BG_00",
};

export function artRemoteFileNames(gameId: string, type: string): string[] {
  const classic = `${gameId}_${type}.png`;
  const indexedType = INDEXED_REMOTE_TYPES[type];
  if (!indexedType) {
    return [classic];
  }
  return [`${gameId}_${indexedType}.png`, classic];
}

/**
 * Indexed variants a canonical slot may fall back to when its own preferred
 * candidates are missing, as `{ prefix, max, reserved }`.
 *
 * `reserved` lists the indexed codes owned by a sibling slot of the same family
 * (`SCR` owns `SCR_00`, `SCR2` owns `SCR_01`, …). They are never offered as a
 * fallback, otherwise a game with a single `SCR_00` would get that same shot
 * saved twice — once as `<gameID>_SCR.png` and once as `<gameID>_SCR2.png`.
 */
const SLOT_VARIANT_FAMILIES: Record<
  string,
  { prefix: string; max: number; reserved: string[] }
> = {
  SCR: { prefix: "SCR", max: 30, reserved: ["SCR_00"] },
  SCR2: { prefix: "SCR", max: 30, reserved: ["SCR_00", "SCR_01"] },
  SCR3: { prefix: "SCR", max: 30, reserved: ["SCR_00", "SCR_01", "SCR_02"] },
  BG: { prefix: "BG", max: 19, reserved: ["BG_00"] },
};

/**
 * Candidate list for a canonical slot when the caller wants *any* indexed
 * variant of the family, not just the one `artRemoteFileNames` guarantees.
 *
 * `artRemoteFileNames` is kept as the prefix so the primary indexed code is
 * still tried first and the classic file is still tried second; the remaining
 * indexed variants are appended behind them. Use this for bulk runs, where a
 * game whose database only holds e.g. `SCR_05` should still end up with a
 * screenshot instead of no artwork at all.
 */
export function artSlotFileNames(gameId: string, type: string): string[] {
  const names = artRemoteFileNames(gameId, type);
  const family = SLOT_VARIANT_FAMILIES[type];
  if (!family) return names;

  for (let i = 0; i <= family.max; i += 1) {
    const code = `${family.prefix}_${String(i).padStart(2, "0")}`;
    if (family.reserved.includes(code)) continue;
    const fileName = `${gameId}_${code}.png`;
    if (!names.includes(fileName)) names.push(fileName);
  }
  return names;
}
