<script lang="ts">
  let {
    pct,
    dim = false,
    ariaLabel = '',
    oncommit,
  }: {
    pct: number;
    dim?: boolean;
    ariaLabel?: string;
    oncommit: (raw: string) => void;
  } = $props();

  function selectOnFocus(e: FocusEvent): void {
    (e.target as HTMLInputElement).select();
  }

  function commitOnEnter(e: KeyboardEvent): void {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  }
</script>

<div class="led-well" class:led-dim={dim}>
  <input
    class="led"
    type="text"
    inputmode="decimal"
    value={pct}
    aria-label={ariaLabel}
    onfocus={selectOnFocus}
    onkeydown={commitOnEnter}
    onchange={(e) => oncommit((e.target as HTMLInputElement).value)}
  />
  <span class="pct">%</span>
</div>

<style>
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
    box-shadow: var(--well-shadow);
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
</style>
