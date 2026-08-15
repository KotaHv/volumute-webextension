import { describe, expect, it } from 'vitest';
import { MUTE_MIGRATIONS, VOLUME_MIGRATIONS, migrateMap } from './migrate';
import type { MuteMap, SiteVolumeMap } from './types';

describe('migration chain', () => {
  it('migrates legacy v1 mute entries (ts -> lastUsed, created = now)', () => {
    const legacy = { 'a.com': { enabled: true, ts: 1000, deviceId: 'x' } } as unknown as MuteMap;
    const out = migrateMap(MUTE_MIGRATIONS, legacy, 1, 2);
    const e = out?.['a.com'];
    expect(e?.enabled).toBe(true);
    expect(e?.deviceId).toBe('x');
    expect(e?.lastUsed).toBe(1000);
    expect(e?.created).toBeGreaterThanOrEqual(1000);
  });

  it('migrates legacy v1 volume entries (v -> multiplier, t -> lastUsed)', () => {
    const legacy = { 'a.com': { v: 2, t: 500 } } as unknown as SiteVolumeMap;
    const out = migrateMap(VOLUME_MIGRATIONS, legacy, 1, 2);
    const e = out?.['a.com'];
    expect(e?.multiplier).toBe(2);
    expect(e?.lastUsed).toBe(500);
    expect(e?.created).toBeGreaterThanOrEqual(500);
  });

  it('leaves already-migrated entries untouched (idempotent step)', () => {
    const map: MuteMap = { 'a.com': { enabled: true, created: 1, lastUsed: 2, deviceId: 'x' } };
    expect(migrateMap(MUTE_MIGRATIONS, map, 1, 2)).toBe(map);
  });

  it('is a no-op when already at the target version', () => {
    const map: MuteMap = { 'a.com': { enabled: true, created: 1, lastUsed: 2, deviceId: 'x' } };
    expect(migrateMap(MUTE_MIGRATIONS, map, 2, 2)).toBe(map);
  });

  it('returns null when a migration step is missing', () => {
    const map: MuteMap = { 'a.com': { enabled: true, created: 1, lastUsed: 2, deviceId: 'x' } };
    expect(migrateMap({}, map, 1, 2)).toBeNull();
  });
});
