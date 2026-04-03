// src/lib/components/dropdown.svelte.ts
export interface DropdownOption {
    value: number;
    label: string;
}

export interface UseDropdownProps {
    initialValue?: number;
    options: () => DropdownOption[];
    onChange?: (newValue: number) => void;
}

export function createDropdown({
    initialValue = 0,
    options,
    onChange = () => {}
}: UseDropdownProps) {
    let value = $state(initialValue);
    let open = $state(false);
    let buttonRef = $state<HTMLButtonElement | null>(null);

    // Track currently highlighted index for keyboard navigation
    let highlightedIndex = $state(0);

    const selectedLabel = $derived(
        options().find((o) => o.value === value)?.label ?? 'Normal'
    );

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

    function selectOption(newValue: number) {
        if (newValue !== value) {
            value = newValue;
            onChange(newValue);
        }
        open = false;
        buttonRef?.focus(); // Return focus after selection
    }

    function close() {
        const wasOpen = open;
        open = false;
        if (wasOpen) {
            buttonRef?.focus(); // Return focus when closing
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        if (!open)
            return;

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

        // Helpers
        options,
        isSelected: (optionValue: number) => value === optionValue,
        isHighlighted: (index: number) => index === highlightedIndex
    };
}
