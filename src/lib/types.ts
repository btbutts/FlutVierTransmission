// src/lib/types.ts
// Transmission RPC torrent object shape (based on official RPC spec)
// We only define the fields we're currently using; expand as we add more UI features

export interface TrackerStat {
  seederCount: number;
  leecherCount: number;
  lastAnnounceSucceeded: boolean;
  lastAnnounceTime: number; // Unix/POSIX timestamp (seconds)
  nextAnnounceTime: number; // Unix/POSIX timestamp (seconds)
  announce: string;
  downloadCount: number;
  hasAnnounced: boolean;
  hasScraped: boolean;
  host: string;
  id: number;
  isBackup: boolean;
  lastAnnouncePeerCount: number;
  lastAnnounceResult: string;
  lastAnnounceStartTime: number;
  lastAnnounceTimedOut: boolean;
  lastScrapeResult: string;
  lastScrapeStartTime: number;
  lastScrapeSucceeded: boolean;
  lastScrapeTime: number;
  lastScrapeTimedOut: boolean;
  nextScrapeTime: number;
  scrapeState: number;
  tier: number;
}

export interface Peer {
  address: string;
  clientName: string;
  clientIsChoked: boolean;
  clientIsInterested: boolean;
  flagStr: string;
  isDownloadingFrom: boolean; // true = this peer is sending data TO us (seeder)
  isEncrypted: boolean;
  isIncoming: boolean;
  isUploadingTo: boolean; // true = we are sending data TO this peer (leecher)
  isUTP: boolean;
  peerIsChoked: boolean;
  peerIsInterested: boolean;
  port: number;
  progress: number;
  rateToClient: number; // bytes/sec download from this peer
  rateToPeer: number; // bytes/sec upload to this peer
}

export interface File {
  bytes: number;
  name: string;
  length: number; // Full file size
}

export interface FileStat {
  bytesCompleted: number;
  wanted: boolean; // true = file is queued to download; false = skipped
  have: number;
  priority: number; // -1 low, 0 normal, 1 high (Transmission never returns -2; use !wanted for skip)
}

export interface Torrent {
  id: number;
  name: string;
  status: number; // 0 = stopped, 1 = check waiting, etc.
  percentDone: number; // 0.0 to 1.0
  totalSize: number; // bytes
  sizeWhenDone: number; // bytes
  rateDownload: number; // bytes/sec
  rateUpload: number; // bytes/sec
  eta: number; // seconds
  downloadDir: string;
  error: number;
  errorString?: string;
  isPrivate?: boolean;
  addedDate?: number;
  doneDate?: number;
  queuePosition?: number;
  uploadRatio?: number;
  peersSendingToUs?: number; // Leechers (we're seeding to)
  peersGettingFromUs?: number; // Active seeders (downloading from)
  trackers?: Array<{ announce: string }>;
  trackerStats?: TrackerStat[];
  peers?: Peer[];
  // files and fileStats are more complex;
  // we'll handle them later when we add per-torrent file view
  files?: File[];
  fileStats?: FileStat[];
  uploadedEver: number; // bytes
  downloadedEver: number; // bytes
}

export interface GeoInfo {
  countryCode: string;
  country: string;
  city: string;
  regionName: string;
  cachedAt: number;
}

export interface PeerEntry {
  address: string;
  geo: GeoInfo | null;
  loading: boolean;
}

/**
 * Options for the shared `showCustomTooltip` helper in helpers.ts.
 * Decouples tooltip positioning logic from individual components so any
 * component that uses Tooltip.svelte can reuse the same show/hide pattern.
 */
export interface ShowCustomTooltipOptions {
  /** The element that triggers the tooltip (used for getBoundingClientRect). */
  triggerEl: HTMLElement;
  /** Callback that updates the component's tooltip position state. */
  setPos: (pos: { x: number; y: number }) => void;
  /** Callback that updates the component's tooltip visibility state. */
  setVisible: (visible: boolean) => void;
  /**
   * When provided, the tooltip appears only after this many milliseconds of
   * continuous hover. Useful for avoiding tooltip flicker on quick mouse-overs.
   * The returned timer handle must be passed to `hideCustomTooltip` so it can
   * be cancelled if the user leaves before the delay elapses.
   */
  waitBeforeRenderDelay?: number;
  /**
   * CSS selector passed to `Element.closest()` to find the nearest ancestor
   * that creates a CSS fixed containing block (e.g. via backdrop-filter).
   * When provided, tooltip coordinates are computed relative to that ancestor
   * rather than the viewport, so `position: fixed` renders in the right place.
   */
  containingBlockSelector?: string;
  /**
   * Optional override for the default positioning logic.
   * Receives the trigger element's viewport rect and the containing block's
   * `{ top, left }` origin, and must return sidebar-relative `{ x, y }` values
   * suitable for the Tooltip's `x` and `y` props.
   * When omitted, the tooltip is placed just below the trigger element's bottom
   * edge, aligned to its left edge, both adjusted for the containing block origin.
   */
  computePos?: (
    triggerRect: DOMRect,
    containingOrigin: { top: number; left: number }
  ) => { x: number; y: number };
}
