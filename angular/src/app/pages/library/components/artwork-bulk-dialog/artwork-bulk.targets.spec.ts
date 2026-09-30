import { Game, gameArt } from '@shared/types/game.type';
import {
  ArtType,
  artTargetsForScope,
  DEFAULT_ART_TYPES,
  existingArtTypesForGame,
} from './artwork-bulk.targets';

function artFor(stem: string, type: string, name?: string): gameArt {
  return {
    extension: 'png',
    gameId: stem,
    name: name ?? `${stem}_${type}`,
    path: '',
    type,
    base64: '',
  };
}

function makeGame(
  partial: Partial<Game> & { filename: string; gameId: string },
): Game {
  return {
    cdType: '',
    path: '',
    extension: '',
    parentPath: '',
    ...partial,
  } as Game;
}

function ps1Vcd(overrides: Partial<Game> = {}): Game {
  return makeGame({
    system: 'PS1',
    filename: 'Spyro the Dragon.VCD',
    gameId: 'SCUS_942.28',
    title: 'Spyro the Dragon',
    ...overrides,
  });
}

describe('artTargetsForScope - RiptOPL save names', () => {
  it('saves PS1 VCD art under the on-disk filename stem', () => {
    const target = artTargetsForScope([ps1Vcd()], 'PS1')[0];
    expect(target.saveAsName).toBe('Spyro the Dragon');
    expect(target.gameId).toBe('SCUS_942.28');
  });

  it('keeps boot ELF names for PS1 launchers', () => {
    const launcher = makeGame({
      system: 'APPS',
      filename: 'XX.SCUS_944.02.Game.ELF',
      gameId: 'SCUS_944.02',
      isPs1Launcher: true,
      ps1LauncherBoot: 'XX.SCUS_944.02.Game.ELF',
    });
    const target = artTargetsForScope([launcher], 'APPS')[0];
    expect(target.saveAsName).toBe('XX.SCUS_944.02.Game.ELF');
    expect(target.system).toBe('PS1');
  });

  it('leaves PS2 targets on the default gameId save name', () => {
    const ps2 = makeGame({
      system: 'PS2',
      filename: 'SLUS_208.51.iso',
      gameId: 'SLUS_208.51',
    });
    const target = artTargetsForScope([ps2], 'PS2')[0];
    expect(target.saveAsName).toBeUndefined();
  });
});

describe('existingArtTypesForGame - RiptOPL readability', () => {
  const types = DEFAULT_ART_TYPES;

  it('counts art saved under the VCD filename stem', () => {
    const game = ps1Vcd({
      art: [artFor('Spyro the Dragon', 'COV'), artFor('Spyro the Dragon', 'ICO')],
    });
    expect(existingArtTypesForGame(game, types)).toEqual(['COV', 'ICO']);
  });

  it('does NOT count GameID art RiptOPL cannot read (title-renamed VCD)', () => {
    const game = ps1Vcd({
      art: [artFor('SCUS_942.28', 'COV')],
    });
    expect(existingArtTypesForGame(game, types)).toEqual([]);
  });

  it('still counts GameID art when the stem starts with the GameID', () => {
    const game = ps1Vcd({
      filename: 'SCUS_942.28.Spyro.VCD',
      art: [artFor('SCUS_942.28', 'COV')],
    });
    expect(existingArtTypesForGame(game, types)).toEqual(['COV']);
  });

  it('counts PS2 art by gameId unchanged', () => {
    const game = makeGame({
      system: 'PS2',
      filename: 'SLUS_208.51.iso',
      gameId: 'SLUS_208.51',
      art: [artFor('SLUS_208.51', 'COV')],
    });
    expect(existingArtTypesForGame(game, types)).toEqual(['COV']);
  });

  it('counts launcher art by boot ELF name', () => {
    const launcher = makeGame({
      system: 'APPS',
      filename: 'XX.SCUS_944.02.Game.ELF',
      gameId: 'SCUS_944.02',
      isPs1Launcher: true,
      ps1LauncherBoot: 'XX.SCUS_944.02.Game.ELF',
      art: [artFor('launcher', 'COV', 'XX.SCUS_944.02.Game.ELF_COV')],
    });
    expect(existingArtTypesForGame(launcher, ['COV'])).toEqual(['COV']);
  });
});

describe('artTargetsForScope - onlyMissing', () => {
  it('queues a title-renamed VCD whose art is only GameID-named', () => {
    const game = ps1Vcd({
      art: [artFor('SCUS_942.28', 'COV')],
    });
    const targets = artTargetsForScope([game], 'PS1', {
      onlyMissing: true,
    });
    expect(targets.length).toBe(1);
    expect(targets[0].saveAsName).toBe('Spyro the Dragon');
  });

  it('drops a VCD that already has every type under its stem', () => {
    const complete = ps1Vcd({
      art: DEFAULT_ART_TYPES.map((type) => artFor('Spyro the Dragon', type)),
    });
    expect(
      artTargetsForScope([complete], 'PS1', { onlyMissing: true }).length,
    ).toBe(0);
  });
});

describe('artTargetsForScope - PS1 canonical normalization', () => {
  const types: ArtType[] = ['COV', 'ICO'];

  it('saves art under the current VCD name and renames nothing by default', () => {
    const game = ps1Vcd({ format: 'POPS', canonicalTitle: 'SPYRO THE DRAGON' });
    const [target] = artTargetsForScope([game], 'PS1');

    expect(target.saveAsName).toBe('Spyro the Dragon');
    expect(target.normalizeKind).toBeUndefined();
    expect(target.canonicalName).toBeUndefined();
    expect(target.renameFrom).toBe('Spyro the Dragon');
  });

  it('carries the normalization request only when the user opted in', () => {
    const game = ps1Vcd({ format: 'POPS', canonicalTitle: 'SPYRO THE DRAGON' });
    const [target] = artTargetsForScope([game], 'PS1', { normalize: true });

    expect(target.normalizeKind).toBe('VCD');
    expect(target.canonicalName).toBe('SPYRO THE DRAGON');
  });

  it('never normalizes a PS1 launcher', () => {
    const launcher = makeGame({
      system: 'APPS',
      filename: 'XX.SCUS_944.02.Game.ELF',
      gameId: 'SCUS_944.02',
      isPs1Launcher: true,
      ps1LauncherBoot: 'XX.SCUS_944.02.Game.ELF',
      canonicalTitle: 'SOME CANONICAL TITLE',
    });
    const [target] = artTargetsForScope([launcher], 'APPS', { normalize: true });

    expect(target.normalizeKind).toBeUndefined();
    expect(target.canonicalName).toBeUndefined();
    expect(target.renameFrom).toBeUndefined();
  });

  it('queues a complete-art game for renaming only when normalizing', () => {
    const game = ps1Vcd({
      format: 'POPS',
      canonicalTitle: 'SPYRO THE DRAGON',
      art: [artFor('Spyro the Dragon', 'COV'), artFor('Spyro the Dragon', 'ICO')],
    });
    const opts = { onlyMissing: true, artTypes: types };

    expect(artTargetsForScope([game], 'PS1', opts).length).toBe(0);
    expect(
      artTargetsForScope([game], 'PS1', { ...opts, normalize: true }).length,
    ).toBe(1);
  });

  it('does not count canonical-title art the storage was never renamed to', () => {
    const game = ps1Vcd({
      format: 'POPS',
      canonicalTitle: 'SPYRO THE DRAGON',
      art: [
        artFor('SPYRO THE DRAGON', 'COV'),
        artFor('Spyro the Dragon', 'ICO'),
      ],
    });

    expect(existingArtTypesForGame(game, types)).toEqual(['ICO']);
  });
});

describe('artTargetsForScope - Ember canonical normalization', () => {
  function ember(overrides: Partial<Game> = {}): Game {
    return makeGame({
      system: 'PS1',
      format: 'EMBER',
      cdType: 'EMBER',
      filename: 'Spyro the Dragon',
      emberFolder: 'Spyro the Dragon',
      emberCuePath: '/ember/games/Spyro the Dragon/game.cue',
      gameId: 'SCUS_942.28',
      title: 'Spyro the Dragon',
      canonicalTitle: 'SPYRO THE DRAGON',
      ...overrides,
    });
  }

  it('normalizes the Ember folder and keeps dots in the name', () => {
    const [target] = artTargetsForScope(
      [ember({ emberFolder: 'Spyro 2. Cert of Darkness', filename: 'Spyro 2. Cert of Darkness' })],
      'PS1',
      { normalize: true },
    );

    expect(target.normalizeKind).toBe('EMBER');
    expect(target.canonicalName).toBe('SPYRO THE DRAGON');
    expect(target.renameFrom).toBe('Spyro 2. Cert of Darkness');
  });

  it('gives Ember art no GameID fallback', () => {
    const game = ember({ art: [artFor('SCUS_942.28', 'COV')] });

    expect(existingArtTypesForGame(game, ['COV'])).toEqual([]);
  });

  it('counts Ember art saved under the folder name', () => {
    const game = ember({
      art: [artFor('Spyro the Dragon', 'COV'), artFor('Spyro the Dragon', 'ICO')],
    });

    expect(existingArtTypesForGame(game, ['COV', 'ICO'])).toEqual(['COV', 'ICO']);
  });
});