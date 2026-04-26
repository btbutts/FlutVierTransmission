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
