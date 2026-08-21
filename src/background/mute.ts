import browser from 'webextension-polyfill';
import { hostnameOf, pathKeyOf } from '../core/url';
import { computeGain } from '../core/priority';
import { autoMutedStore } from '../storage/stores';
import { loadApplyContext, maxMultiplier, pushGain, setTabMuteSupported, shouldMuteFor, tabMuteSupported } from './runtime';
import type { ApplyContext } from './runtime';

const TOUCH_THROTTLE_MS = 10_000;

export async function setTabMuted(tabId: number, muted: boolean): Promise<void> {
  try {
    await browser.tabs.update(tabId, { muted });
    if (tabMuteSupported === null) setTabMuteSupported(true);
  } catch (error) {
    // The first failure doubles as the fallback probe (Firefox Android).
    console.warn('[VoluMute] native mute update failed for tab', tabId, ':', error);
    if (tabMuteSupported === null) setTabMuteSupported(false);
  }
}

function touchMuteEntry(hostname: string): void {
  const now = Date.now();
  const lastd = autoMutedStore.snapshot()[hostname]?.lastUsed;
  if (lastd !== undefined && now - lastd < TOUCH_THROTTLE_MS) return;
  autoMutedStore.touchEntry(hostname);
}

// Fallback platforms have no native muting, so the silence is the gain itself:
// 0 when muted, the stored multiplier when restored.
async function pushFallbackGain(
  tab: browser.Tabs.Tab,
  shouldMute: boolean,
  ctx: ApplyContext,
  hostname: string,
  url: string,
): Promise<void> {
  if (tab.id === undefined) return;
  const gain = computeGain(
    shouldMute,
    false,
    ctx.pageVolumes,
    ctx.siteVolumes,
    pathKeyOf(url) ?? '',
    hostname,
    maxMultiplier,
  );
  await pushGain(tab.id, gain);
}

// Never lift a silence that is not ours. When the first native attempt reveals
// fallback mode, the probe failure itself still needs the gain delivered.
// Returns whether a mute happened, so callers touch the entry per hostname.
async function syncTabMute(
  tab: browser.Tabs.Tab,
  shouldMute: boolean,
  ctx: ApplyContext,
  hostname: string,
  url: string,
): Promise<boolean> {
  if (tab.id === undefined) return false;
  if (tabMuteSupported === null || tabMuteSupported === true) {
    const isMuted = tab.mutedInfo?.muted ?? false;
    if (isMuted === shouldMute) return false;
    const pluginMuted = tab.mutedInfo?.reason === 'extension';
    if (shouldMute || pluginMuted) await setTabMuted(tab.id, shouldMute);
  }
  if (tabMuteSupported === false) await pushFallbackGain(tab, shouldMute, ctx, hostname, url);
  return shouldMute;
}

export async function applyMute(tab: browser.Tabs.Tab, ctx: ApplyContext): Promise<void> {
  const url = tab.url ?? tab.pendingUrl ?? '';
  const hostname = hostnameOf(url);
  if (tab.id === undefined || hostname === null) return;
  if (await syncTabMute(tab, shouldMuteFor(ctx, tab.id, hostname), ctx, hostname, url)) {
    touchMuteEntry(hostname);
  }
}

export async function applyMuteToTab(tab: browser.Tabs.Tab): Promise<void> {
  await applyMute(tab, await loadApplyContext());
}

export async function applyMuteToTabs(changes: Map<string, boolean>): Promise<void> {
  const tabs = await browser.tabs.query({});
  const ctx = await loadApplyContext();
  const touched = new Set<string>();
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const url = tab.url ?? tab.pendingUrl ?? '';
    const hostname = hostnameOf(url);
    if (!hostname || !changes.has(hostname)) continue;
    const shouldMute = ctx.choices[tab.id]?.[hostname] ?? changes.get(hostname) ?? false;
    if (await syncTabMute(tab, shouldMute, ctx, hostname, url)) touched.add(hostname);
  }
  for (const hostname of touched) touchMuteEntry(hostname);
}