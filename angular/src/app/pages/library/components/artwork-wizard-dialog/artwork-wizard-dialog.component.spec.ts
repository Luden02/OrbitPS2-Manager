import { TestBed, ComponentFixture } from '@angular/core/testing';
import { LucideAngularModule, icons } from 'lucide-angular';

import { ArtworkWizardDialogComponent } from './artwork-wizard-dialog.component';
import { JobsService, NewImportJob } from '@shared/services/jobs.service';
import { LibraryService } from '@shared/services/library.service';
import { ConfirmDialogService, ConfirmDialogOptions } from '@shared/services/confirm-dialog.service';
import { Game } from '@shared/types/game.type';

const GAME: Game = {
  filename: 'SLUS-12345.bin',
  gameId: 'SLUS-12345',
  cdType: 'SLUS-12345',
  title: 'Test Game',
  path: '/games/Test Game',
  extension: '.bin',
  parentPath: '/games',
  system: 'PS2',
};

const ART_DIR = '/games/Test Game/ART';

describe('ArtworkWizardDialogComponent screenshot slots', () => {
  let component: ArtworkWizardDialogComponent;
  let enqueued: NewImportJob[];
  let existingFiles: string[];
  let libraryApiBackup: unknown;

  /** Builds the component with a game whose database holds the given art types. */
  async function setup(types: string[]): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ArtworkWizardDialogComponent, LucideAngularModule.pick(icons)],
      providers: [
        { provide: JobsService, useValue: { enqueue: (jobs: NewImportJob[]) => (enqueued = jobs) } },
        { provide: LibraryService, useValue: { currentDirectoryValue: '/games/Test Game' } },
      ],
    });

    (window as unknown as { libraryAPI: unknown }).libraryAPI = {
      listAvailableArt: () =>
        Promise.resolve({
          success: true,
          data: types.map((type) => ({
            type,
            fileName: `SLUS-12345_${type}.png`,
            downloadUrl: `https://example.test/SLUS-12345_${type}.png`,
          })),
        }),
      checkArtFilesExist: (_dir: string, filenames: string[]) =>
        Promise.resolve(filenames.filter((f) => existingFiles.includes(f))),
    };

    const fixture = TestBed.createComponent(ArtworkWizardDialogComponent);
    fixture.componentRef.setInput('game', GAME);
    fixture.detectChanges();
    await fixture.whenStable();
    component = fixture.componentInstance;
    enqueued = [];
  }

  beforeEach(() => {
    existingFiles = [];
    libraryApiBackup = (window as unknown as { libraryAPI: unknown }).libraryAPI;
  });

  afterEach(() => {
    (window as unknown as { libraryAPI: unknown }).libraryAPI = libraryApiBackup;
  });

  it('saves two arbitrary screenshot picks as two different files', async () => {
    await setup(['SCR_02', 'SCR_05']);

    component.download();

    const overrides = enqueued[0].artSaveAsOverrides!;
    expect(overrides['SCR_02']).toBe('SCR');
    expect(overrides['SCR_05']).toBe('SCR2');
    expect(overrides['SCR_02']).not.toBe(overrides['SCR_05']);
  });

  it('follows the order the screenshots were picked in', async () => {
    await setup(['SCR_02', 'SCR_05']);
    component.deselectAll();

    component.toggle('SCR_05');
    component.toggle('SCR_02');
    component.download();

    const overrides = enqueued[0].artSaveAsOverrides!;
    expect(overrides['SCR_05']).toBe('SCR');
    expect(overrides['SCR_02']).toBe('SCR2');
  });

  it('badges and skip-filters on the same files it will write', async () => {
    existingFiles = ['SLUS-12345_SCR2.png'];
    await setup(['SCR_02', 'SCR_05']);
    component.deselectAll();
    component.toggle('SCR_02');
    component.toggle('SCR_05');

    // `SCR_02` takes the first slot, so the existing `SCR2.png` is `SCR_05`'s.
    expect(component.alreadySaved('SCR_02')).toBe(false);
    expect(component.alreadySaved('SCR_05')).toBe(true);
    expect(component.saveBaseFor('SCR_02')).toBe('SCR');
    expect(component.saveBaseFor('SCR_05')).toBe('SCR2');

    // "Skip existing" is on by default, so turning it off restores the selection
    // and turning it back on applies the filter.
    component.onSkipExistingToggle();
    expect(component.isSelected('SCR_02')).toBe(true);
    expect(component.isSelected('SCR_05')).toBe(true);

    component.onSkipExistingToggle();
    expect(component.isSelected('SCR_02')).toBe(true);
    expect(component.isSelected('SCR_05')).toBe(false);

    component.download();
    expect(enqueued[0].artTypes).toEqual(['SCR_02']);
    expect(enqueued[0].artSaveAsOverrides).toEqual({ SCR_02: 'SCR' });
  });

  it('counts both screenshot files as existing when both slots are filled', async () => {
    existingFiles = ['SLUS-12345_SCR.png', 'SLUS-12345_SCR2.png'];
    await setup(['SCR_02', 'SCR_05']);

    expect(component.savedCount()).toBe(2);
  });

  it('never writes both screenshots into the same file', async () => {
    existingFiles = ['SLUS-12345_SCR2.png'];
    await setup(['SCR_02', 'SCR_05']);
    // Both slots filled, so turn the skip policy off to exercise the write path.
    component.onSkipExistingToggle();

    component.download();

    const savedFiles = new Set(
      enqueued[0].artTypes!.map((type) => `SLUS-12345_${enqueued[0].artSaveAsOverrides![type] ?? type}.png`),
    );
    expect(savedFiles.size).toBe(enqueued[0].artTypes!.length);
  });

  it('keeps at most two screenshots selected even when more exist', async () => {
    await setup(['SCR_00', 'SCR_01', 'SCR_02', 'SCR_05']);
    component.selectAll();

    const chosen = [...component.selected()].filter((t) => t.startsWith('SCR'));
    expect(chosen.length).toBe(2);
  });
});

describe('ArtworkWizardDialogComponent overwrite policy', () => {
  let component: ArtworkWizardDialogComponent;
  let enqueued: NewImportJob[];
  let existingFiles: string[];
  let libraryApiBackup: unknown;

  async function setup(types: string[]): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ArtworkWizardDialogComponent, LucideAngularModule.pick(icons)],
      providers: [
        { provide: JobsService, useValue: { enqueue: (jobs: NewImportJob[]) => (enqueued = jobs) } },
        { provide: LibraryService, useValue: { currentDirectoryValue: '/games/Test Game' } },
      ],
    });

    (window as unknown as { libraryAPI: unknown }).libraryAPI = {
      listAvailableArt: () =>
        Promise.resolve({
          success: true,
          data: types.map((type) => ({
            type,
            fileName: `SLUS-12345_${type}.png`,
            downloadUrl: `https://example.test/SLUS-12345_${type}.png`,
          })),
        }),
      checkArtFilesExist: (_dir: string, filenames: string[]) =>
        Promise.resolve(filenames.filter((f) => existingFiles.includes(f))),
    };

    const fixture = TestBed.createComponent(ArtworkWizardDialogComponent);
    fixture.componentRef.setInput('game', GAME);
    fixture.detectChanges();
    await fixture.whenStable();
    component = fixture.componentInstance;
    enqueued = [];
  }

  beforeEach(() => {
    existingFiles = [];
    libraryApiBackup = (window as unknown as { libraryAPI: unknown }).libraryAPI;
  });

  afterEach(() => {
    (window as unknown as { libraryAPI: unknown }).libraryAPI = libraryApiBackup;
  });

  it('starts with skip-existing on', async () => {
    await setup(['COV', 'ICO']);

    expect(component.skipExisting()).toBe(true);
  });

  it('leaves already-on-disk types unchecked on open', async () => {
    existingFiles = ['SLUS-12345_COV.png'];
    await setup(['COV', 'ICO']);

    expect(component.isSelected('COV')).toBe(false);
    expect(component.isSelected('ICO')).toBe(true);
  });

  it('does not send overwrite on the first click for a game that already has art', async () => {
    existingFiles = ['SLUS-12345_COV.png'];
    await setup(['COV', 'ICO']);

    component.download();

    // `false` = "only the missing files", which is what the checked cards say.
    expect(enqueued[0].overwrite).toBe(false);
    expect(enqueued[0].artTypes).toEqual(['ICO']);
  });

  it('sends overwrite when the user turns the skip policy off over existing art', async () => {
    existingFiles = ['SLUS-12345_COV.png'];
    await setup(['COV', 'ICO']);
    component.onSkipExistingToggle();

    expect(component.willOverwriteSelected()).toBe(true);
    component.download();

    expect(enqueued[0].overwrite).toBe(true);
    expect(enqueued[0].artTypes).toEqual(['COV', 'ICO']);
  });

  it('never replaces a re-checked on-disk card while the skip policy is on', async () => {
    existingFiles = ['SLUS-12345_ICO.png'];
    await setup(['COV', 'ICO']);
    // `COV` is missing, `ICO` is on disk. Re-checking `ICO` must not turn this
    // into a silent replace just because a card is checked.
    component.toggle('ICO');

    expect(component.willOverwriteSelected()).toBe(false);
    component.download();

    expect(enqueued[0].overwrite).toBe(false);
    expect(enqueued[0].artTypes).toEqual(['COV']);
  });

  it('leaves overwrite unset when nothing selected is on disk', async () => {
    existingFiles = ['SLUS-12345_ICO.png'];
    await setup(['COV', 'ICO']);
    // Replace mode, but narrowed to the one type that is missing.
    component.onSkipExistingToggle();
    component.toggle('ICO');
    expect(component.skipExisting()).toBe(false);
    expect(component.savedCount()).toBe(1);
    expect(component.willOverwriteSelected()).toBe(false);

    component.download();

    expect(enqueued[0].overwrite).toBeUndefined();
    expect(enqueued[0].artTypes).toEqual(['COV']);
  });

  it('leaves overwrite unset when nothing is on disk', async () => {
    await setup(['COV', 'ICO']);
    component.onSkipExistingToggle();

    expect(component.willOverwriteSelected()).toBe(false);
    component.download();

    expect(enqueued[0].overwrite).toBeUndefined();
  });

  it('restores the full selection when the skip policy is switched back off', async () => {
    existingFiles = ['SLUS-12345_COV.png', 'SLUS-12345_ICO.png'];
    await setup(['COV', 'ICO']);
    expect(component.selectedCount()).toBe(0);

    component.onSkipExistingToggle();

    expect(component.selectedCount()).toBe(2);
  });

  it('select all does not re-check files the skip policy leaves alone', async () => {
    existingFiles = ['SLUS-12345_COV.png'];
    await setup(['COV', 'ICO', 'SCR_00']);

    component.selectAll();

    expect(component.isSelected('COV')).toBe(false);
    expect(component.isSelected('ICO')).toBe(true);
    expect(component.isSelected('SCR_00')).toBe(true);
  });

  it('does not enqueue anything when every selected type is already on disk', async () => {
    existingFiles = ['SLUS-12345_COV.png', 'SLUS-12345_ICO.png'];
    await setup(['COV', 'ICO']);

    component.download();

    expect(enqueued).toEqual([]);
  });
});

describe('ArtworkWizardDialogComponent collapsed categories', () => {
  let component: ArtworkWizardDialogComponent;
  let fixture: ComponentFixture<ArtworkWizardDialogComponent>;
  let libraryApiBackup: unknown;

  beforeEach(async () => {
    libraryApiBackup = (window as unknown as { libraryAPI: unknown }).libraryAPI;
    (window as unknown as { libraryAPI: unknown }).libraryAPI = {
      listAvailableArt: () =>
        Promise.resolve({
          success: true,
          data: ['COV', 'ICO', 'SCR_00'].map((type) => ({
            type,
            fileName: `SLUS-12345_${type}.png`,
            downloadUrl: 'https://example.test/x.png',
          })),
        }),
      checkArtFilesExist: () => Promise.resolve([]),
    };

    TestBed.configureTestingModule({
      imports: [ArtworkWizardDialogComponent, LucideAngularModule.pick(icons)],
      providers: [
        { provide: JobsService, useValue: { enqueue: () => [] } },
        { provide: LibraryService, useValue: { currentDirectoryValue: '/games/Test Game' } },
      ],
    });

    fixture = TestBed.createComponent(ArtworkWizardDialogComponent);
    fixture.componentRef.setInput('game', GAME);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  afterEach(() => {
    (window as unknown as { libraryAPI: unknown }).libraryAPI = libraryApiBackup;
  });

  /** The category header rows currently rendered, in category order. */
  function headers(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.aw-cat-header'));
  }

  it('renders every category header with the class the stylesheet targets', () => {
    expect(headers().length).toBe(component.categories().length);
    expect(headers().length).toBeGreaterThan(0);
  });

  it('starts with no header marked collapsed', () => {
    expect(headers().every((h) => !h.classList.contains('is-collapsed'))).toBe(true);
  });

  it('puts is-collapsed on the header, which is where the dashed border is styled', () => {
    const category = component.categories()[0];
    component.toggleExpanded(category);
    fixture.detectChanges();

    expect(component.isCollapsed(category.id)).toBe(true);
    expect(headers()[0].classList.contains('is-collapsed')).toBe(true);
  });

  it('leaves the other headers alone', () => {
    component.toggleExpanded(component.categories()[0]);
    fixture.detectChanges();

    const collapsed = headers().filter((h) => h.classList.contains('is-collapsed'));
    expect(collapsed.length).toBe(1);
  });

  it('drops the class again when the category is expanded', () => {
    const category = component.categories()[0];
    component.toggleExpanded(category);
    fixture.detectChanges();
    component.toggleExpanded(category);
    fixture.detectChanges();

    expect(headers()[0].classList.contains('is-collapsed')).toBe(false);
  });
});

describe('ArtworkWizardDialogComponent PS1 canonical rename warning', () => {
  let component: ArtworkWizardDialogComponent;
  let enqueued: NewImportJob[];
  let confirmCalls: ConfirmDialogOptions[];
  let confirmResult: boolean;
  let closedCount: number;
  let libraryApiBackup: unknown;

  function ps1Game(filename: string, canonicalTitle: string): Game {
    return {
      filename,
      gameId: 'SCUS_944.25',
      cdType: 'POPS',
      title: canonicalTitle,
      canonicalTitle,
      path: `/opl/POPS/${filename}`,
      extension: '.VCD',
      parentPath: '/opl/POPS',
      system: 'PS1',
      format: 'POPS',
    };
  }

  async function setup(game: Game): Promise<void> {
    enqueued = [];
    confirmCalls = [];
    closedCount = 0;

    TestBed.configureTestingModule({
      imports: [ArtworkWizardDialogComponent, LucideAngularModule.pick(icons)],
      providers: [
        { provide: JobsService, useValue: { enqueue: (jobs: NewImportJob[]) => (enqueued = jobs) } },
        { provide: LibraryService, useValue: { currentDirectoryValue: '/opl' } },
        {
          provide: ConfirmDialogService,
          useValue: {
            confirm: (options: ConfirmDialogOptions) => {
              confirmCalls.push(options);
              return Promise.resolve(confirmResult);
            },
          },
        },
      ],
    });

    (window as unknown as { libraryAPI: unknown }).libraryAPI = {
      listAvailableArt: () =>
        Promise.resolve({
          success: true,
          data: [{ type: 'COV', fileName: 'SCUS_944.25_COV.png', downloadUrl: 'https://example.test/c.png' }],
        }),
      checkArtFilesExist: () => Promise.resolve([]),
    };

    const fixture = TestBed.createComponent(ArtworkWizardDialogComponent);
    fixture.componentRef.setInput('game', game);
    fixture.detectChanges();
    await fixture.whenStable();
    component = fixture.componentInstance;
    component.closed.subscribe(() => (closedCount += 1));
    component.selectAll();
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    libraryApiBackup = (window as unknown as { libraryAPI: unknown }).libraryAPI;
  });

  afterEach(() => {
    (window as unknown as { libraryAPI: unknown }).libraryAPI = libraryApiBackup;
  });

  it('warns before renaming and queues the normalizing job on Yes', async () => {
    confirmResult = true;
    await setup(ps1Game('Spyro 2.VCD', 'SPYRO 2'));

    component.download();
    expect(enqueued.length).toBe(0);
    await settle();

    expect(confirmCalls.length).toBe(1);
    expect(confirmCalls[0].confirmLabel).toBe('Yes');
    expect(confirmCalls[0].cancelLabel).toBe('No');
    expect(confirmCalls[0].detail).toBe('Spyro 2 → SPYRO 2');
    expect(enqueued.length).toBe(1);
    expect(enqueued[0].normalizeKind).toBe('VCD');
    expect(enqueued[0].canonicalName).toBe('SPYRO 2');
    expect(closedCount).toBe(1);
  });

  it('queues nothing and stays open on No', async () => {
    confirmResult = false;
    await setup(ps1Game('Spyro 2.VCD', 'SPYRO 2'));

    component.download();
    await settle();

    expect(enqueued.length).toBe(0);
    expect(closedCount).toBe(0);
  });

  it('does not warn when the VCD already has its canonical name', async () => {
    confirmResult = true;
    await setup(ps1Game('SPYRO 2.VCD', 'SPYRO 2'));

    component.download();

    expect(confirmCalls.length).toBe(0);
    expect(enqueued.length).toBe(1);
  });
});
