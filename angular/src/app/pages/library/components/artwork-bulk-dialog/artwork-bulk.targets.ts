import { Game } from '@shared/types/game.type';
import {
  artSaveNameForType,
  KNOWN_ART_TYPES,
} from '@shared/constants/artwork-presets';
import {
  ps1ArtworkIdentities,
  ps1CanonicalRename,
  ps1CanonicalStorageName,
  ps1StorageIdentity,
} from '@shared/utils/ps1-artwork-identities';

/** Which section of the library an artwork bulk run should target. */
export type ArtScope = 'PS2' | 'PS1' | 'APPS' | 'ALL';

/** Every asset type available in the artwork database. */
export type ArtType = (typeof KNOWN_ART_TYPES)[number];

/** The asset types preselected by default. */
export const DEFAULT_ART_TYPES: ArtType[] = ['COV', 'ICO', 'SCR'];

export interface ArtTarget {
  label: string;
  path: string;
  gameId: string;
  system: 'PS1' | 'PS2';
  saveAsName?: string;
  normalizeKind?: 'VCD' | 'EMBER';
  canonicalName?: string;
  /**
   * Current PS1 storage name (VCD stem / Ember folder) when it differs from
   * the canonical title, i.e. the name normalization would rename away from.
   */
  renameFrom?: string;
}

function needsPs1Normalization(game: Game): boolean {
  return !!ps1CanonicalRename(game);
}

/**
 * Games in a scope that can have artwork fetched. Requires a resolvable game
 * ID. Regular ELF apps are always excluded (they have no artwork source);
 * PS1 POPStarter launchers (which live under APPS) are included because they
 * pull from the PS1 database via their boot ELF name.
 */
export function eligibleGamesForScope(games: Game[], scope: ArtScope): Game[] {
  return games.filter((g) => {
    if (!g.gameId) return false;
    switch (scope) {
      case 'PS2':
        return (g.system ?? 'PS2') === 'PS2';
      case 'PS1':
        return g.system === 'PS1';
      case 'APPS':
        return g.system === 'APPS' && !!g.isPs1Launcher;
      case 'ALL':
      default:
        return g.system !== 'APPS' || !!g.isPs1Launcher;
    }
  });
}

/**
 * Build the artwork job targets for a scope.
 *
 * When `opts.onlyMissing` is set (the "only download missing artwork" policy)
 * games that already have every requested asset type are dropped entirely —
 * they are neither queued nor logged, matching what the dialog's pre-flight
 * summary promises.
 *
 * With `opts.normalize` (the user agreed to rename PS1 storage to canonical
 * titles) PS1 targets carry `normalizeKind`/`canonicalName` so the job renames
 * the VCD/Ember folder before saving art, and a game whose name is not yet
 * canonical is queued even if its art is complete. Without it, PS1 art is
 * saved under the current storage name — the name RiptOPL actually reads —
 * and nothing on disk is renamed.
 */
export function artTargetsForScope(
  games: Game[],
  scope: ArtScope,
  opts?: { onlyMissing?: boolean; artTypes?: ArtType[]; normalize?: boolean },
): ArtTarget[] {
  const types = opts?.artTypes?.length ? opts.artTypes : DEFAULT_ART_TYPES;
  const normalize = !!opts?.normalize;
  return eligibleGamesForScope(games, scope)
    .filter((g) => {
      if (!opts?.onlyMissing) return true;
      return (
        (normalize && needsPs1Normalization(g)) ||
        existingArtTypesForGame(g, types).length < types.length
      );
    })
    .map((g) => {
      const isPs1Launcher = g.system === 'APPS' && !!g.isPs1Launcher;
      const currentPs1Identity = ps1StorageIdentity(g);
      const canonicalPs1Identity = ps1CanonicalStorageName(g);
      const normalizeThis =
        normalize && g.system === 'PS1' && !!canonicalPs1Identity;
      return {
        label: g.title || g.gameId || g.filename,
        path: g.path,
        gameId: g.gameId,
        system: isPs1Launcher || g.system === 'PS1' ? 'PS1' : 'PS2',
        saveAsName: isPs1Launcher
          ? g.ps1LauncherBoot
          : g.system === 'PS1'
            ? currentPs1Identity
            : undefined,
        normalizeKind: normalizeThis
          ? g.format === 'EMBER'
            ? ('EMBER' as const)
            : ('VCD' as const)
          : undefined,
        canonicalName: normalizeThis ? canonicalPs1Identity : undefined,
        renameFrom: needsPs1Normalization(g) ? currentPs1Identity : undefined,
      };
    });
}

/**
 * Which of the requested art types already exist for a game on disk.
 *
 * Mirrors the library's `matchArtForGames` conventions exactly so the
 * dialog's pre-flight numbers agree with what the Library page actually
 * shows:
 *   - PS1 POPStarter launchers  → matched by boot ELF filename (name-based)
 *   - PS1 VCDs                 → VCD stem, plus GameID only when the current
 *     VCD filename itself begins with that GameID (RiptOPL's compatibility fallback)
 *   - Ember games               → game-folder name only
 *   - Everything else          → matched by gameId
 *
 * Art saved under a canonical title the storage has not been renamed to is
 * deliberately not counted: RiptOPL cannot see it, so it is not "present".
 */
export function existingArtTypesForGame(
  game: Game,
  types: ArtType[],
): ArtType[] {
  const art = Array.isArray(game.art) ? game.art : [];
  const launcherBoot = game.isPs1Launcher ? game.ps1LauncherBoot : undefined;
  const acceptedNames = new Set(
    game.system === 'PS1'
      ? ps1ArtworkIdentities(game)
      : [game.gameId].filter((value): value is string => !!value),
  );

  return types.filter((type) => {
    const installedType = artSaveNameForType(type).toUpperCase();
    return art.some(
      (a) =>
        a.type?.toUpperCase() === installedType &&
        (launcherBoot
          ? a.name === `${launcherBoot}_${installedType}`
          : acceptedNames.has(a.gameId)),
    );
  });
}
