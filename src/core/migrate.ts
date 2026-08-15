import type { MuteEntry, MuteMap, VolumeEntry } from './types'

type LegacyMute = { enabled: boolean; ts?: number; deviceId: string }
type LegacyVolume = { v?: number; t?: number }

// Migration table: key = starting version, value = migrate one step (to start+1).
export const MUTE_MIGRATIONS: Record<number, (map: MuteMap) => MuteMap> = {
  1: (map) => {
    let changed = false
    const out: MuteMap = {}
    for (const [key, entry] of Object.entries(map)) {
      const legacy = entry as unknown as LegacyMute
      if (typeof entry.lastUsed === 'number' && typeof entry.created === 'number') {
        out[key] = entry
        continue
      }
      changed = true
      const now = Date.now()
      out[key] = {
        enabled: entry.enabled,
        deviceId: entry.deviceId,
        created: typeof entry.created === 'number' ? entry.created : now,
        lastUsed: typeof entry.lastUsed === 'number' ? entry.lastUsed : legacy.ts ?? now,
      } satisfies MuteEntry
    }
    return changed ? out : map
  },
}

export const VOLUME_MIGRATIONS: Record<number, (map: Record<string, VolumeEntry>) => Record<string, VolumeEntry>> = {
  1: (map) => {
    let changed = false
    const out: Record<string, VolumeEntry> = {}
    for (const [key, entry] of Object.entries(map)) {
      const legacy = entry as unknown as LegacyVolume
      if (
        typeof entry.multiplier === 'number' &&
        typeof entry.created === 'number' &&
        typeof entry.lastUsed === 'number'
      ) {
        out[key] = entry
        continue
      }
      changed = true
      const now = Date.now()
      out[key] = {
        multiplier: typeof entry.multiplier === 'number' ? entry.multiplier : legacy.v ?? 1,
        created: typeof entry.created === 'number' ? entry.created : now,
        lastUsed: typeof entry.lastUsed === 'number' ? entry.lastUsed : legacy.t ?? now,
      } satisfies VolumeEntry
    }
    return changed ? out : map
  },
}

// Apply migration steps from `fromVersion` up to `toVersion`.
// Returns null when a migration step is missing (no known upgrade path).
export function migrateMap<T>(
  migrations: Record<number, (map: T) => T>,
  data: T,
  fromVersion: number,
  toVersion: number,
): T | null {
  let current = data
  let version = fromVersion
  while (version < toVersion) {
    const step = migrations[version]
    if (!step) return null
    current = step(current)
    version++
  }
  return current
}
