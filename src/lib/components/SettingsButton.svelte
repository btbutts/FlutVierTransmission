<!-- src/lib/components/SettingsButton.svelte -->
<script lang="ts">
import { Cog } from '$lib/plugins';

interface SettingsButtonProps {
  /** Called on button click */
  onclick?: () => void;
  /** Optional Tailwind classes to append (e.g., for positioning) */
  class?: string;
}

// prettier-ignore
let {
  onclick = () => {},
  class: classOverride = 'relative'
}: SettingsButtonProps = $props();
</script>

<button
  {onclick}
  class="group {classOverride} inline-flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-md bg-gray-700/90
  p-0 text-white shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-gray-600 focus:ring-2
  focus:ring-blue-500 focus:ring-offset-2 focus:outline-none active:scale-[0.97] active:bg-gray-800
  dark:bg-gray-700/90 dark:hover:bg-gray-600 dark:focus:ring-offset-gray-900 dark:active:bg-gray-800"
  aria-label="Settings"
  title="Settings"
>
  <!-- Larger cog: upper-left diagonal position, clockwise spin on hover -->
  <Cog
    class="gear-cw absolute top-1 left-1.5 h-5 w-5 text-white/70 transition-colors group-hover:text-white"
  />
  <!-- Smaller cog: lower-right diagonal position, counter-clockwise spin on hover -->
  <Cog
    class="gear-ccw absolute right-1 bottom-1.5 h-4 w-4 text-white/80 transition-colors group-hover:text-white"
  />
</button>

<style>
/* Custom spin animations: smooth linear infinite, applied ONLY on :hover */
@keyframes spin-cw {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes spin-ccw {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(-360deg);
  }
}

:global(.gear-cw) {
  transform-origin: center;
  will-change: transform;
}

:global(.gear-ccw) {
  transform-origin: center;
  will-change: transform;
}

/* Animation triggers ONLY while hovering (snaps to 0° on leave; 60° symmetry hides artifacts) */
button:hover :global(.gear-cw) {
  animation: spin-cw 2.5s linear infinite;
}

button:hover :global(.gear-ccw) {
  animation: spin-ccw 2.5s linear infinite;
}
</style>
