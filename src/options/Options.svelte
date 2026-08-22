<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import DataSection from './DataSection.svelte';
  import Segmented from '../components/Segmented.svelte';
  import { autoMutedStore, pageVolumesStore, siteVolumesStore } from '../storage/stores';
  import { getSettings, subscribeSettings, updateSettings } from '../storage/settings';
  import { currentLang, setCurrentLang, tr } from '../i18n/svelte';
  import { applyTheme } from '../theme';
  import {
    DATA_VERSION,
    DEFAULT_MAX_MULTIPLIER,
    MIN_MULTIPLIER,
    MIN_SUPPORTED_VERSION,
    displayVersion,
  } from '../core/constants';
  import { MUTE_MIGRATIONS, VOLUME_MIGRATIONS, migrateMap } from '../core/migrate';
  import type {
    MuteMap,
    PageVolumeMap,
    Settings,
    SiteVolumeMap,
    ThemeMode,
    Lang,
  } from '../core/types';

  type Tab = 'sites' | 'settings' | 'help';
  let tab = $state<Tab>('sites');
  let settings = $state<Settings>({
    lang: 'auto',
    theme: 'auto',
    maxMultiplier: DEFAULT_MAX_MULTIPLIER,
    popupVolumeMode: 'switch',
  });

  const version = displayVersion(browser.runtime.getManifest().version);
  const versionLabel = __BUILD_STAMP__ ? `v${version} · ${__BUILD_STAMP__}` : `v${version}`;

  let muteMap = $state<MuteMap>({});
  let siteMap = $state<SiteVolumeMap>({});
  let pageMap = $state<PageVolumeMap>({});

  let muteSelected = new SvelteSet<string>();
  let siteSelected = new SvelteSet<string>();
  let pageSelected = new SvelteSet<string>();

  let importMode = $state<'merge' | 'overwrite'>('merge');
  let statusMsg = $state('');
  let statusOk = $state(false);
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  let fileInput = $state<HTMLInputElement | null>(null);

  function showStatus(msg: string, ok = false, ms = 2500): void {
    statusMsg = msg;
    statusOk = ok;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusMsg = '';
      statusOk = false;
      statusTimer = null;
    }, ms);
  }

  function fmt(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  function pct(v: number): string {
    return `${Math.round(v * 100)}%`;
  }

  function fmtBytes(n: number): string {
    if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
  }

  const muteRows = $derived(
    Object.entries(muteMap).map(([host, e]) => ({
      key: host,
      value: host,
      sub: `${tr('muteEnabled', $currentLang)} · ${tr('created', $currentLang)}: ${fmt(e.created)} · ${tr('siteLastUsed', $currentLang)}: ${fmt(e.lastUsed)}`,
    })),
  );

  const siteRows = $derived(
    Object.entries(siteMap).map(([host, e]) => ({
      key: host,
      value: host,
      sub: `${tr('volumeMultiplier', $currentLang)}: ${pct(e.multiplier)} · ${tr('created', $currentLang)}: ${fmt(e.created)} · ${tr('siteLastUsed', $currentLang)}: ${fmt(e.lastUsed)}`,
    })),
  );

  const pageRows = $derived(
    Object.entries(pageMap).map(([url, e]) => ({
      key: url,
      value: url,
      sub: `${tr('volumeMultiplier', $currentLang)}: ${pct(e.multiplier)} · ${tr('created', $currentLang)}: ${fmt(e.created)} · ${tr('siteLastUsed', $currentLang)}: ${fmt(e.lastUsed)}`,
    })),
  );

  const syncBytes = $derived(new TextEncoder().encode(JSON.stringify(muteMap)).length);
  const localBytes = $derived(
    new TextEncoder().encode(JSON.stringify({ siteMap, pageMap })).length,
  );
  const muteCount = $derived(Object.keys(muteMap).length);
  const localCount = $derived(Object.keys(siteMap).length + Object.keys(pageMap).length);

  onMount(async () => {
    settings = await getSettings();
    setCurrentLang(settings.lang);
    applyTheme(settings.theme);
    subscribeSettings((s) => {
      settings = s;
      setCurrentLang(s.lang);
      applyTheme(s.theme);
    });
    await Promise.all([autoMutedStore.init(), siteVolumesStore.init(), pageVolumesStore.init()]);
    muteMap = autoMutedStore.snapshot();
    siteMap = siteVolumesStore.snapshot();
    pageMap = pageVolumesStore.snapshot();
    autoMutedStore.onChange((m) => {
      muteMap = m;
      for (const k of [...muteSelected]) if (!(k in m)) muteSelected.delete(k);
    });
    siteVolumesStore.onChange((m) => {
      siteMap = m;
      for (const k of [...siteSelected]) if (!(k in m)) siteSelected.delete(k);
    });
    pageVolumesStore.onChange((m) => {
      pageMap = m;
      for (const k of [...pageSelected]) if (!(k in m)) pageSelected.delete(k);
    });
  });

  let refreshing = $state(false);

  async function refresh(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    const minDelay = new Promise((r) => setTimeout(r, 600));
    try {
      await Promise.all([
        autoMutedStore.reload(),
        siteVolumesStore.reload(),
        pageVolumesStore.reload(),
        minDelay,
      ]);
    } finally {
      refreshing = false;
    }
  }

  async function deleteMutes(): Promise<void> {
    const keys = [...muteSelected];
    await autoMutedStore.update((m) => {
      const next = { ...m };
      for (const k of keys) delete next[k];
      return next;
    });
  }

  async function deleteSites(): Promise<void> {
    const keys = [...siteSelected];
    await siteVolumesStore.update((m) => {
      const next = { ...m };
      for (const k of keys) delete next[k];
      return next;
    });
  }

  async function deletePages(): Promise<void> {
    const keys = [...pageSelected];
    await pageVolumesStore.update((m) => {
      const next = { ...m };
      for (const k of keys) delete next[k];
      return next;
    });
  }

  function exportData(): void {
    const payload = {
      exportedAt: Date.now(),
      sync: { version: DATA_VERSION, autoMuted: muteMap },
      local: {
        version: DATA_VERSION,
        siteVolumes: siteMap,
        pageVolumes: pageMap,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `volumute-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function prepareSection<T>(
    version: number | undefined,
    data: T | undefined,
    migrations: Record<number, (map: T) => T>,
  ): T | null {
    if (version === undefined || version < MIN_SUPPORTED_VERSION || version > DATA_VERSION)
      return null;
    return migrateMap(migrations, (data ?? {}) as T, version, DATA_VERSION);
  }

  async function importData(): Promise<void> {
    const file = fileInput?.files?.[0];
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text()) as {
        version?: number;
        exportedAt?: number;
        sync?: { version?: number; autoMuted?: MuteMap } | MuteMap;
        local?:
          | {
              version?: number;
              siteVolumes?: SiteVolumeMap;
              pageVolumes?: PageVolumeMap;
            }
          | { siteVolumes?: SiteVolumeMap; pageVolumes?: PageVolumeMap };
      };
      // Legacy export ({ version, sync: {...}, local: {...} }): lift the
      // top-level version into each section.
      const legacyTop = typeof raw.version === 'number';
      const syncRaw = legacyTop
        ? {
            version: raw.version,
            autoMuted: (raw.sync as MuteMap | undefined) ?? {},
          }
        : (raw.sync as { version?: number; autoMuted?: MuteMap } | undefined);
      const localRaw = legacyTop
        ? {
            version: raw.version,
            siteVolumes:
              (raw.local as { siteVolumes?: SiteVolumeMap } | undefined)?.siteVolumes ?? {},
            pageVolumes:
              (raw.local as { pageVolumes?: PageVolumeMap } | undefined)?.pageVolumes ?? {},
          }
        : (raw.local as
            | {
                version?: number;
                siteVolumes?: SiteVolumeMap;
                pageVolumes?: PageVolumeMap;
              }
            | undefined);

      const impMute = prepareSection(syncRaw?.version, syncRaw?.autoMuted, MUTE_MIGRATIONS);
      const impSite = prepareSection(localRaw?.version, localRaw?.siteVolumes, VOLUME_MIGRATIONS);
      const impPage = prepareSection(localRaw?.version, localRaw?.pageVolumes, VOLUME_MIGRATIONS);
      if (impMute === null || impSite === null || impPage === null) {
        showStatus(tr('importFail', $currentLang), false, 4000);
        return;
      }
      if (importMode === 'overwrite') {
        await autoMutedStore.update(() => ({ ...impMute }));
        await siteVolumesStore.update(() => ({ ...impSite }));
        await pageVolumesStore.update(() => ({ ...impPage }));
      } else {
        await autoMutedStore.update((c) => {
          const next = { ...c };
          for (const [k, v] of Object.entries(impMute)) {
            const cur = next[k];
            const lastUsed = (v as { lastUsed?: number }).lastUsed ?? 0;
            if (!cur || lastUsed > ((cur as { lastUsed?: number }).lastUsed ?? 0)) next[k] = v;
          }
          return next;
        });
        await siteVolumesStore.update((c) => ({ ...impSite, ...c }));
        await pageVolumesStore.update((c) => ({ ...impPage, ...c }));
      }
      showStatus(tr('importSuccess', $currentLang), true);
    } catch {
      showStatus(tr('importFail', $currentLang), false, 4000);
    }
  }

  async function setLang(lang: Lang): Promise<void> {
    await updateSettings({ lang });
  }

  async function setTheme(theme: ThemeMode): Promise<void> {
    await updateSettings({ theme });
  }

  async function setMaxMultiplier(value: number): Promise<void> {
    if (!Number.isFinite(value)) return;
    const next = Math.max(MIN_MULTIPLIER, value);
    settings = { ...settings, maxMultiplier: next };
    await updateSettings({ maxMultiplier: next });
  }

  function setMaxVolumePercent(raw: string): void {
    if (!/^\d+$/.test(raw.trim())) return;
    void setMaxMultiplier(Number(raw.trim()) / 100);
  }

  function resetMaxVolume(): void {
    void setMaxMultiplier(DEFAULT_MAX_MULTIPLIER);
  }
</script>

<main>
  <header class="titlebar">
    <div class="brand">
      <img class="brand-mark" src="/icons/icon-32.png" alt="" />
      <span class="brand-name">VOLUMUTE</span>
      <span class="ver">{versionLabel}</span>
    </div>
    <nav class="tab-switch" aria-label={tr('tabSettings', $currentLang)}>
      <button
        class:active={tab === 'sites'}
        aria-pressed={tab === 'sites'}
        onclick={() => (tab = 'sites')}>{tr('tabSiteList', $currentLang)}</button
      >
      <button
        class:active={tab === 'settings'}
        aria-pressed={tab === 'settings'}
        onclick={() => (tab = 'settings')}>{tr('tabSettings', $currentLang)}</button
      >
      <button
        class:active={tab === 'help'}
        aria-pressed={tab === 'help'}
        onclick={() => (tab = 'help')}>{tr('tabHelp', $currentLang)}</button
      >
    </nav>
  </header>

  {#key tab}
    <div class="tab-panel">
      {#if tab === 'sites'}
        <div class="data-summary">
          <div class="data-summary-head">
            <h3>{tr('quotaUsage', $currentLang)}</h3>
            <button
              class="icon-btn"
              class:refreshing
              aria-busy={refreshing}
              onclick={refresh}
              title={tr('refresh', $currentLang)}
            >
              <svg
                class:spinning={refreshing}
                class="icon"
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="2.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
            </button>
          </div>
          <div class="quota-stats">
            <div class="quota-stat">
              <div class="quota-stat-head">
                <span class="quota-stat-name plate"
                  >{tr('autoMute', $currentLang)} <small>SYNC</small></span
                >
                <strong class="quota-stat-bytes">{muteCount}</strong>
              </div>
              <div class="quota-stat-foot"
                >{tr('quotaStorageUsed', $currentLang)} {fmtBytes(syncBytes)}</div
              >
            </div>
            <div class="quota-stat">
              <div class="quota-stat-head">
                <span class="quota-stat-name plate"
                  >{tr('siteVolume', $currentLang)} / {tr('pageVolume', $currentLang)}
                  <small>LOCAL</small></span
                >
                <strong class="quota-stat-bytes">{localCount}</strong>
              </div>
              <div class="quota-stat-foot"
                >{tr('quotaStorageUsed', $currentLang)} {fmtBytes(localBytes)}</div
              >
            </div>
          </div>
        </div>
        <section class="data-management">
          <h3>{tr('tabData', $currentLang)}</h3>
          <div class="management-actions">
            <button class="hw-btn" onclick={exportData}>{tr('exportData', $currentLang)}</button>

            <span class="management-divider" aria-hidden="true"></span>

            <button class="hw-btn" onclick={() => fileInput?.click()}
              >{tr('importData', $currentLang)}</button
            >
            <div class="import-mode" role="radiogroup" aria-label={tr('restoreData', $currentLang)}>
              <button
                type="button"
                class:active={importMode === 'merge'}
                role="radio"
                aria-checked={importMode === 'merge'}
                onclick={() => (importMode = 'merge')}>{tr('importMerge', $currentLang)}</button
              >
              <button
                type="button"
                class:active={importMode === 'overwrite'}
                role="radio"
                aria-checked={importMode === 'overwrite'}
                onclick={() => (importMode = 'overwrite')}
                >{tr('importOverwrite', $currentLang)}</button
              >
            </div>
          </div>
          <input
            type="file"
            accept="application/json"
            bind:this={fileInput}
            hidden
            onchange={importData}
          />
          {#if statusMsg}
            <div class="data-status" class:ok={statusOk}>{statusMsg}</div>
          {/if}
        </section>
        <div class="grid">
          <DataSection
            title={tr('tabSiteList', $currentLang) + ': ' + tr('autoMute', $currentLang)}
            rows={muteRows}
            emptyText={tr('noEntries', $currentLang)}
            selected={muteSelected}
            onDelete={deleteMutes}
          />
          <DataSection
            title={tr('siteVolume', $currentLang)}
            rows={siteRows}
            emptyText={tr('noEntries', $currentLang)}
            selected={siteSelected}
            onDelete={deleteSites}
          />
          <DataSection
            title={tr('pageVolume', $currentLang)}
            rows={pageRows}
            emptyText={tr('noEntries', $currentLang)}
            selected={pageSelected}
            onDelete={deletePages}
          />
        </div>
      {:else if tab === 'settings'}
        <div class="settings">
          <section class="settings-panel">
            <div class="setting-row">
              <h3>{tr('language', $currentLang)}</h3>
              <Segmented
                wide
                ariaLabel={tr('language', $currentLang)}
                value={settings.lang}
                onselect={setLang}
                options={[
                  { value: 'auto', label: tr('langAuto', $currentLang) },
                  { value: 'zh', label: '中文' },
                  { value: 'en', label: 'English' },
                ]}
              />
            </div>
            <div class="setting-row">
              <h3>{tr('theme', $currentLang)}</h3>
              <Segmented
                wide
                ariaLabel={tr('theme', $currentLang)}
                value={settings.theme}
                onselect={setTheme}
                options={[
                  { value: 'auto', label: tr('themeAuto', $currentLang) },
                  { value: 'light', label: tr('themeLight', $currentLang) },
                  { value: 'dark', label: tr('themeDark', $currentLang) },
                ]}
              />
            </div>
            <div class="setting-row">
              <h3>{tr('popupVolumeMode', $currentLang)}</h3>
              <Segmented
                wide
                ariaLabel={tr('popupVolumeMode', $currentLang)}
                value={settings.popupVolumeMode}
                onselect={(mode) => void updateSettings({ popupVolumeMode: mode })}
                options={[
                  { value: 'switch', label: tr('modeSwitch', $currentLang) },
                  { value: 'dual', label: tr('modeDual', $currentLang) },
                ]}
              />
            </div>
            <div class="setting-row">
              <h3>{tr('maxVolume', $currentLang)}</h3>
              <div class="max-volume-control">
                <div class="max-volume-value">
                  <input
                    type="text"
                    inputmode="decimal"
                    value={Math.round(settings.maxMultiplier * 100)}
                    onchange={(e) => setMaxVolumePercent((e.target as HTMLInputElement).value)}
                  />
                  <span class="max-volume-unit">%</span>
                </div>
                {#if settings.maxMultiplier !== DEFAULT_MAX_MULTIPLIER}
                  <button
                    class="reset-setting"
                    type="button"
                    onclick={resetMaxVolume}
                    title={tr('resetDefault', $currentLang)}
                    aria-label={tr('resetDefault', $currentLang)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="13"
                      height="13"
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
                {/if}
              </div>
            </div>
          </section>
        </div>
      {:else}
        <div class="help">
          <section>
            <h3>{tr('autoMute', $currentLang)}</h3>
            <p>{tr('autoMuteDesc', $currentLang)}</p>
          </section>
          <section>
            <h3>{tr('pageVolume', $currentLang)}</h3>
            <p>{tr('pageVolumeDesc', $currentLang)}</p>
          </section>
          <section>
            <h3>{tr('siteVolume', $currentLang)}</h3>
            <p>{tr('siteVolumeDesc', $currentLang)}</p>
          </section>
          <section>
            <h3>{tr('priority', $currentLang)}</h3>
            <p>{tr('helpPriority', $currentLang)}</p>
          </section>
          <section>
            <h3>{tr('maxVolume', $currentLang)}</h3>
            <p>{tr('maxVolumeDesc', $currentLang)}</p>
          </section>
        </div>
      {/if}
    </div>
  {/key}
</main>

<style>
  :global(html) {
    background: var(--bg);
  }
  :global(body) {
    margin: 0;
    padding: 0;
    background: var(--bg);
    min-width: 280px;
  }

  main {
    position: relative;
    max-width: 1040px;
    margin: 0 auto;
    padding: 42px 34px 64px;
    font-family: var(--font-sans);
    color: var(--ink);
  }
  main::before {
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    content: '';
    opacity: 0.5;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.022) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.022) 1px, transparent 1px);
    background-size: 28px 28px;
    mask-image: linear-gradient(to bottom, black, transparent 78%);
  }

  .titlebar {
    position: relative;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
    padding: 16px 0 22px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 26px;
  }
  .brand {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .brand-mark {
    width: 30px;
    height: 30px;
    object-fit: contain;
    border-radius: var(--radius);
  }
  .brand-name {
    overflow: hidden;
    color: var(--ink);
    font-family: var(--font-display);
    font-size: clamp(20px, 2.6vw, 27px);
    font-weight: 600;
    letter-spacing: 0.22em;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-shadow: var(--engrave-shadow);
  }
  .ver {
    align-self: flex-end;
    padding-bottom: 1px;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.08em;
    color: var(--ink-faint);
    white-space: nowrap;
  }

  .tab-switch {
    display: flex;
    width: min(26rem, 100%);
    gap: 2px;
    padding: 3px;
    background: var(--groove);
    border: 1px solid var(--groove-border);
    border-radius: var(--radius);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.35);
  }
  .tab-switch button {
    flex: 1;
    position: relative;
    border: none;
    border-radius: 2px;
    background: transparent;
    padding: 9px 12px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--ink-dim);
    cursor: pointer;
    white-space: nowrap;
    transition:
      color 140ms ease,
      background 140ms ease;
  }
  .tab-switch button:hover {
    color: var(--ink);
    background: var(--panel);
  }
  .tab-switch button.active {
    color: var(--amber);
    background: var(--panel-2);
    box-shadow: var(--panel-etched);
  }
  .tab-switch button.active::after {
    position: absolute;
    left: 50%;
    bottom: 2px;
    transform: translateX(-50%);
    width: 4px;
    height: 2px;
    border-radius: 1px;
    content: '';
    background: var(--amber);
    box-shadow: var(--amber-glow);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: start;
    gap: 14px;
  }

  .data-summary,
  .data-management {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--panel-etched);
  }
  .data-summary {
    margin-bottom: 14px;
    padding: 16px 18px;
  }
  .data-summary-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--line);
  }
  .data-summary-head h3 {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink);
    text-shadow: var(--engrave-shadow);
  }
  .data-summary-head .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel-2);
    color: var(--ink-dim);
    cursor: pointer;
  }
  .data-summary-head .icon-btn:hover,
  .data-summary-head .icon-btn.refreshing {
    border-color: var(--amber);
    color: var(--amber);
  }
  .data-summary-head .icon {
    display: block;
  }
  .data-summary-head .icon.spinning {
    animation: io-spin 0.7s linear infinite;
  }
  @keyframes io-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .quota-stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    padding-top: 14px;
  }
  .quota-stat {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 11px 13px;
    background: var(--groove);
    border: 1px solid var(--groove-border);
    border-radius: var(--radius);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.3);
  }
  .quota-stat-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .quota-stat-name {
    font-size: 10px;
    color: var(--ink-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .quota-stat-name small {
    font-size: 8px;
    letter-spacing: 0.1em;
    color: var(--ink-dim);
  }
  .quota-stat-bytes {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--amber);
    text-shadow: var(--amber-glow);
    background: var(--bg);
    border: 1px solid var(--groove-border);
    border-radius: 2px;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.35);
    padding: 3px 6px;
    line-height: 1.2;
  }
  .quota-stat-foot {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.04em;
    color: var(--ink-dim);
    line-height: 1.4;
  }

  .data-management {
    position: relative;
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 18px;
    padding: 14px 18px;
  }
  .data-management h3 {
    flex: 0 0 auto;
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink);
    text-shadow: var(--engrave-shadow);
  }
  .management-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }
  .management-divider {
    width: 1px;
    height: 24px;
    flex: 0 0 auto;
    background: var(--line);
  }
  .management-actions .import-mode {
    height: 34px;
    box-sizing: border-box;
  }
  .import-mode {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    background: var(--groove);
    border: 1px solid var(--groove-border);
    border-radius: var(--radius);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.35);
    width: min(11rem, 100%);
  }
  .import-mode button {
    flex: 1;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 0 10px;
    border: none;
    border-radius: 2px;
    background: transparent;
    color: var(--ink-dim);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    white-space: nowrap;
    transition:
      color 140ms ease,
      background 140ms ease;
  }
  .import-mode button:hover {
    color: var(--ink);
  }
  .import-mode button.active {
    color: var(--amber);
    background: var(--panel-2);
    box-shadow: var(--panel-etched);
  }
  .data-status {
    position: absolute;
    right: 18px;
    bottom: -17px;
    color: var(--amber);
    font-family: var(--font-mono);
    font-size: 10px;
  }
  .data-status.ok {
    color: var(--green);
  }

  .settings-panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 5px 18px;
    box-shadow: var(--panel-etched);
  }
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    min-height: 62px;
    border-bottom: 1px solid var(--line);
  }
  .setting-row:last-child {
    border-bottom: 0;
  }
  .setting-row h3 {
    flex: 0 0 120px;
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink);
    text-shadow: var(--engrave-shadow);
  }
  .tab-panel {
    animation: tab-panel-in 180ms ease-out both;
  }
  @keyframes tab-panel-in {
    from {
      opacity: 0;
      transform: translateY(5px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .max-volume-control {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .max-volume-value {
    display: flex;
    align-items: stretch;
  }
  .max-volume-value input[type='text'] {
    width: 4em;
    box-sizing: border-box;
    font-family: var(--font-mono);
    font-size: 16px;
    font-weight: 600;
    text-align: center;
    font-variant-numeric: tabular-nums;
    color: var(--amber);
    background: var(--groove);
    border: 1px solid var(--groove-border);
    border-radius: var(--radius) 0 0 var(--radius);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.35);
    padding: 8px 4px;
  }
  .max-volume-value input[type='text']:focus {
    border-color: var(--amber);
    outline: none;
  }
  .max-volume-unit {
    display: inline-flex;
    align-items: center;
    padding: 0 9px 0 6px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--amber);
    text-shadow: var(--amber-glow);
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-left: 0;
    border-radius: 0 var(--radius) var(--radius) 0;
  }
  .reset-setting {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    background: transparent;
    color: var(--ink-dim);
    border-radius: var(--radius);
    padding: 5px;
    cursor: pointer;
  }
  .reset-setting:hover {
    border-color: var(--amber);
    color: var(--amber);
  }

  .help {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
    gap: 14px;
  }
  .help section {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 9px;
    box-shadow: var(--panel-etched);
  }
  .help h3 {
    margin: 0 0 4px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--amber);
  }
  .help p {
    margin: 0;
    font-size: 12px;
    color: var(--ink-dim);
    line-height: 1.65;
  }

  button {
    line-height: 1.2;
  }

  @media (max-width: 820px) {
    main {
      padding: 36px 22px 48px;
    }
    .titlebar {
      align-items: flex-start;
      flex-direction: column;
    }
    .tab-switch {
      width: 100%;
    }
    .tab-switch button {
      flex: 1;
      padding-inline: 8px;
    }
    .grid {
      grid-template-columns: 1fr;
    }
    .quota-stats {
      grid-template-columns: 1fr 1fr;
    }
  }

  @media (max-width: 520px) {
    main {
      padding: 30px 14px 36px;
    }
    .titlebar {
      gap: 18px;
      margin-bottom: 20px;
    }
    .brand-name {
      font-size: 18px;
      letter-spacing: 0.14em;
    }
    .ver {
      display: none;
    }
    .tab-switch button {
      font-size: 9px;
      letter-spacing: 0.04em;
    }
    .quota-stats {
      grid-template-columns: 1fr;
    }
    .help {
      grid-template-columns: 1fr;
    }
    .data-management,
    .management-actions {
      align-items: stretch;
      flex-direction: column;
    }
    .data-management {
      gap: 12px;
      padding: 15px;
    }
    .management-actions {
      flex-wrap: wrap;
    }
    .management-actions .hw-btn {
      flex: 1;
    }
    .management-divider {
      display: none;
    }
    .settings-panel,
    .help section {
      padding: 15px;
    }
    .setting-row {
      align-items: flex-start;
      flex-direction: column;
      justify-content: center;
      gap: 8px;
      padding: 13px 0;
    }
    .setting-row h3 {
      flex-basis: auto;
    }
    .import-mode {
      width: 100%;
    }
  }
</style>
