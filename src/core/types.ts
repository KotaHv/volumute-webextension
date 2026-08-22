export interface EntryBase {
  created: number;
  lastUsed: number;
}

export interface MuteEntry extends EntryBase {
  enabled: boolean;
  deviceId: string;
}

export interface VolumeEntry extends EntryBase {
  multiplier: number;
}

export type Lang = 'auto' | 'zh' | 'en';
export type ThemeMode = 'auto' | 'light' | 'dark';
export type PopupVolumeMode = 'switch' | 'dual';
export type VolumeScope = 'page' | 'site';

export interface Settings {
  lang: Lang;
  theme: ThemeMode;
  maxMultiplier: number;
  popupVolumeMode: PopupVolumeMode;
}

export type MuteMap = Record<string, MuteEntry>;
export type SiteVolumeMap = Record<string, VolumeEntry>;
export type PageVolumeMap = Record<string, VolumeEntry>;

export const DEFAULT_MULTIPLIER = 1;
