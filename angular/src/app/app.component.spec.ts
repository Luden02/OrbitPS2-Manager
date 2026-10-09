import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LucideAngularModule, icons } from 'lucide-angular';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  let windowApiBackup: unknown;

  beforeEach(async () => {
    // The Electron preload bridge does not exist in a browser test run.
    windowApiBackup = (window as unknown as { windowAPI: unknown }).windowAPI;
    (window as unknown as { windowAPI: unknown }).windowAPI = {
      wmInfo: () => Promise.resolve({}),
      platform: () => Promise.resolve('linux'),
      canWindowControls: () =>
        Promise.resolve({ canMinimize: true, canMaximize: true }),
      isMaximized: () => Promise.resolve(false),
      onMaximizedChange: () => {},
      removeAllMaximizedChangeListeners: () => {},
      minimize: () => {},
      maximizeToggle: () => {},
      close: () => {},
    };

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick(icons)),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    // Destroy fixtures while the stub is still present: the title bar's
    // destroy hook calls windowAPI.removeAllMaximizedChangeListeners().
    TestBed.resetTestingModule();
    (window as unknown as { windowAPI: unknown }).windowAPI = windowApiBackup;
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the Library navigation item', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Library');
  });

  it('should show mount directory action by default', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Mount Directory');
  });
});
