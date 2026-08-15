<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import DataSection from './DataSection.svelte';
  import { autoMutedStore, pageVolumesStore, siteVolumesStore } from '../storage/stores';
  import { getSettings, subscribeSettings, updateSettings } from '../storage/settings';
  import { currentLang, setCurrentLang, tr } from '../i18n/svelte';
  import { applyTheme } from '../theme';
  import { DATA_VERSION, MIN_SUPPORTED_VERSION } from '../core/constants';
  import { MUTE_MIGRATIONS, VOLUME_MIGRATIONS, migrateMap } from '../core/migrate';
  import type { MuteMap, PageVolumeMap, Settings, SiteVolumeMap, ThemeMode, Lang } from '../core/types';

  type Tab = 'sites' | 'data' | 'settings'
  let tab = $state<Tab>('sites');
  let settings = $state<Settings>({ lang: 'auto', theme: 'auto' });

  let muteMap = $state<MuteMap>({});
  let siteMap = $state<SiteVolumeMap>({});
  let pageMap = $state<PageVolumeMap>({});

  let muteSelected = new SvelteSet<string>();
  let siteSelected = new SvelteSet<string>();
  let pageSelected = new SvelteSet<string>();

  let importMode = $state<'merge' | 'overwrite'>('merge');
  let statusMsg = $state('');
  let fileInput = $state<HTMLInputElement | null>(null);

  function fmt(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  function pct(v: number): string {
    return `${Math.round(v * 100)}%`;
  }

  const muteRows = $derived(Object.entries(muteMap).map(([host, e]) => ({
    key: host,
    value: host,
    sub: `${tr('muteEnabled', $currentLang)} · ${tr('created', $currentLang)}: ${fmt(e.created)} · ${tr('siteLastUsed', $currentLang)}: ${fmt(e.lastUsed)}`,
  })));

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

  function refresh(): void {
    void autoMutedStore.reload();
    void siteVolumesStore.reload();
    void pageVolumesStore.reload();
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
      local: { version: DATA_VERSION, siteVolumes: siteMap, pageVolumes: pageMap },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
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
    if (version === undefined || version < MIN_SUPPORTED_VERSION || version > DATA_VERSION) return null;
    return migrateMap(migrations, (data ?? {}) as T, version, DATA_VERSION);
  }

  async function importData(): Promise<void> {
    const file = fileInput?.files?.[0];
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text()) as {
        version?: number
        exportedAt?: number
        sync?: { version?: number; autoMuted?: MuteMap } | MuteMap
        local?:
          | { version?: number; siteVolumes?: SiteVolumeMap; pageVolumes?: PageVolumeMap }
          | { siteVolumes?: SiteVolumeMap; pageVolumes?: PageVolumeMap }
      };
      // Legacy export ({ version, sync: {...}, local: {...} }): lift the
      // top-level version into each section.
      const legacyTop = typeof raw.version === 'number';
      const syncRaw = legacyTop
        ? { version: raw.version, autoMuted: (raw.sync as MuteMap | undefined) ?? {} }
        : (raw.sync as { version?: number; autoMuted?: MuteMap } | undefined);
      const localRaw = legacyTop
        ? {
            version: raw.version,
            siteVolumes: ((raw.local as { siteVolumes?: SiteVolumeMap } | undefined)?.siteVolumes ?? {}),
            pageVolumes: ((raw.local as { pageVolumes?: PageVolumeMap } | undefined)?.pageVolumes ?? {}),
          }
        : (raw.local as { version?: number; siteVolumes?: SiteVolumeMap; pageVolumes?: PageVolumeMap } | undefined);

      const impMute = prepareSection(syncRaw?.version, syncRaw?.autoMuted, MUTE_MIGRATIONS);
      const impSite = prepareSection(localRaw?.version, localRaw?.siteVolumes, VOLUME_MIGRATIONS);
      const impPage = prepareSection(localRaw?.version, localRaw?.pageVolumes, VOLUME_MIGRATIONS);
      if (impMute === null || impSite === null || impPage === null) {
        statusMsg = tr('importFail', $currentLang);
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
      statusMsg = tr('importSuccess', $currentLang);
    } catch {
      statusMsg = tr('importFail', $currentLang);
    }
  }

  async function setLang(lang: Lang): Promise<void> {
    await updateSettings({ lang });
  }

  async function setTheme(theme: ThemeMode): Promise<void> {
    await updateSettings({ theme });
  }
</script>

<main>
  <header class="titlebar">
    <div class="brand">
      <span class="brand-mark"></span>
      <span class="brand-name">VOLUMUTE</span>
    </div>
    <nav>
      <button class:active={tab === 'sites'} onclick={() => (tab = 'sites')}>{tr('tabSiteList', $currentLang)}</button>
      <button class:active={tab === 'data'} onclick={() => (tab = 'data')}>{tr('tabData', $currentLang)}</button>
      <button class:active={tab === 'settings'} onclick={() => (tab = 'settings')}>{tr('tabSettings', $currentLang)}</button>
    </nav>
  </header>

  {#if tab === 'sites'}
    <div class="grid">
      <DataSection
        title={tr('tabSiteList', $currentLang) + ': ' + tr('autoMute', $currentLang)}
        rows={muteRows}
        emptyText={tr('noEntries', $currentLang)}
        bind:selected={muteSelected}
        onDelete={deleteMutes}
      />
      <DataSection
        title={tr('siteVolume', $currentLang)}
        rows={siteRows}
        emptyText={tr('noEntries', $currentLang)}
        bind:selected={siteSelected}
        onDelete={deleteSites}
      />
      <DataSection
        title={tr('pageVolume', $currentLang)}
        rows={pageRows}
        emptyText={tr('noEntries', $currentLang)}
        bind:selected={pageSelected}
        onDelete={deletePages}
      />
    </div>
  {:else if tab === 'data'}
    <div class="quota">
      <span class="quota-head">{tr('quotaUsage', $currentLang)}</span>
      <span class="quota-item">{tr('autoMute', $currentLang)} (sync): <b>{syncBytes}</b> {tr('quotaBytes', $currentLang)} · <b>{Object.keys(muteMap).length}</b> {tr('quotaItems', $currentLang)}</span>
      <span class="quota-item">{tr('siteVolume', $currentLang)}/{tr('pageVolume', $currentLang)} (local): <b>{localBytes}</b> {tr('quotaBytes', $currentLang)} · <b>{Object.keys(siteMap).length + Object.keys(pageMap).length}</b> {tr('quotaItems', $currentLang)}</span>
    </div>
    <div class="io">
      <button onclick={refresh} title="refresh">⟳</button>
      <button onclick={exportData}>{tr('exportData', $currentLang)}</button>
      <span class="io-sep"></span>
      <label>
        <input type="radio" name="mode" value="merge" bind:group={importMode} />
        {tr('importMerge', $currentLang)}
      </label>
      <label>
        <input type="radio" name="mode" value="overwrite" bind:group={importMode} />
        {tr('importOverwrite', $currentLang)}
      </label>
      <button onclick={() => fileInput?.click()}>{tr('importData', $currentLang)}</button>
      <input type="file" accept="application/json" bind:this={fileInput} hidden onchange={importData} />
      {#if statusMsg}
        <span class="status">{statusMsg}</span>
      {/if}
    </div>
    <div class="grid">
      <DataSection
        title={tr('autoMute', $currentLang)}
        rows={muteRows}
        emptyText={tr('noEntries', $currentLang)}
        bind:selected={muteSelected}
        onDelete={deleteMutes}
      />
      <DataSection
        title={tr('siteVolume', $currentLang)}
        rows={siteRows}
        emptyText={tr('noEntries', $currentLang)}
        bind:selected={siteSelected}
        onDelete={deleteSites}
      />
      <DataSection
        title={tr('pageVolume', $currentLang)}
        rows={pageRows}
        emptyText={tr('noEntries', $currentLang)}
        bind:selected={pageSelected}
        onDelete={deletePages}
      />
    </div>
  {:else}
    <div class="settings">
      <section>
        <h3>{tr('language', $currentLang)}</h3>
        <label><input type="radio" name="lang" value="auto" checked={settings.lang === 'auto'} onchange={() => setLang('auto')} /> {tr('langAuto', $currentLang)}</label>
        <label><input type="radio" name="lang" value="zh" checked={settings.lang === 'zh'} onchange={() => setLang('zh')} /> 中文</label>
        <label><input type="radio" name="lang" value="en" checked={settings.lang === 'en'} onchange={() => setLang('en')} /> English</label>
      </section>
      <section>
        <h3>{tr('theme', $currentLang)}</h3>
        <label><input type="radio" name="theme" value="auto" checked={settings.theme === 'auto'} onchange={() => setTheme('auto')} /> {tr('themeAuto', $currentLang)}</label>
        <label><input type="radio" name="theme" value="light" checked={settings.theme === 'light'} onchange={() => setTheme('light')} /> {tr('themeLight', $currentLang)}</label>
        <label><input type="radio" name="theme" value="dark" checked={settings.theme === 'dark'} onchange={() => setTheme('dark')} /> {tr('themeDark', $currentLang)}</label>
      </section>
    </div>
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
    }
  }
  :global(:root) {
    --mono: ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace;
    --sans: system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  :global(html) {
    background: var(--bg);
  }
  :global(body) {
    margin: 0;
    padding: 0;
    background: var(--bg);
  }

  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 28px 24px 40px;
    font-family: var(--sans);
    color: var(--ink);
  }

  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 18px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .brand-mark {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    background: var(--amber);
  }
  .brand-name {
    font-family: var(--mono);
    font-size: 13px;
    letter-spacing: 0.2em;
  }
  nav {
    display: flex;
    gap: 2px;
  }
  nav button {
    border: none;
    background: none;
    padding: 7px 12px;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-dim);
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  nav button:hover {
    color: var(--ink);
  }
  nav button.active {
    color: var(--amber);
    border-bottom-color: var(--amber);
  }

  .grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .quota {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 14px;
    margin-bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12px;
    color: var(--ink-dim);
  }
  .quota-head {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink);
  }
  .quota-item {
    font-family: var(--mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .quota-item b {
    color: var(--amber);
    font-weight: 600;
  }

  .io {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
    font-size: 12px;
    flex-wrap: wrap;
  }
  .io button {
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  }
  .io button:hover {
    border-color: var(--amber);
    color: var(--amber);
  }
  .io-sep {
    width: 1px;
    height: 16px;
    background: var(--line);
    margin: 0 4px;
  }
  .io label {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--ink-dim);
    cursor: pointer;
  }
  .io input[type='radio'] {
    accent-color: var(--amber);
  }
  .status {
    color: var(--amber);
    font-size: 12px;
  }

  .settings {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .settings section {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 7px;
    font-size: 13px;
  }
  .settings h3 {
    margin: 0 0 4px;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink);
  }
  .settings label {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ink-dim);
    cursor: pointer;
  }
  .settings input[type='radio'] {
    accent-color: var(--amber);
  }
</style>
