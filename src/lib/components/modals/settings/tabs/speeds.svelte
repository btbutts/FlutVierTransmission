<!-- src/lib/components/modals/settings/tabs/speeds.svelte -->
<script lang="ts">
import TimeDDSelector from '$lib/components/dropdowns/TimeDDSelector.svelte';

interface Props {
  tempSettings: Record<string, unknown>;
  altSpeedFrom: string;
  altSpeedTo: string;
}

let {
  tempSettings = $bindable(),
  altSpeedFrom = $bindable(),
  altSpeedTo = $bindable()
}: Props = $props();

const ALT_SPEED_DAYS = [
  { label: 'Sun', bit: 1 },
  { label: 'Mon', bit: 2 },
  { label: 'Tue', bit: 4 },
  { label: 'Wed', bit: 8 },
  { label: 'Thu', bit: 16 },
  { label: 'Fri', bit: 32 },
  { label: 'Sat', bit: 64 }
];

function isDayEnabled(bit: number): boolean {
  return Boolean(((tempSettings['alt-speed-time-day'] as number) ?? 127) & bit);
}

function toggleDay(bit: number) {
  const current = (tempSettings['alt-speed-time-day'] as number) ?? 127;
  tempSettings = { ...tempSettings, 'alt-speed-time-day': current ^ bit };
}
</script>

<div class="text-ColorPalette-text-secondary space-y-6">
  <!-- Speed Limits -->
  <div>
    <div class="text-ColorPalette-text-secondary mb-3 text-sm font-semibold">Speed Limits</div>
    <div class="grid grid-cols-2 gap-4">
      <!-- Download column -->
      <div class="space-y-2">
        <label class="flex items-center gap-3">
          <input
            type="checkbox"
            checked={Boolean(tempSettings['speed-limit-down-enabled'])}
            onchange={(e) => {
              tempSettings = {
                ...tempSettings,
                'speed-limit-down-enabled': (e.currentTarget as HTMLInputElement).checked
              };
            }}
            class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
          />
          <span class="text-ColorPalette-text-secondary text-sm font-medium"
            >Enable download speed limit</span
          >
        </label>
        {#if tempSettings['speed-limit-down-enabled']}
          <div>
            <label
              for="speed-limit-down"
              class="text-ColorPalette-text-secondary mb-1 block text-sm font-medium"
              >Download (KiB/s)</label
            >
            <input
              id="speed-limit-down"
              type="number"
              bind:value={tempSettings['speed-limit-down']}
              min="0"
              class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-full rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
            />
          </div>
        {/if}
      </div>
      <!-- Upload column -->
      <div class="space-y-2">
        <label class="flex items-center gap-3">
          <input
            type="checkbox"
            checked={Boolean(tempSettings['speed-limit-up-enabled'])}
            onchange={(e) => {
              tempSettings = {
                ...tempSettings,
                'speed-limit-up-enabled': (e.currentTarget as HTMLInputElement).checked
              };
            }}
            class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
          />
          <span class="text-ColorPalette-text-secondary text-sm font-medium"
            >Enable upload speed limit</span
          >
        </label>
        {#if tempSettings['speed-limit-up-enabled']}
          <div>
            <label
              for="speed-limit-up"
              class="text-ColorPalette-text-secondary mb-1 block text-sm font-medium"
              >Upload (KiB/s)</label
            >
            <input
              id="speed-limit-up"
              type="number"
              bind:value={tempSettings['speed-limit-up']}
              min="0"
              class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-full rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
            />
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Alternative Speed Limits -->
  <div>
    <div class="text-ColorPalette-text-secondary mb-3 text-sm font-semibold">
      Alternative Speed Limits
    </div>
    <div class="space-y-3">
      <label class="flex items-center gap-3">
        <input
          type="checkbox"
          checked={Boolean(tempSettings['alt-speed-enabled'])}
          onchange={(e) => {
            tempSettings = {
              ...tempSettings,
              'alt-speed-enabled': (e.currentTarget as HTMLInputElement).checked
            };
          }}
          class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
        />
        <span class="text-ColorPalette-text-secondary text-sm font-medium"
          >Enable alternative speed limits</span
        >
      </label>
      {#if tempSettings['alt-speed-enabled']}
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label
              for="alt-speed-down"
              class="text-ColorPalette-text-secondary mb-1 block text-sm font-medium"
              >Alt Download (KiB/s)</label
            >
            <input
              id="alt-speed-down"
              type="number"
              bind:value={tempSettings['alt-speed-down']}
              min="0"
              class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-full rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
            />
          </div>
          <div>
            <label
              for="alt-speed-up"
              class="text-ColorPalette-text-secondary mb-1 block text-sm font-medium"
              >Alt Upload (KiB/s)</label
            >
            <input
              id="alt-speed-up"
              type="number"
              bind:value={tempSettings['alt-speed-up']}
              min="0"
              class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-full rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
            />
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Schedule -->
  <div>
    <label class="mb-3 flex items-center gap-3">
      <input
        type="checkbox"
        checked={Boolean(tempSettings['alt-speed-time-enabled'])}
        onchange={(e) => {
          tempSettings = {
            ...tempSettings,
            'alt-speed-time-enabled': (e.currentTarget as HTMLInputElement).checked
          };
        }}
        class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
      />
      <span class="text-ColorPalette-text-secondary text-sm font-semibold"
        >Schedule alternative speeds</span
      >
    </label>
    {#if tempSettings['alt-speed-time-enabled']}
      <div class="space-y-4 pl-7">
        <!-- From / To time pickers -->
        <div class="flex items-start gap-6">
          <div>
            <div class="text-ColorPalette-text-secondary mb-1 text-xs font-medium">From</div>
            <TimeDDSelector bind:value={altSpeedFrom} class="w-36" />
          </div>
          <div>
            <div class="text-ColorPalette-text-secondary mb-1 text-xs font-medium">To</div>
            <TimeDDSelector bind:value={altSpeedTo} class="w-36" />
          </div>
        </div>
        <!-- Days of week -->
        <div>
          <div class="text-ColorPalette-text-secondary mb-2 text-xs font-medium">Days</div>
          <div class="flex flex-wrap gap-3">
            {#each ALT_SPEED_DAYS as day (day.bit)}
              <label class="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={isDayEnabled(day.bit)}
                  onchange={() => toggleDay(day.bit)}
                  class="h-3.5 w-3.5 rounded border-gray-300 text-blue-500 focus:ring-blue-500 focus:outline-none"
                />
                <span class="text-ColorPalette-text-secondary text-xs">{day.label}</span>
              </label>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>
