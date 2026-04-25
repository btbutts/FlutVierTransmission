<script lang="ts">
import {
  cancelHideSeedsTooltip,
  hideSeedsTooltip,
  showSeedsTooltip
} from '$lib';
import { InformationVariantCircleOutline } from '$lib/plugins';
import type { TrackerStat } from '$lib/types';

interface Props {
  torrentId: number;
  seederCount: number;
  maxSeeders: number;
  trackerStats: TrackerStat[];
}

let { torrentId, seederCount, maxSeeders, trackerStats }: Props = $props();

let iconEl = $state<HTMLButtonElement | null>(null);

function handleMouseEnter() {
  cancelHideSeedsTooltip();
  if (!iconEl) return;
  const rect = iconEl.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const above = spaceBelow < 280 && rect.top > 280;
  showSeedsTooltip({
    torrentId,
    seederCount,
    maxSeeders,
    trackerStats,
    x: rect.left,
    y: above ? rect.top - 8 : rect.bottom + 8,
    above
  });
}

function handleMouseLeave() {
  hideSeedsTooltip();
}
</script>

<button
  bind:this={iconEl}
  type="button"
  class="inline-flex cursor-default items-center text-current transition-colors hover:text-blue-500"
  aria-label="Seeder details"
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
  onfocus={handleMouseEnter}
  onblur={handleMouseLeave}
>
  <InformationVariantCircleOutline class="h-[1.5em] w-[1.5em]" />
</button>
