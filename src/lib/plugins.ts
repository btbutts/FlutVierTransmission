// place files you want to import through the `$lib` alias in this folder.
// src/lib/plugins.ts
import type { Component } from 'svelte';
import Backburger from '~icons/mdi/backburger';
import Check from '~icons/mdi/check';
import Circle from '~icons/mdi/circle';
import CircleMedium from '~icons/mdi/circle-medium';
import CircleSmall from '~icons/mdi/circle-small';
import Close from '~icons/mdi/close';
import Cog from '~icons/mdi/cog';
import Cogs from '~icons/mdi/cogs';
import Delete from '~icons/mdi/delete';
import FileFind from '~icons/mdi/file-find';
import Forwardburger from '~icons/mdi/forwardburger';
import LanCheck from '~icons/mdi/lan-check';
import LanDisconnect from '~icons/mdi/lan-disconnect';
import Loading from '~icons/mdi/loading';
import Pause from '~icons/mdi/pause';
import Play from '~icons/mdi/play';
import Plus from '~icons/mdi/plus';
import Refresh from '~icons/mdi/refresh';
import TimerEdit from '~icons/mdi/timer-edit';
import Wan from '~icons/mdi/wan';

export { Play, Pause, Delete, Refresh, Plus, Cogs, Cog, Check, Close, Backburger, FileFind, Forwardburger, Loading, TimerEdit, LanCheck, LanDisconnect, Wan };

// Special export object to select icons by name for
// dropdown status indicators next to its selected options
export const DDSelectorStatusIcons = {
  CircleSmall,
  CircleMedium,
  Circle
} satisfies Record<string, Component<{ class?: string }>>;
export type DropdownStatusIconName = keyof typeof DDSelectorStatusIcons;
