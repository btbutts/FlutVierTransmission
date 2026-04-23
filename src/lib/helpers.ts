// This file is for general helper functions that don't fit into a specific category like stores or components.
// It can be imported by any other module in the project without creating circular dependencies.
// src/lib/helpers.ts

// Example helper function to create a pop-up element that is appended to the document body
export function windowPopUp(node: HTMLElement) {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    }
  };
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return bytesPerSec > 0 ? formatBytes(bytesPerSec) + '/s' : '—';
}
