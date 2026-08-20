import browser from 'webextension-polyfill';
import { hostnameOf } from '../core/url';
import { autoMutedStore, pageVolumesStore, siteVolumesStore } from '../storage/stores';
import { getSettings, subscribeSettings } from '../storage/settings';
import { clearUserMuteChoices, rememberUserMuteChoice } from '../storage/session';
import { applyMuteToTab } from './mute';
import { applyTabVolume, recomputeAll, setMaxMultiplier, volumeForSender } from './volume';
import { reinjectContentScripts } from './reinject';

// Listeners must be registered synchronously at top level: on Firefox MV3 the
// background is a suspendable event page (and on Chrome a short-lived service
// worker), and a wake event is delivered right after the synchronous load
// phase. Handlers therefore await `ready` themselves before touching state.
const ready = Promise.all([
  autoMutedStore.init(),
  siteVolumesStore.init(),
  pageVolumesStore.init(),
  getSettings().then((s) => setMaxMultiplier(s.maxMultiplier)),
]);

// Recomputes are collapsed and serialized: one storage event can change several
// keys at once (each store then emits separately), and concurrent sweeps could
// push an older snapshot after a newer one. Requests arriving together in the
// same event-loop tick merge into a single sweep; a request arriving while a
// sweep is running triggers exactly one follow-up sweep with the newest state.
let scheduled = false;
let again = false;

function scheduleRecompute(): void {
  if (scheduled) {
    again = true;
    return;
  }
  scheduled = true;
  void ready.then(async () => {
    try {
      do {
        again = false;
        await recomputeAll(false);
      } while (again);
    } finally {
      scheduled = false;
    }
  });
}

// Writers (popup, options) commit volume/mute entries through their own KVStore
// instances; this background instance observes the committed storage changes,
// refreshes its caches and redistributes the resulting effective volume to
// every tab.
autoMutedStore.onChange(scheduleRecompute);
siteVolumesStore.onChange(scheduleRecompute);
pageVolumesStore.onChange(scheduleRecompute);

subscribeSettings((s) => {
  setMaxMultiplier(s.maxMultiplier);
  scheduleRecompute();
});

browser.runtime.onMessage.addListener(
  async (msg: unknown, sender: browser.Runtime.MessageSender) => {
    const m = msg as { type?: string } | undefined;
    if (!m || m.type !== 'vm:volume-query') return;
    await ready;
    const url = sender.tab?.url ?? sender.url ?? '';
    return { volume: await volumeForSender(sender.tab?.id, url) };
  },
);
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.mutedInfo?.reason === 'user') {
    const hostname = hostnameOf(tab.url ?? tab.pendingUrl ?? '');
    if (hostname) {
      void rememberUserMuteChoice(tabId, hostname, changeInfo.mutedInfo.muted).catch(() => {});
    }
  }
  if (changeInfo.url || changeInfo.status === 'loading') {
    void ready.then(async () => {
      await applyMuteToTab(tab);
      await applyTabVolume(tab, true);
    });
  }
});
browser.tabs.onActivated.addListener(({ tabId }) => {
  void ready
    .then(() => browser.tabs.get(tabId))
    .then(applyMuteToTab)
    .catch(() => {});
});
browser.tabs.onRemoved.addListener((tabId) => {
  void clearUserMuteChoices(tabId).catch(() => {});
});

void ready.then(() => recomputeAll(true));
if (__BUILD_TARGET__ === 'chrome') {
  void ready.then(reinjectContentScripts);
}