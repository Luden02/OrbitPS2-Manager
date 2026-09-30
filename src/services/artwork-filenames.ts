const INDEXED_REMOTE_TYPES: Record<string, string> = {
  SCR: "SCR_00",
  SCR2: "SCR_01",
  SCR3: "SCR_02",
  BG: "BG_00",
};

/**
 * Candidates for one slot, in the order they should be tried.
 *
 * `exclude` holds the remote file names an earlier type of the same call already
 * wrote. `reserved` on its own only stops a slot from *preferring* a sibling's
 * indexed code — it cannot know which variant an earlier slot fell back to, so
 * without `exclude` every slot walks the same tail and saves one image several
 * times over (a game whose database only holds `SCR_05` fills both `SCR` and
 * `SCR2` with it).
 */
export function artRemoteFileNames(
  gameId: string,
  type: string,
  exclude?: ReadonlySet<string>
): string[] {
  const classic = `${gameId}_${type}.png`;
  const indexedType = INDEXED_REMOTE_TYPES[type];
  if (!indexedType) {
    return without(exclude, [classic]);
  }
  return without(exclude, [`${gameId}_${indexedType}.png`, classic]);
}

function without(
  exclude: ReadonlySet<string> | undefined,
  names: string[]
): string[] {
  return exclude ? names.filter((name) => !exclude.has(name)) : names;
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
 *
 * `exclude` drops the files an earlier type of the same call already wrote — see
 * {@link artRemoteFileNames}.
 */
export function artSlotFileNames(
  gameId: string,
  type: string,
  exclude?: ReadonlySet<string>
): string[] {
  const names = artRemoteFileNames(gameId, type);
  const family = SLOT_VARIANT_FAMILIES[type];

  if (family) {
    for (let i = 0; i <= family.max; i += 1) {
      const code = `${family.prefix}_${String(i).padStart(2, "0")}`;
      if (family.reserved.includes(code)) continue;
      const fileName = `${gameId}_${code}.png`;
      if (!names.includes(fileName)) names.push(fileName);
    }
  }

  return without(exclude, names);
}
