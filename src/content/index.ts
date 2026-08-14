import browser from 'webextension-polyfill'
import { hostnameOf, pathKeyOf } from '../core/url'
import type { PageVolumeMap, SiteVolumeMap } from '../core/types'
import { AudioController, hookMediaElements } from './audio'

const hostname = hostnameOf(location.href)
let currentPath = pathKeyOf(location.href)

const controller = new AudioController()
hookMediaElements(controller)

async function applyVolume(): Promise<void> {
  const stored = await browser.storage.local.get(['pageVolumes', 'siteVolumes'])
  const pageVolumes = (stored.pageVolumes ?? {}) as PageVolumeMap
  const siteVolumes = (stored.siteVolumes ?? {}) as SiteVolumeMap
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
  controller.setVolume(volume)
  if (used && hostname) {
    void browser.runtime.sendMessage({ type: 'vm:used', hostname, path: currentPath }).catch(() => {})
  }
}

void applyVolume()

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.pageVolumes || changes.siteVolumes)) {
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

for (const m of ['pushState', 'replaceState'] as const) {
  const orig = history[m].bind(history)
  history[m] = ((...args: unknown[]) => {
    const r = orig(...(args as [unknown, string, string?]))
    onUrlChanged()
    return r
  }) as typeof history.pushState
}
window.addEventListener('popstate', onUrlChanged)
window.addEventListener('hashchange', onUrlChanged)

setInterval(() => {
  const p = pathKeyOf(location.href)
  if (p !== currentPath) onUrlChanged()
}, 1500)

function notifyApplyMute(): void {
  void browser.runtime.sendMessage({ type: 'vm:apply-mute' }).catch(() => {})
}

notifyApplyMute()

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) notifyApplyMute()
})
window.addEventListener('pageshow', () => notifyApplyMute())
