import {
  sanitizeGameFilename,
  sanitizeRiptOplPs1StorageName,
} from './sanitize-game-filename';

describe('sanitizeGameFilename', () => {
  it('matches the storage-safe canonical naming rules', () => {
    expect(sanitizeGameFilename('Game: Subtitle?')).toBe('Game Subtitle');
    expect(sanitizeGameFilename('  Spyro   2  ')).toBe('Spyro 2');
    expect(sanitizeGameFilename('CON')).toBe('CON_');
  });
});


describe('sanitizeRiptOplPs1StorageName', () => {
  it('avoids the reserved POPSTARTER.VCD basename', () => {
    expect(sanitizeRiptOplPs1StorageName('POPSTARTER', 'VCD')).toBe('POPSTARTER_');
  });

  it('caps VCD identities at 160 UTF-8 bytes', () => {
    const result = sanitizeRiptOplPs1StorageName('é'.repeat(100), 'VCD');
    expect(new TextEncoder().encode(result).length).toBe(160);
  });

  it('caps Ember folder identities at 180 UTF-8 bytes', () => {
    const result = sanitizeRiptOplPs1StorageName('é'.repeat(100), 'EMBER');
    expect(new TextEncoder().encode(result).length).toBe(180);
  });
});