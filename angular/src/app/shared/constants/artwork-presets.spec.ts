import {
  artCategoryForType,
  artFileForType,
  artSaveNameCandidates,
  artSaveNamesForSelection,
  isScreenshotArtCode,
} from './artwork-presets';

describe('artSaveNamesForSelection', () => {
  it('hands the two OPL screenshot slots out by selection order', () => {
    const saveNames = artSaveNamesForSelection(['SCR_00', 'SCR_01']);

    expect(saveNames.get('SCR_00')).toBe('SCR');
    expect(saveNames.get('SCR_01')).toBe('SCR2');
  });

  it('gives two arbitrary screenshot picks two different files', () => {
    // Regression: the old index-based rule mapped every `SCR_0n` other than
    // `SCR_00` to `SCR2`, so this pair both wrote `GAMEID_SCR2.png` and the
    // second buffer overwrote the first — `GAMEID_SCR.png` was never created.
    const saveNames = artSaveNamesForSelection(['SCR_02', 'SCR_05']);

    expect(saveNames.get('SCR_02')).toBe('SCR');
    expect(saveNames.get('SCR_05')).toBe('SCR2');
    expect(new Set(saveNames.values()).size).toBe(2);
  });

  it('swaps the slots when the picks are made in the other order', () => {
    const saveNames = artSaveNamesForSelection(['SCR_05', 'SCR_02']);

    expect(saveNames.get('SCR_05')).toBe('SCR');
    expect(saveNames.get('SCR_02')).toBe('SCR2');
  });

  it('gives a lone screenshot pick the first slot', () => {
    expect(artSaveNamesForSelection(['SCR_03']).get('SCR_03')).toBe('SCR');
  });

  it('treats the classic slot codes as screenshots too', () => {
    const saveNames = artSaveNamesForSelection(['SCR', 'SCR2']);

    expect(saveNames.get('SCR')).toBe('SCR');
    expect(saveNames.get('SCR2')).toBe('SCR2');
  });

  it('repeats the last slot past the second screenshot', () => {
    const saveNames = artSaveNamesForSelection(['SCR_00', 'SCR_01', 'SCR_07']);

    expect(saveNames.get('SCR_07')).toBe('SCR2');
  });

  it('collapses every background variant onto the one file OPL reads', () => {
    const saveNames = artSaveNamesForSelection(['BG_00', 'BG_03']);

    expect(saveNames.get('BG_00')).toBe('BG');
    expect(saveNames.get('BG_03')).toBe('BG');
  });

  it('leaves other types on their own code', () => {
    const saveNames = artSaveNamesForSelection(['COV', 'COV2', 'ICO', 'LGO']);

    expect(saveNames.get('COV')).toBe('COV');
    expect(saveNames.get('COV2')).toBe('COV2');
    expect(saveNames.get('ICO')).toBe('ICO');
    expect(saveNames.get('LGO')).toBe('LGO');
  });

  it('does not let other families consume a screenshot slot', () => {
    const saveNames = artSaveNamesForSelection(['COV', 'SCR_02', 'ICO', 'SCR_05']);

    expect(saveNames.get('SCR_02')).toBe('SCR');
    expect(saveNames.get('SCR_05')).toBe('SCR2');
  });
});

describe('artSaveNameCandidates', () => {
  it('offers both screenshot slots as candidates', () => {
    expect(artSaveNameCandidates('SCR_05')).toEqual(['SCR', 'SCR2']);
  });

  it('offers a single candidate for everything else', () => {
    expect(artSaveNameCandidates('BG_02')).toEqual(['BG']);
    expect(artSaveNameCandidates('COV')).toEqual(['COV']);
  });
});

describe('isScreenshotArtCode', () => {
  it('recognises indexed and classic screenshot codes', () => {
    expect(isScreenshotArtCode('SCR')).toBe(true);
    expect(isScreenshotArtCode('SCR2')).toBe(true);
    expect(isScreenshotArtCode('SCR_00')).toBe(true);
    expect(isScreenshotArtCode('SCR_05')).toBe(true);
  });

  it('rejects other types', () => {
    expect(isScreenshotArtCode('BG_00')).toBe(false);
    expect(isScreenshotArtCode('COV')).toBe(false);
    expect(isScreenshotArtCode('LGO')).toBe(false);
  });
});

describe('artFileForType', () => {
  it('keeps OPL assets flat under ART/', () => {
    expect(artFileForType('COV', 'SLUS_200.01')).toBe('SLUS_200.01_COV.png');
  });

  it('honours the save-name override for an indexed OPL code', () => {
    expect(artFileForType('SCR_05', 'SLUS_200.01', 'SCR2')).toBe(
      'SLUS_200.01_SCR2.png',
    );
  });

  it('puts the LUNA square cover in its own folder with no type suffix', () => {
    expect(artFileForType('PSBBN', 'SLUS_200.01')).toBe(
      'PSBBN/SLUS_200.01.png',
    );
  });

  it('keeps the scroll logo apart from the flat OPL logo', () => {
    expect(artFileForType('SCROLL', 'SLUS_200.01')).toBe(
      'SCROLL/SLUS_200.01_LGO.png',
    );
    expect(artFileForType('LGO', 'SLUS_200.01')).toBe('SLUS_200.01_LGO.png');
  });
});

describe('artCategoryForType', () => {
  it('still groups indexed database variants by prefix', () => {
    expect(artCategoryForType('SCR_05')).toBe('screenshots');
    expect(artCategoryForType('BG_02')).toBe('backgrounds');
  });

  it('does not read SCROLL as a screenshot because of its prefix', () => {
    expect(artCategoryForType('SCROLL')).toBe('luna');
    expect(artCategoryForType('PSBBN')).toBe('luna');
  });
});
