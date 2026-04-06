import { layoutMinWidth } from './stores';

/**
 * Encapsulates bidirectional scroll-sync between <main> (native scrollbar hidden)
 * and the custom horizontal scrollbar div that starts at the sidebar's right edge.
 *
 * Usage in +layout.svelte:
 *   const scrollSync = createHorizontalScrollSync();
 *   <main bind:this={scrollSync.mainEl} ...>
 *   <div bind:this={scrollSync.syncScrollEl} ...>
 *     <div style="width: {scrollSync.syncScrollerWidth}; height: 1px;"></div>
 *   </div>
 */
export function createHorizontalScrollSync() {
  let mainEl = $state<HTMLElement | null>(null);
  let syncScrollEl = $state<HTMLElement | null>(null);

  // $store auto-subscription syntax is component-only; subscribe manually in .svelte.ts.
  // store.subscribe() returns its unsubscribe fn, which $effect accepts as cleanup.
  let _layoutMinWidth = $state('0px');
  $effect(() => layoutMinWidth.subscribe(val => { _layoutMinWidth = val; }));

  // Spacer width creates the same scroll range as <main>.
  // Derivation: spacerWidth = mainLeftPad(280) - sidebarWidth(256) + mainRightPad(24) + minTableWidth
  //           = 48 + minTableWidth = layoutMinWidth(256 + minTableWidth) - 208
  const syncScrollerWidth = $derived(`${Math.max(0, parseFloat(_layoutMinWidth) - 208)}px`);

  $effect(() => {
    if (!mainEl || !syncScrollEl) return;
    const main = mainEl;   // HTMLElement (narrowed — closures see non-null type)
    const sync = syncScrollEl;
    let busy = false;

    function onMainScroll() {
      if (busy) return;
      busy = true;
      const mainMax = main.scrollWidth - main.clientWidth;
      const syncMax = sync.scrollWidth - sync.clientWidth;
      if (mainMax > 0 && syncMax > 0) {
        sync.scrollLeft = (main.scrollLeft / mainMax) * syncMax;
      }
      busy = false;
    }

    function onSyncScroll() {
      if (busy) return;
      busy = true;
      const syncMax = sync.scrollWidth - sync.clientWidth;
      const mainMax = main.scrollWidth - main.clientWidth;
      if (syncMax > 0 && mainMax > 0) {
        main.scrollLeft = (sync.scrollLeft / syncMax) * mainMax;
      }
      busy = false;
    }

    main.addEventListener('scroll', onMainScroll, { passive: true });
    sync.addEventListener('scroll', onSyncScroll, { passive: true });
    return () => {
      main.removeEventListener('scroll', onMainScroll);
      sync.removeEventListener('scroll', onSyncScroll);
    };
  });

  return {
    get mainEl() { return mainEl; },
    set mainEl(el: HTMLElement | null) { mainEl = el; },
    get syncScrollEl() { return syncScrollEl; },
    set syncScrollEl(el: HTMLElement | null) { syncScrollEl = el; },
    get syncScrollerWidth() { return syncScrollerWidth; },
  };
}
