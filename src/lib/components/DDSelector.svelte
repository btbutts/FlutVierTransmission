<!-- src/lib/components/DDSelector.svelte -->
<script lang="ts" generics="T = string | number">
import { tick } from 'svelte';

import { DDSelectorStatusIcons, type DropdownStatusIconName } from '$lib/plugins';

import { createDropdown, type DropdownOption } from './dropdown.svelte.ts';

interface Props {
  /** Current value (two-way bindable) */
  value?: T;
  /** Available options */
  options?: DropdownOption<T>[];
  /** Called when the user selects a new option */
  onChange?: (newValue: T) => void;
  /** Optional Tailwind classes for root div (overrides defaults like w-20 mx-auto) */
  class?: string;
  /** If true, reset to dummyValue after selecting a non-dummy option (label returns to dummy) */
  stickyDropdownTitle?: boolean;
  /** Value of the dummy option to reset to (required if stickyDropdownTitle=true) */
  dummyValue?: T;
  /** If true, stay open after selections (close only on outside-click/Esc) */
  enableMultiSelect?: boolean;
  /** MDI icon name (e.g., 'CircleSmall') for status indicator (shows if option.visible=true) */
  setMDIstatusIcon?: DropdownStatusIconName;
  /** Optional additional classes for the MDI status icon */
  iconClass?: string;
  /** Optional Set the dropdown height */
  dropdownHeight?: string;
  /** Optional Set the dropdown text size (does not affect dropdown options list) */
  dropdownBtnTxtSize?: string;
}

let {
  value = $bindable<T>(undefined as T),
  options: propOptions = [
    { value: -2, label: 'Skip' },
    { value: -1, label: 'Low' },
    { value: 0, label: 'Normal' },
    { value: 1, label: 'High' }
  ] as DropdownOption<T>[],
  onChange = () => {},
  class: classOverride = '', // Optional root classes (defaults empty → no override)
  stickyDropdownTitle = false, // If true, resets to dummyValue after selection
  dummyValue, // Required if stickyDropdownTitle=true; the value to reset to after selection
  enableMultiSelect = false, // If true, dropdown stays open after selection (closes only on outside click or Esc)
  setMDIstatusIcon, // MDI icon name for status indicator (e.g., 'CircleSmall')
  iconClass: iconClasses = '', // Optional additional classes for the MDI status icon
  dropdownHeight: DDHeightOverride = 'p-1.5', // Optional dropdown height
  dropdownBtnTxtSize: DDTextSizeOverride = 'text-xs' // Optional dropdown text size
}: Props = $props();

let rootRef = $state<HTMLDivElement | null>(null);
let listRef = $state<HTMLDivElement | null>(null);
let menuStyle = $state('');

const StatusIconComp = $derived.by(() =>
  setMDIstatusIcon ? (DDSelectorStatusIcons[setMDIstatusIcon] ?? null) : null
);

// Create the dropdown logic instance
const dropdown = createDropdown({
  initialValue: value,
  options: () => propOptions,
  stickyDummyValue: () => dummyValue,
  sticky: () => stickyDropdownTitle,
  multiSelect: () => enableMultiSelect,
  onChange: (newVal) => {
    onChange(newVal);
    const finalValue =
      stickyDropdownTitle && dummyValue !== undefined && newVal !== dummyValue
        ? dummyValue
        : newVal;
    value = finalValue as T;
  }
});

function menuPopUp(node: HTMLElement) {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    }
  };
}

function updateMenuPosition() {
  const button = dropdown.buttonRef;
  if (!button) {
    return;
  }

  const rect = button.getBoundingClientRect();
  menuStyle = `top: ${rect.top}px; left: ${rect.left}px; min-width: ${rect.width}px; width: max-content;`;
}

// Sync internal dropdown value when the value prop changes externally
$effect(() => {
  dropdown.sync(value);
});

// Outside click handler
$effect(() => {
  if (!dropdown.open) {
    return;
  }

  const handleDocumentClick = (event: MouseEvent) => {
    const target = event.target as Node;
    const clickedTrigger = rootRef?.contains(target) ?? false;
    const clickedMenu = listRef?.contains(target) ?? false;

    if (!clickedTrigger && !clickedMenu) {
      dropdown.close();
    }
  };

  document.addEventListener('click', handleDocumentClick, { capture: true });
  return () => {
    document.removeEventListener('click', handleDocumentClick, { capture: true });
  };
});

// Auto-scroll highlighted item into view when it changes
$effect(() => {
  if (dropdown.open && listRef && dropdown.highlightedIndex >= 0) {
    const highlightedEl = listRef.children[dropdown.highlightedIndex] as HTMLElement;
    highlightedEl?.scrollIntoView({ block: 'nearest' });
  }
});

// Keep the portaled menu positioned over the trigger button.
$effect(() => {
  if (!dropdown.open) {
    return;
  }

  const syncPosition = () => updateMenuPosition();

  syncPosition();
  void tick().then(() => {
    syncPosition();
    listRef?.focus();
  });

  window.addEventListener('resize', syncPosition);
  window.addEventListener('scroll', syncPosition, true);
  return () => {
    window.removeEventListener('resize', syncPosition);
    window.removeEventListener('scroll', syncPosition, true);
  };
});
</script>

<div class="relative w-25 {classOverride}" bind:this={rootRef}>
  <button
    bind:this={dropdown.buttonRef}
    onclick={dropdown.toggle}
    onkeydown={dropdown.handleKeydown}
    aria-haspopup="listbox"
    aria-expanded={dropdown.open}
    class="w-full {DDHeightOverride} bg-ColorPalette-bg-tertiary/90 flex items-center justify-between rounded-md
           border border-gray-300 {DDTextSizeOverride}
           focus:border-ColorPalette-input-ring-focus-primary focus:ring-ColorPalette-input-ring-focus-primary text-gray-900
           transition-all hover:bg-gray-50 focus:ring-2 focus:outline-none dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-600"
  >
    <span class="truncate">{dropdown.selectedLabel}</span>
    <svg
      xmlns="http://www.w3.org/2000/svg"
      class="h-3 w-3 transition-transform {dropdown.open ? 'rotate-180' : ''}"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  {#if dropdown.open}
    <div
      use:menuPopUp
      class="fixed z-[80] max-h-60 overflow-hidden overflow-y-auto rounded-md border
          border-gray-300/70 bg-white/95 py-1 text-xs shadow-2xl backdrop-blur-sm dark:border-gray-700/60 dark:bg-gray-800/90"
      style={menuStyle}
      role="listbox"
      tabindex={-1}
      onkeydown={dropdown.handleKeydown}
      bind:this={listRef}
    >
      {#each dropdown.options() as option, index (option.value)}
        <button
          onclick={() => dropdown.selectOption(option.value)}
          role="option"
          aria-selected={dropdown.isSelected(option.value)}
          onmouseenter={() => dropdown.setHighlightedIndex(index)}
          class="flex w-full items-center gap-2 bg-transparent px-3 py-1.5 text-left transition-colors hover:bg-gray-100/40
                 dark:hover:bg-gray-700/30 {dropdown.isSelected(option.value) ||
          (setMDIstatusIcon && option.visible)
            ? 'font-medium text-blue-600 dark:text-blue-400'
            : dropdown.isHighlighted(index)
              ? 'bg-gray-100/40 text-gray-900 dark:bg-gray-700/30 dark:text-gray-100'
              : 'text-gray-900 dark:text-gray-100'}"
        >
          {#if setMDIstatusIcon}
            <!-- NEW: MDI status icon mode (reserves space, shows if option.visible === true) -->
            <span
              class="flex w-4 shrink-0 items-center justify-center text-blue-600 dark:text-blue-400"
            >
              {#if option.visible && StatusIconComp}
                <StatusIconComp class={iconClasses} />
              {/if}
            </span>
          {:else}
            <!-- DEFAULT: ✓ checkmark for single-select -->
            {#if dropdown.isSelected(option.value)}
              <span class="w-4 shrink-0 text-center text-blue-600 dark:text-blue-400">✓</span>
            {:else}
              <span class="w-4 shrink-0"></span>
            {/if}
          {/if}
          <span>{option.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
