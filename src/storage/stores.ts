import { DATA_VERSION, KEYS } from '../core/constants'
import { MUTE_MIGRATIONS, VOLUME_MIGRATIONS } from '../core/migrate'
import { KVStore, mergeByLastWrite, mergeUnion } from './kvstore'
import type { MuteEntry, VolumeEntry } from '../core/types'

export const autoMutedStore = new KVStore<MuteEntry>('sync', KEYS.autoMuted, mergeByLastWrite, MUTE_MIGRATIONS, DATA_VERSION)
export const siteVolumesStore = new KVStore<VolumeEntry>('local', KEYS.siteVolumes, mergeUnion, VOLUME_MIGRATIONS, DATA_VERSION)
export const pageVolumesStore = new KVStore<VolumeEntry>('local', KEYS.pageVolumes, mergeUnion, VOLUME_MIGRATIONS, DATA_VERSION)
