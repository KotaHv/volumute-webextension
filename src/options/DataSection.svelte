<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { currentLang, tr } from '../i18n/svelte';

  interface Row {
    key: string;
    value: string;
    sub: string;
  }

  let {
    title,
    rows,
    emptyText,
    selected = new SvelteSet<string>(),
    onDelete = () => {},
    selectable = true,
  }: {
    title: string;
    rows: Row[];
    emptyText: string;
    selected?: Set<string>;
    onDelete?: () => void;
    selectable?: boolean;
  } = $props();

  let confirming = $state(false);
  let cancelBtn: HTMLButtonElement | null = $state(null);

  $effect(() => {
    if (confirming) cancelBtn?.focus();
  });

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
    <span class="count">{rows.length}</span>
  </div>
  {#if rows.length === 0}
    <p class="empty">{emptyText}</p>
  {:else}
    <div class="list">
      {#each rows as row (row.key)}
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
            <div class="cell-sub">{row.sub}</div>
          </div>
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
    text-shadow: var(--engrave-shadow);
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
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.3);
    padding: 2px 7px;
    line-height: 1.4;
  }
  .empty {
    color: var(--ink-dim);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    margin: 12px 0 0;
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
    border-radius: 2px;
    background: var(--groove);
    border: 1px solid var(--groove-border);
    box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.2);
    cursor: pointer;
    user-select: text;
    -webkit-user-select: text;
    -moz-user-select: text;
  }
  .row:hover {
    border-color: var(--line-strong);
  }
  .row.checked {
    box-shadow:
      inset 2px 0 0 var(--amber),
      inset 0 1px 1px rgba(0, 0, 0, 0.2);
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
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--ink-dim);
    margin-top: 1px;
    line-height: 1.45;
    white-space: normal;
    word-break: break-all;
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
    text-shadow: var(--engrave-shadow);
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
