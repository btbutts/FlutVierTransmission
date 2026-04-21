<script lang="ts">
import { Check, Loading } from '$lib/plugins';

interface Props {
  saveStatus: 'idle' | 'saving' | 'success' | 'error';
  onclick?: () => void;
}

let { saveStatus, onclick }: Props = $props();

let isSpinning = $state(false);
let animPhase = $state<'positive' | 'negative'>('positive');
let stopAtCycleBoundary = $state(false);
let canStop = $state(false);
let stopDelayTimeout: ReturnType<typeof setTimeout> | null = null;
let displayStatus = $state<'idle' | 'saving' | 'success'>('idle');

function clearStopTimeout() {
  if (stopDelayTimeout) {
    clearTimeout(stopDelayTimeout);
    stopDelayTimeout = null;
  }
}

function beginSaving() {
  isSpinning = true;
  animPhase = 'positive';
  stopAtCycleBoundary = false;
  canStop = false;
  displayStatus = 'saving';
  clearStopTimeout();
  stopDelayTimeout = setTimeout(() => {
    canStop = true;
    stopDelayTimeout = null;
    if (saveStatus !== 'saving') {
      stopAtCycleBoundary = true;
    }
  }, 1500);
}

$effect(() => {
  if (saveStatus === 'saving') {
    beginSaving();
    return;
  }
  if (isSpinning && canStop) {
    stopAtCycleBoundary = true;
  }
});

$effect(() => {
  return () => clearStopTimeout();
});

function handleAnimationIteration() {
  if (stopAtCycleBoundary) {
    isSpinning = false;
    stopAtCycleBoundary = false;
    animPhase = 'positive';
    displayStatus = 'success';
    setTimeout(() => {
      displayStatus = 'idle';
    }, 1000);
    return;
  }
  // Alternate painting and erasing until success arrives
  animPhase = animPhase === 'positive' ? 'negative' : 'positive';
}
</script>

<button
  type="button"
  {onclick}
  disabled={saveStatus === 'saving'}
  class="flex w-36 items-center justify-center gap-2 rounded-md bg-blue-600 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700 disabled:opacity-50"
>
  {#if displayStatus === 'saving'}
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
      animPhase toggles positive↔negative until success is received.
      Stopping is always deferred to the nearest cycle boundary after canStop is true.
    -->
    <span class="relative inline-flex h-[1em] w-[1em] shrink-0">
      <!-- Icon 1: static anchor in positive; leads the erasure in negative -->
      <span
        class="absolute inset-0 {animPhase === 'negative' ? 'save-arc-1-neg' : ''}"
        style="transform-origin: center; transform: rotate(0deg);"
      >
        <Loading class="h-full w-full" />
      </span>
      <!-- Icon 2 -->
      <span
        class="absolute inset-0 {animPhase === 'positive' ? 'save-arc-2-pos' : 'save-arc-2-neg'}"
      >
        <Loading class="h-full w-full" />
      </span>
      <!-- Icon 3 -->
      <span
        class="absolute inset-0 {animPhase === 'positive' ? 'save-arc-3-pos' : 'save-arc-3-neg'}"
      >
        <Loading class="h-full w-full" />
      </span>
      <!-- Icon 4: last to reach each quadrant; its animationiteration drives cycle boundaries -->
      <span
        class="absolute inset-0 {animPhase === 'positive' ? 'save-arc-4-pos' : 'save-arc-4-neg'}"
        onanimationiteration={handleAnimationIteration}
      >
        <Loading class="h-full w-full" />
      </span>
    </span>
    <span>Saving</span>
  {:else if displayStatus === 'success'}
    <Check class="h-[1em] w-[1em] shrink-0" />
    <span>Saved</span>
  {:else}
    <span>Save Changes</span>
  {/if}
</button>

<style>
/* ── Positive phase: paint circle Q2 → Q1 → Q4 → Q3 ──────────────────────────
     25% of 1.5s = 0.375s per quarter-turn phase.
     Each icon sweeps to its landing quadrant and then holds for the remainder.     */

.save-arc-2-pos,
.save-arc-3-pos,
.save-arc-4-pos {
  transform-origin: center;
  will-change: transform;
}
.save-arc-2-pos {
  animation: paint-arc-2-pos 1.5s linear infinite;
}
.save-arc-3-pos {
  animation: paint-arc-3-pos 1.5s linear infinite;
}
.save-arc-4-pos {
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

.save-arc-1-neg,
.save-arc-2-neg,
.save-arc-3-neg,
.save-arc-4-neg {
  transform-origin: center;
  will-change: transform;
}
.save-arc-1-neg {
  animation: paint-arc-1-neg 1.5s linear infinite;
}
.save-arc-2-neg {
  animation: paint-arc-2-neg 1.5s linear infinite;
}
.save-arc-3-neg {
  animation: paint-arc-3-neg 1.5s linear infinite;
}
.save-arc-4-neg {
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
