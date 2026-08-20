import browser from 'webextension-polyfill';
import { hostnameOf } from '../core/url';
import { isAutoMuted } from '../core/priority';
import { autoMutedStore } from '../storage/stores';
import { getUserMuteChoice } from '../storage/session';

const TOUCH_THROTTLE_MS = 10_000;

// Capability probe: Firefox Android throws on tabs.update({muted}),
// so the first natural attempt doubles as the detection.
export let tabMuteSupported: boolean | null = null;

export async function setTabMuted(tabId: number, muted: boolean): Promise<void> {
  try {
    await browser.tabs.update(tabId, { muted });
    if (tabMuteSupported === null) tabMuteSupported = true;
  } catch {
    if (tabMuteSupported === null) tabMuteSupported = false;
  }
}

function touchMuteEntry(hostname: string): void {
  const now = Date.now();
  const lastd = autoMutedStore.snapshot()[hostname]?.lastUsed;
  if (lastd !== undefined && now - lastd < TOUCH_THROTTLE_MS) return;
  autoMutedStore.touchEntry(hostname);
}

// Effective mute decision for a tab: a remembered user choice wins, otherwise
// the site's auto-mute setting applies. Shared by the mute path (native tab
// muting) and the volume path (fallback gain 0).
export async function effectiveShouldMute(
  tabId: number | undefined,
  url: string,
): Promise<boolean> {
  if (tabId === undefined) return false;
  const hostname = hostnameOf(url);
  if (!hostname) return false;
  const userChoice = await getUserMuteChoice(tabId, hostname);
  return userChoice ?? isAutoMuted(autoMutedStore.snapshot(), hostname);
}

// Native tab muting layer. When tabs.update({ muted }) is unsupported, silence
// is delivered through the volume channel instead (see volume.ts), so no
// content-script mute message is needed here anymore.
export async function applyMuteToTab(tab: browser.Tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  const hostname = hostnameOf(tab.url ?? tab.pendingUrl ?? '');
  if (!hostname) return;
  const isMuted = tab.mutedInfo?.muted ?? false;
  const shouldMute = await effectiveShouldMute(tab.id, tab.url ?? tab.pendingUrl ?? '');

  if (isMuted === shouldMute && tabMuteSupported === true) return;

  if (tabMuteSupported === null || tabMuteSupported === true) {
    await setTabMuted(tab.id, shouldMute);
  }
  // tabMuteSupported === false: nothing to mutate natively; the volume layer
  // pushes gain 0 for muted tabs.
  if (shouldMute) touchMuteEntry(hostname);
}