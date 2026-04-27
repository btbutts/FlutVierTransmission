<!-- src/lib/components/BandwidthGraph.svelte -->
<script lang="ts">
import { onMount } from 'svelte';
import { get } from 'svelte/store';
import { bandwidthHistory, bandwidthLastPollTime, session } from '$lib';

import { ArrowDownBox, ArrowUpBox, Close } from '$lib/plugins';

import FlyStretchAnimationWrapper from './FlyStretchAnimWrapper.svelte';
import LoadingArcSpinner from './LoadingArcSpinner.svelte';
import Tooltip from './Tooltip.svelte';

// ── Constants ──────────────────────────────────────────────────────────────────
const GRAPH_H = 78;
const GRAPH_MT = 10; // top margin — keeps peak data points from touching the SVG ceiling
const GRAPH_MB = 4; // bottom margin — space between the zero line (base) and the SVG bottom
const MIN_WIN = 60;
const MAX_WIN = 43200; // 12 hours
const DEF_WIN = 300; // 5 minutes
const MAX_PTS = 300; // max visual points before aggregation kicks in
const ANIM_MS = 420;
const HINT_DELAY = 1500;

// ── State ──────────────────────────────────────────────────────────────────────
let containerEl = $state<HTMLDivElement | null>(null);
let sidebarSvgEl = $state<SVGSVGElement | null>(null);
let modalSvgEl = $state<SVGSVGElement | null>(null);
let svgCtnrW = $state(0);
let modalCtnrW = $state(0);

let timeWin = $state(DEF_WIN);
// panEndTimestamp: absolute ms timestamp of the right edge of the panned view.
// null = live mode (default). When set, the graph slice is anchored to this timestamp
// so new live data arriving never shifts the historical view.
let panEndTimestamp = $state<number | null>(null);
let hovering = $state(false);
let mxRatio = $state<number | null>(null);
let animOff = $state(0);
// Smoothly-animated Y-scale ceiling (bytes/sec). Rises fast on spikes, decays slowly.
let displayMaxV = $state(1);
// Smoothly-animated Y-scale floor (bytes/sec). Falls fast when values drop (to never clip
// low values), rises slowly when all visible data is consistently high (gradual zoom-in).
let displayMinV = $state(0);

// Non-reactive helpers for the rAF loop (avoid reactive overhead)
let _latestMaxV = 1; // target for displayMaxV, written by $effect
let _latestMinV = 0; // target for displayMinV, written by $effect
let _lastTick = 0; // timestamp of previous rAF tick, for dt calculation
let rafId = 0;

let showHint = $state(false);
let hintTimer: ReturnType<typeof setTimeout> | null = null;
// Viewport coordinates for the sidebar hint tooltip — computed when the hint timer fires
// so the tooltip is positioned relative to wherever the graph sits at that moment.
let tooltipPos = $state({ x: 0, y: 0 });

let modalOpen = $state(false);

// ── Data aggregation with zero-fill ───────────────────────────────────────────
// Slices history according to the current time window and pan anchor, then
// zero-fills the left so the graph has a stable pixel-per-point ratio.
const aggData = $derived.by(() => {
  const h = $bandwidthHistory;
  if (!h.length) {
    return { dl: [] as number[], ul: [] as number[], ts: [] as (number | null)[], bsz: 1, minV: 0 };
  }

  // When panned, binary-search for the first index whose timestamp exceeds the anchor.
  // This makes the slice fixed to an absolute point in time — new live samples arriving
  // never shift the historical view.
  let endIdx: number;
  if (panEndTimestamp !== null) {
    let lo = 0,
      hi = h.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (h[mid].timestamp <= panEndTimestamp) lo = mid + 1;
      else hi = mid;
    }
    endIdx = lo; // exclusive: count of samples with timestamp ≤ panEndTimestamp
  } else {
    endIdx = h.length; // live mode: include all samples
  }

  const startIdx = Math.max(0, endIdx - timeWin); // inclusive
  const sl = h.slice(startIdx, endIdx);

  const bsz = Math.max(1, Math.ceil(sl.length / MAX_PTS));

  let dl: number[], ul: number[], ts: (number | null)[];

  if (bsz === 1) {
    dl = sl.map((p) => p.download);
    ul = sl.map((p) => p.upload);
    ts = sl.map((p) => p.timestamp);
  } else {
    dl = [];
    ul = [];
    ts = [];
    for (let i = 0; i < sl.length; i += bsz) {
      const b = sl.slice(i, i + bsz);
      const n = b.length;
      dl.push(b.reduce((s, p) => s + p.download, 0) / n);
      ul.push(b.reduce((s, p) => s + p.upload, 0) / n);
      ts.push(b[0].timestamp);
    }
  }

  // Zero-fill left side to fill the full visible time window
  const targetLen = Math.ceil(timeWin / bsz);
  const padLen = Math.max(0, targetLen - dl.length);
  if (padLen > 0) {
    dl = [...Array<number>(padLen).fill(0), ...dl];
    ul = [...Array<number>(padLen).fill(0), ...ul];
    ts = [...Array<number | null>(padLen).fill(null), ...ts];
  }

  // Minimum value across the visible slice — used to compute the adaptive Y baseline.
  const minV = dl.length > 0 ? Math.min(...dl, ...ul) : 0;

  return { dl, ul, ts, bsz, minV };
});

// Timestamp of the right edge of the currently-displayed window for the center label.
// Simply mirrors panEndTimestamp — non-null only when panned.
const panRightEdgeTs = $derived(panEndTimestamp);

// Update _latestMaxV/_latestMinV whenever aggregated data changes.
// 5% headroom keeps the peak near the top without wasting space.
// Adaptive baseline: when all visible values are comfortably above zero (> 20% of peak),
// displayMinV rises slowly toward minV×0.85, zooming the Y-range so small ups and
// downs become visible. When any zeros are present the baseline snaps back to 0.
$effect(() => {
  if (!aggData.dl.length) {
    _latestMaxV = 1;
    _latestMinV = 0;
    return;
  }
  const raw = Math.max(1, ...aggData.dl, ...aggData.ul);
  _latestMaxV = raw * 1.05;
  // Snap immediately on the first real data so the scale doesn't slowly ramp up.
  if (displayMaxV <= 1 && raw > 1) displayMaxV = _latestMaxV;

  const minRaw = aggData.minV;
  _latestMinV = minRaw > 0 && minRaw > raw * 0.2 ? minRaw * 0.85 : 0;
  // When zeros return to the visible window, snap the baseline to 0 immediately
  // so the graph never clips real zero-valued data below the floor.
  if (_latestMinV === 0 && displayMinV > 0) displayMinV = 0;
});

// ── Live displayed values (nearest actual sample or latest received) ──────────
// When hovering, the counters snap to the nearest ACTUAL sampled data point rather
// than linearly interpolating between two neighbours — interpolated values would
// be estimates, not real measurements.
const live = $derived.by(() => {
  const { dl, ul, ts } = aggData;
  const h = $bandwidthHistory;
  if (hovering && mxRatio !== null && dl.length > 1) {
    const n = dl.length - 1;
    const fi = mxRatio * n;
    const lo = Math.max(0, Math.min(n - 1, Math.floor(fi)));
    const hi = Math.min(n, lo + 1);
    const fr = fi - lo;
    // Snap to whichever sampled point the cursor is closest to.
    const nearest = fr < 0.5 ? lo : hi;
    return {
      dl: dl[nearest],
      ul: ul[nearest],
      ts: ts[nearest],
      isHover: true
    };
  }
  const lat = h[h.length - 1];
  return {
    dl: lat?.download ?? 0,
    ul: lat?.upload ?? 0,
    ts: null as number | null,
    isHover: false
  };
});

const altSpeedOn = $derived(Boolean($session['alt-speed-enabled']));

// ── Format helpers ─────────────────────────────────────────────────────────────
function fmtBps(bytesPerSec: number): [string, string] {
  if (bytesPerSec < 1e3) return [bytesPerSec.toFixed(0), 'B/s'];
  if (bytesPerSec < 1e6) return [(bytesPerSec / 1e3).toFixed(1), 'KB/s'];
  if (bytesPerSec < 1e9) return [(bytesPerSec / 1e6).toFixed(1), 'MB/s'];
  return [(bytesPerSec / 1e9).toFixed(2), 'GB/s'];
}

// "Time since" a timestamp — follows the same plurality style as formatEta in helpers.ts
function timeSince(ms: number | null): string {
  if (ms === null) return '';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s <= 60) return `${s} sec ago`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) {
    return sec === 0 ? `${m} min ago` : `${m} min ${sec} sec ago`;
  }
  const h = Math.floor(m / 60);
  const min = m % 60;
  const hLabel = h === 1 ? 'hr' : 'hrs';
  return min === 0 ? `${h} ${hLabel} ago` : `${h} ${hLabel} ${min} min ago`;
}

function fmtWin(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

// ── Catmull-Rom smooth curve ───────────────────────────────────────────────────
const TENSION = 0.35;
const f = (n: number) => n.toFixed(1);

function curvePath(pts: [number, number][]): string {
  if (!pts.length) return '';
  if (pts.length === 1) return `M ${f(pts[0][0])},${f(pts[0][1])}`;
  let d = `M ${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i],
      p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) * TENSION;
    const c1y = p1[1] + (p2[1] - p0[1]) * TENSION;
    const c2x = p2[0] - (p3[0] - p1[0]) * TENSION;
    const c2y = p2[1] - (p3[1] - p1[1]) * TENSION;
    d += ` C ${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}

// ── SVG path builder ───────────────────────────────────────────────────────────
// Y-scale uses the animated [displayMinV, displayMaxV] range.
// displayMinV provides an adaptive floor: when all visible data is well above zero
// the floor rises slowly, zooming in so small ups and downs become visible.
// anim: scroll animation offset (0–1); pass 0 when panned so history is static.
function buildPaths(W: number, H: number, anim: number) {
  const { dl, ul } = aggData;
  if (dl.length < 2) return null;

  const n = dl.length - 1;
  const ppx = W / Math.max(1, n);
  const mt = GRAPH_MT,
    mb = GRAPH_MB,
    ch = H - mt - mb;
  const base = H - mb;
  const xOff = anim * ppx;

  // Map value v into the [displayMinV, displayMaxV] range.
  // Values below displayMinV render below base and are hidden by the clipPath.
  const scaledMin = displayMinV;
  const scaledMax = displayMaxV;
  const range = Math.max(1, scaledMax - scaledMin);
  const yOf = (v: number) => mt + ch * (1 - (Math.min(v, scaledMax) - scaledMin) / range);

  let dlP: [number, number][] = dl.map((v, i) => [i * ppx - xOff, yOf(v)]);
  let ulP: [number, number][] = ul.map((v, i) => [i * ppx - xOff, yOf(v)]);

  // Extend the last point horizontally to the right edge so the graph never
  // shows an empty strip on the right during the inter-poll scroll animation.
  const rX = dlP[dlP.length - 1][0];
  if (rX < W) {
    dlP = [...dlP, [W, dlP[dlP.length - 1][1]]];
    ulP = [...ulP, [W, ulP[ulP.length - 1][1]]];
  }

  const areaOf = (pts: [number, number][]) => {
    const ln = curvePath(pts);
    const last = pts[pts.length - 1],
      first = pts[0];
    return `${ln} L ${f(last[0])},${f(base)} L ${f(first[0])},${f(base)} Z`;
  };

  return {
    dlLine: curvePath(dlP),
    ulLine: curvePath(ulP),
    dlArea: areaOf(dlP),
    ulArea: areaOf(ulP),
    ppx // expose so getCH can share the same coordinate math
  };
}

// ── Hover crosshair ────────────────────────────────────────────────────────────
// anim must match the value passed to buildPaths for the same frame.
function getCH(W: number, H: number, anim: number) {
  if (!hovering || mxRatio === null) return null;
  const { dl, ul } = aggData;
  if (dl.length < 2) return null;

  const n = dl.length - 1;
  const ppx = W / Math.max(1, n);
  const mt = GRAPH_MT,
    mb = GRAPH_MB,
    ch = H - mt - mb;
  const scaledMin = displayMinV;
  const scaledMax = displayMaxV;
  const range = Math.max(1, scaledMax - scaledMin);
  const yOf = (v: number) => mt + ch * (1 - (Math.min(v, scaledMax) - scaledMin) / range);

  const x = mxRatio * W;
  const xOff = anim * ppx;
  const fi = (x + xOff) / ppx;
  const lo = Math.max(0, Math.min(n - 1, Math.floor(fi)));
  const hi = Math.min(n, lo + 1);
  const fr = fi - lo;

  // Snap crosshair dots to the nearest actual data point, matching the counters.
  const nearest = fr < 0.5 ? lo : hi;
  return {
    x,
    dlY: yOf(dl[nearest]),
    ulY: yOf(ul[nearest])
  };
}

// ── Svelte actions ─────────────────────────────────────────────────────────────
function nonPassiveWheel(node: HTMLElement, handler: (e: WheelEvent) => void) {
  let h = handler;
  const listener = (e: WheelEvent) => h(e);
  node.addEventListener('wheel', listener, { passive: false });
  return {
    update: (f: (e: WheelEvent) => void) => {
      h = f;
    },
    destroy: () => node.removeEventListener('wheel', listener)
  };
}

function addDblClick(node: HTMLElement, handler: () => void) {
  let h = handler;
  const listener = () => h();
  node.addEventListener('dblclick', listener);
  return {
    update: (f: () => void) => {
      h = f;
    },
    destroy: () => node.removeEventListener('dblclick', listener)
  };
}

// ── Event handlers ─────────────────────────────────────────────────────────────
function onEnter() {
  hovering = true;
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    if (containerEl) {
      // The sidebar <aside> has backdrop-filter, which creates a new CSS containing block
      // for position:fixed children. This means the Tooltip's `top/left` are relative to
      // the sidebar's own origin, not the viewport. We subtract the sidebar's viewport rect
      // so our viewport-relative calculations produce correct sidebar-relative CSS values.
      const sidebarEl = containerEl.closest('aside') as HTMLElement | null;
      const sidebarRect = sidebarEl?.getBoundingClientRect() ?? { top: 0, left: 0 };

      const cR = containerEl.getBoundingClientRect();
      // Vertical range: from the top of the counters readout (skipping the badge slot
      // which is h-5 = 20 px + mb-1 = 4 px = 24 px) to the very bottom of the SVG.
      const badgeSlotH = 24;
      const rangeTopVp = cR.top + badgeSlotH; // viewport-relative top of readout counters
      const rangeBottomVp = cR.bottom;         // viewport-relative bottom of SVG

      // 100 px is a generous estimate used only for the clamp; the actual tooltip is ~83 px.
      const tooltipH = 100;
      const idealYVp = (rangeTopVp + rangeBottomVp) / 2 - tooltipH / 2;
      const clampedYVp = Math.max(
        sidebarRect.top + 8,
        Math.min(idealYVp, window.innerHeight - tooltipH - 8)
      );

      tooltipPos = {
        x: cR.right + 8 - sidebarRect.left, // sidebar-relative (left=0 so no change)
        y: clampedYVp - sidebarRect.top      // sidebar-relative y
      };
    }
    showHint = true;
  }, HINT_DELAY);
}

function onLeave() {
  hovering = false;
  mxRatio = null;
  showHint = false;
  if (hintTimer) {
    clearTimeout(hintTimer);
    hintTimer = null;
  }
}

function onSidebarMove(e: MouseEvent) {
  if (!sidebarSvgEl) return;
  const r = sidebarSvgEl.getBoundingClientRect();
  mxRatio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
}

function onModalMove(e: MouseEvent) {
  if (!modalSvgEl) return;
  const r = modalSvgEl.getBoundingClientRect();
  mxRatio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  if (e.ctrlKey) {
    // Hold Control + scroll up/down = zoom (change the visible time window)
    if (e.deltaY !== 0) {
      timeWin = Math.max(
        MIN_WIN,
        Math.min(MAX_WIN, Math.round(timeWin * (e.deltaY > 0 ? 1.15 : 0.87)))
      );
    }
  } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    // Plain horizontal scroll = pan through history.
    // deltaX is in CSS pixels; scale so one full-width swipe shifts by one time window.
    const h = get(bandwidthHistory);
    if (!h.length) return;
    const W = (modalOpen ? modalCtnrW : svgCtnrW) || 256;
    // Current right-edge timestamp (live edge when not yet panned)
    const currentEnd = panEndTimestamp ?? h[h.length - 1].timestamp;
    // Shift in ms proportional to the scroll distance and current window size
    const deltaMs = (e.deltaX * timeWin * 1000) / W;
    // Scroll right (deltaX > 0) = go back in time = subtract ms from the anchor
    const newEnd = currentEnd - deltaMs;
    // Clamp: oldest sensible anchor is the timestamp of the timeWin-th sample from the start
    const oldestEnd = h[Math.min(timeWin, h.length - 1)].timestamp;
    const latestTs = h[h.length - 1].timestamp;
    const clamped = Math.max(oldestEnd, Math.min(latestTs, newEnd));
    // If the anchor is within one poll interval of the live edge, snap back to live mode
    panEndTimestamp = clamped >= latestTs - 1100 ? null : clamped;
  }
  // Plain vertical scroll (no Ctrl): no effect on the graph.
}

// ── rAF animation loop ─────────────────────────────────────────────────────────
// Runs independently of RPC calls — graph animation is never blocked by network I/O.
onMount(() => {
  _lastTick = Date.now();

  const tick = () => {
    const now = Date.now();
    // Cap dt at 100 ms to recover gracefully when the tab loses focus.
    const dt = Math.min(0.1, (now - _lastTick) / 1000);
    _lastTick = now;

    // Smooth scroll offset: 0 → 1 over the course of one poll interval (1 second).
    animOff = Math.min(1, (now - get(bandwidthLastPollTime)) / 1000);

    // Y ceiling: snaps up fast on spikes (6×/s ≈ 250 ms), falls back in ~500 ms (4.5×/s).
    const diff = _latestMaxV - displayMaxV;
    displayMaxV += diff * Math.min(1, (diff > 0 ? 6.0 : 4.5) * dt);

    // Y floor (adaptive baseline): snaps down immediately when values drop (6×/s),
    // zooms in within ~500 ms when all visible values stay high (4.5×/s).
    const minDiff = _latestMinV - displayMinV;
    if (minDiff !== 0) displayMinV += minDiff * Math.min(1, (minDiff < 0 ? 6.0 : 4.5) * dt);

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(rafId);
    if (hintTimer) clearTimeout(hintTimer);
  };
});
</script>

<!-- ── Sidebar graph container ─────────────────────────────────────────────────
     NOTE: The parent wrapper in +layout.svelte uses -mx-6 so this component fills
     the full sidebar width (viewport left edge → sidebar right border).
     Not rendered until the first bandwidth poll arrives so the sidebar never
     shows an empty graph shell. Hidden while the expanded modal is open so
     the sidebar graph doesn't bleed through behind the modal overlay.
──────────────────────────────────────────────────────────────────────────────── -->
{#if $bandwidthHistory.length > 0}
  <div
    bind:this={containerEl}
    class="w-full select-none"
    role="img"
    aria-label="Bandwidth graph"
    style="visibility: {modalOpen ? 'hidden' : 'visible'};"
    use:nonPassiveWheel={onWheel}
    use:addDblClick={() => {
      modalOpen = true;
    }}
    onmouseenter={onEnter}
    onmouseleave={onLeave}
    onmousemove={onSidebarMove}
  >
    <!-- Alt speed badge — fixed-height slot, first in the component so it appears
         above the upload/download counters. Reserving space here keeps all elements
         below it (counters + SVG) at a stable position whether alt-speed is on or off. -->
    <div class="mb-1 flex h-5 items-center justify-center px-6">
      {#if altSpeedOn}
        <span
          class="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
        >
          Alt Speed Active
        </span>
      {/if}
    </div>

    <!-- Speed readout block — padded to sit within the sidebar's content margin.
       Row 1: download counter (left) + upload counter (right).
       Row 2: centered timestamp/zoom label in a fixed-height slot so layout never shifts. -->
    <div class="px-6 text-xs">
      <div class="flex items-center justify-between">
        <!-- Download: [icon] [value] [unit] -->
        <div class="flex items-center gap-0.5">
          <ArrowDownBox class="h-3.5 w-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
          <span class="text-sm font-semibold text-blue-500 dark:text-blue-400"
            >{fmtBps(live.dl)[0]}</span
          >
          <span class="text-blue-400/60 dark:text-blue-500/60">{fmtBps(live.dl)[1]}</span>
        </div>
        <!-- Upload: [value] [unit] [icon] -->
        <div class="flex items-center gap-0.5">
          <span class="text-sm font-semibold text-purple-500 dark:text-purple-400"
            >{fmtBps(live.ul)[0]}</span
          >
          <span class="text-purple-400/60 dark:text-purple-500/60">{fmtBps(live.ul)[1]}</span>
          <ArrowUpBox class="h-3.5 w-3.5 shrink-0 text-purple-500 dark:text-purple-400" />
        </div>
      </div>
      <!-- Fixed-height row so the graph position is stable whether or not text is shown.
         Priority: hover-point time → panned-view right-edge time → zoom-window when hovering. -->
      <div class="mt-0.5 mb-1 h-3.5 text-center leading-none" aria-live="polite">
        {#if live.isHover && live.ts !== null}
          <span class="text-ColorPalette-text-quarternary italic">{timeSince(live.ts)}</span>
        {:else if panRightEdgeTs !== null}
          <span class="text-ColorPalette-text-quarternary italic">{timeSince(panRightEdgeTs)}</span>
        {:else if hovering}
          <span class="text-ColorPalette-text-quarternary">{fmtWin(timeWin)}</span>
        {/if}
      </div>
    </div>

    <!-- SVG graph — no horizontal padding; fills full sidebar width.
         Sits at the very bottom of the component so GRAPH_MB (4 px zero-margin) aligns
         with the sidebar's pb-3 (12 px) to place the graph zero-line 16 px from the
         viewport bottom — matching the PrimaryTable's py-4 bottom padding. -->
    <div bind:clientWidth={svgCtnrW} class="w-full">
      {#if svgCtnrW > 0}
        {@const anim = panEndTimestamp !== null ? 0 : animOff}
        {@const P = buildPaths(svgCtnrW, GRAPH_H, anim)}
        {@const CH = getCH(svgCtnrW, GRAPH_H, anim)}
        {@const rawMax = aggData.dl.length ? Math.max(...aggData.dl, ...aggData.ul) : 0}
        <svg
          bind:this={sidebarSvgEl}
          width={svgCtnrW}
          height={GRAPH_H}
          class="block"
          style="overflow: hidden;"
        >
          <defs>
            <linearGradient id="bw-dl-sb" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.28" />
              <stop offset="100%" stop-color="#3b82f6" stop-opacity="0" />
            </linearGradient>
            <linearGradient id="bw-ul-sb" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#a855f7" stop-opacity="0.28" />
              <stop offset="100%" stop-color="#a855f7" stop-opacity="0" />
            </linearGradient>
            <clipPath id="bw-clip-sb">
              <rect x="0" y="0" width={svgCtnrW} height={GRAPH_H - GRAPH_MB} />
            </clipPath>
          </defs>

          {#if P}
            <g clip-path="url(#bw-clip-sb)">
              <path d={P.dlArea} fill="url(#bw-dl-sb)" />
              <path d={P.ulArea} fill="url(#bw-ul-sb)" />
              <path
                d={P.dlLine}
                fill="none"
                stroke="#3b82f6"
                stroke-width="1.5"
                stroke-opacity="0.85"
              />
              <path
                d={P.ulLine}
                fill="none"
                stroke="#a855f7"
                stroke-width="1.5"
                stroke-opacity="0.85"
              />
              {#if CH}
                <line
                  x1={CH.x}
                  y1={0}
                  x2={CH.x}
                  y2={GRAPH_H}
                  stroke="rgba(156,163,175,0.35)"
                  stroke-width="1"
                  stroke-dasharray="2 2"
                />
                <circle cx={CH.x} cy={CH.dlY} r="3" fill="#3b82f6" />
                <circle cx={CH.x} cy={CH.ulY} r="3" fill="#a855f7" />
              {/if}
            </g>
            <!-- Max value label — shows the actual peak, not the headroom-padded ceiling -->
            {@const maxLabel = fmtBps(rawMax)}
            <text
              x={svgCtnrW - 2}
              y="10"
              text-anchor="end"
              fill="rgba(156,163,175,0.5)"
              font-size="8">{maxLabel[0]} {maxLabel[1]}</text
            >
          {:else}
            <text
              x={svgCtnrW / 2}
              y={GRAPH_H / 2}
              text-anchor="middle"
              dominant-baseline="middle"
              fill="rgba(156,163,175,0.4)"
              font-size="10">Waiting for data...</text
            >
          {/if}
        </svg>
      {/if}
    </div>

  </div>

  <!-- Accessible expand trigger for keyboard navigation -->
  <button
    onclick={() => {
      modalOpen = true;
    }}
    class="sr-only focus-visible:not-sr-only focus-visible:mt-1 focus-visible:w-full focus-visible:rounded focus-visible:bg-blue-600 focus-visible:px-2 focus-visible:py-1 focus-visible:text-xs focus-visible:text-white"
  >
    Expand bandwidth graph
  </button>
{:else}
  <!-- Shown before the first bandwidth poll response arrives.
     Fixed height matches the graph's total height so the sidebar layout is stable.
     items-center + justify-center keeps the spinner+label exactly centered. -->
  <div
    class="text-ColorPalette-text-quarternary flex h-[130px] w-full items-center justify-center gap-2 text-xs"
  >
    <LoadingArcSpinner class="h-4 w-4" />
    <span>Loading</span>
  </div>
{/if}

<!-- ── Expanded modal portal ───────────────────────────────────────────────────
     FlyStretchAnimationWrapper appends to <body> via windowPopUp so it's never clipped
     by overflow containers. All animation logic lives in FlyStretchAnimationWrapper.svelte.
──────────────────────────────────────────────────────────────────────────────── -->
<FlyStretchAnimationWrapper
  bind:open={modalOpen}
  getTriggerRect={() => containerEl?.getBoundingClientRect() ?? null}
  maxWidth={700}
  maxHeight={440}
  animMs={ANIM_MS}
  ariaLabel="Bandwidth graph - expanded view"
>
  {#snippet children(phase, close, panelHeight)}
    <!-- Modal header — uses position:relative so the time counter can be
         absolutely centered across the full modal width independently of the
         speed counters on the left and the close button on the right. -->
    <div
      class="border-ColorPalette-border-tertiary/50 bg-ColorPalette-bg-quaternary/95 relative flex flex-shrink-0 items-center justify-between border-b px-6 py-4 backdrop-blur-md"
    >
      <!-- Left: title + speed counters.
           Both counters are wrapped in a tight-gap sub-flex so they sit flush
           against each other and close to the title. Fixed widths + tabular-nums
           prevent any positional shift as values change. -->
      <div class="flex items-center gap-3 text-sm">
        <h2 class="text-ColorPalette-text-secondary shrink-0 font-bold">Bandwidth</h2>
        <div class="flex shrink-0 items-center gap-2">
          <!-- Download: [icon] [value] [unit] -->
          <div class="flex w-[88px] shrink-0 items-center gap-0.5">
            <ArrowDownBox class="h-3.5 w-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
            <span class="font-semibold text-blue-500 tabular-nums dark:text-blue-400"
              >{fmtBps(live.dl)[0]}</span
            >
            <span class="text-xs text-blue-400/60 dark:text-blue-500/60">{fmtBps(live.dl)[1]}</span>
          </div>
          <!-- Upload: [value] [unit] [icon] -->
          <div class="flex w-[88px] shrink-0 items-center gap-0.5">
            <span class="font-semibold text-purple-500 tabular-nums dark:text-purple-400"
              >{fmtBps(live.ul)[0]}</span
            >
            <span class="text-xs text-purple-400/60 dark:text-purple-500/60"
              >{fmtBps(live.ul)[1]}</span
            >
            <ArrowUpBox class="h-3.5 w-3.5 shrink-0 text-purple-500 dark:text-purple-400" />
          </div>
        </div>
      </div>

      <!-- Time counter: absolutely centered across the full modal width.
           Priority: hover-point time → panned right-edge time → zoom-window when hovering.
           pointer-events-none prevents it from intercepting clicks on the header. -->
      <div
        class="pointer-events-none absolute inset-x-0 flex justify-center text-xs"
        aria-live="polite"
      >
        {#if live.isHover && live.ts !== null}
          <span class="text-ColorPalette-text-quarternary italic">{timeSince(live.ts)}</span>
        {:else if panRightEdgeTs !== null}
          <span class="text-ColorPalette-text-quarternary italic">{timeSince(panRightEdgeTs)}</span>
        {:else if hovering}
          <span class="text-ColorPalette-text-quarternary">{fmtWin(timeWin)} window</span>
        {/if}
      </div>

      <!-- Alt speed badge: absolutely centered between the time counter (at 50%) and
           the close button (at the right edge). pointer-events-none on the wrapper so
           it never blocks clicks on the close button or header area. -->
      {#if altSpeedOn}
        <div
          class="pointer-events-none absolute inset-y-0 flex items-center justify-center"
          style="left: 50%; right: 0;"
        >
          <span
            class="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
          >
            Alt Speed Active
          </span>
        </div>
      {/if}

      <!-- Right: close button -->
      <button
        onclick={close}
        class="bg-ColorPalette-bg-quinary hover:bg-ColorPalette-button-bg-hover-tertiary text-ColorPalette-text-quinary hover:text-ColorPalette-modal-tab-text-hover-secondary shrink-0 rounded-md p-2 transition-colors"
        aria-label="Close bandwidth graph"
      >
        <Close class="h-4 w-4" />
      </button>
    </div>

    <!-- Modal graph content — no horizontal padding so SVG touches modal borders -->
    {#if phase === 'open'}
      <div
        role="application"
        aria-label="Bandwidth graph interactive area"
        class="flex flex-col"
        style="height: calc(100% - 73px);"
        use:nonPassiveWheel={onWheel}
        onmouseenter={onEnter}
        onmouseleave={onLeave}
        onmousemove={onModalMove}
      >
        <!-- Full-width SVG (no padding — touches modal left and right borders) -->
        <div bind:clientWidth={modalCtnrW} class="min-h-0 flex-1">
          {#if modalCtnrW > 0}
            {@const mH = Math.max(60, panelHeight - 120)}
            {@const anim = panEndTimestamp !== null ? 0 : animOff}
            {@const P = buildPaths(modalCtnrW, mH, anim)}
            {@const CH = getCH(modalCtnrW, mH, anim)}
            {@const rawMax = aggData.dl.length ? Math.max(...aggData.dl, ...aggData.ul) : 0}
            <svg
              bind:this={modalSvgEl}
              width={modalCtnrW}
              height={mH}
              class="block"
              style="overflow: hidden;"
            >
              <defs>
                <linearGradient id="bw-dl-mo" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.28" />
                  <stop offset="100%" stop-color="#3b82f6" stop-opacity="0" />
                </linearGradient>
                <linearGradient id="bw-ul-mo" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#a855f7" stop-opacity="0.28" />
                  <stop offset="100%" stop-color="#a855f7" stop-opacity="0" />
                </linearGradient>
                <clipPath id="bw-clip-mo">
                  <rect x="0" y="0" width={modalCtnrW} height={mH - GRAPH_MB} />
                </clipPath>
              </defs>

              {#if P}
                <g clip-path="url(#bw-clip-mo)">
                  <path d={P.dlArea} fill="url(#bw-dl-mo)" />
                  <path d={P.ulArea} fill="url(#bw-ul-mo)" />
                  <path
                    d={P.dlLine}
                    fill="none"
                    stroke="#3b82f6"
                    stroke-width="2"
                    stroke-opacity="0.85"
                  />
                  <path
                    d={P.ulLine}
                    fill="none"
                    stroke="#a855f7"
                    stroke-width="2"
                    stroke-opacity="0.85"
                  />
                  {#if CH}
                    <line
                      x1={CH.x}
                      y1={0}
                      x2={CH.x}
                      y2={mH}
                      stroke="rgba(156,163,175,0.3)"
                      stroke-width="1"
                      stroke-dasharray="3 3"
                    />
                    <circle cx={CH.x} cy={CH.dlY} r="4" fill="#3b82f6" />
                    <circle cx={CH.x} cy={CH.ulY} r="4" fill="#a855f7" />
                  {/if}
                </g>
                {@const maxLabel = fmtBps(rawMax)}
                <text
                  x={modalCtnrW - 4}
                  y="14"
                  text-anchor="end"
                  fill="rgba(156,163,175,0.5)"
                  font-size="9">{maxLabel[0]} {maxLabel[1]}</text
                >
                <text
                  x={modalCtnrW - 4}
                  y={mH - 4}
                  text-anchor="end"
                  fill="rgba(156,163,175,0.4)"
                  font-size="9"
                  >{displayMinV > 0
                    ? `${fmtBps(displayMinV)[0]} ${fmtBps(displayMinV)[1]}`
                    : '0'}</text
                >
              {:else}
                <text
                  x={modalCtnrW / 2}
                  y={mH / 2}
                  text-anchor="middle"
                  dominant-baseline="middle"
                  fill="rgba(156,163,175,0.4)"
                  font-size="11">Waiting for data...</text
                >
              {/if}
            </svg>
          {/if}
        </div>

        <!-- Legend and zoom hint — padded from modal edges -->
        <div
          class="text-ColorPalette-text-quarternary flex items-center justify-between px-6 py-3 text-xs"
        >
          <div class="flex gap-5">
            <span class="flex items-center gap-1.5">
              <span class="inline-block h-px w-4 bg-blue-500"></span>
              Download
            </span>
            <span class="flex items-center gap-1.5">
              <span class="inline-block h-px w-4 bg-purple-500"></span>
              Upload
            </span>
          </div>
          <span class="italic"
            >Hold Control + scroll to zoom ({fmtWin(timeWin)} window) &bull; Scroll left / right to pan
            history</span
          >
        </div>

      </div>
    {/if}
  {/snippet}
</FlyStretchAnimationWrapper>

<!-- Sidebar interaction hint tooltip — appears to the right of the sidebar after the user
     has hovered over the graph for HINT_DELAY ms. Not rendered while the pop-up modal is open
     since the modal provides its own static hint text in its footer. -->
<Tooltip visible={showHint && !modalOpen} x={tooltipPos.x} y={tooltipPos.y} maxWidth={260} class="whitespace-nowrap">
  <span class="leading-relaxed text-gray-700 dark:text-gray-200">
    Hold Control + scroll to zoom<br />
    Scroll left / right to pan history<br />
    Double-click to expand
  </span>
</Tooltip>
