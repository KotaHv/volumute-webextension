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

// Effective gain: a muted tab goes silent only when native tab muting is
// unavailable; otherwise the stored multiplier still applies (the browser
// layer owns the silence).
export function computeGain(
  shouldMute: boolean,
  nativeMuteSupported: boolean | null,
  pageVolumes: PageVolumeMap,
  siteVolumes: SiteVolumeMap,
  path: string,
  hostname: string,
  max = DEFAULT_MAX_MULTIPLIER,
): number {
  if (shouldMute && nativeMuteSupported === false) return 0;
  return computeMultiplier(pageVolumes, siteVolumes, path, hostname, max);
}

// Effective mute decision: a remembered user choice wins, otherwise the site's
// auto-mute setting applies.
export function resolveMuted(
  userChoice: boolean | undefined,
  muteMap: MuteMap,
  hostname: string | null,
): boolean {
  if (hostname === null) return false;
  return userChoice ?? isAutoMuted(muteMap, hostname);
}

function clamp(v: number, max: number): number {
  if (!Number.isFinite(v)) return DEFAULT_MULTIPLIER;
  return Math.min(max, Math.max(0, v));
}
