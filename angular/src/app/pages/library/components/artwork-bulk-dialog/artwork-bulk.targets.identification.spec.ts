import { Game } from '@shared/types/game.type';
import { artTargetsForScope, existingArtTypesForGame } from './artwork-bulk.targets';

function ps1Vcd(filename: string, canonicalTitle?: string, art: string[] = []): Game {
  const stem = filename.replace(/\.[^.]+$/, '');
  return {
    filename,
    gameId: 'SCUS_944.25',
    cdType: 'POPS',
    title: canonicalTitle ?? stem,
    canonicalTitle,
    path: `/opl/POPS/${filename}`,
    extension: '.VCD',
    parentPath: '/opl/POPS',
    system: 'PS1',
    format: 'POPS',
    art: art.map((name) => {
      const idx = name.lastIndexOf('_');
      return {
        name,
        gameId: name.slice(0, idx),
        type: name.slice(idx + 1),
        extension: '.png',
        path: `/opl/ART/${name}.png`,
      };
    }) as Game['art'],
  };
}

describe('artTargetsForScope PS1 normalization', () => {
  const TYPES = ['COV', 'ICO'] as const;

  it('saves art under the current VCD name and renames nothing by default', () => {
    const [target] = artTargetsForScope(
      [ps1Vcd('Spyro 2.VCD', "SPYRO 2 - RIPTO'S RAGE")],
      'PS1',
    );

    expect(target.saveAsName).toBe('Spyro 2');
    expect(target.normalizeKind).toBeUndefined();
    expect(target.canonicalName).toBeUndefined();
    expect(target.renameFrom).toBe('Spyro 2');
  });

  it('carries the normalization request only when the user opted in', () => {
    const [target] = artTargetsForScope(
      [ps1Vcd('Spyro 2.VCD', "SPYRO 2 - RIPTO'S RAGE")],
      'PS1',
      { normalize: true },
    );

    expect(target.normalizeKind).toBe('VCD');
    expect(target.canonicalName).toBe("SPYRO 2 - RIPTO'S RAGE");
  });

  it('queues a complete-art game for renaming only when normalizing', () => {
    const game = ps1Vcd('Spyro 2.VCD', "SPYRO 2 - RIPTO'S RAGE", [
      'Spyro 2_COV',
      'Spyro 2_ICO',
    ]);
    const opts = { onlyMissing: true, artTypes: [...TYPES] };

    expect(artTargetsForScope([game], 'PS1', opts).length).toBe(0);
    expect(
      artTargetsForScope([game], 'PS1', { ...opts, normalize: true }).length,
    ).toBe(1);
  });

  it('does not count canonical-title art the storage was never renamed to', () => {
    const game = ps1Vcd('Spyro 2.VCD', "SPYRO 2 - RIPTO'S RAGE", [
      "SPYRO 2 - RIPTO'S RAGE_COV",
      'Spyro 2_ICO',
    ]);

    expect(existingArtTypesForGame(game, [...TYPES])).toEqual(['ICO']);
  });
});


describe('RiptOPL PS1 artwork compatibility fallbacks', () => {
  it('does not count loose GameID art for a title-only VCD', () => {
    const game = ps1Vcd('Spyro the Dragon.VCD', 'SPYRO THE DRAGON', [
      'SCUS_942.28_COV',
    ]);
    game.gameId = 'SCUS_942.28';

    expect(existingArtTypesForGame(game, ['COV'])).toEqual([]);
  });

  it('counts GameID art only when the VCD filename starts with that GameID', () => {
    const game = ps1Vcd('SCUS_942.28.Spyro the Dragon.VCD', undefined, [
      'SCUS_942.28_COV',
    ]);
    game.gameId = 'SCUS_942.28';

    expect(existingArtTypesForGame(game, ['COV'])).toEqual(['COV']);
  });

  it('does not count 3D COV3 art as the COV2 back cover', () => {
    const game = ps1Vcd('Spyro the Dragon.VCD', undefined, [
      'Spyro the Dragon_COV3',
    ]);

    expect(existingArtTypesForGame(game, ['COV2'])).toEqual([]);
  });

  it('counts a COV2 back cover saved under the storage name', () => {
    const game = ps1Vcd('Spyro the Dragon.VCD', undefined, [
      'Spyro the Dragon_COV2',
    ]);

    expect(existingArtTypesForGame(game, ['COV2'])).toEqual(['COV2']);
  });
});


describe('PS1 identification safety', () => {
  it('excludes ambiguous PS1 discs from automatic artwork targets', () => {
    const game = ps1Vcd('Alive Disc 2.VCD', 'Alive (Disc 2)');
    game.identificationStatus = 'ambiguous';

    expect(artTargetsForScope([game], 'PS1', { normalize: true })).toEqual([]);
  });

  it('keeps identified PS1 discs eligible for canonical artwork naming', () => {
    const game = ps1Vcd('Alive Disc 2.VCD', 'Alive (Disc 2)');
    game.identificationStatus = 'identified';

    const [target] = artTargetsForScope([game], 'PS1', { normalize: true });
    expect(target.saveAsName).toBe('Alive Disc 2');
    expect(target.canonicalName).toBe('Alive (Disc 2)');
  });
});
