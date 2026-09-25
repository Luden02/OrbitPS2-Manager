import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { LogsService } from './logs.service';
import { LibraryService } from './library.service';
import { ConfirmDialogService } from './confirm-dialog.service';

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
  /** Artwork only: which art types to fetch (defaults to COV/ICO/SCR). */
  artTypes?: string[];
  /** Artwork only: silently drop already-saved types instead of prompting to overwrite. */
  skipExisting?: boolean;
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
  status: JobStatus;
  percent: number;
  stage: string;
  message?: string;
  createdAt: number;
  finishedAt?: number;
  /** Shared by every job created from the same `enqueue()` call — lets the
   *  artwork-overwrite prompt's "don't ask again" apply to the rest of the batch. */
  batchId: string;
}

export type NewImportJob = Omit<
  ImportJob,
  | 'id'
  | 'status'
  | 'percent'
  | 'stage'
  | 'message'
  | 'createdAt'
  | 'finishedAt'
  | 'batchId'
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

  /**
   * Per-batch "don't ask again" decision for the artwork-overwrite prompt —
   * set once a user checks the toggle, consumed by the rest of that batch's
   * artwork jobs, then dropped once the batch has nothing left queued/running.
   */
  private readonly batchOverwriteDecisions = new Map<string, boolean>();

  constructor(
    private readonly _logger: LogsService,
    private readonly _library: LibraryService,
    private readonly _confirm: ConfirmDialogService,
  ) {}

  /** Queue one or more imports (as a single batch) and kick the worker if idle. */
  public enqueue(jobs: NewImportJob[]): void {
    const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const created: ImportJob[] = jobs.map((job) => ({
      ...job,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      batchId,
      status: 'queued',
      percent: 0,
      stage: 'Queued',
      createdAt: Date.now(),
    }));
    this.jobsSubject.next([...this.jobsSubject.value, ...created]);
    this._logger.log('jobsService', `Queued ${created.length} import job(s)`);
    void this.processNext();
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

  private async processNext(): Promise<void> {
    if (this.isProcessing) {
      return;
    }
    const next = this.jobsSubject.value.find((j) => j.status === 'queued');
    if (!next) {
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
        // Artwork only touches one game's images — patch it in place so the
        // library scroll position is preserved. Everything else changes the
        // file set on disk and needs a full re-scan.
        if (next.type === 'artwork' && result?.artRefresh !== false) {
          void this._library.updateArtForGame(next.gameId);
        } else {
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
      const stillPending = this.jobsSubject.value.some(
        (j) =>
          j.batchId === next.batchId &&
          (j.status === 'queued' || j.status === 'running'),
      );
      if (!stillPending) {
        this.batchOverwriteDecisions.delete(next.batchId);
      }

      this.isProcessing = false;
      // Process the rest of the queue on the next tick.
      setTimeout(() => void this.processNext(), 0);
    }
  }

  private async runJob(
    job: ImportJob,
  ): Promise<{
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
    this.patchJob(job.id, { stage: 'Checking existing artwork…', percent: 10 });

    const artDir = `${dirPath}/ART`;
    const saveAsName = job.saveAsName;
    const localName = saveAsName || job.gameId;
    const types = job.artTypes?.length ? job.artTypes : ['COV', 'ICO', 'SCR'];
    const expectedFiles = types.map((t) => `${localName}_${t}.png`);

    this._logger.log(
      'jobsService',
      `FetchArtwork for "${job.label}": gameId=${job.gameId}, saveAsName=${saveAsName ?? '(none)'}, localName=${localName}, expectedFiles=[${expectedFiles.join(', ')}]`,
    );

    const existing = await window.libraryAPI.checkArtFilesExist(
      artDir,
      expectedFiles,
    );

    this._logger.log(
      'jobsService',
      `checkArtFilesExist returned ${existing.length} existing file(s) for "${job.label}": [${existing.join(', ')}]`,
    );

    let shouldDownload = true;
    let isOverwrite = false;
    let downloadTypes = types;

    if (existing.length > 0) {
      if (job.skipExisting) {
        const alreadySaved = types.filter((t) =>
          existing.includes(`${localName}_${t}.png`),
        );
        downloadTypes = types.filter((t) => !alreadySaved.includes(t));
        this._logger.log(
          'jobsService',
          `Skipping ${alreadySaved.length} already-saved type(s) for "${job.label}": [${alreadySaved.join(', ')}]`,
        );

        if (downloadTypes.length === 0) {
          this._logger.log(
            'jobsService',
            `All selected artwork already exists for "${job.label}" — nothing to download.`,
          );
          return {
            success: true,
            message: 'Artwork already up to date — nothing to download.',
            artRefresh: false,
          };
        }
      } else {
        const remembered = this.batchOverwriteDecisions.get(job.batchId);
        let confirmed: boolean;

        if (remembered !== undefined) {
          confirmed = remembered;
          this._logger.log(
            'jobsService',
            `Reusing batch overwrite decision for "${job.label}": confirmed=${confirmed}`,
          );
        } else {
          const result = await this._confirm.confirmWithCheckbox({
            title: 'Overwrite Artwork',
            message: `Artwork already exists for "${job.label}". Overwrite?`,
            detail: existing.join('\n'),
            confirmLabel: 'Overwrite',
            toggleLabel: "Don't ask again for this batch",
          });
          confirmed = result.confirmed;
          if (result.checked) {
            this.batchOverwriteDecisions.set(job.batchId, confirmed);
          }
          this._logger.log(
            'jobsService',
            `Confirm dialog result for "${job.label}": confirmed=${confirmed}, rememberedForBatch=${result.checked}`,
          );
        }

        if (confirmed) {
          isOverwrite = true;
        } else {
          shouldDownload = false;
        }
      }
    }

    if (!shouldDownload) {
      this._logger.log(
        'jobsService',
        `Artwork download cancelled by user for "${job.label}" — existing files left untouched`,
      );
      return { success: false, cancelled: true, message: 'Cancelled by user.' };
    }

    this.patchJob(job.id, { stage: 'Downloading artwork…', percent: 50 });

    const result = await window.libraryAPI.downloadArtByGameId(
      artDir,
      job.gameId,
      job.system ?? 'PS2',
      saveAsName,
      downloadTypes,
    );

    if (result?.data) {
      const saved = result.data.filter((r: any) => r.savedPath);
      const failed = result.data.filter((r: any) => r.error);
      this._logger.log(
        'jobsService',
        `Artwork download complete for "${job.label}": ${saved.length} saved, ${failed.length} failed`,
      );
      if (saveAsName && saveAsName !== job.gameId) {
        this._logger.log(
          'jobsService',
          `Artwork saved with name pattern "${saveAsName}_*.png" (gameId: ${job.gameId})`,
        );
      }
      for (const item of saved) {
        this._logger.log('jobsService', `  ✓ ${item.type}: ${item.savedPath}`);
      }
      for (const item of failed) {
        this._logger.log('jobsService', `  ✗ ${item.type}: ${item.error}`);
      }

      if (saved.length === 0) {
        return {
          success: false,
          message: `No artwork found for ${job.label} (${job.gameId}) in the ${job.system ?? 'PS2'} database.`,
        };
      }
    }

    const message = isOverwrite
      ? 'Artwork overwritten.'
      : 'Artwork downloaded.';
    return { success: true, message };
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
