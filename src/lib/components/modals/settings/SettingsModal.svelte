<!-- src/lib/components/modals/settings/SettingsModal.svelte -->
<script lang="ts">
import { onMount } from 'svelte';
import { browser } from '$app/environment';
import { refreshSession, session, updateSession } from '$lib';

import FlyStretchAnimationWrapper from '$lib/components/animations/FlyStretchAnimWrapper.svelte';
import SaveButton from '$lib/components/buttons/SaveButton.svelte';
import { Close } from '$lib/plugins';

import DiskTab from './tabs/disk.svelte';
import GeneralTab from './tabs/general.svelte';
import PortsTab from './tabs/ports.svelte';
import QueueTab from './tabs/queue.svelte';
import RemoteTab from './tabs/remote.svelte';
import SpeedsTab from './tabs/speeds.svelte';
import UiTab from './tabs/ui.svelte';

interface Props {
  /** Controls modal visibility — bindable so parent can open/close */
  open?: boolean;
  /** Called at open time and close time to get the source/return rect for the fly animation. */
  getTriggerRect?: () => DOMRect | null;
}

let { open = $bindable(false), getTriggerRect = () => null }: Props = $props();

// ── Settings modal state ──────────────────────────────────────────────────────
type SettingsTab = 'general' | 'speeds' | 'queue' | 'ports' | 'remote' | 'disk' | 'ui';
let tempSettings = $state<Record<string, unknown>>({});
let activeTab = $state<SettingsTab>('general');
let saveStatus = $state<'idle' | 'saving' | 'success' | 'error'>('idle');
const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'speeds', label: 'Speeds' },
  { id: 'queue', label: 'Queue' },
  { id: 'ports', label: 'Ports' },
  { id: 'remote', label: 'Remote' },
  { id: 'disk', label: 'Disk' },
  { id: 'ui', label: 'UI' }
];

// ── Theme ─────────────────────────────────────────────────────────────────────
const themePreferenceKey = 'flutvierThemeMode';
let themePreference = $state<'system' | 'light' | 'dark'>('system');
const themeOptions = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
];

// ── Common paths (localStorage) ───────────────────────────────────────────────
const commonPathsKey = 'flutvierCommonPaths';
let commonPaths = $state<string[]>([]);

// ── UI Preferences (client-side only, stored in localStorage) ─────────────────
// Must match BW_SERVER_PREF_KEY in appstate.ts.
const bwServerPrefKey = 'flutvierStoreBandwidthOnServer';
let storeBandwidthOnServer = $state(false);

// Must match USE_SERVER_POLLING_KEY in +layout.svelte.
const useServerPollingKey = 'flutvierUseServerPolling';
let useServerPolling = $state(false);

// ── Alt speed schedule state (used by saveSettings & syncAltSpeedTimes) ───────
let altSpeedFrom = $state('09:00');
let altSpeedTo = $state('17:00');

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeToMinutes(time: string): number {
  const parts = time.split(':');
  if (parts.length !== 2) return 0;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return 0;
  return h * 60 + m;
}

// ── Modal lifecycle ───────────────────────────────────────────────────────────
function syncAltSpeedTimes() {
  if (typeof tempSettings['alt-speed-time-begin'] === 'number') {
    altSpeedFrom = minutesToTime(tempSettings['alt-speed-time-begin']);
  }
  if (typeof tempSettings['alt-speed-time-end'] === 'number') {
    altSpeedTo = minutesToTime(tempSettings['alt-speed-time-end']);
  }
}

$effect(() => {
  if (open) {
    saveStatus = 'idle';
    void refreshSession().then(() => {
      tempSettings = { ...$session };
      syncAltSpeedTimes();
    });
  }
});

async function saveSettings() {
  tempSettings['alt-speed-time-begin'] = timeToMinutes(altSpeedFrom);
  tempSettings['alt-speed-time-end'] = timeToMinutes(altSpeedTo);
  saveStatus = 'saving';
  try {
    await updateSession(tempSettings);
    // Persist client-side preferences only on explicit save.
    if (browser) {
      window.localStorage.setItem(themePreferenceKey, themePreference);
      window.localStorage.setItem(commonPathsKey, JSON.stringify(commonPaths));
      window.localStorage.setItem(bwServerPrefKey, String(storeBandwidthOnServer));
      window.localStorage.setItem(useServerPollingKey, String(useServerPolling));
    }
    saveStatus = 'success';
  } catch {
    saveStatus = 'error';
  }
}

// Runs after the FlyStretchAnimationWrapper close animation completes.
// Keeps visible state intact during the shrink-back animation,
// then resets everything once the panel has fully left the screen.
function handleClosed() {
  tempSettings = {};
  saveStatus = 'idle';
  // Revert any unsaved client-side preferences back to what is persisted.
  if (browser) {
    const storedTheme = window.localStorage.getItem(themePreferenceKey);
    if (storedTheme === 'system' || storedTheme === 'light' || storedTheme === 'dark') {
      themePreference = storedTheme;
    } else {
      themePreference = 'system';
    }

    const storedPaths = window.localStorage.getItem(commonPathsKey);
    if (storedPaths) {
      try {
        commonPaths = JSON.parse(storedPaths) as string[];
      } catch {
        commonPaths = [];
      }
    } else {
      commonPaths = [];
    }

    const storedBwServer = window.localStorage.getItem(bwServerPrefKey);
    storeBandwidthOnServer = storedBwServer === 'true';

    const storedServerPoll = window.localStorage.getItem(useServerPollingKey);
    useServerPolling = storedServerPoll === 'true';
  }
}

function resetSettings() {
  tempSettings = { ...$session };
  syncAltSpeedTimes();
}

// ── Theme effect ──────────────────────────────────────────────────────────────
// Applies the selected theme to the DOM immediately for live preview.
// Does NOT write to localStorage — that only happens in saveSettings().
$effect(() => {
  if (!browser) return;

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = () => {
    const isDark = themePreference === 'system' ? media.matches : themePreference === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
  };

  applyTheme();

  if (themePreference === 'system') {
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }
});

// ── Load persisted client-side preferences on mount ───────────────────────────
onMount(() => {
  if (!browser) return;

  const storedTheme = window.localStorage.getItem(themePreferenceKey);
  if (storedTheme === 'system' || storedTheme === 'light' || storedTheme === 'dark') {
    themePreference = storedTheme;
  }

  const storedPaths = window.localStorage.getItem(commonPathsKey);
  if (storedPaths) {
    try {
      commonPaths = JSON.parse(storedPaths) as string[];
    } catch {
      /* ignore malformed data */
    }
  }

  const storedBwServer = window.localStorage.getItem(bwServerPrefKey);
  if (storedBwServer !== null) {
    storeBandwidthOnServer = storedBwServer === 'true';
  }

  const storedServerPoll = window.localStorage.getItem(useServerPollingKey);
  if (storedServerPoll !== null) {
    useServerPolling = storedServerPoll === 'true';
  }
});
</script>

<FlyStretchAnimationWrapper
  bind:open
  {getTriggerRect}
  maxWidth={896}
  maxHeight={630}
  ariaLabel="Settings"
  onClosed={handleClosed}
>
  {#snippet children(_phase, close, _panelHeight)}
    <div class="flex h-full flex-col overflow-hidden">
      <!-- Sticky Header -->
      <div
        class="border-ColorPalette-border-tertiary/50 bg-ColorPalette-bg-quaternary/95 sticky top-0 z-20 flex flex-shrink-0 items-center justify-between rounded-t-3xl border-b p-6 backdrop-blur-md"
      >
        <h2 id="settings-title" class="text-ColorPalette-text-secondary flex-1 text-2xl font-bold">
          Settings
        </h2>
        <button
          onclick={close}
          class="bg-ColorPalette-bg-quinary hover:bg-ColorPalette-button-bg-hover-tertiary text-ColorPalette-text-quinary hover:text-ColorPalette-modal-tab-text-hover-secondary rounded-md p-2 transition-colors"
          aria-label="Close"
        >
          <Close class="h-5 w-5" />
        </button>
      </div>

      <!-- Tabs -->
      <div class="border-ColorPalette-border-secondary/50 bg-ColorPalette-bg-tertiary/50 border-b">
        <nav class="-mb-px flex">
          {#each settingsTabs as tab (tab.id)}
            <button
              onclick={() => (activeTab = tab.id)}
              class="border-b-2 px-4 py-2 text-sm font-medium transition-colors {activeTab ===
              tab.id
                ? 'border-ColorPalette-modal-tab-selected-primary bg-ColorPalette-bg-secondary/50 text-ColorPalette-modal-tab-selected-primary'
                : 'text-ColorPalette-text-tertiary hover:bg-ColorPalette-bg-tertiary/70 hover:text-ColorPalette-modal-tab-text-hover-secondary border-transparent'}"
            >
              {tab.label}
            </button>
          {/each}
        </nav>
      </div>

      <!-- Scrollable Content -->
      <div class="min-h-0 flex-1 overflow-y-auto p-6">
        {#if activeTab === 'general'}
          <GeneralTab bind:tempSettings bind:themePreference {themeOptions} bind:commonPaths />
        {:else if activeTab === 'speeds'}
          <SpeedsTab bind:tempSettings bind:altSpeedFrom bind:altSpeedTo />
        {:else if activeTab === 'queue'}
          <QueueTab bind:tempSettings />
        {:else if activeTab === 'ports'}
          <PortsTab bind:tempSettings />
        {:else if activeTab === 'remote'}
          <RemoteTab bind:tempSettings />
        {:else if activeTab === 'disk'}
          <DiskTab bind:tempSettings />
        {:else if activeTab === 'ui'}
          <UiTab bind:storeBandwidthOnServer bind:useServerPolling />
        {/if}
      </div>

      <!-- Sticky Footer -->
      <div
        class="border-ColorPalette-border-tertiary/50 bg-ColorPalette-bg-quaternary/95 sticky bottom-0 z-10 flex justify-end space-x-3 rounded-b-3xl border-t p-6 backdrop-blur-md"
      >
        <button
          onclick={resetSettings}
          class="bg-ColorPalette-bg-quinary hover:bg-ColorPalette-button-bg-hover-tertiary text-ColorPalette-text-quinary hover:text-ColorPalette-modal-tab-text-hover-secondary rounded-md px-6 py-2 text-sm transition-colors"
          >Reset</button
        >
        <SaveButton {saveStatus} onclick={saveSettings} />
        {#if saveStatus === 'error'}
          <div class="flex items-center rounded-xl bg-red-100 px-4 py-2 text-sm text-red-800">
            Save failed (check console)
          </div>
        {/if}
      </div>
    </div>
  {/snippet}
</FlyStretchAnimationWrapper>
