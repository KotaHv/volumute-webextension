import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageVolumeMap, SiteVolumeMap, VolumeEntry } from '../core/types';

const mocks = vi.hoisted(() => {
  const browser = {
    tabs: {
      update: vi.fn(),
      sendMessage: vi.fn(),
      query: vi.fn(),
      get: vi.fn(),
      onUpdated: { addListener: vi.fn() },
      onActivated: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
    },
    runtime: {
      onMessage: { addListener: vi.fn() },
    },
    storage: {
      sync: {
        onChanged: { addListener: vi.fn() },
      },
    },
  };
  const emptyStore = () => ({
    init: vi.fn(),
    snapshot: vi.fn(),
    touchEntry: vi.fn(),
    onChange: vi.fn(() => () => {}),
  });
  return {
    browser,
    pageVolumesStore: emptyStore(),
    siteVolumesStore: emptyStore(),
  };
});

vi.mock('webextension-polyfill', () => ({ default: mocks.browser }));
vi.mock('../storage/stores', () => ({
  autoMutedStore: {
    init: vi.fn(),
    snapshot: vi.fn(() => ({})),
    touchEntry: vi.fn(),
  },
  pageVolumesStore: mocks.pageVolumesStore,
  siteVolumesStore: mocks.siteVolumesStore,
}));
vi.mock('../storage/session', () => ({
  getUserMuteChoice: vi.fn(),
  rememberUserMuteChoice: vi.fn(),
  clearUserMuteChoices: vi.fn(),
}));

import { computeGain } from './volume';
import { DEFAULT_MULTIPLIER } from '../core/types';

function vol(multiplier: number): VolumeEntry {
  return { multiplier, created: 0, lastUsed: 0 };
}

const emptyPage: PageVolumeMap = {};
const emptySite: SiteVolumeMap = {};

describe('computeGain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('treats the unknown probe state like native availability (no gain 0 on mute)', () => {
    expect(
      computeGain(true, null, emptyPage, { 'example.com': vol(0.5) }, '', 'example.com', 5),
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