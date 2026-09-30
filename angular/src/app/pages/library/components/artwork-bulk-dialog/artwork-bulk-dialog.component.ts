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
import { ps1CanonicalRenameConfirm } from '@shared/utils/ps1-artwork-identities';
import { ConfirmDialogService } from '@shared/services/confirm-dialog.service';
import {
  ArtScope,
  ArtTarget,
  ArtType,
  DEFAULT_ART_TYPES,
  artTargetsForScope,
  eligibleGamesForScope,
  existingArtTypesForGame,
} from './artwork-bulk.targets';

/**
 * Identity of a game in the current scope, used to key the rendered rows.
 *
 * A title is neither unique (two folders can hold the same game name) nor
 * always present, so it cannot identify a row. `gameId` plus the file path
 * mirrors what the queued jobs are keyed by, and a path is unique by
 * definition.
 */
function scopedGameKey(gameId: string, path: string): string {
  return `${gameId}\u0000${path}`;
}

/** A game in the current scope, along with the asset types on disk. */
interface ScopedGame {
  label: string;
  gameId: string;
  path: string;
  /** Stable row identity for `@for` tracking — see `scopedGameKey`. */
  key: string;
  existing: Set<ArtType>;
}

/** A game in scope that is missing at least one available asset type. */
interface MissingArtItem {
  label: string;
  gameId: string;
  path: string;
  key: string;
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
  /**
   * Games whose job reported `success` but logged at least one per-type error
   * (a cover that wrote, a screenshot that 404'd). The worker has to return
   * `success` for those so the game still reaches `pendingArtRefresh`, which
   * means the job status alone reports them as clean — the dialog has to
   * surface the partial runs itself.
   */
  partial = 0;
  /** `failed` or `partial` — anything that did not come out completely clean. */
  hasIssues = false;
  /** Set once Cancel is pressed: the run is winding down and closes as soon as
   *  the job in flight has finished its current file. */
  cancelling = false;
  /** Aggregated live log lines for every queued job (in queue order). */
  logEntries: JobLogEntry[] = [];

  /** Latest library snapshot. Kept as a signal so `scopedGames` recomputes
   *  when the library loads or rescans while the dialog is open. */
  private readonly games = signal<Game[]>([]);

  /** Games in the current scope with their on-disk asset types. */
  private readonly scopedGames = computed<ScopedGame[]>(() =>
    eligibleGamesForScope(this.games(), this.scope()).map((g) => ({
      label: g.title || g.gameId || g.filename,
      gameId: g.gameId,
      path: g.path,
      key: scopedGameKey(g.gameId, g.path),
      existing: new Set(existingArtTypesForGame(g, [...this.availableArtTypes])),
    })),
  );

  /** Games readable in the current scope. */
  readonly eligibleCount = computed(() => this.scopedGames().length);

  /**
   * `true` once `library$` has emitted at least once, an empty list included.
   *
   * This gates the loading spinner, so it must be driven by the emission itself
   * and never by the list being non-empty: an empty library emits `[]`, which
   * left the dialog on "Loading library…" forever with the "no games in this
   * section" state underneath it unreachable.
   */
  readonly libraryLoaded = signal(false);

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
        gameId: g.gameId,
        path: g.path,
        key: g.key,
        missingTypes: types.filter((t) => !g.existing.has(t)),
      }))
      .filter((item) => item.missingTypes.length > 0);
  });

  private jobIds: string[] = [];
  /** Latest queue snapshot, kept so Cancel can tell queued jobs from the running
   *  one. */
  private jobsSnapshot: ImportJob[] = [];
  /** Jobs Cancel pulled from the queue before they could start. Counted here
   *  rather than read back off `jobsSnapshot`, since they are no longer there. */
  private droppedCount = 0;

  /**
   * When the current run started, or `null` when idle.
   *
   * Drives the elapsed counter in the running header. A game's whole download
   * happens inside one `downloadArtByGameId` call that emits no log lines of
   * its own, so with the wide screenshot fallback one game can spend many
   * seconds walking ~30 candidate URLs in complete silence — the log and the
   * ok/failed counts both sit still, which reads as a frozen app.
   */
  private readonly runStartedAt = signal<number | null>(null);

  /** Ticked once a second while a run is active, purely to advance the label. */
  private readonly now = signal(0);

  /**
   * Elapsed run time as `m:ss`, widening to `h:mm:ss` past an hour.
   *
   * Empty when idle. Signal-driven rather than a plain field so the one-second
   * tick refreshes it without relying on zone-driven re-evaluation, which the
   * app's `eventCoalescing` makes unreliable in Electron.
   */
  readonly elapsedLabel = computed(() => {
    const started = this.runStartedAt();
    if (started === null) return '';
    const total = Math.max(0, Math.floor((this.now() - started) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  });

  private readonly _cdr = inject(ChangeDetectorRef);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly logAreaRef = viewChild<ElementRef<HTMLElement>>('logArea');
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly _library: LibraryService,
    private readonly _jobs: JobsService,
    private readonly _confirm: ConfirmDialogService,
  ) {
    // Never leave the interval running past the dialog's own lifetime.
    this._destroyRef.onDestroy(() => this.stopElapsedTimer());
  }

  private startElapsedTimer(): void {
    this.stopElapsedTimer();
    this.runStartedAt.set(Date.now());
    this.now.set(Date.now());
    this.elapsedTimer = setInterval(() => this.now.set(Date.now()), 1000);
  }

  private stopElapsedTimer(): void {
    if (this.elapsedTimer !== null) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
    this.runStartedAt.set(null);
  }

  ngOnInit() {
    this.scope.set(this.initialScope());
    // The library can finish loading (or rescan) after the dialog opens.
    // Feeding the snapshot into a signal keeps every computed count reactive.
    this._library.library$
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((games) => {
        this.games.set(games);
        // Any emission counts as an answer, `[]` included — an empty library is
        // a loaded library with nothing in it.
        this.libraryLoaded.set(true);
      });
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
      this.running ||
      this.confirmingRenames
    )
      return;

    // RiptOPL keys PS1 artwork by the VCD/Ember folder name, so PS1 storage is
    // always normalized to the canonical title. Renaming files on disk is
    // never done silently: warn with the full list and let "No" cancel the run.
    const targets = artTargetsForScope(this.games(), this.scope(), this.targetOptions());
    if (targets.length === 0) return;

    const renames = targets.flatMap((t) =>
      t.renameFrom && t.canonicalName
        ? [{ from: t.renameFrom, to: t.canonicalName }]
        : [],
    );
    if (renames.length === 0) {
      this.enqueueTargets(targets);
      return;
    }

    this.confirmingRenames = true;
    void this._confirm
      .confirm(ps1CanonicalRenameConfirm(renames))
      .then((proceed) => {
        this.confirmingRenames = false;
        if (proceed) this.enqueueTargets(targets);
      });
  }

  private confirmingRenames = false;

  private targetOptions() {
    // In "missing only" mode only games that actually lack at least one
    // selected asset type are queued — complete games are skipped entirely
    // (no job, no log line), matching the pre-flight summary. Games whose
    // storage name is not yet canonical are always queued so they get renamed.
    return this.overwrite()
      ? { normalize: true }
      : { onlyMissing: true, artTypes: this.artTypes(), normalize: true };
  }

  private enqueueTargets(targets: ArtTarget[]) {
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
        normalizeKind: t.normalizeKind,
        canonicalName: t.canonicalName,
        overwrite: this.overwrite(),
        artTypes: [...this.artTypes()],
        wideSlotFallback: true,
      })),
    );

    this.jobIds = created.map((j) => j.id);
    this.succeeded = 0;
    this.failed = 0;
    this.cancelled = 0;
    this.partial = 0;
    this.hasIssues = false;
    this.droppedCount = 0;
    this.cancelling = false;
    this.logEntries = [];
    this.running = true;
    this.done = false;
    this.dialogState = 'running';
    // Starts the one-second tick behind the elapsed counter, so a long silent
    // stretch inside a single download still shows the run advancing.
    this.startElapsedTimer();
    this._cdr.detectChanges();
  }

  /**
   * Close the dialog.
   *
   * While a run is in progress this doubles as Cancel: the jobs that have not
   * started yet are dropped from the queue and the job already running is left
   * alone so its current file is not left half-written. The dialog closes as
   * soon as that one settles — refusing to close at all (the old behaviour) meant
   * a single slow download held the modal open indefinitely.
   */
  close() {
    if (!this.running) {
      this.closed.emit();
      return;
    }
    if (this.cancelling) return;

    this.cancelling = true;
    for (const id of this.jobIds) {
      if (this.jobsSnapshot.find((j) => j.id === id)?.status === 'queued') {
        this.droppedCount += 1;
        this._jobs.removeJob(id);
      }
    }
    this._cdr.detectChanges();
  }

  /**
   * Backdrop / header-X dismiss. Deliberately inert during a run so a stray
   * click outside cannot cancel the download — Cancel is the explicit action.
   */
  dismiss() {
    if (this.running) return;
    this.close();
  }

  private onJobs(jobs: ImportJob[]): void {
    if (this.dialogState === 'input') return;
    this.jobsSnapshot = jobs;
    const mine = jobs.filter((j) => this.jobIds.includes(j.id));
    this.logEntries = mine.flatMap((j) => j.logs ?? []);
    this.succeeded = mine.filter((j) => j.status === 'success').length;
    this.failed = mine.filter((j) => j.status === 'error').length;
    this.cancelled =
      this.droppedCount + mine.filter((j) => j.status === 'cancelled').length;
    // A "successful" job that logged an error wrote some files and missed
    // others. Counted here rather than from `status`, which stays `success`.
    this.partial = mine.filter(
      (j) =>
        j.status === 'success' && (j.logs ?? []).some((l) => l.type === 'error'),
    ).length;
    this.hasIssues = this.failed > 0 || this.partial > 0;
    const finished = this.succeeded + this.failed + this.cancelled;
    if (this.running && finished === this.jobIds.length) {
      this.running = false;
      this.done = true;
      this.dialogState = 'done';
      this.stopElapsedTimer();
      // A cancelled run closes as soon as the last file lands, which is what
      // pressing Cancel promised.
      if (this.cancelling) {
        this.closed.emit();
        return;
      }
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