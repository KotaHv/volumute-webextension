<script lang="ts">
  import { onMount } from 'svelte';
  import { autoMutedStore, pageVolumesStore, siteVolumesStore } from '../storage/stores';
  import { getDeviceId } from '../storage/deviceId';
  import { getSettings, subscribeSettings } from '../storage/settings';
  import { t } from '../i18n';
  import { applyTheme } from '../theme';
  import { hostnameOf, pathKeyOf } from '../core/url';
  import { BRAND_NAME, DEFAULT_MAX_MULTIPLIER, displayVersion } from '../core/constants';
  import type { MessageKey } from '../i18n';
  import type { Settings, VolumeScope } from '../core/types';
  import './strip.css';
  import VolumeScopeSwitch from './VolumeScopeSwitch.svelte';
  import VolumeDualSliders from './VolumeDualSliders.svelte';

  let hostname = $state('');
  let path = $state('');
  let tabTitle = $state('');
  let settings = $state<Settings>({
    lang: 'auto',
    theme: 'auto',
    maxMultiplier: DEFAULT_MAX_MULTIPLIER,
    popupVolumeMode: 'switch',
  });
  let muted = $state(false);
  let pageVol = $state(1);
  let siteVol = $state(1);
  let hasPageVol = $state(false);
  let hasSiteVol = $state(false);
  let target = $state<VolumeScope>('page');
  let previewVol = $state<number | null>(null);

  const version = displayVersion(browser.runtime.getManifest().version);
  const versionLabel = __BUILD_STAMP__ ? `v${version} · ${__BUILD_STAMP__}` : `v${version}`;

  const tr = (key: MessageKey) => t(settings.lang, key);

  type ActiveSource = 'mute' | 'page' | 'site' | 'default';
  const activeSource: ActiveSource = $derived(
    muted ? 'mute' : hasPageVol ? 'page' : hasSiteVol ? 'site' : 'default',
  );

  const effectiveSource = $derived(
    activeSource === 'page' || activeSource === 'site' ? activeSource : null,
  );
  const switchMode = $derived(settings.popupVolumeMode === 'switch');

  const scopeStore = (scope: VolumeScope) =>
    scope === 'page' ? pageVolumesStore : siteVolumesStore;
  const scopeKey = (scope: VolumeScope) => (scope === 'page' ? path : hostname);

  const activeVol = $derived(
    activeSource === 'page'
      ? Math.min(pageVol, settings.maxMultiplier)
      : activeSource === 'site'
        ? Math.min(siteVol, settings.maxMultiplier)
        : 1,
  );

  const shownRaw = $derived(
    target === 'page'
      ? hasPageVol
        ? pageVol
        : (previewVol ?? (hasSiteVol ? siteVol : 1))
      : hasSiteVol
        ? siteVol
        : (previewVol ?? (hasPageVol ? pageVol : 1)),
  );
  const shownVol = $derived(Math.min(shownRaw, settings.maxMultiplier));
  const targetHasVol = $derived(target === 'page' ? hasPageVol : hasSiteVol);
  const targetAriaLabel = $derived(target === 'page' ? tr('pageVolume') : tr('siteVolume'));

  const iconState = $derived<'mute' | 'low' | 'normal' | 'boost'>(
    activeSource === 'mute'
      ? 'mute'
      : activeSource === 'default'
        ? 'normal'
        : Math.round(activeVol * 100) < 100
          ? 'low'
          : Math.round(activeVol * 100) > 100
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
    if (!hasPageVol && hasSiteVol) target = 'site';
    previewVol = null;

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

  function writeEntry(store: typeof pageVolumesStore, key: string, v: number): void {
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

  function writeVolume(store: typeof pageVolumesStore, key: string, v: number): void {
    if (Math.round(v * 100) === 100) {
      void store.update((m) => {
        const next = { ...m };
        delete next[key];
        return next;
      });
      return;
    }
    writeEntry(store, key, v);
  }

  function setPageVol(v: number): void {
    pageVol = v;
    writeVolume(pageVolumesStore, path, v);
  }

  function setSiteVol(v: number): void {
    siteVol = v;
    writeVolume(siteVolumesStore, hostname, v);
  }

  function setScopeVol(scope: VolumeScope, v: number): void {
    if (scope === 'page') setPageVol(v);
    else setSiteVol(v);
  }

  function commitShownVolume(v: number): void {
    previewVol = v;
    setScopeVol(target, v);
  }

  function dragVolume(scope: VolumeScope, v: number): void {
    if (switchMode && scope === target) previewVol = v;
    if (scope === 'page') {
      pageVol = v;
      writeEntry(pageVolumesStore, path, v);
    } else {
      siteVol = v;
      writeEntry(siteVolumesStore, hostname, v);
    }
  }

  async function commitDrag(scope: VolumeScope): Promise<void> {
    const vol = scope === 'page' ? pageVol : siteVol;
    if (Math.round(vol * 100) === 100) {
      if (switchMode) previewVol = 1;
      await scopeStore(scope).update((m) => {
        const next = { ...m };
        delete next[scopeKey(scope)];
        return next;
      });
    }
    flushSliders();
  }

  function commitInput(scope: VolumeScope, raw: string): void {
    if (!/^\d+$/.test(raw.trim())) return;
    const pct = Number(raw.trim());
    const maxPct = Math.round(settings.maxMultiplier * 100);
    const v = Math.min(pct, maxPct) / 100;
    if (switchMode && scope === target) commitShownVolume(v);
    else setScopeVol(scope, v);
  }

  function switchTarget(next: VolumeScope): void {
    if (next === target) return;
    flushSliders();
    const inherited = shownVol;
    target = next;
    previewVol = (next === 'page' ? hasPageVol : hasSiteVol) ? null : inherited;
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

  function clearScopeOf(scope: VolumeScope): void {
    if (scope === 'page') clearPageVol();
    else clearSiteVol();
  }

  function clearTargetVol(): void {
    if (target === 'page') {
      clearPageVol();
      if (hasSiteVol) {
        target = 'site';
        previewVol = null;
      }
    } else {
      clearSiteVol();
      if (hasPageVol) {
        target = 'page';
        previewVol = null;
      }
    }
  }
</script>

<main>
  <header class="titlebar">
    <span class="brand-name">{BRAND_NAME}</span>
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
    <div class="site" class:dual={settings.popupVolumeMode === 'dual'}>
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

    {#if switchMode}
      <VolumeScopeSwitch
        target={target}
        shownVol={shownVol}
        maxMultiplier={settings.maxMultiplier}
        muted={muted}
        effective={effectiveSource}
        hasTargetVol={targetHasVol}
        resetting={target === 'page' ? pageResetting : siteResetting}
        labels={{
          scopePage: tr('scopePage'),
          scopeSite: tr('scopeSite'),
          volume: targetAriaLabel,
          reset: tr('resetVolume'),
        }}
        onswitch={switchTarget}
        ondrag={(v) => dragVolume(target, v)}
        oncommit={() => void commitDrag(target)}
        onled={(raw) => commitInput(target, raw)}
        onreset={clearTargetVol}
      />
    {:else}
      <VolumeDualSliders
        pageVol={pageVol}
        siteVol={siteVol}
        maxMultiplier={settings.maxMultiplier}
        muted={muted}
        effective={effectiveSource}
        hasPageVol={hasPageVol}
        hasSiteVol={hasSiteVol}
        pageResetting={pageResetting}
        siteResetting={siteResetting}
        labels={{
          page: tr('pageVolume'),
          site: tr('siteVolume'),
          reset: tr('resetVolume'),
        }}
        ondrag={dragVolume}
        oncommit={(scope) => void commitDrag(scope)}
        onled={commitInput}
        onreset={clearScopeOf}
      />
    {/if}
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
    width: 360px;
    max-width: 100%;
    padding: 9px 16px;
    font-family: var(--font-sans);
    background: var(--bg);
    color: var(--ink);
    box-sizing: border-box;
  }
  :global(html.android) main {
    width: 100%;
    min-height: 100vh;
  }

  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 2px 9px;
    border-bottom: 1px solid var(--line);
  }
  .brand-name {
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.26em;
    line-height: 1;
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
    padding: 54px 4px 42px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    text-align: center;
  }
  .site.dual {
    padding: 78px 4px 57px;
  }
  .site-name {
    font-size: 15px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
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

  footer {
    margin-top: 9px;
    padding-top: 9px;
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
    text-align: center;
  }
</style>
