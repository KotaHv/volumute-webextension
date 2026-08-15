import { afterEach, describe, expect, it, vi } from 'vitest';
import { evictOldest, KVStore, mergeByLastWrite, mergeFresh, mergeUnion } from './kvstore';
import type { MuteEntry, VolumeEntry } from '../core/types';

const mute = (lastUsed: number, deviceId = 'a'): MuteEntry => ({ enabled: true, created: lastUsed, lastUsed, deviceId });
const vol = (lastUsed: number): VolumeEntry => ({ multiplier: 1, created: lastUsed, lastUsed });

describe('mergeByLastWrite', () => {
  it('keeps the newer entry per key (CRDT)', () => {
    const cache = { a: mute(100), b: mute(50) };
    const fresh = { a: mute(40), c: mute(10) };
    const out = mergeByLastWrite(cache, fresh);
    expect(out.a?.lastUsed).toBe(100);
    expect(out.b?.lastUsed).toBe(50);
    expect(out.c?.lastUsed).toBe(10);
  });

  it('does not drop local-only entries', () => {
    const out = mergeByLastWrite({ a: mute(1) }, { b: mute(2) });
    expect(Object.keys(out).sort()).toEqual(['a', 'b']);
    expect(out.a?.lastUsed).toBe(1);
    expect(out.b?.lastUsed).toBe(2);
  });
});

describe('mergeUnion', () => {
  it('local cache wins on conflicts, fresh fills gaps', () => {
    const out = mergeUnion({ a: vol(1) }, { a: vol(9), b: vol(2) });
    expect(out.a?.lastUsed).toBe(1);
    expect(out.b?.lastUsed).toBe(2);
  });
});

describe('mergeFresh', () => {
  it('propagates deletions from disk (no resurrection)', () => {
    const cache = { a: mute(100), b: mute(50) };
    const out = mergeFresh(mergeByLastWrite, cache, {});
    expect(Object.keys(out)).toHaveLength(0);
  });

  it('keeps local entry when its timestamp is newer', () => {
    const cache = { a: mute(100) };
    const out = mergeFresh(mergeByLastWrite, cache, { a: mute(40) });
    expect(out.a?.lastUsed).toBe(100);
  });

  it('takes the fresh entry when it is newer', () => {
    const cache = { a: mute(40) };
    const out = mergeFresh(mergeByLastWrite, cache, { a: mute(100) });
    expect(out.a?.lastUsed).toBe(100);
  });
});

describe('evictOldest', () => {
  it('removes the entry with the smallest lastUsed', () => {
    const map = { a: mute(100), b: mute(10), c: mute(50) };
    const out = evictOldest(map);
    expect(out).not.toBeNull();
    expect(out).not.toHaveProperty('b');
    expect(Object.keys(out!).sort()).toEqual(['a', 'c']);
  });

  it('handles volume entries', () => {
    const map = { a: vol(1), b: vol(2) };
    const out = evictOldest(map);
    expect(out).not.toHaveProperty('a');
  });

  it('returns null when nothing to evict', () => {
    expect(evictOldest({})).toBeNull();
  });
});

describe('KVStore schema versioning', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeBrowser() {
    const data: Record<string, unknown> = {};
    const area = {
      get: async (keys: string | string[] | null) => {
        if (keys === null) return { ...data };
        const list = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of list) {
          if (k in data) out[k] = data[k];
        }
        return out;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(data, items);
      },
      remove: async (key: string) => {
        delete data[key];
      },
    };
    const listeners: Array<(changes: unknown, area: string) => void> = [];
    const browser = {
      storage: {
        local: area,
        sync: area,
        onChanged: {
          addListener: (cb: (changes: unknown, area: string) => void) => {
            listeners.push(cb);
          },
        },
      },
    };
    return { data, browser };
  }

  const markMigration = {
    1: (map: Record<string, { lastUsed?: number }>) => {
      const out: Record<string, { lastUsed?: number }> = {};
      for (const [k, v] of Object.entries(map)) {
        out[k] = { lastUsed: (v.lastUsed ?? 0) + 1 };
      }
      return out;
    },
  };

  it('writes per-key version so two stores in one area migrate independently', async () => {
    const { data, browser } = makeBrowser();
    vi.stubGlobal('browser', browser);
    data.a = { 'a.com': {} };
    data.b = { 'b.com': {} };
    const storeA = new KVStore<{ lastUsed?: number }>('local', 'a', mergeUnion, markMigration, 2);
    const storeB = new KVStore<{ lastUsed?: number }>('local', 'b', mergeUnion, markMigration, 2);
    await storeA.init();
    await storeB.init();
    expect(storeA.snapshot()['a.com']?.lastUsed).toBe(1);
    expect(storeB.snapshot()['b.com']?.lastUsed).toBe(1);
    expect(data['schemaVersion:a']).toBe(2);
    expect(data['schemaVersion:b']).toBe(2);
  });

  it('does not skip the second store when the first already reached the target version', async () => {
    const { data, browser } = makeBrowser();
    vi.stubGlobal('browser', browser);
    data.a = { 'a.com': { lastUsed: 1 } };
    data['schemaVersion:a'] = 2;
    data.b = { 'b.com': {} };
    const storeA = new KVStore<{ lastUsed?: number }>('local', 'a', mergeUnion, markMigration, 2);
    const storeB = new KVStore<{ lastUsed?: number }>('local', 'b', mergeUnion, markMigration, 2);
    await storeA.init();
    await storeB.init();
    expect(storeA.snapshot()['a.com']?.lastUsed).toBe(1);
    expect(storeB.snapshot()['b.com']?.lastUsed).toBe(1);
    expect(data['schemaVersion:b']).toBe(2);
  });
});
