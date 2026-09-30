import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { LogsService } from './logs.service';
import { LibraryService } from './library.service';
import { ConfirmDialogService } from './confirm-dialog.service';

/** A single line of progress shown in a job's live log. */
export type JobLogType = 'info' | 'step' | 'success' | 'error';
export interface JobLogEntry {
  id: number;
  time: string;
  text: string;
  type: JobLogType;
}

export type ImportJobType =
  | 'ps2-dvd'
  | 'ps2-cd'
  | 'ps1'
  | 'zso'
  | 'zso-to-iso'
  | 'vcd-to-bin'
  | 'apps'
  | 'artwork'
  | 'rename'
  | 'ps1-convert-popsloader'
  | 'ps1-convert-popstarter';
export type JobStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'error'
  | 'cancelled';

export interface ImportJob {
  id: string;
  type: ImportJobType;
  /** Human-friendly label for the job (game name or id, falls back to filename). */
  label: string;
  filePath: string;
  gameId: string;
  gameName: string;
  downloadArtwork: boolean;
  /** PS1 only: POPStarter device prefix (e.g. "XX." / "SB."). */
  elfPrefix?: string;
  /**
   * PS1 only: launcher style. "popstarter" (default) creates an APPS
   * launcher and names the VCD "<GameID>.<Title>.VCD"; "popsloader" skips
   * the launcher entirely and names the VCD just "<Title>.VCD".
   */
  launcherMode?: 'popstarter' | 'popsloader';
  /** Artwork only: which art database to pull from (defaults to PS2). */
  system?: 'PS1' | 'PS2';
  /**
   * Artwork only: per-type override of the saved file's base name. The URL is
   * still fetched from the code (`BG_00`), but the file is written as
   * `<localName>_<base>.png`, e.g. `BG_00` → `BG`, so OPL reads it as
   * `<gameID>_BG.png`.
   */
  artSaveAsOverrides?: Record<string, string>;
  /**
   * ZSO/zso-to-iso/vcd-to-bin only: remove the source file once the
   * conversion succeeds.
   */
  deleteOriginal?: boolean;
  /**
   * PS2 DVD only: use OPL's "new" naming convention — rename to just
   * "<Title>.iso" without the GAMEID. prefix (OPL reads the ID from
   * SYSTEM.CNF).
   */
  keepOriginalName?: boolean;
  /**
   * Artwork only: overrides the local filename stem (sans _COV.png suffix).
   * For PS1 launcher apps this is the boot ELF name (e.g.
   * "XX.SCUS_944.02.SomeGame.ELF") so the saved file matches the art
   * matching logic in updateArtForGame.
   */
  saveAsName?: string;
  /**
   * Artwork only, RiptOPL PS1: the storage identity that must be normalized to
   * `canonicalName` before the art files are written. RiptOPL resolves PS1 art
   * by the on-disk VCD/Ember name, so art has to land under the final name.
   */
  normalizeKind?: 'VCD' | 'EMBER';
  /** Artwork only: RiptOPL-safe PS1 storage name to normalize to before download. */
  canonicalName?: string;
  /**
   * Artwork only: whether to overwrite existing art files. When `false` only
   * the missing files are fetched. When `undefined` (single-game fetch) a
   * confirmation dialog is shown before touching existing files.
   */
  overwrite?: boolean;
  /** Artwork only: which art types to fetch (defaults to COV, ICO, SCR). */
  artTypes?: string[];
  /**
   * Artwork only: also accept the remaining indexed variants of a family when
   * the requested slot's own candidates are missing (used by the bulk dialog).
   * A game whose database only holds e.g. `SCR_05` still gets its `SCR` slot
   * filled, and the file is saved under the canonical OPL name.
   */
  wideSlotFallback?: boolean;
  status: JobStatus;
  percent: number;
  stage: string;
  message?: string;
  createdAt: number;
  finishedAt?: number;
  /** Live per-job progress lines (drives the artwork bulk-dialog log). */
  logs?: JobLogEntry[];
}

export type NewImportJob = Omit<
  ImportJob,
  'id' | 'status' | 'percent' | 'stage' | 'message' | 'createdAt' | 'finishedAt'
>;

/**
 * Owns the import queue. Jobs are processed one at a time (sequentially) — the
 * underlying IPC progress channels are global and unscoped, and serial disk I/O
 * avoids thrashing, so a single in-flight job keeps progress attribution clean.
 */
@Injectable({
  providedIn: 'root',
})
export class JobsService {
  private jobsSubject = new BehaviorSubject<ImportJob[]>([]);
  public get jobs$(): Observable<ImportJob[]> {
    return this.jobsSubject.asObservable();
  }

  public get activeCount$(): Observable<number> {
    return this.jobs$.pipe(
      map(
        (jobs) =>
          jobs.filter((j) => j.status === 'queued' || j.status === 'running')
            .length,
      ),
    );
  }

  private isProcessing = false;

  /** Game ids of successful artwork jobs awaiting a single batched refresh.
   *  The bulk flow queues one job per game; instead of re-reading the whole
   *  ART folder for every finished game, the ids are accumulated here and
   *  flushed once the whole queue drains. */
  private pendingArtRefresh = new Set<string>();

  constructor(
    private readonly _logger: LogsService,
    private readonly _library: LibraryService,
    private readonly _confirm: ConfirmDialogService,
  ) { }

  /** Queue one or more imports and kick the worker if idle. */
  public enqueue(jobs: NewImportJob[]): ImportJob[] {
    const created: ImportJob[] = jobs.map((job) => ({
      ...job,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'queued',
      percent: 0,
      stage: 'Queued',
      createdAt: Date.now(),
    }));
    this.jobsSubject.next([...this.jobsSubject.value, ...created]);
    this._logger.log('jobsService', `Queued ${created.length} import job(s)`);
    void this.processNext();
    return created;
  }

  /** Remove finished (success/error) jobs from the list. */
  public clearFinished(): void {
    this.jobsSubject.next(
      this.jobsSubject.value.filter(
        (j) => j.status === 'queued' || j.status === 'running',
      ),
    );
  }

  /** Remove a single finished or queued (not running) job. */
  public removeJob(id: string): void {
    this.jobsSubject.next(
      this.jobsSubject.value.filter(
        (j) => j.id !== id || j.status === 'running',
      ),
    );
  }

  private patchJob(id: string, patch: Partial<ImportJob>): void {
    this.jobsSubject.next(
      this.jobsSubject.value.map((j) => (j.id === id ? { ...j, ...patch } : j)),
    );
  }

  /** Append a live progress line to a job's log. */
  private logJob(id: string, text: string, type: JobLogType = 'info'): void {
    const now = new Date();
    this.jobsSubject.next(
      this.jobsSubject.value.map((j) =>
        j.id === id
          ? {
            ...j,
            logs: [
              ...(j.logs ?? []),
              {
                id: j.logs?.length ?? 0,
                time: now.toLocaleTimeString('en-US', { hour12: false }),
                text,
                type,
              },
            ],
          }
          : j,
      ),
    );
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing) {
      return;
    }
    const next = this.jobsSubject.value.find((j) => j.status === 'queued');
    if (!next) {
      // Queue drained — flush any deferred artwork refresh in a single scan.
      this.flushPendingArtRefresh();
      return;
    }

    this.isProcessing = true;
    this.patchJob(next.id, {
      status: 'running',
      stage: 'Starting…',
      percent: 0,
    });

    try {
      const result = await this.runJob(next);
      if (result?.cancelled) {
        this.patchJob(next.id, {
          status: 'cancelled',
          percent: 100,
          stage: 'Cancelled',
          finishedAt: Date.now(),
        });
        this._logger.log('jobsService', `Job cancelled: ${next.label}`);
      } else if (result?.success) {
        this.patchJob(next.id, {
          status: 'success',
          percent: 100,
          stage: 'Completed',
          message: result?.message,
          finishedAt: Date.now(),
        });
        this._logger.log('jobsService', `Job succeeded: ${next.label}`);
        // Artwork only touches one game's images — defer the refresh until the
        // queue drains so the whole `/ART` folder is scanned once per run
        // (bulk flows queue one job per game and would re-read it every time).
        // Everything else changes the file set on disk and needs a full
        // re-scan, which supersedes any pending artwork refresh.
        if (next.type === 'artwork' && result?.artRefresh !== false) {
          this.pendingArtRefresh.add(next.gameId);
        } else {
          this.pendingArtRefresh.clear();
          this._library.refreshGamesFiles();
        }
      } else {
        this.patchJob(next.id, {
          status: 'error',
          stage: 'Failed',
          message: result?.message || 'Import failed',
          finishedAt: Date.now(),
        });
        this._logger.error(
          'jobsService',
          `Job failed for ${next.label} (${next.type}): ${result?.message}`,
        );
      }
    } catch (error: any) {
      this.patchJob(next.id, {
        status: 'error',
        stage: 'Failed',
        message: error?.message || String(error),
        finishedAt: Date.now(),
      });
      this._logger.error(
        'jobsService',
        `Job threw for ${next.label} (${next.type}): ${error?.message || error}`,
      );
    } finally {
      this.isProcessing = false;
      // Process the rest of the queue on the next tick.
      setTimeout(() => void this.processNext(), 0);
    }
  }

  /** Batch-refresh artwork for all games finished since the last flush, with a
   *  single `/ART` folder scan instead of one per game. */
  private flushPendingArtRefresh(): void {
    if (this.pendingArtRefresh.size === 0) return;
    const gameIds = [...this.pendingArtRefresh];
    this.pendingArtRefresh.clear();
    if (gameIds.length === 1) {
      void this._library.updateArtForGame(gameIds[0]);
    } else {
      void this._library.updateArtForGames(gameIds);
    }
  }

  private async runJob(job: ImportJob): Promise<{
    success: boolean;
    message?: string;
    artRefresh?: boolean;
    cancelled?: boolean;
  }> {
    const dirPath = this._library.currentDirectoryValue;
    if (!dirPath) {
      return { success: false, message: 'No library directory mounted.' };
    }

    switch (job.type) {
      case 'ps2-cd':
        return this.runPs2CdJob(job, dirPath);
      case 'ps1':
        return this.runPs1Job(job, dirPath);
      case 'zso':
        return this.runZsoJob(job);
      case 'zso-to-iso':
        return this.runZsoToIsoJob(job);
      case 'vcd-to-bin':
        return this.runVcdToBinJob(job);
      case 'apps':
        return this.runAppsJob(job, dirPath);
      case 'artwork':
        return this.runArtworkJob(job, dirPath);
      case 'rename':
        return this.runRenameJob(job);
      case 'ps1-convert-popsloader':
        return this.runPs1ConvertPopsLoaderJob(job);
      case 'ps1-convert-popstarter':
        return this.runPs1ConvertPopstarterJob(job);
      case 'ps2-dvd':
      default:
        return this.runPs2DvdJob(job, dirPath);
    }
  }

  private async runAppsJob(job: ImportJob, dirPath: string) {
    this.patchJob(job.id, { stage: 'Copying ELF…', percent: 50 });
    return window.libraryAPI.importApp(dirPath, job.filePath, job.gameName);
  }

  private async runArtworkJob(job: ImportJob, dirPath: string) {
    const artDir = `${dirPath}/ART`;
    let saveAsName = job.saveAsName;
    let normalizedStorage = false;

    if (job.normalizeKind && job.canonicalName) {
      this.logJob(
        job.id,
        `Normalizing RiptOPL ${job.normalizeKind} identity to "${job.canonicalName}"…`,
        'step',
      );
      const normalized = await window.libraryAPI.normalizeRiptOplPs1Storage({
        kind: job.normalizeKind,
        sourcePath: job.filePath,
        gameId: job.gameId,
        canonicalTitle: job.canonicalName,
        artDir,
      });
      if (!normalized?.success) {
        return {
          success: false,
          artRefresh: normalizedStorage ? false : undefined,
          message: normalized?.message || 'Failed to normalize RiptOPL PS1 storage identity.',
        };
      }
      normalizedStorage = !!normalized.changed;
      saveAsName = normalized.localName || saveAsName;
      if (normalized.changed) {
        this.logJob(job.id, `Storage identity renamed to "${saveAsName}"`, 'success');
      }
    }

    const localName = saveAsName || job.gameId;
    const artSaveOverrides = job.artSaveAsOverrides ?? {};
    const types = job.artTypes?.length ? job.artTypes : ['COV', 'ICO', 'SCR'];
    const artTargets = types.map((type) => ({
      type,
      file: `${localName}_${artSaveOverrides[type] ?? type}.png`,
    }));

    this.logJob(
      job.id,
      `Checking existing artwork for "${job.label}"…`,
      'step',
    );
    this.patchJob(job.id, { stage: 'Checking existing artwork…', percent: 10 });

    const existing = await window.libraryAPI.checkArtFilesExist(
      artDir,
      artTargets.map((t) => t.file),
    );

    // Single-game fetch (no policy set by the caller): confirm before touching
    // existing files. Bulk flows pass an explicit overwrite policy instead, so
    // no per-game dialog is shown.
    let isOverwrite = job.overwrite === true;

    if (existing.length > 0 && job.overwrite === undefined) {
      this.logJob(
        job.id,
        `Artwork already exists (${existing.join(', ')}) — requesting overwrite confirmation`,
        'info',
      );
      const confirmed = await this._confirm.confirm({
        title: 'Overwrite Artwork',
        message: `Artwork already exists for "${job.label}". Overwrite?`,
        detail: existing.join('\n'),
        confirmLabel: 'Overwrite',
      });
      if (!confirmed) {
        this.logJob(job.id, 'Skipped — existing files left untouched', 'info');
        return {
          success: false,
          cancelled: true,
          // Storage may already have been renamed above; the library must
          // re-scan or it keeps pointing at the old VCD/folder path.
          artRefresh: normalizedStorage ? false : undefined,
          message: 'Cancelled by user.',
        };
      }
      isOverwrite = true;
    }

    // With a "missing only" policy, download just the files that are absent.
    const toDownload = isOverwrite
      ? artTargets
      : artTargets.filter((t) => !existing.includes(t.file));

    if (!isOverwrite) {
      for (const t of artTargets) {
        if (existing.includes(t.file)) {
          this.logJob(job.id, `${t.type} already exists — skipped`, 'info');
        }
      }
    }

    if (toDownload.length === 0) {
      this.logJob(job.id, 'Already up to date', 'success');
      return {
        success: true,
        message: 'Artwork already up to date.',
        artRefresh: normalizedStorage ? false : undefined,
      };
    }

    this.logJob(
      job.id,
      `Downloading ${toDownload.map((t) => t.type).join(', ')}…`,
      'step',
    );
    this.patchJob(job.id, { stage: 'Downloading artwork…', percent: 50 });

    const typeCodes = toDownload.map((t) => t.type);
    const result = await window.libraryAPI.downloadArtByGameId(
      artDir,
      job.gameId,
      job.system ?? 'PS2',
      saveAsName,
      typeCodes,
      artSaveOverrides,
      job.wideSlotFallback,
    );

    // Per-type outcome. `runJob` must report `success` whenever anything was
    // written — that is what queues the game for `pendingArtRefresh` — but a
    // run where two of three types 404'd is not a clean download, and the
    // dialogs tally job status, so the shortfall has to be stated here.
    let savedCount = 0;
    const failedTypes: string[] = [];

    if (result?.data) {
      const saved = result.data.filter((r: any) => r.savedPath);
      const failed = result.data.filter((r: any) => r.error);
      savedCount = saved.length;
      for (const item of saved) {
        this.logJob(
          job.id,
          `${item.type}${item.source ? ` (from ${item.source})` : ''} saved → ${item.savedPath}`,
          'success',
        );
      }
      for (const item of failed) {
        failedTypes.push(item.type);
        const notFound = /404/.test(item.error ?? '');
        this.logJob(
          job.id,
          `${item.type}: ${notFound ? 'not found in the database' : item.error}`,
          'error',
        );
      }

      if (saved.length === 0) {
        this.logJob(job.id, 'No artwork found in the database', 'error');
        return {
          success: false,
          artRefresh: normalizedStorage ? false : undefined,
          message: `No artwork found for ${job.label} (${job.gameId}) in the ${job.system ?? 'PS2'} database.`,
        };
      }
    }

    const verb = isOverwrite ? 'overwritten' : 'downloaded';

    if (failedTypes.length > 0) {
      // Still a success — the files that were written have to be picked up by
      // `pendingArtRefresh` — but "Artwork downloaded." on its own would report
      // a partial run as a clean one.
      const total = toDownload.length;
      const message =
        `Artwork partially ${verb} — ${savedCount} of ${total} asset${total === 1 ? '' : 's'} ` +
        `written; missing: ${failedTypes.join(', ')}.`;
      this.logJob(job.id, message, 'error');
      return {
        success: true,
        message,
        artRefresh: normalizedStorage ? false : undefined,
      };
    }

    const message = `Artwork ${verb}.`;
    this.logJob(job.id, message, 'success');
    return {
      success: true,
      message,
      artRefresh: normalizedStorage ? false : undefined,
    };
  }

  private async runRenameJob(job: ImportJob) {
    this.patchJob(job.id, { stage: 'Renaming…', percent: 50 });
    // keepOriginalName === OPL "new" convention: drop the GAMEID. prefix.
    return window.libraryAPI.renameGamefile(
      job.filePath,
      job.gameId,
      job.gameName,
      !!job.keepOriginalName,
    );
  }

  private async runPs1ConvertPopsLoaderJob(job: ImportJob) {
    this.patchJob(job.id, { stage: 'Converting to POPSLoader…', percent: 50 });
    return window.libraryAPI.convertPs1ToPopsLoader(job.filePath, job.gameId);
  }

  private async runPs1ConvertPopstarterJob(job: ImportJob) {
    this.patchJob(job.id, { stage: 'Converting to POPStarter…', percent: 50 });
    return window.libraryAPI.convertPs1ToPopstarter(
      job.filePath,
      job.gameId,
      job.gameName,
      job.elfPrefix || 'XX.',
    );
  }

  private async runZsoJob(job: ImportJob) {
    const zsoPath = job.filePath.replace(/\.iso$/i, '.zso');
    window.libraryAPI.onZsoCompressProgress((progress) =>
      this.patchJob(job.id, {
        percent: progress.percent,
        stage: progress.stage,
      }),
    );
    try {
      return await window.libraryAPI.compressIsoToZso(
        job.filePath,
        zsoPath,
        job.deleteOriginal ?? true,
      );
    } finally {
      window.libraryAPI.removeAllZsoCompressProgressListeners();
    }
  }

  private async runZsoToIsoJob(job: ImportJob) {
    const isoPath = job.filePath.replace(/\.zso$/i, '.iso');
    window.libraryAPI.onZsoDecompressProgress((progress) =>
      this.patchJob(job.id, {
        percent: progress.percent,
        stage: progress.stage,
      }),
    );
    try {
      return await window.libraryAPI.decompressZsoToIso(
        job.filePath,
        isoPath,
        job.deleteOriginal ?? true,
      );
    } finally {
      window.libraryAPI.removeAllZsoDecompressProgressListeners();
    }
  }

  private async runVcdToBinJob(job: ImportJob) {
    const binPath = job.filePath.replace(/\.vcd$/i, '.bin');
    const cuePath = job.filePath.replace(/\.vcd$/i, '.cue');
    window.libraryAPI.onVcdToBinProgress((progress) =>
      this.patchJob(job.id, {
        percent: progress.percent,
        stage: progress.stage,
      }),
    );
    try {
      return await window.libraryAPI.convertVcdToBin(
        job.filePath,
        binPath,
        cuePath,
        job.deleteOriginal ?? false,
      );
    } finally {
      window.libraryAPI.removeAllVcdToBinProgressListeners();
    }
  }

  private async runPs2CdJob(job: ImportJob, dirPath: string) {
    window.libraryAPI.onPs2CdImportProgress((progress) =>
      this.patchJob(job.id, {
        percent: progress.percent,
        stage: progress.stage,
      }),
    );
    try {
      return await window.libraryAPI.importPs2CdGame(
        job.filePath,
        dirPath,
        job.gameId,
        job.gameName,
        job.downloadArtwork,
      );
    } finally {
      window.libraryAPI.removeAllPs2CdImportProgressListeners();
    }
  }

  private async runPs1Job(job: ImportJob, dirPath: string) {
    window.libraryAPI.onPs1ImportProgress((progress) =>
      this.patchJob(job.id, {
        percent: progress.percent,
        stage: progress.stage,
      }),
    );
    try {
      return await window.libraryAPI.importPs1Game(
        job.filePath,
        dirPath,
        job.elfPrefix || 'XX.',
        job.downloadArtwork,
        job.gameId || undefined,
        job.gameName || undefined,
        job.launcherMode || 'popstarter',
      );
    } finally {
      window.libraryAPI.removeAllPs1ImportProgressListeners();
    }
  }

  private async runPs2DvdJob(job: ImportJob, dirPath: string) {
    const sep = dirPath.includes('\\') ? '\\' : '/';
    const destinationDir = `${dirPath.replace(/[\\/]$/, '')}${sep}DVD`;

    window.libraryAPI.onMoveFileProgress((progress) =>
      this.patchJob(job.id, {
        percent: progress.percent,
        stage: `Copying ${progress.copiedMB.toFixed(2)}/${progress.totalMB.toFixed(2)} MB`,
      }),
    );

    try {
      this.patchJob(job.id, { stage: 'Copying file…' });
      const moveResult: any = await window.libraryAPI.moveFile(
        job.filePath,
        destinationDir,
      );
      if (!moveResult?.success) {
        return {
          success: false,
          message: moveResult?.message || 'Failed to move game file.',
        };
      }

      const movedPath =
        moveResult.newPath ||
        `${destinationDir}${sep}${job.filePath.split(/[\\/]/).pop()}`;

      this.patchJob(job.id, { stage: 'Renaming…' });
      // In "new OPL convention" mode the rename drops the GAMEID. prefix so
      // the file is just "<Title>.iso". OPL reads the ID from SYSTEM.CNF.
      const renameResult: any = await window.libraryAPI.renameGamefile(
        movedPath,
        job.gameId,
        job.gameName,
        !!job.keepOriginalName,
      );
      if (!renameResult?.success) {
        return {
          success: false,
          message: renameResult?.message || 'Failed to rename game file.',
        };
      }

      if (job.downloadArtwork) {
        this.patchJob(job.id, { stage: 'Fetching artwork…', percent: 100 });
        await window.libraryAPI.downloadArtByGameId(
          `${dirPath}/ART`,
          job.gameId,
          'PS2',
        );
      }

      return { success: true };
    } finally {
      window.libraryAPI.removeAllMoveFileProgressListeners();
    }
  }
}
