import { Game } from '@shared/types/game.type';
import {
  ps1ArtworkIdentities,
  ps1CanonicalRename,
  ps1CanonicalStorageName,
  ps1StorageIdentity,
  ps1VcdStorageIdentity,
} from './ps1-artwork-identities';

function makeGame(partial: Partial<Game> & { filename: string }): Game {
  return {
    gameId: 'SLUS_000.01',
    cdType: 'VCD',
    path: '',
    extension: '',
    parentPath: '',
    ...partial,
  } as Game;
}

function makeEmber(partial: Partial<Game> = {}): Game {
  return makeGame({
    system: 'PS1',
    format: 'EMBER',
    filename: "SPYRO 2 - RIPTO'S RAGE",
    emberFolder: "SPYRO 2 - RIPTO'S RAGE",
    gameId: 'SCUS_944.25',
    ...partial,
  });
}

describe('ps1ArtworkIdentities', () => {
  it('returns the VCD filename stem for a PS1 VCD', () => {
    expect(
      ps1VcdStorageIdentity(
        makeGame({ system: 'PS1', filename: 'Spyro the Dragon.VCD' }),
      ),
    ).toBe('Spyro the Dragon');
  });

  it('is empty for non-PS1 games (PS2, APPS launchers)', () => {
    expect(
      ps1ArtworkIdentities(
        makeGame({ system: 'PS2', filename: 'SLUS_208.51.iso' }),
      ),
    ).toEqual([]);
    expect(
      ps1ArtworkIdentities(
        makeGame({
          system: 'APPS',
          filename: 'XX.SCUS_944.02.Game.ELF',
          isPs1Launcher: true,
        }),
      ),
    ).toEqual([]);
  });

  it('drops the GameID fallback when the stem was renamed away from it', () => {
    const game = makeGame({
      system: 'PS1',
      filename: 'Spyro the Dragon.VCD',
      gameId: 'SCUS_942.28',
    });
    expect(ps1ArtworkIdentities(game)).toEqual(['Spyro the Dragon']);
  });

  it('keeps the GameID only when the stem itself starts with it', () => {
    const game = makeGame({
      system: 'PS1',
      filename: 'SCUS_942.28.Spyro.VCD',
      gameId: 'SCUS_942.28',
    });
    expect(ps1ArtworkIdentities(game)).toEqual([
      'SCUS_942.28.Spyro',
      'SCUS_942.28',
    ]);
  });

  it('deduplicates when the stem equals the GameID', () => {
    const game = makeGame({
      system: 'PS1',
      filename: 'SLUS_000.01.VCD',
      gameId: 'SLUS_000.01',
    });
    expect(ps1ArtworkIdentities(game)).toEqual(['SLUS_000.01']);
  });

  it('is empty when the PS1 VCD has no filename', () => {
    const game = makeGame({ system: 'PS1', filename: '' });
    expect(ps1ArtworkIdentities(game)).toEqual([]);
  });
});

describe('ps1StorageIdentity', () => {
  it('uses the Ember folder verbatim, dots included', () => {
    const game = makeEmber({ emberFolder: 'Wipeout 3. Special Edition' });
    expect(ps1StorageIdentity(game)).toBe('Wipeout 3. Special Edition');
    expect(ps1VcdStorageIdentity(game)).toBe('Wipeout 3. Special Edition');
  });

  it('keeps the Ember folder as the only artwork identity', () => {
    const game = makeEmber({ emberFolder: 'SCUS_944.25 Spyro' });
    expect(ps1ArtworkIdentities(game)).toEqual(['SCUS_944.25 Spyro']);
  });
});

describe('ps1CanonicalStorageName', () => {
  it('is undefined without a canonical title', () => {
    expect(ps1CanonicalStorageName(makeEmber())).toBeUndefined();
  });

  it('is undefined for a POPStarter launcher row', () => {
    const game = makeGame({
      system: 'PS1',
      filename: 'SCUS_944.25.Spyro 2.VCD',
      canonicalTitle: 'SPYRO 2 - RIPTO’S RAGE',
      isPs1Launcher: true,
    });
    expect(ps1CanonicalStorageName(game)).toBeUndefined();
  });

  it('sanitizes the canonical title to a legal storage name', () => {
    expect(
      ps1CanonicalStorageName(
        makeEmber({ canonicalTitle: 'Spyro 2: Ripto’s Rage?' }),
      ),
    ).toBe('Spyro 2 Ripto’s Rage');
  });
});

describe('ps1CanonicalRename', () => {
  it('returns the rename when storage differs from the canonical name', () => {
    expect(
      ps1CanonicalRename(
        makeEmber({
          emberFolder: 'Spyro 2',
          filename: 'Spyro 2',
          canonicalTitle: "SPYRO 2 - RIPTO'S RAGE",
        }),
      ),
    ).toEqual({ from: 'Spyro 2', to: "SPYRO 2 - RIPTO'S RAGE" });
  });

  it('returns undefined when storage already matches the canonical name', () => {
    expect(
      ps1CanonicalRename(
        makeEmber({ canonicalTitle: "SPYRO 2 - RIPTO'S RAGE" }),
      ),
    ).toBeUndefined();
  });
});