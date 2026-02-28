# FragCoord → Shader-Toy VSCode Extension — Transplant Plan (v0.7.1)

> **Target**: [stevensona/shader-toy](https://github.com/stevensona/shader-toy) VSCode Extension  
> **Source Analysis**: FragCoord.xyz v0.7.1 — see companion reports  
> **Platform**: VSCode Extension API + Electron/Chrome WebView  
> **Previous plan**: see `fragcoord-transplant-plan(0.6.2).md`

---

## 0. Executive Summary

This plan describes how to implement four features from FragCoord.xyz v0.7.1 into the shader-toy VSCode extension:

1. **Inspect** — Variable inspector with value mapping, compare mode, and histogram
2. **Frames** — CPU/GPU frame time graph with ref-based push, zoom, and dual themes
3. **Errors** — NaN/Inf/OOR detection + compile errors + **shader analysis warnings** (NEW)
4. **Heatmap** — **Instruction-count-based** complexity visualization + per-line gutter annotations (NEW approach)

### Key Changes from v0.6.2 Plan

| Aspect | v0.6.2 Plan | v0.7.1 Plan |
|--------|-------------|-------------|
| **Heatmap approach** | Tile-based GPU timing (`gl.finish()` per tile) | Instruction counter (`_ic++` per statement) |
| **Heatmap resolution** | Grid of tiles | Full pixel resolution |
| **Shader analysis** | Not included | 9 warning categories (division, sqrt, pow, etc.) |
| **Per-line counts** | Not included | Gutter annotations with instruction counts |
| **Frame graph** | Basic canvas graph | Ref-based push, zoom, ms/fps toggle, dark+light themes |
| **NaN probe helpers** | Implicit | Explicit `_npR()` GLSL overloads |
| **Bundle structure** | Split chunks → cross-chunk imports | Single merged bundle → simpler porting |

---

## 1. Architecture Mapping

### FragCoord v0.7.1 → Shader-Toy Translation

| FragCoord v0.7.1 Layer | Shader-Toy Equivalent |
|------------------------|----------------------|
| React SPA in browser | VSCode WebView panel (HTML/JS) |
| React state (163 useState, 78 useRef) | WebView message passing + local state |
| Monaco editor (in-browser, with gutter heat annotations) | VSCode's native editor + decorations API |
| Editor component (L2521–2548) | Extension Host controller |
| `Jj`/`eA` ShaderViewport (L2058) | WebView's WebGL canvas renderer |
| `Q8` FrameTimeGraph (L2056) | WebView canvas component |
| CodeEditor (L1988) | VSCode editor decorations API |
| Supabase backend | N/A (local only) |

### Communication Model

```
┌─────────────────────┐         ┌──────────────────────────┐
│   Extension Host    │ ◄─────► │        WebView           │
│                     │ postMsg │                           │
│ • Editor API        │ ───────►│ • WebGL Canvas            │
│ • Diagnostics       │         │ • Inspector UI            │
│ • Gutter decorations│ ◄───────│ • Frame graph (Q8 port)   │
│ • Status bar        │ postMsg │ • Heatmap overlay         │
│ • Commands/Settings │         │ • Error indicators        │
│ • Shader warnings   │         │ • Shader analysis results │
└─────────────────────┘         └──────────────────────────┘
```

### Message Protocol

```typescript
// Extension Host → WebView
interface ToWebView {
  type: 'updateShader' | 'setInspectorVariable' | 'setInspectorMode' | 
        'setMapping' | 'setErrorChecks' | 'setHeatmapMode' | 'setCompareMode' |
        'setHeatmapColorScheme' | 'setHeatmapOpacity';
  payload: any;
}

// WebView → Extension Host
interface FromWebView {
  type: 'compileErrors' | 'nanDetected' | 'frameTime' | 'heatmapData' |
        'histogramData' | 'inspectorReady' | 'requestVariable' |
        'shaderWarnings' | 'heatmapLineCounts';
  payload: any;
}
```

---

## 2. Feature 1: Inspect (Variable Inspector)

### Reference Report
- `fragcoord-inspect(0.7.1)-REPORT.md`

### 2.1 Extension Host Side

#### Variable Selection

```typescript
vscode.window.onDidChangeTextEditorSelection((event) => {
  if (!isInspectorMode) return;
  const editor = event.textEditor;
  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);
  
  if (isValidGLSLExpression(selectedText)) {
    webviewPanel.webview.postMessage({
      type: 'setInspectorVariable',
      payload: { variable: selectedText, line: selection.start.line + 1 }
    });
  }
});
```

#### Commands to Register

```typescript
'shader-toy.inspector.toggle'          // Toggle inspect mode
'shader-toy.inspector.setMapping'      // Switch linear/sigmoid/log
'shader-toy.inspector.toggleCompare'   // Toggle compare mode
'shader-toy.inspector.setRange'        // Set min/max range
'shader-toy.inspector.highlightOOR'    // Toggle out-of-range highlighting
```

### 2.2 WebView Side

#### Shader Rewriting (`Bj`/`Oj` equivalent)

Port the shader rewriting engine from FragCoord v0.7.1:

```typescript
// Two entry points (v0.7.1 split):
function rewriteShaderForInspector(
  source: string, variable: string, mapping: MappingConfig, line: number
): string | null {
  // Port Bj() → vb() → generates _inspMap() + inserts mapping
}

function rewriteShaderForCompare(
  source: string, variable: string, line: number
): string | null {
  // Port Oj() → gb() → raw output, no _inspMap
}
```

**Functions to port** (from `inspector(0.7.1)/`):
- `Bj()`/`Oj()` — main entry points → `071_inspmap_full_pipeline.txt`
- `Fj()` — `_inspMap()` GLSL generator → `071_mapping_helpers.txt`
- `K1()` — type-to-vec4 wrapping → `071_mapping_helpers.txt`
- `H8()` — find main() boundaries → `071_inspmap_full_pipeline.txt`
- `K8()` — for-loop scoping fix → `071_inspmap_full_pipeline.txt`
- `Y1()` — fragColor→_inspFC replacement → `071_inspmap_full_pipeline.txt`
- `Y8()` — ShaderToy builtin normalization → `071_iResolution_rewrite.txt`
- `a2()` — type inference → `071_inspmap_full_pipeline.txt`

**NEW in v0.7.1 to port**:
- `Dj()` — `#define` macro parsing
- `s4()` — macro value resolution
- `mb()` — enhanced expression analysis
- `ep()` — function signature parser for function call inspection

#### Compare Mode (Scissor Split)

Same as v0.6.2 plan — scissor test splits viewport:

```typescript
function renderWithCompare(gl: WebGL2RenderingContext, 
                           originalSource: string, 
                           inspectorSource: string,
                           split: number) {
  const splitX = Math.floor(gl.canvas.width * split);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(0, 0, splitX, gl.canvas.height);
  renderShader(gl, originalSource);
  gl.scissor(splitX, 0, gl.canvas.width - splitX, gl.canvas.height);
  renderShader(gl, inspectorSource);
  gl.disable(gl.SCISSOR_TEST);
}
```

### 2.3 Implementation Order

1. **Phase 1**: Shader rewriting engine (`Bj`/`Oj` + `Fj` + helpers) — pure JS, testable standalone
2. **Phase 2**: Type inference system (`a2` + `K1`) — requires GLSL keyword/builtin tables
3. **Phase 3**: WebGL render with inspector shader — modify existing render loop
4. **Phase 4**: Extension host ↔ WebView variable selection messaging
5. **Phase 5**: Mapping mode UI (linear/sigmoid/log) + OOR highlighting
6. **Phase 6**: Compare mode with scissor test + draggable divider
7. **Phase 7**: Histogram computation (optional)

---

## 3. Feature 2: Frames (Frame Time Graph)

### Reference Report
- `fragcoord-frames(0.7.1)-REPORT.md`

### 3.1 Extension Host Side

```typescript
'shader-toy.frames.toggle'     // Toggle frame time graph visibility
'shader-toy.frames.setUnit'    // Toggle ms/fps display
```

### 3.2 WebView Side

#### Ring Buffer (Port `l2` class)

```typescript
class RingBuffer {
  private buf: Float64Array;
  private head = 0;
  private _size = 0;
  
  constructor(private capacity: number) {
    this.buf = new Float64Array(capacity);
  }
  
  push(value: number) {
    this.buf[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this._size < this.capacity) this._size++;
  }
  
  at(index: number): number { /* circular access */ }
  last(): number { /* most recent value */ }
  get size(): number { return this._size; }
}
```

**Capacity**: 2000 samples (v0.7.1 upgrade from 1000 in v0.6.2)

#### GPU Timer Queries

```typescript
interface GpuTimer {
  ext: any;
  query: WebGLQuery | null;
  pending: boolean;
  lastGpuTimeMs: number;
}

function initGpuTimer(gl: WebGL2RenderingContext): GpuTimer | null {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  return ext ? { ext, query: null, pending: false, lastGpuTimeMs: 0 } : null;
}

function beginGpuTimer(gl: WebGL2RenderingContext, timer: GpuTimer) {
  if (timer.pending) return;
  const query = gl.createQuery();
  if (query) { timer.query = query; gl.beginQuery(timer.ext.TIME_ELAPSED_EXT, query); }
}

function endGpuTimer(gl: WebGL2RenderingContext, timer: GpuTimer) {
  if (!timer.query || timer.pending) return;
  gl.endQuery(timer.ext.TIME_ELAPSED_EXT);
  timer.pending = true;
}

function pollGpuTimer(gl: WebGL2RenderingContext, timer: GpuTimer): number {
  if (!timer.query || !timer.pending) return timer.lastGpuTimeMs;
  if (gl.getParameter(timer.ext.GPU_DISJOINT_EXT)) {
    gl.deleteQuery(timer.query); timer.query = null; timer.pending = false;
    return timer.lastGpuTimeMs;
  }
  if (!gl.getQueryParameter(timer.query, gl.QUERY_RESULT_AVAILABLE))
    return timer.lastGpuTimeMs;
  const ns = gl.getQueryParameter(timer.query, gl.QUERY_RESULT);
  gl.deleteQuery(timer.query); timer.query = null; timer.pending = false;
  timer.lastGpuTimeMs = ns / 1e6;
  return timer.lastGpuTimeMs;
}
```

#### Graph Rendering (Port `Q8`)

```typescript
class FrameTimeGraph {
  private canvas: HTMLCanvasElement;
  private cpuBuf = new RingBuffer(2000);
  private gpuBuf = new RingBuffer(2000);
  private realDtBuf = new RingBuffer(2000);
  private paused = false;
  private visibleFrames = 200;
  private unit: 'ms' | 'fps' = 'ms';
  private theme: 'dark' | 'light' = 'dark';
  
  push(cpuMs: number, gpuMs: number, dtMs: number) {
    if (this.paused) return;
    this.cpuBuf.push(cpuMs);
    if (dtMs >= 2 && dtMs <= 500) this.realDtBuf.push(dtMs);
    if (gpuMs > 0) this.gpuBuf.push(gpuMs);
    this.draw();
  }
  
  private draw() {
    // Port Q8's canvas rendering:
    // 1. Background rounded rect
    // 2. Reference lines (60fps/30fps or frameCap)
    // 3. GPU bars (blue, semi-transparent)
    // 4. Stutter highlights (red)
    // 5. EMA line (smoothed, alpha=0.15)
    // 6. Frame time polyline (green/yellow/red per segment)
    // 7. Header: FPS + current ms + GPU ms
    // 8. Footer: avg/min/max/P99/stutter count
  }
}
```

**Key v0.7.1 features to include**:
- Dual themes (dark + light, 22 color tokens each)
- Scroll-to-zoom (20–2000 frame window)
- ms/fps toggle
- DPR cap at 3 (was 2 in v0.6.2)
- Ref-based push for zero-rerender data updates

### 3.3 Implementation Order

1. **Phase 1**: RingBuffer + CPU timing around existing render loop
2. **Phase 2**: Canvas-based graph (port Q8 drawing logic)
3. **Phase 3**: GPU timer queries (begin/end/poll around render)
4. **Phase 4**: Theme support (dark/light)
5. **Phase 5**: Zoom controls + ms/fps toggle (optional)

---

## 4. Feature 3: Errors (NaN/Inf/OOR + Analysis)

### Reference Report
- `fragcoord-errors(0.7.1)-REPORT.md`

### 4.1 Extension Host Side

#### Compile Error Integration

Use VSCode's **Diagnostics API** for compile errors:

```typescript
const diagnosticCollection = vscode.languages.createDiagnosticCollection('shader-toy');

webviewPanel.webview.onDidReceiveMessage((message) => {
  if (message.type === 'compileErrors') {
    const diagnostics = message.payload.errors.map(err => {
      const range = new vscode.Range(err.line - 1, 0, err.line - 1, 999);
      return new vscode.Diagnostic(range, err.message, vscode.DiagnosticSeverity.Error);
    });
    diagnosticCollection.set(document.uri, diagnostics);
  }
});
```

#### Shader Analysis Warnings (NEW in v0.7.1)

```typescript
webviewPanel.webview.onDidReceiveMessage((message) => {
  if (message.type === 'shaderWarnings') {
    const diagnostics = message.payload.warnings.map(w => {
      const range = new vscode.Range(w.line - 1, w.column, w.line - 1, w.column + w.length);
      const diag = new vscode.Diagnostic(range, w.reason, vscode.DiagnosticSeverity.Warning);
      diag.source = `shader-analysis (${w.kind})`;
      return diag;
    });
    // Merge with compile errors
    const existing = diagnosticCollection.get(document.uri) || [];
    diagnosticCollection.set(document.uri, [...existing, ...diagnostics]);
  }
});
```

#### Runtime Error Status Bar

```typescript
const nanStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);

if (message.type === 'nanDetected') {
  const { hasNan, hasInf, hasOor, nanPixels, infPixels, oorPixels } = message.payload;
  if (hasNan || hasInf || hasOor) {
    const parts = [];
    if (hasNan) parts.push(`NaN:${nanPixels}`);
    if (hasInf) parts.push(`Inf:${infPixels}`);
    if (hasOor) parts.push(`OOR:${oorPixels}`);
    nanStatusBarItem.text = `$(warning) ${parts.join(' ')}`;
    nanStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    nanStatusBarItem.show();
  } else {
    nanStatusBarItem.hide();
  }
}
```

### 4.2 WebView Side

#### Float FBO Setup

```typescript
function createFloatFBO(gl: WebGL2RenderingContext, w: number, h: number) {
  const ext = gl.getExtension('EXT_color_buffer_float');
  if (!ext) return null;
  
  const fbo = gl.createFramebuffer();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { fbo, texture: tex };
}
```

#### Pixel Scanning (every 60 frames at 32×32)

```typescript
const NAN_PROBE_SIZE = 32;   // Zu
const NAN_PROBE_INTERVAL = 60; // Kj

function detectPixelErrors(gl: WebGL2RenderingContext, fbo: any): ErrorProbe {
  const pixels = readbackPixels(gl, fbo);  // Float32Array
  let nanCount = 0, infCount = 0, oorCount = 0;
  
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i+1], b = pixels[i+2];
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) nanCount++;
    else if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) infCount++;
    else if (r < -0.002 || g < -0.002 || b < -0.002 ||
             r > 1.002 || g > 1.002 || b > 1.002) oorCount++;
  }
  
  return { hasNan: nanCount > 0, hasInf: infCount > 0, hasOor: oorCount > 0,
           nanPixels: nanCount, infPixels: infCount, oorPixels: oorCount };
}
```

#### Shader Analysis Warnings (NEW — Port `Mj`)

```typescript
interface ShaderWarning {
  kind: 'division' | 'sqrt' | 'inversesqrt' | 'log' | 'pow' | 'asin' | 'acos' | 'atan' | 'mod';
  line: number;
  column: number;
  length: number;
  reason: string;
}

function analyzeShader(source: string): ShaderWarning[] {
  const cleaned = stripComments(source);
  const warnings: ShaderWarning[] = [];
  
  // Division: find / operators, check if denominator is constant non-zero
  // Function calls: match sqrt|inversesqrt|log|log2|pow|asin|acos|atan|mod
  // Report with line/column for each potentially dangerous operation
  
  return warnings.sort((a, b) => a.line - b.line || a.column - b.column);
}
```

### 4.3 Implementation Order

1. **Phase 1**: Compile error parsing → VSCode Diagnostics API
2. **Phase 2**: Float FBO + NaN/Inf/OOR scanning (every 60 frames at 32×32)
3. **Phase 3**: Status bar error indicators
4. **Phase 4**: Shader analysis warnings → VSCode Diagnostics as Warnings (NEW)
5. **Phase 5**: NaN probe helpers (`_npR` overloads) for per-expression probing (optional)

---

## 5. Feature 4: Heatmap (Instruction-Count Profiling)

### Reference Report
- `fragcoord-heatmap(0.7.1)-REPORT.md`

### ⚠️ ARCHITECTURE CHANGE: Instruction Counting

**v0.6.2 plan** used tile-based `gl.finish()` timing. **v0.7.1** uses instruction counting — a fundamentally different and superior approach for WebView environments:

| Advantage | Why it matters for VSCode WebView |
|-----------|----------------------------------|
| No `gl.finish()` stalls | Eliminates the biggest performance issue |
| Full pixel resolution | No tile artifacts |
| Deterministic results | Same shader → same heatmap (not GPU-load dependent) |
| Per-line attribution | Can show counts in VSCode gutter decorations |
| Works on all GPUs | No timer query extension dependency |

### 5.1 Extension Host Side

```typescript
'shader-toy.heatmap.toggle'           // Toggle heatmap mode
'shader-toy.heatmap.colorScheme'      // thermal/grayscale
'shader-toy.heatmap.opacity'          // Overlay opacity
```

#### Per-Line Gutter Decorations (NEW)

```typescript
webviewPanel.webview.onDidReceiveMessage((message) => {
  if (message.type === 'heatmapLineCounts') {
    const counts: number[] = message.payload.counts;  // per-line _ic counts
    const maxCount = Math.max(...counts.filter(c => c > 0));
    
    const decorations = counts.map((count, lineIdx) => {
      if (count <= 0) return null;
      const intensity = count / maxCount;
      const color = thermalColor(intensity);
      return {
        range: new vscode.Range(lineIdx, 0, lineIdx, 0),
        renderOptions: {
          before: {
            contentText: String(count).padStart(String(maxCount).length),
            color: color,
            fontWeight: intensity > 0.7 ? 'bold' : 'normal',
            margin: '0 8px 0 0'
          }
        }
      };
    }).filter(Boolean);
    
    editor.setDecorations(heatmapDecorationType, decorations);
  }
});
```

### 5.2 WebView Side

#### Shader Instrumentation (Port `Oh`/`_0`/`Ej`/`Sj`)

```typescript
function instrumentShaderForHeatmap(source: string): string | null {
  // Port wj() — detect main()/mainImage() format
  const hasMain = /\bvoid\s+main\s*\(\s*\)\s*\{/.test(source);
  const hasMainImage = /\bvoid\s+mainImage\s*\(/.test(source);
  
  if (hasMain) return instrumentStandardShader(source);
  if (hasMainImage) return instrumentShaderToyShader(source);
  return null;
}

function instrumentStandardShader(source: string): string {
  // Port Ej():
  // 1. Find main() body boundaries
  // 2. Instrument all user functions with _0()
  // 3. Instrument main body: Oh() + z8() + W8()
  // 4. Add: int _ic = 0; before main
  // 5. Add: _ic = 0; at start of main
  // 6. Add: fragColor = vec4(float(_ic), 0.0, 0.0, 1.0); at end
  return instrumented;
}

function instrumentBody(body: string): string {
  // Port Oh(): insert _ic++ after every statement
  // - Track: braces, parens, strings, comments, preprocessor
  // - Skip: for(;;) headers, comments, strings, preprocessor lines
  // - Count: every ; at statement level, every { after flow control
}

function fixForLoops(body: string): string {
  // Port z8(): wrap bare for() statements in braces
}

function stripDeadCode(body: string): string {
  // Port W8(): remove code after unconditional return/discard
}
```

**Functions to port** (from `inspector(0.7.1)/`):
- `Oh()` — core instrumentation → `071_heatmap_instrument_fn.txt`
- `_0()` — cross-function instrumentation → `071_heatmap_instrument_fn.txt`
- `z8()` — for-loop normalization → `071_heatmap_for_loop.txt`
- `W8()` — dead code removal → `071_heatmap_rewriting_full.txt`
- `V8()` — `int _ic = 0;` preamble → `071_heatmap_rewriting_full.txt`
- `Ej()` — standard format → `071_heatmap_rewrite_Ej.txt`
- `Sj()` — ShaderToy format → `071_heatmap_rewrite_Sj.txt`

#### Per-Line Count Computation (Port `$8`/`_j`/`Cj`)

```typescript
function computePerLineCounts(source: string): number[] | null {
  // Port $8() → _j()/_Cj():
  // 1. Instrument source (same as above but track per-line)
  // 2. Count _ic++ per line via regex
  // 3. Return array indexed by line number
}

function countIcPerLine(instrumented: string): number[] {
  // Port Bv(): count /_ic\+\+/g matches per line
  return instrumented.split(/\r?\n/).map(line => 
    (line.match(/_ic\+\+/g) || []).length
  );
}
```

#### GPU Downsampling + Min/Max Extraction

```typescript
// Path A: SIMD max-pool (when chunk size > 0)
const DOWNSAMPLE_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform vec2 u_sourceSize;
uniform vec2 u_gridSize;
layout(location = 0) out vec4 fragColor;
void main() {
  vec2 gridPos = floor(gl_FragCoord.xy);
  vec2 chunkSize = u_sourceSize / u_gridSize;
  ivec2 srcMin = ivec2(gridPos * chunkSize);
  ivec2 srcMax = ivec2(min(vec2(srcMin) + chunkSize + 1.0, u_sourceSize));
  float maxVal = 0.0;
  for (int y = srcMin.y; y < srcMax.y; y++)
    for (int x = srcMin.x; x < srcMax.x; x++)
      maxVal = max(maxVal, texelFetch(u_source, ivec2(x, y), 0).r);
  fragColor = vec4(maxVal, 0.0, 0.0, 1.0);
}`;

// Path B: Simple 64×64 bilinear downsample (default)
const SIMPLE_DOWNSAMPLE_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform vec2 u_targetSize;
layout(location = 0) out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / u_targetSize;
  fragColor = texture(u_source, uv);
}`;
```

#### Overlay Rendering (Port `bM` + `xM`)

```typescript
const HEATMAP_OVERLAY_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform vec2 u_viewportSize;
uniform float u_minCount;
uniform float u_maxCount;
uniform float u_opacity;
uniform int u_colorScheme;
layout(location = 0) out vec4 fragColor;

vec3 thermalRamp(float t) {
  const vec3 c0 = vec3(0.0, 0.0, 0.0);
  const vec3 c1 = vec3(0.0, 0.0, 0.627);
  const vec3 c2 = vec3(0.784, 0.0, 0.0);
  const vec3 c3 = vec3(1.0, 0.588, 0.0);
  const vec3 c4 = vec3(1.0, 1.0, 0.0);
  const vec3 c5 = vec3(1.0, 1.0, 1.0);
  if (t < 0.2) return mix(c0, c1, t * 5.0);
  else if (t < 0.4) return mix(c1, c2, (t - 0.2) * 5.0);
  else if (t < 0.6) return mix(c2, c3, (t - 0.4) * 5.0);
  else if (t < 0.8) return mix(c3, c4, (t - 0.6) * 5.0);
  else return mix(c4, c5, (t - 0.8) * 5.0);
}

vec3 grayscaleRamp(float t) { return vec3(t); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_viewportSize;
  float raw = texture(u_source, uv).r;
  float range = u_maxCount - u_minCount;
  float t = range > 0.0 ? clamp((raw - u_minCount) / range, 0.0, 1.0) : 0.0;
  vec3 color = u_colorScheme == 1 ? grayscaleRamp(t) : thermalRamp(t);
  fragColor = vec4(color, u_opacity);
}`;
```

#### Temporal Smoothing

```typescript
function smoothMinMax(
  currentMin: number, currentMax: number,
  smoothMin: number, smoothMax: number,
  dt: number, initialized: boolean
): [number, number, boolean] {
  if (!initialized) return [currentMin, currentMax, true];
  
  const alpha = 1 - Math.exp(-9.75 * dt);  // frame-rate independent
  return [
    smoothMin + (currentMin - smoothMin) * alpha,
    smoothMax + (currentMax - smoothMax) * alpha,
    true
  ];
}
```

### 5.3 Render Loop Integration

```
Each frame when heatmap is active:
1. instrumentedSource = instrumentShaderForHeatmap(source)
2. if (instrumentedSource) {
   3. Allocate/reuse float FBO at full resolution
   4. Render instrumented shader to FBO (R channel = _ic count)
   5. GPU downsample: full-res → grid (via max-pool or bilinear)
   6. CPU readback of grid → extract min/max
   7. Apply temporal smoothing to min/max
   8. Render overlay: bM() with thermal/grayscale ramp + alpha blending
   9. Compute per-line counts: $8(source) → send to extension host
}
```

### 5.4 Implementation Order

1. **Phase 1**: Shader instrumentation engine (`Oh` + `z8` + `W8` + `_0`) — pure JS, testable standalone
2. **Phase 2**: Full shader rewriting (`Ej`/`Sj` + `V8`) — builds instrumented shader string
3. **Phase 3**: Float FBO + render instrumented shader + readback min/max
4. **Phase 4**: Overlay shader (`xM`) with thermal ramp + alpha blending
5. **Phase 5**: Temporal smoothing (frame-rate-independent `1-exp(-9.75*dt)`)
6. **Phase 6**: GPU downsample shader (`yM`/`mM`) for efficient min/max
7. **Phase 7**: Per-line counts (`$8`) → VSCode gutter decorations
8. **Phase 8**: Color scheme toggle (thermal/grayscale)

---

## 6. Shared Infrastructure

### 6.1 WebGL2 Requirement

Required by:
- Float FBO for NaN detection and heatmap (`EXT_color_buffer_float`)
- Timer queries for GPU timing (`EXT_disjoint_timer_query_webgl2`)
- `#version 300 es` shaders (overlay, downsample)

```typescript
const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
if (!gl) {
  // Fallback: WebGL1 — no heatmap, no NaN detection
}
```

### 6.2 FBO Manager

```typescript
class FBOManager {
  private cache = new WeakMap<WebGL2RenderingContext, Map<string, FBOEntry>>();
  
  getOrCreate(gl: WebGL2RenderingContext, key: string, w: number, h: number,
              format: number = gl.RGBA32F): { fbo: WebGLFramebuffer, texture: WebGLTexture } | null {
    // Reuse existing if same dimensions, else reallocate
    // Port Ku()/yd() from FragCoord
  }
  
  readback(gl: WebGL2RenderingContext, fbo: FBOEntry): Float32Array {
    // Port Hg() — gl.readPixels with FLOAT format
  }
}
```

### 6.3 Shader Cache

```typescript
class ShaderCache {
  private cache = new Map<string, { program: WebGLProgram, errors: CompileError[] }>();
  private maxSize = 50;
  
  compile(gl: WebGL2RenderingContext, source: string): CompileResult {
    if (this.cache.has(source)) {
      // LRU: delete + re-insert to move to end
      const cached = this.cache.get(source)!;
      this.cache.delete(source);
      this.cache.set(source, cached);
      return cached;
    }
    // Compile, cache, evict oldest if over maxSize
  }
}
```

### 6.4 Shared State

```typescript
interface InspectorState {
  mode: 'off' | 'inspect' | 'frames' | 'errors' | 'heatmap';
  inspectorVariable?: string;
  inspectorLine?: number;
  mapping: { mode: 'linear' | 'sigmoid' | 'log', min: number, max: number, highlightOOR: boolean };
  compareMode: boolean;
  compareSplit: number;
  errorChecks: { nan: boolean, inf: boolean, oor: boolean };
  heatmapColorScheme: 'thermal' | 'grayscale';
  heatmapOpacity: number;
  heatmapChunkSize: number;  // 0 = auto (64×64 simple), >0 = SIMD max-pool
}
```

---

## 7. Recommended Implementation Roadmap

### Priority Order (by value/effort ratio)

| Priority | Feature | Effort | Value | Dependencies |
|----------|---------|--------|-------|--------------|
| **P0** | Compile error diagnostics | Low | High | None |
| **P1** | Shader analysis warnings (NEW) | Low-Med | High | Comment stripper |
| **P2** | Frame timing graph | Medium | High | RingBuffer + Canvas |
| **P3** | NaN/Inf detection | Medium | High | WebGL2 + Float FBO |
| **P4** | Inspect (basic) | Medium | Very High | Shader rewrite engine |
| **P5** | Heatmap (instruction counting) | High | High | Instrumentation engine |
| **P6** | Inspect (compare mode) | Low | Medium | P4 |
| **P7** | Heatmap gutter annotations | Low | Medium | P5 |
| **P8** | Inspect (mapping modes) | Low | Medium | P4 |
| **P9** | Histogram | Medium | Low | P4 |

### Milestone 1: Error Handling (P0 + P1 + P3)
- Compile error parsing → VSCode Diagnostics API
- Shader analysis warnings → VSCode Diagnostics as Warnings
- Float FBO + NaN/Inf/OOR scanning
- Status bar error indicators
- **Estimated scope**: ~600 LOC

### Milestone 2: Performance Visualization (P2)
- RingBuffer + frame timer
- Canvas graph with dual themes
- GPU timer queries (if available)
- **Estimated scope**: ~500 LOC

### Milestone 3: Variable Inspector (P4 + P6 + P8)
- Shader rewriting engine (port Bj/Oj/Fj)
- Type inference + _inspMap generation
- Variable selection via VSCode editor API
- Compare mode + mapping modes
- **Estimated scope**: ~900 LOC

### Milestone 4: Heatmap (P5 + P7)
- Shader instrumentation engine (Oh/_0/Ej/Sj)
- Instruction-count render + GPU downsample + overlay
- Per-line counts → VSCode gutter decorations
- **Estimated scope**: ~800 LOC

---

## 8. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| WebGL2 not available in older Electron | Heatmap + NaN detection break | Graceful fallback, feature flag |
| Timer queries disabled in WebView | No GPU timing in frame graph | CPU-only timing (already the primary metric) |
| Shader instrumentation breaks edge cases | Incorrect heatmap | Extensive test cases for Oh(), especially for/while/switch |
| Float FBO not supported | No heatmap overlay + no NaN detection | Check `EXT_color_buffer_float`, show warning |
| Large shaders slow to instrument | Instrumentation overhead | Cache instrumented source (same shader → same output) |
| Per-line count computation expensive | Gutter updates lag | Debounce, only recompute on source change |
| Complex `#define` macros confuse type inference | Wrong vec4 wrapping in inspect | Fallback to `vec4(expr)` for unknown types |

---

## 9. Testing Strategy

### Unit Tests (no GL required)
- **Shader instrumentation**: `Oh()` with various GLSL inputs (loops, conditionals, comments, preprocessor)
- **For-loop normalization**: `z8()` edge cases (nested, bare, comma expressions)
- **Dead code removal**: `W8()` with return/discard at various scope levels
- **_inspMap generation**: verify GLSL output for each mode (linear/sigmoid/log)
- **Type inference**: `a2()` with builtins, swizzles, user functions, #defines
- **Error parsing**: various `getShaderInfoLog` formats
- **Shader analysis**: division, sqrt, pow warnings with edge cases
- **Per-line counting**: `$8()` with multi-function shaders

### Integration Tests (WebGL required)
- Render loop with inspector shader
- Float FBO creation + readback
- NaN detection with known-bad shader (0.0/0.0, sqrt(-1.0))
- Heatmap: render instrumented shader + verify R-channel values
- GPU downsample: verify max-pool correctness
- Overlay alpha blending visual check
- Compare mode scissor correctness

### Manual Tests
- Variable selection in various GLSL constructs
- Frame graph with fast/slow shaders
- Heatmap on shader with non-uniform complexity (heavy loop vs simple code)
- Per-line gutter counts match expected instrumentation
- Shader analysis warnings appear on correct lines
- NaN probe identifies the correct sub-expression

---

## 10. Migration Notes from v0.6.2 Plan

If you already implemented features based on the v0.6.2 plan:

1. **Inspect** — Minimal changes needed. Update function names, add `#define` macro support
2. **Frames** — Upgrade RingBuffer capacity 1000→2000, add theme support, add ref-based push
3. **Errors** — Add shader analysis warnings (additive, doesn't break existing NaN detection)
4. **Heatmap** — **FULL REWRITE**. Replace tile-based `gl.finish()` timing with instruction counting. This is a fundamentally different approach — do not try to incrementally modify the v0.6.2 implementation
