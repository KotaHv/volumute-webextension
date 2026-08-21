import { DEFAULT_MULTIPLIER } from '../core/types';

export function diffVolumes(oldValue: unknown, newValue: unknown): Map<string, number> {
  const old = (oldValue ?? {}) as { [key: string]: { multiplier?: number } | undefined };
  const next = (newValue ?? {}) as { [key: string]: { multiplier?: number } | undefined };
  const out = new Map<string, number>();
  const keys = new Set([...Object.keys(old), ...Object.keys(next)]);
  for (const key of keys) {
    const a = old[key]?.multiplier;
    const b = next[key]?.multiplier;
    if (a !== b) out.set(key, b ?? DEFAULT_MULTIPLIER);
  }
  return out;
}

export function diffMute(oldValue: unknown, newValue: unknown): Map<string, boolean> {
  const old = (oldValue ?? {}) as { [key: string]: { enabled?: boolean } | undefined };
  const next = (newValue ?? {}) as { [key: string]: { enabled?: boolean } | undefined };
  const out = new Map<string, boolean>();
  const keys = new Set([...Object.keys(old), ...Object.keys(next)]);
  for (const key of keys) {
    const a = old[key]?.enabled === true;
    const b = next[key]?.enabled === true;
    if (a !== b) out.set(key, b);
  }
  return out;
}

export function settingsMaxChanged(
  oldValue: unknown,
  newValue: unknown,
): { changed: boolean; oldMax: number | undefined; newMax: number | undefined } {
  const oldMax = (oldValue as { maxMultiplier?: number } | undefined)?.maxMultiplier;
  const newMax = (newValue as { maxMultiplier?: number } | undefined)?.maxMultiplier;
  return { changed: oldMax !== newMax, oldMax, newMax };
}