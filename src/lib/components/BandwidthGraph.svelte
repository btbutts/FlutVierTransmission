<!-- src/lib/components/BandwidthGraph.svelte -->
<script lang="ts">
import { onMount } from 'svelte';
import { get } from 'svelte/store';
import { bandwidthHistory, bandwidthLastPollTime, session } from '$lib';

import { windowPopUp } from '$lib/helpers';
import { ArrowDownBox, ArrowUpBox, Close } from '$lib/plugins';

import LoadingArcSpinner from './LoadingArcSpinner.svelte';

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

// Non-reactive helpers for the rAF loop (avoid reactive overhead)
let _latestMaxV = 1; // target for displayMaxV, written by $effect
let _lastTick = 0; // timestamp of previous rAF tick, for dt calculation
let rafId = 0;

let showHint = $state(false);
let hintTimer: ReturnType<typeof setTimeout> | null = null;

// Modal animation phases
type Phase = 'closed' | 'opening' | 'open' | 'closing';
let phase = $state<Phase>('closed');
let showPortal = $state(false);
let pX = $state(0),
  pY = $state(0),
  pW = $state(0),
  pH = $state(0);
// When true, panel transitions are suppressed for one frame (used during resize).
let noTransition = $state(false);

// ── Data aggregation with zero-fill ───────────────────────────────────────────
// Slices history according to the current time window and pan anchor, then
// zero-fills the left so the graph has a stable pixel-per-point ratio.
const aggData = $derived.by(() => {
  const h = $bandwidthHistory;
  if (!h.length) {
    return { dl: [] as number[], ul: [] as number[], ts: [] as (number | null)[], bsz: 1 };
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

  return { dl, ul, ts, bsz };
});

// Timestamp of the right edge of the currently-displayed window for the center label.
// Simply mirrors panEndTimestamp — non-null only when panned.
const panRightEdgeTs = $derived(panEndTimestamp);

// Update _latestMaxV whenever aggregated data changes.
// Adds 10% headroom so peaks never clip the SVG top.
$effect(() => {
  if (!aggData.dl.length) {
    _latestMaxV = 1;
    return;
  }
  const raw = Math.max(1, ...aggData.dl, ...aggData.ul);
  _latestMaxV = raw * 1.1;
  // Snap immediately on the first real data so the scale doesn't slowly ramp up.
  if (displayMaxV <= 1 && raw > 1) displayMaxV = _latestMaxV;
});

// ── Live displayed values (hover-interpolated or latest received) ──────────────
const live = $derived.by(() => {
  const { dl, ul, ts } = aggData;
  const h = $bandwidthHistory;
  if (hovering && mxRatio !== null && dl.length > 1) {
    const n = dl.length - 1;
    const fi = mxRatio * n;
    const lo = Math.max(0, Math.min(n - 1, Math.floor(fi)));
    const hi = Math.min(n, lo + 1);
    const fr = fi - lo;
    return {
      dl: dl[lo] + (dl[hi] - dl[lo]) * fr,
      ul: ul[lo] + (ul[hi] - ul[lo]) * fr,
      ts: ts[lo],
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
  const b = bytesPerSec * 8; // bytes/s → bits/s
  if (b < 1e3) return [b.toFixed(0), 'b/s'];
  if (b < 1e6) return [(b / 1e3).toFixed(1), 'Kb/s'];
  if (b < 1e9) return [(b / 1e6).toFixed(1), 'Mb/s'];
  return [(b / 1e9).toFixed(2), 'Gb/s'];
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
// Uses displayMaxV (smoothly animated) for the Y scale so scale changes transition
// smoothly rather than snapping. Extra top margin ensures peaks are never clipped.
// anim: scroll animation offset (0–1); pass 0 when panned so history is static.
function buildPaths(W: number, H: number, anim: number) {
  const { dl, ul } = aggData;
  if (dl.length < 2) return null;

  const n = dl.length - 1;
  const ppx = W / Math.max(1, n);
  const mt = GRAPH_MT,
    mb = GRAPH_MB,
    ch = H - mt - mb; // generous top margin prevents clipping
  const base = H - mb;
  const xOff = anim * ppx;

  // Clamp v to displayMaxV so values that briefly overshoot don't escape the clip area.
  const yOf = (v: number) => mt + ch * (1 - Math.min(v, displayMaxV) / Math.max(displayMaxV, 1));

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
  const yOf = (v: number) => mt + ch * (1 - Math.min(v, displayMaxV) / Math.max(displayMaxV, 1));

  const x = mxRatio * W;
  const xOff = anim * ppx;
  const fi = (x + xOff) / ppx;
  const lo = Math.max(0, Math.min(n - 1, Math.floor(fi)));
  const hi = Math.min(n, lo + 1);
  const fr = fi - lo;

  return {
    x,
    dlY: yOf(dl[lo] + (dl[hi] - dl[lo]) * fr),
    ulY: yOf(ul[lo] + (ul[hi] - ul[lo]) * fr)
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
    const W = (phase === 'open' ? modalCtnrW : svgCtnrW) || 256;
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

// ── Modal open / close ────────────────────────────────────────────────────────
async function openModal() {
  if (!containerEl) return;
  const r = containerEl.getBoundingClientRect();
  pX = r.left;
  pY = r.top;
  pW = r.width;
  pH = r.height;
  showPortal = true;
  // Wait for Svelte's DOM update AND the browser's first paint at the start position,
  // then transition to the final position so CSS animation fires correctly.
  await new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())));
  const mw = Math.min(700, window.innerWidth - 32);
  const mh = Math.min(440, window.innerHeight - 32);
  pX = (window.innerWidth - mw) / 2;
  pY = (window.innerHeight - mh) / 2;
  pW = mw;
  pH = mh;
  phase = 'opening';
  setTimeout(() => {
    phase = 'open';
  }, ANIM_MS);
}

function closeModal() {
  if (!containerEl) return;
  phase = 'closing';
  const r = containerEl.getBoundingClientRect();
  pX = r.left;
  pY = r.top;
  pW = r.width;
  pH = r.height;
  setTimeout(() => {
    showPortal = false;
    phase = 'closed';
  }, ANIM_MS);
}

// Keeps the modal centered and correctly sized as the viewport changes.
// Transitions are suppressed for the resize frame so the modal tracks instantly.
function handleResize() {
  if (phase !== 'open') return;
  noTransition = true;
  const mw = Math.min(700, window.innerWidth - 32);
  const mh = Math.min(440, window.innerHeight - 32);
  pX = (window.innerWidth - mw) / 2;
  pY = (window.innerHeight - mh) / 2;
  pW = mw;
  pH = mh;
  // Restore transitions after one paint so open/close animations still work.
  requestAnimationFrame(() => {
    noTransition = false;
  });
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

    // Y-scale: ramp up quickly on new spikes (speed = 4×/s), decay slowly (0.4×/s).
    const diff = _latestMaxV - displayMaxV;
    displayMaxV += diff * Math.min(1, (diff > 0 ? 4.0 : 0.4) * dt);

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
  window.addEventListener('resize', handleResize);
  return () => {
    cancelAnimationFrame(rafId);
    if (hintTimer) clearTimeout(hintTimer);
    window.removeEventListener('resize', handleResize);
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
    style="visibility: {showPortal ? 'hidden' : 'visible'};"
    use:nonPassiveWheel={onWheel}
    use:addDblClick={openModal}
    onmouseenter={onEnter}
    onmouseleave={onLeave}
    onmousemove={onSidebarMove}
  >
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

    <!-- SVG graph — no horizontal padding; fills full sidebar width -->
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

    <!-- Alt speed badge — only rendered when Transmission's alt-speed-enabled is active -->
    {#if altSpeedOn}
      <div class="mt-1 flex justify-center px-6">
        <span
          class="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
        >
          Alt Speed Active
        </span>
      </div>
    {/if}

    <!-- Hover hint — fades in after HINT_DELAY ms of continuous hovering -->
    <div
      class="mt-0.5 px-6 text-center text-xs leading-relaxed transition-opacity duration-300"
      style="opacity: {showHint ? 0.5 : 0}; color: rgb(156 163 175);"
      aria-hidden="true"
    >
      Hold Control + scroll to zoom<br />Scroll left / right to pan history<br />Double-click to
      expand
    </div>
  </div>

  <!-- Accessible expand trigger for keyboard navigation -->
  <button
    onclick={openModal}
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
     Appended to <body> via windowPopUp so it's never clipped by overflow containers.
──────────────────────────────────────────────────────────────────────────────── -->
{#if showPortal}
  <!-- Outer div is the click-outside target. The inner overlay div has pointer-events:none
       so backdrop clicks pass through it and land on this element, making
       e.target === e.currentTarget true and correctly triggering closeModal(). -->
  <div
    use:windowPopUp
    role="dialog"
    aria-modal="true"
    aria-label="Bandwidth graph - expanded view"
    tabindex="-1"
    style="position: fixed; inset: 0; z-index: 9999; pointer-events: {phase === 'open'
      ? 'all'
      : 'none'};"
    onclick={(e) => {
      if (e.target === e.currentTarget) closeModal();
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') closeModal();
    }}
  >
    <!-- Visual overlay: pointer-events:none so it never intercepts clicks.
         Fades in when phase reaches 'opening' (same frame the panel starts sliding),
         so the dark backdrop appears immediately with the panel, not after it. -->
    <div
      class="absolute inset-0 bg-black/50"
      style="
        pointer-events: none;
        opacity: {phase === 'opening' || phase === 'open' ? 1 : 0};
        transition: opacity {ANIM_MS}ms;
      "
    ></div>

    <!-- Animated panel: starts at sidebar position, transitions to center modal -->
    <div
      class="bg-ColorPalette-bg-secondary/95 overflow-hidden rounded-3xl shadow-[0_0_0_1px_rgba(0,0,0,0.15),0_0_40px_16px_rgba(0,0,0,0.65),0_0_120px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl"
      style="
        position: fixed;
        left: {pX}px; top: {pY}px;
        width: {pW}px; height: {pH}px;
        opacity: {phase === 'open' || phase === 'opening' ? 1 : 0};
        transition: {noTransition
        ? 'none'
        : `left ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), top ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), width ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), height ${ANIM_MS}ms cubic-bezier(0.4,0,0.2,1), opacity ${ANIM_MS}ms`};
      "
    >
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
              <span class="text-xs text-blue-400/60 dark:text-blue-500/60"
                >{fmtBps(live.dl)[1]}</span
              >
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
            <span class="text-ColorPalette-text-quarternary italic"
              >{timeSince(panRightEdgeTs)}</span
            >
          {:else if hovering}
            <span class="text-ColorPalette-text-quarternary">{fmtWin(timeWin)} window</span>
          {/if}
        </div>

        <!-- Right: close button -->
        <button
          onclick={closeModal}
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
              {@const mH = Math.max(60, pH - 120)}
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
                    font-size="9">0</text
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
              >Hold Control + scroll to zoom ({fmtWin(timeWin)} window) &bull; Scroll left / right to
              pan history</span
            >
          </div>

          <!-- Alt speed badge (only when enabled) -->
          {#if altSpeedOn}
            <div class="flex justify-center pb-3">
              <span
                class="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
              >
                Alt Speed Active
              </span>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
