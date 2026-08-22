import { DEFAULT_MAX_MULTIPLIER, KEYS, normalizeMaxMultiplier } from '../core/constants';
import type { Settings } from '../core/types';

const DEFAULTS: Settings = {
  lang: 'auto',
  theme: 'auto',
  maxMultiplier: DEFAULT_MAX_MULTIPLIER,
  popupVolumeMode: 'switch',
};

const subscribers = new Set<(s: Settings) => void>();

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.sync.get(KEYS.settings);
  const raw = stored[KEYS.settings] as Partial<Settings> | undefined;
  return {
    ...DEFAULTS,
    ...(raw ?? {}),
    maxMultiplier: normalizeMaxMultiplier(raw?.maxMultiplier ?? DEFAULTS.maxMultiplier),
  };
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  const next = {
    ...current,
    ...patch,
    maxMultiplier: normalizeMaxMultiplier(patch.maxMultiplier ?? current.maxMultiplier),
  };
  await browser.storage.sync.set({ [KEYS.settings]: next });
}

export function subscribeSettings(cb: (s: Settings) => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !(KEYS.settings in changes)) return;
  const raw = changes[KEYS.settings]?.newValue as Partial<Settings> | undefined;
  for (const cb of subscribers)
    cb({
      ...DEFAULTS,
      ...(raw ?? {}),
      maxMultiplier: normalizeMaxMultiplier(raw?.maxMultiplier ?? DEFAULTS.maxMultiplier),
    });
});
