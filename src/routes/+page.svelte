<script lang="ts">
import { currentTorrent, refreshTorrent, type Torrent } from '$lib';

import TorrentInfoModal from '$lib/components/modals/TorrentInfoModal.svelte';
import PrimaryTable from '$lib/components/tables/PrimaryTable.svelte';

let torrentInfoOpen = $state(false);
let triggerRectForModal = $state<DOMRect | null>(null);

function handleOpenFiles(torrent: Torrent, triggerRect: DOMRect) {
  currentTorrent.set(torrent);
  refreshTorrent(torrent.id);
  triggerRectForModal = triggerRect;
  torrentInfoOpen = true;
}
</script>

<PrimaryTable onOpenFiles={handleOpenFiles} />

<TorrentInfoModal bind:open={torrentInfoOpen} getTriggerRect={() => triggerRectForModal} />
