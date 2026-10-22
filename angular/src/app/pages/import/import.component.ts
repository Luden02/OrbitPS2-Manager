import { Component, OnDestroy, OnInit } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { LibraryService } from '../../shared/services/library.service';
import { JobsService, ImportJobType } from '../../shared/services/jobs.service';
import { SettingsService } from '../../shared/services/settings.service';
import { AsyncPipe } from '@angular/common';

interface StagedFile {
  path: string;
  fileName: string;
  gameId: string;
  gameName: string;
  detected: boolean;
  invalid: boolean;
  identificationStatus?: 'identified' | 'ambiguous' | 'unidentified';
  message?: string;
  /** True when `path` is a temp .iso ripped from a drive, not a user-picked file. */
  isTempRip?: boolean;
}

@Component({
  selector: 'app-import',
  imports: [LucideAngularModule, AsyncPipe],
  templateUrl: './import.component.html',
  styleUrl: './import.component.scss',
})
export class ImportComponent implements OnInit, OnDestroy {
  constructor(
    public _libraryService: LibraryService,
    private _jobs: JobsService,
    private _settings: SettingsService
  ) {}

  importMode: ImportJobType = 'ps2-dvd';
  downloadArtwork = true;
  /** PS2 DVD only: keep the original filename (new OPL convention). */
  keepOriginalName = false;
  elfPrefix = 'XX.';
  /** PS1 only: POPStarter (APPS launcher) vs POPSLoader (no launcher, no GameID in filename). */
  launcherMode: 'popstarter' | 'popsloader' = 'popstarter';
  /** PS1 only: VCD art naming convention. */
  vcdArtNaming: 'gameId' | 'filename' = 'gameId';

  async ngOnInit() {
    const settings = await this._settings.load();
    if (settings.ps1LauncherMode) {
      this.launcherMode = settings.ps1LauncherMode;
    }
  }

  ngOnDestroy() {
    // Any ripped-but-not-yet-imported temp .iso would otherwise sit orphaned
    // on disk (several GB) once this page is left.
    for (const f of this.staged) {
      if (f.isTempRip) void window.libraryAPI.deleteTempDvdRip(f.path);
    }
  }

  setLauncherMode(mode: 'popstarter' | 'popsloader') {
    this.launcherMode = mode;
    void this._settings.set('ps1LauncherMode', mode);
  }

  staged: StagedFile[] = [];

  // ── Import from drive (PS2 DVD only) ─────────────────
  showDriveSelect = false;
  drives: { device: string; label: string }[] = [];
  selectedDevice = '';
  customDevicePath = '';
  ripping = false;
  ripProgress: { percent: number; stage: string } | null = null;
  ripError = '';
  scanning = false;

  get isGameCd(): boolean {
    return this.importMode === 'ps2-cd';
  }
  get isGameDvd(): boolean {
    return this.importMode === 'ps2-dvd';
  }
  get isGamePsx(): boolean {
    return this.importMode === 'ps1';
  }
  get isApp(): boolean {
    return this.importMode === 'apps';
  }

  /**
   * A staged entry is importable once it has a name; disc games additionally
   * need a game id (apps don't have one, and PS1 homebrew without a
   * registered id gets one auto-assigned at import time).
   */
  get readyCount(): number {
    return this.staged.filter(
      (f) => f.gameName && (this.isApp || this.isGamePsx || f.gameId)
    ).length;
  }

  setMode(mode: ImportJobType) {
    this.importMode = mode;
    this.clearStaged();
  }

  async openDriveSelect() {
    this.ripError = '';
    this.selectedDevice = '';
    this.customDevicePath = '';
    this.drives = await window.libraryAPI.listOpticalDrives();
    if (this.drives.length) {
      this.selectedDevice = this.drives[0].device;
    }
    this.showDriveSelect = true;
  }

  cancelDriveSelect() {
    this.showDriveSelect = false;
  }

  async startRip() {
    const device = (this.selectedDevice || this.customDevicePath).trim();
    const dirPath = this._libraryService.currentDirectoryValue;
    if (!device || !dirPath) {
      return;
    }

    this.ripError = '';
    this.ripping = true;
    this.ripProgress = { percent: 0, stage: 'Starting…' };
    window.libraryAPI.onDvdRipProgress((p) => (this.ripProgress = p));

    try {
      const destDir = `${dirPath.replace(/[\\/]$/, '')}/DVD`;
      const result = await window.libraryAPI.ripPs2DvdFromDrive(device, destDir);
      if (!result?.success || !result.isoPath) {
        this.ripError = result?.message || 'Failed to read the disc.';
        return;
      }

      this.showDriveSelect = false;
      this.scanning = true;
      try {
        const staged = await this.detectFile(result.isoPath);
        staged.isTempRip = true;
        staged.fileName = 'Ripped from drive';
        this.staged = [...this.staged, staged];
      } finally {
        this.scanning = false;
      }
    } finally {
      this.ripping = false;
      this.ripProgress = null;
      window.libraryAPI.removeAllDvdRipProgressListeners();
    }
  }

  async addFiles() {
    const result = this.isApp
      ? await window.libraryAPI.openAskElfFiles()
      : await window.libraryAPI.openAskGameFiles(
          this.isGameCd || this.isGamePsx,
          this.isGameDvd,
          this.isGamePsx
        );
    if (result?.canceled || !result?.filePaths?.length) {
      return;
    }

    this.scanning = true;
    try {
      for (const path of result.filePaths as string[]) {
        if (this.staged.some((f) => f.path === path)) {
          continue;
        }
        const staged = this.isApp
          ? this.stageApp(path)
          : await this.detectFile(path);
        this.staged = [...this.staged, staged];
      }
    } finally {
      this.scanning = false;
    }
  }

  private stageApp(path: string): StagedFile {
    const fileName = path.split(/[\\/]/).pop() || path;
    const title = fileName.replace(/\.elf$/i, '');
    return { path, fileName, gameId: '', gameName: title, detected: false, invalid: false };
  }

  private async detectFile(path: string): Promise<StagedFile> {
    const fileName = path.split(/[\\/]/).pop() || path;
    const detect = this.isGamePsx
      ? this._libraryService.tryDeterminePs1GameIdFromHex(path)
      : this._libraryService.tryDetermineGameIdFromHex(path);

    let message: string | undefined;
    try {
      const res: any = await detect;
      if (res?.success) {
        if (this.isGamePsx && res.identificationStatus === 'ambiguous') {
          return {
            path,
            fileName,
            // Do not pass the shared internal serial back as a manual override.
            // The backend re-identifies it during import, preserves the serial,
            // and suppresses automatic canonical naming/artwork.
            gameId: '',
            gameName: fileName.replace(/\.(cue|iso|bin|zip)$/i, ''),
            detected: false,
            invalid: false,
            identificationStatus: 'ambiguous',
            message:
              `Shared PS1 serial${res.gameId ? ` ${res.gameId}` : ''}: ` +
              (res.message || 'disc/edition could not be resolved safely.'),
          };
        }
        return {
          path,
          fileName,
          gameId: res.gameId || '',
          gameName: res.gameName || '',
          detected: true,
          invalid: false,
          identificationStatus: res.identificationStatus,
        };
      }
      message = res?.message;
    } catch (err: any) {
      message = err?.message;
    }

    // PS1 discs with no registered game id (typically homebrew) can still be
    // converted to VCD — the backend auto-assigns a non-conflicting id, so
    // stage them as importable under their filename instead of blocking them.
    if (this.isGamePsx) {
      return {
        path,
        fileName,
        gameId: '',
        gameName: fileName.replace(/\.(cue|iso|bin|zip)$/i, ''),
        detected: false,
        invalid: false,
        identificationStatus: 'unidentified',
        message: message ? `Homebrew (no registered game ID): ${message}` : 'Homebrew — a game ID will be auto-assigned.',
      };
    }

    return {
      path,
      fileName,
      gameId: '',
      gameName: '',
      detected: false,
      invalid: true,
      message,
    };
  }

  removeStaged(path: string) {
    const entry = this.staged.find((f) => f.path === path);
    if (entry?.isTempRip) {
      void window.libraryAPI.deleteTempDvdRip(entry.path);
    }
    this.staged = this.staged.filter((f) => f.path !== path);
  }

  clearStaged() {
    for (const f of this.staged) {
      if (f.isTempRip) {
        void window.libraryAPI.deleteTempDvdRip(f.path);
      }
    }
    this.staged = [];
  }

  importAll() {
    const ready = this.staged.filter(
      (f) => f.gameName && (this.isApp || this.isGamePsx || f.gameId)
    );
    if (!ready.length) {
      return;
    }
    this._jobs.enqueue(
      ready.map((f) => ({
        type: this.importMode,
        label: f.gameName || f.gameId || f.fileName,
        filePath: f.path,
        gameId: f.gameId,
        gameName: f.gameName,
        downloadArtwork: this.downloadArtwork,
        elfPrefix: this.isGamePsx ? this.elfPrefix : undefined,
        launcherMode: this.isGamePsx ? this.launcherMode : undefined,
        keepOriginalName: this.isGameDvd ? this.keepOriginalName : undefined,
      }))
    );
    this.staged = [];
  }
}
