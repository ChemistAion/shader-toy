# fcPLAN — FragCoord Frames Transplant into Shader-Toy (v0.7.1)

> **Scope**: Implement FragCoord.xyz v0.7.1 **Frames** feature as a real-time performance graph in the shader-toy VSCode extension  
> **Source reports**: `references/fragcoord/fragcoord-frames(0.7.1)-REPORT.md` + `fragcoord-overview(0.7.1).md`  
> **Generic transplant reference**: `references/fragcoord/fragcoord-transplant-plan(0.7.1).md` §3  
> **Architecture reference**: `.github/docs/architecture/shadertoyPanels-overview.md`  
> **Skill reference**: `.github/skills/shader-toy/SKILL.md`  
> **Shared scaffold**: see `fragcoord(0.7.1)-PLAN#inspect.md` Phase 0

---

## 0. Architecture Decision

### What We're Building

A **real-time frame-time performance graph** rendered to a `<canvas>` element inside the inspector panel. The graph shows per-frame CPU timing, optional GPU timing (when `EXT_disjoint_timer_query_webgl2` is available), EMA smoothing, statistics (min/max/avg/P50/P99/fps), stutter detection, hover tooltips, pause/resume, zoom, and ms/fps toggle — closely matching FragCoord v0.7.1's `Q8` (FrameTimeGraph) component.

### Relationship to Phase 0 Scaffold

This plan **depends on Phase 0** from `fragcoord(0.7.1)-PLAN#inspect.md`. The inspector panel scaffold, IPC bridge, and tab structure are established there. The Frames feature adds:

- A new **"Frames" tab** in the inspector panel (alongside Inspect, Errors)
- New IPC messages between preview webview → extension host → inspector panel
- A canvas-based graph component in the inspector panel's HTML
- GPU timer query integration in the preview webview's render loop

### Where Each Component Lives

```
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│ Preview Webview  │        │  Extension Host   │        │ Inspector Panel  │
│  (WebGL canvas)  │        │ (ShaderToyManager) │        │                  │
│                  │ postMsg│                    │ postMsg│ ┌──────────────┐ │
│ • GPU timer      ├──────►│ • IPC hub          ├──────►│ │ Frames Tab   │ │
│   queries        │        │ • Route timing     │        │ │ ┌──────────┐│ │
│ • CPU timing     │        │   data to panel    │        │ │ │ <canvas> ││ │
│ • Frame counter  │        │                    │        │ │ │ Graph    ││ │
│                  │        │                    │        │ │ └──────────┘│ │
│                  │        │                    │        │ │ [ms][fps]   │ │
│                  │        │                    │        │ │ [50][100]   │ │
│                  │        │                    │        │ │ [200][500]  │ │
│                  │        │                    │        │ │ [1000]      │ │
│                  │        │                    │        │ └──────────────┘ │
└──────────────────┘        └──────────────────┘        └──────────────────┘
```

### Data Flow: Push-Based (Not Polling)

FragCoord v0.7.1 uses a **ref-based push** or **callback push** model for zero-rerender data updates. In our VSCode webview context, we adapt this:

- **Preview webview** measures timing each frame → posts a single `frameData` message
- **Extension host** forwards to inspector panel (no processing needed)
- **Inspector panel** accumulates data in ring buffers, redraws graph

The graph drawing runs **inside the inspector panel's own `requestAnimationFrame` loop**, decoupled from the preview's render rate.

### What's New in v0.7.1 vs v0.6.2

| Aspect | v0.6.2 | v0.7.1 |
|--------|--------|--------|
| **Buffer capacity** | 1000 | 2000 samples |
| **Fill container mode** | Not present | Fills parent container via `ResizeObserver` |
| **Zoom controls** | Not present | Scroll wheel + preset buttons (50/100/200/500/1000) |
| **Unit toggle** | Not present | ms/fps toggle buttons |
| **Theme support** | Dark only | Dark + Light themes (22 color tokens each) |
| **Frame cap** | Fixed 60fps/30fps | Configurable `frameCap` |
| **DPR cap** | 2 | 3 (`min(devicePixelRatio, 3)`) |
| **Ref-based push** | Not present | `frameTimeMsRef`/`gpuTimeMsRef`/`frameRef` zero-rerender |
| **Callback push** | Not present | `onRegisterPush` parent-driven updates |
| **Stutter threshold** | Always 2× avg | 2× avg + frame cap aware (skips if within 1.1× cap) |

### Key Shader-Toy Adaptations

1. **No React** — FragCoord's `Q8` is a React component. Our inspector panel uses vanilla JS/TS (matching the addon panel pattern). We port the rendering logic directly.
2. **IPC overhead** — sending per-frame timing data through `postMessage` adds latency. We batch to reduce overhead: send `{ cpuMs, gpuMs, frameNumber }` once per frame.
3. **Theme integration** — detect VSCode theme (dark vs light) and use corresponding color token set.
4. **Fill container mode by default** — since the Frames tab fills the inspector panel, always use fill-container behavior with `ResizeObserver`.

---

## Phase 1 — Ring Buffer & Statistics

**Goal**: Port the ring buffer data structure and statistics computation — pure TypeScript, no UI.

### 1a. Ring Buffer (Port of `l2`)

```typescript
// src/inspector/frames/ring_buffer.ts

/**
 * Fixed-capacity circular buffer backed by Float64Array.
 * Port of FragCoord's l2 class.
 * Ref: inspector(0.7.1)/071_FrameTimeGraph_Q8.txt (L2056)
 */
export class RingBuffer {
  private buf: Float64Array
  private head = 0
  private _size = 0

  constructor(public readonly capacity: number) {
    this.buf = new Float64Array(capacity)
  }

  push(value: number): void {
    this.buf[this.head] = value
    this.head = (this.head + 1) % this.capacity
    if (this._size < this.capacity) this._size++
  }

  get size(): number {
    return this._size
  }

  at(index: number): number {
    if (index < 0 || index >= this._size) return 0
    const start = this._size < this.capacity ? 0 : this.head
    return this.buf[(start + index) % this.capacity]
  }

  last(): number {
    if (this._size === 0) return 0
    return this.buf[(this.head - 1 + this.capacity) % this.capacity]
  }

  toArray(): number[] {
    const arr = new Array(this._size)
    for (let i = 0; i < this._size; i++) arr[i] = this.at(i)
    return arr
  }

  clear(): void {
    this.head = 0
    this._size = 0
  }
}
```

### 1b. Statistics (Port of `xb()`)

```typescript
// src/inspector/frames/frame_stats.ts

export interface FrameStats {
  min: number
  max: number
  avg: number
  p50: number
  p99: number
  fps: number
  stutterCount: number
}

const EMPTY_STATS: FrameStats = { min: 0, max: 0, avg: 0, p50: 0, p99: 0, fps: 0, stutterCount: 0 }

/**
 * Compute frame timing statistics from a ring buffer.
 * Port of FragCoord's xb(ringBuf, frameCap).
 *
 * @param buf CPU frame-time ring buffer
 * @param frameCap Optional frame rate cap (e.g. 30, 60, 120)
 */
export function computeStats(buf: RingBuffer, frameCap?: number): FrameStats {
  const n = buf.size
  if (n === 0) return EMPTY_STATS

  let sum = 0, min = Infinity, max = -Infinity
  for (let i = 0; i < n; i++) {
    const v = buf.at(i)
    sum += v
    if (v < min) min = v
    if (v > max) max = v
  }
  const avg = sum / n

  // Stutter detection
  let stutterCount = 0
  const capMs = frameCap && frameCap > 0 ? 1000 / frameCap : 0
  const withinCap = capMs > 0 && avg <= capMs * 1.1
  if (!withinCap) {
    const threshold = avg * 2    // STUTTER_MULTIPLIER = 2
    const warmup = Math.min(10, n)
    for (let i = warmup; i < n; i++) {
      if (buf.at(i) > threshold) stutterCount++
    }
  }

  // Sorted copy for percentiles
  const sorted = new Array(n)
  for (let i = 0; i < n; i++) sorted[i] = buf.at(i)
  sorted.sort((a: number, b: number) => a - b)
  const p50 = sorted[Math.floor(n * 0.5)]
  const p99 = sorted[Math.min(n - 1, Math.floor(n * 0.99))]

  const lastMs = buf.last()
  const fps = lastMs > 0 ? 1000 / lastMs : 0

  return { min, max, avg, p50, p99, fps, stutterCount }
}
```

### 1c. EMA Smoothing (Port of `Vj()`)

```typescript
/**
 * Compute Exponential Moving Average of a ring buffer.
 * Port of FragCoord's Vj(ringBuf, alpha).
 *
 * @param alpha Smoothing factor (FragCoord default: 0.15)
 */
export function computeEMA(buf: RingBuffer, alpha: number): number[] {
  const n = buf.size
  if (n === 0) return []
  const result = new Array(n)
  result[0] = buf.at(0)
  for (let i = 1; i < n; i++) {
    result[i] = alpha * buf.at(i) + (1 - alpha) * result[i - 1]
  }
  return result
}
```

### 1d. Constants (Port of FragCoord's graph constants)

```typescript
// src/inspector/frames/frame_constants.ts

export const RING_BUFFER_CAPACITY = 2000   // l2 capacity
export const DEFAULT_VISIBLE_FRAMES = 200  // c2
export const EMA_ALPHA = 0.15              // Gj
export const STUTTER_MULTIPLIER = 2        // Xj
export const REFERENCE_60FPS_MS = 16.67    // sd
export const REFERENCE_30FPS_MS = 33.33    // nu
export const DPR_CAP = 3                   // Yu max
export const COMPACT_WIDTH = 240           // Rm
export const COMPACT_HEIGHT = 80           // Mm
export const ZOOM_PRESETS = [50, 100, 200, 500, 1000]  // Hj
export const ZOOM_IN_FACTOR = 0.87
export const ZOOM_OUT_FACTOR = 1.15
export const MIN_ZOOM_FRAMES = 20
export const MAX_ZOOM_FRAMES = 2000
```

### Deliverable
- Ring buffer, statistics, EMA — all pure TypeScript, fully unit-testable
- No webview or UI dependency

---

## Phase 2 — GPU Timer Queries

**Goal**: Integrate WebGL2 timer queries into the preview webview's render loop to measure GPU execution time per frame.

### 2a. Timer State (Port of `_M()`)

```typescript
// src/inspector/frames/gpu_timer.ts (webview-side module)

interface GpuTimerState {
  ext: any  // EXT_disjoint_timer_query_webgl2
  query: WebGLQuery | null
  pending: boolean
  lastGpuTimeMs: number
}

/**
 * Initialize GPU timer state. Returns null if extension unavailable.
 * Port of _M(gl).
 * Ref: inspector(0.7.1)/071_gpu_timer_query.txt (L245)
 */
function initGpuTimer(gl: WebGL2RenderingContext): GpuTimerState | null {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  return ext ? { ext, query: null, pending: false, lastGpuTimeMs: 0 } : null
}
```

### 2b. Begin / End Query (Port of `CM()` / `EM()`)

```typescript
/**
 * Begin a GPU timer query. Skip if one is already pending.
 * Port of CM(gl, timer).
 */
function beginGpuTimer(gl: WebGL2RenderingContext, timer: GpuTimerState): void {
  if (timer.pending) return
  const query = gl.createQuery()
  if (query) {
    timer.query = query
    gl.beginQuery(timer.ext.TIME_ELAPSED_EXT, query)
  }
}

/**
 * End the current GPU timer query.
 * Port of EM(gl, timer).
 */
function endGpuTimer(gl: WebGL2RenderingContext, timer: GpuTimerState): void {
  if (!timer.query || timer.pending) return
  gl.endQuery(timer.ext.TIME_ELAPSED_EXT)
  timer.pending = true
}
```

### 2c. Poll Result (Port of `SM()`)

```typescript
/**
 * Poll for GPU timer query result. Returns ms (possibly from previous frame).
 * Port of SM(gl, timer).
 *
 * Results are always one frame behind (GPU queries are asynchronous).
 */
function pollGpuTimer(gl: WebGL2RenderingContext, timer: GpuTimerState): number {
  if (!timer.query || !timer.pending) return timer.lastGpuTimeMs

  // Check for GPU disjoint (context lost, etc.)
  if (gl.getParameter(timer.ext.GPU_DISJOINT_EXT)) {
    gl.deleteQuery(timer.query)
    timer.query = null
    timer.pending = false
    return timer.lastGpuTimeMs
  }

  // Check if result is available
  if (!gl.getQueryParameter(timer.query, gl.QUERY_RESULT_AVAILABLE)) {
    return timer.lastGpuTimeMs  // not ready, return last known
  }

  // Read result (nanoseconds → milliseconds)
  const ns = gl.getQueryParameter(timer.query, gl.QUERY_RESULT) as number
  gl.deleteQuery(timer.query)
  timer.query = null
  timer.pending = false
  timer.lastGpuTimeMs = ns / 1e6
  return timer.lastGpuTimeMs
}
```

### 2d. Render Loop Integration

In the preview webview's render callback, wrap the render passes with timer begin/end:

```typescript
// Pseudocode — in the existing requestAnimationFrame callback:
let gpuTimer: GpuTimerState | null = null
let lastFrameTime = 0

function onFrame(gl: WebGL2RenderingContext, now: number) {
  // CPU timing
  const cpuDt = lastFrameTime > 0 ? now - lastFrameTime : 0
  lastFrameTime = now

  // Lazy-init GPU timer
  if (!gpuTimer) gpuTimer = initGpuTimer(gl)

  // Begin GPU timer before all passes
  if (gpuTimer) beginGpuTimer(gl, gpuTimer)

  // ... render all passes (Kg/dl) ...

  // End GPU timer after all passes
  if (gpuTimer) endGpuTimer(gl, gpuTimer)

  // Poll result (from previous frame)
  const gpuMs = gpuTimer ? pollGpuTimer(gl, gpuTimer) : 0

  // Post timing data to extension host
  if (framesEnabled) {
    vscode.postMessage({
      command: 'frameData',
      cpuMs: cpuDt,
      gpuMs,
      frameNumber
    })
  }
}
```

**Key detail**: GPU timer result is always one frame behind due to async query nature. This matches FragCoord's behavior.

### 2e. Extension Availability

`EXT_disjoint_timer_query_webgl2` is not universally available:
- **Chrome**: Generally supported on discrete GPUs
- **Firefox**: Disabled by default for fingerprinting concerns
- **Safari**: Not supported
- **VSCode webview**: Uses Chromium — generally available

When unavailable, `gpuMs` is always 0 and GPU bars are hidden in the graph.

### Deliverable
- GPU timing wraps all shader render passes
- Results always 1 frame behind (async queries)
- Graceful fallback when extension unavailable
- Per-frame `{ cpuMs, gpuMs, frameNumber }` posted to extension host

---

## Phase 3 — Canvas Graph Rendering

**Goal**: Implement the frame-time graph renderer as a `<canvas>` element in the inspector panel's Frames tab.

### 3a. Frames Tab HTML

```html
<div class="inspector-frames-tab" data-tab="frames">
  <div class="frame-time-graph-fill">
    <canvas class="frame-time-canvas"
            title="Click to pause/resume — hover for details — scroll to zoom"></canvas>
    <div class="frame-time-zoom-controls">
      <button class="frame-time-zoom-btn frame-time-stats-unit-btn active" data-unit="ms">ms</button>
      <button class="frame-time-zoom-btn frame-time-stats-unit-btn" data-unit="fps">fps</button>
      <span class="frame-time-zoom-sep" aria-hidden="true"></span>
      <span class="frame-time-zoom-spacer" aria-hidden="true"></span>
      <button class="frame-time-zoom-btn" data-zoom="50">50</button>
      <button class="frame-time-zoom-btn" data-zoom="100">100</button>
      <button class="frame-time-zoom-btn active" data-zoom="200">200</button>
      <button class="frame-time-zoom-btn" data-zoom="500">500</button>
      <button class="frame-time-zoom-btn" data-zoom="1000">1000</button>
    </div>
  </div>
</div>
```

### 3b. Theme Color Tokens (Port of `qj`)

```typescript
// src/inspector/frames/frame_theme.ts

export interface FrameTheme {
  bg: string
  text: string
  textDim: string
  textDim2: string
  line60: string
  line30: string
  label60: string
  label30: string
  gpuBar: string
  stutter: string
  ema: string
  crosshair: string
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
  gpuText: string
  minStat: string
  maxStat: string
  p99Stat: string
  stutterStat: string
  paused: string
}

export const DARK_THEME: FrameTheme = {
  bg: 'rgba(12, 12, 16, 0.88)',
  text: 'rgba(255, 255, 255, 0.7)',
  textDim: 'rgba(255, 255, 255, 0.4)',
  textDim2: 'rgba(255, 255, 255, 0.25)',
  line60: 'rgba(34, 221, 68, 0.3)',
  line30: 'rgba(255, 170, 0, 0.3)',
  label60: 'rgba(34, 221, 68, 0.45)',
  label30: 'rgba(255, 170, 0, 0.45)',
  gpuBar: 'rgba(0, 130, 255, 0.2)',
  stutter: 'rgba(255, 60, 60, 0.3)',
  ema: 'rgba(255, 255, 255, 0.2)',
  crosshair: 'rgba(255, 255, 255, 0.4)',
  tooltipBg: 'rgba(12, 12, 16, 0.9)',
  tooltipBorder: 'rgba(255, 255, 255, 0.3)',
  tooltipText: '#fff',
  gpuText: 'rgba(0, 130, 255, 0.9)',
  minStat: 'rgba(34, 221, 68, 0.5)',
  maxStat: 'rgba(255, 60, 60, 0.5)',
  p99Stat: 'rgba(255, 170, 0, 0.5)',
  stutterStat: 'rgba(255, 60, 60, 0.7)',
  paused: 'rgba(255, 170, 0, 0.8)'
}

export const LIGHT_THEME: FrameTheme = {
  bg: 'rgba(250, 250, 250, 0.95)',
  text: 'rgba(0, 0, 0, 0.75)',
  textDim: 'rgba(0, 0, 0, 0.45)',
  textDim2: 'rgba(0, 0, 0, 0.35)',
  line60: 'rgba(34, 197, 94, 0.5)',
  line30: 'rgba(234, 179, 8, 0.5)',
  label60: 'rgba(34, 197, 94, 0.7)',
  label30: 'rgba(234, 179, 8, 0.7)',
  gpuBar: 'rgba(59, 130, 246, 0.25)',
  stutter: 'rgba(239, 68, 68, 0.35)',
  ema: 'rgba(0, 0, 0, 0.25)',
  crosshair: 'rgba(0, 0, 0, 0.4)',
  tooltipBg: 'rgba(255, 255, 255, 0.98)',
  tooltipBorder: 'rgba(0, 0, 0, 0.15)',
  tooltipText: '#18181b',
  gpuText: 'rgba(37, 99, 235, 0.95)',
  minStat: 'rgba(34, 197, 94, 0.7)',
  maxStat: 'rgba(239, 68, 68, 0.7)',
  p99Stat: 'rgba(234, 179, 8, 0.7)',
  stutterStat: 'rgba(239, 68, 68, 0.85)',
  paused: 'rgba(234, 179, 8, 0.9)'
}
```

### 3c. Frame Color Helper

```typescript
/**
 * Color for a frame time value (green/yellow/red).
 * Port of u2(ms).
 */
function frameColor(ms: number): string {
  if (ms <= REFERENCE_60FPS_MS) return '#22dd44'
  if (ms <= REFERENCE_30FPS_MS) return '#ffaa00'
  return '#ff4444'
}
```

### 3d. Rounded Rectangle Helper

```typescript
/**
 * Draw a rounded rectangle path (for background and tooltip).
 * Port of yb(ctx, x, y, w, h, radius).
 */
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}
```

### 3e. Main Draw Function (Port of `Q8`'s draw callback)

This is the core of the Frames feature. The `drawGraph` function renders all 10 layers:

```typescript
// src/inspector/frames/frame_graph.ts

interface FrameGraphState {
  cpuBuf: RingBuffer       // CPU frame times
  gpuBuf: RingBuffer       // GPU frame times
  realDtBuf: RingBuffer    // Real frame-to-frame deltas (for FPS)
  paused: boolean
  hoverIndex: number | null
  visibleFrames: number
  statsUnit: 'ms' | 'fps'
  autoMax: number          // Y-axis auto-scaling max
  lastFrameCap: number | undefined
  theme: FrameTheme
}

function drawGraph(
  ctx: CanvasRenderingContext2D,
  state: FrameGraphState,
  canvasW: number,
  canvasH: number,
  frameCap?: number
): void {
  const { cpuBuf, gpuBuf, realDtBuf, theme, visibleFrames } = state
  const totalFrames = cpuBuf.size
  if (totalFrames === 0) return

  const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(dpr, dpr)

  const stats = computeStats(cpuBuf, frameCap)
  const ema = computeEMA(cpuBuf, EMA_ALPHA)

  // Reference line based on frame cap or defaults
  const refMs = frameCap && frameCap > 0 ? 1000 / frameCap : REFERENCE_30FPS_MS
  const maxVisible = Math.max(stats.max, refMs)
  state.autoMax = Math.max(maxVisible, state.autoMax * 0.995, refMs * 1.5)
  const gridMax = Math.ceil(state.autoMax / 5) * 5

  const startIndex = Math.max(0, totalFrames - visibleFrames)
  const frameCount = totalFrames - startIndex

  // Layout constants
  const marginLeft = 2, marginRight = 2
  const headerH = 14, footerH = 12
  const plotW = canvasW - marginLeft - marginRight
  const plotH = canvasH - headerH - footerH

  const xAt = (i: number) => marginLeft + (i / Math.max(visibleFrames - 1, 1)) * plotW
  const yAt = (ms: number) => headerH + plotH - Math.min(ms, gridMax) / gridMax * plotH

  // Clear + background
  ctx.clearRect(0, 0, canvasW, canvasH)
  ctx.fillStyle = theme.bg
  roundedRect(ctx, 0, 0, canvasW, canvasH, 6)
  ctx.fill()

  // --- Layer 1: Reference lines ---
  ctx.setLineDash([2, 3])
  ctx.lineWidth = 0.5
  // (draw 60fps and 30fps reference lines, or frameCap line)

  // --- Layer 2: GPU bars ---
  // (blue semi-transparent bars behind CPU line)

  // --- Layer 3: Stutter highlights ---
  // (red bars for frames > 2× avg)

  // --- Layer 4: EMA line ---
  // (white semi-transparent smoothed line)

  // --- Layer 5: CPU frame time polyline ---
  // (color-coded green/yellow/red segments)

  // --- Layer 6: Crosshair + tooltip (if hovering) ---

  // --- Layer 7: Header stats (FPS, ms, GPU ms) ---

  // --- Layer 8: PAUSED label ---

  // --- Layer 9: Visible frames count ---

  // --- Layer 10: Footer stats (avg, min, max, P99, stutter) ---

  ctx.restore()
}
```

Each drawing layer follows the exact specification from `fragcoord-frames(0.7.1)-REPORT.md` §6.2. The full implementation of all 10 layers is a direct port of FragCoord's `Q8` draw callback.

### 3f. Auto-Scaling Y-Axis

```typescript
// Y-axis slowly decays but snaps up immediately:
state.autoMax = Math.max(
  maxVisible,                    // snap up to max visible value
  state.autoMax * 0.995,         // slow decay (×0.995 per frame)
  refMs * 1.5                    // minimum: 1.5× reference line
)
const gridMax = Math.ceil(state.autoMax / 5) * 5  // round up to nearest 5
```

### 3g. Canvas Sizing (Fill Container + ResizeObserver)

```typescript
// In the inspector panel's Frames tab init:
const container = document.querySelector('.frame-time-graph-fill')!
const canvas = container.querySelector('.frame-time-canvas') as HTMLCanvasElement

const resizeObserver = new ResizeObserver(entries => {
  const { width, height } = entries[0].contentRect
  if (width > 0 && height > 0) {
    canvasSize = { w: Math.round(width), h: Math.round(height) }
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
    canvas.width = canvasSize.w * dpr
    canvas.height = canvasSize.h * dpr
    requestRedraw()
  }
})
resizeObserver.observe(container)
```

### Deliverable
- Full 10-layer graph rendering in the inspector panel
- Auto-scaling Y-axis with slow decay
- Canvas fills available space via ResizeObserver
- Dark and light theme support (auto-detected from VSCode)

---

## Phase 4 — Interactive Features

**Goal**: Implement hover tooltip, pause/resume, zoom, and unit toggle.

### 4a. Hover Tooltip

```typescript
canvas.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const plotWidth = rect.width - 4  // margins
  const normalizedX = (x - 2) / plotWidth
  const frameIndex = Math.round(normalizedX * Math.max(visibleFrames - 1, 1))

  const startIndex = Math.max(0, cpuBuf.size - visibleFrames)
  const absoluteIndex = startIndex + frameIndex

  if (frameIndex >= 0 && frameIndex < visibleFrames && absoluteIndex < cpuBuf.size) {
    state.hoverIndex = frameIndex
  } else {
    state.hoverIndex = null
  }
  requestRedraw()
})

canvas.addEventListener('pointerleave', () => {
  state.hoverIndex = null
  requestRedraw()
})
```

When hovering, the draw function renders:
- Vertical crosshair line at hover position
- Circle at the data point
- Tooltip box with CPU ms, FPS, and GPU ms

### 4b. Pause / Resume

```typescript
canvas.addEventListener('click', () => {
  state.paused = !state.paused
  requestRedraw()
})
```

When paused:
- Data accumulation stops
- "PAUSED" label shown (orange, top-right)
- Graph freezes at last state
- Click again to resume

### 4c. Scroll-to-Zoom

```typescript
canvas.addEventListener('wheel', (e) => {
  e.preventDefault()
  const factor = e.deltaY > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR
  state.visibleFrames = Math.max(
    MIN_ZOOM_FRAMES,
    Math.min(MAX_ZOOM_FRAMES, Math.round(state.visibleFrames * factor))
  )
  requestRedraw()
})
```

### 4d. Preset Zoom Buttons

```typescript
document.querySelectorAll('[data-zoom]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    state.visibleFrames = parseInt(btn.getAttribute('data-zoom')!)
    // Update active state
    document.querySelectorAll('[data-zoom]').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    requestRedraw()
  })
})
```

### 4e. Unit Toggle (ms / fps)

```typescript
document.querySelectorAll('[data-unit]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    state.statsUnit = btn.getAttribute('data-unit') as 'ms' | 'fps'
    document.querySelectorAll('[data-unit]').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    requestRedraw()
  })
})
```

When `statsUnit === 'fps'`:
- Footer stats show FPS values instead of ms
- min/max are inverted (min ms → max fps)
- Computed from `realDtBuf` (actual frame-to-frame intervals)

### Deliverable
- Hover shows crosshair + tooltip with ms and fps
- Click to pause/resume
- Scroll wheel zooms frame window [20, 2000]
- Preset buttons: 50, 100, 200, 500, 1000
- ms/fps toggle for statistics row

---

## Phase 5 — IPC & Data Pipeline

**Goal**: Wire the full data pipeline: preview webview → extension host → inspector panel.

### 5a. IPC Messages

```typescript
// Preview → Extension Host:
{ command: 'frameData', cpuMs: number, gpuMs: number, frameNumber: number }

// Extension Host → Inspector Panel:
{ command: 'frameData', cpuMs: number, gpuMs: number, frameNumber: number }
// (pass-through — extension host routes without processing)
```

### 5b. Inspector Panel Data Accumulation

```typescript
// In the inspector panel's message handler:
window.addEventListener('message', (event) => {
  const msg = event.data
  if (msg.command === 'frameData' && !state.paused) {
    state.cpuBuf.push(msg.cpuMs)
    if (msg.gpuMs > 0) state.gpuBuf.push(msg.gpuMs)

    // Compute real dt from performance.now()
    const now = performance.now()
    const dt = lastRealTime > 0 ? now - lastRealTime : 0
    lastRealTime = now
    if (dt >= 2 && dt <= 500) state.realDtBuf.push(dt)

    requestRedraw()
  }
})
```

### 5c. Redraw Throttling

The graph redraws via `requestAnimationFrame` to avoid excessive rendering:

```typescript
let redrawPending = false

function requestRedraw() {
  if (redrawPending) return
  redrawPending = true
  requestAnimationFrame(() => {
    redrawPending = false
    const ctx = canvas.getContext('2d')
    if (ctx) drawGraph(ctx, state, canvasSize.w, canvasSize.h, frameCap)
  })
}
```

### 5d. IPC Throttling (Preview Side)

To avoid flooding the message channel at high frame rates, throttle to max ~60 messages/sec:

```typescript
let lastFrameDataTime = 0
const FRAME_DATA_INTERVAL = 16  // ~60Hz

function maybePostFrameData(cpuMs: number, gpuMs: number, frameNumber: number) {
  const now = performance.now()
  if (now - lastFrameDataTime < FRAME_DATA_INTERVAL) return
  lastFrameDataTime = now
  vscode.postMessage({ command: 'frameData', cpuMs, gpuMs, frameNumber })
}
```

### 5e. Lifecycle

When the Frames tab is not visible:
- Stop GPU timer queries (save GPU resources)
- Stop posting frame data messages
- Clear ring buffers on tab switch (fresh data when returning)

```typescript
// Tab visibility change:
function onFramesTabVisibility(visible: boolean) {
  framesEnabled = visible
  if (!visible) {
    // Notify preview to stop GPU timing
    vscode.postMessage({ command: 'setFramesEnabled', enabled: false })
  } else {
    state.cpuBuf.clear()
    state.gpuBuf.clear()
    state.realDtBuf.clear()
    state.autoMax = REFERENCE_30FPS_MS
    vscode.postMessage({ command: 'setFramesEnabled', enabled: true })
  }
}
```

### Deliverable
- Complete data pipeline from GPU/CPU timing to rendered graph
- Per-frame messages throttled to ~60Hz
- Redraw via requestAnimationFrame (no unnecessary draws)
- Tab lifecycle management (start/stop timing on tab visibility)

---

## Phase 6 — Theme Integration & Polish

**Goal**: Auto-detect VSCode theme, apply correct color set, add frame cap support, polish CSS.

### 6a. Theme Detection

```typescript
// In the inspector panel init:
function detectTheme(): 'dark' | 'light' {
  // VSCode sets data-vscode-theme-kind on body
  const kind = document.body.getAttribute('data-vscode-theme-kind')
  return kind === 'vscode-light' ? 'light' : 'dark'
}

// Re-detect on theme change:
const observer = new MutationObserver(() => {
  state.theme = detectTheme() === 'light' ? LIGHT_THEME : DARK_THEME
  requestRedraw()
})
observer.observe(document.body, { attributes: true, attributeFilter: ['data-vscode-theme-kind'] })
```

### 6b. Frame Cap Configuration

Expose frame cap as a setting in `package.json`:

```json
"shader-toy.inspector.frameCap": {
  "type": "number",
  "default": 0,
  "description": "Frame rate cap for performance graph reference line (0 = auto 60/30fps)"
}
```

When `frameCap > 0`:
- Reference line drawn at `1000/frameCap` ms
- Stutter detection threshold uses cap value
- Header shows cap-aware FPS label

### 6c. CSS

```css
/* Frames tab — fills inspector panel */
.frame-time-graph-fill {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.frame-time-canvas {
  flex: 1;
  width: 100%;
  cursor: crosshair;
}

.frame-time-zoom-controls {
  display: flex;
  gap: 2px;
  padding: 2px 4px;
  flex-shrink: 0;
}

.frame-time-zoom-btn {
  background: transparent;
  border: 1px solid rgba(128, 128, 128, 0.3);
  color: inherit;
  padding: 1px 6px;
  font-size: 10px;
  font-family: monospace;
  border-radius: 3px;
  cursor: pointer;
}

.frame-time-zoom-btn.active {
  background: rgba(128, 128, 128, 0.25);
  border-color: rgba(128, 128, 128, 0.5);
}

.frame-time-zoom-btn:hover {
  background: rgba(128, 128, 128, 0.15);
}

.frame-time-zoom-sep {
  width: 1px;
  background: rgba(128, 128, 128, 0.2);
  margin: 0 4px;
}

.frame-time-zoom-spacer {
  flex: 1;
}
```

### Deliverable
- Auto theme detection (dark/light) from VSCode
- Configurable frame cap via settings
- Polish CSS matching FragCoord's styling

---

# Implementation Order (Recommended)

| Step | Phase | Feature | Depends On | Standalone? |
|------|-------|---------|------------|-------------|
| 1 | **Phase 0** (from Inspect plan) | Panel scaffold + IPC | Nothing | ✅ Yes |
| 2 | **Phase 1** | Ring buffer + stats + EMA | Nothing (pure logic) | ✅ Yes (tests) |
| 3 | **Phase 2** | GPU timer queries | Preview webview | ✅ Yes |
| 4 | **Phase 3** | Canvas graph rendering | Phase 1 | ✅ First visible result |
| 5 | **Phase 5** | IPC & data pipeline | Phase 0 + 2 + 3 | Integration |
| 6 | **Phase 4** | Interactive features | Phase 3 | Incremental |
| 7 | **Phase 6** | Theme + frame cap + polish | Phase 3 | Polish |

### Milestones

**M1 — "Data layer"** (Steps 1–3): Ring buffer, statistics, GPU timer — all unit-testable  
**M2 — "Visible graph"** (Steps 4–5): Graph rendering + data pipeline → first visible performance graph  
**M3 — "Full frames"** (Steps 6–7): Interactive features + theme + polish

### Parallelization

- **Phase 1** (ring buffer + stats) and **Phase 2** (GPU timer) have zero dependencies → can be developed in parallel
- **Phase 1** is pure TypeScript — fully unit-testable with synthetic data
- **Phase 4** (interactive features) can begin as soon as Phase 3 produces a drawable graph

---

# Conventions & Constraints

### TypeScript
- All new source in TypeScript
- Ring buffer + stats: `src/inspector/frames/` — pure logic, no GL or DOM dependency
- GPU timer: `src/inspector/frames/` — webview-side, references `WebGL2RenderingContext`
- Graph renderer: `src/inspector/frames/` — inspector panel-side, uses Canvas 2D
- Follow existing project style (2-space indent, single quotes, no semicolons)

### Architecture Alignment
- Frames tab lives inside the inspector panel (Phase 0 scaffold)
- IPC messages routed through `ShaderToyManager` hub
- GPU timer integrated into existing render loop (not a separate pass)
- Canvas uses fill-container mode by default (panel fills inspector panel area)

### No React
- FragCoord's `Q8` is a React component with `useState`, `useEffect`, `useRef`
- Our port uses vanilla JS/TS with explicit state object + `requestAnimationFrame`
- All React patterns translated to imperative equivalents

### Performance Considerations
- IPC throttled to ~60Hz (one message per 16ms)
- Graph redraws via requestAnimationFrame (coalesced)
- Ring buffers use Float64Array (typed arrays, no GC pressure)
- Canvas operations batched in single draw call
- GPU timer: no `gl.finish()` stalls (async queries)

### Testing
- Ring buffer: unit tests (push, at, clear, capacity wrap, toArray)
- Statistics: unit tests with known datasets (verify min/max/avg/P50/P99)
- EMA: unit tests (verify smoothing against manual computation)
- GPU timer: integration test (mock GL context + extension)
- Graph rendering: visual verification with demo shaders
- Run existing tests: `npm run test`

### Build
- `npm run webpack` for development build
- `npm run compile` for TypeScript check

---

# Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| `EXT_disjoint_timer_query_webgl2` unavailable | No GPU timing | Graceful fallback: hide GPU bars, show CPU only |
| IPC latency adds to measured frame time | Inflated CPU timing | Measure timing in preview webview (before postMessage), not in panel |
| High-frequency postMessage floods | Performance degradation | Throttle to ~60Hz; batch multiple frames if needed |
| Canvas 2D drawing too slow for 60fps graph | Graph stutters | Profile and optimize; consider reducing DPR on low-end machines |
| ResizeObserver not available | Canvas doesn't resize | Fallback to fixed 240×80 compact mode |
| VSCode theme detection fails | Wrong colors | Default to dark theme; detect `data-vscode-theme-kind` attribute |
| Ring buffer overflow (2000 capacity) | Old data lost | This is expected behavior — circular buffer by design |
| `GPU_DISJOINT_EXT` flag set | GPU timing jumps | Return last known value (matches FragCoord behavior) |
| Graph not visible when panel hidden | Wasted CPU | Check tab visibility; stop data collection when hidden |
| Frame cap setting = 0 (default) | Which reference lines to show? | Show both 60fps and 30fps lines (default behavior) |

---

# Cross-Reference to FragCoord Source Files

| Feature Area | FragCoord v0.7.1 Function | Snippet File |
|-------------|--------------------------|-------------|
| Ring buffer | `l2` class | `071_FrameTimeGraph_Q8.txt` |
| Frame statistics | `xb()` | `071_FrameTimeGraph_Q8.txt` |
| EMA smoothing | `Vj()` | `071_FrameTimeGraph_Q8.txt` |
| Graph component | `Q8()` | `071_FrameTimeGraph_Q8.txt` |
| Frame color helper | `u2()` | `071_FrameTimeGraph_Q8.txt` |
| Rounded rect | `yb()` | `071_FrameTimeGraph_Q8.txt` |
| Theme tokens | `qj` object | `071_FrameTimeGraph_Q8.txt` |
| Graph constants | `Rm`, `Mm`, `c2`, `sd`, `nu`, `Gj`, `Xj`, `Hj`, `Yu` | `071_FrameTimeGraph_Q8.txt` |
| GPU timer init | `_M()` | `071_gpu_timer_query.txt` |
| GPU timer begin | `CM()` | `071_gpu_timer_query.txt` |
| GPU timer end | `EM()` | `071_gpu_timer_query.txt` |
| GPU timer poll | `SM()` | `071_gpu_timer_query.txt` |
| Timer in render loop | L2058 integration | `071_gpu_timer_in_render.txt` |
| Full viewport | ShaderViewport | `071_ShaderViewport.txt` |
| CSS styles | `.frame-time-*` | `071_feature_css_all.txt` |
