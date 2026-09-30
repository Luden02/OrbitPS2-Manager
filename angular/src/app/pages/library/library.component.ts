import { Component } from '@angular/core';
import { Router } from '@angular/router';
import {
  GamecardComponent,
  GamecardViewMode,
} from './components/gamecard/gamecard.component';
import { LibraryRenameDialogComponent } from './components/rename-dialog/rename-dialog.component';
import { ArtworkBulkDialogComponent } from './components/artwork-bulk-dialog/artwork-bulk-dialog.component';
import { LibraryService } from '../../shared/services/library.service';
import { JobsService } from '../../shared/services/jobs.service';
import { AsyncPipe } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { Game } from '../../shared/types/game.type';
import { BehaviorSubject, combineLatest, map, Observable } from 'rxjs';

type SystemTab = 'PS2' | 'PS1' | 'APPS';
type SortMode = 'title-asc' | 'title-desc' | 'gameId-asc' | 'gameId-desc';

@Component({
  selector: 'app-library',
  imports: [
    GamecardComponent,
    LibraryRenameDialogComponent,
    ArtworkBulkDialogComponent,
    AsyncPipe,
    LucideAngularModule,
  ],
  templateUrl: './library.component.html',
  styleUrl: './library.component.scss',
})
export class LibraryComponent {
  public showRenameDialog = false;
  public showArtworkBulkDialog = false;

  constructor(
    public readonly _libraryService: LibraryService,
    private readonly _jobs: JobsService,
    private readonly _router: Router,
  ) { }

  private gameSystemToTab(system: string | undefined): SystemTab {
    return (system ?? 'PS2') === 'PS2' ? 'PS2' : system === 'PS1' ? 'PS1' : 'APPS';
  }

  viewGameDetails(game: Game) {
    this._libraryService.selectGame(game);
    this._libraryService.returnTab = this.gameSystemToTab(game.system);
    this._router.navigate(['/library/details']);
  }

  openRenameDialog() {
    this.showRenameDialog = true;
  }

  openArtworkBulkDialog() {
    this.showArtworkBulkDialog = true;
  }

  locateEmberFolder() {
    void this._libraryService.locateEmberDirectory();
  }

  /** Number of games in the active tab that can receive artwork. */
  get activeTab(): SystemTab {
    return this.activeTabSubject.getValue();
  }

  /** Convert all PS2 ISOs in the library to ZSO. */
  convertAllToZso() {
    const candidates = this._libraryService.currentLibraryValue.filter(
      (g) =>
        (g.system ?? 'PS2') === 'PS2' &&
        (g.format === 'ISO' || g.extension?.toLowerCase() === 'iso')
    );
    if (candidates.length === 0) {
      window.alert('No uncompressed PS2 ISO games in the library.');
      return;
    }
    const confirmed = window.confirm(
      `Compress ${candidates.length} PS2 ISO game(s) to ZSO?\n\n` +
      `Each .iso will be replaced with a smaller .zso once its job succeeds.`
    );
    if (!confirmed) return;
    this._jobs.enqueue(
      candidates.map((g) => ({
        type: 'zso',
        label: g.title || g.gameId || g.filename,
        filePath: g.path,
        gameId: g.gameId,
        gameName: g.title || '',
        downloadArtwork: false,
        deleteOriginal: true,
      }))
    );
  }

  /** Queues a POPSLoader-conversion job for every POPStarter-launched PS1 game. */
  convertAllPs1ToPopsLoader() {
    const candidates = this._libraryService.currentLibraryValue.filter(
      (g) => g.system === 'APPS' && g.isPs1Launcher && g.path && g.gameId
    );
    if (candidates.length === 0) {
      window.alert('No POPStarter-launched PS1 games to convert.');
      return;
    }
    const confirmed = window.confirm(
      `Convert ${candidates.length} PS1 game(s) to POPSLoader style?\n\n` +
      `Each VCD's GameID prefix will be dropped and its APPS launcher folder removed.`
    );
    if (!confirmed) return;
    this._jobs.enqueue(
      candidates.map((g) => ({
        type: 'ps1-convert-popsloader',
        label: g.title || g.gameId || g.filename,
        filePath: g.path,
        gameId: g.gameId,
        gameName: g.title || '',
        downloadArtwork: false,
      }))
    );
  }

  /** Queues a POPStarter-conversion job for every POPSLoader/RiptOPL-style PS1 game. */
  convertAllPs1ToPopstarter() {
    const candidates = this._libraryService.currentLibraryValue.filter(
      (g) => g.system === 'PS1' && !g.isPs1Launcher && g.format !== 'EMBER' && g.path && g.gameId
    );
    if (candidates.length === 0) {
      window.alert('No POPSLoader-style PS1 games to convert.');
      return;
    }
    const confirmed = window.confirm(
      `Convert ${candidates.length} PS1 game(s) to POPStarter style?\n\n` +
      `Each VCD will be prefixed with its GameID and given an APPS launcher (device prefix "XX.").`
    );
    if (!confirmed) return;
    this._jobs.enqueue(
      candidates.map((g) => ({
        type: 'ps1-convert-popstarter',
        label: g.title || g.gameId || g.filename,
        filePath: g.path,
        gameId: g.gameId,
        gameName: g.title || '',
        downloadArtwork: false,
        elfPrefix: 'XX.',
      }))
    );
  }

  private activeTabSubject = new BehaviorSubject<SystemTab>('PS2');
  public activeTab$ = this.activeTabSubject.asObservable();
  private sortModeSubject = new BehaviorSubject<SortMode>('title-asc');
  public sortMode$ = this.sortModeSubject.asObservable();
  private searchSubject = new BehaviorSubject<string>('');
  public search$ = this.searchSubject.asObservable();
  public viewMode: GamecardViewMode = 'grid';
  public sortMode: SortMode = 'title-asc';
  public searchTerm = '';

  public ps2Games$: Observable<Game[]> | undefined;
  public ps1Games$: Observable<Game[]> | undefined;
  public visibleGames$: Observable<Game[]> | undefined;
  public ps2Count$: Observable<number> | undefined;
  public ps1Count$: Observable<number> | undefined;
  public appsCount$: Observable<number> | undefined;
  public totalCount$: Observable<number> | undefined;

  ngOnInit() {
    const library$ = this._libraryService.library$;

    this.activeTabSubject.next(this._libraryService.returnTab);
    this._libraryService.returnTab = 'PS2';

    const sortByTitle = (games: Game[]) =>
      [...games].sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));

    this.ps2Games$ = library$.pipe(
      map((games) => sortByTitle(games.filter((g) => (g.system ?? 'PS2') === 'PS2')))
    );
    this.ps1Games$ = library$.pipe(
      map((games) => sortByTitle(games.filter((g) => g.system === 'PS1')))
    );
    this.ps2Count$ = this.ps2Games$.pipe(map((g) => g.length));
    this.ps1Count$ = this.ps1Games$.pipe(map((g) => g.length));
    this.appsCount$ = library$.pipe(
      map((games) => games.filter((g) => g.system === 'APPS').length)
    );
    this.totalCount$ = library$.pipe(map((g) => g.length));

    this.visibleGames$ = combineLatest([
      library$,
      this.activeTab$,
      this.sortMode$,
      this.search$,
    ]).pipe(
      map(([games, tab, sortMode, search]) => {
        const [field, direction] = sortMode.split('-') as [
          'title' | 'gameId',
          'asc' | 'desc'
        ];
        const multiplier = direction === 'asc' ? 1 : -1;
        const query = search.trim().toLocaleLowerCase();

        const filteredGames = games
          .filter((g) => {
            if (tab === 'PS1') return g.system === 'PS1';
            if (tab === 'APPS') return g.system === 'APPS';
            return (g.system ?? 'PS2') === 'PS2';
          })
          .filter((g) => {
            if (!query) return true;
            return (
              (g.title ?? '').toLocaleLowerCase().includes(query) ||
              (g.gameId ?? '').toLocaleLowerCase().includes(query)
            );
          });

        return filteredGames.sort((a, b) => {
          const getSortableValue = (game: Game) => {
            if (field === 'title') {
              return (game.title || game.gameId || '').toLocaleLowerCase();
            }
            return (game.gameId || '').toLocaleLowerCase();
          };

          return (
            getSortableValue(a).localeCompare(getSortableValue(b), undefined, {
              numeric: true,
              sensitivity: 'base',
            }) * multiplier
          );
        });
      })
    );
  }

  setTab(tab: SystemTab) {
    this.activeTabSubject.next(tab);
  }

  isActive(tab: SystemTab): boolean {
    return this.activeTabSubject.getValue() === tab;
  }

  toggleViewMode() {
    this.viewMode = this.viewMode === 'grid' ? 'list' : 'grid';
  }

  setSearch(term: string) {
    this.searchTerm = term;
    this.searchSubject.next(term);
  }

  clearSearch() {
    this.setSearch('');
  }

  setSortMode(mode: string) {
    if (!this.isSortMode(mode)) {
      return;
    }

    this.sortMode = mode;
    this.sortModeSubject.next(mode);
  }

  private isSortMode(mode: string): mode is SortMode {
    return (
      mode === 'title-asc' ||
      mode === 'title-desc' ||
      mode === 'gameId-asc' ||
      mode === 'gameId-desc'
    );
  }
}
