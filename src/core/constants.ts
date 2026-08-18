export const KEYS = {
  autoMuted: 'autoMuted',
  siteVolumes: 'siteVolumes',
  pageVolumes: 'pageVolumes',
  settings: 'settings',
  deviceId: 'deviceId',
} as const;

export const DATA_VERSION = 2;
export const MIN_SUPPORTED_VERSION = 1;
export const SCHEMA_VERSION_PREFIX = 'schemaVersion';
export const schemaVersionKey = (key: string): string => `${SCHEMA_VERSION_PREFIX}:${key}`;

export const MIN_MULTIPLIER = 1;
export const DEFAULT_MAX_MULTIPLIER = 5;

export function normalizeMaxMultiplier(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_MULTIPLIER;
  return Math.max(MIN_MULTIPLIER, value);
}

export const displayVersion = (version: string): string =>
  version.split('.').length === 4 && version.endsWith('.0') ? version.slice(0, -2) : version;
