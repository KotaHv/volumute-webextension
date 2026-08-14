import { KEYS } from '../core/constants'
import { KVStore, mergeByLastWrite, mergeUnion } from './kvstore'
import type { MuteEntry, VolumeEntry } from '../core/types'

export const autoMutedStore = new KVStore<MuteEntry>('sync', KEYS.autoMuted, mergeByLastWrite)
export const siteVolumesStore = new KVStore<VolumeEntry>('local', KEYS.siteVolumes, mergeUnion)
export const pageVolumesStore = new KVStore<VolumeEntry>('local', KEYS.pageVolumes, mergeUnion)
