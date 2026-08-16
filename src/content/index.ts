import browser from "webextension-polyfill";
import { hostnameOf, pathKeyOf } from "../core/url";
import { computeMultiplier } from "../core/priority";
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

let isMuted = false;

browser.runtime.onMessage.addListener(async (msg: unknown) => {
  const m = msg as { type?: string; muted?: boolean } | undefined;
  if (!m) return;
  if (m.type === 'vm:ping') return { ok: true };
  if (m.type !== "vm:mute-state") return;
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

  const volume = isMuted
    ? 0
    : computeMultiplier(pageVolumes, siteVolumes, currentPath ?? "", hostname ?? "");
  document.dispatchEvent(
    new CustomEvent("volumute:set-volume", { detail: { volume } }),
  );
  if (!touch || isMuted) return;
  if (currentPath && pageVolumes[currentPath]) {
    void pageVolumesStore.touchEntry(currentPath);
  } else if (hostname && siteVolumes[hostname]) {
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
