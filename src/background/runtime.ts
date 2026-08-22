import browser from 'webextension-polyfill';
import { resolveMuted } from '../core/priority';
import { DEFAULT_MAX_MULTIPLIER } from '../core/constants';
import type { MuteMap, PageVolumeMap, SiteVolumeMap } from '../core/types';
import { autoMutedStore, pageVolumesStore, siteVolumesStore } from '../storage/stores';
import { getAllUserMuteChoices } from '../storage/session';
import type { UserMuteChoices } from '../storage/session';

let supportedPromise: Promise<boolean> | null = null;

export function tabMuteSupported(): Promise<boolean> {
  return (supportedPromise ??= browser.runtime
    .getPlatformInfo()
    .then((p) => p.os !== 'android')
    .catch((err) => {
      console.warn('[VoluMute] platform detection failed:', err);
      supportedPromise = null;
      return false;
    }));
}

export let maxMultiplier = DEFAULT_MAX_MULTIPLIER;

export function setMaxMultiplier(value: number): void {
  maxMultiplier = value;
}

export async function pushGain(tabId: number, gain: number): Promise<void> {
  try {
    await browser.tabs.sendMessage(tabId, { type: 'vm:volume', volume: gain });
  } catch (error) {
    // Expected while a frame is still loading (it pulls the volume on load),
    // but it must stay visible so silent delivery failures are traceable.
    console.warn('[VoluMute] volume push to tab', tabId, 'failed:', error);
  }
}

// One shared snapshot set per apply pass, so a batch of tabs never re-reads
// storage per tab. `choices` is tabId -> hostname -> remembered user choice.
export interface ApplyContext {
  muteMap: MuteMap;
  siteVolumes: SiteVolumeMap;
  pageVolumes: PageVolumeMap;
  choices: Record<string, UserMuteChoices>;
}

export async function loadApplyContext(): Promise<ApplyContext> {
  return {
    muteMap: autoMutedStore.snapshot(),
    siteVolumes: siteVolumesStore.snapshot(),
    pageVolumes: pageVolumesStore.snapshot(),
    choices: await getAllUserMuteChoices(),
  };
}

export function shouldMuteFor(
  ctx: ApplyContext,
  tabId: number | undefined,
  hostname: string | null,
): boolean {
  if (tabId === undefined || hostname === null) return false;
  return resolveMuted(ctx.choices[tabId]?.[hostname], ctx.muteMap, hostname);
}