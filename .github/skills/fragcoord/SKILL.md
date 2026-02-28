# FragCoord.xyz v0.7.1 — AI Agent SKILL File

> **Purpose**: Comprehensive reference for AI coding agents implementing FragCoord-style shader debugging features in WebGL/WebView-based projects (e.g., VSCode extensions).
>
> **Companion files** (assume co-located):
> - `fragcoord-overview(0.7.1).md` — Full architecture overview
> - `fragcoord-inspect(0.7.1)-REPORT.md` — Variable inspector deep-dive
> - `fragcoord-errors(0.7.1)-REPORT.md` — Error diagnostics deep-dive
> - `fragcoord-frames(0.7.1)-REPORT.md` — Frame timing deep-dive
> - `fragcoord-heatmap(0.7.1)-REPORT.md` — Heatmap/instruction-counting deep-dive
> - `fragcoord-transplant-plan(0.7.1).md` — VSCode transplant plan with code snippets
> - `inspector(0.7.1)/` — 113 extracted evidence snippets (`071_*.txt`)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Feature: Variable Inspector (Inspect)](#2-feature-variable-inspector-inspect)
3. [Feature: Error Diagnostics (Errors)](#3-feature-error-diagnostics-errors)
4. [Feature: Frame Timing (Frames)](#4-feature-frame-timing-frames)
5. [Feature: Performance Heatmap](#5-feature-performance-heatmap)
6. [Shared Infrastructure](#6-shared-infrastructure)
7. [Transplant Quick-Reference](#7-transplant-quick-reference)
8. [Key Constants & Thresholds](#8-key-constants--thresholds)
9. [File Cross-Reference Index](#9-file-cross-reference-index)

---

## 1. Architecture Overview

**Source**: `fragcoord-overview(0.7.1).md` §1–§7

### 1.1 Bundle Structure

Single minified bundle: `assets__index-CJG3BMBW.js` (1134 KB), plus CSS `assets__index-D_Y2Ybco.css` (29 KB). All features live in one scope — no dynamic imports for core functionality.

### 1.2 React Component Hierarchy

```
Editor (L2521-2548)            — top-level, 163 useState, 78 useRef, 17 useCallback, 47 useEffect, 14 useMemo
├── CodeEditor (L1988)         — Monaco wrapper, decorations, gutter annotations
├── ShaderViewport / Jj (L2058)— WebGL canvas, inspector overlay, heatmap overlay
├── FrameTimeGraph / Q8 (L2056)— Canvas-based frame graph (240×80 or fill)
├── InspectorHistogram         — Value histogram sidebar
└── SubModeBar                 — Mode selector (tuner/inspect/errors/frames/heatmap)
```

### 1.3 Sub-Modes

Defined in array `ew` (see `fragcoord-overview(0.7.1).md` §3):

| Index | Mode      | Key State Variables | Primary Functions |
|-------|-----------|--------------------|--------------------|
| 0     | tuner     | uniform overrides  | uniform slider UI  |
| 1     | inspect   | `inspVar`, `inspMap`, `compareMode` | `Bj()`, `Oj()`, `K1()`, `Fj()` |
| 2     | errors    | `errorPixels`, `shaderWarnings` | `Xd()`, NaN probe loop, `Mj()` |
| 3     | frames    | `frameTimes`, `gpuTimes` | `_M()`, `CM()`, `EM()`, `SM()`, `Q8()` |
| 4     | heatmap   | `heatmapData`, `lineCountMap` | `wj()`, `Oh()`, `bM()`, `$8()` |

### 1.4 Data Flow (General Pattern)

```
User Action → State Change → Shader Rewriting → WebGL Render → Readback → UI Update
```

Every inspector sub-mode follows this pattern:
1. **Trigger**: user selects variable / enables mode
2. **Rewrite**: shader source is modified (add outputs, instrumentation, probes)
3. **Render**: modified shader runs on WebGL canvas
4. **Readback**: `gl.readPixels()` extracts data from framebuffer
5. **Display**: React state update drives UI (overlays, graphs, decorations)

### 1.5 WebGL Rendering Engine

**See**: `fragcoord-overview(0.7.1).md` §4

- Dual-FBO ping-pong for multipass (`Zj` / `fM` — RGBA32F float textures)
- Multipass: each `iChannel` can be `"previous"` (feedback) or another buffer
- Resolution: canvas size × DPR (capped at 3), auto-resize via ResizeObserver
- Uniform binding: `iResolution`, `iTime`, `iFrame`, `iMouse`, `iDate`, `iChannel0-3`, `iKeyboard`

---

## 2. Feature: Variable Inspector (Inspect)

**Primary Reference**: `fragcoord-inspect(0.7.1)-REPORT.md` (all sections)
**Evidence Snippets**: `inspector(0.7.1)/071_inspmap_full_pipeline.txt`, `071_shader_rewriting_Bj.txt`, `071_compare_mode.txt`, `071_histogram_pipeline.txt`

### 2.1 Machinery Overview

The inspect feature lets users click on any variable/expression in the shader code, then visualizes that value as a color-mapped overlay on the viewport. It works by **rewriting the shader** to output the selected variable's value instead of the normal `fragColor`.

### 2.2 Pipeline Steps

```
Variable Selection (cursor click)
  → Type Inference (a2)
  → Scope Analysis (find declaration context)
  → Shader Rewriting (Bj or Oj)
     ├── Preprocessing: Y8 (ShaderToy compat) → H8 (find main) → K8 (for-loop fix) → Y1 (fragColor→_inspFC)
     ├── #define expansion: Dj/s4 (NEW in 0.7.1)
     ├── Expression analysis: mb (NEW in 0.7.1) 
     ├── Function signature parser: ep (NEW in 0.7.1)
     ├── Range annotation: Pj() parses `// [min, max]` comments
     ├── Type wrapping: K1() converts any type → vec4
     └── Mapping: Fj() generates mapping code (linear/sigmoid/log)
  → Compile & Render (inspected shader)
  → Readback (gl.readPixels on hover pixel)
  → Histogram (sample grid → bin → render)
```

### 2.3 Key Functions

| Function | Purpose | Report Section |
|----------|---------|----------------|
| `a2(token)` | Infer GLSL type from declaration/context | `fragcoord-inspect(0.7.1)-REPORT.md` §2 |
| `Bj(source, variable, options)` | Main rewrite entry — mapped inspector mode | §3 |
| `Oj(source, variable, options)` | Compare mode rewrite (side-by-side) | §4 |
| `K1(expr, type)` | Wrap any GLSL type → `vec4` for output | §3.3 |
| `Fj(mapping, range)` | Generate mapping function (linear/sigmoid/log) | §3.4 |
| `Pj(source, varName)` | Extract `// [min, max]` range annotations | §3.5 |
| `Y8(source)` | ShaderToy → standard GLSL preprocessing | §3.1 |
| `H8(source)` | Find `main()` function boundaries | §3.1 |
| `K8(source)` | Fix for-loop scoping issues | §3.1 |
| `Y1(source)` | Rename `fragColor` → `_inspFC` to capture original output | §3.1 |
| `Dj(source)` / `s4()` | Parse and expand `#define` macros (NEW 0.7.1) | §2.2 |
| `mb(expr)` | Enhanced expression/swizzle analysis (NEW 0.7.1) | §2.3 |
| `ep(source)` | Function signature parser for cross-function inspect (NEW 0.7.1) | §2.4 |

### 2.4 Mapping Modes

Generated by `Fj()` — three flavors:

| Mode | Formula | Use Case |
|------|---------|----------|
| **linear** | `(value - min) / (max - min)` | Default, bounded values |
| **sigmoid** | `1.0 / (1.0 + exp(-k * value))` | Unbounded values, smooth S-curve |
| **log** | `log(1.0 + abs(value)) / log(1.0 + maxVal)` | Large dynamic ranges |

### 2.5 Type Wrapping (K1)

Converts any GLSL type to `vec4` for framebuffer output:

| Input Type | Wrapping |
|------------|----------|
| `float` | `vec4(v, 0.0, 0.0, 1.0)` |
| `int` / `bool` | `vec4(float(v), 0.0, 0.0, 1.0)` |
| `vec2` | `vec4(v, 0.0, 1.0)` |
| `vec3` | `vec4(v, 1.0)` |
| `vec4` | identity |
| `mat2/3/4` | first column → vec4 |

### 2.6 Compare Mode

Uses WebGL **scissor test** to render original shader on one side, inspected on the other:
- Split position configurable in range `[0.1, 0.9]`
- Draggable divider in UI
- Rewrite function: `Oj()` instead of `Bj()`

### 2.7 Histogram

- **Sample grid**: reads pixel values across viewport at regular intervals
- **Binning**: values mapped to N bins (typically 64 or 128)
- **Rendering**: horizontal bar chart in sidebar
- **See**: `fragcoord-inspect(0.7.1)-REPORT.md` §5, snippet `071_histogram_pipeline.txt`

### 2.8 Transplant Notes

**See**: `fragcoord-transplant-plan(0.7.1).md` §3 (Inspect Plan)

- **Priority**: P4 (Medium effort, Very High value)
- **Extension Host side**: cursor position → identify variable → send to WebView
- **WebView side**: shader rewriting → render → readback → send histogram data back
- **Key challenge**: type inference without full GLSL parser; regex-based `a2()` works surprisingly well
- **Start with**: single-variable float inspect, then expand to vec/mat types

---

## 3. Feature: Error Diagnostics (Errors)

**Primary Reference**: `fragcoord-errors(0.7.1)-REPORT.md` (all sections)
**Evidence Snippets**: `inspector(0.7.1)/071_nan_inf_oor_full.txt`, `071_shader_warnings_full.txt`, `071_compile_error_parsing.txt`, `071_error_overlay.txt`

### 3.1 Three-Layer Error Detection

```
Layer 1: Compile-Time Errors (Xd)
  └── GL shader compilation → parse error messages → line/column positions → editor decorations

Layer 2: Runtime Pixel Errors (NaN/Inf/OOR probe)
  └── Low-res render → readPixels → scan for NaN/Inf/OOR → pixel error overlay

Layer 3: Shader Analysis Warnings (Mj) [NEW in 0.7.1]
  └── Static regex analysis → 9 warning categories → gutter icons + tooltip details
```

### 3.2 Layer 1: Compile-Time Errors

**Function**: `Xd(gl, source)` with LRU cache

Pipeline:
1. Compile shader with `gl.compileShader()`
2. If fail → `gl.getShaderInfoLog()` → parse error string
3. Error format: `ERROR: 0:LINE:COL: message` (vendor-specific variations handled)
4. Results → Monaco editor diagnostics (red squiggles, Problems panel)

**See**: `fragcoord-errors(0.7.1)-REPORT.md` §2

### 3.3 Layer 2: Runtime NaN/Inf/OOR Detection

**Constants**:
- Probe resolution: **32×32** pixels (`Zu = 32`)
- Probe interval: every **60 frames** (`Kj = 60`)
- FBO format: **RGBA32F** (required for NaN/Inf detection — RGBA8 clamps!)
- OOR threshold: **±0.002** outside [0,1] range

**Pipeline**:
1. Render shader at 32×32 into float FBO
2. `gl.readPixels()` → `Float32Array`
3. Scan every pixel:
   - `Number.isNaN(v)` → NaN error
   - `!Number.isFinite(v)` → Infinity error  
   - `v < -0.002 || v > 1.002` → Out-of-range warning
4. Results displayed as colored pixel overlay on viewport
5. Summary counts shown in error panel

**NEW in 0.7.1** — `_npR()` GLSL helper functions:
- Overloaded for `float`, `vec2`, `vec3`, `vec4`
- Reduces any type to single float for NaN propagation checking
- Injected into instrumented shader source

**See**: `fragcoord-errors(0.7.1)-REPORT.md` §3, snippet `071_nan_inf_oor_full.txt`

### 3.4 Layer 3: Shader Analysis Warnings (NEW in 0.7.1)

**Function**: `Mj(source)` — static analysis via regex pattern matching

Nine warning categories:

| Kind | Pattern | Risk | Color |
|------|---------|------|-------|
| `division` | `/ expr` (not literal) | Division by zero | orange |
| `sqrt` | `sqrt(expr)` | Negative argument → NaN | yellow |
| `inversesqrt` | `inversesqrt(expr)` | Zero/negative → NaN/Inf | yellow |
| `log` | `log(expr)` / `log2()` | Non-positive → NaN | yellow |
| `pow` | `pow(base, exp)` | Negative base → NaN | orange |
| `asin` | `asin(expr)` | \|arg\| > 1 → undefined | cyan |
| `acos` | `acos(expr)` | \|arg\| > 1 → undefined | cyan |
| `atan` | `atan(y, x)` | Both zero → undefined | cyan |
| `mod` | `mod(a, b)` | b=0 → undefined | orange |

Each warning produces: `{ kind, color, description, line, column }`

**Display**: gutter warning icons in editor + tooltip with explanation

**See**: `fragcoord-errors(0.7.1)-REPORT.md` §4, snippet `071_shader_warnings_full.txt`

### 3.5 Transplant Notes

**See**: `fragcoord-transplant-plan(0.7.1).md` §2 (Errors Plan)

- **Priority**: P0 (compile errors) + P1 (shader analysis) — Lowest effort, highest ROI
- **Compile errors**: Use VSCode Diagnostics API (`vscode.languages.createDiagnosticCollection`)
- **Shader analysis**: Pure text processing — can run entirely in extension host, no WebView needed
- **NaN probe**: Requires WebView with float FBO — Priority P3

---

## 4. Feature: Frame Timing (Frames)

**Primary Reference**: `fragcoord-frames(0.7.1)-REPORT.md` (all sections)
**Evidence Snippets**: `inspector(0.7.1)/071_FrameTimeGraph_Q8.txt`, `071_gpu_timer_query.txt`, `071_frame_ring_buffer.txt`, `071_frame_statistics.txt`

### 4.1 Dual Timing Sources

```
CPU Time: performance.now() delta in requestAnimationFrame loop
GPU Time: EXT_disjoint_timer_query_webgl2 extension
```

### 4.2 GPU Timer Query Protocol

Four functions manage the async GPU timer lifecycle:

| Function | Role | When Called |
|----------|------|------------|
| `_M(gl)` | **Init**: get extension, create query pool | Once at WebGL init |
| `CM(gl, ext)` | **Begin**: `beginQuery(TIME_ELAPSED_EXT)` | Before draw calls |
| `EM(gl, ext)` | **End**: `endQuery()` | After draw calls |
| `SM(gl, ext, query)` | **Poll**: check `QUERY_RESULT_AVAILABLE`, read ns→ms | Next frame+ |

**Critical detail**: GPU queries are **async** — result isn't available until 1-2 frames later. FragCoord uses a query pool and polls oldest query each frame.

**See**: `fragcoord-frames(0.7.1)-REPORT.md` §2, snippet `071_gpu_timer_query.txt`

### 4.3 Ring Buffer (l2 class)

- Backing store: `Float64Array`
- Capacity: **2000** samples (up from 1000 in v0.6.2)
- Circular write with `push()`, O(1)
- `slice(start, end)` handles wrap-around correctly
- `toArray()` returns ordered copy for rendering

**See**: `fragcoord-frames(0.7.1)-REPORT.md` §4, snippet `071_frame_ring_buffer.txt`

### 4.4 Statistics Engine

**Function**: `xb(ringBuffer)` computes:

| Metric | Algorithm |
|--------|-----------|
| `min` / `max` | Linear scan |
| `avg` | Running sum / count |
| `p50` | Sorted array, index at 50% |
| `p99` | Sorted array, index at 99% |
| `fps` | `1000 / avg` |
| `stutterCount` | Frames > 2× average |

**EMA Smoothing**: `Vj(current, previous, alpha)` with `alpha = 0.15` (constant `Gj`)
- Formula: `result = alpha * current + (1 - alpha) * previous`
- Applied to displayed statistics for smooth updates

**See**: `fragcoord-frames(0.7.1)-REPORT.md` §5, snippet `071_frame_statistics.txt`

### 4.5 Canvas Graph (Q8 Component)

**Dimensions**: 240×80 (compact) or fill-container mode, DPR-aware (capped at 3)

**10 Drawing Layers** (in order):
1. Background fill
2. Horizontal grid lines (target frametime references: 16.67ms, 33.33ms)
3. GPU time bars (green/teal)
4. CPU time bars (blue)
5. Stutter markers (red highlights for frames > 2× avg)
6. Average line (dashed)
7. P99 line (dotted)
8. Current frame marker (vertical line)
9. Statistics text overlay (min/max/avg/fps)
10. Axis labels

**NEW in 0.7.1**:
- Dual themes (dark + light, 22 color tokens)
- Scroll zoom: mouse wheel adjusts visible window (20–2000 frames)
- ms/fps toggle display mode
- Ref-based push mode (bypass React render for perf)

**See**: `fragcoord-frames(0.7.1)-REPORT.md` §6, snippet `071_FrameTimeGraph_Q8.txt`

### 4.6 Transplant Notes

**See**: `fragcoord-transplant-plan(0.7.1).md` §4 (Frames Plan)

- **Priority**: P2 (Medium effort, High value)
- **WebView side**: all rendering — Canvas 2D graph, GPU timer queries
- **Extension Host side**: optional stats display in status bar
- **Key challenge**: `EXT_disjoint_timer_query_webgl2` may not be available in all WebView contexts; provide CPU-only fallback
- **Start with**: CPU timing + basic graph, add GPU timing as enhancement

---

## 5. Feature: Performance Heatmap

**Primary Reference**: `fragcoord-heatmap(0.7.1)-REPORT.md` (all sections)
**Evidence Snippets**: `inspector(0.7.1)/071_heatmap_rewriting_full.txt`, `071_heatmap_overlay.txt`, `071_heatmap_line_counts.txt`, `071_heatmap_downsample.txt`

### 5.1 Major Architecture Change (0.6.2 → 0.7.1)

| Aspect | v0.6.2 | v0.7.1 |
|--------|--------|--------|
| **Method** | Per-tile `gl.finish()` GPU timing | Instruction counting (`_ic++`) |
| **Accuracy** | Wall-clock (noisy, driver-dependent) | Deterministic (exact instruction count) |
| **Overhead** | Very high (N×M tile renders) | Single render pass |
| **Per-line** | Not available | Available via `$8()`/`_j()`/`Cj()` |

### 5.2 Shader Instrumentation Pipeline

**Entry point**: `wj(source)` → dispatches to `Ej()` (standard) or `Sj()` (ShaderToy format)

**Transformation chain**:
```
Source GLSL
  → Oh(source)    — Insert `_ic++` after every statement (`;` → `; _ic++;`)
  → z8(source)    — Normalize for-loops (ensure braces, countable iterations)
  → W8(source)    — Strip dead code (unreachable after return/break/discard)
  → _0(source)    — Instrument user-defined functions (cross-function counting)
  → V8(source)    — Add `int _ic = 0;` declaration at top of main()
  → Replace fragColor assignment with: `fragColor = vec4(float(_ic), 0.0, 0.0, 1.0);`
```

**The output**: shader that renders RED channel = instruction count per pixel.

**See**: `fragcoord-heatmap(0.7.1)-REPORT.md` §2, snippet `071_heatmap_rewriting_full.txt`

### 5.3 Per-Line Instruction Counts (NEW in 0.7.1)

Three-function pipeline:

| Function | Purpose |
|----------|---------|
| `$8(source)` | Parse source into line-level AST-like structure |
| `_j(source, lineMap)` | Instrument each line to output its _ic delta |
| `Cj(pixels, lineMap)` | Aggregate pixel readback into per-line count map |

**Plus**: `Bv(source)` — regex-based instruction counter that estimates cost per line without rendering (fast preview for editor gutter).

**Display**: editor gutter annotations showing relative cost per line (colored bars, numeric counts).

**See**: `fragcoord-heatmap(0.7.1)-REPORT.md` §3, snippet `071_heatmap_line_counts.txt`

### 5.4 GPU Downsample Pipeline

Two modes for reading back the _ic texture:

| Function | Method | Resolution | Use |
|----------|--------|------------|-----|
| `wM()` / `yM` | SIMD max-pool shader | Progressive halving | Primary (fast) |
| `M3()` / `mM` | Simple bilinear | 64×64 fixed | Fallback |

**Max-pool**: renders _ic texture at half resolution repeatedly until small enough to readPixels efficiently. Takes max (not average) to preserve hotspots.

### 5.5 Temporal Smoothing

```
smoothed = mix(previous, current, alpha)
alpha = 1.0 - exp(-9.75 * deltaTime)
```

Frame-rate independent — converges at same visual speed regardless of fps.

### 5.6 Overlay Rendering

**Function**: `bM()` with fragment shader `xM`

**Color ramps** (6-stop thermal):
| Stop | Color | Meaning |
|------|-------|---------|
| 0.0 | Black | No instructions |
| 0.2 | Blue | Low cost |
| 0.4 | Red | Medium cost |
| 0.6 | Orange | High cost |
| 0.8 | Yellow | Very high cost |
| 1.0 | White | Maximum cost |

Alternative: `grayscaleRamp` (linear black→white)

**Compositing**: overlay blended on top of original render with configurable opacity.

**See**: `fragcoord-heatmap(0.7.1)-REPORT.md` §4-§5, snippets `071_heatmap_overlay.txt`, `071_heatmap_downsample.txt`

### 5.7 Transplant Notes

**See**: `fragcoord-transplant-plan(0.7.1).md` §5 (Heatmap Plan)

- **Priority**: P5 (High effort, High value) — most complex feature
- **Key insight**: instruction counting is deterministic and doesn't need GPU timer extensions
- **Extension Host side**: per-line counts → editor gutter decorations
- **WebView side**: shader rewriting, _ic render, downsample, overlay compositing
- **Start with**: basic Oh() instrumentation + simple overlay, then add per-line counts

---

## 6. Shared Infrastructure

**See**: `fragcoord-overview(0.7.1).md` §4, `fragcoord-transplant-plan(0.7.1).md` §6

### 6.1 Shader Preprocessing Stack

Used by ALL features before their specific rewriting:

```
Y8(source)  — ShaderToy compatibility (mainImage → main, fragCoord → gl_FragCoord, etc.)
H8(source)  — Find main() function boundaries (start line, end line, body range)
K8(source)  — Fix for-loop scoping (ensure variables declared in loop don't leak)
```

### 6.2 Float FBO Setup

Required by: Inspect (readback), Errors (NaN probe), Heatmap (_ic readback)

```javascript
// Pseudocode — see fragcoord-overview(0.7.1).md §4.2
const fbo = gl.createFramebuffer();
const tex = gl.createTexture();
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
// Check: gl.checkFramebufferStatus() === gl.FRAMEBUFFER_COMPLETE
// Requires: OES_texture_float_linear extension for filtering
```

### 6.3 Readback Pattern

```javascript
gl.readPixels(x, y, width, height, gl.RGBA, gl.FLOAT, float32Array);
// For NaN detection: MUST use FLOAT type — UNSIGNED_BYTE clamps NaN to 0
```

### 6.4 Message Protocol (for VSCode Extension)

Recommended WebView ↔ Extension Host protocol:

```typescript
// Extension → WebView
{ type: 'inspect',   variable: string, line: number, mapping: 'linear'|'sigmoid'|'log' }
{ type: 'heatmap',   enabled: boolean }
{ type: 'errors',    enabled: boolean }
{ type: 'compile',   source: string }

// WebView → Extension
{ type: 'diagnostics',  errors: DiagnosticItem[] }
{ type: 'inspectData',  histogram: number[], value: number[], hover: {x,y,rgba} }
{ type: 'heatmapData',  lineCounts: Map<number, number> }
{ type: 'frameStats',   cpu: StatsObj, gpu: StatsObj | null }
{ type: 'nanProbe',     nanCount: number, infCount: number, oorCount: number, pixels: PixelError[] }
```

### 6.5 Extension Architecture Split

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│     Extension Host          │     │       WebView Panel         │
│                             │     │                             │
│  • Editor API (cursor,      │◄───►│  • WebGL canvas             │
│    decorations, diagnostics)│     │  • Shader compilation       │
│  • Shader analysis (Mj)    │     │  • Inspector rendering      │
│  • File watching            │     │  • Heatmap overlay          │
│  • Status bar updates       │     │  • Frame graph (Canvas 2D)  │
│  • Gutter annotations       │     │  • NaN probe               │
│    (line counts, warnings)  │     │  • readPixels               │
│                             │     │  • postMessage ↔            │
└─────────────────────────────┘     └─────────────────────────────┘
```

---

## 7. Transplant Quick-Reference

**Full detail**: `fragcoord-transplant-plan(0.7.1).md`

### Implementation Priority Order

| Phase | Feature | Effort | Value | Dependencies |
|-------|---------|--------|-------|--------------|
| P0 | Compile error diagnostics | Low | High | WebGL context |
| P1 | Shader analysis warnings (Mj) | Low-Med | High | Regex only, no WebGL |
| P2 | Frame timing graph | Medium | High | Canvas 2D, GPU timer optional |
| P3 | NaN/Inf runtime detection | Medium | High | Float FBO |
| P4 | Variable inspector (basic) | Medium | Very High | Shader rewriting, float FBO |
| P5 | Heatmap + per-line counts | High | High | Full instrumentation pipeline |

### Per-Feature Minimum Viable Implementation

**Compile Errors (P0)**:
1. Compile shader via WebGL in WebView
2. Parse error log → structured diagnostics
3. Send to extension host → `DiagnosticCollection`
4. ~200 lines of code

**Shader Warnings (P1)**:
1. Port `Mj()` regex patterns (9 categories)
2. Run on source text in extension host
3. Create diagnostic entries with severity=Warning
4. ~150 lines of code

**Frame Graph (P2)**:
1. Port `l2` ring buffer class (~50 lines)
2. Port `xb()` statistics (~40 lines)
3. Port `Q8` canvas renderer (~200 lines)
4. Add GPU timer if extension available (~80 lines)
5. ~370 lines of code

**NaN Probe (P3)**:
1. Create 32×32 float FBO
2. Render shader at low res
3. Scan Float32Array for NaN/Inf/OOR
4. Overlay error pixels on main canvas
5. ~250 lines of code

**Variable Inspector (P4)**:
1. Port preprocessing stack: Y8, H8, K8, Y1 (~200 lines)
2. Port type inference a2() (~100 lines)
3. Port K1() type wrapping (~50 lines)
4. Port Bj() rewriting (~300 lines)
5. Port Fj() mapping modes (~80 lines)
6. Histogram binning + rendering (~150 lines)
7. ~880 lines of code

**Heatmap (P5)**:
1. Port Oh() statement instrumentation (~150 lines)
2. Port z8() loop normalization (~100 lines)
3. Port W8() dead code stripping (~80 lines)
4. Port V8() + _0() function instrumentation (~120 lines)
5. Port downsample pipeline (~100 lines)
6. Port overlay shader + compositing (~100 lines)
7. Port per-line counting: $8(), _j(), Cj() (~200 lines)
8. ~850 lines of code

---

## 8. Key Constants & Thresholds

| Constant | Value | Used By | Notes |
|----------|-------|---------|-------|
| `Zu` | `32` | NaN probe | Probe render resolution (32×32 = 1024 pixels) |
| `Kj` | `60` | NaN probe | Frames between probes |
| `Gj` | `0.15` | Frame stats | EMA smoothing alpha |
| Ring buffer capacity | `2000` | Frame graph | `Float64Array` backing |
| DPR cap | `3` | All rendering | `Math.min(devicePixelRatio, 3)` |
| OOR threshold | `±0.002` | NaN probe | Out-of-range tolerance |
| Heatmap smoothing | `1 - exp(-9.75 * dt)` | Heatmap | Frame-rate independent alpha |
| Heatmap downsample target | `64×64` | Heatmap | Fallback bilinear resolution |
| Compare split range | `[0.1, 0.9]` | Inspector | Draggable divider bounds |
| Thermal ramp stops | `6` | Heatmap | Black→Blue→Red→Orange→Yellow→White |
| Graph dimensions | `240×80` | Frame graph | Compact mode (px, before DPR) |
| Graph zoom range | `20–2000` | Frame graph | Scroll wheel adjustable |
| Stutter threshold | `2× avg` | Frame stats | Frames flagged as stutter |

---

## 9. File Cross-Reference Index

### Report Files

| File | Content | Key Sections to Reference |
|------|---------|--------------------------|
| `fragcoord-overview(0.7.1).md` | Architecture, components, data flow | §1 Bundle, §3 State, §4 WebGL, §5 Rewriting, §6 Heatmap |
| `fragcoord-inspect(0.7.1)-REPORT.md` | Inspector deep-dive | §2 Selection, §3 Rewriting, §4 Compare, §5 Histogram |
| `fragcoord-errors(0.7.1)-REPORT.md` | Error diagnostics | §2 Compile, §3 NaN Probe, §4 Shader Analysis |
| `fragcoord-frames(0.7.1)-REPORT.md` | Frame timing | §2 GPU Timer, §4 Ring Buffer, §5 Stats, §6 Canvas |
| `fragcoord-heatmap(0.7.1)-REPORT.md` | Heatmap | §2 Instrumentation, §3 Per-Line, §4 GPU Pipeline, §5 Overlay |
| `fragcoord-transplant-plan(0.7.1).md` | VSCode plan | §1 Arch, §2 Errors, §3 Inspect, §4 Frames, §5 Heatmap, §6 Shared, §7 Roadmap |

### Key Evidence Snippets (inspector(0.7.1)/)

| Snippet File | What It Contains |
|-------------|------------------|
| `071_inspmap_full_pipeline.txt` | Complete Bj() rewriting pipeline |
| `071_shader_rewriting_Bj.txt` | Bj() function detail |
| `071_compare_mode.txt` | Compare/scissor mode implementation |
| `071_histogram_pipeline.txt` | Histogram sampling and binning |
| `071_nan_inf_oor_full.txt` | Complete NaN/Inf/OOR detection code |
| `071_shader_warnings_full.txt` | Mj() all 9 warning categories |
| `071_compile_error_parsing.txt` | Xd() compile error parsing |
| `071_error_overlay.txt` | Error pixel overlay rendering |
| `071_FrameTimeGraph_Q8.txt` | Complete Q8 canvas graph component |
| `071_gpu_timer_query.txt` | _M/CM/EM/SM GPU timer functions |
| `071_frame_ring_buffer.txt` | l2 ring buffer class |
| `071_frame_statistics.txt` | xb() statistics computation |
| `071_heatmap_rewriting_full.txt` | Oh/z8/W8/_0/V8 instrumentation chain |
| `071_heatmap_overlay.txt` | bM()/xM overlay shader + compositing |
| `071_heatmap_downsample.txt` | wM/yM/M3/mM downsample pipeline |
| `071_heatmap_line_counts.txt` | $8/_j/Cj per-line count pipeline |

---

## Usage Notes for AI Agents

1. **Start with this SKILL file** for architecture overview and function-level understanding.
2. **Dive into specific REPORTs** (linked above) for implementation details and rationale.
3. **Check evidence snippets** in `inspector(0.7.1)/` for actual minified source extracts.
4. **Follow transplant plan** priority order (P0→P5) for incremental implementation.
5. **Shader rewriting is the core technique** — all features work by modifying GLSL source before compilation.
6. **Float FBO is prerequisite** for inspect, errors (NaN), and heatmap — implement this first in shared infrastructure.
7. **The preprocessing stack (Y8/H8/K8) is shared** — implement once, reuse across all features.
8. **Message protocol** between extension host and WebView is the integration glue — design it early.

---

*Generated from FragCoord.xyz v0.7.1 source analysis. Bundle: `assets__index-CJG3BMBW.js` (1134KB). All function names reference minified identifiers from this specific build.*
