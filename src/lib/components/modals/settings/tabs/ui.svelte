<!-- src/lib/components/modals/settings/tabs/ui.svelte -->
<script lang="ts">
import { browser } from '$app/environment';
import { detectServer, serverAvailable } from '$lib';

import LoadingArcSpinner from '$lib/components/animations/LoadingArcSpinner.svelte';
import RefreshSpinner from '$lib/components/animations/RefreshSpinner.svelte';
import Tooltip from '$lib/components/tooltips/Tooltip.svelte';
import { fetchLatestPollServiceRelease, type PollServiceRelease } from '$lib/github';
import { hideCustomTooltip, showCustomTooltip } from '$lib/helpers';
import { Check, ContentCopy, Download, InformationVariantCircleOutline } from '$lib/plugins';

interface Props {
  storeBandwidthOnServer: boolean;
}

let { storeBandwidthOnServer = $bindable() }: Props = $props();

// ── Bandwidth storage tooltip ─────────────────────────────────────────────────
// The animated modal panel has backdrop-blur-xl, which creates a new CSS
// containing block for position:fixed children. containingBlockSelector targets
// that ancestor so showCustomTooltip offsets coordinates to be panel-relative.
let bwTooltipVisible = $state(false);
let bwTooltipPos = $state({ x: 0, y: 0 });

// ── PollService setup (shown when server is not detected) ─────────────────────
let releaseInfo = $state<PollServiceRelease | null>(null);
let releaseLoading = $state(false);
let releaseFetchError = $state(false);
let onelinerCopied = $state(false);
let pollCheckLoading = $state(false);
let pollServiceSpinner: { beginSpin: () => void } | undefined = $state(undefined);

// Fetch release info lazily on first mount when server is unavailable.
// This component only renders when activeTab === 'ui', so no need to
// guard against other tabs here.
$effect(() => {
  if (!$serverAvailable && releaseInfo === null && !releaseLoading && !releaseFetchError) {
    let cancelled = false;
    releaseLoading = true;
    void fetchLatestPollServiceRelease().then((info) => {
      if (cancelled) return;
      releaseInfo = info;
      releaseLoading = false;
      if (!info) releaseFetchError = true;
    });
    return () => {
      cancelled = true;
    };
  }
});

async function checkForPollService() {
  pollCheckLoading = true;
  await detectServer();
  // If the server still isn't available, (re-)fetch the release info so the user
  // can try downloading the installer without a full page reload.
  if (!$serverAvailable) {
    releaseFetchError = false;
    releaseInfo = null;
    releaseLoading = true;
    const info = await fetchLatestPollServiceRelease();
    releaseInfo = info;
    releaseLoading = false;
    if (!info) releaseFetchError = true;
  }
  pollCheckLoading = false;
}

function handlePollServiceCheck() {
  if (!pollCheckLoading) {
    pollServiceSpinner?.beginSpin();
    void checkForPollService();
  }
}

function downloadInstaller() {
  if (!releaseInfo || !browser) return;
  const a = document.createElement('a');
  a.href = releaseInfo.installerUrl;
  a.download = 'install.sh';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function copyOneliner() {
  if (!releaseInfo || !browser) return;
  const oneliner = `curl -fsSL ${releaseInfo.installerUrl} | sudo bash`;
  try {
    await navigator.clipboard.writeText(oneliner);
    onelinerCopied = true;
    setTimeout(() => {
      onelinerCopied = false;
    }, 2000);
  } catch {
    // Clipboard API unavailable in this context.
  }
}
</script>

<div class="text-ColorPalette-text-secondary space-y-6">
  <!-- Server-side Features -->
  <div>
    <div class="text-ColorPalette-text-secondary mb-3 text-sm font-semibold">
      Server-side Features
    </div>
    {#if $serverAvailable}
      <div class="space-y-4">
        <!-- Store bandwidth utilization snapshot on server -->
        <div class="flex items-center gap-3">
          <label class="flex items-center gap-3">
            <input
              type="checkbox"
              checked={storeBandwidthOnServer}
              onchange={(e) => {
                storeBandwidthOnServer = (e.currentTarget as HTMLInputElement).checked;
              }}
              class="text-ColorPalette-modal-TxtAccent-secondary h-4 w-4 rounded border-gray-300 focus:ring-blue-500 focus:outline-none"
            />
            <span class="text-ColorPalette-text-secondary text-sm font-medium"
              >Store bandwidth utilization snapshot on server</span
            >
          </label>
          <!-- Info icon — hover to reveal Tooltip.svelte -->
          <button
            type="button"
            onmouseenter={(e) =>
              showCustomTooltip({
                triggerEl: e.currentTarget as HTMLElement,
                setPos: (pos) => {
                  bwTooltipPos = pos;
                },
                setVisible: (v) => {
                  bwTooltipVisible = v;
                },
                containingBlockSelector: '.backdrop-blur-xl'
              })}
            onmouseleave={() =>
              hideCustomTooltip((v) => {
                bwTooltipVisible = v;
              })}
            class="cursor-help text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
            aria-label="Information about bandwidth server storage"
          >
            <InformationVariantCircleOutline class="h-4 w-4" />
          </button>
          <Tooltip visible={bwTooltipVisible} x={bwTooltipPos.x} y={bwTooltipPos.y} maxWidth={384}>
            <ul
              class="list-outside list-disc space-y-2 pl-4 leading-relaxed text-gray-700 dark:text-gray-200"
            >
              <li>
                When enabled, the last five minutes of bandwidth utilization received from the
                Transmission RPC server is written to the server every 60 seconds, as well as
                immediately upon page refresh.
              </li>
              <li>
                The next time the page loads, if the bandwidth data stored on the server occurred
                within the last 12 hours, it will be loaded into the bandwidth graph.
              </li>
              <li>
                Disabling this setting will rely on local browser-caching only, which cannot survive
                a page reload, thus the graph will start anew.
              </li>
            </ul>
          </Tooltip>
        </div>
        <!-- Use server-side polling (Phase 4 placeholder — not yet functional) -->
        <div class="flex items-center gap-3">
          <label class="flex cursor-not-allowed items-center gap-3 opacity-50">
            <input type="checkbox" disabled class="h-4 w-4 rounded border-gray-300" />
            <span class="text-ColorPalette-text-secondary text-sm font-medium"
              >Use server-side polling</span
            >
          </label>
          <span class="text-ColorPalette-text-tertiary text-xs italic">coming soon</span>
        </div>
      </div>
    {:else}
      <div class="space-y-4">
        <p class="text-ColorPalette-text-tertiary text-sm">
          Install the optional FlutVierTransmission PollService companion on the server hosting
          Transmission and this Web UI to enable bandwidth history persistence across page reloads
          and server-side torrent polling.
        </p>
        {#if releaseLoading}
          <div class="text-ColorPalette-text-tertiary flex items-center gap-2 text-sm">
            <LoadingArcSpinner class="h-4 w-4" />
            <span>Fetching latest release...</span>
          </div>
        {:else if releaseFetchError}
          <p class="text-sm text-red-400">
            Unable to fetch release info from GitHub. Check your connection and try again.
          </p>
        {:else if releaseInfo}
          <div class="space-y-3">
            <!-- Download installer button -->
            <div class="flex items-center gap-3">
              <button
                type="button"
                onclick={downloadInstaller}
                class="flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white shadow-sm transition-all hover:bg-blue-700"
              >
                <Download class="h-4 w-4" />
                Download install.sh
              </button>
              <span class="text-ColorPalette-text-tertiary text-xs">{releaseInfo.version}</span>
            </div>
            <!-- Copy-paste one-liner -->
            <div>
              <div class="text-ColorPalette-text-tertiary mb-1 text-xs">
                Or run directly on your server:
              </div>
              <div
                class="border-ColorPalette-border-primary bg-ColorPalette-bg-tertiary flex items-center gap-2 rounded-md border px-3 py-2"
              >
                <code
                  class="text-ColorPalette-text-tertiary min-w-0 flex-1 truncate font-mono text-xs"
                >
                  curl -fsSL {releaseInfo.installerUrl} | sudo bash
                </code>
                <button
                  type="button"
                  onclick={copyOneliner}
                  aria-label="Copy one-liner to clipboard"
                  class="bg-ColorPalette-bg-quinary hover:bg-ColorPalette-button-bg-hover-tertiary text-ColorPalette-text-quinary flex shrink-0 items-center justify-center rounded-md p-1 transition-colors"
                >
                  {#if onelinerCopied}
                    <Check class="h-4 w-4 text-green-500" />
                  {:else}
                    <ContentCopy class="h-4 w-4" />
                  {/if}
                </button>
              </div>
            </div>
          </div>
        {/if}
        <!-- Re-check button — lets the user verify install without a page reload -->
        <button
          type="button"
          onclick={handlePollServiceCheck}
          class="text-ColorPalette-text-tertiary hover:text-ColorPalette-text-secondary flex items-center gap-1.5 text-sm transition-colors"
        >
          <RefreshSpinner
            bind:this={pollServiceSpinner}
            loading={pollCheckLoading}
            class="h-4 w-4"
          />
          Check for PollService
        </button>
      </div>
    {/if}
  </div>
</div>
