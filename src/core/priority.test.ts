import { describe, expect, it } from 'vitest';
import { computeGain, computeMultiplier, isAutoMuted } from './priority';
import { DEFAULT_MULTIPLIER } from './types';
import type { PageVolumeMap, SiteVolumeMap, VolumeEntry } from './types';

function vol(multiplier: number): VolumeEntry {
  return { multiplier, created: 0, lastUsed: 0 };
}

describe('computeMultiplier', () => {
  it('returns default 1x when nothing is configured', () => {
    expect(computeMultiplier({}, {}, '/p', 'example.com')).toBe(1);
  });

  it('prefers page volume over site volume', () => {
    const pageVolumes = { 'https://example.com/p': { multiplier: 2, created: 1, lastUsed: 1 } };
    const siteVolumes = { 'example.com': { multiplier: 0.5, created: 1, lastUsed: 1 } };
    expect(
      computeMultiplier(pageVolumes, siteVolumes, 'https://example.com/p', 'example.com'),
    ).toBe(2);
  });

  it('falls back to site volume when no page volume matches', () => {
    const siteVolumes = { 'example.com': { multiplier: 0.25, created: 1, lastUsed: 1 } };
    expect(computeMultiplier({}, siteVolumes, 'https://example.com/other', 'example.com')).toBe(
      0.25,
    );
  });

  it('page volume does not leak to other pages of the same site', () => {
    const pageVolumes = { 'https://example.com/a': { multiplier: 2, created: 1, lastUsed: 1 } };
    expect(computeMultiplier(pageVolumes, {}, 'https://example.com/b', 'example.com')).toBe(1);
  });

  it('clamps out-of-range values', () => {
    expect(
      computeMultiplier(
        { 'https://x/': { multiplier: 99, created: 1, lastUsed: 1 } },
        {},
        'https://x/',
        'x',
      ),
    ).toBe(5);
    expect(
      computeMultiplier(
        { 'https://x/': { multiplier: -3, created: 1, lastUsed: 1 } },
        {},
        'https://x/',
        'x',
      ),
    ).toBe(0);
    expect(
      computeMultiplier(
        { 'https://x/': { multiplier: NaN, created: 1, lastUsed: 1 } },
        {},
        'https://x/',
        'x',
      ),
    ).toBe(1);
  });

  it('respects a custom maximum multiplier', () => {
    const pageVolumes = { 'https://x/': { multiplier: 5, created: 1, lastUsed: 1 } };
    expect(computeMultiplier(pageVolumes, {}, 'https://x/', 'x', 2)).toBe(2);
  });
});

describe('isAutoMuted', () => {
  it('true when the host is muted', () => {
    expect(
      isAutoMuted(
        { 'example.com': { enabled: true, created: 1, lastUsed: 1, deviceId: 'a' } },
        'example.com',
      ),
    ).toBe(true);
  });

  it('false when the entry exists but is disabled', () => {
    expect(
      isAutoMuted(
        { 'example.com': { enabled: false, created: 1, lastUsed: 1, deviceId: 'a' } },
        'example.com',
      ),
    ).toBe(false);
  });

  it('false when the host is not configured', () => {
    expect(isAutoMuted({}, 'example.com')).toBe(false);
  });
});

describe('computeGain', () => {
  const emptyPage: PageVolumeMap = {};
  const emptySite: SiteVolumeMap = {};

  it('returns the stored site multiplier when not muted', () => {
    expect(
      computeGain(false, true, emptyPage, { 'example.com': vol(0.5) }, '', 'example.com', 5),
    ).toBe(0.5);
  });

  it('keeps the multiplier when muted while native tab muting is available', () => {
    expect(
      computeGain(true, true, emptyPage, { 'example.com': vol(0.5) }, '', 'example.com', 5),
    ).toBe(0.5);
  });

  it('returns 0 for a muted tab in fallback mode', () => {
    expect(
      computeGain(true, false, emptyPage, { 'example.com': vol(0.5) }, '', 'example.com', 5),
    ).toBe(0);
  });

  it('keeps the multiplier for an unmuted tab in fallback mode', () => {
    expect(
      computeGain(false, false, emptyPage, { 'example.com': vol(0.5) }, '', 'example.com', 5),
    ).toBe(0.5);
  });

  it('defaults to unit volume without any entry', () => {
    expect(computeGain(false, true, emptyPage, emptySite, '', 'example.com', 5)).toBe(
      DEFAULT_MULTIPLIER,
    );
  });

  it('clamps to the configured maximum multiplier', () => {
    expect(
      computeGain(false, true, emptyPage, { 'example.com': vol(9) }, '', 'example.com', 5),
    ).toBe(5);
  });

  it('lets page volume take precedence over site volume', () => {
    expect(
      computeGain(
        false,
        true,
        { 'https://example.com/live': vol(0.3) },
        { 'example.com': vol(0.5) },
        'https://example.com/live',
        'example.com',
        5,
      ),
    ).toBe(0.3);
  });
});
