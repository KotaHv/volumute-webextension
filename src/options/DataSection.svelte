<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { onMount } from 'svelte';
  import { currentLang, tr } from '../i18n/svelte';
  import type { MessageKey } from '../i18n';
  import { uiPrefsStore } from '../storage/stores';

  export interface Row {
    key: string;
    value: string;
    created?: number;
    lastUsed?: number;
    multiplier?: number;
    muted?: boolean;
  }

  type SortKey = 'recent' | 'name' | 'created' | 'multiplier';

  let {
    id,
    title,
    rows,
    emptyText,
    selected = new SvelteSet<string>(),
    onDelete = () => {},
    selectable = true,
  }: {
    id: string;
    title: string;
    rows: Row[];
    emptyText: string;
    selected?: Set<string>;
    onDelete?: () => void;
    selectable?: boolean;
  } = $props();

  let confirming = $state(false);
  let cancelBtn: HTMLButtonElement | null = $state(null);
  let filterText = $state('');
  let sortKey = $state<SortKey>('recent');

  const SORT_LABELS: Record<SortKey, MessageKey> = {
    recent: 'sortRecent',
    name: 'sortName',
    created: 'sortCreated',
    multiplier: 'sortMultiplier',
  };

  const lastTs = (r: Row): number => r.lastUsed ?? r.created ?? 0;

  const allowedSorts = $derived(
    (['recent', 'name', 'created', 'multiplier'] as SortKey[]).filter(
      (k) => k !== 'multiplier' || rows.some((r) => r.multiplier !== undefined),
    ),
  );

  const filtered = $derived.by(() => {
    const q = filterText.trim().toLowerCase();
    const base = q ? rows.filter((r) => r.value.toLowerCase().includes(q)) : rows;
    const sorted = [...base];
    if (sortKey === 'name') sorted.sort((a, b) => a.value.localeCompare(b.value));
    else if (sortKey === 'created') sorted.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    else if (sortKey === 'multiplier')
      sorted.sort((a, b) => (b.multiplier ?? 1) - (a.multiplier ?? 1));
    else sorted.sort((a, b) => lastTs(b) - lastTs(a));
    return sorted;
  });

  const allSelected = $derived(
    filtered.length > 0 && filtered.every((r) => selected.has(r.key)),
  );

  onMount(async () => {
    await uiPrefsStore.init();
    const saved = uiPrefsStore.snapshot()[id]?.value as SortKey | undefined;
    if (saved && allowedSorts.includes(saved)) sortKey = saved;
  });

  function toggleAll(): void {
    if (allSelected) {
      for (const r of filtered) selected.delete(r.key);
    } else {
      for (const r of filtered) selected.add(r.key);
    }
  }

  function toggle(key: string): void {
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
  }

  function cycleSort(): void {
    const list = allowedSorts;
    sortKey = list[(list.indexOf(sortKey) + 1) % list.length];
    void uiPrefsStore.update((m) => ({
      ...m,
      [id]: { value: sortKey, lastUsed: Date.now() },
    }));
  }

  function shortDate(ts?: number): string {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function openConfirm(): void {
    confirming = true;
  }

  function closeConfirm(): void {
    confirming = false;
  }

  function confirmDelete(): void {
    confirming = false;
    onDelete();
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (confirming && e.key === 'Escape') confirming = false;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<section class="section">
  <div class="head">
    <h3>{title}</h3>
    <span class="count">
      {#if filterText.trim()}
        {filtered.length}/{rows.length}
      {:else}
        {rows.length}
      {/if}
    </span>
  </div>
  {#if rows.length > 0}
    <div class="tools">
      <input
        class="filter"
        type="search"
        placeholder={tr('filter', $currentLang)}
        bind:value={filterText}
      />
      <button
        type="button"
        class="sort"
        onclick={cycleSort}
        aria-label={`${tr('sortBy', $currentLang)}: ${tr(SORT_LABELS[sortKey], $currentLang)}`}
        title={`${tr('sortBy', $currentLang)}: ${tr(SORT_LABELS[sortKey], $currentLang)}`}
      >
        <svg
          class="icon"
          viewBox="0 0 24 24"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m21 16-4 4-4-4" />
          <path d="M17 20V4" />
          <path d="m3 8 4-4 4 4" />
          <path d="M7 4v16" />
        </svg>
        {tr(SORT_LABELS[sortKey], $currentLang)}
      </button>
    </div>
  {/if}
  {#if rows.length === 0}
    <p class="empty">{emptyText}</p>
  {:else if filtered.length === 0}
    <p class="empty">{emptyText}</p>
  {:else}
    <div class="list">
      {#each filtered as row (row.key)}
        <label class="row" class:checked={selectable && selected.has(row.key)}>
          {#if selectable}
            <input
              type="checkbox"
              checked={selected.has(row.key)}
              onchange={() => toggle(row.key)}
            />
          {/if}
          <div class="cell">
            <div class="cell-main" title={row.value}>{row.value}</div>
            <div class="cell-meta">
              <span class="meta-row">
                <span class="k">{tr('created', $currentLang)}</span>
                <span class="v">{shortDate(row.created)}</span>
              </span>
              <span class="meta-row">
                <span class="k">{tr('siteLastUsed', $currentLang)}</span>
                <span class="v">{shortDate(row.lastUsed)}</span>
              </span>
            </div>
          </div>
          {#if row.multiplier !== undefined}
            <span
              class="badge"
              class:default={Math.round(row.multiplier * 100) === 100}
            >
              {Math.round(row.multiplier * 100)}%
            </span>
          {:else if row.muted}
            <span class="badge mute">{tr('muteEnabled', $currentLang)}</span>
          {/if}
        </label>
      {/each}
    </div>
    {#if selectable}
      <div class="actions">
        <button onclick={toggleAll}
          >{allSelected ? tr('selectNone', $currentLang) : tr('selectAll', $currentLang)}</button
        >
        <button class="danger" onclick={openConfirm} disabled={selected.size === 0}>
          {tr('deleteSelected', $currentLang)} ({selected.size})
        </button>
      </div>
    {/if}
  {/if}

  {#if confirming}
    <div
      class="overlay"
      role="presentation"
      onclick={(e) => {
        if (e.target === e.currentTarget) closeConfirm();
      }}
    >
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        tabindex="-1"
      >
        <h4 id="confirm-title">{title}</h4>
        <p>
          {tr('confirmDeleteSelected', $currentLang)}
          <span class="n">({selected.size})</span>
        </p>
        <div class="dialog-actions">
          <button bind:this={cancelBtn} onclick={closeConfirm}>{tr('cancel', $currentLang)}</button>
          <button class="danger" onclick={confirmDelete}
            >{tr('deleteSelected', $currentLang)}</button
          >
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  .section {
    min-width: 0;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 14px;
    box-shadow: var(--panel-etched);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--line);
  }
  .head h3 {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    flex-shrink: 0;
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--amber);
    background: var(--groove);
    border: 1px solid var(--groove-border);
    border-radius: 2px;
    box-shadow: var(--well-shadow);
    padding: 2px 7px;
    line-height: 1.4;
  }

  .tools {
    display: flex;
    gap: 6px;
    margin-top: 10px;
  }
  .filter {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    height: 26px;
    padding: 0 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink);
    background: var(--groove);
    border: 1px solid var(--groove-border);
    border-radius: var(--radius);
    box-shadow: var(--well-shadow);
  }
  .filter::placeholder {
    color: var(--ink-faint);
    letter-spacing: 0.04em;
  }
  .filter:focus-visible,
  .sort:focus-visible {
    outline: 2px solid var(--amber);
    outline-offset: 1px;
  }
  .sort {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    min-width: 84px;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    line-height: 1;
    color: var(--amber);
    text-shadow: var(--amber-glow);
    background: var(--groove);
    border: 1px solid var(--groove-border);
    border-radius: var(--radius);
    box-shadow: var(--well-shadow);
    padding: 0 9px;
    cursor: pointer;
  }
  .sort .icon {
    display: block;
    flex-shrink: 0;
  }
  .sort:hover {
    color: var(--amber-fg);
    background: var(--amber);
    text-shadow: none;
  }

  .empty {
    color: var(--ink-dim);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    margin: 12px 0 0;
  }

  .list {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    max-height: clamp(320px, calc(100vh - 420px), 720px);
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-top: 1px solid var(--line);
    cursor: pointer;
    user-select: text;
    -webkit-user-select: text;
    -moz-user-select: text;
  }
  .row:first-child {
    border-top: 0;
  }
  .row:hover {
    background: var(--panel-2);
  }
  .row.checked {
    box-shadow: inset 2px 0 0 var(--amber);
  }
  .row input[type='checkbox'] {
    appearance: none;
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    margin: 0;
    display: grid;
    place-content: center;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--groove);
    box-shadow: var(--well-shadow);
    cursor: pointer;
  }
  .row input[type='checkbox']:hover {
    border-color: var(--amber);
  }
  .row input[type='checkbox']:checked {
    background: var(--amber);
    border-color: var(--amber);
  }
  .row input[type='checkbox']::after {
    content: '';
    width: 7px;
    height: 7px;
    display: none;
    background: var(--amber-fg);
    clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%);
  }
  .row input[type='checkbox']:checked::after {
    display: block;
  }
  .row input[type='checkbox']:focus-visible {
    outline: 2px solid var(--amber);
    outline-offset: 1px;
  }

  .cell {
    min-width: 0;
    flex: 1;
  }
  .cell-main {
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cell-meta {
    display: grid;
    gap: 1px;
    margin-top: 3px;
    max-width: 200px;
  }
  .meta-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.03em;
    color: var(--ink-dim);
    line-height: 1.4;
  }
  .meta-row .k {
    flex-shrink: 0;
  }
  .meta-row .v {
    font-variant-numeric: tabular-nums;
  }

  .badge {
    flex-shrink: 0;
    align-self: center;
    box-sizing: border-box;
    min-width: 50px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--amber);
    text-shadow: var(--amber-glow);
    background: var(--bg);
    border: 1px solid var(--groove-border);
    border-radius: 2px;
    box-shadow: var(--well-shadow);
    padding: 4px 7px;
    line-height: 1.3;
  }
  .badge.default {
    color: var(--ink-dim);
    text-shadow: none;
  }
  .badge.mute {
    color: var(--red);
    text-shadow: var(--red-glow);
  }

  .actions {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(4, 7, 10, 0.6);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }
  .dialog {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 16px;
    min-width: 260px;
    max-width: 90vw;
    box-shadow: var(--shadow-dialog);
  }
  .dialog h4 {
    margin: 0 0 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }
  .dialog p {
    margin: 0;
    font-size: 13px;
    color: var(--ink);
  }
  .dialog .n {
    color: var(--ink-dim);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .dialog-actions {
    margin-top: 14px;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  button {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    line-height: 1.2;
    padding: 7px 12px;
    border-radius: var(--radius);
    border: 1px solid var(--line);
    background: var(--panel-2);
    color: var(--ink-dim);
    cursor: pointer;
    transition:
      color 120ms ease,
      border-color 120ms ease,
      background 120ms ease;
  }
  button:hover {
    border-color: var(--amber);
    color: var(--amber);
  }
  button.danger {
    border-color: var(--red);
    color: var(--red);
  }
  button.danger:hover {
    background: var(--red);
    color: var(--amber-fg);
  }
  button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
</style>
