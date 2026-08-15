export interface EntryBase {
  created: number
  lastUsed: number
}

export interface MuteEntry extends EntryBase {
  enabled: boolean
  deviceId: string
}

export interface VolumeEntry extends EntryBase {
  multiplier: number
}

export type Lang = 'auto' | 'zh' | 'en'
export type ThemeMode = 'auto' | 'light' | 'dark'

export interface Settings {
  lang: Lang
  theme: ThemeMode
}

export type MuteMap = Record<string, MuteEntry>
export type SiteVolumeMap = Record<string, VolumeEntry>
export type PageVolumeMap = Record<string, VolumeEntry>

export interface EffectiveConfig {
  hostname: string
  path: string
  mute: boolean
  multiplier: number
}

export const MAX_MULTIPLIER = 5
export const DEFAULT_MULTIPLIER = 1

export interface QuotaStats {
  bytes: number
  items: number
}
