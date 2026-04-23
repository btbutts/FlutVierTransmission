// src/lib/config/columns.ts
// Default column definitions for the primary torrent list table.
// Each entry maps to a ColumnConfig and drives both the fixed header table and the scrollable body table.
// To add a column: append an entry here and handle its key in PrimaryTable.svelte's getDisplayValue / getSortValue.
// To change a default width or visibility: edit the relevant row below.

export interface ColumnConfig {
  key: string;
  label: string;
  width: string;
  minWidth?: string;
  align: 'left' | 'right' | 'center';
  headerAlign?: 'left' | 'right' | 'center';
  sortable: boolean;
  resizable: boolean;
  isVisible: boolean;
}

// prettier-ignore
export const defaultColumns: ColumnConfig[] = [
  // Always-visible columns (shown by default)
  { key: 'name',          label: 'Name',     width: '256px', minWidth: '120px', align: 'left',   sortable: true, resizable: true, isVisible: true  },
  { key: 'status',        label: 'Status',   width: '112px', minWidth: '80px',  align: 'center',                 sortable: true, resizable: true, isVisible: true  },
  { key: 'totalSize',     label: 'Size',     width: '96px',  minWidth: '72px',  align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: true  },
  { key: 'rateDownload',  label: 'DL',       width: '96px',  minWidth: '72px',  align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: true  },
  { key: 'eta',           label: 'ETA',      width: '80px',  minWidth: '64px',  align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: true  },
  // Optional columns (hidden by default; user toggles via the Columns dropdown)
  { key: 'private',       label: 'Private',  width: '72px',  minWidth: '60px',  align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
  { key: 'ul',            label: 'UL',       width: '96px',  minWidth: '72px',  align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
  { key: 'activeSeeders', label: 'Seeds',    width: '80px',  minWidth: '64px',  align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
  { key: 'added',         label: 'Added',    width: '112px', minWidth: '80px',  align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
  { key: 'basePath',      label: 'Path',     width: '200px', minWidth: '120px', align: 'left',   headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
  { key: 'done',          label: 'Done',     width: '112px', minWidth: '80px',  align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
  { key: 'error',         label: 'Error',    width: '120px', minWidth: '96px',  align: 'left',   headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
  { key: 'queuePos',      label: 'Queue',    width: '72px',  minWidth: '60px',  align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
  { key: 'seedRatio',     label: 'Ratio',    width: '80px',  minWidth: '64px',  align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
  { key: 'leechers',      label: 'Leechers', width: '94px',  minWidth: '72px',  align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
  { key: 'trackers',      label: 'Trackers', width: '200px', minWidth: '140px', align: 'center', headerAlign: 'center', sortable: true, resizable: true, isVisible: false },
];
