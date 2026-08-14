import browser from 'webextension-polyfill'
import { hostnameOf, pathKeyOf } from '../core/url'
import { isAutoMuted } from '../core/priority'
import type { MuteMap, PageVolumeMap, SiteVolumeMap } from '../core/types'
import { AudioController, hookMediaElements } from './audio'
import { setupUrlTracking } from './routing'

const isTopFrame = window.top === window
const hostname = hostnameOf(location.href)
let currentPath = pathKeyOf(location.href)

const controller = new AudioController()
hookMediaElements(controller)

async function applyVolume(): Promise<void> {
  const [local, sync] = await Promise.all([
    browser.storage.local.get(['pageVolumes', 'siteVolumes']),
    browser.storage.sync.get('autoMuted'),
  ])
  const pageVolumes = (local.pageVolumes ?? {}) as PageVolumeMap
  const siteVolumes = (local.siteVolumes ?? {}) as SiteVolumeMap
  const autoMuted = (sync.autoMuted ?? {}) as MuteMap

  const muted = !!hostname && isAutoMuted(autoMuted, hostname)

  let volume = 1
  let used: 'page' | 'site' | null = null
  if (currentPath) {
    const pv = pageVolumes[currentPath]
    if (pv) {
      volume = pv.v
      used = 'page'
    }
  }
  if (used === null && hostname) {
    const sv = siteVolumes[hostname]
    if (sv) {
      volume = sv.v
      used = 'site'
    }
  }
  controller.setVolume(muted ? 0 : volume)
  if (used && hostname && isTopFrame) {
    void browser.runtime.sendMessage({ type: 'vm:used', hostname, path: currentPath }).catch(() => {})
  }
}

void applyVolume()

browser.storage.onChanged.addListener((changes, area) => {
  if (
    (area === 'local' && (changes.pageVolumes || changes.siteVolumes)) ||
    (area === 'sync' && changes.autoMuted)
  ) {
    void applyVolume()
  }
})

function onUrlChanged(): void {
  const p = pathKeyOf(location.href)
  if (p !== currentPath) {
    currentPath = p
    void applyVolume()
  }
}

setupUrlTracking(onUrlChanged)

function notifyApplyMute(): void {
  if (!isTopFrame) return
  void browser.runtime.sendMessage({ type: 'vm:apply-mute' }).catch(() => {})
}

notifyApplyMute()
window.addEventListener('pageshow', () => notifyApplyMute())
