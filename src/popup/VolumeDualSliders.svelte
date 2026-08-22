<script lang="ts">
  import ClearButton from '../components/ClearButton.svelte';
  import LedInput from '../components/LedInput.svelte';
  import Fader from '../components/Fader.svelte';

  const SCOPES = ['page', 'site'] as const;

  let {
    pageVol,
    siteVol,
    maxMultiplier,
    muted,
    effective,
    hasPageVol,
    hasSiteVol,
    pageResetting,
    siteResetting,
    labels,
    ondrag,
    oncommit,
    onled,
    onreset,
  }: {
    pageVol: number;
    siteVol: number;
    maxMultiplier: number;
    muted: boolean;
    effective: 'page' | 'site' | null;
    hasPageVol: boolean;
    hasSiteVol: boolean;
    pageResetting: boolean;
    siteResetting: boolean;
    labels: { page: string; site: string; reset: string };
    ondrag: (scope: 'page' | 'site', value: number) => void;
    oncommit: (scope: 'page' | 'site') => void;
    onled: (scope: 'page' | 'site', raw: string) => void;
    onreset: (scope: 'page' | 'site') => void;
  } = $props();
</script>

{#each SCOPES as scope (scope)}
  {@const vol = Math.min(scope === 'page' ? pageVol : siteVol, maxMultiplier)}
  {@const has = scope === 'page' ? hasPageVol : hasSiteVol}
  {@const resetting = scope === 'page' ? pageResetting : siteResetting}
  {@const label = scope === 'page' ? labels.page : labels.site}
  <section
    class="strip"
    class:active={effective === scope}
    class:page-active={effective === 'page'}
    class:site-active={effective === 'site'}
  >
    <div class="row">
      <span class="ch-label">{label}</span>
      <ClearButton
        title={labels.reset}
        {resetting}
        visible={has}
        onclick={() => onreset(scope)}
      />
      <LedInput
        pct={Math.round(vol * 100)}
        dim={muted}
        ariaLabel={label}
        oncommit={(raw) => onled(scope, raw)}
      />
    </div>
    <Fader
      value={vol}
      max={maxMultiplier}
      ariaLabel={label}
      oninput={(v) => ondrag(scope, v)}
      oncommit={() => oncommit(scope)}
    />
  </section>
{/each}
