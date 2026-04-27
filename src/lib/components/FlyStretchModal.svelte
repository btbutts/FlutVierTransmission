<!-- src/lib/components/FlyStretchModal.svelte
     Generic fly-out / stretch-in open animation wrapper for pop-up modals.

     Usage:
       <FlyStretchModal
         bind:open={isOpen}
         getTriggerRect={() => triggerEl?.getBoundingClientRect() ?? null}
         maxWidth={700}
         maxHeight={440}
         ariaLabel="My modal"
       >
         {#snippet children(phase, close, panelHeight)}
-->
<!-- eslint-disable-next-line indent, svelte/indent
           <---- your modal content here ->
           <-- use phase === 'open' to gate expensive renders ->
           <-- call close() from your close button ->
         {/snippet}
       </FlyStretchModal>
-->

<script lang="ts">
import { onMount, type Snippet } from 'svelte';

import { windowPopUp } from '$lib/helpers';

type Phase = 'closed' | 'opening' | 'open' | 'closing';

interface Props {
  /** Controls modal visibility — bindable so parent can open/close */
  open?: boolean;
  /**
   * Called at open time and close time to get the source/return DOMRect for the
   * fly animation. Return null to skip the fly effect (modal opens from center).
   */
  getTriggerRect: () => DOMRect | null;
  /** Maximum modal width in px (clamped to viewport - 32). Default: 700 */
  maxWidth?: number;
  /** Maximum modal height in px (clamped to viewport - 32). Default: 440 */
  maxHeight?: number;
  /** Duration of the open/close animation in ms. Default: 420 */
  animMs?: number;
  /** aria-label applied to the dialog element */
  ariaLabel?: string;
  /** Called after the close animation completes. Use for post-close cleanup in the parent. */
  onClosed?: () => void;
  /**
   * Modal content snippet. Receives:
   *   phase       — current animation phase; gate expensive renders behind `phase === 'open'`
   *   close       — call this from your close button to trigger the animated close sequence
   *   panelHeight — live animated panel height in px; useful for sizing inner content
   */
  children: Snippet<[phase: Phase, close: () => void, panelHeight: number]>;
}

let {
  open = $bindable(false),
  getTriggerRect,
  maxWidth = 700,
  maxHeight = 440,
  animMs = 420,
  ariaLabel = 'Modal dialog',
  onClosed,
  children
}: Props = $props();

let phase = $state<Phase>('closed');
let showPortal = $state(false);
let pX = $state(0);
let pY = $state(0);
let pW = $state(0);
let pH = $state(0);
// When true, panel transitions are suppressed for one frame (used during viewport resize).
let noTransition = $state(false);

// Watch the open prop: run the open animation when parent sets open = true,
// and run the close animation if the parent sets open = false while the modal is visible.
$effect(() => {
  if (open && phase === 'closed') {
    runOpen();
  } else if (!open && (phase === 'open' || phase === 'opening')) {
    runClose();
  }
});

async function runOpen() {
  const rect = getTriggerRect();
  if (rect) {
    pX = rect.left;
    pY = rect.top;
    pW = rect.width;
    pH = rect.height;
  } else {
    // No trigger rect — start from the final centered position at near-zero size.
    const mw = Math.min(maxWidth, window.innerWidth - 32);
    const mh = Math.min(maxHeight, window.innerHeight - 32);
    pX = (window.innerWidth - mw) / 2;
    pY = (window.innerHeight - mh) / 2;
    pW = 0;
    pH = 0;
  }
  showPortal = true;
  // Double rAF: first flush lets Svelte commit the DOM insertion; second ensures
  // the browser has painted at the start position before we update to the end
  // position, so the CSS transition fires correctly from start to end.
  await new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())));
  const mw = Math.min(maxWidth, window.innerWidth - 32);
  const mh = Math.min(maxHeight, window.innerHeight - 32);
  pX = (window.innerWidth - mw) / 2;
  pY = (window.innerHeight - mh) / 2;
  pW = mw;
  pH = mh;
  phase = 'opening';
  setTimeout(() => {
    phase = 'open';
  }, animMs);
}

function runClose() {
  if (phase === 'closing' || phase === 'closed') return;
  phase = 'closing';
  const rect = getTriggerRect();
  if (rect) {
    pX = rect.left;
    pY = rect.top;
    pW = rect.width;
    pH = rect.height;
  }
  setTimeout(() => {
    showPortal = false;
    phase = 'closed';
    open = false;
    onClosed?.();
  }, animMs);
}

// Keeps the modal centered and correctly sized as the viewport changes.
// Transitions are suppressed for the resize frame so the modal tracks instantly.
function handleResize() {
  if (phase !== 'open') return;
  noTransition = true;
  const mw = Math.min(maxWidth, window.innerWidth - 32);
  const mh = Math.min(maxHeight, window.innerHeight - 32);
  pX = (window.innerWidth - mw) / 2;
  pY = (window.innerHeight - mh) / 2;
  pW = mw;
  pH = mh;
  // Restore transitions after one paint so open/close animations still work.
  requestAnimationFrame(() => {
    noTransition = false;
  });
}

onMount(() => {
  window.addEventListener('resize', handleResize);
  return () => {
    window.removeEventListener('resize', handleResize);
  };
});
</script>

{#if showPortal}
  <!-- Outer div is the click-outside target. The inner overlay div has pointer-events:none
       so backdrop clicks pass through it and land on this element, making
       e.target === e.currentTarget true and correctly triggering runClose(). -->
  <div
    use:windowPopUp
    role="dialog"
    aria-modal="true"
    aria-label={ariaLabel}
    tabindex="-1"
    style="position: fixed; inset: 0; z-index: 9999; pointer-events: {phase === 'open'
      ? 'all'
      : 'none'};"
    onclick={(e) => {
      if (e.target === e.currentTarget) runClose();
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') runClose();
    }}
  >
    <!-- Visual overlay: pointer-events:none so it never intercepts clicks.
         Fades in when phase reaches 'opening' (same frame the panel starts moving),
         so the dark backdrop appears immediately with the panel, not after it. -->
    <div
      class="absolute inset-0 bg-black/50"
      style="
        pointer-events: none;
        opacity: {phase === 'opening' || phase === 'open' ? 1 : 0};
        transition: opacity {animMs}ms;
      "
    ></div>

    <!-- Animated panel: CSS-transitioned from the trigger element rect to the centered final rect. -->
    <div
      class="bg-ColorPalette-bg-secondary/95 overflow-hidden rounded-3xl shadow-[0_0_0_1px_rgba(0,0,0,0.15),0_0_40px_16px_rgba(0,0,0,0.65),0_0_120px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl"
      style="
        position: fixed;
        left: {pX}px; top: {pY}px;
        width: {pW}px; height: {pH}px;
        opacity: {phase === 'open' || phase === 'opening' ? 1 : 0};
        transition: {noTransition
        ? 'none'
        : `left ${animMs}ms cubic-bezier(0.4,0,0.2,1), top ${animMs}ms cubic-bezier(0.4,0,0.2,1), width ${animMs}ms cubic-bezier(0.4,0,0.2,1), height ${animMs}ms cubic-bezier(0.4,0,0.2,1), opacity ${animMs}ms`};
      "
    >
      {@render children(phase, runClose, pH)}
    </div>
  </div>
{/if}
