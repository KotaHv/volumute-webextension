import browser from 'webextension-polyfill';
import { hostnameOf, pathKeyOf } from '../core/url';
import { computeGain, computeMultiplier } from '../core/priority';
import type { KVStore } from '../storage/kvstore';
import type { VolumeEntry } from '../core/types';
import { pageVolumesStore, siteVolumesStore } from '../storage/stores';
import { loadApplyContext, maxMultiplier, pushGain, shouldMuteFor, tabMuteSupported } from './runtime';
import type { ApplyContext } from './runtime';

async function syncTabVolume(
  tab: browser.Tabs.Tab,
  ctx: ApplyContext,
  touch: boolean,
  hostname: string | null,
  path: string | null,
  multiplier: number,
): Promise<void> {
  if (tab.id === undefined) return;
  const shouldMute = shouldMuteFor(ctx, tab.id, hostname);
  if (shouldMute && !(await tabMuteSupported())) return;
  if (touch && !shouldMute) {
    if (path && ctx.pageVolumes[path]) {
      await pageVolumesStore.touchEntry(path);
    } else if (hostname && ctx.siteVolumes[hostname]) {
      await siteVolumesStore.touchEntry(hostname);
    }
  }
  await pushGain(tab.id, multiplier);
}

export async function pushVolume(
  tab: browser.Tabs.Tab,
  ctx: ApplyContext,
  touch: boolean,
): Promise<void> {
  const url = tab.url ?? tab.pendingUrl ?? '';
  const hostname = hostnameOf(url);
  const path = pathKeyOf(url);
  const gain = computeMultiplier(
    ctx.pageVolumes,
    ctx.siteVolumes,
    path ?? '',
    hostname ?? '',
    maxMultiplier,
  );
  await syncTabVolume(tab, ctx, touch, hostname, path, gain);
}

export async function applyVolumeToTabs(changes: Map<string, number>): Promise<void> {
  const tabs = await browser.tabs.query({});
  const ctx = await loadApplyContext();
  for (const tab of tabs) {
    const url = tab.url ?? tab.pendingUrl ?? '';
    const hostname = hostnameOf(url);
    const path = pathKeyOf(url);
    const pageMultiplier = path === null ? undefined : changes.get(path);
    const siteMultiplier = hostname === null ? undefined : changes.get(hostname);
    const multiplier = pageMultiplier ?? siteMultiplier;
    if (multiplier === undefined) continue;
    await syncTabVolume(tab, ctx, false, hostname, path, multiplier);
  }
}

export async function applyMaxClamp(oldMax: number, newMax: number): Promise<void> {
  if (newMax >= oldMax) return;
  await clampEntries(siteVolumesStore, newMax);
  await clampEntries(pageVolumesStore, newMax);
}

async function clampEntries(store: KVStore<VolumeEntry>, newMax: number): Promise<void> {
  const over = new Set<string>();
  for (const [key, entry] of Object.entries(store.snapshot())) {
    if (entry.multiplier > newMax) over.add(key);
  }
  if (!over.size) return;
  await store.update((map) => {
    const next: typeof map = { ...map };
    for (const key of over) {
      const entry = next[key];
      if (entry) next[key] = { ...entry, multiplier: newMax };
    }
    return next;
  });
}

export async function volumeForSender(tabId: number | undefined, url: string): Promise<number> {
  const hostname = hostnameOf(url);
  const ctx = await loadApplyContext();
  return computeGain(
    shouldMuteFor(ctx, tabId, hostname),
    await tabMuteSupported(),
    ctx.pageVolumes,
    ctx.siteVolumes,
    pathKeyOf(url) ?? '',
    hostname ?? '',
    maxMultiplier,
  );
}