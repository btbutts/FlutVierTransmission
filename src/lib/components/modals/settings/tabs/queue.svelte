<!-- src/lib/components/modals/settings/tabs/queue.svelte -->
<script lang="ts">
interface Props {
  tempSettings: Record<string, unknown>;
}

let { tempSettings = $bindable() }: Props = $props();
</script>

<div class="text-ColorPalette-text-secondary">
  <div class="grid grid-cols-2 gap-4">
    <!-- Active Torrents (left column) -->
    <div class="space-y-3">
      <div class="text-ColorPalette-text-secondary mb-3 text-sm font-semibold">Active Torrents</div>
      <!-- Download queue limit -->
      <div class="space-y-2">
        <label class="flex items-center gap-3">
          <input
            type="checkbox"
            checked={Boolean(tempSettings['download-queue-enabled'])}
            onchange={(e) => {
              tempSettings = {
                ...tempSettings,
                'download-queue-enabled': (e.currentTarget as HTMLInputElement).checked
              };
            }}
            class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
          />
          <span class="text-ColorPalette-text-secondary text-sm font-medium"
            >Set torrent download limit</span
          >
        </label>
        {#if tempSettings['download-queue-enabled']}
          <div class="flex items-center gap-2 pr-2 pl-7">
            <label
              for="download-queue-size"
              class="text-ColorPalette-text-secondary flex-1 text-sm font-medium"
              >Max Active Torrents</label
            >
            <input
              id="download-queue-size"
              type="number"
              bind:value={tempSettings['download-queue-size']}
              min="0"
              class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-24 flex-shrink-0 rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
            />
          </div>
        {/if}
      </div>
      <!-- Seed queue limit -->
      <div class="space-y-2">
        <label class="flex items-center gap-3">
          <input
            type="checkbox"
            checked={Boolean(tempSettings['seed-queue-enabled'])}
            onchange={(e) => {
              tempSettings = {
                ...tempSettings,
                'seed-queue-enabled': (e.currentTarget as HTMLInputElement).checked
              };
            }}
            class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
          />
          <span class="text-ColorPalette-text-secondary text-sm font-medium"
            >Set torrent seed limit</span
          >
        </label>
        {#if tempSettings['seed-queue-enabled']}
          <div class="flex items-center gap-2 pr-2 pl-7">
            <label
              for="seed-queue-size"
              class="text-ColorPalette-text-secondary flex-1 text-sm font-medium"
              >Max Active Seeds</label
            >
            <input
              id="seed-queue-size"
              type="number"
              bind:value={tempSettings['seed-queue-size']}
              min="0"
              class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-24 flex-shrink-0 rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
            />
          </div>
        {/if}
      </div>
      <!-- Stalled torrent threshold -->
      <div class="space-y-2">
        <label class="flex items-center gap-3">
          <input
            type="checkbox"
            checked={Boolean(tempSettings['queue-stalled-enabled'])}
            onchange={(e) => {
              tempSettings = {
                ...tempSettings,
                'queue-stalled-enabled': (e.currentTarget as HTMLInputElement).checked
              };
            }}
            class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
          />
          <span class="text-ColorPalette-text-secondary text-sm font-medium"
            >Consider idle queued torrents as stalled</span
          >
        </label>
        {#if tempSettings['queue-stalled-enabled']}
          <div class="flex items-center gap-2 pr-2 pl-7">
            <label
              for="queue-stalled-minutes"
              class="text-ColorPalette-text-secondary flex-1 text-sm leading-snug font-medium"
              >Minutes elapsed before<br />queued torrent is stalled</label
            >
            <input
              id="queue-stalled-minutes"
              type="number"
              bind:value={tempSettings['queue-stalled-minutes']}
              min="0"
              placeholder="60"
              class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-24 flex-shrink-0 rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
            />
          </div>
        {/if}
      </div>
    </div>

    <!-- Seeding Torrents (right column) -->
    <div class="space-y-4">
      <div class="text-ColorPalette-text-secondary mb-3 text-sm font-semibold">
        Seeding Torrents
      </div>
      <!-- Stop at ratio -->
      <div>
        <label class="mb-1 flex items-center gap-3">
          <input
            type="checkbox"
            checked={Boolean(tempSettings['seedRatioLimited'])}
            onchange={(e) => {
              tempSettings = {
                ...tempSettings,
                seedRatioLimited: (e.currentTarget as HTMLInputElement).checked
              };
            }}
            class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
          />
          <span class="text-ColorPalette-text-secondary text-sm font-medium"
            >Stop seeding at ratio...</span
          >
        </label>
        {#if tempSettings['seedRatioLimited']}
          <div class="pl-7">
            <input
              type="number"
              step="0.01"
              min="0"
              bind:value={tempSettings['seedRatioLimit']}
              placeholder="2.0"
              class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-24 rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
            />
          </div>
        {/if}
      </div>
      <!-- Stop if idle -->
      <div>
        <label class="mb-1 flex items-center gap-3">
          <input
            type="checkbox"
            checked={Boolean(tempSettings['idle-seeding-limit-enabled'])}
            onchange={(e) => {
              tempSettings = {
                ...tempSettings,
                'idle-seeding-limit-enabled': (e.currentTarget as HTMLInputElement).checked
              };
            }}
            class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
          />
          <span class="text-ColorPalette-text-secondary text-sm font-medium"
            >Stop seeding if idle for...</span
          >
        </label>
        {#if tempSettings['idle-seeding-limit-enabled']}
          <div class="flex items-center gap-2 pl-7">
            <input
              type="number"
              min="1"
              bind:value={tempSettings['idle-seeding-limit']}
              placeholder="30"
              class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-24 rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
            />
            <span class="text-ColorPalette-text-secondary text-sm">minutes</span>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
