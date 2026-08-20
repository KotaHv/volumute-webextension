import browser from 'webextension-polyfill';
import { hostnameOf, pathKeyOf } from '../core/url';
import { computeMultiplier } from '../core/priority';
import { DEFAULT_MAX_MULTIPLIER } from '../core/constants';
import type { PageVolumeMap, SiteVolumeMap } from '../core/types';
import { pageVolumesStore, siteVolumesStore } from '../storage/stores';
import { applyMuteToTab, effectiveShouldMute, tabMuteSupported } from './mute';

let maxMultiplier = DEFAULT_MAX_MULTIPLIER;

export function setMaxMultiplier(value: number): void {
  maxMultiplier = value;
}

// Effective gain for a tab. While native tab muting is available (including
// the unknown probe state) the gain is ALWAYS the stored multiplier and muting
// is left to the browser layer (tabs.update({ muted })). Only in fallback mode
// (native muting unsupported) does a muted tab get gain 0.
export function computeGain(
  shouldMute: boolean,
  nativeMuteSupported: boolean | null,
  pageVolumes: PageVolumeMap,
  siteVolumes: SiteVolumeMap,
  path: string,
  hostname: string,
  max: number = DEFAULT_MAX_MULTIPLIER,
): number {
  if (shouldMute && nativeMuteSupported === false) return 0;
  return computeMultiplier(pageVolumes, siteVolumes, path, hostname, max);
}

// Push the authoritative per-tab volume to every frame of the tab (the
// manifest's all_frames content scripts extend to cross-origin iframes).
// `touch` is true only for URL-driven syncs (load / navigation): storage-driven
// re-applications must NOT touch our own writes (write loop).
export async function applyTabVolume(tab: browser.Tabs.Tab, touch: boolean): Promise<void> {
  if (tab.id === undefined) return;
  const url = tab.url ?? tab.pendingUrl ?? '';
  const hostname = hostnameOf(url);
  const path = pathKeyOf(url);
  const shouldMute = await effectiveShouldMute(tab.id, url);
  const pageVolumes = pageVolumesStore.snapshot();
  const siteVolumes = siteVolumesStore.snapshot();
  const gain = computeGain(
    shouldMute,
    tabMuteSupported,
    pageVolumes,
    siteVolumes,
    path ?? '',
    hostname ?? '',
    maxMultiplier,
  );
  if (touch && !shouldMute) {
    if (path && pageVolumes[path]) {
      void pageVolumesStore.touchEntry(path);
    } else if (hostname && siteVolumes[hostname]) {
      void siteVolumesStore.touchEntry(hostname);
    }
  }
  try {
    await browser.tabs.sendMessage(tab.id, { type: 'vm:volume', volume: gain });
  } catch {
    /* no live content script yet; it pulls on load instead */
  }
}

export async function recomputeAll(touch: boolean): Promise<void> {
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    await applyMuteToTab(tab);
    await applyTabVolume(tab, touch);
  }
}

// Volume for a frame that asks on load (or after a Chrome reload re-injection).
export async function volumeForSender(
  tabId: number | undefined,
  url: string,
): Promise<number> {
  const shouldMute = await effectiveShouldMute(tabId, url);
  return computeGain(
    shouldMute,
    tabMuteSupported,
    pageVolumesStore.snapshot(),
    siteVolumesStore.snapshot(),
    pathKeyOf(url) ?? '',
    hostnameOf(url) ?? '',
    maxMultiplier,
  );
}