<script lang="ts">
  import { tick } from 'svelte';
  import {
    calculateHorizontalScrollbarMetrics,
    calculateScrollLeftFromDrag,
    calculateScrollLeftFromTrackClick
  } from './scrollbar.svelte.ts';

  interface Props {
    scrollElement?: HTMLElement | null;
    class?: string;
    leftOffsetClass?: string;
    bottomOffsetClass?: string;
  }

  let {
    scrollElement = null,
    class: classOverride = '',
    leftOffsetClass = 'left-64',
    bottomOffsetClass = 'bottom-1'
  }: Props = $props();

  let trackRef = $state<HTMLDivElement | null>(null);
  let thumbWidth = $state(0);
  let thumbOffset = $state(0);
  let showScrollbar = $state(false);
  let isVisible = $state(false);
  let isHovered = $state(false);
  let isDragging = $state(false);
  let dragStartX = $state(0);
  let dragStartScrollLeft = $state(0);
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  function clearHideTimeout() {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  }

  function revealScrollbar() {
    clearHideTimeout();
    if (showScrollbar) {
      isVisible = true;
    }
  }

  function scheduleHide() {
    clearHideTimeout();

    if (!showScrollbar || isHovered || isDragging) {
      return;
    }

    hideTimeout = setTimeout(() => {
      if (!isHovered && !isDragging) {
        isVisible = false;
      }
    }, 700);
  }

  function updateScrollbar() {
    const currentScrollElement = scrollElement;

    if (!currentScrollElement) {
      showScrollbar = false;
      thumbWidth = 0;
      thumbOffset = 0;
      return;
    }

    const metrics = calculateHorizontalScrollbarMetrics({
      scrollWidth: currentScrollElement.scrollWidth,
      clientWidth: currentScrollElement.clientWidth,
      scrollLeft: currentScrollElement.scrollLeft,
      trackWidth: trackRef?.clientWidth ?? 0
    });

    showScrollbar = metrics.showScrollbar;

    if (!showScrollbar) {
      clearHideTimeout();
      isVisible = false;
    }

    thumbWidth = metrics.thumbWidth;
    thumbOffset = metrics.thumbOffset;
  }

  function handleTrackMouseDown(event: MouseEvent) {
    const currentScrollElement = scrollElement;
    const currentTrack = trackRef;

    if (!currentScrollElement || !currentTrack) {
      return;
    }

    revealScrollbar();

    const rect = currentTrack.getBoundingClientRect();
    currentScrollElement.scrollLeft = calculateScrollLeftFromTrackClick({
      clickOffset: event.clientX - rect.left,
      trackWidth: rect.width,
      thumbWidth,
      scrollWidth: currentScrollElement.scrollWidth,
      clientWidth: currentScrollElement.clientWidth
    });
  }

  function handleThumbMouseDown(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    revealScrollbar();
    dragStartX = event.clientX;
    dragStartScrollLeft = scrollElement?.scrollLeft ?? 0;
    isDragging = true;
  }

  function handleMouseEnter() {
    isHovered = true;
    revealScrollbar();
  }

  function handleMouseLeave() {
    isHovered = false;
    scheduleHide();
  }

  $effect(() => {
    const currentScrollElement = scrollElement;

    if (!currentScrollElement) {
      return;
    }

    const syncScrollbar = () => updateScrollbar();
    const handleScroll = () => {
      syncScrollbar();
      revealScrollbar();
      scheduleHide();
    };
    const resizeObserver = new ResizeObserver(syncScrollbar);

    syncScrollbar();
    void tick().then(syncScrollbar);
    currentScrollElement.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', syncScrollbar);
    resizeObserver.observe(currentScrollElement);

    const contentElement = currentScrollElement.firstElementChild;
    if (contentElement instanceof HTMLElement) {
      resizeObserver.observe(contentElement);
    }

    return () => {
      clearHideTimeout();
      currentScrollElement.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', syncScrollbar);
      resizeObserver.disconnect();
    };
  });

  $effect(() => {
    if (!isDragging) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const currentScrollElement = scrollElement;
      const currentTrack = trackRef;

      if (!currentScrollElement || !currentTrack) {
        return;
      }

      currentScrollElement.scrollLeft = calculateScrollLeftFromDrag({
        deltaX: event.clientX - dragStartX,
        trackWidth: currentTrack.clientWidth,
        thumbWidth,
        startScrollLeft: dragStartScrollLeft,
        scrollWidth: currentScrollElement.scrollWidth,
        clientWidth: currentScrollElement.clientWidth
      });
    };

    const handleMouseUp = () => {
      isDragging = false;
      scheduleHide();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  });
</script>

{#if showScrollbar}
  <div
    role="presentation"
    class={`custom-horizontal-scrollbar hidden lg:block fixed ${leftOffsetClass} right-0 ${bottomOffsetClass} z-40 px-2 pb-0 ${classOverride} pointer-events-${isVisible || isDragging ? 'auto' : 'none'} ${isVisible ? 'is-visible' : ''} ${isHovered ? 'is-hovered' : ''} ${isDragging ? 'is-dragging' : ''}`}
    onmouseenter={handleMouseEnter}
    onmouseleave={handleMouseLeave}
  >
    <div
      bind:this={trackRef}
      role="presentation"
      class="custom-horizontal-scrollbar-track"
      onmousedown={handleTrackMouseDown}
    >
      <div
        role="presentation"
        class="custom-horizontal-scrollbar-thumb cursor-pointer"
        style={`width: ${thumbWidth}px; transform: translateX(${thumbOffset}px);`}
        onmousedown={handleThumbMouseDown}
      ></div>
    </div>
  </div>
{/if}
