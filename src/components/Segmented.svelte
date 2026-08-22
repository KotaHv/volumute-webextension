<script lang="ts" generics="V extends string">
  interface Option {
    value: V;
    label: string;
  }

  let {
    options,
    value,
    onselect,
    ariaLabel = '',
    wide = false,
  }: {
    options: Option[];
    value: V;
    onselect?: (value: V) => void;
    ariaLabel?: string;
    wide?: boolean;
  } = $props();
</script>

<div class="segmented" class:wide role="group" aria-label={ariaLabel}>
  {#each options as opt (opt.value)}
    <button
      type="button"
      class:selected={opt.value === value}
      aria-pressed={opt.value === value}
      onclick={() => onselect?.(opt.value)}
    >
      {opt.label}
    </button>
  {/each}
</div>

<style>
  .segmented {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 100%;
    padding: 3px;
    background: var(--groove);
    border: 1px solid var(--groove-border);
    border-radius: var(--radius);
    box-shadow: var(--well-shadow);
  }
  .segmented.wide {
    display: flex;
    width: min(19rem, 100%);
  }
  .segmented button {
    border: 0;
    border-radius: 2px;
    background: transparent;
    color: var(--ink-dim);
    padding: 4px 10px;
    min-width: 48px;
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
  .segmented.wide button {
    flex: 1;
    min-width: 0;
    padding-block: 8px;
  }
  .segmented button:hover {
    color: var(--ink);
    background: var(--panel);
  }
  .segmented button.selected {
    color: var(--amber);
    background: var(--panel-2);
    box-shadow: var(--panel-etched);
  }
  .segmented button:focus-visible {
    outline: 2px solid var(--amber);
    outline-offset: 1px;
  }
</style>
