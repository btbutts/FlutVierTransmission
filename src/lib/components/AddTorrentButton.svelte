<!-- src/lib/components/AddTorrentButton.svelte -->
<script lang="ts">
import { Plus } from '$lib/plugins';

interface Props {
  /** Click handler — called without the MouseEvent for ergonomic usage */
  onclick?: () => unknown;
  /** Disables the button when true */
  disabled?: boolean;
  /** Button label text (e.g. 'Add Torrent' or 'Add Torrents') */
  label?: string;
  /**
   * Tailwind classes applied to the <button> element.
   * Pass all sizing, layout, colour, and spacing classes from the call site
   * so this single component covers every usage (toolbar, master modal, child modal).
   * See DDSelector for the same class-passthrough pattern.
   */
  class?: string;
  /** Bindable ref to the underlying button element — use to get its DOMRect for animations */
  ref?: HTMLButtonElement | null;
}

let {
  onclick = () => {},
  disabled = false,
  label = 'Add Torrent',
  class: classOverride = '',
  ref = $bindable<HTMLButtonElement | null>(null)
}: Props = $props();
</script>

<button type="button" bind:this={ref} onclick={() => onclick()} {disabled} class={classOverride}>
  <Plus class="h-[1em] w-[1em] shrink-0" />
  <span>{label}</span>
</button>
