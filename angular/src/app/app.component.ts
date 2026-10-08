import { Component, isDevMode } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LogsService } from './shared/services/logs.service';
import { BuildInfo } from './shared/build-info';
import { getBuildChannelLabel, resolveBuildChannel, versionBadge } from './shared/build-channel';
import { LibraryService } from './shared/services/library.service';
import { AsyncPipe } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { JobsPanelComponent } from './shared/components/jobs-panel/jobs-panel.component';
import { TitleBarComponent } from './shared/components/title-bar/title-bar.component';
import { UpdateService } from './shared/services/update.service';
import { ThemeService } from './shared/services/theme.service';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    AsyncPipe,
    LucideAngularModule,
    JobsPanelComponent,
    TitleBarComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  public currentDirectory = 'None';
  public readonly buildChannel = resolveBuildChannel(BuildInfo.version, isDevMode(), BuildInfo.channel);
  public readonly buildChannelLabel = this.buildChannel ? getBuildChannelLabel(this.buildChannel) : null;
  public readonly versionLabel = versionBadge(BuildInfo.version, this.buildChannel);
  constructor(
    private readonly _logger: LogsService,
    public readonly _libraryService: LibraryService,
    public readonly _updateService: UpdateService,
    private readonly _theme: ThemeService,
  ) {}

  ngOnInit() {
    const os = window.navigator.platform;

    this._theme.init();

    this._logger.log(
      'AppComponent',
      `App initialized (${BuildInfo.version}) [OS: ${os}]`,
    );

    window.windowAPI.wmInfo().then((info) => {
      if (info.name) {
        this._logger.log('AppComponent', `Desktop environment: ${info.name}`);
      }
    });

    this._libraryService.restoreLastDirectory();

    // Check for a newer GitHub release in the background.
    this._updateService.check();
  }
}
