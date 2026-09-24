import { Game } from '@shared/types/game.type';
import { KNOWN_ART_TYPES } from '@shared/constants/artwork-presets';

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
 */
export function artTargetsForScope(
  games: Game[],
  scope: ArtScope,
  opts?: { onlyMissing?: boolean; artTypes?: ArtType[] },
): ArtTarget[] {
  const types = opts?.artTypes?.length ? opts.artTypes : DEFAULT_ART_TYPES;
  return eligibleGamesForScope(games, scope)
    .filter((g) => {
      if (!opts?.onlyMissing) return true;
      return existingArtTypesForGame(g, types).length < types.length;
    })
    .map((g) => {
      const isPs1Launcher = g.system === 'APPS' && !!g.isPs1Launcher;
      return {
        label: g.title || g.gameId || g.filename,
        path: g.path,
        gameId: g.gameId,
        system: isPs1Launcher || g.system === 'PS1' ? 'PS1' : 'PS2',
        // PS1 launcher art is keyed by boot ELF name (e.g. "XX.SCUS_944.02.Game.ELF"),
        // so the saved files must use that stem to match the library matcher.
        // PS1 POPSLoader/RiptOPL VCDs intentionally save under the gameId: the
        // repo is keyed by game folder and `existingArtTypesForGame` already
        // detects both the gameId and title-stem conventions, so re-downloading
        // won't duplicate art that the importer saved under the VCD title.
        saveAsName: isPs1Launcher ? g.ps1LauncherBoot : undefined,
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
 *   - PS1 POPSLoader/RiptOPL VCDs → matched by gameId **or** VCD title stem
 *     (their art may be saved under either convention)
 *   - Everything else          → matched by gameId
 */
export function existingArtTypesForGame(
  game: Game,
  types: ArtType[],
): ArtType[] {
  const art = Array.isArray(game.art) ? game.art : [];
  const launcherBoot = game.isPs1Launcher ? game.ps1LauncherBoot : undefined;
  const ps1VcdStem =
    game.system === 'PS1' && game.filename
      ? game.filename.replace(/\.[^./\\]+$/, '')
      : undefined;
  return types.filter((type) =>
    art.some(
      (a) =>
        a.type?.toUpperCase() === type &&
        (launcherBoot
          ? a.name === `${launcherBoot}_${type}`
          : ps1VcdStem
            ? a.gameId === game.gameId || a.gameId === ps1VcdStem
            : a.gameId === game.gameId),
    ),
  );
}
