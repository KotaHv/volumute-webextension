import browser from 'webextension-polyfill'
import { hostnameOf } from './core/url'
import { isAutoMuted } from './core/priority'
import { autoMutedStore as autoMuted, pageVolumesStore as pageVolumes, siteVolumesStore as siteVolumes } from './storage/stores'

const TOUCH_THROTTLE_MS = 60_000
const touchLog = new Map<string, number>()

function touch(kind: 'mute' | 'site' | 'page', key: string): void {
  const now = Date.now()
  const logKey = kind + '\u0000' + key
  const last = touchLog.get(logKey)
  if (last !== undefined && now - last < TOUCH_THROTTLE_MS) return
  touchLog.set(logKey, now)
  if (kind === 'mute') void autoMuted.touchEntry(key)
  else if (kind === 'site') void siteVolumes.touchEntry(key)
  else void pageVolumes.touchEntry(key)
}

async function applyMuteToTab(tab: browser.Tabs.Tab): Promise<void> {
  if (tab.id === undefined) return
  const hostname = hostnameOf(tab.url ?? tab.pendingUrl ?? '')
  if (!hostname) return
  const shouldMute = isAutoMuted(autoMuted.snapshot(), hostname)
  const isMuted = tab.mutedInfo?.muted ?? false

  // Browser-level mute (desktop). In-page mute (GainNode) is handled by the
  // content script reading autoMuted directly, which also covers Android.
  if (shouldMute) {
    if (!isMuted) {
      await browser.tabs.update(tab.id, { muted: true }).catch(() => {})
    }
    touch('mute', hostname)
  } else if (isMuted && tab.mutedInfo?.reason === 'extension') {
    await browser.tabs.update(tab.id, { muted: false }).catch(() => {})
  }
}

async function reapplyAll(): Promise<void> {
  const tabs = await browser.tabs.query({})
  for (const tab of tabs) {
    void applyMuteToTab(tab)
  }
}

async function main(): Promise<void> {
  await Promise.all([autoMuted.init(), siteVolumes.init(), pageVolumes.init()])

  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'loading') void applyMuteToTab(tab)
  })
  browser.tabs.onActivated.addListener(({ tabId }) => {
    void browser.tabs.get(tabId).then(applyMuteToTab).catch(() => {})
  })

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.autoMuted) void reapplyAll()
  })

  browser.runtime.onMessage.addListener((msg: unknown, sender: browser.Runtime.MessageSender) => {
    const m = msg as { type?: string; hostname?: string; path?: string } | undefined
    if (!m) return
    if (m.type === 'vm:apply-mute' && sender.tab?.id != null) {
      void browser.tabs.get(sender.tab.id).then(applyMuteToTab).catch(() => {})
    } else if (m.type === 'vm:used' && m.hostname) {
      touch('site', m.hostname)
      if (m.path) touch('page', m.path)
    }
  })

  if (browser.runtime.onStartup) {
    browser.runtime.onStartup.addListener(() => {
      void reapplyAll()
    })
  }
  void reapplyAll()
}

void main()
