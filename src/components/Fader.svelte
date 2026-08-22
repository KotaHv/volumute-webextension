<script lang="ts">
  let {
    value,
    max,
    ariaLabel = '',
    oninput,
    oncommit,
  }: {
    value: number;
    max: number;
    ariaLabel?: string;
    oninput: (value: number) => void;
    oncommit: () => void;
  } = $props();
</script>

<div class="fader" style={`--val: ${(value / max) * 100}%`}>
  <input
    type="range"
    min="0"
    {max}
    step="0.01"
    {value}
    aria-label={ariaLabel}
    oninput={(e) => oninput(Number((e.target as HTMLInputElement).value))}
    onchange={() => oncommit()}
  />
  <span class="fader-track" aria-hidden="true"><span class="fader-fill"></span></span>
  <span class="fader-thumb" aria-hidden="true"></span>
</div>

<style>
  .fader {
    position: relative;
    margin-top: 8px;
    height: 18px;
    touch-action: none;
  }
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
  .fader:has(input:focus-visible) {
    outline: 2px solid var(--amber);
    outline-offset: 1px;
  }
</style>
