import { TestBed } from '@angular/core/testing';
import { filter, firstValueFrom, take, toArray } from 'rxjs';

import { JobsService, ImportJob, NewImportJob } from './jobs.service';
import { LogsService } from './logs.service';
import { LibraryService } from './library.service';
import { ConfirmDialogService } from './confirm-dialog.service';

const ART_DIR = '/games/Test Game/ART';

interface ArtResult {
  type: string;
  source?: string;
  url?: string;
  savedPath?: string;
  error?: string;
}

/** Cover written, screenshot missing from the database. */
const PARTIAL: ArtResult[] = [
  { type: 'COV', source: 'COV', url: 'u', savedPath: `${ART_DIR}/SLUS-12345_COV.png` },
  { type: 'SCR', error: 'Failed to download SLUS-12345_SCR.png: 404' },
];

const COMPLETE: ArtResult[] = [
  { type: 'COV', savedPath: `${ART_DIR}/SLUS-12345_COV.png` },
  { type: 'SCR', savedPath: `${ART_DIR}/SLUS-12345_SCR.png` },
];

const NONE: ArtResult[] = [
  { type: 'COV', error: 'Failed to download SLUS-12345_COV.png: 404' },
  { type: 'SCR', error: 'Failed to download SLUS-12345_SCR.png: 404' },
];

describe('JobsService artwork job results', () => {
  let service: JobsService;
  let updateArtForGame: string[];
  let updateArtForGames: string[][];
  let refreshGamesFiles: number;
  let existing: string[];
  let downloadImpl: () => Promise<any>;
  let normalizeImpl: () => Promise<any>;
  let confirmResult: boolean;
  let libraryApiBackup: unknown;

  /** Resolves once the job has left the queue/running state. */
  function settled(id: string): Promise<ImportJob> {
    return firstValueFrom(
      service.jobs$.pipe(
        filter((jobs) => {
          const job = jobs.find((j) => j.id === id);
          return !!job && job.status !== 'queued' && job.status !== 'running';
        }),
        take(1),
        toArray(),
      ),
    ).then(([jobs]) => jobs.find((j) => j.id === id)!);
  }

  async function run(overrides: Partial<NewImportJob> = {}): Promise<ImportJob> {
    const [job] = service.enqueue([
      {
        type: 'artwork',
        label: 'Test Game',
        filePath: '/games/Test Game',
        gameId: 'SLUS-12345',
        gameName: 'Test Game',
        downloadArtwork: false,
        system: 'PS2',
        artTypes: ['COV', 'SCR'],
        overwrite: false,
        ...overrides,
      } as NewImportJob,
    ]);
    return settled(job.id);
  }

  beforeEach(() => {
    updateArtForGame = [];
    updateArtForGames = [];
    refreshGamesFiles = 0;
    existing = [];
    downloadImpl = () => Promise.resolve({ success: true, data: COMPLETE });
    normalizeImpl = () => Promise.resolve({ success: true, changed: false });
    confirmResult = true;

    TestBed.configureTestingModule({
      providers: [
        JobsService,
        {
          provide: LogsService,
          useValue: { log: () => { }, error: () => { }, warn: () => { } },
        },
        {
          provide: LibraryService,
          useValue: {
            currentDirectoryValue: '/games/Test Game',
            updateArtForGame: (id: string) => {
              updateArtForGame.push(id);
              return Promise.resolve();
            },
            updateArtForGames: (ids: string[]) => {
              updateArtForGames.push(ids);
              return Promise.resolve();
            },
            refreshGamesFiles: () => {
              refreshGamesFiles += 1;
            },
          },
        },
        {
          provide: ConfirmDialogService,
          useValue: { confirm: () => Promise.resolve(confirmResult) },
        },
      ],
    });

    libraryApiBackup = (window as unknown as { libraryAPI: unknown }).libraryAPI;
    (window as unknown as { libraryAPI: unknown }).libraryAPI = {
      checkArtFilesExist: (_dir: string, files: string[]) =>
        Promise.resolve(files.filter((f) => existing.includes(f))),
      downloadArtByGameId: () => downloadImpl(),
      normalizeRiptOplPs1Storage: () => normalizeImpl(),
    };

    service = TestBed.inject(JobsService);
  });

  afterEach(() => {
    (window as unknown as { libraryAPI: unknown }).libraryAPI = libraryApiBackup;
  });

  it('still reports success when some types were written and others were not', async () => {
    downloadImpl = () => Promise.resolve({ success: true, data: PARTIAL });

    const job = await run();

    expect(job.status).toBe('success');
  });

  it('names the missing types instead of reporting a clean download', async () => {
    downloadImpl = () => Promise.resolve({ success: true, data: PARTIAL });

    const job = await run();

    expect(job.message).toContain('partially downloaded');
    expect(job.message).toContain('1 of 2');
    expect(job.message).toContain('SCR');
    expect(job.message).not.toBe('Artwork downloaded.');
  });

  it('logs the partial summary as an error, not a success', async () => {
    downloadImpl = () => Promise.resolve({ success: true, data: PARTIAL });

    const job = await run();

    const last = job.logs![job.logs!.length - 1];
    expect(last.type).toBe('error');
    expect(last.text).toContain('partially downloaded');
  });

  it('uses the overwrite wording when the run replaced files', async () => {
    existing = ['SLUS-12345_COV.png'];
    downloadImpl = () => Promise.resolve({ success: true, data: PARTIAL });

    const job = await run({ overwrite: true });

    expect(job.message).toContain('partially overwritten');
  });

  it('still queues the game for an art refresh after a partial run', async () => {
    downloadImpl = () => Promise.resolve({ success: true, data: PARTIAL });

    await run();
    // The deferred flush happens on the tick after the queue drains.
    await new Promise((r) => setTimeout(r, 5));

    expect(updateArtForGame).toEqual(['SLUS-12345']);
    expect(refreshGamesFiles).toBe(0);
  });

  it('reports a fully clean run without the partial wording', async () => {
    downloadImpl = () => Promise.resolve({ success: true, data: COMPLETE });

    const job = await run();

    expect(job.status).toBe('success');
    expect(job.message).toBe('Artwork downloaded.');
    expect(job.logs![job.logs!.length - 1].type).toBe('success');
  });

  it('fails the job when nothing at all was written', async () => {
    downloadImpl = () => Promise.resolve({ success: false, data: NONE });

    const job = await run();

    expect(job.status).toBe('error');
    expect(job.message).toContain('No artwork found');
  });

  describe('after RiptOPL storage normalization', () => {
    const PS1_JOB: Partial<NewImportJob> = {
      system: 'PS1',
      filePath: '/opl/POPS/Spyro 2.VCD',
      saveAsName: 'Spyro 2',
      normalizeKind: 'VCD',
      canonicalName: 'SPYRO 2',
      artTypes: ['COV'],
      overwrite: undefined,
    };

    it('re-scans the library when the overwrite prompt is cancelled after a rename', async () => {
      normalizeImpl = () =>
        Promise.resolve({ success: true, changed: true, localName: 'SPYRO 2' });
      existing = ['SPYRO 2_COV.png'];
      confirmResult = false;

      const job = await run(PS1_JOB);
      await new Promise((r) => setTimeout(r, 5));

      expect(job.status).toBe('cancelled');
      expect(refreshGamesFiles).toBe(1);
    });

    it('batches multiple normalized artwork jobs into one full rescan', async () => {
      normalizeImpl = () =>
        Promise.resolve({ success: true, changed: true, localName: 'SPYRO 2' });
      downloadImpl = () => Promise.resolve({ success: true, data: COMPLETE });

      const jobs = service.enqueue([
        {
          type: 'artwork',
          label: 'Disc A',
          filePath: '/opl/POPS/A.VCD',
          gameId: 'SLUS-00001',
          gameName: 'A',
          downloadArtwork: false,
          system: 'PS1',
          normalizeKind: 'VCD',
          canonicalName: 'A',
          artTypes: ['COV'],
        } as NewImportJob,
        {
          type: 'artwork',
          label: 'Disc B',
          filePath: '/opl/POPS/B.VCD',
          gameId: 'SLUS-00002',
          gameName: 'B',
          downloadArtwork: false,
          system: 'PS1',
          normalizeKind: 'VCD',
          canonicalName: 'B',
          artTypes: ['COV'],
        } as NewImportJob,
      ]);

      await Promise.all(jobs.map((job) => settled(job.id)));
      await new Promise((r) => setTimeout(r, 10));

      expect(refreshGamesFiles).toBe(1);
      expect(updateArtForGame).toEqual([]);
      expect(updateArtForGames).toEqual([]);
    });

    it('does not re-scan on cancel when nothing was renamed', async () => {
      normalizeImpl = () =>
        Promise.resolve({ success: true, changed: false, localName: 'SPYRO 2' });
      existing = ['SPYRO 2_COV.png'];
      confirmResult = false;

      const job = await run(PS1_JOB);

      expect(job.status).toBe('cancelled');
      expect(refreshGamesFiles).toBe(0);
    });
  });
});
