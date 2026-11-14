import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { Game } from '@shared/types/game.type';

import { LibraryService } from '@shared/services/library.service';
import { JobsService } from '@shared/services/jobs.service';
import { ConfirmDialogService } from '@shared/services/confirm-dialog.service';
import { LucideAngularModule } from 'lucide-angular';
import { GameCfgDialogComponent } from '../game-cfg-dialog/game-cfg-dialog.component';
import { LibraryRenameDialogComponent } from '../rename-dialog/rename-dialog.component';
import { Ps1DeleteDialogComponent } from '../ps1-delete-dialog/ps1-delete-dialog.component';
import { AppDeleteDialogComponent } from '../app-delete-dialog/app-delete-dialog.component';
import { ArtworkWizardDialogComponent } from '../artwork-wizard-dialog/artwork-wizard-dialog.component';

export type GamecardViewMode = 'grid' | 'list';

/**
 * Displays a single game in either grid or list view.
 *
 * Handles artwork rendering, system badges, format labels, and all
 * game-specific actions: configuration editing, renaming, artwork
 * fetching, ZSO compression, and deletion (PS2 / PS1 / App variants).
 */
@Component({
  selector: 'app-gamecard',
  imports: [
    LucideAngularModule,
    GameCfgDialogComponent,
    LibraryRenameDialogComponent,
    Ps1DeleteDialogComponent,
    AppDeleteDialogComponent,
    ArtworkWizardDialogComponent,
  ],
  templateUrl: './gamecard.component.html',
  styleUrl: './gamecard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GamecardComponent {
  /** The game data to render — undefined while the library is loading. */
  readonly game = input<Game | undefined>(undefined);

  /** Whether the library is currently in grid or list view. */
  readonly viewMode = input<GamecardViewMode>('grid');

  /** Emitted when the user clicks the card body to view details. */
  readonly viewDetails = output<Game>();

  // ── Artwork ──────────────────────────────────────────────────────────

  /** The best art asset for the current view mode (ICO in list, COV in grid). */
  readonly displayArt = computed(() => {
    const g = this.game();
    const vm = this.viewMode();
    if (g && Array.isArray(g.art)) {
      const artType = vm === 'list' ? 'ICO' : 'COV';
      return g.art.find((a) => a.type?.toUpperCase() === artType);
    }
    return undefined;
  });

  /** Base64 data-URL of the selected artwork, or null if none found. */
  readonly artSrc = computed(() => {
    const a = this.displayArt();
    return a ? `data:image/png;base64,${a.base64}` : null;
  });

  // ── Labels & badges ──────────────────────────────────────────────────

  /** Human-readable system label for the badge chip. */
  readonly displaySystemLabel = computed(() => {
    const g = this.game();
    if (g?.isPs1Launcher) return 'PS1 App';
    if (g?.system === 'PS1') return 'PS1';
    if (g?.system === 'APPS') return 'APP';
    return 'PS2';
  });

  /** Whether this game is a regular (non-PS1-launcher) ELF app. */
  readonly isApp = computed(() => {
    const g = this.game();
    return g?.system === 'APPS' && !g?.isPs1Launcher;
  });

  /** Whether this game is a PS1 launcher app. */
  readonly isPs1LauncherApp = computed(() => {
    const g = this.game();
    return g?.system === 'APPS' && !!g?.isPs1Launcher;
  });

  /** Format label shown in the chip — "ELF" for regular apps, otherwise format/extension. */
  readonly formatLabel = computed(() => {
    const g = this.game();
    if (g?.system === 'APPS' && !g?.isPs1Launcher) return 'ELF';
    return g?.format || g?.extension || '';
  });

  // ── Action availability ──────────────────────────────────────────────

  /** Whether a PS2 ISO can be compressed to ZSO. */
  readonly canCompressZso = computed(() => {
    const g = this.game();
    if (!g) return false;
    const system = g.system ?? 'PS2';
    const isIso = g.format === 'ISO' || g.extension?.toLowerCase() === 'iso';
    return system === 'PS2' && isIso;
  });

  /** Whether a PS2 ZSO can be decompressed back to an ISO. */
  readonly canDecompressZso = computed(() => {
    const g = this.game();
    if (!g) return false;
    const system = g.system ?? 'PS2';
    const isZso = g.format === 'ZSO' || g.extension?.toLowerCase() === '.zso';
    return system === 'PS2' && isZso;
  });

  /** Whether a PS1 VCD can be converted back to BIN/CUE. */
  readonly canConvertVcdToBin = computed(() => {
    const g = this.game();
    if (!g) return false;
    // Games in POPS/ get format 'POPS' rather than 'VCD' (see
    // LibraryService.parseSingleFile); games in a top-level VCD/ folder
    // (RiptOPL/POPSLoader layout) get 'VCD'. Both are .VCD disc images.
    const isVcd =
      g.format === 'VCD' ||
      g.format === 'POPS' ||
      g.extension?.toLowerCase() === '.vcd';
    return g.system === 'PS1' && isVcd;
  });

  /** Whether an Ember-style PS1 game folder can be converted to a POPS/*.VCD. */
  readonly canConvertEmber = computed(() => {
    const g = this.game();
    if (!g) return false;
    return g.format === 'EMBER' && !!g.path && !!g.gameId;
  });

  /** Whether a POPStarter/POPSLoader PS1 VCD can be converted to Ember (BIN/CUE). */
  readonly canConvertToEmber = computed(() => {
    const g = this.game();
    if (!g) return false;
    const isVcd =
      g.format === 'VCD' ||
      g.format === 'POPS' ||
      g.extension?.toLowerCase() === '.vcd';
    if (!isVcd || !g.path || !g.gameId) return false;
    return g.system === 'PS1' || (g.system === 'APPS' && !!g.isPs1Launcher);
  });

  /** Whether the file can be renamed to the OPL naming convention. */
  readonly canRenameConvention = computed(() => {
    const g = this.game();
    if (!g) return false;
    const system = g.system ?? 'PS2';
    if (g.isPs1Launcher || system === 'PS1') {
      return !!g.path && !!g.gameId && !!g.title && g.format !== 'EMBER';
    }
    return (
      system === 'PS2' &&
      (g.format === 'ISO' || g.format === 'ZSO') &&
      !!g.gameId &&
      !!g.title
    );
  });

  /** Label for the rename/convert menu entry, tailored to the game's system. */
  readonly renameMenuLabel = computed(() => {
    const g = this.game();
    if (!g) return 'Rename to convention…';
    if (g.isPs1Launcher) return 'Rename game…';
    if ((g.system ?? 'PS2') === 'PS1') return 'Convert launcher…';
    return 'Rename to convention…';
  });

  // ── Dialog visibility state ──────────────────────────────────────────

  /** Whether the game-config dialog is open. */
  public showCfg = false;

  /** Whether the rename dialog is open. */
  public showRename = false;

  /** Whether the PS1 delete-progress dialog is open. */
  public showDeleteDialog = false;

  /** Whether the App delete-progress dialog is open. */
  public showAppDeleteDialog = false;

  /** Whether the artwork wizard dialog is open. */
  public showArtworkWizard = false;

  /** Whether the user opted to delete artwork alongside the game. */
  public deleteArtwork = false;

  private readonly _cdr = inject(ChangeDetectorRef);

  constructor(
    public readonly _libraryService: LibraryService,
    private readonly _jobs: JobsService,
    private readonly _confirm: ConfirmDialogService,
  ) { }

  // ── Actions ──────────────────────────────────────────────────────────

  /** Open the game configuration editor dialog. */
  openCfg() {
    if (this.game()) this.showCfg = true;
  }

  /** Open the rename dialog to rename the game file. */
  openRename() {
    if (this.game()) {
      this.showRename = true;
      this._cdr.markForCheck();
    }
  }

  /**
   * Open the artwork wizard for this game.
   * Regular ELF apps are skipped — they have no artwork source.
   */
  fetchArtwork() {
    const g = this.game();
    if (!g) return;
    if (this.isApp()) return;
    this.showArtworkWizard = true;
    this._cdr.markForCheck();
  }

  /** Enqueue a ZSO compression job for a PS2 ISO. */
  async convertToZso() {
    const g = this.game();
    if (!g || !this.canCompressZso()) return;
    const confirmed = await this._confirm.confirm({
      title: 'Convert to ZSO',
      message: `Compress "${g.title || g.gameId}" to ZSO?`,
      detail:
        'This creates a smaller .zso and removes the original .iso once it succeeds.',
      confirmLabel: 'Convert',
    });
    if (!confirmed) return;
    this._jobs.enqueue([
      {
        type: 'zso',
        label: g.title || g.gameId || g.filename,
        filePath: g.path,
        gameId: g.gameId,
        gameName: g.title || '',
        downloadArtwork: false,
        deleteOriginal: true,
      },
    ]);
  }

  /** Enqueue a ZSO -> ISO decompression job. */
  async convertToIso() {
    const g = this.game();
    if (!g || !this.canDecompressZso()) return;
    const confirmed = await this._confirm.confirm({
      title: 'Convert to ISO',
      message: `Decompress "${g.title || g.gameId}" back to ISO?`,
      detail:
        'This creates a full-size .iso and removes the original .zso once it succeeds.',
      confirmLabel: 'Convert',
    });
    if (!confirmed) return;
    this._jobs.enqueue([
      {
        type: 'zso-to-iso',
        label: g.title || g.gameId || g.filename,
        filePath: g.path,
        gameId: g.gameId,
        gameName: g.title || '',
        downloadArtwork: false,
        deleteOriginal: true,
      },
    ]);
  }

  /** Enqueue a VCD -> BIN/CUE conversion job. */
  async convertToBinCue() {
    const g = this.game();
    if (!g || !this.canConvertVcdToBin()) return;
    const confirmed = await this._confirm.confirm({
      title: 'Convert to BIN/CUE',
      message: `Extract "${g.title || g.gameId}" back to BIN/CUE?`,
      detail:
        'This writes a .bin and .cue alongside the .vcd. The .vcd itself is left in place.',
      confirmLabel: 'Convert',
    });
    if (!confirmed) return;
    this._jobs.enqueue([
      {
        type: 'vcd-to-bin',
        label: g.title || g.gameId || g.filename,
        filePath: g.path,
        gameId: g.gameId,
        gameName: g.title || '',
        downloadArtwork: false,
        deleteOriginal: false,
      },
    ]);
  }

  /** Enqueue an Ember-folder -> POPS/*.VCD conversion job (POPSLoader style — no APPS launcher). */
  async convertEmberToPopsLoader() {
    const g = this.game();
    if (!g || !this.canConvertEmber()) return;
    const confirmed = await this._confirm.confirm({
      title: 'Convert to POPSLoader',
      message: `Convert "${g.title || g.gameId}" from Ember to a POPSLoader VCD?`,
      detail:
        'This converts the BIN/CUE to a .vcd under POPS/, migrates its cover art, and removes the Ember game folder once it succeeds.',
      confirmLabel: 'Convert',
    });
    if (!confirmed) return;
    this._jobs.enqueue([
      {
        type: 'ps1-convert-ember',
        label: g.title || g.gameId || g.filename,
        filePath: g.path,
        gameId: g.gameId,
        gameName: g.title || g.gameId,
        downloadArtwork: false,
        launcherMode: 'popsloader',
      },
    ]);
  }

  /** Enqueue an Ember-folder -> POPS/*.VCD conversion job (POPStarter style — with APPS launcher). */
  async convertEmberToPopstarter() {
    const g = this.game();
    if (!g || !this.canConvertEmber()) return;
    const confirmed = await this._confirm.confirm({
      title: 'Convert to POPStarter',
      message: `Convert "${g.title || g.gameId}" from Ember to a POPStarter VCD?`,
      detail:
        'This converts the BIN/CUE to a .vcd under POPS/, creates its APPS launcher, migrates its cover art, and removes the Ember game folder once it succeeds.',
      confirmLabel: 'Convert',
    });
    if (!confirmed) return;
    this._jobs.enqueue([
      {
        type: 'ps1-convert-ember',
        label: g.title || g.gameId || g.filename,
        filePath: g.path,
        gameId: g.gameId,
        gameName: g.title || g.gameId,
        downloadArtwork: false,
        launcherMode: 'popstarter',
        elfPrefix: 'XX.',
      },
    ]);
  }

  /** Enqueue a VCD -> Ember (BIN/CUE) conversion job. */
  async convertToEmber() {
    const g = this.game();
    if (!g || !this.canConvertToEmber()) return;
    const confirmed = await this._confirm.confirm({
      title: 'Convert to Ember',
      message: `Convert "${g.title || g.gameId}" to Ember (BIN/CUE)?`,
      detail:
        'This converts the .vcd to a BIN/CUE under EMBER/games/, migrates its cover art, removes its APPS launcher if any, and deletes the source VCD once it succeeds.',
      confirmLabel: 'Convert',
    });
    if (!confirmed) return;
    this._jobs.enqueue([
      {
        type: 'ps1-convert-to-ember',
        label: g.title || g.gameId || g.filename,
        filePath: g.path,
        gameId: g.gameId,
        gameName: g.title || g.gameId,
        downloadArtwork: false,
        launcherFolder: g.isPs1Launcher ? g.ps1LauncherPath : undefined,
      },
    ]);
  }

  /**
   * Show the appropriate delete confirmation dialog based on game type:
   *   - PS1 launcher → confirm-with-checkbox then PS1 delete dialog
   *   - Regular app   → confirm-with-checkbox then App delete dialog
   *   - PS2 game       → simple confirm then immediate delete
   */
  async confirmDelete() {
    const g = this.game();
    if (!g) return;
    if (g.isPs1Launcher) {
      const result = await this._confirm.confirmWithCheckbox({
        title: 'Delete PS1 Game',
        message: `Delete PS1 game "${g.title}"?`,
        detail:
          'This removes the VCD file, launcher app and POPS subfolder elements (VMCs, CHEATS.TXT, etc.)',
        confirmLabel: 'Delete',
        toggleLabel: 'Also delete game artwork',
      });
      if (result.confirmed) {
        this.deleteArtwork = result.checked;
        this.showDeleteDialog = true;
        this._cdr.markForCheck();
      }
      return;
    }
    if (this.isApp()) {
      const result = await this._confirm.confirmWithCheckbox({
        title: 'Delete App',
        message: `Delete the app "${g.title}"?`,
        detail: 'This removes its APPS folder and all files inside.',
        confirmLabel: 'Delete',
        toggleLabel: 'Also delete game artwork',
      });
      if (result.confirmed) {
        this.deleteArtwork = result.checked;
        this.showAppDeleteDialog = true;
        this._cdr.markForCheck();
      }
      return;
    }
    const confirmed = await this._confirm.confirm({
      title: 'Delete Game',
      message: `Are you sure you want to delete "${g.title || g.gameId}"?`,
      detail: 'This will also remove associated artwork.',
      confirmLabel: 'Delete',
    });
    if (confirmed) {
      this._libraryService.deleteGame(g);
    }
  }
}
