<!-- src/lib/components/RefreshSpinner.svelte
     Reusable mdi-Refresh spinner with a graceful "at least one full revolution"
     guarantee.

     The icon spins with a non-linear easing that mimics physical momentum.
     Once spinning starts, the icon always completes the current revolution before
     stopping — even if the operation that triggered it finishes early.

     A minimum of 1.5 s is enforced before the stop boundary is honoured, so
     very fast operations still produce a visible, intentional animation.

     Usage:
       let spinner: { beginSpin: () => void } | undefined = $state(undefined);
       <RefreshSpinner bind:this={spinner} {loading} />
       spinner?.beginSpin();   // call to start spinning on user action -->
<script lang="ts">
import { Refresh } from '$lib/plugins';

interface Props {
  /** While true, keeps the spinner going indefinitely (stops at next revolution
   *  boundary once this becomes false and the minimum spin time has elapsed). */
  loading?: boolean;
  class?: string;
}

let { loading = false, class: className = '' }: Props = $props();

let isSpinning = $state(false);
let stopAtTurnBoundary = $state(false);
let canStop = $state(false);
let stopDelayTimeout: ReturnType<typeof setTimeout> | null = null;

function clearStopDelayTimeout() {
  if (stopDelayTimeout) {
    clearTimeout(stopDelayTimeout);
    stopDelayTimeout = null;
  }
}

/** Start spinning. Safe to call multiple times — each call resets the minimum
 *  spin timer so the icon is guaranteed at least one more full revolution. */
export function beginSpin() {
  isSpinning = true;
  stopAtTurnBoundary = false;
  canStop = false;
  clearStopDelayTimeout();
  stopDelayTimeout = setTimeout(() => {
    canStop = true;
    stopDelayTimeout = null;
    if (!loading) {
      stopAtTurnBoundary = true;
    }
  }, 1500);
}

$effect(() => {
  if (loading) {
    beginSpin();
    return;
  }
  if (isSpinning && canStop) {
    stopAtTurnBoundary = true;
  }
});

$effect(() => {
  return () => {
    clearStopDelayTimeout();
  };
});

function handleAnimationIteration() {
  if (stopAtTurnBoundary) {
    isSpinning = false;
    stopAtTurnBoundary = false;
  }
}
</script>

<span
  class={`inline-flex h-[1em] w-[1em] shrink-0 text-inherit ${isSpinning ? 'refresh-spin' : ''} ${className}`}
  onanimationiteration={handleAnimationIteration}
>
  <Refresh class="h-full w-full text-inherit" />
</span>

<style>
.refresh-spin {
  animation: refresh-cycle 1.5s linear infinite;
  transform-origin: center;
  will-change: transform;
}

@keyframes refresh-cycle {
  0% {
    transform: rotate(0deg);
  }

  18% {
    transform: rotate(38deg);
  }

  38% {
    transform: rotate(132deg);
  }

  58% {
    transform: rotate(236deg);
  }

  78% {
    transform: rotate(315deg);
  }

  100% {
    transform: rotate(360deg);
  }
}
</style>
