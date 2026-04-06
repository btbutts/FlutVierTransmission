// place files you want to import through the `$lib` alias in this folder.
// src/lib/plugins.ts
import type { Component } from 'svelte';
import Play from '~icons/mdi/play';
import Pause from '~icons/mdi/pause';
import Delete from '~icons/mdi/delete';
import Refresh from '~icons/mdi/refresh';
import Plus from '~icons/mdi/plus';
import CircleSmall from '~icons/mdi/circle-small';
import CircleMedium from '~icons/mdi/circle-medium';
import Circle from '~icons/mdi/circle';

export { Play, Pause, Delete, Refresh, Plus };

// Special export object to select icons by name for
// dropdown status indicators next to its selected options
export const DDSelectorStatusIcons = {
	CircleSmall,
    CircleMedium,
    Circle,
} satisfies Record<string, Component<{ class?: string }>>;
export type DropdownStatusIconName = keyof typeof DDSelectorStatusIcons;
