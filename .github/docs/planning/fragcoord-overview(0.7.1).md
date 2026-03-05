# FragCoord.xyz — Implementation Overview (v0.7.1)

> **Source version**: 0.7.1 — production bundles downloaded from [fragcoord.xyz](https://fragcoord.xyz/)  
> **Source directory**: `0.7.1/`  
> **Extracted snippets**: `inspector(0.7.1)/`  
> **Analysis date**: 2026-02  
> **Previous version analysis**: see `fragcoord-overview(0.6.2).md`

---

## 1. Bundle Architecture

v0.7.1 merges the previously split main + Editor chunks back into a **single main bundle**, while adding many more lazy-loaded page chunks:

| File | Size | Role |
|------|------|------|
| `assets__index-CJG3BMBW.js` | 1134 KB | **All-in-one**: React 18.3.1, React Router, WebGL engine, shader compilation, Monaco integration, all inspector/frames/errors/heatmap features, ~2548 lines (minified) |
| `assets__supabase-CQnWzhEg.js` | 173 KB | Supabase SDK (unchanged from 0.6.2, same SHA) |
| `assets__monaco-DFk0Ye1J.js` | 2130 KB | Monaco editor (unchanged from 0.6.2, same SHA) |
| `assets__index-BzSRCPZX.css` | 185 KB | All application styles (5.6× larger than 0.6.2's 33 KB) |
| `assets__monaco-D24tEXuw.css` | 113 KB | Monaco editor styles (unchanged) |
| `assets__codicon-BuT2v_Yt.ttf` | 74 KB | **New**: Codicon icon font (for Monaco icons) |

### Lazy-Loaded Chunks (from `__vite__mapDeps`)

v0.7.1 now lazy-loads **12 page chunks** (vs. 5 in 0.6.2):

```
Docs, Gallery, ShaderCardLivePreview, Profile, Changelog,
Feedback, PrivacyPolicy, NotificationsPage, ResetPasswordPage,
OAuthConsentPage, SettingsPage  (+ CSS per each)
```

**Ref**: `inspector(0.7.1)/071_vite_map_deps.txt`

### Key Architectural Shift

```
0.6.2:  main (294 KB) + Editor chunk (760 KB) = ~1054 KB  →  cross-chunk import
0.7.1:  single index (1134 KB)                            →  no import boundary
```

All feature code is now in the same scope — no more `export n as so` cross-chunk import indirection. This simplifies the call graph: render functions, shader compilation, and UI components share the same module scope.

---

## 2. React Component Hierarchy

### Major Components (minified names → roles)

| Minified | Line | Role | Hooks |
|----------|------|------|-------|
| **Editor** | L2521–2548 | **Main Editor** — top-level orchestrator | 163 `useState`, 78 `useRef` |
| **Jj** (eA) | L2058 | **ShaderViewport** — WebGL canvas, render pipeline, NaN detection, heatmap | ~46 KB, ~128 hooks |
| **CodeEditor** | L1988 | **CodeEditor** — Monaco wrapper, variable selection, line heat annotations | JSX + editor mount |
| **Q8** | L2056 | **FrameTimeGraph** — canvas-based CPU/GPU timing visualization | ~13 KB |
| **SubModeIcon** | L2331 | **SubModeIcon** — SVG icons for inspector tab modes | switch/case per mode |

### Data Flow

```
Editor (L2521–2548)
├── CodeEditor (L1988)
│   ├── inspectorMode: boolean
│   ├── inspectorVariableRef → selected variable text
│   ├── compileErrors → line decorations
│   ├── heatmapLineCounts → gutter heat annotations (NEW in 0.7.1)
│   └── onSelectionVariable(var) → Editor.inspectorVariable
│
├── Jj/eA — ShaderViewport (L2058)
│   ├── passes, commonSource, activePassIndex, width, height, time, frame
│   ├── inspectorVariable, inspectorMapping, inspectorCompareMode
│   ├── heatmapMode, heatmapChunkSize, heatmapSmoothing, heatmapColorScheme
│   ├── heatmapSimdChunk (NEW: GPU SIMD downsampling grid size)
│   ├── diagnosticOverlay, nanProbe
│   ├── histogramRequest, onHistogram
│   ├── onFrameTime(cpu, gpu) → Editor frame timing state
│   ├── onCompileErrors(errors) → Editor error state
│   ├── onNanDetected(probe) → Editor nanProbe state
│   └── onHeatmapData(data) → Editor heatmap overlay
│
└── Q8 — FrameTimeGraph (L2056)
    ├── visible (when submode === "frames")
    ├── frameTimeMs, gpuTimeMs, frame
    └── Canvas-based rolling graph with registration callbacks
```

---

## 3. Inspector Sub-Modes

Same 5 sub-modes as 0.6.2, defined in `ew` array:

```js
const ew = [
  { key: "tuner",   label: "Tuner" },
  { key: "inspect", label: "Inspect" },
  { key: "errors",  label: "Errors" },
  { key: "frames",  label: "Frames" },
  { key: "heatmap", label: "Heatmap" }
];
```

**Ref**: `inspector(0.7.1)/071_submode_definitions.txt` (L2331)

State management in Editor:

```js
const [jt, Sn] = useState("tuner");  // active sub-mode
```

Mode switching side effects (from L2522):
- `"heatmap"` → enables heatmapMode, clears overlay/data, disables diagnosticOverlay
- `"errors"` → disables heatmapMode, enables diagnosticOverlay with error checks
- Other modes → disables both heatmapMode and diagnosticOverlay

---

## 4. WebGL Rendering Engine

All rendering functions are on **L245** of the main bundle (previously split across main + editor chunks in 0.6.2).

### Core Functions

| Function | Purpose | Ref |
|----------|---------|-----|
| `Kg()` | **Main shader render** — compiles shader, sets uniforms, renders to FBO | `071_render_func_Kg.txt` |
| `dl()` | **Diagnostic-aware render** — wraps `Kg()` with `diagnosticOverlay` support via `XC()` | `071_diagnostic_overlay_render.txt` |
| `bM()` | **Heatmap overlay render** — renders thermal/grayscale color ramp from instruction-count texture | `071_bM_heatmap_overlay.txt` |
| `wM()` | **SIMD downsample** — GPU shader that bins source pixels into grid cells (max-pool) | `071_render_func_wM.txt` |
| `M3()` | **Simple downsample** — GPU shader for basic 64×64 reduction | `071_render_func_M3.txt` |
| `Xd()` | **Shader compilation** — LRU cached compile with error parsing | `071_shader_compile_Xd.txt` |
| `XC()` | **Shader source builder** — adds builtins, handles `#version`, diagnostic overlay | `071_XC_shader_builder.txt` |
| `_M()` | **GPU timer query start** — `beginQuery(TIME_ELAPSED_EXT)` | `071_render_func__M.txt` |
| `CM()` | **GPU timer query start** (variant) | `071_render_func_CM.txt` |
| `EM()` | **GPU timer query end** — `endQuery(TIME_ELAPSED_EXT)` | `071_render_func_EM.txt` |
| `SM()` | **GPU timer query read** — polls `QUERY_RESULT_AVAILABLE`, reads `QUERY_RESULT` | `071_render_func_SM.txt` |
| `Km()` | **FBO → canvas blit** — copy rendered texture to visible canvas | L191 |

### GPU Timer Query Flow

```
_M(gl) → creates query, beginQuery(TIME_ELAPSED_EXT)
  ... render pass ...
EM(gl, timer) → endQuery(), timer.pending = true
  ... next frame ...
SM(gl, timer) → if QUERY_RESULT_AVAILABLE: read QUERY_RESULT → gpuTimeMs
```

**Ref**: `inspector(0.7.1)/071_gpu_timer_query.txt` (L245)

---

## 5. Shader Rewriting Engine

### Inspector Variable Injection

The inspector rewrites the user's fragment shader to output the selected variable through a mapping function.

#### `Bj()` / `Oj()` — Shader Rewrite Functions  
**Ref**: `inspector(0.7.1)/071_inspmap_full_pipeline.txt` (L2014–2055)

Rewriting pipeline:
1. `Y8()` — normalize ShaderToy builtins (`iResolution` → `u_resolution`)
2. `H8()` — find `void main()` boundaries (`mainDeclStart`, `bodyStart`, `closeBrace`)
3. `K8()` — wrap bare `for(...) expr;` into `for(...) { expr; }` (scoping fix)
4. `Y1()` — replace `fragColor`/`gl_FragColor` with `_inspFC`
5. `q8()` — compute insertion point up to inspector line
6. `Fj(mapping)` — generate `_inspMap()` GLSL function
7. `K1(expr, type)` — wrap expression into `vec4` for visualization
8. Insert: `fragColor = _inspMap(vec4_wrapped_expr);`

#### `_inspMap()` — GLSL Mapping Function Generator

**`Fj(mapping)`** generates one of three mapping modes:

| Mode | GLSL Output |
|------|-------------|
| **linear** | `clamp((v.rgb - min) / range, 0.0, 1.0)` |
| **sigmoid** | `1.0 / (1.0 + exp(-8.0 * (2.0 * t - 1.0)))` |
| **log** | `log2(1.0 + t * 255.0) / log2(256.0)` |

With optional **out-of-range highlighting** (magenta/cyan 4px checkerboard):

```glsl
float _ck = mod(floor(gl_FragCoord.x/4.0) + floor(gl_FragCoord.y/4.0), 2.0);
if (belowMin) return vec4(_ck, 0.0, _ck, 1.0);  // magenta/black
else           return vec4(0.0, _ck, _ck, 1.0);  // cyan/black
```

#### Default Mapping Configuration

```js
const e4 = { mode: "linear", min: 0, max: 1, highlightOutOfRange: false };
```

#### Range Annotation Parser

```js
const hb = /\/\/\s*\[\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\]/;
// Parses: // [0.0, 1.0] comments in code to set mapping range
```

**Ref**: `inspector(0.7.1)/071_mapping_config.txt` (L2014)

---

## 6. Heatmap Engine — MAJOR CHANGE from 0.6.2

### v0.6.2 Approach (REMOVED)
- Per-tile scissor-test rendering with `gl.finish()` for synchronous CPU timing
- Measured actual GPU execution time per tile

### v0.7.1 Approach — Instruction Counter
**Ref**: `inspector(0.7.1)/071_heatmap_rewriting_full.txt` (L1988–2000)

The heatmap now measures **shader complexity** (instruction count per pixel) rather than wall-clock GPU time:

1. **`_0(source)`** — instruments shader source, inserting `_ic++` after every statement/expression
2. **`Oh(body)`** — the core instrumenter: inserts `_ic++;` after each `;` at depth=0, and `_ic++,` inside for-loop updates
3. **`z8(body)`** — rewrites `return;` → `_ic++; fragColor = vec4(float(_ic), 0.0, 0.0, 1.0); return;`
4. **`W8(body)`** — strips any `fragColor =` assignments from the instrumented body
5. **`V8(preamble)`** — inserts `int _ic;` declaration before first function
6. **`Ej(source)`** / **`Sj(source)`** — rewrites `main()` / `mainImage()` shaders:
   ```glsl
   void main() {
     _ic = 0;
     /* instrumented body with _ic++ everywhere */
     fragColor = vec4(float(_ic), 0.0, 0.0, 1.0);  // q1
   }
   ```

7. The instrumented shader is rendered at full resolution to an FBO via `Kg()`
8. Downsampling:
   - If `heatmapSimdChunk > 0`: GPU max-pool via `wM()` shader (`yM` GLSL) into custom grid
   - If `heatmapSimdChunk = 0`: GPU downsample via `M3()` into 64×64
9. Pixel readback via `Hg()` → Float32Array
10. Min/max extraction + temporal smoothing: `1 - exp(-9.75 × dt)`
11. Overlay render via `bM()` shader (`xM` GLSL) with thermal/grayscale color ramp

### NEW: Per-Line Instruction Counts

**`$8(source)`** with **`_j()`** / **`Cj()`** returns per-line instruction counts as an `int[]` array, used for **gutter heat annotations** in the Monaco editor. `Bv(instrumentedSource)` counts `_ic++` occurrences per line.

**Ref**: `inspector(0.7.1)/071_line_numbers_L1988.txt`

### Heatmap GLSL Shaders

| Shader | Purpose | Ref |
|--------|---------|-----|
| `xM` | Heatmap overlay — thermalRamp/grayscaleRamp coloring from instruction-count texture | `071_heatmap_shader_xM_full.txt` (L191–224) |
| `yM` | SIMD downsample — max-pool source pixels into grid cells | `071_heatmap_shader_yM_full.txt` (L225–244) |
| `mM` | Simple downsample | `071_heatmap_shader_mM.txt` (L174) |

---

## 7. Feature Summary

### 7a. Inspect Feature
- Variable selection in code editor → shader rewriting → visual output
- Three mapping modes (linear/sigmoid/log) with configurable range
- Compare mode (split view via WebGL scissor test)
- Histogram computation for color distribution
- Inspector curve canvas for value visualization
- Expression type inference with GLSL keyword awareness

### 7b. Frames Feature
- CPU timing via `performance.now()` around render calls
- GPU timing via `EXT_disjoint_timer_query_webgl2`
- Rolling graph visualization in dedicated canvas component (`Q8`)
- Constants: `Zu=32` (NaN probe resolution), `Kj=60` (NaN probe interval), `bb=500` (slow frame threshold ms)

### 7c. Errors Feature
- Pixel-level NaN/Infinity/out-of-range detection
- Reads back rendered pixels via `Hg()` and scans with `Number.isNaN()`, `!Number.isFinite()`
- Out-of-range threshold: `[-0.002, 1.002]` per channel
- Configurable checks: `{nan: true, inf: true, oor: true}`
- Shader analysis warnings: division-by-zero, sqrt(neg), log(≤0), pow(neg), asin/acos(|x|>1), mod(x,0)
- **NEW**: NaN probe helpers `fb = ["float _npR(float v) {...}", ...]` for per-pixel probing

### 7d. Heatmap Feature
- **Instruction-counter approach** (NEW in 0.7.1, replaces 0.6.2's per-tile timing)
- Instruments shader with `_ic++` at every statement
- GPU-side downsampling (SIMD grid or 64×64)
- Thermal / grayscale color schemes
- Temporal smoothing: `1 - exp(-9.75 × dt)` (frame-rate-independent EMA)
- **NEW**: Per-line instruction counts in editor gutter

---

## 8. New Features in 0.7.1 (Not in 0.6.2)

### 8a. Suggestion / Quick Fix System
**Ref**: `inspector(0.7.1)/071_suggestion_quickfix.txt` (L2537–2542)

- `quickFix` (18 occurrences), `autoFix` (4), `suggestion` (31), `codeAction` (2)
- Provides shader fix suggestions with diff preview and "Insert" button
- Integrated with editor via Monaco code action API

### 8b. Video Recording
**Ref**: `inspector(0.7.1)/071_recording_section.txt` (L2535)

- `MediaRecorder` + `captureStream()` for WebGL canvas recording
- MP4 output with mp4-muxer (WebCodecs API)
- WebM fallback
- UI controls for start/stop recording

### 8c. Shader Analysis Warnings
**Ref**: `inspector(0.7.1)/071_shader_warnings_full.txt` (L2008–2016)

- `Mj(source)` analyzes shader for potentially dangerous operations
- Categories: `division`, `sqrt`, `inversesqrt`, `log`, `pow`, `asin`, `acos`, `atan`, `mod`
- Each with color, description, and line/column position
- Displayed as Monaco editor decorations

### 8d. Gutter Heat Annotations
- Per-line instruction counts displayed in editor line number gutter
- Uses `$8()` / `_j()` / `Cj()` to count `_ic++` per line
- Visual: replaces line numbers with instruction count when heatmap is active

### 8e. Codicon Font
- Monaco editor icon font (`codicon-BuT2v_Yt.ttf`) now bundled separately

---

## 9. State Management Summary (Editor Component)

### Inspector-Related State (L2521)

| State Variable | Setter | Default | Purpose |
|---------------|--------|---------|---------|
| `jt` | `Sn` | `"tuner"` | Active inspector sub-mode |
| `fr` | `fn` | `{nan:true, inf:true, oor:true}` | Error check types enabled |
| `ei` | `hr` | — | Error overlay target |
| `Xr` | — | — | Inspector mapping config |

### Heatmap State (L2522)

| State Variable | Default | Purpose |
|---------------|---------|---------|
| heatmapMode | `false` | Heatmap enabled |
| heatmapChunkSize | `32` | Chunk size (px) for downsampling |
| heatmapSmoothing | `0.3` | Temporal smoothing factor (was 0.7 in 0.6.2) |
| heatmapColorScheme | `"thermal"` | Color scheme |
| heatmapSimdChunk | `0` | SIMD GPU downsampling grid (0 = 64×64 default) |
| heatmapOverlayOpacity | `0.6` | Overlay opacity |

### Frame Timing (L2522)

| Variable | Purpose |
|----------|---------|
| frameTimeMs / `Ts` | CPU frame time (ms) |
| gpuTimeMs / `ks` | GPU frame time (ms) |
| frameTimeMsRef / `sn` | Ref for frame time (shared with graph) |
| gpuTimeMsRef / `jt` | Ref for GPU time |

Total hooks in Editor: **163 useState, 78 useRef, 17 useCallback, 47 useEffect, 14 useMemo**

---

## 10. CSS Architecture

CSS grew from 33 KB (0.6.2) to **185 KB** (0.7.1), reflecting new features and page-level styles.

Feature-related CSS extractions:

| Category | Rules | Ref |
|----------|-------|-----|
| Inspector panel | ~50 | `071_inspector_css.txt` |
| Error/diagnostic | ~30 | `071_error_css.txt` |
| Frame time | ~10 | `071_frame_css.txt` |
| All features combined | ~180 | `071_feature_css_all.txt` |

Key CSS class patterns:
- `.inspector-*` — inspector panel, controls, tabs, curve canvas
- `.inspector-heatmap-*` — heatmap toolbar, spectrum, overlay
- `.inspector-error-*` — error pills, counts, indicators
- `.frame-time-*` — frame time graph, zoom controls
- `.shader-viewport-*` — compare divider, heatmap overlay

---

## 11. Key Differences from v0.6.2

| Aspect | v0.6.2 | v0.7.1 |
|--------|--------|--------|
| **Bundle strategy** | 2 chunks (main 294K + editor 760K) | Single bundle (1134K) |
| **CSS size** | 33 KB | 185 KB |
| **Lazy chunks** | 5 pages | 12 pages + codicon font |
| **Heatmap approach** | Per-tile `gl.finish()` timing | **Instruction counter** (`_ic++`) |
| **Heatmap output** | GPU execution time per tile | Shader complexity per pixel |
| **Heatmap smoothing** | Fixed α=0.7 | Frame-rate-independent `1-exp(-9.75×dt)` |
| **Heatmap default smoothing** | 0.7 | 0.3 |
| **Line heat annotations** | Not present | Per-line `_ic` counts in editor gutter |
| **Suggestions/QuickFix** | Not present | Shader fix suggestions with diff preview |
| **Video recording** | Not present | MediaRecorder + MP4/WebM export |
| **Shader warnings** | Basic | 9 categories (division, sqrt, log, pow, etc.) |
| **NaN probe helpers** | Implicit | Explicit `_npR()` overloaded GLSL functions |
| **Cross-chunk imports** | `n→so`, `v→Id` | Same scope (no boundary) |
| **Editor hooks** | 152 useState, 67 useRef | 163 useState, 78 useRef |
| **BuiltInTextures** | Separate chunk (32K) | Inlined into main bundle |
| **LinkifiedText** | Separate chunk (3K) | Inlined into main bundle |

---

## 12. Files Reference

All extracted code snippets are in `inspector(0.7.1)/` (113 files).

### Key Snippet Files

| File | Content |
|------|---------|
| `071_render_func_Kg.txt` | Main shader render function |
| `071_diagnostic_overlay_render.txt` | Diagnostic-aware render with `dl()` |
| `071_render_func_bM.txt` | Heatmap overlay render |
| `071_render_func_wM.txt` | SIMD downsample shader |
| `071_render_func_M3.txt` | Simple downsample |
| `071_render_func__M.txt` | GPU timer query start |
| `071_render_func_EM.txt` | GPU timer query end |
| `071_render_func_SM.txt` | GPU timer query read |
| `071_shader_compile_Xd.txt` | Shader compilation with LRU cache |
| `071_XC_shader_builder.txt` | Shader source builder |
| `071_inspmap_full_pipeline.txt` | Complete inspector rewriting pipeline |
| `071_mapping_config.txt` | Mapping config and helpers |
| `071_heatmap_rewriting_full.txt` | Heatmap instrumentation (L1988–2000) |
| `071_heatmap_shader_xM_full.txt` | Heatmap overlay GLSL (thermal ramp) |
| `071_heatmap_shader_yM_full.txt` | SIMD downsample GLSL |
| `071_heatmap_mode_render.txt` | Heatmap render section in viewport |
| `071_nan_inf_oor_full.txt` | NaN/Inf/OOR pixel scanning loop |
| `071_ShaderViewport.txt` | Jj/eA component (46 KB) |
| `071_Editor_UI.txt` | Editor UI JSX (110 KB) |
| `071_Editor_state.txt` | Editor state declarations |
| `071_FrameTimeGraph_Q8.txt` | Q8 component |
| `071_submode_definitions.txt` | SubMode icons and definitions |
| `071_feature_css_all.txt` | All feature-related CSS rules |
| `071_suggestion_quickfix.txt` | Suggestion/QuickFix UI |
| `071_recording_section.txt` | Video recording feature |
| `071_shader_warnings_full.txt` | Shader analysis warnings |
