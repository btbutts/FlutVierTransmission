<!-- src/lib/components/TimeDDSelector.svelte -->
<script lang="ts">
import { tick } from 'svelte';

import { Check, TimerEdit } from '$lib/plugins';

interface Props {
  /** Current time in "HH:MM" 24-hour format, two-way bindable */
  value?: string;
  /** Called when a valid time is confirmed */
  onChange?: (time: string) => void;
  /** Optional Tailwind classes for the root div */
  class?: string;
}

let {
  value = $bindable('09:00'),
  onChange = () => {},
  class: classOverride = ''
}: Props = $props();

function parseTime(t: string): { h: number | null; m: number | null } {
  if (!t) return { h: null, m: null };
  const match = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { h: null, m: null };
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return { h: null, m: null };
  return { h, m };
}

const initial = parseTime(value);
let hours = $state<number | null>(initial.h);
let minutes = $state<number | null>(initial.m);
let activeSegment = $state<'hours' | 'minutes' | null>(null);
let partialInput = $state('');

let dropdownOpen = $state(false);
let pendingHours = $state(initial.h ?? 9);
let pendingMinutes = $state(initial.m ?? 0);

// rootRef: outer container — used for outside-click detection.
// inputRef: styled input box — used for dropdown positioning.
let rootRef = $state<HTMLDivElement | null>(null);
let inputRef = $state<HTMLDivElement | null>(null);
let hoursButtonRef = $state<HTMLButtonElement | null>(null);
let minutesButtonRef = $state<HTMLButtonElement | null>(null);
let dropdownRef = $state<HTMLDivElement | null>(null);
let hoursListRef = $state<HTMLDivElement | null>(null);
let minutesListRef = $state<HTMLDivElement | null>(null);
let menuStyle = $state('');

const displayHours = $derived(hours === null ? '--' : String(hours).padStart(2, '0'));
const displayMinutes = $derived(minutes === null ? '--' : String(minutes).padStart(2, '0'));
const isInvalid = $derived(hours === null || minutes === null);

// Show partial digit in the active segment while the user is mid-entry
const hoursText = $derived(
  activeSegment === 'hours' && partialInput ? partialInput.padEnd(2, '_') : displayHours
);
const minutesText = $derived(
  activeSegment === 'minutes' && partialInput ? partialInput.padEnd(2, '_') : displayMinutes
);

// Sync value prop → internal state (skip while actively editing or dropdown is open)
$effect(() => {
  if (partialInput !== '' || dropdownOpen) return;
  const parsed = parseTime(value);
  if (parsed.h !== null && parsed.m !== null) {
    if (hours !== parsed.h) hours = parsed.h;
    if (minutes !== parsed.m) minutes = parsed.m;
  }
});

// Sync internal state → value prop and emit onChange
$effect(() => {
  if (hours !== null && minutes !== null) {
    const newVal = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    if (newVal !== value) {
      value = newVal;
      onChange(newVal);
    }
  }
});

/**
 * Called from onfocus on each segment button.
 * No parameters needed — the button's native focus handles the event.
 */
function selectSegment(segment: 'hours' | 'minutes') {
  activeSegment = segment;
  partialInput = '';
}

/**
 * Keyboard handler attached to each segment <button>.
 * Navigation between segments is done by programmatically focusing the other button,
 * which naturally fires its onfocus → selectSegment call.
 */
function handleSegmentKeydown(e: KeyboardEvent) {
  if (!activeSegment) return;

  if (e.key === 'Backspace') {
    e.preventDefault();
    if (activeSegment === 'hours') hours = null;
    else minutes = null;
    partialInput = '';
    return;
  }

  if ((e.key === ':' || e.key === 'ArrowRight') && activeSegment === 'hours') {
    e.preventDefault();
    minutesButtonRef?.focus(); // onfocus on minutes button → selectSegment('minutes')
    return;
  }

  if (e.key === 'ArrowLeft' && activeSegment === 'minutes') {
    e.preventDefault();
    hoursButtonRef?.focus(); // onfocus on hours button → selectSegment('hours')
    return;
  }

  if (!/^\d$/.test(e.key)) return;
  e.preventDefault();
  const digit = parseInt(e.key, 10);

  if (activeSegment === 'hours') {
    if (partialInput === '') {
      // First digit 3–9: single-digit hour, advance immediately to minutes
      if (digit >= 3) {
        hours = digit;
        partialInput = '';
        minutesButtonRef?.focus();
      } else {
        partialInput = e.key; // 0, 1, 2 — wait for second digit
      }
    } else {
      const combined = parseInt(partialInput + e.key, 10);
      if (combined >= 0 && combined <= 23) {
        hours = combined;
        partialInput = '';
        minutesButtonRef?.focus();
      } else {
        // Invalid combination — restart with the new digit
        if (digit >= 3) {
          hours = digit;
          partialInput = '';
          minutesButtonRef?.focus();
        } else {
          partialInput = e.key;
        }
      }
    }
  } else if (activeSegment === 'minutes') {
    if (partialInput === '') {
      // First digit 6–9: single-digit minutes, complete entry; keep focus here
      if (digit >= 6) {
        minutes = digit;
        partialInput = '';
        // activeSegment stays 'minutes'; user can continue editing
      } else {
        partialInput = e.key;
      }
    } else {
      const combined = parseInt(partialInput + e.key, 10);
      if (combined >= 0 && combined <= 59) {
        minutes = combined;
        partialInput = '';
        // activeSegment stays 'minutes'; user can continue editing
      } else {
        if (digit >= 6) {
          minutes = digit;
          partialInput = '';
        } else {
          partialInput = e.key;
        }
      }
    }
  }
}

function updateMenuPosition() {
  if (!inputRef) return;
  const rect = inputRef.getBoundingClientRect();
  // Top of dropdown aligns with top of input box, same positioning as DDSelector
  menuStyle = `top: ${rect.top}px; left: ${rect.left}px;`;
}

function openDropdown() {
  pendingHours = hours ?? 9;
  pendingMinutes = minutes ?? 0;
  activeSegment = null;
  partialInput = '';
  dropdownOpen = true;
  void tick().then(() => {
    updateMenuPosition();
    scrollToSelected();
    dropdownRef?.focus(); // Focus the listbox so it can receive Enter/Escape
  });
}

function closeDropdown() {
  dropdownOpen = false;
}

function confirmDropdown() {
  hours = pendingHours;
  minutes = pendingMinutes;
  dropdownOpen = false;
}

function scrollToSelected() {
  if (hoursListRef) {
    const item = hoursListRef.children[pendingHours] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'center' });
  }
  if (minutesListRef) {
    const item = minutesListRef.children[pendingMinutes] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'center' });
  }
}

function menuPopUp(node: HTMLElement) {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    }
  };
}

// Outside click → close dropdown
$effect(() => {
  if (!dropdownOpen) return;
  const handler = (e: MouseEvent) => {
    const target = e.target as Node;
    if (!rootRef?.contains(target) && !dropdownRef?.contains(target)) {
      closeDropdown();
    }
  };
  document.addEventListener('click', handler);
  return () => document.removeEventListener('click', handler);
});

// Keep dropdown positioned over trigger
$effect(() => {
  if (!dropdownOpen) return;
  updateMenuPosition();
  const sync = () => updateMenuPosition();
  window.addEventListener('resize', sync);
  window.addEventListener('scroll', sync, true);
  return () => {
    window.removeEventListener('resize', sync);
    window.removeEventListener('scroll', sync, true);
  };
});
</script>

<div bind:this={rootRef} class="relative {classOverride}">
  <!--
    Visual input container — styled to look like a form field.
    It is a pure layout div with no interaction of its own.
    focus-within: utilities provide the ring/border when any child button is focused.
  -->
  <div
    bind:this={inputRef}
    class="border-ColorPalette-border-primary focus-within:border-ColorPalette-input-ring-focus-primary focus-within:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary flex cursor-text items-center rounded-md border p-1.5 text-xs focus-within:ring-2 focus-within:outline-none"
  >
    <button
      type="button"
      bind:this={hoursButtonRef}
      onfocus={() => selectSegment('hours')}
      onkeydown={handleSegmentKeydown}
      class="appearance-none rounded border-0 bg-transparent px-0.5 font-mono transition-colors select-none focus:outline-none
        {activeSegment === 'hours' ? 'bg-blue-500 text-white' : 'text-ColorPalette-text-primary'}"
      aria-label="Hours">{hoursText}</button
    >

    <!-- Static colon separator -->
    <span class="text-ColorPalette-text-tertiary select-none">:</span>

    <!--
      Minutes segment — identical treatment to the hours button above.
    -->
    <button
      type="button"
      bind:this={minutesButtonRef}
      onfocus={() => selectSegment('minutes')}
      onkeydown={handleSegmentKeydown}
      class="appearance-none rounded border-0 bg-transparent px-0.5 font-mono transition-colors select-none focus:outline-none
        {activeSegment === 'minutes' ? 'bg-blue-500 text-white' : 'text-ColorPalette-text-primary'}"
      aria-label="Minutes">{minutesText}</button
    >

    <!-- Spacer pushes icon to the right -->
    <span class="flex-1"></span>

    <!--
      TimerEdit / Check icon — handles both click (mouse) and
      Enter/Space (keyboard) natively.
    -->
    <button
      type="button"
      onclick={() => {
        if (dropdownOpen) confirmDropdown();
        else openDropdown();
      }}
      onkeydown={(e) => {
        if (dropdownOpen && e.key === 'Escape') {
          e.preventDefault();
          closeDropdown();
        }
      }}
      class="text-ColorPalette-text-tertiary hover:text-ColorPalette-text-primary ml-1 rounded p-0.5 transition-colors focus:outline-none"
      aria-label={dropdownOpen ? 'Confirm time selection' : 'Open time picker'}
    >
      {#if dropdownOpen}
        <Check class="h-3.5 w-3.5" />
      {:else}
        <TimerEdit class="h-3.5 w-3.5" />
      {/if}
    </button>
  </div>

  <!-- Invalid time warning — shown whenever either segment is blank -->
  {#if isInvalid}
    <div class="mt-1 text-xs text-amber-500">Enter a valid time (00:00 – 23:59)</div>
  {/if}

  <!-- Dual-column time picker dropdown (portaled to body, same pattern as DDSelector) -->
  {#if dropdownOpen}
    <div
      use:menuPopUp
      bind:this={dropdownRef}
      role="listbox"
      tabindex="-1"
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmDropdown();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeDropdown();
        }
      }}
      class="fixed z-[80] flex overflow-hidden rounded-md border border-gray-300/70 bg-white/95 shadow-2xl backdrop-blur-sm dark:border-gray-700/60 dark:bg-gray-800/90"
      style={menuStyle}
    >
      <!-- Hours column: 00–23 -->
      <div bind:this={hoursListRef} class="max-h-48 w-12 overflow-y-auto py-1">
        {#each Array.from({ length: 24 }, (_, i) => i) as h (h)}
          <button
            type="button"
            onclick={() => {
              pendingHours = h;
            }}
            class="w-full px-2 py-1 text-center text-xs transition-colors hover:bg-gray-100/40 dark:hover:bg-gray-700/30
              {pendingHours === h
              ? 'bg-gray-100/40 font-medium text-blue-600 dark:bg-gray-700/30 dark:text-blue-400'
              : 'text-gray-900 dark:text-gray-100'}">{String(h).padStart(2, '0')}</button
          >
        {/each}
      </div>
      <!-- Column separator -->
      <div class="flex items-center px-1 text-xs font-bold text-gray-400 dark:text-gray-500">:</div>
      <!-- Minutes column: 00–59 -->
      <div bind:this={minutesListRef} class="max-h-48 w-12 overflow-y-auto py-1">
        {#each Array.from({ length: 60 }, (_, i) => i) as m (m)}
          <button
            type="button"
            onclick={() => {
              pendingMinutes = m;
            }}
            class="w-full px-2 py-1 text-center text-xs transition-colors hover:bg-gray-100/40 dark:hover:bg-gray-700/30
              {pendingMinutes === m
              ? 'bg-gray-100/40 font-medium text-blue-600 dark:bg-gray-700/30 dark:text-blue-400'
              : 'text-gray-900 dark:text-gray-100'}">{String(m).padStart(2, '0')}</button
          >
        {/each}
      </div>
    </div>
  {/if}
</div>
