<script lang="ts">
  import Segmented from '../components/Segmented.svelte';
  import ClearButton from '../components/ClearButton.svelte';
  import LedInput from '../components/LedInput.svelte';
  import Fader from '../components/Fader.svelte';

  let {
    target,
    shownVol,
    maxMultiplier,
    muted,
    effective,
    hasTargetVol,
    resetting,
    labels,
    onswitch,
    ondrag,
    oncommit,
    onled,
    onreset,
  }: {
    target: 'page' | 'site';
    shownVol: number;
    maxMultiplier: number;
    muted: boolean;
    effective: 'page' | 'site' | null;
    hasTargetVol: boolean;
    resetting: boolean;
    labels: { scopePage: string; scopeSite: string; volume: string; reset: string };
    onswitch: (target: 'page' | 'site') => void;
    ondrag: (value: number) => void;
    oncommit: () => void;
    onled: (raw: string) => void;
    onreset: () => void;
  } = $props();
</script>

<section
  class="strip"
  class:active={effective !== null}
  class:page-active={effective === 'page'}
  class:site-active={effective === 'site'}
>
  <div class="row">
    <Segmented
      options={[
        { value: 'page', label: labels.scopePage },
        { value: 'site', label: labels.scopeSite },
      ]}
      value={target}
      onselect={onswitch}
    />
    <span class="sp" aria-hidden="true"></span>
    <ClearButton title={labels.reset} {resetting} visible={hasTargetVol} onclick={onreset} />
    <LedInput
      pct={Math.round(shownVol * 100)}
      dim={muted}
      ariaLabel={labels.volume}
      oncommit={onled}
    />
  </div>
  <Fader
    value={shownVol}
    max={maxMultiplier}
    ariaLabel={labels.volume}
    oninput={ondrag}
    oncommit={oncommit}
  />
</section>
