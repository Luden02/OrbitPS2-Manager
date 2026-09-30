import { Component, computed, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { Game } from '@shared/types/game.type';
import { JobsService, NewImportJob } from '@shared/services/jobs.service';
import { LibraryService } from '@shared/services/library.service';
import {
  ART_CATEGORIES,
  artCategoryForType,
  artSaveNameCandidates,
  artSaveNamesForSelection,
  artTypeLabel,
  isScreenshotArtCode,
  MAX_SCREENSHOTS,
  UNCATEGORIZED_LABEL,
} from '@shared/constants/artwork-presets';
import {
  ps1ArtworkIdentities,
  ps1CanonicalRename,
  ps1CanonicalRenameConfirm,
  ps1CanonicalStorageName,
} from '@shared/utils/ps1-artwork-identities';
import { ConfirmDialogService } from '@shared/services/confirm-dialog.service';

interface ArtworkOption {
  type: string;
  label: string;
  downloadUrl: string;
}

interface ArtCategory {
  id: string;
  label: string;
  options: ArtworkOption[];
  allSelected: boolean;
  selectedCount: number;
  /** Some, but not all, options in this category are selected. */
  indeterminate: boolean;
  /** Distinct asset files of this category that already exist on disk. */
  savedCount: number;
}

/** Whether a type belongs to a single-select radio family (backgrounds). */
function isSingleSelectCode(type: string): boolean {
  return type.toUpperCase().startsWith('BG');
}

/** Max options selectable at once in a category: radio families keep one,
   *  screenshot families keep at most the two OPL shows, everything else uses
   *  the full list. */
function categoryMaxSelectable(options: ArtworkOption[]): number {
  if (options.length === 0) return 0;
  if (options.every((o) => isSingleSelectCode(o.type))) return 1;
  if (options.every((o) => isScreenshotArtCode(o.type))) {
    return Math.min(options.length, MAX_SCREENSHOTS);
  }
  return options.length;
}

@Component({
  selector: 'app-artwork-wizard-dialog',
  imports: [LucideAngularModule],
  templateUrl: './artwork-wizard-dialog.component.html',
  styleUrl: './artwork-wizard-dialog.component.scss',
})
export class ArtworkWizardDialogComponent {
  readonly game = input.required<Game>();
  readonly closed = output<void>();

  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly options = signal<ArtworkOption[]>([]);
  readonly selected = signal<Set<string>>(new Set());

  /**
   * Defaults to on. The wizard pre-selects every asset the database offers, so
   * starting at `false` made the very first click a silent overwrite of whatever
   * the user had already curated in their ART folder. It also matches the bulk
   * dialog, which likewise starts on "download only missing files".
   */
  readonly skipExisting = signal(true);

  /** Category ids the user has collapsed; everything else stays expanded. */
  readonly collapsed = signal<Set<string>>(new Set());

  readonly selectedCount = computed(() => this.selected().size);

  /** Save bases already present in the ART folder, e.g. `SCR`, `SCR2`, `COV`. */
  private readonly existingSaveFiles = signal<ReadonlySet<string>>(new Set());

  /**
   * File base every option is written under. The selected types are listed
   * first so the two screenshot slots are handed out by selection order: the
   * first pick is `SCR`, the second `SCR2`, and `SCR_02` + `SCR_05` no longer
   * both claim `SCR2` and overwrite each other. This one assignment feeds the
   * "on disk" badge, the skip-existing filter and the download's save-name
   * overrides, so a type can never be reported against one file and written to
   * another.
   */
  private readonly saveBaseByType = computed<Map<string, string>>(() => {
    const chosen = this.selected();
    return artSaveNamesForSelection([
      ...chosen,
      ...this.options()
        .map((o) => o.type)
        .filter((t) => !chosen.has(t)),
    ]);
  });

  /** File base a type is written under, e.g. `SCR_05` → `SCR2`. */
  saveBaseFor(type: string): string {
    return this.saveBaseByType().get(type) ?? type.toUpperCase();
  }

  /** Whether the file this type would be written to is already on disk. */
  alreadySaved(type: string): boolean {
    return this.existingSaveFiles().has(this.saveBaseFor(type));
  }

  /** Distinct on-disk save files among a set of options. */
  private savedBases(options: ArtworkOption[]): Set<string> {
    return new Set(
      options
        .filter((o) => this.alreadySaved(o.type))
        .map((o) => this.saveBaseFor(o.type)),
    );
  }

  /** Count of distinct artwork files that already exist on disk. */
  readonly savedCount = computed(() => this.savedBases(this.options()).size);

  /** Available artwork grouped by purpose; unknown types land in "Other". */
  readonly categories = computed<ArtCategory[]>(() => {
    const options = this.options();
    const build = (
      id: string,
      label: string,
      catOptions: ArtworkOption[],
    ): ArtCategory => {
      const selectedInCat = catOptions.filter((o) => this.isSelected(o.type));
      // Backgrounds are single-select: OPL only reads one <gameID>_BG.png.
      const single =
        catOptions.length > 0 &&
        catOptions.every((o) => this.isSingleSelectType(o.type));
      // How many of this category's options can actually be selected at once
      // (screenshots cap at the two OPL shows, radio families at one).
      const maxSelectable = categoryMaxSelectable(catOptions);
      return {
        id,
        label,
        options: catOptions,
        allSelected:
          maxSelectable > 0 && selectedInCat.length >= maxSelectable,
        selectedCount: selectedInCat.length,
        indeterminate:
          selectedInCat.length > 0 && selectedInCat.length < maxSelectable,
        savedCount: this.savedBases(catOptions).size,
      };
    };

    const categories = ART_CATEGORIES.map((c) =>
      build(
        c.id,
        c.label,
        options.filter((o) => artCategoryForType(o.type) === c.id),
      ),
    ).filter((c) => c.options.length > 0);

    const otherOptions = options.filter(
      (o) => artCategoryForType(o.type) === undefined,
    );
    if (otherOptions.length > 0) {
      categories.push(build('other', UNCATEGORIZED_LABEL, otherOptions));
    }
    return categories;
  });

  constructor(
    private readonly _jobs: JobsService,
    private readonly _library: LibraryService,
    private readonly _confirm: ConfirmDialogService,
  ) { }

  private get isPs1Launcher(): boolean {
    return !!this.game().isPs1Launcher;
  }

  private get system(): 'PS1' | 'PS2' {
    return this.game().system === 'PS1' || this.isPs1Launcher ? 'PS1' : 'PS2';
  }

  private get localName(): string {
    const g = this.game();
    if (this.isPs1Launcher) {
      return g.ps1LauncherBoot || g.gameId;
    }
    if (g.system === 'PS1') {
      return (
        ps1CanonicalStorageName(g) ||
        (g.format === 'EMBER'
          ? g.emberFolder
          : g.filename?.replace(/\.[^./\\]+$/, '')) ||
        g.gameId
      );
    }
    return g.gameId;
  }

  private get ps1ArtIdentities(): string[] {
    return ps1ArtworkIdentities(this.game());
  }

  /**
   * PS1 discs that could not be identified, or whose serial is shared by
   * several games, must not drive automatic artwork or renames.
   */
  private blockUnresolvedPs1(): boolean {
    const g = this.game();
    return (
      g.system === 'PS1' &&
      !this.isPs1Launcher &&
      g.identificationStatus !== undefined &&
      g.identificationStatus !== 'identified'
    );
  }

  async ngOnInit() {
    const g = this.game();
    if (this.blockUnresolvedPs1()) {
      this.errorMessage.set(
        g.identificationStatus === 'ambiguous'
          ? 'This PS1 serial is shared by multiple discs or editions and could not be resolved safely. Artwork download is disabled until the disc is identified.'
          : 'This PS1 disc could not be identified safely. Artwork download is disabled until the disc is identified.',
      );
      this.loading.set(false);
      return;
    }
    try {
      const result = await window.libraryAPI.listAvailableArt(g.gameId, this.system);

      if (!result?.success) {
        this.errorMessage.set(result?.message || 'Failed to load available artwork.');
        this.loading.set(false);
        return;
      }

      if (result.data.length === 0) {
        this.errorMessage.set(result.message || 'No artwork available for this game yet.');
        this.loading.set(false);
        return;
      }

      const dirPath = this._library.currentDirectoryValue;
      const localName = this.localName;
      // RiptOPL-readable local names for this game: the VCD filename stem plus
      // the GameID only when that stem starts with it. PS2/launcher games fall
      // back to the single GameID/boot name.
      const identities = this.ps1ArtIdentities;
      // Existence is probed by save base, not by database code: art is stored as
      // the file OPL reads, and a screenshot can land on either of the two
      // slots, so both are probed for every screenshot. The exact stem each base
      // may be saved under is kept so a hit maps back to its base unambiguously
      // (`SLUS` must not swallow `SLUS_Title_COV.png`).
      // `localName` is where new art is written, so a file already there must
      // count as existing even when it is not a current RiptOPL identity.
      const stems =
        identities.length > 0
          ? [...new Set([localName, ...identities])]
          : [localName];
      const baseOfFile = new Map<string, string>();
      for (const stem of stems) {
        for (const d of result.data) {
          for (const base of artSaveNameCandidates(d.type)) {
            baseOfFile.set(`${stem}_${base}.png`, base);
          }
        }
      }
      const existing = dirPath
        ? await window.libraryAPI.checkArtFilesExist(
          `${dirPath}/ART`,
          [...baseOfFile.keys()],
        )
        : [];
      this.existingSaveFiles.set(
        new Set(
          existing
            .map((name) => baseOfFile.get(name))
            .filter((base): base is string => base !== undefined),
        ),
      );

      this.options.set(
        result.data.map((d) => ({
          type: d.type,
          label: artTypeLabel(d.type),
          downloadUrl: d.downloadUrl,
        })),
      );

      this.selected.set(
        this.normalizeSelection(new Set(result.data.map((d) => d.type))),
      );
      // "Skip existing" starts on, so the pre-selection must not quietly carry
      // files that are already on disk into a download that would replace them.
      this.selectionBeforeSkip = new Set(this.selected());
      this.applySkipFilter();
      this.loading.set(false);
    } catch (err) {
      this.errorMessage.set(
        err instanceof Error
          ? err.message
          : 'Failed to load available artwork.',
      );
      this.loading.set(false);
    }
  }

  isSelected(type: string): boolean {
    return this.selected().has(type);
  }

  /**
   * Families where Open PS2 Loader only reads the initial asset file, so only
   * one member may be selected (backgrounds). The type codes start with `BG`.
   */
  isSingleSelectType(type: string): boolean {
    return type.toUpperCase().startsWith('BG');
  }

  /** Whether the two allowed screenshots are already selected. */
  screenshotsFull(): boolean {
    let count = 0;
    for (const t of this.selected()) {
      if (isScreenshotArtCode(t)) count += 1;
    }
    return count >= MAX_SCREENSHOTS;
  }

  /** A screenshot card is disabled once OPL's limit is reached and this one
   *  is not the currently selected card. */
  isCardDisabled(type: string): boolean {
    return (
      isScreenshotArtCode(type) &&
      !this.isSelected(type) &&
      this.screenshotsFull()
    );
  }

  /** Type codes whose save file is shared with at least one other option
   *  (any number of `BG_*` collapses on `<stem>_BG.png`, and screenshots past
   *  the first two all land on `<stem>_SCR2.png`). Memoised so the template
   *  lookups are O(1). */
  private readonly sharedSaveTypes = computed<Set<string>>(() => {
    const baseCount = new Map<string, number>();
    for (const o of this.options()) {
      const base = this.saveBaseFor(o.type);
      baseCount.set(base, (baseCount.get(base) ?? 0) + 1);
    }
    return new Set(
      this.options()
        .filter((o) => (baseCount.get(this.saveBaseFor(o.type)) ?? 0) > 1)
        .map((o) => o.type),
    );
  });

  /**
   * Whether an individual "on disk" badge would be misleading: several options
   * save to the same file (any `BG_*` collapses on `<stem>_BG.png`, screenshots
   * past the second on `<stem>_SCR2.png`). The existence is then reported once
   * at the category level instead.
   */
  sharesSaveTarget(type: string): boolean {
    return this.sharedSaveTypes().has(type);
  }

  /** Whether every option of a category is single-select (radio group). */
  isSingleSelectCategory(category: ArtCategory): boolean {
    return (
      category.options.length > 0 &&
      category.options.every((o) => this.isSingleSelectType(o.type))
    );
  }

  toggle(type: string): void {
    const next = new Set(this.selected());
    if (next.has(type)) {
      next.delete(type);
    } else {
      if (this.isSingleSelectType(type)) {
        for (const t of next) {
          if (this.isSingleSelectType(t)) next.delete(t);
        }
      }
      next.add(type);
    }
    this.selected.set(this.normalizeSelection(next));
  }

  /** Select or deselect a category. "Select" picks the first maxSelectable
   *  options (radio families one, screenshots the two OPL shows); deselect
   *  clears every option in the category. */
  toggleCategory(category: ArtCategory): void {
    const next = new Set(this.selected());
    if (category.allSelected) {
      for (const option of category.options) next.delete(option.type);
    } else {
      const maxSelectable = categoryMaxSelectable(category.options);
      for (const option of category.options) next.delete(option.type);
      for (const option of category.options.slice(0, maxSelectable)) {
        next.add(option.type);
      }
    }
    this.selected.set(this.normalizeSelection(next));
  }

  /** Collapse or expand a category's thumbnail grid. */
  toggleExpanded(category: ArtCategory): void {
    const next = new Set(this.collapsed());
    if (next.has(category.id)) next.delete(category.id);
    else next.add(category.id);
    this.collapsed.set(next);
  }

  isCollapsed(id: string): boolean {
    return this.collapsed().has(id);
  }

  selectAll(): void {
    const all = this.options().map((o) => o.type);
    // "Select all" must not quietly re-check files the active policy leaves
    // alone, or the button's count stops matching what a download would write.
    // Filtering before normalising lets a freed screenshot/background slot be
    // filled by the next candidate rather than sitting empty.
    this.selected.set(
      this.normalizeSelection(
        new Set(this.skipExisting() ? all.filter((t) => !this.alreadySaved(t)) : all),
      ),
    );
  }

  /**
   * Normalises a selection so radio families (backgrounds) keep exactly one
   * member and screenshot families keep at most two (the ones Open PS2 Loader
   * reads). Iteration order keeps the first members.
   */
  private normalizeSelection(types: Set<string>): Set<string> {
    const next = new Set(types);
    let singleKept = false;
    let screenshotsKept = 0;
    for (const t of [...next]) {
      if (this.isSingleSelectType(t)) {
        if (singleKept) next.delete(t);
        else singleKept = true;
      } else if (isScreenshotArtCode(t)) {
        if (screenshotsKept < MAX_SCREENSHOTS) screenshotsKept += 1;
        else next.delete(t);
      }
    }
    return next;
  }

  deselectAll(): void {
    this.selected.set(new Set());
  }

  /** Selection snapshot taken when "skip existing" is switched on. */
  private selectionBeforeSkip = new Set<string>();

  /**
   * Uncheck every option whose file is already in the ART folder, so the cards
   * the user sees match what a download would actually write.
   */
  private applySkipFilter(): void {
    const kept = [...this.selected()].filter((t) => !this.alreadySaved(t));
    this.selected.set(this.normalizeSelection(new Set(kept)));
  }

  /**
   * On-disk save files among the options that are currently *selected* — what
   * this run would actually replace, rather than everything the game has.
   */
  private readonly selectedSavedBases = computed(() =>
    this.savedBases(this.options().filter((o) => this.selected().has(o.type))),
  );

  /**
   * Whether this run would replace a file that already exists: skip-existing is
   * off and a selected option is on disk. This is what the footer button
   * announces, and what decides whether the worker needs to ask first.
   */
  readonly willOverwriteSelected = computed(
    () =>
      !this.skipExisting() &&
      this.selectedCount() > 0 &&
      this.selectedSavedBases().size > 0,
  );

  /**
   * "Skip existing artwork" toggle. Turning it on unchecks whatever is already
   * on disk (it would not be downloaded anyway), remembering the selection so
   * turning it off restores exactly what was chosen before.
   */
  onSkipExistingToggle(): void {
    const enabling = !this.skipExisting();
    if (enabling) {
      this.selectionBeforeSkip = new Set(this.selected());
      this.applySkipFilter();
    } else {
      this.selected.set(new Set(this.selectionBeforeSkip));
    }
    this.skipExisting.set(enabling);
  }

  download(): void {
    const g = this.game();
    if (this.blockUnresolvedPs1()) return;
    let types = Array.from(this.selected());
    if (types.length === 0) return;

    // With "skip existing" on, drop types whose file already exists under the
    // save base it would be written to (gameId- or VCD-title-named alike) —
    // otherwise the worker would only skip gameId-named files and re-fetch a
    // title-saved cover.
    if (this.skipExisting()) {
      types = types.filter((t) => !this.alreadySaved(t));
    }
    if (types.length === 0) {
      this.close();
      return;
    }

    // Family assets keep the DB code for the fetch URL but must be saved under
    // the file OPL reads. One assignment for all three consumers — the "on
    // disk" badge, the skip-existing filter and this map — so a type can never
    // be reported as `GAMEID_SCR2.png` and then written as `GAMEID_SCR.png`.
    // Backgrounds collapse to `<gameID>_BG.png`; the two screenshot slots go
    // out by selection order, so the first pick is `<gameID>_SCR.png` and the
    // second `<gameID>_SCR2.png` — two picks are always two files, never one
    // written twice.
    const artSaveAsOverrides: Record<string, string> = {};
    for (const t of types) {
      const saveBase = this.saveBaseFor(t);
      if (saveBase !== t.toUpperCase()) artSaveAsOverrides[t] = saveBase;
    }

    const job: NewImportJob = {
      type: 'artwork',
      label: g.title || g.gameId || g.filename,
      filePath: g.path,
      gameId: g.gameId,
      gameName: g.title || '',
      downloadArtwork: false,
      system: this.system,
      // PS1 VCDs save under their on-disk filename stem so RiptOPL reads them
      // from `ART/<VCD_FILENAME>_<TYPE>.png`; launchers keep the boot ELF name.
      saveAsName: this.isPs1Launcher
        ? g.ps1LauncherBoot
        : this.system === 'PS1'
          ? this.localName
          : undefined,
      normalizeKind:
        g.system === 'PS1' && !this.isPs1Launcher && g.canonicalTitle
          ? g.format === 'EMBER'
            ? 'EMBER'
            : 'VCD'
          : undefined,
      canonicalName:
        g.system === 'PS1' && !this.isPs1Launcher
          ? ps1CanonicalStorageName(g)
          : undefined,
        artTypes: types,
        artSaveAsOverrides:
          Object.keys(artSaveAsOverrides).length > 0
            ? artSaveAsOverrides
            : undefined,
        // `true` — the reviewed selection knowingly replaces files on disk;
        // `false` — "skip existing" is on, so fetch only what is missing;
        // `undefined` — nothing selected exists yet, nothing to confirm.
        //
        // The three states must not be collapsed. Sending `true` whenever skip is
        // off silently replaced artwork a user had already curated, and the
        // footer was still labelled "Download Selected". Sending `undefined`
        // under a skip policy would instead let the worker pop a confirmation
        // for a run that is only ever meant to fill gaps.
        overwrite: this.willOverwriteSelected()
          ? true
          : this.skipExisting()
            ? false
            : undefined,
    };

    // RiptOPL keys PS1 artwork by the VCD/Ember folder name, so the job renames
    // storage to the canonical title first. Warn before touching the filename;
    // "No" leaves the wizard open and nothing is queued.
    const rename = job.normalizeKind ? ps1CanonicalRename(g) : undefined;
    if (!rename) {
      this._jobs.enqueue([job]);
      this.close();
      return;
    }

    // A second click while the prompt is open must not queue a second
    // normalize/download job for the same disc.
    if (this.confirmingRename) return;
    this.confirmingRename = true;
    void this._confirm
      .confirm(ps1CanonicalRenameConfirm([rename]))
      .then((proceed) => {
        if (!proceed) return;
        this._jobs.enqueue([job]);
        this.close();
      })
      .finally(() => {
        this.confirmingRename = false;
      });
  }

  private confirmingRename = false;

  close(): void {
    this.closed.emit();
  }
}
