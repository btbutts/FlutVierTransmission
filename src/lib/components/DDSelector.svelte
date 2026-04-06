<!-- src/lib/components/DDSelector.svelte -->
<script lang="ts" generics="T = string | number">
  import { tick } from 'svelte';
  import { createDropdown, type DropdownOption } from './dropdown.svelte.ts';
  import { DDSelectorStatusIcons, type DropdownStatusIconName } from '$lib/plugins';

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
    class: classOverride = '',    // Optional root classes (defaults empty → no override)
    stickyDropdownTitle = false,  // If true, resets to dummyValue after selection
    dummyValue,                   // Required if stickyDropdownTitle=true; the value to reset to after selection
    enableMultiSelect = false,    // If true, dropdown stays open after selection (closes only on outside click or Esc)
    setMDIstatusIcon,             // MDI icon name for status indicator (e.g., 'CircleSmall')
    iconClass: iconClasses = ''     // Optional additional classes for the MDI status icon
  }: Props = $props();

  let rootRef = $state<HTMLDivElement | null>(null);
  let listRef = $state<HTMLDivElement | null>(null);
  let menuStyle = $state('');

  const StatusIconComp = $derived.by(
    () => (setMDIstatusIcon ? DDSelectorStatusIcons[setMDIstatusIcon] ?? null : null)
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
      const finalValue = stickyDropdownTitle && dummyValue !== undefined && newVal !== dummyValue
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
    menuStyle = `top: ${rect.top}px; left: ${rect.left}px; width: ${rect.width}px;`;
  }

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

    document.addEventListener('click', handleDocumentClick);
    return () => {
      document.removeEventListener('click', handleDocumentClick);
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


<div class="relative w-20 mx-auto {classOverride}" bind:this={rootRef}>
  <button
    bind:this={dropdown.buttonRef}
    onclick={dropdown.toggle}
    onkeydown={dropdown.handleKeydown}
    aria-haspopup="listbox"
    aria-expanded={dropdown.open}
    class="w-full p-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-xs
           bg-white/90 dark:bg-gray-700/90 text-gray-900 dark:text-gray-100
           focus:ring-2 focus:ring-blue-500 focus:border-blue-500
           transition-all flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-600"
  >
    <span class="truncate">{dropdown.selectedLabel}</span>
    <svg
      xmlns="http://www.w3.org/2000/svg"
      class="w-3 h-3 transition-transform {dropdown.open ? 'rotate-180' : ''}"
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
        class="fixed z-[80] bg-white/95 dark:bg-gray-800/90 border border-gray-300/70 dark:border-gray-700/60
          rounded-md shadow-2xl py-1 text-xs overflow-hidden max-h-60 overflow-y-auto backdrop-blur-sm"
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
          aria-selected={dropdown.isSelected(option.value)}          onmouseenter={() => dropdown.setHighlightedIndex(index)}          class="w-full px-3 py-1.5 text-left flex items-center gap-2 bg-transparent hover:bg-gray-100/40 dark:hover:bg-gray-700/30
                 transition-colors {(dropdown.isSelected(option.value) || (setMDIstatusIcon && option.visible))
                    ? 'text-blue-600 dark:text-blue-400 font-medium'
                    : dropdown.isHighlighted(index)
                      ? 'bg-gray-100/40 dark:bg-gray-700/30 text-gray-900 dark:text-gray-100'
                      : 'text-gray-900 dark:text-gray-100'}"
        >
          {#if setMDIstatusIcon}
            <!-- NEW: MDI status icon mode (reserves space, shows if option.visible === true) -->
            <span class="w-4 shrink-0 flex items-center justify-center text-blue-600 dark:text-blue-400">
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
