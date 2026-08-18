<script lang="ts">
  import { onMount } from 'svelte';
  import { autoMutedStore, pageVolumesStore, siteVolumesStore } from '../storage/stores';
  import { getDeviceId } from '../storage/deviceId';
  import { getSettings, subscribeSettings } from '../storage/settings';
  import { t } from '../i18n';
  import { applyTheme } from '../theme';
  import { hostnameOf, pathKeyOf } from '../core/url';
  import { DEFAULT_MAX_MULTIPLIER, displayVersion } from '../core/constants';
  import type { MessageKey } from '../i18n';
  import type { Settings } from '../core/types';

  let hostname = $state('');
  let path = $state('');
  let tabTitle = $state('');
  let settings = $state<Settings>({
    lang: 'auto',
    theme: 'auto',
    maxMultiplier: DEFAULT_MAX_MULTIPLIER,
  });
  let muted = $state(false);
  let pageVol = $state(1);
  let siteVol = $state(1);
  let hasPageVol = $state(false);
  let hasSiteVol = $state(false);

  const version = displayVersion(browser.runtime.getManifest().version);
  const versionLabel = __BUILD_STAMP__ ? `v${version} · ${__BUILD_STAMP__}` : `v${version}`;

  const tr = (key: MessageKey) => t(settings.lang, key);

  type ActiveSource = 'mute' | 'page' | 'site' | 'default';
  const activeSource: ActiveSource = $derived(
    muted ? 'mute' : hasPageVol ? 'page' : hasSiteVol ? 'site' : 'default',
  );
  type IconState = 'mute' | 'low' | 'normal' | 'boost';
  const activeVol = $derived(
    activeSource === 'page'
      ? Math.min(pageVol, settings.maxMultiplier)
      : activeSource === 'site'
        ? Math.min(siteVol, settings.maxMultiplier)
        : 1,
  );
  const activePct = $derived(Math.round(activeVol * 100));
  const iconState: IconState = $derived(
    activeSource === 'mute'
      ? 'mute'
      : activeSource === 'default'
        ? 'normal'
        : activePct < 100
          ? 'low'
          : activePct > 100
            ? 'boost'
            : 'normal',
  );

  onMount(async () => {
    settings = await getSettings();
    applyTheme(settings.theme);
    subscribeSettings((s) => {
      settings = s;
      applyTheme(s.theme);
    });
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url) {
      tabTitle = tr('currentTabNotFound');
      return;
    }
    const h = hostnameOf(tab.url);
    const p = pathKeyOf(tab.url);
    if (!h || !p) return;
    hostname = h;
    path = p;
    tabTitle = tab.title ?? h;
    await Promise.all([autoMutedStore.init(), siteVolumesStore.init(), pageVolumesStore.init()]);
    muted = autoMutedStore.snapshot()[h]?.enabled === true;
    const sv = siteVolumesStore.snapshot();
    hasSiteVol = !!sv[h];
    siteVol = sv[h]?.multiplier ?? 1;
    const pv = pageVolumesStore.snapshot();
    hasPageVol = !!pv[p];
    pageVol = pv[p]?.multiplier ?? 1;
    autoMutedStore.onChange((m) => {
      muted = m[hostname]?.enabled === true;
    });
    siteVolumesStore.onChange((m) => {
      hasSiteVol = !!m[hostname];
      siteVol = m[hostname]?.multiplier ?? 1;
    });
    pageVolumesStore.onChange((m) => {
      hasPageVol = !!m[path];
      pageVol = m[path]?.multiplier ?? 1;
    });
  });

  async function toggleMute(checked: boolean): Promise<void> {
    const deviceId = await getDeviceId();
    const now = Date.now();
    await autoMutedStore.update(
      (m) => {
        const next = { ...m };
        if (checked)
          next[hostname] = {
            enabled: true,
            created: now,
            lastUsed: now,
            deviceId,
          };
        else delete next[hostname];
        return next;
      },
      { immediate: true },
    );
  }

  // 100% == DEFAULT_MULTIPLIER (1): storing a no-op override is pointless and
  // would keep a unity gain applied. At 100% the setting is cancelled instead —
  // the entry is dropped from the store (page or site) so the effective volume
  // falls back to the default.
  function writeVolume(store: typeof pageVolumesStore, key: string, v: number): void {
    if (Math.round(v * 100) === 100) {
      void store.update((m) => {
        const next = { ...m };
        delete next[key];
        return next;
      });
      return;
    }
    const now = Date.now();
    void store.update((m) => {
      const existing = m[key];
      return {
        ...m,
        [key]: {
          multiplier: v,
          created: existing?.created ?? now,
          lastUsed: now,
        },
      };
    });
  }

  function setPageVol(v: number): void {
    pageVol = v;
    writeVolume(pageVolumesStore, path, v);
  }

  function setSiteVol(v: number): void {
    siteVol = v;
    writeVolume(siteVolumesStore, hostname, v);
  }

  function flushSliders(): void {
    void pageVolumesStore.flushPending();
    void siteVolumesStore.flushPending();
  }

  function openOptions(): void {
    void browser.runtime.openOptionsPage();
    window.close();
  }

  const RESET_ANIM_MS = 400;
  let pageResetting = $state(false);
  let siteResetting = $state(false);

  function clearPageVol(): void {
    if (pageResetting) return;
    pageResetting = true;
    setTimeout(() => {
      pageResetting = false;
    }, RESET_ANIM_MS);
    void pageVolumesStore.update((m) => {
      const next = { ...m };
      delete next[path];
      return next;
    });
  }

  function clearSiteVol(): void {
    if (siteResetting) return;
    siteResetting = true;
    setTimeout(() => {
      siteResetting = false;
    }, RESET_ANIM_MS);
    void siteVolumesStore.update((m) => {
      const next = { ...m };
      delete next[hostname];
      return next;
    });
  }
</script>

<main>
  <header class="titlebar">
    <span class="brand-name">VOLUMUTE</span>
    <svg
      class="brand-mark"
      class:on={hostname && activeSource === 'page'}
      class:on-site={hostname && activeSource === 'site'}
      class:alert={hostname && activeSource === 'mute'}
      viewBox="0 1.8 29 20.5"
      width="18.4"
      height="13"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      title={hostname ? (muted ? 'MUTE' : hasPageVol || hasSiteVol ? 'LIVE' : 'IDLE') : ''}
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      {#if iconState === 'mute'}
        <line x1="14.5" y1="8" x2="22.5" y2="16" />
        <line x1="22.5" y1="8" x2="14.5" y2="16" />
      {:else}
        <path d="M14.83 9.17a4 4 0 0 1 0 5.66" />
        {#if iconState === 'normal' || iconState === 'boost'}
          <path d="M18.01 5.99a8.5 8.5 0 0 1 0 12.02" />
        {/if}
        {#if iconState === 'boost'}
          <path d="M21.19 2.81a13 13 0 0 1 0 18.38" />
        {/if}
      {/if}
    </svg>
  </header>

  {#if hostname}
    <div class="site">
      <span class="site-name">{tabTitle}</span>
      <span class="site-host">{hostname}</span>
    </div>

    <section class="strip mute-card" class:muted>
      <div class="row">
        <span class="indicator" class:red={muted}></span>
        <span class="ch-label">{tr('autoMute')}</span>
        <label class="switch">
          <input
            type="checkbox"
            checked={muted}
            onchange={(e) => toggleMute((e.target as HTMLInputElement).checked)}
          />
          <span class="switch-track"><span class="switch-thumb"></span></span>
        </label>
      </div>
    </section>

    <section class="strip">
      <div class="row">
        <span class="indicator" class:page={!muted && activeSource === 'page'}></span>
        <span class="ch-label">{tr('pageVolume')}</span>
        <button
          class="clear"
          class:resetting={pageResetting}
          onclick={clearPageVol}
          title={tr('resetVolume')}
          style:visibility={hasPageVol || pageResetting ? 'visible' : 'hidden'}
        >
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </button>
        <span class="led" class:led-dim={muted}
          >{Math.round(Math.min(pageVol, settings.maxMultiplier) * 100)}<span class="pct">%</span
          ></span
        >
      </div>
      <div
        class="fader"
        style={`--val: ${(Math.min(pageVol, settings.maxMultiplier) / settings.maxMultiplier) * 100}%`}
      >
        <input
          type="range"
          min="0"
          max={settings.maxMultiplier}
          step="0.01"
          value={Math.min(pageVol, settings.maxMultiplier)}
          oninput={(e) => setPageVol(Number((e.target as HTMLInputElement).value))}
          onchange={flushSliders}
        />
      </div>
      <div class="row divider">
        <span class="indicator" class:on-site={!muted && activeSource === 'site'}></span>
        <span class="ch-label">{tr('siteVolume')}</span>
        <button
          class="clear"
          class:resetting={siteResetting}
          onclick={clearSiteVol}
          title={tr('resetVolume')}
          style:visibility={hasSiteVol || siteResetting ? 'visible' : 'hidden'}
        >
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </button>
        <span class="led" class:led-dim={muted}
          >{Math.round(Math.min(siteVol, settings.maxMultiplier) * 100)}<span class="pct">%</span
          ></span
        >
      </div>
      <div
        class="fader"
        style={`--val: ${(Math.min(siteVol, settings.maxMultiplier) / settings.maxMultiplier) * 100}%`}
      >
        <input
          type="range"
          min="0"
          max={settings.maxMultiplier}
          step="0.01"
          value={Math.min(siteVol, settings.maxMultiplier)}
          oninput={(e) => setSiteVol(Number((e.target as HTMLInputElement).value))}
          onchange={flushSliders}
        />
      </div>
    </section>

    <footer>
      <span class="ver">{versionLabel}</span>
      <button class="link" onclick={openOptions}>{tr('openOptions')}</button>
    </footer>
  {:else}
    <p class="empty">{tabTitle}</p>
  {/if}
</main>

<style>
  :global(:root) {
    --bg: #e9e7e1;
    --surface: #f5f3ee;
    --surface-2: #e7e4dd;
    --groove: #d6d2c8;
    --ink: #26292f;
    --ink-dim: #6f7580;
    --amber: #b06500;
    --amber-glow: transparent;
    --green: #158f63;
    --red: #c84a3c;
    --line: #d4d0c6;
    --glow: none;
  }
  :global(:root[data-theme='dark']) {
    --bg: #14161a;
    --surface: #1d2026;
    --surface-2: #262b33;
    --groove: #0e1013;
    --ink: #e6e8eb;
    --ink-dim: #8a909c;
    --amber: #ffaf4d;
    --amber-glow: 0 0 10px rgba(255, 175, 77, 0.35);
    --green: #3ecf8e;
    --red: #e5604f;
    --line: #2a2f38;
    --glow: 0 0 5px currentColor;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme])) {
      --bg: #14161a;
      --surface: #1d2026;
      --surface-2: #262b33;
      --groove: #0e1013;
      --ink: #e6e8eb;
      --ink-dim: #8a909c;
      --amber: #ffaf4d;
      --amber-glow: 0 0 10px rgba(255, 175, 77, 0.35);
      --green: #3ecf8e;
      --red: #e5604f;
      --line: #2a2f38;
      --glow: 0 0 5px currentColor;
    }
  }
  :global(:root) {
    --mono: ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace;
    --sans: system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    background: var(--bg);
  }

  main {
    width: 300px;
    max-width: 100%;
    padding: 12px;
    font-family: var(--sans);
    background: var(--bg);
    color: var(--ink);
    box-sizing: border-box;
  }

  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 2px 10px;
    border-bottom: 1px solid var(--line);
  }
  .brand-name {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.18em;
    color: var(--ink);
  }
  .brand-mark {
    color: var(--ink-dim);
    flex-shrink: 0;
    transition:
      color 0.2s,
      filter 0.2s;
  }
  .brand-mark.on {
    color: var(--green);
  }
  .brand-mark.on-site {
    color: var(--amber);
  }
  .brand-mark.alert {
    color: var(--red);
  }

  .site {
    padding: 10px 2px 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .site-name {
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .site-host {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.04em;
    color: var(--ink-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .strip {
    margin-top: 8px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 12px;
  }
  .mute-card.muted {
    border-color: var(--red);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row.divider {
    border-top: 1px solid var(--line);
    margin-top: 10px;
    padding-top: 10px;
  }
  .ch-label {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--line);
    box-shadow: var(--glow);
    flex-shrink: 0;
    transition:
      background 0.2s,
      box-shadow 0.2s;
  }
  .indicator.page {
    background: var(--green);
    color: var(--green);
  }
  .indicator.on-site {
    background: var(--amber);
    color: var(--amber);
  }
  .indicator.red {
    background: var(--red);
    color: var(--red);
  }

  .led {
    font-family: var(--mono);
    font-size: 16px;
    font-weight: 600;
    line-height: 1;
    color: var(--amber);
    text-shadow: var(--amber-glow);
    font-variant-numeric: tabular-nums;
    min-width: 52px;
    text-align: right;
    margin-left: auto;
  }
  .led-dim {
    color: var(--ink-dim);
    text-shadow: none;
  }
  .pct {
    font-size: 10px;
    margin-left: 2px;
    color: inherit;
  }

  .switch {
    display: flex;
    align-items: center;
    cursor: pointer;
    margin-left: auto;
    flex-shrink: 0;
  }
  .switch input {
    display: none;
  }
  .switch-track {
    width: 36px;
    height: 20px;
    border-radius: 10px;
    background: var(--groove);
    position: relative;
    transition: background 0.2s;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.25);
  }
  .switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    box-sizing: border-box;
    border-radius: 50%;
    background: var(--surface-2);
    border: 1px solid var(--line);
    transition: transform 0.2s;
  }
  .switch input:checked + .switch-track {
    background: var(--red);
  }
  .switch input:checked + .switch-track .switch-thumb {
    transform: translateX(16px);
  }

  .fader {
    margin-top: 6px;
    height: 18px;
    display: flex;
    align-items: center;
  }
  .fader input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: linear-gradient(90deg, var(--amber) var(--val, 0%), var(--groove) var(--val, 0%));
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3);
    cursor: pointer;
    outline-offset: 3px;
  }
  .fader input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 20px;
    border-radius: 3px;
    background: var(--surface-2);
    border: 1px solid var(--amber);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .fader input[type='range']:focus-visible {
    outline: 2px solid var(--amber);
  }

  .clear {
    display: inline-flex;
    align-items: center;
    border: 1px solid transparent;
    background: transparent;
    color: var(--ink-dim);
    line-height: 1;
    cursor: pointer;
    padding: 3px 5px;
    border-radius: 4px;
    flex-shrink: 0;
    margin-left: -5px;
  }
  .clear:hover {
    color: var(--ink);
    border-color: var(--line);
  }
  .clear.resetting {
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease 0.2s;
  }
  .clear.resetting svg {
    animation: reset-spin 0.3s ease;
  }
  @keyframes reset-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(-360deg);
    }
  }

  footer {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--line);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .ver {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    color: var(--ink-dim);
    padding: 2px 4px;
  }
  .link {
    border: none;
    background: none;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    color: var(--ink-dim);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;
  }
  .link:hover {
    color: var(--amber);
  }
  .empty {
    margin: 14px 2px;
    font-size: 12px;
    color: var(--ink-dim);
  }

  @media (prefers-reduced-motion: reduce) {
    .brand-mark,
    .indicator,
    .switch-track,
    .switch-thumb {
      transition: none;
    }
    .clear.resetting svg {
      animation: none;
    }
    .clear.resetting {
      transition: none;
    }
  }
</style>
