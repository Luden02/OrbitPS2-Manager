/** Electron preload (contextBridge) API exposed on `window.libraryAPI`. */
declare interface Window {
  libraryAPI: {
    /** Open native directory picker. */
    openAskDirectory: () => Promise<any>;

    /** List game files in a directory. */
    getGamesFiles: (dirPath: string) => Promise<any>;

    /** Check whether an OPL directory structure exists. */
    checkOplStructure: (dirPath: string) => Promise<{
      success: boolean;
      existing?: string[];
      missing?: string[];
      message?: string;
    }>;

    /** Create OPL folder structure under a root directory. */
    createOplFolders: (
      dirPath: string,
      folders: string[],
    ) => Promise<{ success: boolean; created?: string[]; message?: string }>;

    /** List USB Advance (UL) games. */
    getULGames: (dirPath: string) => Promise<any>;

    /** List artwork files in the ART folder. */
    getArtFolder: (dirPath: string) => Promise<any>;

    /** Scan EMBER/games/<folder>/ and identify each game from its CUE/BIN data track. */
    getEmberGames: (emberPath: string) => Promise<{
      success: boolean;
      gamesDir?: string;
      games: Array<{
        folderName: string;
        path: string;
        cuePath: string;
        gameId?: string;
        gameName?: string;
        sizeBytes: number;
        message?: string;
      }>;
      message?: string;
    }>;

    /** Rename a game file and optionally update its CFG. */
    renameGamefile: (
      dirPath: string,
      gameId: string,
      gameName: string,
      nameOnly?: boolean,
    ) => Promise<any>;

    /** Step 1 of PS1 launcher rename — prepare paths and content. */
    renamePs1LauncherStep1: (
      vcdPath: string,
      gameId: string,
      newTitle: string,
    ) => Promise<{
      success: boolean;
      newVcdPath?: string;
      oldElfFile?: string;
      newElfFile?: string;
      newCfgContent?: string;
      newAppsFolder?: string;
      safeNewTitle?: string;
      message?: string;
    }>;

    /** Step 2 of PS1 launcher rename — apply the changes. */
    renamePs1LauncherStep2: (params: {
      newAppsFolder: string;
      oldElfFile?: string;
      newElfFile?: string;
      newCfgContent?: string;
      newTitle: string;
    }) => Promise<{ success: boolean; message?: string }>;

    /** Normalize a RiptOPL VCD filename or Ember game-folder identity. */
    normalizeRiptOplPs1Storage: (params: {
      kind: 'VCD' | 'EMBER';
      sourcePath: string;
      gameId: string;
      canonicalTitle: string;
      artDir: string;
    }) => Promise<{
      success: boolean;
      changed?: boolean;
      newPath?: string;
      localName?: string;
      message?: string;
    }>;

    /** Listen for PS1 rename progress events. */
    onRenamePs1Progress: (
      callback: (progress: { percent: number; stage: string }) => void,
    ) => void;

    /** Remove all PS1 rename progress listeners. */
    removeAllRenamePs1ProgressListeners: () => void;

    /**
     * Converts a POPStarter-launched PS1 game to POPSLoader style: strips
     * the GameID prefix from the VCD filename and deletes the APPS launcher
     * folder.
     */
    convertPs1ToPopsLoader: (
      vcdPath: string,
      gameId: string,
    ) => Promise<{ success: boolean; newVcdPath?: string; message?: string }>;

    /** Listen for PS1-to-POPSLoader conversion progress events. */
    onConvertPs1PopsLoaderProgress: (
      callback: (progress: { percent: number; stage: string }) => void,
    ) => void;

    /** Remove all PS1-to-POPSLoader conversion progress listeners. */
    removeAllConvertPs1PopsLoaderProgressListeners: () => void;

    /**
     * Reverses convertPs1ToPopsLoader: prefixes the VCD with its GameID,
     * recreates the APPS/POPStarter launcher, and renames matching ART/
     * files back to the launcher's ELF-filename convention.
     */
    convertPs1ToPopstarter: (
      vcdPath: string,
      gameId: string,
      gameName: string,
      elfPrefix: string,
    ) => Promise<{ success: boolean; newVcdPath?: string; message?: string }>;

    /** Listen for PS1-to-POPStarter conversion progress events. */
    onConvertPs1PopstarterProgress: (
      callback: (progress: { percent: number; stage: string }) => void,
    ) => void;

    /** Remove all PS1-to-POPStarter conversion progress listeners. */
    removeAllConvertPs1PopstarterProgressListeners: () => void;

    /** Listen for PS1 delete progress events. */
    onDeletePs1Progress: (
      callback: (entry: {
        label: string;
        path?: string;
        success: boolean;
        error?: string;
      }) => void,
    ) => void;

    /** Remove all PS1 delete progress listeners. */
    removeAllDeletePs1ProgressListeners: () => void;

    /**
     * Download cover/background art for a game by its ID.
     *
     * `saveAsByType` overrides only the local file name (the wizard fetches
     * `SCR_05` but stores it as `SCR`). `wideSlotFallback` also accepts the
     * remaining indexed variants of a family, so a bulk run fills `SCR`/`SCR2`/
     * `BG` even when the database holds only e.g. `SCR_05`.
     */
    downloadArtByGameId: (
      dirPath: string,
      gameId: string,
      system?: 'PS1' | 'PS2',
      saveAsName?: string,
      artTypes?: string[],
      saveAsByType?: Record<string, string>,
      wideSlotFallback?: boolean,
    ) => Promise<any>;

    /** Check which of the given filenames exist in the art directory. */
    checkArtFilesExist: (
      artDir: string,
      filenames: string[],
    ) => Promise<string[]>;

    /** List the artwork actually available for a game in the art database. */
    listAvailableArt: (
      gameId: string,
      system?: 'PS1' | 'PS2',
    ) => Promise<{
      success: boolean;
      data: { type: string; fileName: string; downloadUrl: string }[];
      message?: string;
    }>;

    /** Try to determine a game ID from a binary file via hex patterns. */
    tryDetermineGameIdFromHex: (filepath: string) => Promise<any>;

    /** Resolve PS2 game ID from an ISO file. */
    resolveIsoGameId: (filepath: string) => Promise<{
      success: boolean;
      gameId?: string;
      gameName?: string;
      message?: string;
    }>;

    /** Open native file picker for game files (CD/DVD). isGamePsx also allows picking a .zip containing the .cue/.bin. */
    openAskGameFiles: (isGameCd: boolean, isGameDvd: boolean, isGamePsx?: boolean) => Promise<any>;

    /** Try to determine PS1 game ID from a binary file via hex patterns. */
    tryDeterminePs1GameIdFromHex: (filepath: string) => Promise<any>;

    /** Try to determine PS1 game ID from a VCD file. */
    tryDeterminePs1GameIdFromVcd: (filepath: string) => Promise<{
      success: boolean;
      gameId?: string;
      formattedGameId?: string;
      gameName?: string;
      message?: string;
    }>;

    /**
     * Import a PS1 game (cue + bin/iso → VCD + POPStarter config). If gameId/
     * gameName are omitted, they're auto-detected from the disc; when no
     * registered Sony game ID can be found (e.g. homebrew), the backend
     * auto-assigns a non-conflicting HBRW_###.## id instead of failing.
     */
    importPs1Game: (
      cueFilePath: string,
      oplRoot: string,
      elfPrefix: string,
      downloadArtwork: boolean,
      gameId?: string,
      gameName?: string,
      launcherMode?: 'popstarter' | 'popsloader',
    ) => Promise<any>;

    /** Listen for PS1 import progress events. */
    onPs1ImportProgress: (
      callback: (progress: { percent: number; stage: string }) => void,
    ) => void;

    /** Remove all PS1 import progress listeners. */
    removeAllPs1ImportProgressListeners: () => void;

    /** Import a PS2 CD game (cue → ISO + CFG). */
    importPs2CdGame: (
      cueFilePath: string,
      oplRoot: string,
      gameId: string | undefined,
      gameName: string | undefined,
      downloadArtwork: boolean,
    ) => Promise<any>;

    /** Listen for PS2 CD import progress events. */
    onPs2CdImportProgress: (
      callback: (progress: { percent: number; stage: string }) => void,
    ) => void;

    /** Remove all PS2 CD import progress listeners. */
    removeAllPs2CdImportProgressListeners: () => void;

    /** Compress an ISO to ZSO format. */
    compressIsoToZso: (
      isoPath: string,
      zsoPath: string,
      deleteOriginal: boolean,
    ) => Promise<any>;

    /** Listen for ZSO compression progress events. */
    onZsoCompressProgress: (
      callback: (progress: { percent: number; stage: string }) => void,
    ) => void;

    /** Remove all ZSO compression progress listeners. */
    removeAllZsoCompressProgressListeners: () => void;

    /** Decompress a ZSO back to a plain ISO. */
    decompressZsoToIso: (
      zsoPath: string,
      isoPath: string,
      deleteOriginal: boolean,
    ) => Promise<any>;

    /** Listen for ZSO decompression progress events. */
    onZsoDecompressProgress: (
      callback: (progress: { percent: number; stage: string }) => void,
    ) => void;

    /** Remove all ZSO decompression progress listeners. */
    removeAllZsoDecompressProgressListeners: () => void;

    /** Convert a VCD (POPS/PS1) image back to BIN/CUE. */
    convertVcdToBin: (
      vcdPath: string,
      binPath: string,
      cuePath: string,
      deleteOriginal: boolean,
    ) => Promise<any>;

    /** Listen for VCD -> BIN/CUE conversion progress events. */
    onVcdToBinProgress: (
      callback: (progress: { percent: number; stage: string }) => void,
    ) => void;

    /** Remove all VCD -> BIN/CUE conversion progress listeners. */
    removeAllVcdToBinProgressListeners: () => void;

    /** List all APPS folders (ELF homebrew). */
    getApps: (oplRoot: string) => Promise<{
      success: boolean;
      apps: {
        folder: string;
        title: string;
        boot: string;
        path: string;
        sizeBytes: number;
      }[];
      message?: string;
    }>;

    /** List all PS1 POPStarter launchers in APPS. */
    getPs1Launchers: (oplRoot: string) => Promise<{
      success: boolean;
      launchers: {
        folder: string;
        title: string;
        boot: string;
        path: string;
        sizeBytes: number;
        gameId?: string;
      }[];
      message?: string;
    }>;

    /** Update the title.cfg of a PS1 launcher. */
    updatePs1TitleCfg: (
      launcherPath: string,
      newTitle: string,
      gameId?: string,
    ) => Promise<{ success: boolean; message?: string }>;

    /** Open native file picker for ELF files. */
    openAskElfFiles: () => Promise<any>;

    /** Import an ELF file as a homebrew app. */
    importApp: (
      oplRoot: string,
      elfPath: string,
      title: string,
    ) => Promise<{ success: boolean; folder?: string; message?: string }>;

    /** Delete an APPS folder. */
    deleteApp: (
      oplRoot: string,
      folder: string,
    ) => Promise<{ success: boolean; message?: string }>;

    /** Delete an APPS folder with per-file progress reporting. */
    deleteAppWithProgress: (
      oplRoot: string,
      folder: string,
      bootName?: string,
    ) => Promise<{ success: boolean; entries: Array<{ label: string; path?: string; success: boolean; error?: string }> }>;

    /** Listen for app delete progress events. */
    onDeleteAppProgress: (
      callback: (entry: { label: string; path?: string; success: boolean; error?: string }) => void,
    ) => void;

    /** Remove all app delete progress listeners. */
    removeAllDeleteAppProgressListeners: () => void;

    /** List all virtual memory cards (VMC). */
    listVmc: (oplRoot: string) => Promise<{
      success: boolean;
      cards: { name: string; sizeBytes: number; sizeMb: number }[];
      message?: string;
    }>;

    /** Check which VMC slots exist for a PS1 game. */
    checkPopsVmc: (
      oplRoot: string,
      gameTitle: string,
    ) => Promise<{
      success: boolean;
      slot0: string | null;
      slot1: string | null;
    }>;

    /** Create a new virtual memory card. */
    createVmc: (
      oplRoot: string,
      name: string,
      sizeMb: number,
    ) => Promise<{ success: boolean; name?: string; message?: string }>;

    /** Delete a virtual memory card. */
    deleteVmc: (
      oplRoot: string,
      name: string,
    ) => Promise<{ success: boolean; message?: string }>;

    /** Read and parse an APPS `title.cfg` file. */
    readAppTitleCfg: (
      oplRoot: string,
      folder: string,
    ) => Promise<{
      success: boolean;
      title?: string;
      boot?: string;
      gameId?: string;
      developer?: string;
      genre?: string;
      release?: string;
      ratingText?: string;
      rating?: string;
      description?: string;
      parentalText?: string;
      parental?: string;
      playersText?: string;
      message?: string;
    }>;
    /** Read a game CFG file (`CFG/<gameId>.cfg`). */
    readGameCfg: (
      oplRoot: string,
      gameId: string,
    ) => Promise<{
      success: boolean;
      entries: Record<string, string>;
      message?: string;
    }>;

    /** Write entries to a game CFG file. */
    writeGameCfg: (
      oplRoot: string,
      gameId: string,
      entries: Record<string, string>,
    ) => Promise<{ success: boolean; message?: string }>;

    /** Delete a game and all related files (CFG, ART, launcher, etc.). */
    deleteGameAndRelatedFiles: (
      gamePath: string,
      artDir: string,
      gameId: string,
      launcherFolder?: string,
      bootName?: string,
    ) => Promise<{
      success: boolean;
      entries: Array<{ label: string; path?: string; success: boolean; error?: string }>;
      message?: string;
    }>;

    /** Move a file from source to destination. */
    moveFile: (sourcePath: string, destPath: string) => Promise<any>;

    /** Listen for file move progress events. */
    onMoveFileProgress: (
      callback: (progress: {
        percent: number;
        copiedMB: number;
        totalMB: number;
        elapsed: number;
      }) => void,
    ) => void;

    /** Remove all file move progress listeners. */
    removeAllMoveFileProgressListeners: () => void;

    /** Listen for main-process log entries. */
    onMainLog: (
      callback: (entry: {
        level: string;
        location?: string;
        message: string;
        timestamp: string;
      }) => void,
    ) => void;

    /** Remove all main-log listeners. */
    removeAllMainLogListeners: () => void;

    /** Toggle the global loading overlay. */
    setLoadingState: (isLoading: boolean) => void;

    /** Read all application settings. */
    getSettings: () => Promise<AppSettings>;

    /** Update a single application setting. */
    setSetting: <K extends keyof AppSettings>(
      key: K,
      value: AppSettings[K],
    ) => Promise<AppSettings>;

    /** Check whether a directory exists on disk. */
    directoryExists: (dirPath: string) => Promise<boolean>;

    /** Check for application updates. */
    checkForUpdates: () => Promise<UpdateCheckResult>;

    /** Open a URL in the default system browser. */
    openExternal: (url: string) => Promise<boolean>;
  };

  windowAPI: {
    /** Node's `process.platform` for the main process (e.g. 'win32', 'linux', 'darwin'). */
    platform: () => Promise<NodeJS.Platform>;

    /** Whether the platform WM supports minimize and maximize (false on tiling WMs). */
    canWindowControls: () => Promise<{ canMinimize: boolean; canMaximize: boolean }>;

    /** Detected desktop environment or window manager on Linux (empty on other platforms). */
    wmInfo: () => Promise<{ name: string; env: Record<string, string> }>;

    /** Minimize the current window. */
    minimize: () => void;

    /** Toggle the current window between maximized and restored. */
    maximizeToggle: () => void;

    /** Close the current window. */
    close: () => void;

    /** Whether the current window is currently maximized. */
    isMaximized: () => Promise<boolean>;

    /** Listen for maximize/unmaximize state changes. */
    onMaximizedChange: (callback: (isMaximized: boolean) => void) => void;

    /** Remove all maximized-change listeners. */
    removeAllMaximizedChangeListeners: () => void;
  };
}

/** Result of an update check against the release server. */
declare interface UpdateCheckResult {
  /** Whether a newer version is available. */
  updateAvailable: boolean;
  /** Currently installed version. */
  currentVersion: string;
  /** Latest available version (if update is available). */
  latestVersion?: string;
  /** URL to the release page. */
  releaseUrl?: string;
  /** Name/title of the latest release. */
  releaseName?: string;
  /** Error message if the check failed. */
  error?: string;
}

/** Application-wide settings persisted to disk. */
declare interface AppSettings {
  /** Most recently opened OPL root directory. */
  lastDirectory?: string;
  /** Whether to auto-reconnect to the last directory on startup. */
  autoReconnect: boolean;
  /** Last-picked PS1 launcher style on the Import screen. */
  ps1LauncherMode?: 'popstarter' | 'popsloader';
  /** Optional Ember root/games folder overrides keyed by mounted OPL root. */
  emberDirectories?: Record<string, string>;
  /** UI color theme. "system" follows the OS light/dark preference (OrbitPS2 only). */
  theme: 'orbitps2' | 'orbitps2-light' | 'legacy' | 'system';
}

