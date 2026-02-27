# fcPLAN — FragCoord Inspector Transplant into Shader-Toy

> **Scope**: Implement FragCoord.xyz v0.6.2 inspection features as a separate VSCode webview panel  
> **First attack**: Live Value Inspect  
> **Source reports**: `references/fragcoord/fragcoord-inspect(0.6.2)-REPORT.md` + siblings  
> **Architecture reference**: `.github/docs/architecture/shadertoyPanels-overview.md`

---

## 0. Architecture Decision

### What We're Building

A **second webview panel** (the "Inspector Panel") that acts as a control surface for four diagnostic modes — exactly mirroring FragCoord's tabbed sub-mode UI. The **preview webview's canvas** is repurposed to display inspector output (rewritten shader, error overlay, heatmap) when a mode is active.

### Communication Model

```
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│   VSCode Editor  │        │  Extension Host   │        │ Preview Webview  │
│                  │        │ (ShaderToyManager) │        │  (WebGL canvas)  │
│ • Text selection ├──────►│                    ├──────►│                  │
│ • Diagnostics    │  API   │ • Variable bridge  │ postMsg│ • Shader rewrite │
│                  │◄──────┤ • IPC hub          │◄──────┤ • Render modes   │
└──────────────────┘        │                    │        │ • Pixel readback │
                            │                    │        └──────────────────┘
                            │                    │
                            │                    │        ┌──────────────────┐
                            │                    ├──────►│ Inspector Panel  │
                            │                    │ postMsg│  (control UI)    │
                            │                    │◄──────┤ • Tab bar        │
                            └──────────────────┘        │ • Mode controls  │
                                                         │ • Graphs/stats   │
                                                         └──────────────────┘
```

**Hub-and-spoke**: The extension host (`ShaderToyManager`) is the sole message router. The inspector panel and preview webview never communicate directly — all messages route through the host. This matches the proven sequencer panel pattern.

### Where Does Shader Rewriting Happen?

**In the preview webview** (as a new runtime JS module). Rationale:
- The webview already holds the shader source, GL context, and Three.js renderer
- Rewriting + recompiling in-place enables **live, instant** variable inspection without full webview reload
- Matches how FragCoord does it (rewrite is client-side, near the GL context)
- The rewrite engine is authored in TypeScript, webpack-bundled, loaded via `WebviewModuleScriptExtension`

### Key Difference from Sequencer Pattern

The sequencer panel drives **uniform values** via a bridge extension. The inspector panel drives **shader source rewriting** — a deeper intervention. The preview webview needs a new module that can:
1. Intercept the current shader source (from the `<script>` elements)
2. Rewrite it (inject `_inspMap`, replace `fragColor`)
3. Recompile the Three.js material
4. Swap rendering between original and inspector shader
5. Read back pixel data for tooltips, histograms, error detection

---

## Phase 0 — Inspector Panel Scaffold & IPC Backbone

**Goal**: Empty inspector panel appears below preview, talks to extension host. No visual output yet.

### Files to Create

```
src/inspector/
├── inspector_panel_html.ts           // HTML generation (standalone, not via assembler)
├── inspector_types.ts                // Shared type definitions (InspectorMode, MappingConfig, etc.)
└── ux/
    └── vscode_ui_placement.ts        // Reuse/adapt from sequencer pattern

resources/webview/
├── inspector_init.js                 // Runs in PREVIEW webview: toggle button handler
└── inspector_panel.js                // Runs in INSPECTOR PANEL: tab UI, controls, graphs

src/extensions/user_interface/
├── inspector_button_extension.ts     // Toggle button element in preview
└── inspector_button_style_extension.ts  // Button CSS in preview
```

### Files to Modify

| File | Change |
|------|--------|
| `shadertoymanager.ts` | Add `InspectorWebview` type, `createInspectorWebview()`, toggle handler, lifecycle hooks |
| `webviewcontentprovider.ts` | Import + wire button/style/init extensions |
| `webview_base.html` | Add `<!-- Inspector Button Style -->`, `<!-- Inspector Button Element -->`, `<!-- Webview inspector_init.js -->` placeholders |

### IPC Message Protocol (Phase 0)

```typescript
// Extension Host → Preview Webview
type ToPreview =
  | { command: 'inspectorState', active: boolean }   // toggle highlight

// Preview Webview → Extension Host  
type FromPreview =
  | { command: 'toggleInspectorPanel' }              // button click

// Extension Host → Inspector Panel
type ToPanel =
  | { command: 'syncState', mode: InspectorMode }    // current mode

// Inspector Panel → Extension Host
type FromPanel =
  | { command: 'setMode', mode: InspectorMode }      // tab switch
```

### Deliverable
- Click inspector button in preview → panel opens below
- Panel shows empty tab bar: `[Inspect] [Frames] [Errors] [Heatmap]`
- Clicking tabs sends mode changes through IPC
- Closing preview disposes inspector panel
- Panel is singleton (one per preview)

### Self-contained verification
- Visual: button in preview, panel opens/closes
- IPC: console.log round-trips for each message type
- Lifecycle: close preview → panel closes; reopen → works again

---

## Phase 1 — Variable Selection Bridge

**Goal**: Select a GLSL expression in the editor → extension host validates it → preview webview and inspector panel both receive the variable name.

### Extension Host Logic

```typescript
// In ShaderToyManager (or a new inspector_controller.ts):
vscode.window.onDidChangeTextEditorSelection((event) => {
    if (!this.inspectorActive || !this.inspectorMode === 'inspect') return;
    const editor = event.textEditor;
    const doc = editor.document;
    
    // Only act on shader files (the document being previewed)
    if (!this.isPreviewedDocument(doc)) return;
    
    const selectedText = doc.getText(editor.selection).trim();
    const line = editor.selection.start.line + 1;
    
    if (selectedText.length > 0 && selectedText.length < 200) {
        // Send to both preview webview and inspector panel
        this.previewWebview?.Panel.webview.postMessage({
            command: 'setInspectorVariable',
            variable: selectedText,
            line: line
        });
        this.inspectorWebview?.Panel.webview.postMessage({
            command: 'updateVariable',
            variable: selectedText,
            line: line
        });
    }
});
```

### Inspector Panel UI (Phase 1)

The Inspect tab now shows:
- Selected variable name (or "Select an expression in the editor")
- Line number
- (Mapping controls are Phase 4)

### Preview Webview (Phase 1)

The `inspector_init.js` module receives `setInspectorVariable` and stores the variable name + line. No rendering change yet — that's Phase 3.

### Deliverable
- Select `uv` in editor → inspector panel shows "Inspecting: `uv` (line 5)"
- Select a different expression → updates live
- Clear selection → shows "Select an expression"

---

## Phase 2 — Shader Rewrite Engine

**Goal**: Port the FragCoord shader rewriting engine (`ih()` + helpers) as a TypeScript module that runs in the preview webview. Pure logic — no rendering yet.

### New File

```
src/inspector/shader_rewrite.ts
```

This is webpack-bundled into the preview webview (via `WebviewModuleScriptExtension`). It exposes:

```typescript
// Exposed on window.ShaderToy.inspector.rewrite

interface MainBounds {
    mainDeclStart: number;   // byte offset of 'void main'
    bodyStart: number;       // byte offset of '{' after main
    closeBrace: number;      // byte offset of closing '}'
}

interface MappingConfig {
    mode: 'linear' | 'sigmoid' | 'log';
    min: number;
    max: number;
    highlightOutOfRange: boolean;
}

interface RewriteResult {
    source: string;          // rewritten GLSL source
    success: boolean;
    error?: string;
}

function rewriteShaderForInspector(
    shaderSource: string,
    variable: string,
    outputExpr: string,       // type-coerced expression, e.g. "vec4(uv, 0.0, 1.0)"
    mapping: MappingConfig,
    insertionLine?: number
): RewriteResult | null;
```

### Sub-functions to Port (from `ih()` ecosystem)

| FragCoord fn | Our equivalent | Purpose |
|-------------|---------------|---------|
| `kp()` | `normalizeBuiltins()` | **SKIP** — shader-toy already uses standard names |
| `bp()` | `findMainFunction()` | Find `void main()` declaration, body, close brace |
| `u4()` | `generateInspMap()` | Generate `_inspMap()` GLSL function for the selected mapping mode |
| `yp()` | `findInsertionPoint()` | Find byte offset in main body where variable is last assigned |
| `Cp()` | `handleCompoundStatements()` | Ensure compound statements have braces |
| `Sp()` | `handleForLoopScoping()` | Re-scope for-loop variable declarations |
| `wp()` | `stripFragColorAssignments()` | Comment out remaining `fragColor` / `gl_FragColor` writes |

### Type Inference Helper

FragCoord uses type-hint prefixes (`hN`, `aA`, `ZP`) to coerce arbitrary GLSL types to `vec4`. We simplify:

```typescript
function coerceToVec4(variable: string): string {
    // Heuristics:
    // - If it looks like a float → vec4(v, v, v, 1.0)
    // - If it looks like vec2  → vec4(v, 0.0, 1.0)
    // - If it looks like vec3  → vec4(v, 1.0)
    // - If it looks like vec4  → v
    // Default: vec4(v) — let GLSL implicit conversion handle it
    // Advanced: parse declaration context for type info (deferred)
    return `vec4(${variable})`;
}
```

### Testing Strategy

This is pure string-in → string-out logic, ideal for unit tests:

```typescript
// test/inspector/shader_rewrite.test.ts
describe('findMainFunction', () => {
    it('finds simple void main()', ...);
    it('finds main with preceding functions', ...);
    it('handles comments containing "void main"', ...);
});
describe('rewriteShaderForInspector', () => {
    it('injects _inspMap for simple variable', ...);
    it('handles for-loop scoped variables', ...);
    it('strips subsequent fragColor assignments', ...);
});
```

### Deliverable
- Standalone TypeScript module with full test coverage
- No rendering side effects — purely deterministic string transformation
- Webpack-bundled for webview consumption

---

## Phase 3 — Inspector Rendering (Live Inspect)

**Goal**: When inspector mode is active and a variable is selected, the preview canvas shows the inspector-rewritten shader output instead of the original.

### Preview Webview Module

```
src/inspector/inspector_render.ts   →   bundled into resources/webview/inspector_render.js
```

Exposed on `window.ShaderToy.inspector`:

```typescript
{
    rewrite: { ... },           // Phase 2
    render: {
        setMode(mode: string): void;
        setVariable(variable: string, line: number): void;
        setMapping(config: MappingConfig): void;
        isActive(): boolean;
        getOriginalSource(): string;
        getRewrittenSource(): string | null;
    }
}
```

### Integration with Existing Render Loop

The key intervention point is in the **render loop** (`render()` function in `webview_base.html`). When inspector mode is active:

1. **Before each frame**: check if inspector variable or mapping changed
2. **If changed**: rewrite shader source → recompile Three.js material
3. **Render**: use the rewritten material instead of the original
4. **When deactivated**: restore original material

This requires a new extension that wraps the render loop:

```
src/extensions/inspector_render_extension.ts
```

This extension injects code at the `// Uniforms Update` placeholder (or a new `// Inspector Render` placeholder) that:
- Checks `window.ShaderToy.inspector.render.isActive()`
- Swaps `quad.material` between original and inspector material
- Handles material recompilation when variable/mapping changes

### Material Swapping Strategy

```javascript
// In the render loop injection:
if (window.ShaderToy.inspector.render.isActive()) {
    const rewritten = window.ShaderToy.inspector.render.getRewrittenSource();
    if (rewritten && rewritten !== lastRewrittenSource) {
        // Recompile the inspector material
        inspectorMaterial = new THREE.ShaderMaterial({
            fragmentShader: prepareFragmentShader(rewritten),
            uniforms: { ...buffers[buffers.length - 1].Shader.uniforms }
        });
        lastRewrittenSource = rewritten;
    }
    // Use inspector material for final buffer
    const finalBuffer = buffers[buffers.length - 1];
    const savedMaterial = quad.material;
    quad.material = inspectorMaterial;
    renderer.setRenderTarget(finalBuffer.Target);
    renderer.render(scene, camera);
    quad.material = savedMaterial;  // restore for next frame
} else {
    // Normal render (existing code)
}
```

### End-to-End Flow

```
1. User selects "uv" in editor
2. Extension host → preview: { command: 'setInspectorVariable', variable: 'uv', line: 5 }
3. Preview module: rewriteShaderForInspector(source, 'uv', 'vec4(uv, 0.0, 1.0)', mapping)
4. Rewritten source replaces fragColor with: fragColor = _inspMap(vec4(uv, 0.0, 1.0));
5. Three.js material recompiled with rewritten source
6. Canvas shows UV gradient visualization instead of original shader output
```

### Deliverable
- Select any variable → canvas instantly shows its value as color
- Default mapping: linear, range [0, 1], no OOR highlighting
- Deselect / close inspector → original shader restored
- No visible flicker during swap (material caching)

---

## Phase 4 — Mapping Modes & Controls

**Goal**: Inspector panel provides UI controls for mapping mode (linear/sigmoid/log), min/max range, and OOR highlighting. Changes are live.

### Inspector Panel UI (Inspect Tab)

```html
<div class="inspector-controls">
    <div class="inspector-var-label">Inspecting: <code>uv</code> (line 5)</div>
    
    <div class="inspector-mapping">
        <span class="label">Mapping</span>
        <div class="inspector-mode-buttons">
            <button class="mode-btn active" data-mode="linear">linear</button>
            <button class="mode-btn" data-mode="sigmoid">sigmoid</button>
            <button class="mode-btn" data-mode="log">log</button>
        </div>
    </div>
    
    <div class="inspector-range">
        <label>Min <input type="number" value="0" step="0.1" /></label>
        <label>Max <input type="number" value="1" step="0.1" /></label>
    </div>
    
    <label class="inspector-oor">
        <input type="checkbox" /> Highlight out-of-range
    </label>
</div>
```

### IPC Messages (Phase 4 additions)

```typescript
// Inspector Panel → Extension Host → Preview Webview
{ command: 'setInspectorMapping', mapping: MappingConfig }
```

### `_inspMap()` GLSL Generation

Direct port from FragCoord's `u4()`:

```glsl
// Linear mode (default):
vec4 _inspMap(vec4 v) {
    vec3 t = clamp((v.rgb - MIN) / RANGE, 0.0, 1.0);
    return vec4(t, 1.0);
}

// Sigmoid mode:
vec4 _inspMap(vec4 v) {
    vec3 t = (v.rgb - MIN) / RANGE;
    vec3 s = vec3(1.0) / (vec3(1.0) + exp(-8.0 * (2.0 * t - 1.0)));
    return vec4(s, 1.0);
}

// Log mode:
vec4 _inspMap(vec4 v) {
    vec3 t = clamp((v.rgb - MIN) / RANGE, 0.0, 1.0);
    vec3 o = log2(1.0 + t * 255.0) / 8.0;
    return vec4(o, 1.0);
}
```

With optional OOR highlighting (checkerboard pattern — same as FragCoord):
```glsl
float _ck = mod(floor(gl_FragCoord.x / 4.0) + floor(gl_FragCoord.y / 4.0), 2.0);
if (v.r < MIN || v.g < MIN || v.b < MIN)
    return vec4(_ck, 0.0, _ck, 1.0);   // magenta checkerboard = below
if (v.r > MAX || v.g > MAX || v.b > MAX)
    return vec4(0.0, _ck, _ck, 1.0);   // cyan checkerboard = above
```

### Range Annotation Auto-Detection

Parse shader comments for range hints:
```glsl
float d = sdf(p);  // [-1.0, 2.0]
```

Regex: `/\/\/\s*\[\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\]/`

When detected, auto-populate the min/max fields in the inspector panel.

### Deliverable
- Three mapping mode buttons, switching live
- Min/max range inputs with live update
- OOR checkerboard highlighting toggle
- Range annotation auto-detection from shader comments
- Mapping curve preview canvas in inspector panel (stretch goal)

---

## Phase 5 — Value Tooltip (Pixel Readback)

**Goal**: Hovering over the preview canvas shows the RGBA value of the inspected variable at that pixel position.

### Mechanism

1. Preview webview: on `mousemove` over canvas, read the pixel at cursor position
2. Send pixel data to inspector panel via extension host
3. Inspector panel displays color swatch + RGBA values

### WebGL Pixel Readback

```typescript
// In inspector_render module:
function readPixelAt(gl: WebGLRenderingContext, x: number, y: number): Float32Array {
    const pixel = new Float32Array(4);
    // Read from current framebuffer (or render to a float FBO first)
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, pixel);
    return pixel;
}
```

**Important**: If the render target is `UNSIGNED_BYTE`, readback will be 0–255 integers. For float precision, we need to render the inspector shader to a float FBO first (same infrastructure needed later for NaN detection). Phase 5 can start with `UNSIGNED_BYTE` readback (0–1 range) and upgrade to float later.

### IPC Messages (Phase 5 additions)

```typescript
// Preview → Extension Host → Inspector Panel
{ command: 'pixelValue', rgba: [r, g, b, a], position: { x, y } }
```

### Inspector Panel Tooltip UI

```html
<div class="inspector-value-tooltip">
    <div class="color-swatch" style="background: rgba(R,G,B,A)"></div>
    <div class="color-values">
        <span class="r">R: 0.482</span>
        <span class="g">G: 0.000</span>
        <span class="b">B: 0.918</span>
        <span class="a">A: 1.000</span>
    </div>
</div>
```

### Deliverable
- Hover over canvas → inspector panel shows live RGBA values
- Color swatch matches pixel color
- Values update at throttled rate (~30fps)
- Works with all mapping modes

---

## Phase 6 — Compare Mode (Split View)

**Goal**: Toggle a compare mode that shows original shader on the left half, inspector output on the right half, with a draggable split divider.

### WebGL Scissor Implementation

```typescript
// In the render loop, when compare mode active:
const splitX = Math.floor(canvas.width * compareSplit);

// Left: original shader
gl.enable(gl.SCISSOR_TEST);
gl.scissor(0, 0, splitX, canvas.height);
renderOriginalShader();

// Right: inspector shader
gl.scissor(splitX, 0, canvas.width - splitX, canvas.height);
renderInspectorShader();

gl.disable(gl.SCISSOR_TEST);
```

### UI Elements

- Compare toggle checkbox in inspector panel (Inspect tab)
- Split position slider (0.0 – 1.0, default 0.5)
- Visual: vertical divider line + "Original" / "Inspector" labels overlaid on canvas

### IPC Messages (Phase 6 additions)

```typescript
// Inspector Panel → Extension Host → Preview
{ command: 'setCompareMode', enabled: boolean, split: number }
```

### Deliverable
- Checkbox toggles compare mode
- Left half = original shader, right half = inspector output
- Divider is draggable (or slider in panel)
- Labels show which side is which

---

## Phase 7 — Range Annotations & Type Inference (Polish)

**Goal**: Smarter type coercion and automatic range detection.

### Type Inference

Improve `coerceToVec4()` by parsing the shader AST (lightweight):
1. Find the variable's declaration → extract type (`float`, `vec2`, `vec3`, `vec4`, `mat3`, etc.)
2. Generate appropriate coercion:
   - `float d` → `vec4(d, d, d, 1.0)` (grayscale)
   - `vec2 uv` → `vec4(uv, 0.0, 1.0)`
   - `vec3 col` → `vec4(col, 1.0)`
   - `vec4 c` → `c`
   - `mat3 m` → display first column as vec3
   - `bool b` → `vec4(float(b))`

### Range Annotation

When user selects a variable on a line with `// [min, max]` comment:
- Auto-set mapping range to `[min, max]`
- Show indicator in inspector panel: "Range from annotation"

### Deliverable
- Type-aware coercion (no more broken vec4() casts)
- Range annotations auto-detected and applied
- Both improve UX without new UI elements

---

## Phase 8 — Histogram (Deferred/Optional)

**Goal**: After rendering the inspector shader, compute per-channel histogram and display in the inspector panel.

### Computation (Preview Webview)

1. Render inspector shader to a render target
2. Read back all pixels (`readPixels` with `Float32Array`)
3. Compute 128-bin histogram for each RGBA channel
4. Compute 1-99% quantile for auto-range
5. Send histogram data to inspector panel

### Inspector Panel UI

- Canvas-based histogram chart (128 bars per channel)
- RGBA channel toggles (show/hide individual channels)
- Auto-range button (sets min/max from quantiles)

### Performance Note

Histogram requires full-frame pixel readback — expensive. Only compute when:
- User explicitly requests (button click)
- Inspector panel is visible and Inspect tab is active
- Throttle to max 2Hz

### Deliverable
- Histogram chart in inspector panel
- Channel toggles (RGBA)
- Auto-range from quantile analysis

---

---

# Feature B: Errors

> Separate implementation track, can proceed in parallel with Phase 3+ of Inspect.

## Errors Phase 0 — Compile Error Diagnostics

**Goal**: Parse `getShaderInfoLog()` output → feed into VSCode Diagnostics API for native error squiggles.

This partially exists in shader-toy already (`glsl_error_hook.js`, `DefaultErrorsExtension`, `DiagnosticsErrorsExtension`). Evaluate what's already there before adding:
- The existing error display shows errors as HTML overlays in the webview
- **Enhancement**: also push errors to VSCode's native `DiagnosticCollection` for Problems panel integration
- **Enhancement**: clickable errors that navigate to the correct line in the editor

### Files to Modify
- `shadertoymanager.ts` — create `DiagnosticCollection`, update on compile error messages
- Preview webview — send structured error data via `postMessage` (may already happen)

### Deliverable
- Compile errors appear as red squiggles in the editor
- Errors listed in VSCode Problems panel
- Clicking error in Problems panel navigates to the line

## Errors Phase 1 — NaN/Inf/OOR Runtime Detection

**Goal**: Render to float FBO → read back pixels → detect NaN/Infinity/out-of-range → show in inspector panel.

### Prerequisites
- WebGL2 with `EXT_color_buffer_float` extension
- Float FBO infrastructure (shared with histogram in Phase 8)

### Implementation
- New webview module: `inspector_diagnostics.ts`
- Renders current shader to a `RGBA32F` FBO
- Scans `Float32Array` for `Number.isNaN()`, `!Number.isFinite()`, OOR `[-0.002, 1.002]`
- Reports counts to inspector panel via IPC

### Inspector Panel (Errors Tab)
- NaN / Inf / OOR toggle checkboxes with count badges
- Red/green status dots per check type
- Error badge on Errors tab when issues detected (even when on another tab)

### Deliverable
- Errors tab shows NaN/Inf/OOR counts per frame
- Toggle individual checks on/off
- Visual badge when errors present

---

# Feature C: Frames

> Standalone feature, no dependencies on Inspect.

## Frames Phase 0 — CPU Timing

**Goal**: Measure `performance.now()` around the render loop → report to inspector panel.

### Implementation
- Wrap existing `render()` function with timing
- Send frame time via IPC (throttled, only when Frames tab active)
- Inspector panel receives and displays current frame time + FPS

### Deliverable
- Frames tab shows: "CPU: X.X ms (YY FPS)"

## Frames Phase 1 — Frame Time Graph

**Goal**: Scrolling canvas-based graph showing frame time history.

### Implementation
- Port FragCoord's `_p` (FrameTimeGraph) component as a standalone canvas renderer
- Dual-canvas approach: buffer canvas accumulates, main canvas overlays grid/labels
- Render in the inspector panel webview

### Visual Elements
- CPU time bars (primary color)
- Target line at 16.67ms (60 FPS)
- Grid lines at key thresholds
- Current value label
- FPS readout

### Deliverable
- Live scrolling frame time graph in inspector panel
- Shows last ~300 frames
- 60 FPS target line

## Frames Phase 2 — GPU Timer Queries (Optional)

**Goal**: Use `EXT_disjoint_timer_query_webgl2` for separate GPU timing.

**Note**: Often disabled in WebView contexts. CPU timing alone is valuable; GPU timing is a bonus.

---

# Feature D: Heatmap

> Heaviest feature. Depends on scissor rendering infrastructure (shared with Compare Mode).

## Heatmap Phase 0 — Tile-Based Profiling Engine

**Goal**: Render shader per-tile using scissor test + `gl.finish()`, measure per-tile timing.

### Implementation
- New webview module: `inspector_heatmap.ts`
- Configurable tile size (16/32/64 px, default 32)
- For each tile: `gl.scissor()` → render → `gl.finish()` → measure
- Temporal smoothing (EMA) across frames
- Only runs when Heatmap tab active

### Performance Concern
`gl.finish()` per tile is expensive — profiling itself will be slow. Mitigations:
- Only profile when tab active
- Rate-limit to 1–2 profiles/second
- Start with large tile size (64px)

### Deliverable
- Timing grid computed per frame when Heatmap tab active

## Heatmap Phase 1 — Thermal Overlay

**Goal**: Render a semi-transparent thermal color overlay on the preview canvas.

### Implementation
- 2D canvas overlay positioned on top of WebGL canvas
- Color mapping: thermal gradient (blue → cyan → green → yellow → red → white)
- Normalized per-tile timing → color → fill rectangle

### Inspector Panel (Heatmap Tab)
- Color spectrum bar showing the range
- Min/max timing labels
- Hover: marker on spectrum + exact ms value

### Deliverable
- Thermal overlay on preview canvas
- Spectrum bar in inspector panel
- Hover tooltip

## Heatmap Phase 2 — Configuration Controls

**Goal**: Chunk size toggle, smoothing slider, opacity control.

### Deliverable
- Tile size toggle: 16 / 32 / 64 px
- Smoothing slider: 0% – 100%
- Overlay opacity slider

---

# Implementation Order (Recommended)

The phases can be attacked in this order for maximum early value:

| Step | Phase | Feature | Depends On | Standalone? |
|------|-------|---------|------------|-------------|
| 1 | **Phase 0** | Panel scaffold + IPC | Nothing | ✅ Yes |
| 2 | **Phase 1** | Variable selection bridge | Phase 0 | ✅ Yes |
| 3 | **Phase 2** | Shader rewrite engine | Nothing (pure logic) | ✅ Yes (tests) |
| 4 | **Phase 3** | Inspector rendering | Phase 0 + 1 + 2 | ✅ First visible result |
| 5 | **Phase 4** | Mapping modes & controls | Phase 3 | Incremental |
| 6 | **Phase 5** | Value tooltip | Phase 3 | Incremental |
| 7 | **Errors P0** | Compile error diagnostics | Phase 0 | ✅ Parallel track |
| 8 | **Frames P0+P1** | Frame timing + graph | Phase 0 | ✅ Parallel track |
| 9 | **Phase 6** | Compare mode | Phase 3 | Incremental |
| 10 | **Phase 7** | Type inference + annotations | Phase 3 | Incremental |
| 11 | **Errors P1** | NaN/Inf detection | Phase 0 + float FBO | Parallel |
| 12 | **Heatmap P0+P1** | Profiling + overlay | Phase 0 + scissor infra | Parallel |
| 13 | **Phase 8** | Histogram | Phase 3 + float FBO | Deferred |
| 14 | **Heatmap P2** | Configuration | Heatmap P1 | Incremental |
| 15 | **Frames P2** | GPU timer queries | Frames P1 | Optional |

### Milestones

**M1 — "It works"** (Steps 1–4): Panel scaffold + variable selection + shader rewrite + rendering  
**M2 — "It's useful"** (Steps 5–6): Mapping modes + value tooltip  
**M3 — "Error diagnostics"** (Step 7): Compile errors in VSCode Problems panel  
**M4 — "Performance insight"** (Step 8): Frame time graph  
**M5 — "Full inspector"** (Steps 9–10): Compare mode + smart types  
**M6 — "Runtime errors"** (Step 11): NaN/Inf detection  
**M7 — "Profiling"** (Step 12): Heatmap overlay  
**M8 — "Complete"** (Steps 13–15): Histogram + heatmap config + GPU timing

---

# Conventions & Constraints

### TypeScript
- All new source in TypeScript (no raw JS files except webview bundles)
- Shader rewrite engine: TS source in `src/inspector/`, webpack-bundled for webview
- Inspector panel script: TS source, compiled to JS

### Architecture Alignment
- Follow `WebviewExtension` pattern for preview-side injections
- Follow addon panel pattern (Layer 1–5) from sequencer reference
- Hub-and-spoke IPC through `ShaderToyManager`
- New placeholders in `webview_base.html` for inspector extensions
- Constants in `src/constants.ts` (or `src/inspector/inspector_types.ts`)

### Testing
- Shader rewrite engine: unit tests (pure logic, no GL needed)
- IPC round-trips: integration tests via existing test infrastructure
- Visual verification: manual with test shaders

### Branching
- Work branch: `wip#inspector` (or as directed)
- Each milestone is a reviewable commit or commit group

---

# Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Three.js material recompilation is slow | Inspection feels laggy | Cache compiled materials by rewritten source hash |
| Shader rewrite fails on complex shaders | Inspector shows errors | Graceful fallback to full-shader replacement; show error in panel |
| Float FBO not available | No NaN detection, limited tooltip precision | Feature-gate behind `EXT_color_buffer_float` check |
| `gl.finish()` too slow for heatmap | Janky profiling | Rate-limit, large tile size, only when tab active |
| IPC latency for pixel tooltip | Tooltip feels slow | Throttle to 30fps, debounce mouse moves |
| Variable type inference wrong | Broken `vec4()` cast → compile error | Fallback: try `vec4(v)`, catch compile error, try alternatives |
| Webview module loading order | Inspector module references undefined globals | Use deferred init pattern (set up on first message) |
