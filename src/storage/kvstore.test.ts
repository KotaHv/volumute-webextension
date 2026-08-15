import { describe, expect, it } from 'vitest';
import { evictOldest, mergeByLastWrite, mergeFresh, mergeUnion } from './kvstore';
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
