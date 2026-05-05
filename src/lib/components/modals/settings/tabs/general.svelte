<!-- src/lib/components/modals/settings/tabs/general.svelte -->
<script lang="ts">
import { torrents } from '$lib';

import DDSelector from '$lib/components/dropdowns/DDSelector.svelte';
import { getCompletedTorrentPaths } from '$lib/helpers';
import { Close } from '$lib/plugins';

interface Props {
  tempSettings: Record<string, unknown>;
  themePreference: 'system' | 'light' | 'dark';
  themeOptions: Array<{ value: string; label: string }>;
  commonPaths: string[];
}

let {
  tempSettings = $bindable(),
  themePreference = $bindable(),
  themeOptions,
  commonPaths = $bindable()
}: Props = $props();

let newCommonPath = $state('');

function addCommonPath() {
  const trimmed = newCommonPath.trim();
  if (trimmed && !commonPaths.includes(trimmed)) {
    commonPaths = [...commonPaths, trimmed];
  }
  newCommonPath = '';
}

function removeCommonPath(path: string) {
  commonPaths = commonPaths.filter((p) => p !== path);
}

function useCommonPath(path: string) {
  tempSettings = { ...tempSettings, 'download-dir': path };
}

function importTorrentPaths() {
  const candidates = getCompletedTorrentPaths($torrents);
  const toAdd = candidates.filter((p) => !commonPaths.includes(p));
  if (toAdd.length > 0) {
    commonPaths = [...commonPaths, ...toAdd];
  }
}
</script>

<div class="text-ColorPalette-text-secondary space-y-6">
  <!-- Theme & Encryption -->
  <div class="grid grid-cols-2 gap-4">
    <div>
      <div class="text-ColorPalette-text-secondary mb-1 block text-sm font-medium">Theme</div>
      <DDSelector
        value={themePreference}
        options={themeOptions}
        onChange={(v) => (themePreference = v as 'system' | 'light' | 'dark')}
        class="mx-0 w-40"
        tooltipClass="whitespace-nowrap"
        tooltipDelay={1500}
      >
        {#snippet tooltipConfig()}
          Choose a new UI theme
        {/snippet}
      </DDSelector>
    </div>
    <div>
      <div class="text-ColorPalette-text-secondary mb-1 block text-sm font-medium">Encryption</div>
      <DDSelector
        value={tempSettings['encryption'] ?? 'tolerated'}
        options={[
          { value: 'tolerated', label: 'Allow any' },
          { value: 'preferred', label: 'Prefer encrypted' },
          { value: 'required', label: 'Require encrypted' }
        ]}
        onChange={(v) => (tempSettings = { ...tempSettings, encryption: v })}
        class="mx-0 w-48"
        tooltipMaxWidth={360}
        tooltipDelay={1500}
      >
        {#snippet tooltipConfig()}
          <div class="leading-relaxed text-gray-700 dark:text-gray-200">
            <p class="mb-1.5 font-bold">Set Transmission Peers Encryption Threshold:</p>
            <ul class="list-outside list-disc space-y-2 pl-4">
              <li>
                The most secure setting is <strong>Require Encrypted</strong>, but this can reduce
                what peers you can communicate with
              </li>
              <li>
                The minimum recommended setting is <strong>Prefer Encrypted</strong>, which will
                always try to use encrypted peers wherever possible
              </li>
              <li>
                Choosing <strong>Allow any</strong> is less secure but may allow you to connect with more
                peers
              </li>
            </ul>
          </div>
        {/snippet}
      </DDSelector>
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
    <div class="text-ColorPalette-text-secondary mb-1 text-sm font-medium">Common Paths</div>
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
            <!-- px-[11.5px] side padding is invisible — total column width matches Add button below -->
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
