<script lang="ts">
  let {
    title = '',
    resetting = false,
    visible = false,
    onclick,
  }: {
    title?: string;
    resetting?: boolean;
    visible?: boolean;
    onclick: () => void;
  } = $props();
</script>

<button
  type="button"
  class="clear"
  class:resetting
  {onclick}
  {title}
  style:visibility={visible || resetting ? 'visible' : 'hidden'}
>
  <svg
    viewBox="0 0 24 24"
    width="12"
    height="12"
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

<style>
  .clear {
    display: inline-flex;
    align-items: center;
    border: 1px solid transparent;
    background: transparent;
    color: var(--ink-dim);
    line-height: 1;
    cursor: pointer;
    padding: 3px 5px;
    border-radius: var(--radius);
    flex-shrink: 0;
    margin-right: 2px;
  }
  .clear:hover {
    color: var(--amber);
    border-color: var(--line);
  }
  .clear.resetting {
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease 0.2s;
  }
  .clear.resetting svg {
    animation: reset-spin 0.3s ease;
  }
  @keyframes reset-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(-360deg);
    }
  }
</style>
