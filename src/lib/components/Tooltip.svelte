<!-- src/lib/components/Tooltip.svelte
     Generic, reusable tooltip rendered at fixed viewport coordinates.
     Styled to match PeersTooltipPortal for visual consistency across the app.
     Pass content via the children snippet; the caller controls text and markup.
     The tooltip auto-sizes to fit its content; maxWidth caps the maximum width so long
     text wraps rather than overflowing. background, border, shadow, and blur are fixed
     here and shared by all instances. -->
<script lang="ts">
import type { Snippet } from 'svelte';
import { fade } from 'svelte/transition';

interface Props {
  /** Controls tooltip visibility — drives the fade in/out transition */
  visible?: boolean;
  /** Viewport x coordinate of the tooltip's left edge (px) */
  x?: number;
  /** Viewport y coordinate of the tooltip's top edge (px) */
  y?: number;
  /** Maximum width (px). The tooltip auto-sizes narrower when content is shorter. */
  maxWidth?: number;
  /** Optional explicit height (px). Omit to let content size the tooltip. */
  height?: number;
  /**
   * Extra Tailwind classes applied to the outer tooltip div.
   * Use this to layer in call-site-specific layout tweaks such as
   * `whitespace-nowrap` (prevent wrapping) without baking those
   * choices into the shared component.
   */
  class?: string;
  /** Tooltip body — any markup, styled by the caller */
  children?: Snippet;
}

let { visible = false, x = 0, y = 0, maxWidth, height, class: extraClass = '', children }: Props = $props();
</script>

{#if visible}
  <div
    role="tooltip"
    class="fixed z-[9999] rounded-xl border border-gray-200/60 bg-white/95 p-3 text-xs shadow-2xl backdrop-blur-md dark:border-gray-700/60 dark:bg-gray-900/95 dark:text-gray-100 {extraClass}"
    style="left: {x}px; top: {y}px;{maxWidth != null ? ` max-width: ${maxWidth}px;` : ''}{height != null ? ` height: ${height}px;` : ''}"
    transition:fade={{ duration: 200 }}
  >
    {@render children?.()}
  </div>
{/if}
