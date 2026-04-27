<!-- src/lib/components/SettingsModal.svelte -->
<script lang="ts">
import { onMount } from 'svelte';
import { browser } from '$app/environment';
import { callRpc, refreshSession, session, torrents, updateBlocklist, updateSession } from '$lib';

import { getCompletedTorrentPaths } from '$lib/helpers';
import { Close, InformationVariantCircleOutline, LanCheck, LanDisconnect, Wan } from '$lib/plugins';

import DDSelector from './DDSelector.svelte';
import FlyStretchAnimationWrapper from './FlyStretchAnimWrapper.svelte';
import SaveButton from './SaveButton.svelte';
import TimeDDSelector from './TimeDDSelector.svelte';

interface Props {
  /** Controls modal visibility — bindable so parent can open/close */
  open?: boolean;
  /** Called at open time and close time to get the source/return rect for the fly animation. */
  getTriggerRect?: () => DOMRect | null;
}

let { open = $bindable(false), getTriggerRect = () => null }: Props = $props();

// ── Theme ─────────────────────────────────────────────────────────────────────
const themePreferenceKey = 'flutvierThemeMode';
let themePreference = $state<'system' | 'light' | 'dark'>('system');
const themeOptions = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
];

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

// ── UI Preferences (client-side only, stored in localStorage) ─────────────────
// Must match BW_SERVER_PREF_KEY in appstate.ts.
const bwServerPrefKey = 'flutvierStoreBandwidthOnServer';
let storeBandwidthOnServer = $state(true);

// ── Common paths (localStorage) ───────────────────────────────────────────────
const commonPathsKey = 'flutvierCommonPaths';
let commonPaths = $state<string[]>([]);
let newCommonPath = $state('');

// ── Alt speed schedule state ──────────────────────────────────────────────────
let altSpeedFrom = $state('09:00');
let altSpeedTo = $state('17:00');

const ALT_SPEED_DAYS = [
  { label: 'Sun', bit: 1 },
  { label: 'Mon', bit: 2 },
  { label: 'Tue', bit: 4 },
  { label: 'Wed', bit: 8 },
  { label: 'Thu', bit: 16 },
  { label: 'Fri', bit: 32 },
  { label: 'Sat', bit: 64 }
];

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

function isDayEnabled(bit: number): boolean {
  return Boolean(((tempSettings['alt-speed-time-day'] as number) ?? 127) & bit);
}

function toggleDay(bit: number) {
  const current = (tempSettings['alt-speed-time-day'] as number) ?? 127;
  tempSettings = { ...tempSettings, 'alt-speed-time-day': current ^ bit };
}

// ── Blocklist state ───────────────────────────────────────────────────────────
let blocklistStatus = $state<'idle' | 'loading' | 'success' | 'error'>('idle');
let blocklistError = $state('');

// ── Port test state ───────────────────────────────────────────────────────────
let portTestState = $state<'idle' | 'open' | 'closed'>('idle');
let portTestTimer: ReturnType<typeof setTimeout> | null = null;
let lastTestedPort: unknown = undefined;

// Reset the port test indicator whenever the user edits the peer-port value
$effect(() => {
  const currentPort = tempSettings['peer-port'];
  if (portTestState !== 'idle' && currentPort !== lastTestedPort) {
    portTestState = 'idle';
    if (portTestTimer !== null) {
      clearTimeout(portTestTimer);
      portTestTimer = null;
    }
  }
});

async function testPort() {
  lastTestedPort = tempSettings['peer-port'];
  if (portTestTimer !== null) {
    clearTimeout(portTestTimer);
    portTestTimer = null;
  }
  try {
    // If the form port differs from the server's current port, save only that
    // key first so the test reflects what the user has entered — without
    // persisting any other in-progress changes from the rest of the modal.
    if (tempSettings['peer-port'] !== $session['peer-port']) {
      await updateSession({ 'peer-port': tempSettings['peer-port'] });
    }
    const result = await callRpc<{ 'port-is-open': boolean }>('port-test');
    if (result['port-is-open']) {
      portTestState = 'open';
    } else {
      portTestState = 'closed';
      portTestTimer = setTimeout(() => {
        portTestState = 'idle';
        portTestTimer = null;
      }, 8000);
    }
  } catch {
    portTestState = 'idle';
  }
}

async function handleBlocklistUpdate() {
  blocklistStatus = 'loading';
  blocklistError = '';
  try {
    await updateBlocklist();
    blocklistStatus = 'success';
  } catch (err: unknown) {
    blocklistStatus = 'error';
    blocklistError = err instanceof Error ? err.message : 'Failed to update blocklist';
  }
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
  portTestState = 'idle';
  if (portTestTimer !== null) {
    clearTimeout(portTestTimer);
    portTestTimer = null;
  }
}

function resetSettings() {
  tempSettings = { ...$session };
  syncAltSpeedTimes();
}

// ── Common paths helpers ───────────────────────────────────────────────────────
function saveCommonPathsToStorage() {
  if (browser) {
    window.localStorage.setItem(commonPathsKey, JSON.stringify(commonPaths));
  }
}

function addCommonPath() {
  const trimmed = newCommonPath.trim();
  if (trimmed && !commonPaths.includes(trimmed)) {
    commonPaths = [...commonPaths, trimmed];
    saveCommonPathsToStorage();
  }
  newCommonPath = '';
}

function removeCommonPath(path: string) {
  commonPaths = commonPaths.filter((p) => p !== path);
  saveCommonPathsToStorage();
}

function useCommonPath(path: string) {
  tempSettings = { ...tempSettings, 'download-dir': path };
}

function importTorrentPaths() {
  const candidates = getCompletedTorrentPaths($torrents);
  const toAdd = candidates.filter((p) => !commonPaths.includes(p));
  if (toAdd.length > 0) {
    commonPaths = [...commonPaths, ...toAdd];
    saveCommonPathsToStorage();
  }
}

// ── Theme ─────────────────────────────────────────────────────────────────────
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
    storeBandwidthOnServer = storedBwServer !== 'false';
  }
});

$effect(() => {
  if (!browser) return;

  window.localStorage.setItem(themePreferenceKey, themePreference);

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
        <!-- ══ GENERAL TAB ══════════════════════════════════════════════════ -->
        {#if activeTab === 'general'}
          <div class="text-ColorPalette-text-secondary space-y-6">
            <!-- Theme & Encryption -->
            <div class="grid grid-cols-2 gap-4">
              <div>
                <div class="text-ColorPalette-text-secondary mb-1 block text-sm font-medium">
                  Theme
                </div>
                <DDSelector
                  value={themePreference}
                  options={themeOptions}
                  onChange={(v) => (themePreference = v as 'system' | 'light' | 'dark')}
                  class="mx-0 w-40"
                />
              </div>
              <div>
                <div class="text-ColorPalette-text-secondary mb-1 block text-sm font-medium">
                  Encryption
                </div>
                <DDSelector
                  value={tempSettings['encryption'] ?? 'tolerated'}
                  options={[
                    { value: 'tolerated', label: 'Allow any' },
                    { value: 'preferred', label: 'Prefer encrypted' },
                    { value: 'required', label: 'Require encrypted' }
                  ]}
                  onChange={(v) => (tempSettings = { ...tempSettings, encryption: v })}
                  class="mx-0 w-48"
                />
              </div>
            </div>

            <!-- Default Download Directory -->
            <div>
              <label
                for="download-dir"
                class="text-ColorPalette-text-secondary mb-1 block text-sm font-medium"
                >Default Download Directory</label
              >
              <input
                id="download-dir"
                type="text"
                bind:value={tempSettings['download-dir']}
                placeholder="/path/to/downloads"
                class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-full rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
              />
            </div>

            <!-- Common Paths -->
            <div>
              <div class="text-ColorPalette-text-secondary mb-1 text-sm font-medium">
                Common Paths
              </div>
              <button
                type="button"
                onclick={importTorrentPaths}
                class="text-ColorPalette-text-secondary hover:text-ColorPalette-input-ring-focus-primary mb-2 text-xs transition-colors"
              >
                Import paths from downloaded torrents
              </button>
              {#if commonPaths.length > 0}
                <div class="mb-2 space-y-1">
                  {#each commonPaths as path (path)}
                    <div class="flex items-center gap-2">
                      <button
                        type="button"
                        onclick={() => useCommonPath(path)}
                        title={path}
                        class="min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-xs transition-colors
                          {tempSettings['download-dir'] === path
                          ? 'bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/40 ring-inset'
                          : 'bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary hover:bg-ColorPalette-bg-tertiary/70'}"
                        >{path}</button
                      >
                      <!-- px-[9px] side padding is invisible — total column width matches Add button below -->
                      <div class="flex shrink-0 items-center justify-center px-[11.5px]">
                        <button
                          type="button"
                          onclick={() => removeCommonPath(path)}
                          aria-label="Remove path"
                          class="bg-ColorPalette-bg-quinary hover:bg-ColorPalette-button-bg-hover-tertiary text-ColorPalette-text-quinary flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:text-red-600"
                        >
                          <Close class="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
              <div class="flex gap-2">
                <input
                  type="text"
                  bind:value={newCommonPath}
                  placeholder="Add a path…"
                  onkeydown={(e) => e.key === 'Enter' && addCommonPath()}
                  class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary min-w-0 flex-1 rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
                />
                <button
                  type="button"
                  onclick={addCommonPath}
                  disabled={!newCommonPath.trim()}
                  class="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white shadow-sm transition-all hover:bg-blue-700 disabled:opacity-50"
                  >Add</button
                >
              </div>
            </div>

            <!-- Incomplete Directory -->
            <div class="space-y-2">
              <label class="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={Boolean(tempSettings['incomplete-dir-enabled'])}
                  onchange={(e) => {
                    tempSettings = {
                      ...tempSettings,
                      'incomplete-dir-enabled': (e.currentTarget as HTMLInputElement).checked
                    };
                  }}
                  class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
                />
                <span class="text-ColorPalette-text-secondary text-sm font-medium"
                  >Use incomplete download directory</span
                >
              </label>
              {#if tempSettings['incomplete-dir-enabled']}
                <div class="pl-7">
                  <input
                    type="text"
                    bind:value={tempSettings['incomplete-dir']}
                    placeholder="/path/to/incomplete"
                    class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-full rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
                  />
                </div>
              {/if}
              <label class="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={Boolean(tempSettings['rename-partial-files'])}
                  onchange={(e) => {
                    tempSettings = {
                      ...tempSettings,
                      'rename-partial-files': (e.currentTarget as HTMLInputElement).checked
                    };
                  }}
                  class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
                />
                <span class="text-ColorPalette-text-secondary text-sm font-medium"
                  >Append .part to incomplete file names</span
                >
              </label>
            </div>

            <!-- Delete torrent file after download -->
            <label class="flex items-center gap-3">
              <input
                type="checkbox"
                checked={Boolean(tempSettings['trash-original-torrent-files'])}
                onchange={(e) => {
                  tempSettings = {
                    ...tempSettings,
                    'trash-original-torrent-files': (e.currentTarget as HTMLInputElement).checked
                  };
                }}
                class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
              />
              <span class="text-ColorPalette-text-secondary text-sm font-medium"
                >Delete .torrent file after adding to queue</span
              >
            </label>
          </div>

          <!-- ══ SPEEDS TAB ═══════════════════════════════════════════════════ -->
        {:else if activeTab === 'speeds'}
          <div class="text-ColorPalette-text-secondary space-y-6">
            <!-- Speed Limits -->
            <div>
              <div class="text-ColorPalette-text-secondary mb-3 text-sm font-semibold">
                Speed Limits
              </div>
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
                      <div class="text-ColorPalette-text-secondary mb-1 text-xs font-medium">
                        From
                      </div>
                      <TimeDDSelector bind:value={altSpeedFrom} class="w-36" />
                    </div>
                    <div>
                      <div class="text-ColorPalette-text-secondary mb-1 text-xs font-medium">
                        To
                      </div>
                      <TimeDDSelector bind:value={altSpeedTo} class="w-36" />
                    </div>
                  </div>
                  <!-- Days of week -->
                  <div>
                    <div class="text-ColorPalette-text-secondary mb-2 text-xs font-medium">
                      Days
                    </div>
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

          <!-- ══ QUEUE TAB ════════════════════════════════════════════════════ -->
        {:else if activeTab === 'queue'}
          <div class="text-ColorPalette-text-secondary">
            <div class="grid grid-cols-2 gap-4">
              <!-- Active Torrents (left column) -->
              <div class="space-y-3">
                <div class="text-ColorPalette-text-secondary mb-3 text-sm font-semibold">
                  Active Torrents
                </div>
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
                          'idle-seeding-limit-enabled': (e.currentTarget as HTMLInputElement)
                            .checked
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

          <!-- ══ PORTS TAB ════════════════════════════════════════════════════ -->
        {:else if activeTab === 'ports'}
          <div class="text-ColorPalette-text-secondary space-y-4">
            <div class="flex items-center gap-4">
              <label for="peer-port" class="text-ColorPalette-text-secondary text-sm font-medium"
                >Peer Port</label
              >
              <input
                id="peer-port"
                type="number"
                bind:value={tempSettings['peer-port']}
                min="1"
                max="65535"
                class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-28 rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
              />
              <button
                type="button"
                onclick={testPort}
                title="Check Transmission Server Peer Port Connectivity"
                class="rounded-md bg-gray-700/90 p-[7px] transition-colors hover:bg-gray-600 focus:outline-none active:bg-gray-800"
              >
                {#if portTestState === 'open'}
                  <Wan class="h-4 w-4 text-green-600" />
                {:else if portTestState === 'closed'}
                  <LanDisconnect class="h-4 w-4 text-red-600" />
                {:else}
                  <LanCheck class="h-4 w-4 text-white/70" />
                {/if}
              </button>
            </div>
            <label class="flex items-center gap-3">
              <input
                type="checkbox"
                checked={Boolean(tempSettings['peer-port-random-on-start'])}
                onchange={(e) => {
                  tempSettings = {
                    ...tempSettings,
                    'peer-port-random-on-start': (e.currentTarget as HTMLInputElement).checked
                  };
                }}
                class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
              />
              <span class="text-ColorPalette-text-secondary text-sm font-medium"
                >Randomize peer port at launch</span
              >
            </label>
            <label class="flex items-center gap-3">
              <input
                type="checkbox"
                checked={Boolean(tempSettings['port-forwarding-enabled'])}
                onchange={(e) => {
                  tempSettings = {
                    ...tempSettings,
                    'port-forwarding-enabled': (e.currentTarget as HTMLInputElement).checked
                  };
                }}
                class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
              />
              <span class="text-ColorPalette-text-secondary text-sm font-medium"
                >Rely on port forwarding via upstream gateway</span
              >
            </label>
            <label class="flex items-center gap-3">
              <input
                type="checkbox"
                checked={Boolean(tempSettings['utp-enabled'])}
                onchange={(e) => {
                  tempSettings = {
                    ...tempSettings,
                    'utp-enabled': (e.currentTarget as HTMLInputElement).checked
                  };
                }}
                class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
              />
              <span class="text-ColorPalette-text-secondary text-sm font-medium"
                >Enable uTP for peer connections</span
              >
            </label>
          </div>

          <!-- ══ REMOTE TAB ═══════════════════════════════════════════════════ -->
        {:else if activeTab === 'remote'}
          <div class="text-ColorPalette-text-secondary space-y-6">
            <!-- RPC -->
            <div>
              <label
                for="rpc-whitelist"
                class="text-ColorPalette-text-secondary mb-1 block text-sm font-medium"
                >RPC Whitelist</label
              >
              <input
                id="rpc-whitelist"
                type="text"
                bind:value={tempSettings['rpc-whitelist']}
                class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-full rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
              />
            </div>

            <!-- Connections -->
            <div>
              <div class="text-ColorPalette-text-secondary mb-3 text-sm font-semibold">
                Connections
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label
                    for="peer-limit-per-torrent"
                    class="text-ColorPalette-text-secondary mb-1 block text-sm font-medium"
                    >Max Peers per Torrent</label
                  >
                  <input
                    id="peer-limit-per-torrent"
                    type="number"
                    bind:value={tempSettings['peer-limit-per-torrent']}
                    min="0"
                    class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-full rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    for="peer-limit-global"
                    class="text-ColorPalette-text-secondary mb-1 block text-sm font-medium"
                    >Max Peers Overall</label
                  >
                  <input
                    id="peer-limit-global"
                    type="number"
                    bind:value={tempSettings['peer-limit-global']}
                    min="0"
                    class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-full rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <!-- Find More Peers -->
            <div>
              <div class="text-ColorPalette-text-secondary mb-2 text-sm font-semibold">
                Find More Peers
              </div>
              <div class="space-y-2">
                <label class="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={Boolean(tempSettings['pex-enabled'])}
                    onchange={(e) => {
                      tempSettings = {
                        ...tempSettings,
                        'pex-enabled': (e.currentTarget as HTMLInputElement).checked
                      };
                    }}
                    class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
                  />
                  <span class="text-ColorPalette-text-secondary text-sm font-medium"
                    >PEX (Peer Exchange)</span
                  >
                </label>
                <label class="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={Boolean(tempSettings['dht-enabled'])}
                    onchange={(e) => {
                      tempSettings = {
                        ...tempSettings,
                        'dht-enabled': (e.currentTarget as HTMLInputElement).checked
                      };
                    }}
                    class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
                  />
                  <span class="text-ColorPalette-text-secondary text-sm font-medium"
                    >DHT (Distributed Hash Table)</span
                  >
                </label>
                <label class="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={Boolean(tempSettings['lpd-enabled'])}
                    onchange={(e) => {
                      tempSettings = {
                        ...tempSettings,
                        'lpd-enabled': (e.currentTarget as HTMLInputElement).checked
                      };
                    }}
                    class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
                  />
                  <span class="text-ColorPalette-text-secondary text-sm font-medium"
                    >LPD (Local Peer Discovery)</span
                  >
                </label>
              </div>
            </div>

            <!-- Blocklist -->
            <div>
              <div class="text-ColorPalette-text-secondary mb-2 text-sm font-semibold">
                Blocklist
              </div>
              <div class="space-y-3">
                <label class="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={Boolean(tempSettings['blocklist-enabled'])}
                    onchange={(e) => {
                      tempSettings = {
                        ...tempSettings,
                        'blocklist-enabled': (e.currentTarget as HTMLInputElement).checked
                      };
                    }}
                    class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
                  />
                  <span class="text-ColorPalette-text-secondary text-sm font-medium"
                    >Enable blocklist</span
                  >
                </label>
                {#if tempSettings['blocklist-enabled']}
                  <div class="space-y-1">
                    <div class="flex gap-2">
                      <input
                        type="url"
                        bind:value={tempSettings['blocklist-url']}
                        placeholder="https://example.com/blocklist.gz"
                        class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary min-w-0 flex-1 rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
                      />
                      <button
                        type="button"
                        onclick={handleBlocklistUpdate}
                        disabled={blocklistStatus === 'loading' || !tempSettings['blocklist-url']}
                        class="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white shadow-sm transition-all hover:bg-blue-700 disabled:opacity-50"
                        >{blocklistStatus === 'loading' ? 'Updating…' : 'Update'}</button
                      >
                    </div>
                    {#if typeof $session['blocklist-size'] === 'number' && ($session['blocklist-size'] as number) > 0}
                      <div class="text-xs text-green-500">
                        Found {($session['blocklist-size'] as number).toLocaleString()} rules in blocklist
                      </div>
                    {/if}
                    {#if blocklistStatus === 'error'}
                      <div class="text-xs text-red-400">
                        {blocklistError || 'Failed to fetch blocklist'}
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          </div>

          <!-- ══ DISK TAB ═════════════════════════════════════════════════════ -->
        {:else if activeTab === 'disk'}
          <div class="text-ColorPalette-text-secondary">
            <label class="flex items-center gap-3">
              <span class="text-ColorPalette-text-secondary text-sm font-medium"
                >Disk Cache (MiB)</span
              >
              <input
                type="number"
                bind:value={tempSettings['cache-size-mb']}
                class="border-ColorPalette-border-primary focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary bg-ColorPalette-bg-tertiary text-ColorPalette-text-tertiary focus:text-ColorPalette-text-primary w-24 rounded-md border p-1.5 text-xs focus:ring-2 focus:outline-none"
              />
            </label>
          </div>

          <!-- ══ UI TAB ══════════════════════════════════════════════════════ -->
        {:else if activeTab === 'ui'}
          <div class="text-ColorPalette-text-secondary space-y-6">
            <!-- Bandwidth Graph -->
            <div>
              <div class="text-ColorPalette-text-secondary mb-3 text-sm font-semibold">
                Bandwidth Graph
              </div>
              <div class="flex items-center gap-3">
                <label class="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={storeBandwidthOnServer}
                    onchange={(e) => {
                      storeBandwidthOnServer = (e.currentTarget as HTMLInputElement).checked;
                      if (browser) {
                        window.localStorage.setItem(
                          bwServerPrefKey,
                          String(storeBandwidthOnServer)
                        );
                      }
                    }}
                    class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
                  />
                  <span class="text-ColorPalette-text-secondary text-sm font-medium"
                    >Store bandwidth utilization snapshot on server</span
                  >
                </label>
                <!-- Info icon with tooltip -->
                <div class="group relative">
                  <InformationVariantCircleOutline class="h-4 w-4 cursor-help text-gray-400" />
                  <div
                    role="tooltip"
                    class="invisible absolute top-full left-0 z-[60] mt-1 w-96 rounded-lg bg-gray-800/95 px-3 py-2.5 text-xs leading-relaxed text-gray-200 shadow-xl group-hover:visible"
                  >
                    <ul class="list-outside list-disc space-y-2 pl-4">
                      <li>
                        When enabled, the last five minutes of bandwidth utilization received from
                        the Transmission RPC server is written to the server every 60 seconds, as
                        well as immediately upon page refresh.
                      </li>
                      <li>
                        The next time the page loads, if the bandwidth data stored on the server
                        occurred within the last 12 hours, it will be loaded into the bandwidth
                        graph.
                      </li>
                      <li>
                        Disabling this setting will rely on local browser-caching only, which cannot
                        survive a page reload, thus the graph will start anew.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
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
