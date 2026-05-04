<script lang="ts">
import RefreshSpinner from './RefreshSpinner.svelte';

interface Props {
  loading?: boolean;
  buttonClass?: string;
  label?: string;
  onClick?: () => void | Promise<void>;
}

let { loading = false, buttonClass = '', label = 'Refresh', onClick = () => {} }: Props = $props();

let spinner: { beginSpin: () => void } | undefined = $state(undefined);

function handleClick() {
  if (!loading) {
    spinner?.beginSpin();
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
  <RefreshSpinner bind:this={spinner} {loading} />
  <span class="text-inherit">{label}</span>
</button>
