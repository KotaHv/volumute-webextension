import browser from "webextension-polyfill";
import { hostnameOf } from "./core/url";
import { isAutoMuted } from "./core/priority";
import { autoMutedStore } from "./storage/stores";

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
      type: "vm:mute-state",
      muted,
    });
  } catch {
    /* no live content script yet; it pulls on load instead */
  }
}

async function applyMuteToTab(tab: browser.Tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  const hostname = hostnameOf(tab.url ?? tab.pendingUrl ?? "");
  if (!hostname) return;
  const shouldMute = isAutoMuted(autoMutedStore.snapshot(), hostname);
  const isMuted = tab.mutedInfo?.muted ?? false;

  if (shouldMute) {
    if (isMuted) return;
    if (tabMuteSupported === true) {
      await setTabMuted(tab.id, true);
    } else if (tabMuteSupported === false) {
      await pushMuteState(tab.id, true);
    } else {
      await setTabMuted(tab.id, true);
      if (tabMuteSupported === false) {
        await pushMuteState(tab.id, true);
      }
    }
    touch(hostname);
  } else {
    if (tabMuteSupported === false) {
      await pushMuteState(tab.id, false);
    } else if (tabMuteSupported === true) {
      if (isMuted && tab.mutedInfo?.reason === "extension") {
        await setTabMuted(tab.id, false);
      }
    } else {
      await setTabMuted(tab.id, false);
      if (tabMuteSupported === false) {
        await pushMuteState(tab.id, false);
      }
    }
  }
}

async function reapplyAll(): Promise<void> {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    void applyMuteToTab(tab);
  }
}

async function main(): Promise<void> {
  await autoMutedStore.init();
  browser.runtime.onMessage.addListener(
    async (msg: unknown, sender: browser.Runtime.MessageSender) => {
      const m = msg as { type?: string } | undefined;
      if (!m || m.type !== "vm:mute-query") return;
      const hostname = hostnameOf(sender.tab?.url ?? sender.url ?? "");
      return {
        muted: hostname !== null && isAutoMuted(autoMutedStore.snapshot(), hostname),
      };
    },
  );
  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === "loading")
      void applyMuteToTab(tab);
  });
  browser.tabs.onActivated.addListener(({ tabId }) => {
    void browser.tabs
      .get(tabId)
      .then(applyMuteToTab)
      .catch(() => {});
  });

  browser.storage.sync.onChanged.addListener((changes) => {
    if (changes.autoMuted) void reapplyAll();
  });

  if (browser.runtime.onStartup) {
    browser.runtime.onStartup.addListener(() => {
      void reapplyAll();
    });
  }
  void reapplyAll();
  if (__BUILD_TARGET__ === 'chrome') {
    void reinjectContentScripts();
  }
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

void main();
