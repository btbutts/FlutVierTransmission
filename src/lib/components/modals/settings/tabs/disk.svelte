<!-- src/lib/components/modals/settings/tabs/disk.svelte -->
<script lang="ts">
interface Props {
  tempSettings: Record<string, unknown>;
}

let { tempSettings = $bindable() }: Props = $props();
</script>

<div class="text-ColorPalette-text-secondary">
  <label class="flex items-center gap-3">
    <span class="text-ColorPalette-text-secondary text-sm font-medium">Disk Cache (MiB)</span>
    <input
      type="number"
      bind:value={tempSettings['cache-size-mb']}
      class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-24 rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
    />
  </label>
</div>
