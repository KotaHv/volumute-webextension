import { DEFAULT_MAX_MULTIPLIER, normalizeMaxMultiplier } from './constants';
import { DEFAULT_MULTIPLIER } from './types';
import type { MuteMap, PageVolumeMap, SiteVolumeMap } from './types';

export function computeMultiplier(
  pageVolumes: PageVolumeMap,
  siteVolumes: SiteVolumeMap,
  path: string,
  hostname: string,
  maxMultiplier = DEFAULT_MAX_MULTIPLIER,
): number {
  const max = normalizeMaxMultiplier(maxMultiplier);
  const page = pageVolumes[path];
  if (page) return clamp(page.multiplier, max);
  const site = siteVolumes[hostname];
  if (site) return clamp(site.multiplier, max);
  return DEFAULT_MULTIPLIER;
}

export function isAutoMuted(muteMap: MuteMap, hostname: string): boolean {
  return muteMap[hostname]?.enabled === true;
}

function clamp(v: number, max: number): number {
  if (!Number.isFinite(v)) return DEFAULT_MULTIPLIER;
  return Math.min(max, Math.max(0, v));
}
