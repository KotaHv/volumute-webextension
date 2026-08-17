import browser from 'webextension-polyfill';
import { hostnameOf } from './core/url';
import { isAutoMuted } from './core/priority';
import { autoMutedStore } from './storage/stores';
import { clearUserMuteChoices, getUserMuteChoice, rememberUserMuteChoice } from './storage/session';

const TOUCH_THROTTLE_MS = 10_000;

// Capability probe: Firefox Android throws on tabs.update({muted}),
// so the first natural attempt doubles as the detection.
let tabMuteSupported: boolean | null = null;

async function setTabMuted(tabId: number, muted: boolean): Promise<void> {
  try {
    await browser.tabs.update(tabId, { muted });
    if (tabMuteSupported === null) tabMuteSupported = true;
  } catch {
    if (tabMuteSupported === null) tabMuteSupported = false;
  }
}

function touch(hostname: string) {
  const now = Date.now();
  const lastd = autoMutedStore.snapshot()[hostname]?.lastUsed;
  if (lastd !== undefined && now - lastd < TOUCH_THROTTLE_MS) return;
  autoMutedStore.touchEntry(hostname);
}

async function pushMuteState(tabId: number, muted: boolean): Promise<void> {
  try {
    await browser.tabs.sendMessage(tabId, {
      type: 'vm:mute-state',
      muted,
    });
  } catch {
    /* no live content script yet; it pulls on load instead */
  }
}

export async function applyMuteToTab(tab: browser.Tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  const hostname = hostnameOf(tab.url ?? tab.pendingUrl ?? '');
  if (!hostname) return;
  const isMuted = tab.mutedInfo?.muted ?? false;
  const userChoice = await getUserMuteChoice(tab.id, hostname);
  const shouldMute = userChoice ?? isAutoMuted(autoMutedStore.snapshot(), hostname);

  if (isMuted === shouldMute && tabMuteSupported === true) return;

  if (tabMuteSupported === null) {
    await setTabMuted(tab.id, shouldMute);
    if (tabMuteSupported === false) await pushMuteState(tab.id, shouldMute);
  } else if (tabMuteSupported === true) {
    await setTabMuted(tab.id, shouldMute);
  } else {
    await pushMuteState(tab.id, shouldMute);
  }
  if (shouldMute) touch(hostname);
}

async function reapplyAll(): Promise<void> {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    void applyMuteToTab(tab);
  }
}

// Listeners must be registered synchronously at top level: on Firefox MV3 the
// background is a suspendable event page (and on Chrome a short-lived service
// worker), and a wake event is delivered right after the synchronous load
// phase. Registering listeners after an await would drop the very event that
// woke us. Handlers therefore await `ready` themselves before touching state.
const ready = autoMutedStore.init();

browser.runtime.onMessage.addListener(
  async (msg: unknown, sender: browser.Runtime.MessageSender) => {
    const m = msg as { type?: string } | undefined;
    if (!m || m.type !== 'vm:mute-query') return;
    await ready;
    const hostname = hostnameOf(sender.tab?.url ?? sender.url ?? '');
    return {
      muted: hostname !== null && isAutoMuted(autoMutedStore.snapshot(), hostname),
    };
  },
);
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.mutedInfo?.reason === 'user') {
    const hostname = hostnameOf(tab.url ?? tab.pendingUrl ?? '');
    if (hostname) {
      void rememberUserMuteChoice(tabId, hostname, changeInfo.mutedInfo.muted).catch(() => {});
    }
  }
  if (changeInfo.url || changeInfo.status === 'loading') void ready.then(() => applyMuteToTab(tab));
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

browser.storage.sync.onChanged.addListener((changes) => {
  if (changes.autoMuted) void ready.then(reapplyAll);
});

void ready.then(reapplyAll);
if (__BUILD_TARGET__ === 'chrome') {
  void ready.then(reinjectContentScripts);
}

// Chrome reloads kill the service worker: content scripts in already-open
// pages survive in their world, but every extension API call throws
// ("Extension context invalidated"). Ping each tab and re-inject where the
// content script no longer answers.
async function reinjectContentScripts(): Promise<void> {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    if (!tab.url || !/^https?:/.test(tab.url)) continue;
    try {
      await browser.tabs.sendMessage(tab.id, { type: 'vm:ping' });
    } catch {
      try {
        await browser.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ['src/content/audio-main.js'],
          world: 'MAIN',
        });
        await browser.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ['src/content/index.js'],
        });
      } catch {
        try {
          await browser.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['src/content/audio-main.js'],
            world: 'MAIN',
          });
          await browser.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['src/content/index.js'],
          });
        } catch {
          /* restricted page */
        }
      }
    }
  }
}
