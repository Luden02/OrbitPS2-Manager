export type BuildChannel = 'alpha' | 'beta' | 'rc' | 'nightly' | 'indev' | 'dev';

const CHANNEL_PATTERNS: Array<[RegExp, BuildChannel]> = [
  [/^alpha/i, 'alpha'],
  [/^beta/i, 'beta'],
  [/^(rc|release-?candidate)/i, 'rc'],
  [/^nightly/i, 'nightly'],
  [/^indev/i, 'indev'],
];

const CHANNEL_LABELS: Record<BuildChannel, string> = {
  alpha: 'Alpha',
  beta: 'Beta',
  rc: 'Release Candidate',
  nightly: 'Nightly',
  indev: 'In Development',
  dev: 'Development',
};

/**
 * Extracts the pre-release channel (e.g. "alpha" from "1.4.0-alpha.0"). Falls back to the
 * "dev" channel when running an unoptimized build (e.g. `ng serve`), regardless of version,
 * so the warning also shows up while developing locally.
 */
export function getBuildChannel(version: string, isDevMode: boolean): BuildChannel | null {
  const preRelease = version.split('-')[1];
  if (preRelease) {
    for (const [pattern, channel] of CHANNEL_PATTERNS) {
      if (pattern.test(preRelease)) return channel;
    }
  }
  return isDevMode ? 'dev' : null;
}

/** Nightly CI sets an explicit channel and leaves package.json version alone. */
export function resolveBuildChannel(
  version: string,
  isDevMode: boolean,
  explicit: string | null | undefined,
): BuildChannel | null {
  if (explicit && explicit in CHANNEL_LABELS && explicit !== 'dev') {
    return explicit as BuildChannel;
  }
  return getBuildChannel(version, isDevMode);
}

/** Nightly builds are labeled "Nightly". Every other build keeps its version. */
export function versionBadge(version: string, channel: BuildChannel | null): string {
  if (channel === 'nightly') return 'Nightly';
  return `v${version}`;
}

export function getBuildChannelLabel(channel: BuildChannel): string {
  return CHANNEL_LABELS[channel];
}
