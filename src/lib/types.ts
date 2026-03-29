// src/lib/types.ts
// Transmission RPC torrent object shape (based on official RPC spec)
// We only define the fields we're currently using; expand as we add more UI features

export interface Torrent {
  id: number;
  name: string;
  status: number;           // 0 = stopped, 1 = check waiting, etc.
  percentDone: number;      // 0.0 to 1.0
  totalSize: number;        // bytes
  sizeWhenDone: number;     // bytes
  rateDownload: number;     // bytes/sec
  rateUpload: number;       // bytes/sec
  eta: number;              // seconds
  downloadDir: string;
  error: number;
  errorString?: string;
  // files and fileStats are more complex; we'll handle them later when we add per-torrent file view
  files?: unknown[];
  fileStats?: unknown[];
}
