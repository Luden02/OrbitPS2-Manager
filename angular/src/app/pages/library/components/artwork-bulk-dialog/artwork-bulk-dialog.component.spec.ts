import { TestBed, ComponentFixture } from '@angular/core/testing';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { LucideAngularModule, icons } from 'lucide-angular';

import { ArtworkBulkDialogComponent } from './artwork-bulk-dialog.component';
import { JobsService, ImportJob, JobLogType, NewImportJob } from '@shared/services/jobs.service';
import { ConfirmDialogService, ConfirmDialogOptions } from '@shared/services/confirm-dialog.service';
import { LibraryService } from '@shared/services/library.service';
import { Game } from '@shared/types/game.type';

function ps2Game(gameId: string): Game {
  return {
    filename: `${gameId}.iso`,
    gameId,
    cdType: gameId,
    title: `Game ${gameId}`,
    path: `/games/${gameId}`,
    extension: '.iso',
    parentPath: '/games',
    system: 'PS2',
  };
}

describe('ArtworkBulkDialogComponent cancel', () => {
  let component: ArtworkBulkDialogComponent;
  let jobsSubject: BehaviorSubject<ImportJob[]>;
  let gamesSubject: BehaviorSubject<Game[]>;
  let enqueued: { label: string }[];
  let removed: string[];
  let closedCount: number;

  /** Three eligible PS2 games, none of which has artwork yet. */
  const GAMES = [ps2Game('SLUS-001'), ps2Game('SLUS-002'), ps2Game('SLUS-003')];

  beforeEach(() => {
    jobsSubject = new BehaviorSubject<ImportJob[]>([]);
    gamesSubject = new BehaviorSubject<Game[]>(GAMES);
    enqueued = [];
    removed = [];
    closedCount = 0;

    TestBed.configureTestingModule({
      imports: [ArtworkBulkDialogComponent, LucideAngularModule.pick(icons)],
      providers: [
        {
          provide: LibraryService,
          useValue: { library$: gamesSubject.asObservable() },
        },
        {
          provide: JobsService,
          useValue: {
            jobs$: jobsSubject.asObservable(),
            enqueue: (jobs: { label: string }[]) => {
              enqueued = jobs;
              const created = jobs.map((j, i) => ({
                ...j,
                id: `job-${i}`,
                status: 'queued',
              })) as unknown as ImportJob[];
              jobsSubject.next([...jobsSubject.value, ...created]);
              return created;
            },
            removeJob: (id: string) => {
              removed.push(id);
              jobsSubject.next(jobsSubject.value.filter((j) => j.id !== id));
            },
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(ArtworkBulkDialogComponent);
    fixture.componentRef.setInput('initialScope', 'PS2');
    fixture.detectChanges();
    component = fixture.componentInstance;
    component.closed.subscribe(() => (closedCount += 1));
  });

  /** Starts a run and settles the jobs into the given statuses. */
  function startRun(): void {
    component.onAllArtTypesChange(true);
    component.start();

    expect(enqueued.length).toBe(3);
    expect(component.running).toBe(true);

    // The worker starts the first job.
    mark('job-0', 'running');
  }

  function mark(
    id: string,
    status: ImportJob['status'],
    logs?: { text: string; type: JobLogType }[],
  ): void {
    jobsSubject.next(
      jobsSubject.value.map((j) =>
        j.id === id
          ? {
            ...j,
            status,
            logs: (logs ?? []).map((l, i) => ({ id: i, time: '00:00:00', ...l })),
          }
          : j,
      ),
    );
  }

  it('cannot be dismissed through the backdrop or header button mid-run', () => {
    startRun();

    component.dismiss();

    expect(closedCount).toBe(0);
    expect(component.running).toBe(true);
    expect(removed).toEqual([]);
  });

  it('drops the queued jobs but leaves the running one alone', () => {
    startRun();

    component.close();

    expect(removed).toEqual(['job-1', 'job-2']);
    expect(component.cancelling).toBe(true);
    expect(component.running).toBe(true, 'must wait for the file in flight');
    expect(closedCount).toBe(0);
  });

  it('closes once the job in flight finishes', () => {
    startRun();
    component.close();

    mark('job-0', 'success');

    expect(closedCount).toBe(1);
    expect(component.running).toBe(false);
  });

  it('counts the dropped jobs as cancelled', () => {
    startRun();
    component.close();
    mark('job-0', 'success');

    expect(component.cancelled).toBe(2);
    expect(component.succeeded).toBe(1);
  });

  it('ignores a second cancel press', () => {
    startRun();
    component.close();
    component.close();

    expect(removed).toEqual(['job-1', 'job-2']);
  });

  it('closes straight away when nothing is running', () => {
    component.close();

    expect(closedCount).toBe(1);
  });

  it('counts a successful job that logged an error as partial', () => {
    startRun();
    // The worker keeps a partial artwork run on `success` so the game still
    // reaches its art refresh, so the status alone cannot reveal the shortfall.
    mark('job-0', 'success', [
      { text: 'COV saved → /ART/SLUS-001_COV.png', type: 'success' },
      { text: 'SCR: not found in the database', type: 'error' },
      { text: 'Artwork partially downloaded — 1 of 2 assets written', type: 'error' },
    ]);

    expect(component.succeeded).toBe(1);
    expect(component.failed).toBe(0);
    expect(component.partial).toBe(1);
    expect(component.hasIssues).toBe(true);
  });

  it('does not count a clean success as partial', () => {
    startRun();
    mark('job-0', 'success', [
      { text: 'COV saved → /ART/SLUS-001_COV.png', type: 'success' },
      { text: 'Artwork downloaded.', type: 'success' },
    ]);

    expect(component.partial).toBe(0);
    expect(component.hasIssues).toBe(false);
  });

  it('does not double-count a job that failed outright as partial', () => {
    startRun();
    mark('job-0', 'error', [
      { text: 'No artwork found in the database', type: 'error' },
    ]);

    expect(component.failed).toBe(1);
    expect(component.partial).toBe(0);
    expect(component.hasIssues).toBe(true);
  });
});

describe('ArtworkBulkDialogComponent library load gate', () => {
  let component: ArtworkBulkDialogComponent;
  let fixture: ComponentFixture<ArtworkBulkDialogComponent>;
  let gamesSubject: BehaviorSubject<Game[]>;

  /** Builds the dialog against a `library$` that has already emitted `initial`. */
  function setupWith(initial: Game[]): void {
    gamesSubject = new BehaviorSubject<Game[]>(initial);

    TestBed.configureTestingModule({
      imports: [ArtworkBulkDialogComponent, LucideAngularModule.pick(icons)],
      providers: [
        { provide: JobsService, useValue: { jobs$: of([]), enqueue: () => [], removeJob: () => { } } },
        {
          provide: LibraryService,
          useValue: { library$: gamesSubject.asObservable() },
        },
      ],
    });

    fixture = TestBed.createComponent(ArtworkBulkDialogComponent);
    fixture.componentRef.setInput('initialScope', 'PS2');
    fixture.detectChanges();
    component = fixture.componentInstance;
  }

  it('counts an empty library emission as loaded', () => {
    setupWith([]);

    expect(component.libraryLoaded()).toBe(true);
    expect(component.eligibleCount()).toBe(0);
  });

  it('renders the empty state instead of the loading spinner for an empty library', () => {
    setupWith([]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('No games in this section');
    expect(text).not.toContain('Loading library');
  });

  it('still shows the loading spinner before the library emits', () => {
    gamesSubject = new BehaviorSubject<Game[]>([]);
    TestBed.configureTestingModule({
      imports: [ArtworkBulkDialogComponent, LucideAngularModule.pick(icons)],
      providers: [
        { provide: JobsService, useValue: { jobs$: of([]), enqueue: () => [], removeJob: () => { } } },
        // A subject with nothing emitted yet: ngOnInit subscribes but receives
        // nothing, which is the only state the spinner is meant to cover.
        { provide: LibraryService, useValue: { library$: new Subject<Game[]>() } },
      ],
    });

    fixture = TestBed.createComponent(ArtworkBulkDialogComponent);
    fixture.componentRef.setInput('initialScope', 'PS2');
    fixture.detectChanges();
    component = fixture.componentInstance;

    expect(component.libraryLoaded()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Loading library');
  });

  it('flips to loaded when the library emits after opening', () => {
    const late$ = new Subject<Game[]>();
    TestBed.configureTestingModule({
      imports: [ArtworkBulkDialogComponent, LucideAngularModule.pick(icons)],
      providers: [
        { provide: JobsService, useValue: { jobs$: of([]), enqueue: () => [], removeJob: () => { } } },
        { provide: LibraryService, useValue: { library$: late$ } },
      ],
    });

    fixture = TestBed.createComponent(ArtworkBulkDialogComponent);
    fixture.componentRef.setInput('initialScope', 'PS2');
    fixture.detectChanges();
    component = fixture.componentInstance;
    expect(component.libraryLoaded()).toBe(false);

    late$.next([ps2Game('SLUS-001')]);
    fixture.detectChanges();

    expect(component.libraryLoaded()).toBe(true);
    expect(component.eligibleCount()).toBe(1);
  });
});

/**
 * The running view's activity feedback.
 *
 * A game's entire download happens inside one `downloadArtByGameId` call that
 * emits no log lines, so with the wide screenshot fallback a game can walk ~30
 * candidate URLs in silence. Without the spinner and counter below, the log and
 * the ok/failed counts both sit still for that whole stretch and the dialog
 * reads as frozen.
 */
describe('ArtworkBulkDialogComponent run activity feedback', () => {
  let component: ArtworkBulkDialogComponent;
  let fixture: ComponentFixture<ArtworkBulkDialogComponent>;
  let jobsSubject: BehaviorSubject<ImportJob[]>;

  const GAMES = [ps2Game('SLUS-001'), ps2Game('SLUS-002'), ps2Game('SLUS-003')];

  /** Prefix-matched: the title gains a "waiting on the current file" suffix
   *  once cancelling, so an exact match would miss the element mid-cancel. */
  const TIMER_TITLE_PREFIX = 'Time since the run started';
  const timer = (): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[title^="${TIMER_TITLE_PREFIX}"]`);
  const spinners = (): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.loading-spinner'));
  /** Throws with a readable message instead of failing on `.textContent`. */
  const timerText = (): string => {
    const el = timer();
    if (!el) throw new Error('no elapsed timer in the DOM');
    return el.textContent.trim();
  };

  beforeEach(() => {
    // Own `clock` block: the component ticks with `setInterval`/`Date.now`, and
    // only a mocked clock makes "65 seconds later" deterministic.
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-01-01T00:00:00Z'));

    jobsSubject = new BehaviorSubject<ImportJob[]>([]);

    TestBed.configureTestingModule({
      imports: [ArtworkBulkDialogComponent, LucideAngularModule.pick(icons)],
      providers: [
        {
          provide: LibraryService,
          useValue: { library$: of(GAMES) },
        },
        {
          provide: JobsService,
          useValue: {
            jobs$: jobsSubject.asObservable(),
            enqueue: (jobs: { label: string }[]) => {
              const created = jobs.map((j, i) => ({
                ...j,
                id: `job-${i}`,
                status: 'queued',
              })) as unknown as ImportJob[];
              jobsSubject.next([...jobsSubject.value, ...created]);
              return created;
            },
            removeJob: () => { },
          },
        },
      ],
    });

    fixture = TestBed.createComponent(ArtworkBulkDialogComponent);
    fixture.componentRef.setInput('initialScope', 'PS2');
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  afterEach(() => jasmine.clock().uninstall());

  /** Starts a run and leaves one job in flight, with no log output at all. */
  function startSilentRun(): void {
    component.onAllArtTypesChange(true);
    component.start();
    settle('job-0', 'running');
  }

  function settle(id: string, status: ImportJob['status']): void {
    jobsSubject.next(
      jobsSubject.value.map((j) => (j.id === id ? { ...j, status } : j)),
    );
  }

  /** Settles every job so the run reaches its done state. */
  function finishRun(): void {
    for (const job of ['job-0', 'job-1', 'job-2']) settle(job, 'success');
  }

  it('shows no activity indicator before a run starts', () => {
    expect(component.elapsedLabel()).toBe('');
    expect(spinners().length).toBe(0);
    expect(timer()).toBeNull();
  });

  it('shows a spinner and a zeroed timer once a run starts', () => {
    startSilentRun();

    expect(component.elapsedLabel()).toBe('0:00');
    // The header spinner only; the cancel-path spinner is not active yet.
    expect(spinners().length).toBe(1);
    expect(timerText()).toBe('0:00');
  });

  it('keeps the indicator visible through a silent stretch', () => {
    startSilentRun();
    // No `jobs$` emission at all — the case that read as a frozen app.
    jasmine.clock().tick(20_000);
    fixture.detectChanges();

    expect(spinners().length).toBe(1);
    expect(timerText()).toBe('0:20');
  });

  it('advances the timer once a second', () => {
    startSilentRun();

    jasmine.clock().tick(1000);
    fixture.detectChanges();
    expect(component.elapsedLabel()).toBe('0:01');

    jasmine.clock().tick(5000);
    fixture.detectChanges();
    expect(component.elapsedLabel()).toBe('0:06');
  });

  it('zero-pads seconds and minutes', () => {
    startSilentRun();

    jasmine.clock().tick(65_000);
    fixture.detectChanges();

    expect(component.elapsedLabel()).toBe('1:05');
  });

  it('widens to h:mm:ss past an hour', () => {
    startSilentRun();

    jasmine.clock().tick(3 * 3600_000 + 2 * 60_000 + 3000);
    fixture.detectChanges();

    expect(component.elapsedLabel()).toBe('3:02:03');
  });

  it('hands the spinner over to the cancel footer so only one ever spins', () => {
    startSilentRun();
    jasmine.clock().tick(7000);
    fixture.detectChanges();
    expect(spinners().length).toBe(1);

    component.close();
    fixture.detectChanges();

    expect(component.cancelling).toBe(true);
    // The header spinner stands down; the footer's "Finishing current file…"
    // takes over, so the two never spin at once.
    expect(spinners().length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Finishing current file');
    // The counter keeps ticking through the wait — it is not a spinner, and it
    // is the only way to see how long the last file is taking.
    expect(timerText()).toBe('0:07');
  });

  it('hides the indicator once the run finishes', () => {
    startSilentRun();
    jasmine.clock().tick(5000);
    finishRun();
    fixture.detectChanges();

    expect(component.elapsedLabel()).toBe('');
    expect(spinners().length).toBe(0);
    expect(timer()).toBeNull();
  });

  it('clears the interval when the component is destroyed', () => {
    startSilentRun();
    expect(component.elapsedLabel()).toBe('0:00');

    // A leaked interval would keep firing into a destroyed view.
    fixture.destroy();

    expect(component.elapsedLabel()).toBe('');
  });
});

describe('ArtworkBulkDialogComponent PS1 rename confirmation', () => {
  let component: ArtworkBulkDialogComponent;
  let enqueued: NewImportJob[];
  let confirmCalls: ConfirmDialogOptions[];
  let confirmResult: boolean;

  function ps1Game(filename: string, canonicalTitle?: string): Game {
    return {
      filename,
      gameId: 'SCUS_944.25',
      cdType: 'POPS',
      title: canonicalTitle ?? filename,
      canonicalTitle,
      path: `/opl/POPS/${filename}`,
      extension: '.VCD',
      parentPath: '/opl/POPS',
      system: 'PS1',
      format: 'POPS',
    };
  }

  function setup(games: Game[]): void {
    enqueued = [];
    confirmCalls = [];

    TestBed.configureTestingModule({
      imports: [ArtworkBulkDialogComponent, LucideAngularModule.pick(icons)],
      providers: [
        { provide: LibraryService, useValue: { library$: of(games) } },
        {
          provide: JobsService,
          useValue: {
            jobs$: of([]),
            enqueue: (jobs: NewImportJob[]) => {
              enqueued = jobs;
              return jobs.map((j, i) => ({ ...j, id: `job-${i}`, status: 'queued' }));
            },
            removeJob: () => { },
          },
        },
        {
          provide: ConfirmDialogService,
          useValue: {
            confirm: (options: ConfirmDialogOptions) => {
              confirmCalls.push(options);
              return Promise.resolve(confirmResult);
            },
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(ArtworkBulkDialogComponent);
    fixture.componentRef.setInput('initialScope', 'PS1');
    fixture.detectChanges();
    component = fixture.componentInstance;
    component.onAllArtTypesChange(true);
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve));

  it('warns with a Yes/No prompt and forwards the rename on Yes', async () => {
    confirmResult = true;
    setup([ps1Game('Spyro 2.VCD', "SPYRO 2 - RIPTO'S RAGE")]);

    component.start();
    expect(enqueued.length).toBe(0);
    await settle();

    expect(confirmCalls.length).toBe(1);
    expect(confirmCalls[0].message).toContain('canonical name and artwork');
    expect(confirmCalls[0].confirmLabel).toBe('Yes');
    expect(confirmCalls[0].cancelLabel).toBe('No');
    expect(confirmCalls[0].detail).toContain("Spyro 2 → SPYRO 2 - RIPTO'S RAGE");
    expect(enqueued.length).toBe(1);
    expect(enqueued[0].normalizeKind).toBe('VCD');
    expect(enqueued[0].canonicalName).toBe("SPYRO 2 - RIPTO'S RAGE");
  });

  it('cancels the whole run on No', async () => {
    confirmResult = false;
    setup([ps1Game('Spyro 2.VCD', "SPYRO 2 - RIPTO'S RAGE")]);

    component.start();
    await settle();

    expect(enqueued.length).toBe(0);
    expect(component.running).toBe(false);
  });

  it('does not prompt when every PS1 game already has its canonical name', () => {
    confirmResult = true;
    setup([ps1Game("SPYRO 2 - RIPTO'S RAGE.VCD", "SPYRO 2 - RIPTO'S RAGE")]);

    component.start();

    expect(confirmCalls.length).toBe(0);
    expect(enqueued.length).toBe(1);
    // Still normalized, so any GameID-named art migrates to the canonical name.
    expect(enqueued[0].normalizeKind).toBe('VCD');
  });
});
