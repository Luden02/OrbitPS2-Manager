import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LucideAngularModule } from 'lucide-angular';
import { LibraryService } from '@shared/services/library.service';
import { KNOWN_ART_TYPES, artTypeLabel } from '@shared/constants/artwork-presets';
import {
  ImportJob,
  JobLogEntry,
  JobsService,
} from '@shared/services/jobs.service';
import { Game } from '@shared/types/game.type';
import {
  ArtScope,
  ArtType,
  DEFAULT_ART_TYPES,
  artTargetsForScope,
  eligibleGamesForScope,
  existingArtTypesForGame,
} from './artwork-bulk.targets';

/** A game in the current scope, along with the asset types on disk. */
interface ScopedGame {
  label: string;
  existing: Set<ArtType>;
}

/** A game in scope that is missing at least one available asset type. */
interface MissingArtItem {
  label: string;
  missingTypes: ArtType[];
}

/**
 * Bulk artwork download dialog.
 *
 * Lets the user pick the target scope (defaults to the active library tab),
 * decide how to handle existing artwork (download only missing files vs
 * overwrite everything) and choose which asset types to fetch. The chosen
 * policy is baked into every queued job so the worker never has to prompt
 * per game. Once started the dialog switches to a live progress log (one
 * entry per game / asset type) and only allows closing once finished.
 *
 * All model state is signal-driven and every derived count is a `computed`,
 * so the view updates purely through the signal graph (no reliance on
 * zone-driven getter re-evaluation, which `eventCoalescing: true` makes
 * unreliable in Electron).
 */
@Component({
  selector: 'app-artwork-bulk-dialog',
  imports: [LucideAngularModule],
  templateUrl: './artwork-bulk-dialog.component.html',
  styleUrl: './artwork-bulk-dialog.component.scss',
})
export class ArtworkBulkDialogComponent implements OnInit {
  /** Scope to preselect on open — usually the active library tab. */
  readonly initialScope = input<ArtScope>('PS2');

  /** Emitted when the dialog should be removed from the DOM. */
  readonly closed = output<void>();

  /** Target library section; the seg-tabs toggle it. */
  readonly scope = signal<ArtScope>('PS2');

  /** `true` → overwrite existing art; `false` → download only missing files. */
  readonly overwrite = signal(false);

  /** Every asset type the picker can offer, in display order. */
  readonly availableArtTypes = KNOWN_ART_TYPES;
  readonly artTypeLabel = artTypeLabel;

  /** Initially empty — nothing is preselected; the user picks what to fetch. */
  readonly artTypes = signal<ArtType[]>([]);

  /** `input` → pick scope/policy; `running` → downloads in progress; `done` → finished. */
  dialogState: 'input' | 'running' | 'done' = 'input';
  running = false;
  done = false;
  succeeded = 0;
  failed = 0;
  cancelled = 0;
  /** Aggregated live log lines for every queued job (in queue order). */
  logEntries: JobLogEntry[] = [];

  /** Latest library snapshot. Kept as a signal so `scopedGames` recomputes
   *  when the library loads or rescans while the dialog is open. */
  private readonly games = signal<Game[]>([]);

  /** Games in the current scope with their on-disk asset types. */
  private readonly scopedGames = computed<ScopedGame[]>(() =>
    eligibleGamesForScope(this.games(), this.scope()).map((g) => ({
      label: g.title || g.gameId || g.filename,
      existing: new Set(existingArtTypesForGame(g, [...this.availableArtTypes])),
    })),
  );

  /** Games readable in the current scope. */
  readonly eligibleCount = computed(() => this.scopedGames().length);

  /** `true` once the library has any data — gates the controls section so the
   *  asset-type picker renders as soon as the library is populated, regardless
   *  of how many games belong to the current scope. */
  readonly libraryLoaded = computed(() => this.games().length > 0);

  /**
   * The asset types that decide the plan and the counts. While the user has
   * not checked anything, the app's default plan (cover/icon/screenshot) is
   * used so the "missing artwork" overview is populated from the start instead
   * of being empty until an asset type is chosen.
   */
  private readonly planTypes = computed(() =>
    this.artTypes().length > 0 ? this.artTypes() : DEFAULT_ART_TYPES,
  );

  /** Games that already have every plan art type on disk. */
  readonly completeCount = computed(() => {
    const types = this.planTypes();
    return this.scopedGames().filter((g) =>
      types.every((t) => g.existing.has(t)),
    ).length;
  });

  /** Games that will actually receive a download on this run. */
  readonly toProcessCount = computed(
    () => this.eligibleCount() - this.completeCount(),
  );

  /**
   * Every game that is missing at least one downloadable art type on disk,
   * evaluated against **all** available types — independent of the checkbox
   * selection, so the overview is complete from the moment the dialog opens.
   * Drives the "Missing artwork" list.
   */
  readonly missingArtItems = computed<MissingArtItem[]>(() => {
    const types = this.availableArtTypes;
    return this.scopedGames()
      .map((g) => ({
        label: g.label,
        missingTypes: types.filter((t) => !g.existing.has(t)),
      }))
      .filter((item) => item.missingTypes.length > 0);
  });

  private jobIds: string[] = [];
  private readonly _cdr = inject(ChangeDetectorRef);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly logAreaRef = viewChild<ElementRef<HTMLElement>>('logArea');

  constructor(
    private readonly _library: LibraryService,
    private readonly _jobs: JobsService,
  ) {}

  ngOnInit() {
    this.scope.set(this.initialScope());
    // The library can finish loading (or rescan) after the dialog opens.
    // Feeding the snapshot into a signal keeps every computed count reactive.
    this._library.library$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((games) => this.games.set(games));
    this._jobs.jobs$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((jobs) => this.onJobs(jobs));
  }

  /** Number of games queued for this run. */
  get totalJobs(): number {
    return this.jobIds.length;
  }

  setScope(scope: ArtScope) {
    this.scope.set(scope);
    // Reset the risky overwrite choice when switching sections so a selection
    // made for one section never silently carries over to another.
    this.overwrite.set(false);
  }

  /** `true` when every offered asset type is currently selected. */
  readonly allArtTypesSelected = computed(
    () => this.artTypes().length === this.availableArtTypes.length,
  );

  /** Select or deselect one asset type. `checked` comes from the DOM checkbox
   *  event, so the model always mirrors what the user actually sees. */
  onArtTypeChange(type: ArtType, checked: boolean) {
    this.artTypes.update((current) =>
      checked
        ? current.includes(type)
          ? current
          : [...current, type]
        : current.filter((t) => t !== type),
    );
  }

  /** Master "All" checkbox: check → select every type, uncheck → clear all. */
  onAllArtTypesChange(checked: boolean) {
    this.artTypes.set(checked ? [...this.availableArtTypes] : []);
  }

  start() {
    if (
      this.eligibleCount() === 0 ||
      this.artTypes().length === 0 ||
      this.running
    )
      return;
    // In "missing only" mode only games that actually lack at least one
    // selected asset type are queued — complete games are skipped entirely
    // (no job, no log line), matching the pre-flight summary.
    const targets = artTargetsForScope(
      this.games(),
      this.scope(),
      this.overwrite()
        ? undefined
        : { onlyMissing: true, artTypes: this.artTypes() },
    );
    if (targets.length === 0) return;

    const created = this._jobs.enqueue(
      targets.map((t) => ({
        type: 'artwork' as const,
        label: t.label,
        filePath: t.path,
        gameId: t.gameId,
        gameName: t.label,
        downloadArtwork: false,
        system: t.system,
        saveAsName: t.saveAsName,
        overwrite: this.overwrite(),
        artTypes: [...this.artTypes()],
        wideSlotFallback: true,
      })),
    );

    this.jobIds = created.map((j) => j.id);
    this.succeeded = 0;
    this.failed = 0;
    this.cancelled = 0;
    this.logEntries = [];
    this.running = true;
    this.done = false;
    this.dialogState = 'running';
    this._cdr.detectChanges();
  }

  close() {
    if (this.running) return;
    this.closed.emit();
  }

  private onJobs(jobs: ImportJob[]): void {
    if (this.dialogState === 'input') return;
    const mine = jobs.filter((j) => this.jobIds.includes(j.id));
    this.logEntries = mine.flatMap((j) => j.logs ?? []);
    this.succeeded = mine.filter((j) => j.status === 'success').length;
    this.failed = mine.filter((j) => j.status === 'error').length;
    this.cancelled = mine.filter((j) => j.status === 'cancelled').length;
    const finished = this.succeeded + this.failed + this.cancelled;
    if (this.running && finished === this.jobIds.length) {
      this.running = false;
      this.done = true;
      this.dialogState = 'done';
    }
    this._cdr.detectChanges();
    this.scrollLogToBottom();
  }

  private scrollLogToBottom(): void {
    const el = this.logAreaRef()?.nativeElement;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
    }
  }
}