<!-- src/lib/components/modals/settings/tabs/ports.svelte -->
<script lang="ts">
import { session, transmissionCallRPC, updateSession } from '$lib';

import { LanCheck, LanDisconnect, Wan } from '$lib/plugins';

interface Props {
  tempSettings: Record<string, unknown>;
}

let { tempSettings = $bindable() }: Props = $props();

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
    const result = await transmissionCallRPC<{ 'port-is-open': boolean }>('port-test');
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
</script>

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
