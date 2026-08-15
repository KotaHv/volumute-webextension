<script lang="ts">
  import { onMount } from 'svelte';
  import { autoMutedStore, pageVolumesStore, siteVolumesStore } from '../storage/stores';
  import { getDeviceId } from '../storage/deviceId';
  import { getSettings, subscribeSettings } from '../storage/settings';
  import { t } from '../i18n';
  import { applyTheme } from '../theme';
  import { hostnameOf, pathKeyOf } from '../core/url';
  import { MAX_MULTIPLIER } from '../core/types';
  import type { MessageKey } from '../i18n';
  import type { Settings } from '../core/types';

  let hostname = $state('');
  let path = $state('');
  let tabTitle = $state('');
  let settings = $state<Settings>({ lang: 'auto', theme: 'auto' });
  let muted = $state(false);
  let pageVol = $state(1);
  let siteVol = $state(1);
  let hasPageVol = $state(false);
  let hasSiteVol = $state(false);

  const tr = (key: MessageKey) => t(settings.lang, key);

  type ActiveSource = 'mute' | 'page' | 'site' | 'default'
  const activeSource: ActiveSource = $derived(muted ? 'mute' : hasPageVol ? 'page' : hasSiteVol ? 'site' : 'default');

  onMount(async () => {
    settings = await getSettings();
    applyTheme(settings.theme);
    subscribeSettings((s) => {
      settings = s;
      applyTheme(s.theme);
    });
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
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
        if (checked) next[hostname] = { enabled: true, created: now, lastUsed: now, deviceId };
        else delete next[hostname];
        return next;
      },
      { immediate: true },
    );
  }

  function setPageVol(v: number): void {
    pageVol = v;
    const now = Date.now();
    void pageVolumesStore.update((m) => {
      const existing = m[path];
      return { ...m, [path]: { multiplier: v, created: existing?.created ?? now, lastUsed: now } };
    });
  }

  function setSiteVol(v: number): void {
    siteVol = v;
    const now = Date.now();
    void siteVolumesStore.update((m) => {
      const existing = m[hostname];
      return { ...m, [hostname]: { multiplier: v, created: existing?.created ?? now, lastUsed: now } };
    });
  }

  function flushSliders(): void {
    void pageVolumesStore.flushPending();
    void siteVolumesStore.flushPending();
  }

  function openOptions(): void {
    void browser.runtime.openOptionsPage();
    window.close();
  }


  function clearPageVol(): void {
    void pageVolumesStore.update((m) => {
      const next = { ...m };
      delete next[path];
      return next;
    });
  }

  function clearSiteVol(): void {
    void siteVolumesStore.update((m) => {
      const next = { ...m };
      delete next[hostname];
      return next;
    });
  }
</script>

<main>
  <header class="titlebar">
    <div class="brand">
      <span class="brand-mark"></span>
      <span class="brand-name">VOLUMUTE</span>
    </div>
    <span
      class="power"
      class:on={hostname && activeSource === 'page'}
      class:on-site={hostname && activeSource === 'site'}
      class:alert={hostname && activeSource === 'mute'}
      title={hostname ? (muted ? 'MUTE' : hasPageVol || hasSiteVol ? 'LIVE' : 'IDLE') : ''}
    ></span>
  </header>

  {#if hostname}
    <div class="site">
      <span class="site-name">{tabTitle}</span>
      <span class="site-host">{hostname}</span>
    </div>

    <section class="strip" class:strip-on={muted}>
      <div class="ch-head">
        <span class="indicator" class:red={muted}></span>
        <span class="ch-label">{tr('autoMute')}</span>
        <span class="ch-state" class:on={muted}>{muted ? tr('enabled') : tr('disabled')}</span>
      </div>
      <label class="switch">
        <input type="checkbox" checked={muted} onchange={(e) => toggleMute((e.target as HTMLInputElement).checked)} />
        <span class="switch-track"><span class="switch-thumb"></span></span>
      </label>
      <p class="ch-sub">{tr('autoMuteDesc')}</p>
    </section>

    <section class="strip" class:strip-off={muted}>
      <div class="ch-head">
        <span class="indicator" class:page={!muted && activeSource === 'page'}></span>
        <span class="ch-label">{tr('pageVolume')}</span>
        <span class="led" class:led-dim={muted}>{Math.round(pageVol * 100)}<span class="pct">%</span></span>
      </div>
      <div class="fader" style={`--val: ${pageVol / MAX_MULTIPLIER * 100}%`}>
        <input
          type="range"
          min="0"
          max={MAX_MULTIPLIER}
          step="any"
          bind:value={pageVol}
          disabled={muted}
          oninput={(e) => setPageVol(Number((e.target as HTMLInputElement).value))}
          onchange={flushSliders}
        />
      </div>
      <div class="ch-foot">
        <span class="ch-sub">{tr('pageVolumeDesc')}</span>
        {#if hasPageVol}
          <button class="clear" onclick={clearPageVol} disabled={muted} title={tr('delete')}>×</button>
        {/if}
      </div>
    </section>

    <section class="strip" class:strip-off={muted}>
      <div class="ch-head">
        <span class="indicator" class:on-site={!muted && activeSource === 'site'}></span>
        <span class="ch-label">{tr('siteVolume')}</span>
        <span class="led" class:led-dim={muted}>{Math.round(siteVol * 100)}<span class="pct">%</span></span>
      </div>
      <div class="fader" style={`--val: ${siteVol / MAX_MULTIPLIER * 100}%`}>
        <input
          type="range"
          min="0"
          max={MAX_MULTIPLIER}
          step="any"
          bind:value={siteVol}
          disabled={muted}
          oninput={(e) => setSiteVol(Number((e.target as HTMLInputElement).value))}
          onchange={flushSliders}
        />
      </div>
      <div class="ch-foot">
        <span class="ch-sub">{tr('siteName')}: {hostname}</span>
        {#if hasSiteVol}
          <button class="clear" onclick={clearSiteVol} disabled={muted} title={tr('delete')}>×</button>
        {/if}
      </div>
    </section>

    <footer>
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
  .brand {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .brand-mark {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--amber);
  }
  .brand-name {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.18em;
    color: var(--ink);
  }
  .power {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--line);
    box-shadow: var(--glow);
    transition: background 0.2s, box-shadow 0.2s;
  }
  .power.on {
    background: var(--green);
    color: var(--green);
  }
  .power.on-site {
    background: var(--amber);
    color: var(--amber);
  }
  .power.alert {
    background: var(--red);
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
  .strip.strip-on {
    border-color: var(--red);
  }
  .strip.strip-off {
    opacity: 0.55;
  }

  .ch-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ch-label {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-dim);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ch-state {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    color: var(--ink-dim);
  }
  .ch-state.on {
    color: var(--red);
  }
  .ch-sub {
    margin: 8px 0 0;
    font-size: 11px;
    line-height: 1.4;
    color: var(--ink-dim);
  }

  .indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--line);
    box-shadow: var(--glow);
    flex-shrink: 0;
    transition: background 0.2s, box-shadow 0.2s;
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
    margin-top: 10px;
    display: flex;
    align-items: center;
    cursor: pointer;
  }
  .switch input {
    display: none;
  }
  .switch-track {
    width: 44px;
    height: 24px;
    border-radius: 12px;
    background: var(--groove);
    position: relative;
    transition: background 0.2s;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.25);
  }
  .switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--surface-2);
    border: 1px solid var(--line);
    transition: transform 0.2s;
  }
  .switch input:checked + .switch-track {
    background: var(--red);
  }
  .switch input:checked + .switch-track .switch-thumb {
    transform: translateX(20px);
  }

  .fader {
    margin-top: 10px;
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
  .fader input[type='range']:disabled {
    cursor: not-allowed;
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

  .ch-foot {
    margin-top: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .clear {
    border: 1px solid transparent;
    background: transparent;
    color: var(--ink-dim);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    padding: 3px 6px;
    border-radius: 4px;
  }
  .clear:hover {
    color: var(--ink);
    border-color: var(--line);
  }
  .clear:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  footer {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--line);
    display: flex;
    justify-content: flex-end;
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
    .power, .indicator, .switch-track, .switch-thumb {
      transition: none;
    }
  }
</style>
