<!-- src/lib/components/LoadingArcSpinner.svelte
     Reusable 4-arc "paint-and-erase" loading spinner.

     Positive phase: four mdi-loading arcs sweep clockwise one quarter at a time,
     building up a full circle over 1.5 s (0°→90°→180°→270° in four staggered steps).

     Negative phase: the same four arcs converge back to 0° clockwise over 1.5 s,
     erasing the circle. The cycle then repeats.

     onanimationiteration on Icon 4 fires at every 1.5 s cycle boundary.
     When stopAtBoundary becomes true the next boundary calls onStopped instead
     of toggling the phase, letting the parent decide when to unmount the spinner.
     The banner runs indefinitely when stopAtBoundary is false (the default). -->
<script lang="ts">
import { Loading } from '$lib/plugins';

interface Props {
  class?: string;
  stopAtBoundary?: boolean;
  onStopped?: () => void;
}

let { class: className = '', stopAtBoundary = false, onStopped }: Props = $props();

let animPhase = $state<'positive' | 'negative'>('positive');

function handleIteration() {
  if (stopAtBoundary) {
    onStopped?.();
    return;
  }
  animPhase = animPhase === 'positive' ? 'negative' : 'positive';
}
</script>

<!--
  Four mdi-loading arcs (each 1/4 circle), all stacked at Q2 (0°) at the start
  of each positive phase and all at Q2 (360°=0°) at the end of each negative phase,
  keeping the loop seamless.

  POSITIVE phase — paints the circle clockwise, one quarter at a time:
    Icon 1: static anchor at Q2 (0°) throughout.
    Icon 2: sweeps 0°→90° in phase 1 (0–0.375s), settling at Q1; holds.
    Icon 3: follows phase 1 to Q1, then continues to Q4 in phase 2 (0.375–0.75s); holds.
    Icon 4: follows phases 1+2, then sweeps to Q3 in phase 3 (0.75–1.125s); holds (1.125–1.5s).
  End state: full circle at (0°, 90°, 180°, 270°).

  NEGATIVE phase — erases the circle clockwise, one quarter at a time:
    Icon 1: leads the erasure, sweeping Q2→Q1→Q4→Q3→Q2 across all four phases.
    Icon 2: holds at Q1 (phase 1), then follows Icon 1 from phase 2 onward.
    Icon 3: holds at Q4 (phases 1–2), joins from phase 3 onward.
    Icon 4: holds at Q3 (phases 1–3); all four converge to Q2 in phase 4.
  End state: all icons reunited at 360°=Q2, ready for the next positive phase.

  onanimationiteration on Icon 4 fires at every 1.5s cycle boundary.
-->
<span class="relative inline-flex shrink-0 {className}">
  <!-- Icon 1: static anchor in positive; leads the erasure in negative -->
  <span
    class="absolute inset-0 {animPhase === 'negative' ? 'arc-1-neg' : ''}"
    style="transform-origin: center; transform: rotate(0deg);"
  >
    <Loading class="h-full w-full" />
  </span>
  <!-- Icon 2 -->
  <span class="absolute inset-0 {animPhase === 'positive' ? 'arc-2-pos' : 'arc-2-neg'}">
    <Loading class="h-full w-full" />
  </span>
  <!-- Icon 3 -->
  <span class="absolute inset-0 {animPhase === 'positive' ? 'arc-3-pos' : 'arc-3-neg'}">
    <Loading class="h-full w-full" />
  </span>
  <!-- Icon 4: last to reach each quadrant; its animationiteration drives cycle boundaries -->
  <span
    class="absolute inset-0 {animPhase === 'positive' ? 'arc-4-pos' : 'arc-4-neg'}"
    onanimationiteration={handleIteration}
  >
    <Loading class="h-full w-full" />
  </span>
</span>

<style>
/* ── Positive phase: paint circle Q2 → Q1 → Q4 → Q3 ──────────────────────────
     25% of 1.5s = 0.375s per quarter-turn phase.
     Each icon sweeps to its landing quadrant and then holds for the remainder.     */

.arc-2-pos,
.arc-3-pos,
.arc-4-pos {
  transform-origin: center;
  will-change: transform;
}
.arc-2-pos {
  animation: paint-arc-2-pos 1.5s linear infinite;
}
.arc-3-pos {
  animation: paint-arc-3-pos 1.5s linear infinite;
}
.arc-4-pos {
  animation: paint-arc-4-pos 1.5s linear infinite;
}

/* Paints Q1 in phase 1, then holds */
@keyframes paint-arc-2-pos {
  0% {
    transform: rotate(0deg);
  }
  25% {
    transform: rotate(90deg);
  }
  100% {
    transform: rotate(90deg);
  }
}
/* Paints Q1 in phase 1, Q4 in phase 2, then holds */
@keyframes paint-arc-3-pos {
  0% {
    transform: rotate(0deg);
  }
  25% {
    transform: rotate(90deg);
  }
  50% {
    transform: rotate(180deg);
  }
  100% {
    transform: rotate(180deg);
  }
}
/* Paints Q1→Q4→Q3 across phases 1–3, then holds (completes the circle) */
@keyframes paint-arc-4-pos {
  0% {
    transform: rotate(0deg);
  }
  25% {
    transform: rotate(90deg);
  }
  50% {
    transform: rotate(180deg);
  }
  75% {
    transform: rotate(270deg);
  }
  100% {
    transform: rotate(270deg);
  }
}

/* ── Negative phase: erase circle Q2 → Q1 → Q4 → Q3 → Q2 ────────────────────
     Starts from the full-circle state (0°, 90°, 180°, 270°) that positive left.
     Each icon holds at its current quadrant until the "sweep wave" reaches it,
     then follows all preceding icons clockwise until all reunite at Q2 (360°=0°).  */

.arc-1-neg,
.arc-2-neg,
.arc-3-neg,
.arc-4-neg {
  transform-origin: center;
  will-change: transform;
}
.arc-1-neg {
  animation: paint-arc-1-neg 1.5s linear infinite;
}
.arc-2-neg {
  animation: paint-arc-2-neg 1.5s linear infinite;
}
.arc-3-neg {
  animation: paint-arc-3-neg 1.5s linear infinite;
}
.arc-4-neg {
  animation: paint-arc-4-neg 1.5s linear infinite;
}

/* Icon 1 leads: erases Q2 immediately, sweeps through every quadrant */
@keyframes paint-arc-1-neg {
  0% {
    transform: rotate(0deg);
  }
  25% {
    transform: rotate(90deg);
  }
  50% {
    transform: rotate(180deg);
  }
  75% {
    transform: rotate(270deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
/* Icon 2 holds at Q1 through phase 1, then follows Icon 1 */
@keyframes paint-arc-2-neg {
  0% {
    transform: rotate(90deg);
  }
  25% {
    transform: rotate(90deg);
  }
  50% {
    transform: rotate(180deg);
  }
  75% {
    transform: rotate(270deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
/* Icon 3 holds at Q4 through phases 1–2, then follows Icons 1+2 */
@keyframes paint-arc-3-neg {
  0% {
    transform: rotate(180deg);
  }
  50% {
    transform: rotate(180deg);
  }
  75% {
    transform: rotate(270deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
/* Icon 4 holds at Q3 through phases 1–3; all four converge to Q2 in phase 4 */
@keyframes paint-arc-4-neg {
  0% {
    transform: rotate(270deg);
  }
  75% {
    transform: rotate(270deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
