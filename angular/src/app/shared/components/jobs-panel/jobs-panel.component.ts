import { Component, DestroyRef, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { ImportJob, JobsService } from '../../services/jobs.service';

@Component({
  selector: 'app-jobs-panel',
  imports: [LucideAngularModule, AsyncPipe],
  templateUrl: './jobs-panel.component.html',
  styleUrl: './jobs-panel.component.scss',
})
export class JobsPanelComponent {
  public collapsed = true;

  constructor(public _jobs: JobsService) {
    const destroyRef = inject(DestroyRef);
    const sub = this._jobs.activeCount$.subscribe((count) => {
      if (count > 0) {
        this.collapsed = false;
      }
    });
    destroyRef.onDestroy(() => sub.unsubscribe());
  }

  toggle() {
    this.collapsed = !this.collapsed;
  }

  trackJob(_index: number, job: ImportJob) {
    return job.id;
  }

  typeLabel(job: ImportJob): string {
    switch (job.type) {
      case 'ps2-cd':
        return 'PS2 CD';
      case 'ps1':
        return 'PS1';
      case 'zso':
        return 'ZSO';
      case 'apps':
        return 'App';
      case 'artwork':
        return 'Artwork';
      case 'rename':
        return 'Rename';
      case 'ps1-convert-popsloader':
      case 'ps1-convert-popstarter':
      case 'ps1-convert-ember':
      case 'ps1-convert-to-ember':
        return 'PS1 Convert';
      default:
        return 'PS2 DVD';
    }
  }

  statusIcon(job: ImportJob): string {
    switch (job.status) {
      case 'success':
        return 'circle-check';
      case 'error':
        return 'circle-x';
      case 'running':
        return 'loader';
      case 'cancelled':
        return 'ban';
      default:
        return 'clock';
    }
  }
}
