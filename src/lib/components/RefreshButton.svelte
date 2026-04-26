<script lang="ts">
import { Refresh } from '$lib/plugins';

interface Props {
  loading?: boolean;
  buttonClass?: string;
  label?: string;
  onClick?: () => void | Promise<void>;
}

let { loading = false, buttonClass = '', label = 'Refresh', onClick = () => {} }: Props = $props();

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

function beginSpin() {
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

function handleClick() {
  if (!loading) {
    beginSpin();
    void onClick();
  }
}
</script>

<button
  type="button"
  aria-busy={loading}
  aria-label={label}
  onclick={handleClick}
  class={`inline-flex items-center justify-center gap-2 ${buttonClass}`}
>
  <span
    class={`inline-flex h-[1em] w-[1em] shrink-0 text-inherit ${isSpinning ? 'refresh-spin' : ''}`}
    onanimationiteration={handleAnimationIteration}
  >
    <Refresh class="h-full w-full text-inherit" />
  </span>
  <span class="text-inherit">{label}</span>
</button>

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
