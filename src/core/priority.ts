import { DEFAULT_MULTIPLIER } from './types'
import type { MuteMap, PageVolumeMap, SiteVolumeMap } from './types'

export function computeMultiplier(
  pageVolumes: PageVolumeMap,
  siteVolumes: SiteVolumeMap,
  path: string,
  hostname: string,
): number {
  const page = pageVolumes[path]
  if (page) return clamp(page.multiplier)
  const site = siteVolumes[hostname]
  if (site) return clamp(site.multiplier)
  return DEFAULT_MULTIPLIER
}

export function isAutoMuted(muteMap: MuteMap, hostname: string): boolean {
  return muteMap[hostname]?.enabled === true
}

function clamp(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_MULTIPLIER
  return Math.min(5, Math.max(0, v))
}
