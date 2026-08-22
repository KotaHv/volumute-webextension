import browser from 'webextension-polyfill';
import { hostnameOf } from '../core/url';
import { DEFAULT_MAX_MULTIPLIER, KEYS } from '../core/constants';
import { autoMutedStore, pageVolumesStore, siteVolumesStore } from '../storage/stores';
import { getSettings } from '../storage/settings';
import { clearUserMuteChoices, rememberUserMuteChoice } from '../storage/session';
import { applyMute, applyMuteToTab, applyMuteToTabs } from './mute';
import { applyMaxClamp, applyVolumeToTabs, pushVolume, volumeForSender } from './volume';
import { diffMute, diffVolumes, settingsMaxChanged } from './diff';
import { loadApplyContext, setMaxMultiplier } from './runtime';
import type { ApplyContext } from './runtime';
import { reinjectContentScripts } from './reinject';

// Listeners must be registered synchronously at the top level (MV3).
const ready = Promise.all([
  autoMutedStore.init(),
  siteVolumesStore.init(),
  pageVolumesStore.init(),
  getSettings().then((s) => setMaxMultiplier(s.maxMultiplier)),
]);

let chain: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>): void {
  chain = chain.then(task).catch((error) => {
    console.error('[VoluMute] background apply task failed:', error);
  });
}

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync') {
    const mute = diffMute(changes[KEYS.autoMuted]?.oldValue, changes[KEYS.autoMuted]?.newValue);
    if (mute.size) enqueue(() => applyMuteToTabs(mute));

    const max = settingsMaxChanged(changes[KEYS.settings]?.oldValue, changes[KEYS.settings]?.newValue);
    if (max.changed) {
      enqueue(() => {
        setMaxMultiplier(max.newMax ?? DEFAULT_MAX_MULTIPLIER);
        return applyMaxClamp(
          max.oldMax ?? DEFAULT_MAX_MULTIPLIER,
          max.newMax ?? DEFAULT_MAX_MULTIPLIER,
        );
      });
    }
  } else if (areaName === 'local') {
    const volChanges = new Map<string, number>([
      ...diffVolumes(changes[KEYS.siteVolumes]?.oldValue, changes[KEYS.siteVolumes]?.newValue),
      ...diffVolumes(changes[KEYS.pageVolumes]?.oldValue, changes[KEYS.pageVolumes]?.newValue),
    ]);
    if (volChanges.size) enqueue(() => applyVolumeToTabs(volChanges));
  }
});

browser.runtime.onMessage.addListener(
  async (msg: unknown, sender: browser.Runtime.MessageSender) => {
    const m = msg as { type?: string } | undefined;
    if (!m || m.type !== 'vm:volume-query') return;
    try {
      await ready;
      const url = sender.tab?.url ?? sender.url ?? '';
      return { volume: await volumeForSender(sender.tab?.id, url) };
    } catch (error) {
      console.error('[VoluMute] volume query failed:', error);
      return undefined;
    }
  },
);

async function refreshTab(tab: browser.Tabs.Tab, ctx?: ApplyContext): Promise<void> {
  const context = ctx ?? (await loadApplyContext());
  await applyMute(tab, context);
  await pushVolume(tab, context, true);
}

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.mutedInfo?.reason === 'user') {
    const hostname = hostnameOf(tab.url ?? tab.pendingUrl ?? '');
    if (hostname) {
      void rememberUserMuteChoice(tabId, hostname, changeInfo.mutedInfo.muted).catch((error) => {
        console.warn('[VoluMute] failed to remember user mute choice:', error);
      });
    }
  }
  if (changeInfo.url || changeInfo.status === 'loading') {
    void ready.then(() => refreshTab(tab)).catch((error) => {
      console.warn('[VoluMute] tab refresh failed:', error);
    });
  }
});
browser.tabs.onActivated.addListener(({ tabId }) => {
  void ready
    .then(() => browser.tabs.get(tabId))
    .then(applyMuteToTab)
    .catch((error) => {
      console.warn('[VoluMute] activation mute re-check failed:', error);
    });
});
browser.tabs.onRemoved.addListener((tabId) => {
  void clearUserMuteChoices(tabId).catch((error) => {
    console.warn('[VoluMute] failed to clear user mute choices:', error);
  });
});

async function applyAll(): Promise<void> {
  const tabs = await browser.tabs.query({});
  const ctx = await loadApplyContext();
  for (const tab of tabs) await refreshTab(tab, ctx);
}

void ready.then(applyAll).catch((error) => {
  console.error('[VoluMute] startup sweep failed:', error);
});
if (__BUILD_TARGET__ === 'chrome') {
  void ready.then(reinjectContentScripts).catch((error) => {
    console.error('[VoluMute] content script re-injection failed:', error);
  });
}
