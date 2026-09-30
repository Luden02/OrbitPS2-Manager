/** Friendly label for each known art-type suffix (`GAMEID_<code>.png`). */
export const ART_TYPE_LABELS: Record<string, string> = {
  COV: 'Cover',
  COV2: 'Back Cover',
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

/** Indexed database variants, e.g. `SCR_00` or `BG_02`. */
const INDEXED_CODE_RE = /^(SCR|BG)_(\d{1,2})$/i;

/** Every screenshot code: the two classic slots and their indexed variants. */
const SCREENSHOT_CODE_RE = /^(?:SCR|SCR2|SCR_\d{1,2})$/i;

/** How many screenshots Open PS2 Loader shows. */
export const MAX_SCREENSHOTS = 2;

/** The screenshot files OPL reads, in display order. */
const SCREENSHOT_SAVE_SLOTS = ['SCR', 'SCR2'] as const;

/**
 * Whether a type code is a screenshot OPL can show — an indexed database variant
 * (`SCR_00`, `SCR_05`) or a classic slot name (`SCR`, `SCR2`).
 */
export function isScreenshotArtCode(code: string): boolean {
  return SCREENSHOT_CODE_RE.test(code);
}

/**
 * Returns the family base a type code belongs to, without picking a screenshot
 * slot.
 *
 * Open PS2 Loader only reads the recognised asset files of a family, so the
 * database's indexed variants keep their position but lose the index:
 *   - `BG_00` / `BG_01` / … → `BG`  → saved as `<gameID>_BG.png` (one kept)
 *   - `SCR_00` / `SCR_05` / … → `SCR` → saved as `<gameID>_SCR.png` or
 *     `<gameID>_SCR2.png`
 *   - anything else keeps its code (`COV`, `COV2`, …)
 *
 * `COV2` is the back cover and is saved as `COV2`. It is never written as
 * `COV3`: that slot holds the separate 3D box renders
 * (archive.org/details/ps2-3d-art), which the database does not carry.
 *
 * Which of the two screenshot files a code lands in is a *selection* decision,
 * not one the code itself can make — see {@link artSaveNamesForSelection}.
 */
export function artSaveNameForType(code: string): string {
  const indexed = INDEXED_CODE_RE.exec(code);
  return indexed ? indexed[1].toUpperCase() : code.toUpperCase();
}

/** Every save base a type code can occupy; screenshots may take either slot. */
export function artSaveNameCandidates(code: string): string[] {
  return isScreenshotArtCode(code)
    ? [...SCREENSHOT_SAVE_SLOTS]
    : [artSaveNameForType(code)];
}

/**
 * Assigns the file base each type is saved under.
 *
 * `types` must be in the order the user picked them: the two screenshot slots OPL
 * reads are handed out by selection order, so any two picks land in two
 * different files. `SCR_02` and `SCR_05` save as `SCR` and `SCR2` instead of
 * both claiming `SCR2` and overwriting each other. Backgrounds collapse to
 * `BG` (OPL keeps one) and every other type keeps its code. Picks past the
 * second screenshot repeat the last slot, mirroring OPL's own cap.
 */
export function artSaveNamesForSelection(types: Iterable<string>): Map<string, string> {
  const saveNames = new Map<string, string>();
  let nextSlot = 0;
  for (const type of types) {
    if (isScreenshotArtCode(type)) {
      const slot = Math.min(nextSlot, SCREENSHOT_SAVE_SLOTS.length - 1);
      saveNames.set(type, SCREENSHOT_SAVE_SLOTS[slot]);
      nextSlot += 1;
    } else {
      saveNames.set(type, artSaveNameForType(type));
    }
  }
  return saveNames;
}

/**
 * Returns a friendly label for a type code, falling back to the code itself.
 * Indexed screenshot/background codes from the art database (`SCR_00`,
 * `BG_02`, …) render as "Screenshot 1", "Background 3", etc.
 */
export function artTypeLabel(code: string): string {
  if (ART_TYPE_LABELS[code]) return ART_TYPE_LABELS[code];
  const indexed = INDEXED_CODE_RE.exec(code);
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
