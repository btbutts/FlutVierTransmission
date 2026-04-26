<script lang="ts">
import { Check } from '$lib/plugins';

import LoadingArcSpinner from './LoadingArcSpinner.svelte';

interface Props {
  saveStatus: 'idle' | 'saving' | 'success' | 'error';
  onclick?: () => void;
}

let { saveStatus, onclick }: Props = $props();

let isSpinning = $state(false);
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

// Called by LoadingArcSpinner at the next 1.5s cycle
// boundary when stopAtCycleBoundary is true.
function handleSpinnerStopped() {
  isSpinning = false;
  stopAtCycleBoundary = false;
  displayStatus = 'success';
  setTimeout(() => {
    displayStatus = 'idle';
  }, 1000);
}
</script>

<button
  type="button"
  {onclick}
  disabled={saveStatus === 'saving'}
  class="flex w-36 items-center justify-center gap-2 rounded-md bg-blue-600 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700 disabled:opacity-50"
>
  {#if displayStatus === 'saving'}
    <LoadingArcSpinner
      class="h-[1em] w-[1em]"
      stopAtBoundary={stopAtCycleBoundary}
      onStopped={handleSpinnerStopped}
    />
    <span>Saving</span>
  {:else if displayStatus === 'success'}
    <Check class="h-[1em] w-[1em] shrink-0" />
    <span>Saved</span>
  {:else}
    <span>Save Changes</span>
  {/if}
</button>
