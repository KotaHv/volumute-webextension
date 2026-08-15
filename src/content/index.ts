import browser from "webextension-polyfill";
import { hostnameOf, pathKeyOf } from "../core/url";
import { AudioController, hookMediaElements } from "./audio";
import { setupUrlTracking } from "./routing";
import { pageVolumesStore, siteVolumesStore } from "../storage/stores";

function topUrl(): string {
  try {
    if (window.top && window.top !== window) return window.top.location.href;
  } catch {
    /* cross-origin iframe: fall back to this frame's URL */
  }
  return location.href;
}

const hostname = hostnameOf(topUrl());
let currentPath = pathKeyOf(topUrl());

const controller = new AudioController();
hookMediaElements(controller);
let isMuted = false;

browser.runtime.onMessage.addListener((msg: unknown) => {
  const m = msg as { type?: string; muted?: boolean } | undefined;
  if (!m || m.type !== "vm:mute-state") return;
  console.log("[VoluMute] mute-state received", m.muted);
  isMuted = m.muted ?? false;
  applyVolume(false);
});

// `touch` is true only when the page itself was visited (load / URL change).
// Storage-change driven re-applications must NOT touch: our own writes would
// otherwise bounce between tabs via onChanged (write loop).
function applyVolume(touch: boolean): void {
  const pageVolumes = pageVolumesStore.snapshot();
  const siteVolumes = siteVolumesStore.snapshot();

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
    void pageVolumesStore.touchEntry(currentPath);
  } else if (used === "site" && hostname) {
    void siteVolumesStore.touchEntry(hostname);
  }
}

function onUrlChanged(): void {
  const p = pathKeyOf(topUrl());
  if (p !== currentPath) {
    currentPath = p;
    applyVolume(true);
  }
}

setupUrlTracking(onUrlChanged, topUrl);

async function init(): Promise<void> {
  await Promise.all([pageVolumesStore.init(), siteVolumesStore.init()]);
  pageVolumesStore.onChange(() => applyVolume(false));
  siteVolumesStore.onChange(() => applyVolume(false));
  try {
    const res = (await browser.runtime.sendMessage({
      type: "vm:mute-query",
    })) as { muted?: boolean } | undefined;
    isMuted = res?.muted ?? false;
  } catch {
    /* bg not ready yet; the startup reapply push will correct us */
  }
  applyVolume(true);
}

void init();
