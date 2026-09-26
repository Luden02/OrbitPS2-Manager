import { Component, computed, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { Game } from '@shared/types/game.type';
import { JobsService } from '@shared/services/jobs.service';
import { LibraryService } from '@shared/services/library.service';
import {
  ART_CATEGORIES,
  artCategoryForType,
  artSaveNameForType,
  artTypeLabel,
  UNCATEGORIZED_LABEL,
} from '@shared/constants/artwork-presets';

interface ArtworkOption {
  type: string;
  label: string;
  downloadUrl: string;
  alreadySaved: boolean;
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

const SCREENSHOT_RE = /^SCR_(\d{1,2})$/i;

/** How many screenshots Open PS2 Loader shows at most. */
const MAX_SCREENSHOTS = 2;

/** Whether a type is a database screenshot variant (`SCR_00`, `SCR_01`, …). */
function isScreenshotCode(type: string): boolean {
  return SCREENSHOT_RE.test(type);
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
  if (options.every((o) => isScreenshotCode(o.type))) {
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
  readonly skipExisting = signal(false);

  /** Category ids the user has collapsed; everything else stays expanded. */
  readonly collapsed = signal<Set<string>>(new Set());

  readonly selectedCount = computed(() => this.selected().size);

  /** Count of distinct artwork files that already exist on disk. */
  readonly savedCount = computed(
    () =>
      new Set(
        this.options()
          .filter((o) => o.alreadySaved)
          .map((o) => artSaveNameForType(o.type)),
      ).size,
  );

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
        savedCount: new Set(
          catOptions
            .filter((o) => o.alreadySaved)
            .map((o) => artSaveNameForType(o.type)),
        ).size,
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
  ) {}

  private get isPs1Launcher(): boolean {
    return !!this.game().isPs1Launcher;
  }

  private get system(): 'PS1' | 'PS2' {
    return this.game().system === 'PS1' || this.isPs1Launcher ? 'PS1' : 'PS2';
  }

  private get localName(): string {
    return this.isPs1Launcher
      ? this.game().ps1LauncherBoot || this.game().gameId
      : this.game().gameId;
  }

  /**
   * PS1 POPSLoader/RiptOPL VCDs only: the VCD title stem (filename without
   * extension). Their art may be saved either as "<GameID>_<type>.png" or
   * "<Title>_<type>.png", so both names have to be probed to detect what
   * already exists.
   */
  private get ps1VcdStem(): string | undefined {
    const g = this.game();
    if (this.system !== 'PS1' || this.isPs1Launcher || !g.filename) {
      return undefined;
    }
    return g.filename.replace(/\.[^./\\]+$/, '');
  }

  async ngOnInit() {
    const g = this.game();
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
      const ps1VcdStem = this.ps1VcdStem;
      // Existing files are probed by their on-disk name, so backgrounds look
      // for the OPL-compatible `<stem>_BG.png` file.
      const fileNameFor = (stem: string, type: string) =>
        `${stem}_${artSaveNameForType(type)}.png`;
      const expectedFiles = result.data.flatMap((d) => {
        const names = [fileNameFor(localName, d.type)];
        if (ps1VcdStem) names.push(fileNameFor(ps1VcdStem, d.type));
        return names;
      });
      const existing = dirPath
        ? await window.libraryAPI.checkArtFilesExist(`${dirPath}/ART`, expectedFiles)
        : [];
      const existingSet = new Set(existing);

      this.options.set(
        result.data.map((d) => ({
          type: d.type,
          label: artTypeLabel(d.type),
          downloadUrl: d.downloadUrl,
          alreadySaved:
            existingSet.has(fileNameFor(localName, d.type)) ||
            (ps1VcdStem !== undefined &&
              existingSet.has(fileNameFor(ps1VcdStem, d.type))),
        })),
      );

      this.selected.set(
        this.normalizeSelection(new Set(result.data.map((d) => d.type))),
      );
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
      if (isScreenshotCode(t)) count += 1;
    }
    return count >= MAX_SCREENSHOTS;
  }

  /** A screenshot card is disabled once OPL's limit is reached and this one
   *  is not the currently selected card. */
  isCardDisabled(type: string): boolean {
    return (
      isScreenshotCode(type) &&
      !this.isSelected(type) &&
      this.screenshotsFull()
    );
  }

  /** Type codes whose save file is shared with at least one other option
   *  (all `SCR_0n` variants collide on `_SCR{.png|2.png}`, and any other type
   *  whose save base is used by more than one option). Memoised once when the
   *  options change so the template lookups are O(1). */
  private readonly sharedSaveTypes = computed<Set<string>>(() => {
    const baseCount = new Map<string, number>();
    for (const o of this.options()) {
      const base = artSaveNameForType(o.type);
      baseCount.set(base, (baseCount.get(base) ?? 0) + 1);
    }
    const shared = new Set<string>();
    for (const o of this.options()) {
      if (isScreenshotCode(o.type) || (baseCount.get(artSaveNameForType(o.type)) ?? 0) > 1) {
        shared.add(o.type);
      }
    }
    return shared;
  });

  /**
   * Whether an individual "on disk" badge would be misleading: several
   * options save to the same file (all `BG_*` collide on `<stem>_BG.png`, all
   * `SCR_0n` land on `<stem>_SCR.png` or `<stem>_SCR2.png`). The existence is
   * then reported once at the category level instead.
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
    this.selected.set(
      this.normalizeSelection(new Set(this.options().map((o) => o.type))),
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
      } else if (isScreenshotCode(t)) {
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

  isSavedType(type: string): boolean {
    return this.options().some((o) => o.type === type && o.alreadySaved);
  }

  /**
   * "Skip existing artwork" toggle. Turning it on unchecks whatever is already
   * on disk (it would not be downloaded anyway), remembering the selection so
   * turning it off restores exactly what was chosen before.
   */
  onSkipExistingToggle(): void {
    const enabling = !this.skipExisting();
    if (enabling) {
      this.selectionBeforeSkip = new Set(this.selected());
      const kept = [...this.selected()].filter((t) => !this.isSavedType(t));
      this.selected.set(this.normalizeSelection(new Set(kept)));
    } else {
      this.selected.set(new Set(this.selectionBeforeSkip));
    }
    this.skipExisting.set(enabling);
  }

  download(): void {
    const g = this.game();
    let types = Array.from(this.selected());
    if (types.length === 0) return;

    // With "skip existing" on, drop types that already exist under either
    // naming convention (gameId or VCD title stem) — otherwise the worker
    // would only skip gameId-named files and re-fetch a title-saved cover.
    if (this.skipExisting()) {
      const saved = new Set(
        this.options()
          .filter((o) => o.alreadySaved)
          .map((o) => o.type),
      );
      types = types.filter((t) => !saved.has(t));
    }
    if (types.length === 0) {
      this.close();
      return;
    }

    // Family assets keep the DB code for the fetch URL but must be saved under
    // the base file OPL reads. One rule for all three consumers — the "on disk"
    // badge, the skip-existing filter and this map — so a type can never be
    // reported as `GAMEID_SCR2.png` and then written as `GAMEID_SCR.png`.
    // Backgrounds collapse to `<gameID>_BG.png`, `SCR_00` to
    // `<gameID>_SCR.png` and any other `SCR_0n` to `<gameID>_SCR2.png`.
    // (Two chosen screenshots that both resolve to `SCR2`, e.g. `SCR_02` and
    // `SCR_05`, share one file — the category's saved count shows it as one.)
    const artSaveAsOverrides: Record<string, string> = {};
    for (const t of types) {
      const saveBase = artSaveNameForType(t);
      if (saveBase !== t.toUpperCase()) artSaveAsOverrides[t] = saveBase;
    }

    this._jobs.enqueue([
      {
        type: 'artwork',
        label: g.title || g.gameId || g.filename,
        filePath: g.path,
        gameId: g.gameId,
        gameName: g.title || '',
        downloadArtwork: false,
        system: this.system,
        saveAsName: this.isPs1Launcher ? g.ps1LauncherBoot : undefined,
        artTypes: types,
        artSaveAsOverrides:
          Object.keys(artSaveAsOverrides).length > 0
            ? artSaveAsOverrides
            : undefined,
        overwrite: !this.skipExisting(),
      },
    ]);
    this.close();
  }

  close(): void {
    this.closed.emit();
  }
}
