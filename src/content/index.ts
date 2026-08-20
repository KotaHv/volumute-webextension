import browser from 'webextension-polyfill';

// Thin receiver: the background owns storage, tab URLs and the effective
// volume computation, and pushes the resulting gain to every frame of the tab
// (cross-origin iframes included). This script only forwards the number into
// the page's audio path; it never resolves URLs or reads stores itself.
let lastVolume: number | null = null;

function apply(volume: number): void {
  if (volume === lastVolume) return;
  lastVolume = volume;
  document.dispatchEvent(new CustomEvent('volumute:set-volume', { detail: { volume } }));
}

browser.runtime.onMessage.addListener((msg: unknown) => {
  const m = msg as { type?: string; volume?: number } | undefined;
  if (!m) return;
  if (m.type === 'vm:ping') return { ok: true };
  if (m.type === 'vm:volume' && typeof m.volume === 'number') apply(m.volume);
});

async function init(): Promise<void> {
  try {
    const res = (await browser.runtime.sendMessage({ type: 'vm:volume-query' })) as
      | { volume?: number }
      | undefined;
    if (res && typeof res.volume === 'number') apply(res.volume);
  } catch {
    /* background not ready yet; the startup push will arrive */
  }
}

void init();