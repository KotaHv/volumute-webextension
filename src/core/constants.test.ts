import { describe, expect, it } from 'vitest';
import { displayVersion, normalizeMaxMultiplier } from './constants';

describe('normalizeMaxMultiplier', () => {
  it('keeps the custom maximum at least at the default volume', () => {
    expect(normalizeMaxMultiplier(0.5)).toBe(1);
    expect(normalizeMaxMultiplier(3)).toBe(3);
    expect(normalizeMaxMultiplier(800)).toBe(800);
  });
});

describe('displayVersion', () => {
  it('keeps normal release versions unchanged', () => {
    expect(displayVersion('0.1.4')).toBe('0.1.4');
    expect(displayVersion('1.0.0')).toBe('1.0.0');
  });

  it('hides the channel marker on unlisted companion versions', () => {
    expect(displayVersion('0.1.4.0')).toBe('0.1.4');
  });

  it('keeps real 4th-segment versions visible', () => {
    expect(displayVersion('0.1.4.1')).toBe('0.1.4.1');
    expect(displayVersion('0.1.4.10')).toBe('0.1.4.10');
  });
});
