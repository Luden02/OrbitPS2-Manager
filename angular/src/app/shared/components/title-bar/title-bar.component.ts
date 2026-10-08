import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  isDevMode,
  OnInit,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { resolveBuildChannel, versionBadge } from '../../build-channel';
import { BuildInfo } from '../../build-info';

@Component({
  selector: 'app-title-bar',
  imports: [LucideAngularModule],
  templateUrl: './title-bar.component.html',
  styleUrl: './title-bar.component.scss',
})
export class TitleBarComponent implements OnInit {
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _cdr = inject(ChangeDetectorRef);
  public readonly versionLabel = versionBadge(
    BuildInfo.version,
    resolveBuildChannel(BuildInfo.version, isDevMode(), BuildInfo.channel),
  );
  public visible = false;
  public maximized = false;
  public canMinimize = false;
  public canMaximize = false;

  ngOnInit() {
    void Promise.all([
      window.windowAPI.platform(),
      window.windowAPI.canWindowControls(),
      window.windowAPI.isMaximized(),
    ]).then(([platform, { canMinimize, canMaximize }, maximized]) => {
      // macOS keeps its native frame/traffic lights; only draw our own
      // title bar where the main process created a frameless window.
      this.visible = platform !== 'darwin';
      this.canMinimize = canMinimize;
      this.canMaximize = canMaximize;
      this.maximized = maximized;
      this._cdr.detectChanges();
    });

    window.windowAPI.onMaximizedChange((isMaximized) => {
      this.maximized = isMaximized;
      this._cdr.detectChanges();
    });

    this._destroyRef.onDestroy(() =>
      window.windowAPI.removeAllMaximizedChangeListeners(),
    );
  }

  minimize() {
    window.windowAPI.minimize();
  }

  maximizeToggle() {
    window.windowAPI.maximizeToggle();
  }

  close() {
    window.windowAPI.close();
  }
}
