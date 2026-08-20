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

  type FaderKind = 'page' | 'site';

  function commitVolumeInput(kind: FaderKind, raw: string): void {
    if (!/^\d+$/.test(raw.trim())) return;
    const pct = Number(raw.trim());
    const maxPct = Math.round(settings.maxMultiplier * 100);
    const v = Math.min(pct, maxPct) / 100;
    if (kind === 'page') setPageVol(v);
    else setSiteVol(v);
  }

  function selectOnFocus(e: FocusEvent): void {
    (e.target as HTMLInputElement).select();
  }

  function commitOnEnter(e: KeyboardEvent): void {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
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
      aria-hidden="true"
      viewBox="0 1.8 29 20.5"
      width="26"
      height="18.4"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
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

    <section class="strip mute-active" class:active={activeSource === 'mute'}>
      <div class="row">
        <span class="ch-label">{tr('autoMute')}</span>
        <button
          type="button"
          class="switch"
          role="switch"
          aria-checked={muted}
          aria-label={tr('autoMute')}
          onclick={() => toggleMute(!muted)}
        >
          <span class="switch-track"><span class="switch-thumb"></span></span>
        </button>
      </div>
    </section>

    <section class="strip page-active" class:active={activeSource === 'page'}>
      <div class="row">
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
        <div class="led-well" class:led-dim={muted}>
          <input
            class="led"
            type="text"
            inputmode="decimal"
            value={Math.round(Math.min(pageVol, settings.maxMultiplier) * 100)}
            aria-label={tr('pageVolume')}
            onfocus={selectOnFocus}
            onkeydown={commitOnEnter}
            onchange={(e) => commitVolumeInput('page', (e.target as HTMLInputElement).value)}
          />
          <span class="pct">%</span>
        </div>
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
          aria-label={tr('pageVolume')}
          oninput={(e) => setPageVol(Number((e.target as HTMLInputElement).value))}
          onchange={flushSliders}
        />
        <span class="fader-track" aria-hidden="true"><span class="fader-fill"></span></span>
        <span class="fader-thumb" aria-hidden="true"></span>
      </div>
    </section>

    <section class="strip site-active" class:active={activeSource === 'site'}>
      <div class="row">
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
        <div class="led-well" class:led-dim={muted}>
          <input
            class="led"
            type="text"
            inputmode="decimal"
            value={Math.round(Math.min(siteVol, settings.maxMultiplier) * 100)}
            aria-label={tr('siteVolume')}
            onfocus={selectOnFocus}
            onkeydown={commitOnEnter}
            onchange={(e) => commitVolumeInput('site', (e.target as HTMLInputElement).value)}
          />
          <span class="pct">%</span>
        </div>
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
          aria-label={tr('siteVolume')}
          oninput={(e) => setSiteVol(Number((e.target as HTMLInputElement).value))}
          onchange={flushSliders}
        />
        <span class="fader-track" aria-hidden="true"><span class="fader-fill"></span></span>
        <span class="fader-thumb" aria-hidden="true"></span>
      </div>
    </section>
  {:else}
    <p class="empty">{tabTitle}</p>
  {/if}

  <footer>
    <span class="ver">{versionLabel}</span>
    <button class="link" onclick={openOptions}>{tr('openOptions')}</button>
  </footer>
</main>

<style>
  main {
    width: 344px;
    max-width: 100%;
    padding: 14px;
    font-family: var(--font-sans);
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
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.26em;
    line-height: 1;
    color: var(--ink);
    text-shadow: var(--engrave-shadow);
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
    filter: drop-shadow(var(--green-glow));
  }
  .brand-mark.on-site {
    color: var(--amber);
    filter: drop-shadow(var(--amber-glow));
  }
  .brand-mark.alert {
    color: var(--red);
    filter: drop-shadow(var(--red-glow));
  }

  .site {
    padding: 10px 2px 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .site-name {
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .site-host {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.04em;
    color: var(--ink-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .strip {
    margin-top: 8px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--panel-etched);
    padding: 12px 14px;
  }
  .strip.active {
    background: var(--panel-2);
    box-shadow:
      var(--panel-etched),
      inset 3px 0 0 var(--active-color);
  }
  .strip.active.mute-active {
    --active-color: var(--red);
  }
  .strip.active.page-active {
    --active-color: var(--green);
  }
  .strip.active.site-active {
    --active-color: var(--amber);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ch-label {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink);
    text-shadow: var(--engrave-shadow);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .switch {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
  }
  .switch-track {
    display: flex;
    align-items: center;
    width: 44px;
    height: 22px;
    box-sizing: border-box;
    padding: 2px;
    border-radius: 2px;
    background: var(--groove);
    border: 1px solid var(--groove-border);
    transition:
      background 0.15s,
      border-color 0.15s;
  }
  .switch-thumb {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    box-sizing: border-box;
    border-radius: 1px;
    background: var(--fader-knob);
    border: 1px solid var(--line-strong);
    transition:
      margin-left 0.15s,
      background 0.15s,
      border-color 0.15s;
  }
  .switch[aria-checked='true'] .switch-track {
    background: var(--red);
  }
  .switch[aria-checked='true'] .switch-thumb {
    margin-left: auto;
  }

  .led-well {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 1px;
    flex-shrink: 0;
    width: 50px;
    height: 18px;
    box-sizing: border-box;
    background: var(--groove);
    border-radius: 2px;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.35);
    padding: 0 6px;
  }
  .led-well:focus-within {
    outline: 2px solid var(--amber);
    outline-offset: 1px;
  }
  .led {
    width: 100%;
    min-width: 0;
    padding: 1px 0 0 0;
    border: none;
    background: transparent;
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 600;
    line-height: 1;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--amber);
    text-shadow: var(--amber-glow);
  }
  .led:focus-visible {
    outline: none;
  }
  .pct {
    font-size: 10px;
    color: var(--amber);
    text-shadow: var(--amber-glow);
  }
  .led-well.led-dim .led,
  .led-well.led-dim .pct {
    color: var(--ink-dim);
    text-shadow: none;
  }

  .fader {
    position: relative;
    margin-top: 8px;
    height: 18px;
    touch-action: none;
  }
  /* Transparent native input overlays the visuals to keep dragging, keyboard
     arrows and touch working without custom-draw geometry. */
  .fader input[type='range'] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
    touch-action: none;
  }
  /* Track and thumb are centered with standard CSS (top:50% + translateY), so
     the thumb always sits flush on the track across browsers. pointer-events
     none lets clicks/drags fall through to the transparent input below. */
  .fader-track {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    height: 6px;
    border-radius: 2px;
    border: 1px solid var(--groove-border);
    background: var(--groove);
    box-sizing: border-box;
    overflow: hidden;
    pointer-events: none;
  }
  .fader-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: var(--val);
    background: var(--amber);
    box-sizing: border-box;
    pointer-events: none;
  }
  .fader-thumb {
    position: absolute;
    top: 50%;
    left: var(--val);
    width: 12px;
    height: 18px;
    transform: translate(-50%, -50%);
    border-radius: 2px;
    background: var(--fader-knob);
    border: 1px solid var(--line-strong);
    box-sizing: border-box;
    pointer-events: none;
  }
  /* Keyboard focus only: a mouse/touch drag must not paint a ring. */
  .fader:has(input:focus-visible) {
    outline: 2px solid var(--amber);
    outline-offset: 1px;
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
    border-radius: var(--radius);
    flex-shrink: 0;
    margin-right: 2px;
  }
  .clear:hover {
    color: var(--amber);
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
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    color: var(--ink-faint);
    padding: 2px 4px;
  }
  .link {
    border: none;
    background: none;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-dim);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--radius);
  }
  .link:hover {
    color: var(--amber);
  }
  .empty {
    margin: 14px 2px;
    font-size: 13px;
    color: var(--ink-dim);
  }
</style>
