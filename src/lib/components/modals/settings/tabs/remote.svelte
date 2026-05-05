<!-- src/lib/components/modals/settings/tabs/remote.svelte -->
<script lang="ts">
import { session, updateBlocklist } from '$lib';

interface Props {
  tempSettings: Record<string, unknown>;
}

let { tempSettings = $bindable() }: Props = $props();

// ── Blocklist state ───────────────────────────────────────────────────────────
let blocklistStatus = $state<'idle' | 'loading' | 'success' | 'error'>('idle');
let blocklistError = $state('');

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
</script>

<div class="text-ColorPalette-text-secondary space-y-6">
  <!-- RPC -->
  <div>
    <label
      for="rpc-whitelist"
      class="text-ColorPalette-text-secondary mb-1 block text-sm font-medium">RPC Whitelist</label
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
    <div class="text-ColorPalette-text-secondary mb-3 text-sm font-semibold">Connections</div>
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
    <div class="text-ColorPalette-text-secondary mb-2 text-sm font-semibold">Find More Peers</div>
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
        <span class="text-ColorPalette-text-secondary text-sm font-medium">PEX (Peer Exchange)</span
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
    <div class="text-ColorPalette-text-secondary mb-2 text-sm font-semibold">Blocklist</div>
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
        <span class="text-ColorPalette-text-secondary text-sm font-medium">Enable blocklist</span>
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
