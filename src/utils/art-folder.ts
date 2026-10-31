import * as fs from "fs/promises";
import path from "path";
import { parseArtworkBaseName } from "./artwork-name";

/**
 * Sub-folders of `ART/` that LUNA reads in addition to the flat OPL files.
 *
 * `SCROLL/` keeps the OPL `<identity>_LGO.png` convention, so its files parse
 * exactly like the ones in the root. `PSBBN/` holds one square cover per game
 * named after the identity alone (`<identity>.png`): Game IDs contain
 * underscores, so those names must never go through
 * {@link parseArtworkBaseName}, which would read `SLUS_200.01` as identity
 * `SLUS` of type `200.01`.
 *
 * The folder name doubles as the art-type code the library reports for files
 * found inside it, so a LUNA scroll logo is never confused with the OPL `LGO`
 * of the same game — they are two separate files the user can have one of.
 */
export const LUNA_ART_SUBDIRS = ["PSBBN", "SCROLL"] as const;

/** The sub-folder whose files carry no `_TYPE` suffix. */
const FLAT_SUBDIR = "PSBBN";

const IMAGE_EXT_RE = /^\.(png|jpe?g)$/i;

export interface ArtFile {
  /** Absolute path on disk. */
  path: string;
  /** Folder holding the file — `ART/` itself or one of its LUNA sub-folders. */
  dir: string;
  /** File name within `dir`. */
  name: string;
  /** Artwork identity: Game ID, VCD stem, Ember folder or launcher ELF name. */
  identity: string;
  /** Art-type code (`COV`, `LGO`, …); the folder name inside a LUNA sub-folder. */
  type: string;
  /** What this same file is called when it belongs to another identity. */
  renamedTo: (identity: string) => string;
}

async function listArtFilesIn(
  dir: string,
  subDir?: (typeof LUNA_ART_SUBDIRS)[number]
): Promise<ArtFile[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    // A missing folder yields nothing rather than throwing: `ART/PSBBN` only
    // exists once LUNA artwork has been fetched, and `ART/` itself may be absent.
    return [];
  }

  const files: ArtFile[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const ext = path.extname(name);
    if (!IMAGE_EXT_RE.test(ext)) continue;
    const baseName = name.slice(0, -ext.length);

    if (subDir === FLAT_SUBDIR) {
      files.push({
        path: path.join(dir, name),
        dir,
        name,
        identity: baseName,
        type: subDir,
        renamedTo: (identity) => `${identity}${ext}`,
      });
      continue;
    }

    const parsed = parseArtworkBaseName(baseName);
    if (!parsed) continue;
    files.push({
      path: path.join(dir, name),
      dir,
      name,
      identity: parsed.identity,
      type: subDir ?? parsed.type,
      renamedTo: (identity) => `${identity}_${parsed.type}${ext}`,
    });
  }
  return files;
}

/** Artwork files inside the LUNA sub-folders of `artDir`. */
export async function listLunaArtFiles(artDir: string): Promise<ArtFile[]> {
  const perDir = await Promise.all(
    LUNA_ART_SUBDIRS.map((sub) =>
      listArtFilesIn(path.join(artDir, sub), sub)
    )
  );
  return perDir.flat();
}

/**
 * Every artwork file below `artDir` — the flat OPL files and the LUNA
 * sub-folders alike. Files in the root whose name carries no `_TYPE` suffix are
 * skipped: they belong to no artwork identity, so renaming or deleting them
 * along with a game would be a guess.
 */
export async function listArtFiles(artDir: string): Promise<ArtFile[]> {
  const [root, luna] = await Promise.all([
    listArtFilesIn(artDir),
    listLunaArtFiles(artDir),
  ]);
  return [...root, ...luna];
}

/** Paths of the LUNA sub-folder artwork belonging to one artwork identity. */
export async function lunaArtPathsForIdentity(
  artDir: string,
  identity: string
): Promise<string[]> {
  const files = await listLunaArtFiles(artDir);
  return files.filter((f) => f.identity === identity).map((f) => f.path);
}
