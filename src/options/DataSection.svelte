<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { currentLang, tr } from '../i18n/svelte';

  interface Row {
    key: string
    value: string
    sub: string
  }

  let {
    title,
    rows,
    emptyText,
    selected = new SvelteSet<string>(),
    onDelete = () => {},
    selectable = true,
  }: {
    title: string
    rows: Row[]
    emptyText: string
    selected?: Set<string>
    onDelete?: () => void
    selectable?: boolean
  } = $props();

  const allSelected = $derived(rows.length > 0 && rows.every((r) => selected.has(r.key)));

  function toggleAll(): void {
    if (allSelected) {
      for (const r of rows) selected.delete(r.key);
    } else {
      for (const r of rows) selected.add(r.key);
    }
  }

  function toggle(key: string): void {
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
  }
</script>

<section class="section">
  <div class="head">
    <h3>{title}</h3>
    <span class="count">{rows.length}</span>
  </div>
  {#if rows.length === 0}
    <p class="empty">{emptyText}</p>
  {:else}
    <div class="list">
      {#each rows as row (row.key)}
        <div class="row" class:checked={selectable && selected.has(row.key)}>
          {#if selectable}
            <input type="checkbox" checked={selected.has(row.key)} onchange={() => toggle(row.key)} />
          {/if}
          <div class="cell">
            <div class="cell-main" title={row.value}>{row.value}</div>
            <div class="cell-sub">{row.sub}</div>
          </div>
        </div>
      {/each}
    </div>
    {#if selectable}
      <div class="actions">
        <button onclick={toggleAll}>{allSelected ? tr('selectNone', $currentLang) : tr('selectAll', $currentLang)}</button>
        <button class="danger" onclick={() => onDelete()} disabled={selected.size === 0}>
          {tr('deleteSelected', $currentLang)} ({selected.size})
        </button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .section {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 14px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .head h3 {
    margin: 0;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    background: var(--surface-2);
    color: var(--ink-dim);
    font-family: var(--mono);
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 99px;
    flex-shrink: 0;
  }
  .empty {
    color: var(--ink-dim);
    font-size: 12px;
    margin: 10px 0 0;
  }
  .list {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 280px;
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: 6px;
    background: var(--groove);
    border: 1px solid transparent;
  }
  .row.checked {
    border-color: var(--amber);
  }
  .row input[type='checkbox'] {
    accent-color: var(--amber);
    flex-shrink: 0;
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
  .cell-sub {
    font-family: var(--mono);
    font-size: 10px;
    color: var(--ink-dim);
    margin-top: 1px;
    line-height: 1.45;
    white-space: normal;
    word-break: break-all;
  }
  .actions {
    margin-top: 10px;
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  button {
    font-size: 11px;
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--ink);
    cursor: pointer;
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
    color: #fff;
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
