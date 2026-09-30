import { Injectable } from '@angular/core';
import { LogsService } from './logs.service';
import { SettingsService } from './settings.service';
import { BehaviorSubject, map, Observable } from 'rxjs';
import { Game, GameFormat, Ps1LauncherInfo, RawGameFile, gameArt } from '../types/game.type';
import { ps1ArtworkIdentities } from '../utils/ps1-artwork-identities';
import { sanitizeGameFilename } from '../utils/sanitize-game-filename';

@Injectable({
  providedIn: 'root',
})
export class LibraryService {
  private librarySubject = new BehaviorSubject<Game[]>([]);
  public get library$(): Observable<Game[]> {
    return this.librarySubject.asObservable();
  }

  public get totalCdTypeCd$(): Observable<number> {
    return this.countGamesByCdType$('CD');
  }

  public get totalCdTypeDvd$(): Observable<number> {
    return this.countGamesByCdType$('DVD');
  }

  public get totalInvalidFiles$(): Observable<number> {
    return this.invalidFilesCount();
  }

  private invalidFilesSubject = new BehaviorSubject<any[]>([]);
  public get invalidFiles$(): Observable<any[]> {
    return this.invalidFilesSubject.asObservable();
  }

  private selectedGameSubject = new BehaviorSubject<Game | null>(null);
  public get selectedGame$(): Observable<Game | null> {
    return this.selectedGameSubject.asObservable();
  }
  /** Synchronous snapshot of the selected game for details view. */
  public get selectedGameValue(): Game | null {
    return this.selectedGameSubject.getValue();
  }
  public selectGame(game: Game | null) {
    this.selectedGameSubject.next(game);
  }

  /** Tab to restore when returning from the details view. */
  public returnTab: 'PS2' | 'PS1' | 'APPS' = 'PS2';

  private loadingSubject = new BehaviorSubject<boolean>(false);
  public get loading$(): Observable<boolean> {
    return this.loadingSubject.asObservable();
  }
  public setLoading(isLoading: boolean) {
    this.loadingSubject.next(isLoading);
    // Keep the Electron main process in sync so it can guard window close
    // against in-progress actions.
    try {
      window.libraryAPI?.setLoadingState?.(isLoading);
    } catch {
      // Ignore — setLoading may run before the preload bridge is ready.
    }
  }

  private currentActionSubject = new BehaviorSubject<string | undefined>(
    undefined
  );
  public get currentAction$(): Observable<string | undefined> {
    return this.currentActionSubject.asObservable();
  }
  public setCurrentAction(action: string | undefined) {
    this.currentActionSubject.next(action);
  }

  private currentDirectory: string | undefined;
  private currentDirectorySubject = new BehaviorSubject<string | undefined>(
    undefined
  );
  public get currentDirectory$(): Observable<string | undefined> {
    return this.currentDirectorySubject.asObservable();
  }

  public get librarySizeGb$(): Observable<number> {
    return this.library$.pipe(
      map((games) =>
        games.reduce((total, game) => total + this.parseSizeToGb(game.size), 0)
      ),
      map((size) => Number(size.toFixed(2)))
    );
  }

  public get hasCurrentDirectory$(): Observable<boolean> {
    return this.currentDirectorySubject
      .asObservable()
      .pipe(map((dir) => !!dir));
  }

  /** Synchronous access to the mounted directory (used by the job queue). */
  public get currentDirectoryValue(): string | undefined {
    return this.currentDirectory;
  }

  /** Synchronous snapshot of the current library — useful for bulk actions. */
  public get currentLibraryValue(): Game[] {
    return this.librarySubject.getValue();
  }

  /** Synchronous snapshot of the invalid files — useful for bulk actions. */
  public get currentInvalidFilesValue(): any[] {
    return this.invalidFilesSubject.getValue();
  }

  private setCurrentDirectory(dir: string | undefined) {
    this.currentDirectory = dir;
    this.currentDirectorySubject.next(dir);
  }

  constructor(
    private readonly _logger: LogsService,
    private readonly _settings: SettingsService
  ) { }

  /**
   * On launch, re-mount the last used directory if auto-reconnect is enabled
   * and the directory still exists (e.g. the external drive is plugged in).
   */
  public async restoreLastDirectory(): Promise<void> {
    const settings = await this._settings.load();
    if (!settings.autoReconnect || !settings.lastDirectory) {
      return;
    }
    const exists = await window.libraryAPI
      .directoryExists(settings.lastDirectory)
      .catch(() => false);
    if (!exists) {
      this._logger.log(
        'libraryService',
        `Skipping auto-reconnect: directory no longer available (${settings.lastDirectory})`
      );
      return;
    }
    this._logger.log(
      'libraryService',
      `Auto-reconnecting last directory: ${settings.lastDirectory}`
    );
    this.setCurrentDirectory(settings.lastDirectory);
    await this.getGamesFiles(settings.lastDirectory);
  }

  private invalidFilesCount(): Observable<number> {
    return this.invalidFiles$.pipe(map((files) => Math.min(files.length, 99)));
  }

  public disconnectCurrentDirectory() {
    this._logger.log(
      'libraryService',
      'User disconnected OPL Library directory'
    );
    this.setCurrentDirectory(undefined);
    this.librarySubject.next([]);
    this.invalidFilesSubject.next([]);
  }

  public openAskDirectory() {
    this._logger.verbose(
      'libraryService',
      'Triggered directory selection pop-up...'
    );
    this.setLoading(true);
    this.setCurrentAction('User choosing directory...');
    return window.libraryAPI.openAskDirectory().then(async (data: any) => {
      if (!data.canceled) {
        const chosen = data.filePaths[0];
        this._logger.log(
          'libraryService',
          `Directory has been chosen by user: ${chosen}`
        );

        // Make sure the folder actually looks like an OPL root before
        // mounting it; otherwise the scan silently finds nothing.
        const proceed = await this.validateOplStructure(chosen);
        if (!proceed) {
          this._logger.log(
            'libraryService',
            `Mount aborted: ${chosen} was not confirmed as an OPL directory.`
          );
          this.setLoading(false);
          this.setCurrentAction('');
          return;
        }

        this.setCurrentDirectory(chosen);
        this._settings.set('lastDirectory', chosen);
        this.setLoading(false);
        this.setCurrentAction('');
        await this.getGamesFiles(chosen);
      } else {
        this._logger.error(
          'libraryService',
          `Directory selection has been cancelled by user.`
        );
        this.setLoading(false);
        this.setCurrentAction('');
      }
    });
  }

  /**
   * Verify the chosen folder contains the standard OPL subdirectories.
   * If some are missing, warn the user that it may not be the right
   * directory and offer to create the missing folders. If they decline,
   * the folder is not mounted (returns false).
   */
  private async validateOplStructure(dirPath: string): Promise<boolean> {
    const result = await window.libraryAPI
      .checkOplStructure(dirPath)
      .catch(() => null);

    // If the check itself failed, don't block the user — behave as before.
    if (
      !result ||
      !result.success ||
      !result.missing ||
      result.missing.length === 0
    ) {
      return true;
    }

    const missing = result.missing;
    const confirmed = window.confirm(
      `The selected folder is missing standard OPL folder(s):\n\n` +
      `${missing.join(', ')}\n\n` +
      `Make sure this is your OPL directory. Click OK to create the ` +
      `missing folder(s) and continue, or Cancel to unmount.`
    );

    if (!confirmed) {
      return false;
    }

    const createResult = await window.libraryAPI
      .createOplFolders(dirPath, missing)
      .catch(() => null);

    if (!createResult || !createResult.success) {
      window.alert(
        'Failed to create the missing OPL folders. The folder will not be mounted.'
      );
      this._logger.error(
        'libraryService',
        `Failed to create OPL folders in ${dirPath}`
      );
      return false;
    }

    this._logger.log(
      'libraryService',
      `Created missing OPL folder(s): ${(createResult.created || []).join(', ')}`
    );
    return true;
  }

  private async resolveEmberDirectory(oplRoot: string): Promise<string | undefined> {
    const sep = oplRoot.includes('\\') ? '\\' : '/';
    const rootEmber = `${oplRoot.replace(/[\\/]$/, '')}${sep}EMBER`;
    const rootGames = `${rootEmber}${sep}games`;
    if (await window.libraryAPI.directoryExists(rootGames).catch(() => false)) {
      return rootEmber;
    }

    const settings = await this._settings.load();
    const configured = settings.emberDirectories?.[oplRoot];
    if (
      configured &&
      (await window.libraryAPI.directoryExists(configured).catch(() => false))
    ) {
      return configured;
    }
    return undefined;
  }

  private async getEmberGamesForLibrary(oplRoot: string) {
    const emberDirectory = await this.resolveEmberDirectory(oplRoot);
    if (!emberDirectory) {
      return { success: true, games: [] as any[] };
    }
    return window.libraryAPI.getEmberGames(emberDirectory).catch((error) => ({
      success: false,
      games: [],
      message: error instanceof Error ? error.message : String(error),
    }));
  }

  /**
   * Pick an Ember installation when it is not located at <mounted device>/EMBER.
   * The selected path may be either EMBER/ itself or its games/ directory.
   */
  public async locateEmberDirectory(): Promise<void> {
    const result = await window.libraryAPI.openAskDirectory();
    if (result?.canceled || !result?.filePaths?.[0]) return;

    const chosen = result.filePaths[0];
    const scan = await window.libraryAPI.getEmberGames(chosen).catch(() => null);
    if (!scan?.success) {
      window.alert('That folder does not contain a readable Ember games directory.');
      return;
    }

    if (!this.currentDirectory) {
      window.alert('Mount an OPL library before assigning its Ember folder.');
      return;
    }
    const settings = await this._settings.load();
    await this._settings.set('emberDirectories', {
      ...(settings.emberDirectories ?? {}),
      [this.currentDirectory]: chosen,
    });
    this._logger.log(
      'libraryService',
      `Using custom Ember directory for ${this.currentDirectory}: ${chosen}`
    );
    this.refreshGamesFiles();
  }

  public refreshGamesFiles() {
    if (this.currentDirectory) {
      this.getGamesFiles(this.currentDirectory);
    }
  }

  public getGamesFiles(currentDirectory: string) {
    this.setLoading(true);
    this.setCurrentAction('Retrieving game files from directory...');
    this._logger.log('libraryService', 'Started game files retrieval...');

    if (currentDirectory) {
      return Promise.all([
        window.libraryAPI.getGamesFiles(currentDirectory),
        window.libraryAPI.getULGames(currentDirectory),
        window.libraryAPI.getApps(currentDirectory),
        window.libraryAPI.getPs1Launchers(currentDirectory),
        this.getEmberGamesForLibrary(currentDirectory),
      ]).then(async ([files, ulResult, appsResult, ps1LaunchersResult, emberResult]) => {
        if (files.success) {
          this._logger.log(
            'libraryService',
            `Grabbed ${files.data.length} game files, now parsing...`
          );
          this.setCurrentAction('');
          this.setLoading(false);

          const ulGames =
            ulResult?.success && ulResult.data
              ? this.parseULGamesToLibrary(ulResult.data)
              : [];

          if (ulGames.length > 0) {
            this._logger.log(
              'libraryService',
              `Found ${ulGames.length} UL format games`
            );
          }

          const apps =
            appsResult?.success && appsResult.apps
              ? this.parseAppsToLibrary(appsResult.apps)
              : [];

          if (apps.length > 0) {
            this._logger.log('libraryService', `Found ${apps.length} app(s)`);
          }

          // Build PS1 launcher map: POPS_<sanitizedName> → launcher info
          const ps1Launchers =
            ps1LaunchersResult?.success && ps1LaunchersResult.launchers
              ? ps1LaunchersResult.launchers
              : [];
          const ps1LauncherMap = new Map<string, Ps1LauncherInfo>();
          for (const launcher of ps1Launchers) {
            const name = launcher.folder.replace(/^POPS_/i, '');
            ps1LauncherMap.set(name.toLowerCase(), launcher);
          }
          if (ps1Launchers.length > 0) {
            this._logger.log('libraryService', `Found ${ps1Launchers.length} PS1 launcher(s) in APPS/POPS_*`);
          }

          const emberGames =
            emberResult?.success && emberResult.games
              ? this.parseEmberToLibrary(emberResult.games)
              : [];
          if (emberGames.length > 0) {
            this._logger.log('libraryService', `Found ${emberGames.length} Ember PS1 game(s)`);
          }

          await this.parseGameFilesToLibrary(files.data, ulGames, apps, ps1LauncherMap, emberGames);
        } else {
          this._logger.error('libraryService', files.message);
          this.setCurrentAction('');
          this.setLoading(false);
        }
      });
    } else {
      this._logger.error(
        'libraryService',
        'No directory selected for game files retrieval.'
      );
      this.setCurrentAction('');
      this.setLoading(false);
      return Promise.reject(
        new Error(
          'libraryService - No directory selected for game files retrieval.'
        )
      );
    }
  }

  private formatFileSize(size: number) {
    if (size === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(size) / Math.log(1024));
    const value = size / Math.pow(1024, i);
    return `${value.toFixed(1)}${units[i]}`;
  }

  private parseSizeToGb(sizeLabel: string | undefined): number {
    if (!sizeLabel) {
      return 0;
    }
    const match = sizeLabel.match(/([\d.]+)\s*(B|KB|MB|GB|TB)/i);
    if (!match) {
      return 0;
    }
    const value = parseFloat(match[1]);
    if (Number.isNaN(value)) {
      return 0;
    }
    const unit = match[2].toUpperCase();
    const factors: Record<string, number> = {
      B: 1 / Math.pow(1024, 3),
      KB: 1 / Math.pow(1024, 2),
      MB: 1 / 1024,
      GB: 1,
      TB: 1024,
    };
    return value * (factors[unit] ?? 0);
  }

  private countGamesByCdType$(expectedType: string): Observable<number> {
    return this.library$.pipe(
      map(
        (games) =>
          games.filter(
            (game) => game.cdType?.toUpperCase() === expectedType.toUpperCase()
          ).length
      )
    );
  }

  private mapGameIdToRegion(gameId: string) {
    if (
      gameId.startsWith('SCES') ||
      gameId.startsWith('SCED') ||
      gameId.startsWith('SLES') ||
      gameId.startsWith('SLED')
    ) {
      return 'PAL';
    }
    if (
      gameId.startsWith('SCUS') ||
      gameId.startsWith('SLUS') ||
      gameId.startsWith('LSP') ||
      gameId.startsWith('PSRM')
    ) {
      return 'NTSC-U';
    }
    if (
      gameId.startsWith('SCPS') ||
      gameId.startsWith('SLPS') ||
      gameId.startsWith('SLPM') ||
      gameId.startsWith('SIPS')
    ) {
      return 'NTSC-J';
    }
    return 'UNKNOWN';
  }

  private extensionToFormat(ext: string): GameFormat {
    switch (ext?.toLowerCase()) {
      case '.zso':
        return 'ZSO';
      case '.vcd':
        return 'VCD';
      default:
        return 'ISO';
    }
  }

  private estimateUlSize(entry: { totalSize: number; numParts: number; mediaType: string }): string {
    if (entry.totalSize > 0) {
      return this.formatFileSize(entry.totalSize);
    }
    // Fallback: estimate from number of parts (~1 GB per fragment)
    if (entry.numParts > 0) {
      const estimatedBytes = entry.numParts * 1073741824;
      return `~${this.formatFileSize(estimatedBytes)}`;
    }
    return '??';
  }

  private parseULGamesToLibrary(
    ulEntries: {
      name: string;
      gameId: string;
      numParts: number;
      mediaType: string;
      totalSize: number;
    }[]
  ): Game[] {
    return ulEntries.map((entry) => {
      // Normalize gameId to XXXX_###.## format (safety net)
      // Strips leading "ul" prefix if present, then formats digits
      let rawId = entry.gameId;
      rawId = rawId.replace(/^ul[._-]?/i, '');
      const cleaned = rawId.replace(/[^A-Za-z0-9]/g, '');
      const idMatch = cleaned.match(/^([A-Za-z]{4})(\d{5})$/);
      const gameId = idMatch
        ? `${idMatch[1].toUpperCase()}_${idMatch[2].slice(0, 3)}.${idMatch[2].slice(3)}`
        : rawId;

      return {
        filename: `ul.${gameId}.${entry.name}`,
        title: entry.name,
        cdType: entry.mediaType,
        gameId: gameId,
        region: this.mapGameIdToRegion(gameId),
        path: '',
        extension: 'UL',
        parentPath: '',
        format: 'UL' as GameFormat,
        size: this.estimateUlSize(entry),
      };
    });
  }

  private parseAppsToLibrary(
    apps: {
      folder: string;
      title: string;
      boot: string;
      path: string;
      sizeBytes: number;
    }[]
  ): Game[] {
    return apps.map((app) => ({
      filename: app.boot,
      title: app.title,
      cdType: 'APPS',
      gameId: '',
      path: app.path,
      extension: 'ELF',
      parentPath: '',
      format: 'APP' as GameFormat,
      system: 'APPS' as const,
      appFolder: app.folder,
      size: this.formatFileSize(app.sizeBytes) || '??',
    }));
  }

  /**
   * Resolve a single disc-image file to a Game with optional PS1 launcher link.
   * Returns null if the file is invalid or its game ID can't be resolved.
   */
  private async parseSingleFile(
    file: RawGameFile,
    ps1LauncherMap?: Map<string, Ps1LauncherInfo>
  ): Promise<Game | null> {
    const gameIdMatch = file.name.match(/^([A-Z]{4}_\d{3}\.\d{2})\.(.+)$/i);
    const ext = file.extension?.toLowerCase();
    const looksLikeImage =
      (ext === '.iso' || ext === '.zso' || ext === '.vcd') &&
      typeof file.name === 'string' &&
      typeof file.path === 'string' &&
      !!file.stats &&
      typeof file.stats.size === 'number';

    if (!looksLikeImage) return null;

    this.setCurrentAction(file.name);

    let gameId: string;
    let title: string;
    let canonicalTitle: string | undefined;
    let ps1Launcher: Ps1LauncherInfo | undefined;

    if (gameIdMatch) {
      gameId = gameIdMatch[1];
      title = gameIdMatch[2];
      if (ps1LauncherMap && ext === '.vcd') {
        ps1Launcher = ps1LauncherMap.get(title.toLowerCase());
      }
    } else if (ext === '.iso' || ext === '.zso') {
      this.setCurrentAction(`Resolving ${file.name}…`);
      const resolved = await window.libraryAPI.resolveIsoGameId(file.path);
      if (!resolved?.success || !resolved.gameId) return null;
      gameId = resolved.gameId;
      title = resolved.gameName || file.name;
    } else {
      if (ps1LauncherMap) {
        ps1Launcher = ps1LauncherMap.get(file.name.toLowerCase());
      }
      if (ps1Launcher?.gameId) {
        gameId = ps1Launcher.gameId;
        title = file.name;
      } else {
        this.setCurrentAction(`Resolving VCD ${file.name}…`);
        const resolved = await window.libraryAPI.tryDeterminePs1GameIdFromVcd(file.path);
        if (!resolved?.success || !resolved.gameId) return null;
        gameId = resolved.gameId;
        canonicalTitle = resolved.gameName
          ? sanitizeGameFilename(resolved.gameName)
          : undefined;
        title = resolved.gameName || file.name;
      }
    }

    // Old POPStarter naming can carry a GameID prefix. Still resolve the disc
    // itself so a user-supplied filename never overrides the actual PS1 ID.
    if (ext === '.vcd' && gameIdMatch) {
      const resolved = await window.libraryAPI.tryDeterminePs1GameIdFromVcd(file.path);
      if (resolved?.success && resolved.gameId) {
        gameId = resolved.gameId;
        canonicalTitle = resolved.gameName
          ? sanitizeGameFilename(resolved.gameName)
          : undefined;
        title = resolved.gameName || title;
      }
    }

    const dirName = file.parentPath?.split(/[\\/]/).pop() || '';
    const isPops = dirName === 'POPS';
    const isVcd = dirName === 'VCD';
    const hasLauncher = !!ps1Launcher && isPops;

    const gameEntry: Game = {
      filename: file.name + file.extension,
      title,
      cdType: hasLauncher ? 'APPS' : isPops ? 'POPS' : dirName,
      gameId,
      region: this.mapGameIdToRegion(gameId),
      path: file.path,
      extension: file.extension,
      parentPath: file.parentPath,
      format: isPops ? 'POPS' : this.extensionToFormat(file.extension),
      system: hasLauncher ? 'APPS' : isPops || isVcd ? 'PS1' : 'PS2',
      size: this.formatFileSize(file.stats!.size) || '??',
      canonicalTitle,
    };

    if (hasLauncher) {
      const l = ps1Launcher!;
      gameEntry.title = l.title;
      gameEntry.ps1LauncherPath = l.path.replace(/[\\/][^\\/]+\.elf$/i, '');
      gameEntry.ps1LauncherBoot = l.boot;
      gameEntry.isPs1Launcher = true;
      gameEntry.appFolder = l.folder;
      gameEntry.ps1VmcSub = l.folder.replace(/^POPS_/i, '');
    }

    return gameEntry;
  }

  private parseEmberToLibrary(
    entries: Array<{
      folderName: string;
      path: string;
      cuePath: string;
      gameId?: string;
      gameName?: string;
      sizeBytes: number;
    }>
  ): Game[] {
    return entries.map((entry) => ({
      filename: entry.folderName,
      title: entry.gameName || entry.folderName,
      canonicalTitle: entry.gameName
        ? sanitizeGameFilename(entry.gameName)
        : undefined,
      cdType: 'EMBER',
      gameId: entry.gameId || '',
      region: entry.gameId ? this.mapGameIdToRegion(entry.gameId) : 'UNKNOWN',
      path: entry.path,
      extension: 'CUE',
      parentPath: entry.path.replace(/[\\/][^\\/]+$/, ''),
      format: 'EMBER' as GameFormat,
      system: 'PS1' as const,
      emberFolder: entry.folderName,
      emberCuePath: entry.cuePath,
      size: this.formatFileSize(entry.sizeBytes) || '??',
    }));
  }

  /**
   * Match artwork from the /ART directory against every game in the list.
   * PS1 launcher apps are matched by boot ELF name, PS1 VCD/Ember rows by the
   * exact identities RiptOPL can resolve (VCD GameID fallback only when the
   * GameID is a strict prefix of that VCD filename), and everything else by
   * gameId.
   */
  private matchArtForGames(games: Game[], artFiles: gameArt[]): void {
    for (const game of games) {
      if (game.isPs1Launcher && game.ps1LauncherBoot) {
        const bootName = game.ps1LauncherBoot;
        game.art = artFiles.filter(
          (art: gameArt) => art.name === bootName + '_' + (art.type || ''),
        );
      } else if (game.system === 'APPS' && game.filename) {
        // Regular ELF apps: art files follow <boot>.ELF_<TYPE>.png convention
        game.art = artFiles.filter(
          (art: gameArt) => art.gameId === game.filename,
        );
      } else if (game.system === 'PS1') {
        // POPSLoader/RiptOPL VCDs and Ember folders: RiptOPL reads art by the
        // on-disk storage name, so those names are authoritative. GameID-named
        // art only counts when the VCD was itself named after the disc ID —
        // otherwise it is invisible to RiptOPL and must not show as present.
        const acceptedNames = new Set(ps1ArtworkIdentities(game));
        game.art = artFiles.filter((art: gameArt) =>
          acceptedNames.has(art.gameId),
        );
      } else {
        game.art = artFiles.filter(
          (art: gameArt) => art.gameId === game.gameId,
        );
      }
    }
  }

  private async parseGameFilesToLibrary(
    gamefiles: RawGameFile[],
    ulGames: Game[] = [],
    apps: Game[] = [],
    ps1LauncherMap?: Map<string, Ps1LauncherInfo>,
    emberGames: Game[] = []
  ) {
    this.setLoading(true);
    this.setCurrentAction('Mapping gamefiles to Game Objects...');
    this._logger.verbose(
      'libraryService.parseGameFilesToLibrary',
      `Started mapping gamefiles to GameObjects: ${gamefiles.length} Files...`
    );
    const validGames: Game[] = [];
    const invalidFiles: RawGameFile[] = [];

    for (const file of gamefiles) {
      this._logger.verbose(
        'libraryService.parseGameFilesToLibrary',
        `Mapping: ${file.name}`
      );
      const game = await this.parseSingleFile(file, ps1LauncherMap);
      if (game) {
        validGames.push(game);
      } else {
        invalidFiles.push(file);
      }
    }

    validGames.push(...ulGames, ...apps, ...emberGames);

    if (this.currentDirectory) {
      const artFiles = await this.parseArtFiles(this.currentDirectory);
      this.matchArtForGames(validGames, artFiles);
    }

    this.setLoading(true);
    this.setCurrentAction('Saving...');
    this.librarySubject.next(validGames);
    this.invalidFilesSubject.next(invalidFiles);
    this.setCurrentAction('');
    this.setLoading(false);

    this._logger.log(
      'libraryService',
      `Library updated: ${validGames.length} game(s), ${invalidFiles.length} invalid file(s)`
    );
    if (invalidFiles.length > 0) {
      this._logger.verbose(
        'libraryService.parseGameFilesToLibrary',
        `Invalid files: ${invalidFiles
          .map((f) => f.name + (f.extension || ''))
          .join(', ')}`
      );
    }
  }

  private parseArtFiles(dirPath: string) {
    this.setLoading(true);
    this.setCurrentAction('Parsing /ART folder on disk...');
    return window.libraryAPI.getArtFolder(dirPath).then((artFiles) => {
      this.setCurrentAction('');
      this.setLoading(false);
      return artFiles.data;
    });
  }

  /**
   * Re-reads artwork for a single game and patches it into the current
   * library state without replacing the whole list, preserving scroll position.
   */
  public async updateArtForGame(gameId: string) {
    await this.updateArtForGames([gameId]);
  }

  /**
   * Re-reads artwork for several games in a single `/ART` folder scan and
   * patches each game into the current library state in one pass. Used by the
   * bulk artwork flow, which queues one job per game: refreshing per job would
   * re-read the whole ART folder for every game, so the job queue defers the
   * refresh and flushes once all queued games have been processed.
   */
  public async updateArtForGames(gameIds: string[]) {
    if (!this.currentDirectory || gameIds.length === 0) return;
    const targets = new Set(gameIds);
    const artFiles = await this.parseArtFiles(this.currentDirectory);
    const currentLibrary = this.librarySubject.getValue();
    const updatedLibrary = currentLibrary.map((game) => {
      if (!targets.has(game.gameId)) return game;
      if (game.isPs1Launcher && game.ps1LauncherBoot) {
        const bootName = game.ps1LauncherBoot;
        return {
          ...game,
          art: artFiles
            .filter((art: gameArt) => (bootName + '_' + (art.type || '')) === art.name)
            .map((art: gameArt) => art),
        };
      }
      if (game.system === 'PS1' && game.filename) {
        const filenameNoExt = game.filename.replace(/\.[^./\\]+$/, '');
        return {
          ...game,
          art: artFiles.filter(
            (art: gameArt) => art.gameId === game.gameId || art.gameId === filenameNoExt,
          ),
        };
      }
      return {
        ...game,
        art: artFiles
          .filter((art: gameArt) => art.gameId === game.gameId)
          .map((art: gameArt) => art),
      };
    });
    this.librarySubject.next(updatedLibrary);

    for (const updated of updatedLibrary) {
      if (!targets.has(updated.gameId) || !updated.isPs1Launcher) continue;
      this._logger.log(
        'libraryService',
        `updateArtForGames: PS1 launcher "${updated.title}" matched ${updated.art?.length ?? 0} art file(s) via boot name "${updated.ps1LauncherBoot}"`
      );
      if (updated.art?.length) {
        for (const a of updated.art) {
          this._logger.log('libraryService', `  art: ${a.name} (${a.path})`);
        }
      }
    }
  }

  public tryDetermineGameIdFromHex(filepath: string) {
    this._logger.log(
      'tryDetermineGameIdFromHex',
      'Trying to determine Game ID from hex data: ' + filepath
    );
    this.setLoading(true);
    this.setCurrentAction('Determining Game ID from hex data...');
    return window.libraryAPI.tryDetermineGameIdFromHex(filepath).then((res) => {
      this.setCurrentAction('');
      this.setLoading(false);
      this._logger.verbose(
        'tryDetermineGameIdFromHex',
        `Result: ${JSON.stringify(res)}`
      );
      return res;
    });
  }

  public tryDeterminePs1GameIdFromHex(filepath: string) {
    this._logger.log(
      'tryDeterminePs1GameIdFromHex',
      'Trying to determine PS1 Game ID from hex data: ' + filepath
    );
    this.setLoading(true);
    this.setCurrentAction('Determining PS1 Game ID from hex data...');
    return window.libraryAPI
      .tryDeterminePs1GameIdFromHex(filepath)
      .then((res) => {
        this.setCurrentAction('');
        this.setLoading(false);
        this._logger.verbose(
          'tryDeterminePs1GameIdFromHex',
          `Result: ${JSON.stringify(res)}`
        );
        return res;
      });
  }

  /**
   * Auto-discovers a PS2 game ID by reading the disc image itself — a raw byte
   * scan for ISO, on-the-fly decompression for ZSO. Results are cached on the
   * main side per (path, size, mtime).
   */
  public resolveIsoGameId(filepath: string) {
    this._logger.log(
      'resolveIsoGameId',
      'Auto-discovering Game ID from disc image: ' + filepath
    );
    this.setLoading(true);
    this.setCurrentAction('Reading game ID from disc...');
    return window.libraryAPI.resolveIsoGameId(filepath).then((res) => {
      this.setCurrentAction('');
      this.setLoading(false);
      return res;
    });
  }

  /**
   * Discovery half of bulk auto-correction: reads the game ID out of every
   * invalid disc image (ISO via raw scan, ZSO via decompression) and returns
   * the resolved targets. The actual renaming (and optional artwork fetch) is
   * queued by the caller through the jobs service so it shows up in the queue.
   */
  public async planBulkAutoCorrection(): Promise<{
    resolved: { path: string; gameId: string; gameName: string }[];
    skipped: number;
  }> {
    this._logger.log(
      'planBulkAutoCorrection',
      'Discovering game IDs for invalid files…'
    );
    this.setLoading(true);
    this.setCurrentAction('Reading game IDs from invalid files...');

    // Snapshot the list up front — the live subject shifts as files get fixed.
    const files = [...this.currentInvalidFilesValue];
    const resolved: { path: string; gameId: string; gameName: string }[] = [];
    let skipped = 0;

    try {
      for (const file of files) {
        this.setCurrentAction('Reading ' + file.name + '...');

        // Auto-discovery only knows how to read PS2 disc images for now.
        const ext = (file.extension || '').toLowerCase();
        if (ext !== '.iso' && ext !== '.zso') {
          skipped++;
          continue;
        }

        const result = await window.libraryAPI.resolveIsoGameId(file.path);
        if (!result?.success || !result.gameId) {
          skipped++;
          continue;
        }

        resolved.push({
          path: file.path,
          gameId: result.gameId,
          gameName: result.gameName || file.name,
        });
      }
    } finally {
      this.setCurrentAction('');
      this.setLoading(false);
    }

    this._logger.log(
      'planBulkAutoCorrection',
      `Resolved ${resolved.length}, skipped ${skipped}.`
    );
    return { resolved, skipped };
  }

  public async deleteApp(game: Game) {
    if (!game.appFolder || !this.currentDirectory) return;
    this._logger.log('deleteApp', `Deleting app: ${game.title}`);
    this.setLoading(true);
    this.setCurrentAction(`Deleting ${game.title}...`);
    try {
      const res = await window.libraryAPI.deleteApp(
        this.currentDirectory,
        game.appFolder
      );
      if (res.success) {
        this.refreshGamesFiles();
      } else {
        this._logger.error('deleteApp', `Failed to delete: ${res.message}`);
      }
    } catch (error: any) {
      this._logger.error('deleteApp', `Error: ${error?.message || error}`);
    } finally {
      this.setCurrentAction('');
      this.setLoading(false);
    }
  }

  public async deleteGame(game: Game, skipRefresh = false) {
    this._logger.log('deleteGame', `Deleting game: ${game.gameId} (${game.title})`);
    this.setLoading(true);
    this.setCurrentAction(`Deleting ${game.title || game.gameId}...`);

    try {
      const currentDir = this.currentDirectory ?? '';
      const sep = currentDir.includes('\\') ? '\\' : '/';
      const artDir = `${currentDir.replace(/[\\/]$/, '')}${sep}ART`;
      const result = await window.libraryAPI.deleteGameAndRelatedFiles(
        game.path,
        artDir,
        game.gameId,
        game.appFolder
      );

      if (result.success) {
        this._logger.log('deleteGame', `Successfully deleted ${game.gameId}`);
        if (!skipRefresh) {
          this.refreshGamesFiles();
        }
      } else {
        this._logger.error('deleteGame', `Failed to delete: ${result.message}`);
      }
      return result;
    } catch (error: any) {
      this._logger.error('deleteGame', `Error: ${error?.message || error}`);
      return { success: false, entries: [], message: error?.message ?? String(error) };
    } finally {
      this.setCurrentAction('');
      this.setLoading(false);
    }
  }

}
