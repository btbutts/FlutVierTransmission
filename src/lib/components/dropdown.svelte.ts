// src/lib/components/dropdown.svelte.ts
export interface DropdownOption<T = number> {
  value: T;
  label: string;
  visible?: boolean; // columns Visibility flag when setMDIstatusIcon provided
}

export interface UseDropdownProps<T = number> {
  initialValue?: T;
  options: () => DropdownOption<T>[];
  onChange?: (newValue: T) => void;
  stickyDummyValue?: () => T | undefined;
  sticky?: () => boolean;
  multiSelect?: () => boolean;
}

export function createDropdown<T = number>({
  initialValue,
  options,
  onChange = () => {},
  stickyDummyValue = () => undefined,
  sticky = () => false,
  multiSelect = () => false
}: UseDropdownProps<T>) {
  let value = $state<T>(initialValue as T);
  let open = $state(false);
  let buttonRef = $state<HTMLButtonElement | null>(null);

  // Track currently highlighted index for keyboard navigation
  let highlightedIndex = $state(0);

  const selectedLabel = $derived.by(() => {
    const dummyVal = stickyDummyValue();
    if (sticky() && dummyVal !== undefined) {
      return String(dummyVal);
    }
    return options().find((o) => o.value === value)?.label ?? 'Normal';
  });

  const currentOptions = $derived(options());

  function toggle() {
    open = !open;
    if (open) {
      // Reset highlight to currently selected option when opening
      const opts = currentOptions;
      highlightedIndex = opts.findIndex((o) => o.value === value);
      if (highlightedIndex === -1) highlightedIndex = 0;
    }
  }

  function selectOption(newValue: T) {
    onChange(newValue);
    const stickyDummy = stickyDummyValue();
    if (sticky() && stickyDummy !== undefined && newValue !== stickyDummy) {
      value = stickyDummy;
    } else {
      value = newValue;
    }
    if (!multiSelect()) {
      open = false;
      buttonRef?.focus(); // Return focus after selection
    }
  }

  function close() {
    const wasOpen = open;
    open = false;
    if (wasOpen) {
      buttonRef?.focus(); // Return focus when closing
    }
  }

  function setHighlightedIndex(index: number) {
    highlightedIndex = index;
  }

  // Sync internal value from an external prop change (no onChange fired)
  function sync(externalValue: T) {
    value = externalValue;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        close();
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (currentOptions.length > 0) {
          highlightedIndex = (highlightedIndex + 1) % currentOptions.length;
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (currentOptions.length > 0) {
          highlightedIndex = (highlightedIndex - 1 + currentOptions.length) % currentOptions.length;
        }
        break;

      case 'Enter':
      case ' ':
        e.preventDefault();
        if (currentOptions[highlightedIndex]) {
          selectOption(currentOptions[highlightedIndex].value);
        }
        break;

      case 'Home':
        e.preventDefault();
        highlightedIndex = 0;
        break;

      case 'End':
        e.preventDefault();
        highlightedIndex = currentOptions.length - 1;
        break;
    }
  }

  return {
    get value() {
      return value;
    },
    get open() {
      return open;
    },
    get buttonRef() {
      return buttonRef;
    },
    set buttonRef(node: HTMLButtonElement | null) {
      buttonRef = node;
    },
    get selectedLabel() {
      return selectedLabel;
    },
    get highlightedIndex() {
      return highlightedIndex;
    },

    // Actions
    toggle,
    selectOption,
    close,
    handleKeydown,
    setHighlightedIndex,
    sync,

    // Helpers
    options,
    isSelected: (optionValue: T) => value === optionValue,
    isHighlighted: (index: number) => index === highlightedIndex
  };
}
