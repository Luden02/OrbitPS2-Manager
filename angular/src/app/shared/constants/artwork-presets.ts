/** Friendly label for each known art-type suffix (`GAMEID_<code>.png`). */
export const ART_TYPE_LABELS: Record<string, string> = {
  COV: 'Cover',
  COV2: 'Cover (Alt 2)',
  ICO: 'Icon',
  SCR: 'Screenshot',
  SCR2: 'Screenshot 2',
  BG: 'Background',
  LAB: 'Spine Label',
  LGO: 'Logo',
};

/** Family label used for the database's indexed `SCR_NN` / `BG_NN` codes. */
const INDEXED_LABEL_BASE: Record<string, string> = {
  SCR: 'Screenshot',
  BG: 'Background',
};

/**
 * Returns the file-name base a type code must be saved under.
 *
 * Open PS2 Loader only reads the recognised asset files of a family, so the
 * database's indexed variants keep their position but lose the index:
 *   - `BG_00` / `BG_01` / … → `BG`  → saved as `<gameID>_BG.png` (one kept)
 *   - `SCR_00` → `SCR`, any other `SCR_0n` → `SCR2` → saved as
 *     `<gameID>_SCR.png` and `<gameID>_SCR2.png` (the two screenshots OPL shows)
 *   - anything else keeps its code (`COV`, `COV2`, …)
 */
export function artSaveNameForType(code: string): string {
  const indexed = /^(SCR|BG)_(\d{1,2})$/i.exec(code);
  if (!indexed) return code.toUpperCase();
  const base = indexed[1].toUpperCase();
  if (base === 'BG') return 'BG';
  if (base === 'SCR') {
    return parseInt(indexed[2], 10) === 0 ? 'SCR' : 'SCR2';
  }
  return code.toUpperCase();
}

/**
 * Returns a friendly label for a type code, falling back to the code itself.
 * Indexed screenshot/background codes from the art database (`SCR_00`,
 * `BG_02`, …) render as "Screenshot 1", "Background 3", etc.
 */
export function artTypeLabel(code: string): string {
  if (ART_TYPE_LABELS[code]) return ART_TYPE_LABELS[code];
  const indexed = /^(SCR|BG)_(\d{1,2})$/i.exec(code);
  if (indexed) {
    const base = INDEXED_LABEL_BASE[indexed[1].toUpperCase()];
    return `${base} ${parseInt(indexed[2], 10) + 1}`;
  }
  return code;
}

/**
 * Ordered superset of every art type this app knows about. Used by the bulk
 * artwork dialog's asset-type picker (which can't afford a per-game
 * discovery call). `as const` keeps the type codes as a literal union.
 */
export const KNOWN_ART_TYPES = [
  'COV',
  'COV2',
  'ICO',
  'SCR',
  'SCR2',
  'BG',
  'LAB',
  'LGO',
] as const;

export interface ArtCategory {
  id: string;
  label: string;
  /** Art-type codes that belong to this category. */
  types: string[];
  /**
   * Code prefixes that make a type part of this category. The database uses
   * indexed variants (`SCR_00`, `BG_01`, …) for screenshots and backgrounds,
   * so those are matched by prefix rather than exact code.
   */
  prefixes?: string[];
}

/**
 * Artwork grouped by purpose, used by the single-game wizard to organise the
 * available types instead of one flat, confusing list.
 */
export const ART_CATEGORIES: ArtCategory[] = [
  {
    id: 'covers',
    label: 'Covers',
    types: ['COV', 'COV2'],
    prefixes: ['COV'],
  },
  { id: 'icons', label: 'Icons', types: ['ICO'], prefixes: ['ICO'] },
  {
    id: 'screenshots',
    label: 'Screenshots',
    types: ['SCR', 'SCR2'],
    prefixes: ['SCR'],
  },
  { id: 'backgrounds', label: 'Backgrounds', types: ['BG'], prefixes: ['BG'] },
  { id: 'logo', label: 'Logos', types: ['LGO'], prefixes: ['LGO'] },
  { id: 'spine', label: 'Spine', types: ['LAB'], prefixes: ['LAB'] },
];

/**
 * Id of the category a type code belongs to. Exact codes are matched first;
 * when none matches, the code is tested against each category's prefixes so
 * indexed database variants like `SCR_00` or `BG_02` still end up in their
 * group. Returns undefined for completely unknown types.
 */
export function artCategoryForType(type: string): string | undefined {
  const upper = type.toUpperCase();
  return ART_CATEGORIES.find(
    (c) =>
      c.types.includes(upper) ||
      (c.prefixes ?? []).some((p) => upper.startsWith(p)),
  )?.id;
}

/** Any art type that is not listed in a known category. */
export const UNCATEGORIZED_LABEL = 'Other';
