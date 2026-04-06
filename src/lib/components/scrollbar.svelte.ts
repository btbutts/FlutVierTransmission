export interface HorizontalScrollbarMetrics {
    showScrollbar: boolean;
    thumbWidth: number;
    thumbOffset: number;
}

export interface HorizontalScrollbarGeometry {
    scrollWidth: number;
    clientWidth: number;
    scrollLeft: number;
    trackWidth: number;
    minThumbWidth?: number;
}

const DEFAULT_MIN_THUMB_WIDTH = 32;

export function calculateHorizontalScrollbarMetrics({
    scrollWidth,
    clientWidth,
    scrollLeft,
    trackWidth,
    minThumbWidth = DEFAULT_MIN_THUMB_WIDTH
}: HorizontalScrollbarGeometry): HorizontalScrollbarMetrics {
    const maxScrollLeft = scrollWidth - clientWidth;
    const showScrollbar = maxScrollLeft > 0;

    if (!showScrollbar || trackWidth <= 0) {
        return {
            showScrollbar,
            thumbWidth: 0,
            thumbOffset: 0
        };
    }

    const visibleRatio = clientWidth / scrollWidth;
    const thumbWidth = Math.max(minThumbWidth, trackWidth * visibleRatio);
    const maxThumbOffset = Math.max(0, trackWidth - thumbWidth);
    const thumbOffset = maxScrollLeft > 0
        ? (scrollLeft / maxScrollLeft) * maxThumbOffset
        : 0;

    return {
        showScrollbar,
        thumbWidth,
        thumbOffset
    };
}

export function calculateScrollLeftFromTrackClick({
    clickOffset,
    trackWidth,
    thumbWidth,
    scrollWidth,
    clientWidth
}: {
    clickOffset: number;
    trackWidth: number;
    thumbWidth: number;
    scrollWidth: number;
    clientWidth: number;
}): number {
    const maxThumbOffset = Math.max(0, trackWidth - thumbWidth);
    const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);

    if (maxThumbOffset <= 0 || maxScrollLeft <= 0) {
        return 0;
    }

    const targetThumbOffset = Math.min(
        Math.max(0, clickOffset - thumbWidth / 2),
        maxThumbOffset
    );

    return (targetThumbOffset / maxThumbOffset) * maxScrollLeft;
}

export function calculateScrollLeftFromDrag({
    deltaX,
    trackWidth,
    thumbWidth,
    startScrollLeft,
    scrollWidth,
    clientWidth
}: {
    deltaX: number;
    trackWidth: number;
    thumbWidth: number;
    startScrollLeft: number;
    scrollWidth: number;
    clientWidth: number;
}): number {
    const maxThumbOffset = Math.max(0, trackWidth - thumbWidth);
    const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);

    if (maxThumbOffset <= 0 || maxScrollLeft <= 0) {
        return startScrollLeft;
    }

    return startScrollLeft + (deltaX / maxThumbOffset) * maxScrollLeft;
}
