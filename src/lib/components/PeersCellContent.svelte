<script module lang="ts">
// Module-level singleton — shared across ALL PeersCellContent instances.
// Tracks which column mode (seeders | leechers) was most recently activated
// by a successful button hover, so that same-column row navigation can skip
// the 1200ms delay.

let _recentMode: 'seeders' | 'leechers' | null = null;
let _recentModeTimer: ReturnType<typeof setTimeout> | null = null;

/** Mark a mode as recently activated (user hovered the info button). */
function setRecentMode(mode: 'seeders' | 'leechers') {
  _recentMode = mode;
  if (_recentModeTimer) {
    clearTimeout(_recentModeTimer);
    _recentModeTimer = null;
  }
}

/**
 * Start a 400 ms grace window after the cursor leaves the group.
 * If the cursor enters a same-mode row within that window, the timer is
 * cancelled in handleTextEnter and the delay is still skipped.
 */
function scheduleRecentModeClear() {
  if (_recentModeTimer) clearTimeout(_recentModeTimer);
  _recentModeTimer = setTimeout(() => {
    _recentMode = null;
    _recentModeTimer = null;
  }, 400);
}
</script>

<script lang="ts">
import { onDestroy } from 'svelte';
import { get } from 'svelte/store';
import {
  cancelHidePeersTooltip,
  hidePeersTooltip,
  peersTooltipStore,
  showPeersTooltip
} from '$lib';

import { InformationVariantCircleOutline } from '$lib/plugins';
import type { TrackerStat } from '$lib/types';

interface Props {
  torrentId: number;
  activePeerCount: number;
  maxPeerCount: number;
  trackerStats: TrackerStat[];
  mode: 'seeders' | 'leechers';
}

let { torrentId, activePeerCount, maxPeerCount, trackerStats, mode }: Props = $props();

let iconEl = $state<HTMLButtonElement | null>(null);

// Drives the CSS opacity transition (false = 0, true = 1).
// The button is ALWAYS in the DOM so the text span never shifts position.
let buttonOpacity = $state(false);
// Separately controls pointer-events so hover is disabled immediately on
// fade-out, even while the opacity animation is still running.
let buttonInteractive = $state(false);
// True while the cursor is anywhere inside the group wrapper.
let groupHovered = $state(false);

let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function cancelShowTimer() {
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }
}

function cancelHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

/** Start the 500 ms opacity-in transition and enable pointer interaction. */
function fadeIn() {
  requestAnimationFrame(() => {
    buttonOpacity = true;
    buttonInteractive = true;
  });
}

/**
 * Disable pointer interaction immediately (so a partially-faded button cannot
 * be accidentally hovered) and start the 500 ms opacity-out transition.
 */
function fadeOut() {
  buttonInteractive = false;
  buttonOpacity = false;
}

/**
 * Short delay before hiding — gives the cursor time to travel from the group
 * div to the tooltip portal without the button disappearing mid-travel.
 */
function startHideDelay() {
  cancelHideTimer();
  hideTimer = setTimeout(() => {
    hideTimer = null;
    const state = get(peersTooltipStore);
    const isOurs = state?.torrentId === torrentId && state?.mode === mode;
    if (!isOurs) fadeOut();
  }, 200);
}

// ── Group (wrapper) handler — fast-path ONLY ────────────────────────────────
// Fires whenever the cursor enters the group div from outside, including the
// invisible button area to the left of the text. It ONLY handles the
// skip-delay case (_recentMode === mode). It does NOT start the 1200ms timer
// — that responsibility stays exclusively with handleTextEnter.

function handleGroupEnter() {
  groupHovered = true;
  cancelHideTimer();

  if (_recentMode === mode) {
    // Same column as recently activated — cancel any pending clear and skip the delay.
    if (_recentModeTimer) { clearTimeout(_recentModeTimer); _recentModeTimer = null; }
    if (!buttonOpacity) fadeIn();
  }
  // If not recently activated, do nothing — handleTextEnter handles the delay.
}

// ── Text span handler — the ONLY entry point for the 1200ms show timer ──────
// Also handles the fast-path for completeness (cursor may enter directly on
// the text without passing through the group div's onmouseenter).

function handleTextEnter() {
  groupHovered = true;
  cancelHideTimer();

  if (_recentMode !== null && _recentMode !== mode) {
    // Switching columns — reset the recent-mode so the other column starts fresh.
    _recentMode = null;
    if (_recentModeTimer) {
      clearTimeout(_recentModeTimer);
      _recentModeTimer = null;
    }
  }

  if (_recentMode === mode) {
    // Same column as recently activated — cancel any pending clear and skip the delay.
    if (_recentModeTimer) {
      clearTimeout(_recentModeTimer);
      _recentModeTimer = null;
    }
    if (!buttonOpacity) fadeIn();
    return;
  }

  // Normal case: start the 1200ms delay if button isn't already visible.
  if (!buttonOpacity && !showTimer) {
    showTimer = setTimeout(() => {
      showTimer = null;
      fadeIn();
    }, 1200);
  }
}

function handleGroupLeave() {
  groupHovered = false;
  cancelShowTimer();
  scheduleRecentModeClear();
  if (buttonOpacity) startHideDelay();
}

// ── Button handlers — manage only the tooltip ────────────────────────────────

function handleButtonEnter() {
  // Mark this mode as recently activated so same-column row moves skip the delay.
  setRecentMode(mode);
  groupHovered = true;
  cancelHidePeersTooltip();
  if (!iconEl) return;
  const rect = iconEl.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const above = spaceBelow < 280 && rect.top > 280;
  showPeersTooltip({
    torrentId,
    activePeerCount,
    maxPeerCount,
    trackerStats,
    mode,
    x: rect.left,
    y: above ? rect.top - 8 : rect.bottom + 8,
    above
  });
}

function handleButtonLeave() {
  hidePeersTooltip();
}

// If an external event closes the tooltip (e.g. another row's tooltip opens),
// fade out the button — but only once the cursor has left this group.
$effect(() => {
  const state = $peersTooltipStore;
  const isOurs = state?.torrentId === torrentId && state?.mode === mode;
  if (!isOurs && buttonOpacity && !groupHovered) {
    startHideDelay();
  }
});

onDestroy(() => {
  cancelShowTimer();
  cancelHideTimer();
});
</script>

<!--
  role="group" satisfies the a11y requirement for a div with mouse-event
  handlers and semantically describes the icon + count pair.

  The button is ALWAYS in the DOM (never conditionally rendered) so the
  text span's position is invariant — the icon fading in/out never causes
  the numbers to shift.

  The group div's onmouseenter handles the fast-path skip (no delay) when
  _recentMode === mode — this fires even when the cursor enters over the
  invisible button area, enabling straight up/down row navigation.
  The 1200ms delay is started exclusively by onmouseenter on the text span.

  The text span uses role="img" with an aria-label to satisfy the a11y
  requirement for an element with mouse-event handlers that has no native
  interactive role.
-->
<div
  role="group"
  aria-label={mode === 'seeders' ? 'Seeder peer count' : 'Leecher peer count'}
  class="inline-flex w-[5.5rem] items-center gap-1.5"
  onmouseenter={handleGroupEnter}
  onmouseleave={handleGroupLeave}
>
  <button
    bind:this={iconEl}
    type="button"
    class="inline-flex shrink-0 cursor-default items-center text-current hover:text-blue-500"
    style="opacity: {buttonOpacity ? 1 : 0}; pointer-events: {buttonInteractive
      ? 'auto'
      : 'none'}; transition: opacity 500ms ease, color 150ms ease;"
    tabindex={buttonInteractive ? 0 : -1}
    aria-hidden={!buttonInteractive}
    aria-label={mode === 'seeders' ? 'Seeder details' : 'Leecher details'}
    onmouseenter={handleButtonEnter}
    onmouseleave={handleButtonLeave}
    onfocus={handleButtonEnter}
    onblur={handleButtonLeave}
  >
    <InformationVariantCircleOutline class="h-[1.5em] w-[1.5em]" />
  </button>

  <span
    role="img"
    aria-label={mode === 'seeders'
      ? `${activePeerCount} active seeders of ${maxPeerCount >= 0 ? maxPeerCount : 'unknown'} total`
      : `${activePeerCount} active leechers of ${maxPeerCount >= 0 ? maxPeerCount : 'unknown'} total`}
    class="whitespace-nowrap tabular-nums"
    onmouseenter={handleTextEnter}
  >
    {activePeerCount}&nbsp;:&nbsp;{maxPeerCount >= 0 ? maxPeerCount : '—'}
  </span>
</div>
