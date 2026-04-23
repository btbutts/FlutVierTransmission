<!-- src/lib/components/TimeDDSelector.svelte -->
<script lang="ts">
import { tick, untrack } from 'svelte';

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

// rootRef: outer wrapper — used for outside-click detection and onblur checks.
// inputRef: styled input box — used for dropdown positioning.
let rootRef = $state<HTMLDivElement | null>(null);
let inputRef = $state<HTMLLabelElement | null>(null);
let hoursButtonRef = $state<HTMLButtonElement | null>(null);
let minutesButtonRef = $state<HTMLButtonElement | null>(null);
let dropdownRef = $state<HTMLDivElement | null>(null);
let hoursListRef = $state<HTMLDivElement | null>(null);
let minutesListRef = $state<HTMLDivElement | null>(null);
let menuStyle = $state('');

const displayHours = $derived(hours === null ? '--' : String(hours).padStart(2, '0'));
const displayMinutes = $derived(minutes === null ? '--' : String(minutes).padStart(2, '0'));
const isInvalid = $derived(hours === null || minutes === null);

// While the user is mid-entry, show the partial digit with a trailing placeholder
const hoursText = $derived(
  activeSegment === 'hours' && partialInput ? partialInput.padEnd(2, '_') : displayHours
);
const minutesText = $derived(
  activeSegment === 'minutes' && partialInput ? partialInput.padEnd(2, '_') : displayMinutes
);

// ── Sync: internal state → value prop ────────────────────────────────────────
// Tracked deps: hours, minutes, partialInput
// value is read with untrack so a parent writing value does NOT re-trigger this,
// preventing the circular-reversion bug.
$effect(() => {
  const h = hours;
  const m = minutes;
  const pi = partialInput;
  if (h !== null && m !== null && !pi) {
    const newVal = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (newVal !== untrack(() => value)) {
      value = newVal;
      onChange(newVal);
    }
  }
});

// ── Sync: value prop → internal state ────────────────────────────────────────
// Tracked deps: value only — everything else is untracked so hours/minutes
// writes from the internal-→-external effect above cannot cause a re-run loop.
$effect(() => {
  const externalVal = value; // tracked
  untrack(() => {
    // Skip while the user is actively editing or the dropdown is open
    if (partialInput !== '' || dropdownOpen) return;
    // Skip if the incoming value is already what we would compute (our own write)
    const computed =
      hours !== null && minutes !== null
        ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
        : null;
    if (externalVal === computed) return;
    // Genuine external change — sync internal state
    const parsed = parseTime(externalVal);
    if (parsed.h !== null && parsed.m !== null) {
      hours = parsed.h;
      minutes = parsed.m;
    }
  });
});

// ── Segment focus / blur ──────────────────────────────────────────────────────

function selectSegment(segment: 'hours' | 'minutes') {
  activeSegment = segment;
  partialInput = '';
}

/**
 * Clear the active segment only when focus truly leaves the component
 * (not when it moves between internal buttons or into the portaled dropdown).
 */
function handleSegmentBlur(e: FocusEvent) {
  const next = e.relatedTarget as HTMLElement | null;
  if (!rootRef?.contains(next) && !dropdownRef?.contains(next)) {
    activeSegment = null;
    partialInput = '';
  }
}

// ── Keyboard handler for the segment buttons ──────────────────────────────────
function handleSegmentKeydown(e: KeyboardEvent) {
  if (!activeSegment) return;

  if (e.key === 'Backspace') {
    e.preventDefault();
    if (activeSegment === 'hours') hours = null;
    else minutes = null;
    partialInput = '';
    return;
  }

  // ArrowRight or colon → advance to minutes
  if ((e.key === ':' || e.key === 'ArrowRight') && activeSegment === 'hours') {
    e.preventDefault();
    minutesButtonRef?.focus(); // onfocus → selectSegment('minutes')
    return;
  }

  // ArrowLeft → retreat to hours
  if (e.key === 'ArrowLeft' && activeSegment === 'minutes') {
    e.preventDefault();
    hoursButtonRef?.focus(); // onfocus → selectSegment('hours')
    return;
  }

  if (!/^\d$/.test(e.key)) return;
  e.preventDefault();
  const digit = parseInt(e.key, 10);

  if (activeSegment === 'hours') {
    if (partialInput === '') {
      // First digit 3–9: valid as a single-digit hour; advance to minutes
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
        // Invalid combo — restart with the new digit
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
      // First digit 6–9: valid as a single-digit minute; stay on minutes
      if (digit >= 6) {
        minutes = digit;
        partialInput = '';
        // Keep activeSegment = 'minutes' so the user can continue editing
      } else {
        partialInput = e.key;
      }
    } else {
      const combined = parseInt(partialInput + e.key, 10);
      if (combined >= 0 && combined <= 59) {
        minutes = combined;
        partialInput = '';
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

// ── Dropdown ──────────────────────────────────────────────────────────────────
function updateMenuPosition() {
  if (!inputRef) return;
  const rect = inputRef.getBoundingClientRect();
  // Top of dropdown aligns with top of input box — same as DDSelector
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
    dropdownRef?.focus(); // Focus the listbox so it receives Enter/Escape
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

// Keep dropdown positioned over trigger on resize/scroll
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
    Visual input container — pure layout div, no interaction of its own.
    focus-within: utilities show the ring/border whenever any child button is focused,
    matching the appearance of the other form inputs throughout the settings modal.
  -->
  <!--
    label (no `for`) wraps all children. Clicking anywhere in the box that isn't
    an interactive descendant (minutes button, timer icon) forwards the click to
    the first labelable descendant — the hours button — giving "click anywhere to
    focus hours" for free via HTML semantics. No JS needed, no a11y issues.
  -->
  <label
    bind:this={inputRef}
    class="border-ColorPalette-border-primary focus-within:border-ColorPalette-input-ring-focus-primary focus-within:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary flex cursor-text items-center rounded-md border p-1.5 text-xs focus-within:ring-2 focus-within:outline-none"
  >
    <!--
      Hours segment — a native <button> so focus, keyboard, and a11y all work
      without any overrides. onfocus drives selectSegment (works for both click
      and Tab). onclick is an additional guard for the case where the button is
      already focused (click does not re-fire onfocus in that case).
    -->
    <button
      type="button"
      bind:this={hoursButtonRef}
      onfocus={() => selectSegment('hours')}
      onclick={() => selectSegment('hours')}
      onblur={handleSegmentBlur}
      onkeydown={handleSegmentKeydown}
      class="appearance-none rounded border-0 px-0.5 font-mono select-none focus:outline-none
        {activeSegment === 'hours'
        ? 'bg-blue-500 text-white'
        : 'text-ColorPalette-text-primary bg-transparent'}"
      aria-label="Hours">{hoursText}</button
    >

    <!-- Static colon separator — never interactive (inside label: clicking it forwards to hours) -->
    <span class="text-ColorPalette-text-tertiary select-none">:</span>

    <!-- Minutes segment — identical treatment to hours button above -->
    <button
      type="button"
      bind:this={minutesButtonRef}
      onfocus={() => selectSegment('minutes')}
      onclick={() => selectSegment('minutes')}
      onblur={handleSegmentBlur}
      onkeydown={handleSegmentKeydown}
      class="appearance-none rounded border-0 px-0.5 font-mono select-none focus:outline-none
        {activeSegment === 'minutes'
        ? 'bg-blue-500 text-white'
        : 'text-ColorPalette-text-primary bg-transparent'}"
      aria-label="Minutes">{minutesText}</button
    >

    <!-- Spacer — clicking it (inside label) forwards to hours button -->
    <span class="flex-1"></span>

    <!--
      TimerEdit / Check icon button. onclick handles both mouse-click and
      Enter/Space keyboard activation natively. onkeydown adds Escape support.
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
  </label>

  <!-- Invalid time warning — shown while either segment is blank -->
  {#if isInvalid}
    <div class="mt-1 text-xs text-amber-500">Enter a valid time (00:00 – 23:59)</div>
  {/if}

  <!-- Dual-column dropdown (portaled to body, same pattern as DDSelector) -->
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
      class="border-ColorPalette-border-tertiary/60 bg-ColorPalette-bg-secondary/70 fixed z-[80] flex rounded-md border shadow-2xl backdrop-blur-sm"
      style={menuStyle}
    >
      <!-- Hours column: 00–23 -->
      <div bind:this={hoursListRef} class="max-h-48 w-12 overflow-y-auto bg-transparent py-1">
        {#each Array.from({ length: 24 }, (_, i) => i) as h (h)}
          <button
            type="button"
            onclick={() => {
              pendingHours = h;
            }}
            class="hover:bg-ColorPalette-bg-tertiary/40 w-full px-2 py-1 text-center text-xs transition-colors
              {pendingHours === h
              ? 'bg-ColorPalette-bg-tertiary/40 font-medium text-blue-600 dark:text-blue-400'
              : 'text-ColorPalette-text-primary bg-transparent'}"
            >{String(h).padStart(2, '0')}</button
          >
        {/each}
      </div>
      <!-- Column separator -->
      <div
        class="flex items-center bg-transparent px-1 text-xs font-bold text-gray-400 dark:text-gray-500"
      >
        :
      </div>
      <!-- Minutes column: 00–59 -->
      <div bind:this={minutesListRef} class="max-h-48 w-12 overflow-y-auto bg-transparent py-1">
        {#each Array.from({ length: 60 }, (_, i) => i) as m (m)}
          <button
            type="button"
            onclick={() => {
              pendingMinutes = m;
            }}
            class="hover:bg-ColorPalette-bg-tertiary/40 w-full px-2 py-1 text-center text-xs transition-colors
              {pendingMinutes === m
              ? 'bg-ColorPalette-bg-tertiary/40 font-medium text-blue-600 dark:text-blue-400'
              : 'text-ColorPalette-text-primary bg-transparent'}"
            >{String(m).padStart(2, '0')}</button
          >
        {/each}
      </div>
    </div>
  {/if}
</div>
