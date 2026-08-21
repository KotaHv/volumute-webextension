import { describe, expect, it } from 'vitest';
import { diffMute, diffVolumes, settingsMaxChanged } from './diff';

const vol = (multiplier: number): { multiplier: number; created: number; lastUsed: number } => ({
  multiplier,
  created: 1,
  lastUsed: 1,
});

describe('diffVolumes', () => {
  it('reports added entries with their multiplier', () => {
    expect(diffVolumes({}, { a: vol(0.5) })).toEqual(new Map([['a', 0.5]]));
  });

  it('reports removed entries as the default multiplier', () => {
    expect(diffVolumes({ a: vol(0.5) }, {})).toEqual(new Map([['a', 1]]));
  });

  it('reports multiplier changes', () => {
    expect(diffVolumes({ a: vol(0.5) }, { a: vol(0.9) })).toEqual(new Map([['a', 0.9]]));
  });

  it('ignores lastUsed-only changes (a mere touch)', () => {
    expect(diffVolumes({ a: vol(0.5) }, { a: vol(0.5) }).size).toBe(0);
  });

  it('keeps site and page keys distinct in one merged map', () => {
    const out = new Map([
      ...diffVolumes({}, { 'example.com': vol(0.5) }),
      ...diffVolumes({}, { 'https://example.com/a': vol(0.3) }),
    ]);
    expect(out).toEqual(
      new Map([
        ['example.com', 0.5],
        ['https://example.com/a', 0.3],
      ]),
    );
  });
});

describe('diffMute', () => {
  const mute = (enabled: boolean) => ({ enabled, created: 1, lastUsed: 1, deviceId: 'x' });

  it('reports an added mute as true and a removal as false', () => {
    expect([...diffMute({}, { a: mute(true) })]).toEqual([['a', true]]);
    expect([...diffMute({ a: mute(true) }, {})]).toEqual([['a', false]]);
  });

  it('ignores unchanged entries', () => {
    expect(diffMute({ a: mute(true) }, { a: mute(true) }).size).toBe(0);
  });
});

describe('settingsMaxChanged', () => {
  it('detects maxMultiplier changes and reports both values', () => {
    expect(settingsMaxChanged({ maxMultiplier: 5 }, { maxMultiplier: 3 })).toEqual({
      changed: true,
      oldMax: 5,
      newMax: 3,
    });
  });

  it('ignores unchanged settings', () => {
    expect(settingsMaxChanged({ maxMultiplier: 5 }, { maxMultiplier: 5 }).changed).toBe(false);
  });
});