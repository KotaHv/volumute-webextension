import browser from "webextension-polyfill";
import { hostnameOf, pathKeyOf } from "../core/url";
import type { PageVolumeMap, SiteVolumeMap } from "../core/types";
import { AudioController, hookMediaElements } from "./audio";
import { setupUrlTracking } from "./routing";
import { pageVolumesStore, siteVolumesStore } from "../storage/stores";

const hostname = hostnameOf(location.href);
let currentPath = pathKeyOf(location.href);

const controller = new AudioController();
hookMediaElements(controller);
let isMuted = false;

browser.runtime.onMessage.addListener((msg: unknown) => {
  const m = msg as { type?: string; muted?: boolean } | undefined;
  if (!m || m.type !== "vm:mute-state") return;
  console.log("[VoluMute] mute-state received", m.muted);
  isMuted = m.muted ?? false;
  void applyVolume(false);
});

// `touch` is true only when the page itself was visited (load / URL change).
// Storage-change driven re-applications must NOT touch: our own writes would
// otherwise bounce between tabs via onChanged (write loop).
async function applyVolume(touch: boolean): Promise<void> {
  const stored = await browser.storage.local.get([
    "pageVolumes",
    "siteVolumes",
  ]);
  const pageVolumes = (stored.pageVolumes ?? {}) as PageVolumeMap;
  const siteVolumes = (stored.siteVolumes ?? {}) as SiteVolumeMap;

  let volume = 1;
  let used: "page" | "site" | null = null;

  if (currentPath) {
    const pv = pageVolumes[currentPath];
    if (pv) {
      volume = pv.multiplier;
      used = "page";
    }
  }
  if (used === null && hostname) {
    const sv = siteVolumes[hostname];
    if (sv) {
      volume = sv.multiplier;
      used = "site";
    }
  }
  volume = isMuted ? 0 : volume;
  console.log("[VoluMute] applying volume", {
    volume,
    used,
    currentPath,
    hostname,
  });
  controller.setVolume(volume);
  if (!touch || isMuted) return;
  if (used === "page" && currentPath) {
    pageVolumesStore.touchEntry(currentPath);
  } else if (used === "site" && hostname) {
    siteVolumesStore.touchEntry(hostname);
  }
}

void applyVolume(true);

browser.storage.local.onChanged.addListener((changes) => {
  if (changes.pageVolumes || changes.siteVolumes) {
    void applyVolume(false);
  }
});

function onUrlChanged(): void {
  const p = pathKeyOf(location.href);
  if (p !== currentPath) {
    currentPath = p;
    void applyVolume(true);
  }
}

setupUrlTracking(onUrlChanged);
