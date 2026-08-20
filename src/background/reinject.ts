import browser from 'webextension-polyfill';

// Chrome reloads kill the service worker: content scripts in already-open
// pages survive in their world, but every extension API call throws
// ("Extension context invalidated"). Ping each tab and re-inject where the
// content script no longer answers.
export async function reinjectContentScripts(): Promise<void> {
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