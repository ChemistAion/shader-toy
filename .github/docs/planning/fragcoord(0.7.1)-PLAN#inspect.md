# fcPLAN — FragCoord Inspect Transplant into Shader-Toy (v0.7.1)

> **Scope**: Implement FragCoord.xyz v0.7.1 **Inspect** feature as a live variable inspector in the shader-toy VSCode extension  
> **Source reports**: `references/fragcoord/fragcoord-inspect(0.7.1)-REPORT.md` + `fragcoord-overview(0.7.1).md`  
> **Generic transplant reference**: `references/fragcoord/fragcoord-transplant-plan(0.7.1).md`  
> **Previous plan (0.6.2)**: `.github/docs/planning/fragcoord(0.6.2)-PLAN#inspect.md`  
> **Architecture reference**: `.github/docs/architecture/shadertoyPanels-overview.md`  
> **Skill reference**: `.github/skills/shader-toy/SKILL.md`

---

## 0. Architecture Decision

### What We're Building

A **live variable inspector** that allows users to select any GLSL expression or variable in the editor and visualize its per-pixel values on the shader preview canvas. The feature is controlled from an **Inspector Panel** — a second webview panel docked below the preview, following the proven sequencer addon pattern (Layer 1–5 from `shadertoyPanels-overview.md`).

### Scope of This Plan (Inspect Only)

This plan covers **only** the Inspect sub-mode of the FragCoord inspector. Frames, Errors, and Heatmap are separate plans — but Phase 0 (scaffold) establishes the shared infrastructure for all four modes.

### What's New in v0.7.1 vs v0.6.2

| Aspect | v0.6.2 Plan | v0.7.1 Plan |
|--------|-------------|-------------|
| **Rewrite entry points** | Single `ih()` function | Two paths: `Bj()` (mapped) + `Oj()` (compare/raw) |
| **`_inspMap()` generator** | `u4(mapping)` | `Fj(mapping)` — `log` formula corrected to `log2(256)` |
| **Type inference** | Basic declaration lookup | Enhanced: `a2()` with `#define` expansion (`Dj()`/`s4()`), expression analysis (`mb()`/`r4()`), function signature parsing (`ep()`), 100+ GLSL keyword set (`jj`) |
| **For-loop fix** | Two fns `Cp()`/`Sp()` | Unified `K8()` handling comma expressions in `for()` init |
| **Function call inspection** | Implicit | Explicit `ep()` signature parser + `G8()` mock-arg generator |
| **Swizzle resolution** | Not present | `$v()` resolves `.xyz`/`.rg` etc. to correct output type |
| **Range annotation** | `th` regex | `hb` regex + `Pj()` that also checks preceding line |
| **Compare mode** | Planned but skeletal | Full `Oj()` → `gb()` path with scissor split |
| **Histogram** | Deferred | `Hg()` readback + per-channel bins, `Zi=128` buckets |

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
                                                         │ • Mapping UI     │
                                                         │ • Histogram      │
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
1. Intercept the current shader source (from the `<textarea data-shadertoy='shader'>` elements)
2. Rewrite it (inject `_inspMap`, replace `fragColor` with `_inspFC`)
3. Recompile the Three.js material
4. Swap rendering between original and inspector shader
5. Read back pixel data for tooltips, histograms, error detection

### Key Shader-Toy Adaptation Notes

FragCoord's `Y8()` normalizes ShaderToy builtins (`iResolution` → `u_resolution`). In our extension, the preamble extension (`UniformsPreambleExtension`) **already does this**: it injects `#define iResolution u_resolution` etc. Therefore:
- **Skip `Y8()` entirely** — our shaders already use the `u_` prefix after preamble injection
- The rewrite engine operates on the **post-preamble** shader source
- `findMainFunction()` must account for `mainImage()` wrappers auto-generated by the extension

The `mainImage()` → `void main()` wrapper is auto-generated when `void main()` is absent. The inspector must detect both forms:
- Direct `void main()` — standard path
- Auto-wrapped `mainImage()` — the rewrite engine needs to find the user's body inside the auto-generated `main()`, or rewrite at the `mainImage` level

---

## Phase 0 — Inspector Panel Scaffold & IPC Backbone

**Goal**: Empty inspector panel appears below preview, talks to extension host. No visual output yet. This phase establishes shared infrastructure for all four modes (Inspect, Frames, Errors, Heatmap).

### Files to Create

```
src/inspector/
├── inspector_panel_html.ts           // HTML generation (standalone, not via assembler)
├── inspector_types.ts                // Shared type definitions
└── ux/
    └── vscode_ui_placement.ts        // Reuse/adapt from sequencer pattern

resources/webview/
├── inspector_init.js                 // Runs in PREVIEW webview: toggle button handler
└── inspector_panel.js                // Runs in INSPECTOR PANEL: tab UI, controls

src/extensions/user_interface/
├── inspector_button_extension.ts     // Toggle button element in preview
└── inspector_button_style_extension.ts  // Button CSS in preview
```

### Files to Modify

| File | Change |
|------|--------|
| `shadertoymanager.ts` | Add `InspectorWebview` type, `createInspectorWebview()`, toggle handler, lifecycle hooks, IPC message routing |
| `webviewcontentprovider.ts` | Import + wire button/style/init extensions |
| `webview_base.html` | Add `/* Inspector Button Style */`, `<!-- Inspector Button Element -->`, `<!-- Webview inspector_init.js -->` placeholders |

### Shared Type Definitions

```typescript
// src/inspector/inspector_types.ts

export type InspectorMode = 'off' | 'inspect' | 'frames' | 'errors' | 'heatmap';

export interface MappingConfig {
    mode: 'linear' | 'sigmoid' | 'log';
    min: number;
    max: number;
    highlightOutOfRange: boolean;
}

export const DEFAULT_MAPPING: MappingConfig = {
    mode: 'linear', min: 0, max: 1, highlightOutOfRange: false
};

export interface InspectorState {
    mode: InspectorMode;
    inspectorVariable?: string;
    inspectorLine?: number;
    mapping: MappingConfig;
    compareMode: boolean;
    compareSplit: number;        // 0.0–1.0, default 0.5
}

export interface RewriteResult {
    source: string;
    success: boolean;
    error?: string;
}
```

### Panel HTML (Standalone, not via Assembler)

Following the sequencer pattern, the inspector panel gets its own HTML document — not the preview template:

```typescript
// src/inspector/inspector_panel_html.ts
export const getInspectorPanelHtml = (panelScriptSrc: string): string => {
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8" />
<style>/* Inspector panel CSS — see Phase 4 */</style>
</head><body>
<div id="inspector-tabs">
  <button class="tab active" data-mode="inspect">Inspect</button>
  <button class="tab" data-mode="frames">Frames</button>
  <button class="tab" data-mode="errors">Errors</button>
  <button class="tab" data-mode="heatmap">Heatmap</button>
</div>
<div id="inspector-content"></div>
<script src="${panelScriptSrc}"></script>
</body></html>`;
};
```

### IPC Message Protocol (Phase 0)

```typescript
// Extension Host → Preview Webview
type ToPreview =
  | { command: 'inspectorState', active: boolean }     // toggle highlight

// Preview Webview → Extension Host
type FromPreview =
  | { command: 'toggleInspectorPanel' }                // button click

// Extension Host → Inspector Panel
type ToPanel =
  | { command: 'syncState', mode: InspectorMode }      // current mode

// Inspector Panel → Extension Host
type FromPanel =
  | { command: 'setMode', mode: InspectorMode }        // tab switch
```

### Lifecycle Management

Following `InspectorWebview` pattern from sequencer:

```typescript
type InspectorWebview = {
    Panel: vscode.WebviewPanel,
    Parent: vscode.WebviewPanel     // the preview panel this is attached to
};
```

Integration points in `ShaderToyManager`:
1. **Preview creation** — optionally auto-open inspector if was previously open
2. **Preview disposal** — tear down inspector panel
3. **Preview recreation** (resource root change) — re-parent inspector panel
4. **Toggle** — singleton pattern (one inspector per preview)

### UX Placement

Reuse the sequencer's `vscode_ui_placement.ts` pattern:
1. `tryFocusOrCreateBelowGroup()` before `createWebviewPanel()`
2. `tryMovePanelBelowGroup(panel)` as fallback after creation
3. `setTimeout(150)` delay for panel registration

### Deliverable
- Click inspector button (🔬) in preview → panel opens below
- Panel shows tab bar: `[Inspect] [Frames] [Errors] [Heatmap]`
- Clicking tabs sends mode changes through IPC
- Closing preview disposes inspector panel
- Panel is singleton (one per preview)

### Verification
- Visual: button in preview, panel opens/closes
- IPC: console.log round-trips for each message type
- Lifecycle: close preview → panel closes; reopen → works again

---

## Phase 1 — Variable Selection Bridge

**Goal**: Select a GLSL expression in the editor → extension host validates it → preview webview and inspector panel both receive the variable name and line number.

### Extension Host Logic

```typescript
// In ShaderToyManager (or a new src/inspector/inspector_controller.ts):

vscode.window.onDidChangeTextEditorSelection((event) => {
    if (!this.inspectorActive || this.inspectorMode !== 'inspect') return;
    const editor = event.textEditor;
    const doc = editor.document;
    
    // Only act on shader files being previewed
    if (!this.isPreviewedDocument(doc)) return;
    
    // Get word under cursor or explicit selection
    const selection = editor.selection;
    let selectedText: string;
    if (selection.isEmpty) {
        // Word under cursor (double-click or cursor move)
        const wordRange = doc.getWordRangeAtPosition(selection.active, /[a-zA-Z_]\w*(\.[xyzwrgba]+)?/);
        selectedText = wordRange ? doc.getText(wordRange) : '';
    } else {
        selectedText = doc.getText(selection).trim();
    }
    
    const line = selection.start.line + 1;  // 1-based for GLSL
    
    if (selectedText.length > 0 && selectedText.length < 200) {
        this.previewWebview?.Panel.webview.postMessage({
            command: 'setInspectorVariable', variable: selectedText, line: line
        });
        this.inspectorWebview?.Panel.webview.postMessage({
            command: 'updateVariable', variable: selectedText, line: line
        });
    }
});
```

### Word Range Pattern

The regex `/[a-zA-Z_]\w*(\.[xyzwrgba]+)?/` captures:
- Simple variables: `uv`, `color`, `dist`
- Swizzle expressions: `color.rgb`, `pos.xy`, `gl_FragCoord.xyz`
- For complex expressions (e.g. `sin(uv.x * 3.14)`), user must manually select

### Inspector Panel UI (Phase 1)

The Inspect tab now shows:
- Selected variable name (or "Select an expression in the editor")
- Line number
- (Mapping controls are Phase 4)

### Preview Webview (Phase 1)

The `inspector_init.js` module receives `setInspectorVariable` and stores the variable name + line. No rendering change yet — that's Phase 3.

### IPC Messages (Phase 1 additions)

```typescript
// Extension Host → Preview Webview
| { command: 'setInspectorVariable', variable: string, line: number }

// Extension Host → Inspector Panel
| { command: 'updateVariable', variable: string, line: number }
```

### Deliverable
- Select `uv` in editor → inspector panel shows "Inspecting: `uv` (line 5)"
- Select a different expression → updates live
- Clear selection → shows "Select an expression"
- Swizzle expressions captured: `color.rgb`, `pos.xy`

---

## Phase 2 — Shader Rewrite Engine

**Goal**: Port the FragCoord v0.7.1 shader rewriting engine as a TypeScript module that runs in the preview webview. Pure logic — no rendering yet.

### New File

```
src/inspector/shader_rewrite.ts
```

This is webpack-bundled into the preview webview (via `WebviewModuleScriptExtension`). It exposes:

```typescript
// Exposed on window.ShaderToy.inspector.rewrite

interface MainBounds {
    mainDeclStart: number;   // byte offset of 'void main' declaration
    bodyStart: number;       // byte offset of '{' after main
    closeBrace: number;      // byte offset of closing '}'
}

function rewriteForInspector(
    shaderSource: string,
    variable: string,
    mapping: MappingConfig,
    inspectorLine?: number
): RewriteResult | null;

function rewriteForCompare(
    shaderSource: string,
    variable: string,
    inspectorLine?: number
): RewriteResult | null;
```

### Sub-functions to Port (from v0.7.1 `inspector(0.7.1)/071_inspmap_full_pipeline.txt`)

| FragCoord fn | Our equivalent | Purpose | Notes |
|-------------|---------------|---------|-------|
| `Y8()` | **SKIP** | ShaderToy builtin normalization | Our preamble already defines `iResolution` → `u_resolution` etc. |
| `H8()` | `findMainFunction()` | Find `void main()` boundaries — returns `{mainDeclStart, bodyStart, closeBrace}` | Uses brace-counting for nested blocks |
| `K8()` | `fixForLoopScoping()` | Wrap bare `for(...) expr;` into `for(...) { expr; }` | v0.7.1 improved: handles comma expressions in for-init |
| `Y1()` | `replaceFragColor()` | Replace all `fragColor`/`gl_FragColor` with `_inspFC` temp variable | Prevents output interference during inspection |
| `q8()` | `findInsertionPoint()` | Compute character offset up to `inspectorLine` in main body | Critical for "inspect at line N" behavior |
| `Fj()` | `generateInspMap()` | Generate `_inspMap()` GLSL function for selected mapping mode | Three modes: linear, sigmoid, log + OOR checkerboard |
| `K1()` | `coerceToVec4()` | Wrap any GLSL type into `vec4` for visualization | Handles float→vec4, vec2→vec4, mat3→vec4, etc. |
| `a2()` | `inferType()` | Main type resolver — combines all sub-resolvers | **Key v0.7.1 enhancement** |
| `C0()` | `resolveVariableType()` | Check builtins (`Tm`), uniforms (`nh`), declarations, swizzles | Base resolver |
| `$v()` | `resolveSwizzle()` | `.xyz`/`.rg` etc. → output type | New in v0.7.1 |
| `ep()` | `parseFunctionSignature()` | Extract `{returnType, name, params}` from function definition | New explicit path |
| `mb()` | `inferExpressionType()` | Heuristic type inference for complex expressions | Enhanced in v0.7.1 with cross-reference |
| `r4()` | `inferFunctionCallType()` | Type from function call return type | Checks builtins + user-defined |
| `Dj()` | `parseDefines()` | Parse `#define` macros | New in v0.7.1 |
| `s4()` | `resolveDefine()` | Expand macro value | New in v0.7.1 |
| `G8()` | `generateMockArgs()` | Convert function params to mock values for visualization | e.g., `float` → `u_time` |
| `Pj()` | `parseRangeAnnotation()` | Extract `// [min, max]` from comments | Also checks preceding line |
| `pb()` | `mapValue()` | CPU-side mapping for histogram/UI | JS version of `_inspMap` logic |
| `vb()` | `buildInspectorShader()` | Full inspector shader construction with `_inspMap()` | Called by `Bj()` |
| `gb()` | `buildCompareShader()` | Raw output shader (no mapping) for compare mode | Called by `Oj()` |
| `Bj()` | `rewriteForInspector()` | Public API — mapped inspection | Top-level entry point |
| `Oj()` | `rewriteForCompare()` | Public API — raw compare output | Top-level entry point |

### Type Inference Pipeline (v0.7.1 — `a2()` full resolution chain)

```
a2(source, variable)
  ├── 1. Check if it's a user function → ep() → return type
  ├── 2. Check #define macros → s4()/Dj() → resolve + n4() type
  ├── 3. Is it a simple word? → C0()
  │       ├── Check built-in GLSL variables (Tm): gl_FragCoord→vec4, etc.
  │       ├── Check known uniforms (nh): u_resolution→vec2, etc.
  │       ├── Check swizzle: variable.xyz → $v() → resolved type
  │       └── Regex match declaration: `TYPE varName` → TYPE
  └── 4. Is it a complex expression? → r4()
          ├── Function call? → check builtin return types, user ep()
          └── Fallback → mb() heuristic scan
                ├── Type constructor calls: vec3(...) → vec3
                ├── Known function returns: texture()→vec4, cross()→vec3
                ├── Swizzle suffixes in sub-expressions
                ├── Uniform references in expression
                └── Variable declarations in scope
```

### Builtin Tables to Define

```typescript
// GLSL builtin variables → types (from FragCoord's Tm)
const BUILTIN_VARIABLES: Record<string, string> = {
    gl_FragCoord: 'vec4', gl_FragColor: 'vec4', gl_FragDepth: 'float',
    gl_PointCoord: 'vec2', gl_Position: 'vec4', gl_PointSize: 'float',
    gl_VertexID: 'int', gl_InstanceID: 'int', gl_FrontFacing: 'bool',
    fragColor: 'vec4'
};

// shader-toy uniforms → types (from FragCoord's nh, adapted to our naming)
const UNIFORM_TYPES: Record<string, string> = {
    u_resolution: 'vec2', u_time: 'float', u_time_delta: 'float',
    u_frame: 'int', u_mouse: 'vec4', u_drag: 'vec2', u_scroll: 'float',
    u_date: 'vec4', u_refresh_rate: 'float'
    // plus iResolution, iTime, etc. as aliases if not yet normalized
};

// GLSL keywords to skip during variable scanning (from jj — 100+ entries)
const GLSL_KEYWORDS: Set<string> = new Set([
    'true', 'false', 'if', 'else', 'for', 'while', 'switch', 'case',
    'break', 'continue', 'discard', 'return', 'const', 'in', 'out',
    'inout', 'uniform', 'varying', 'attribute', 'flat', 'smooth',
    'float', 'int', 'uint', 'bool', 'vec2', 'vec3', 'vec4',
    'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4',
    'mat2', 'mat3', 'mat4', 'sampler2D', 'samplerCube', 'void', 'struct',
    'radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
    /* ... full list from jj — see 071_mapping_helpers.txt */
]);
```

### `_inspMap()` GLSL Generation (port of `Fj()`)

```glsl
// Linear mode (default):
vec4 _inspMap(vec4 v) {
    // [optional OOR checkerboard]
    vec3 t = clamp((v.rgb - MIN) / RANGE, 0.0, 1.0);
    return vec4(t, 1.0);
}

// Sigmoid mode:
vec4 _inspMap(vec4 v) {
    vec3 t = (v.rgb - MIN) / RANGE;
    vec3 s = vec3(1.0) / (vec3(1.0) + exp(-8.0 * (2.0 * t - 1.0)));
    return vec4(s, 1.0);
}

// Log mode (v0.7.1 corrected formula):
vec4 _inspMap(vec4 v) {
    vec3 t = clamp((v.rgb - MIN) / RANGE, 0.0, 1.0);
    vec3 o = log2(1.0 + t * 255.0) / log2(256.0);
    return vec4(o, 1.0);
}
```

OOR highlighting (when `highlightOutOfRange === true`):
```glsl
bool belowMin = any(lessThan(v.rgb, vec3(MIN)));
bool aboveMax = any(greaterThan(v.rgb, vec3(MAX)));
if (belowMin || aboveMax) {
    float _ck = mod(floor(gl_FragCoord.x / 4.0) + floor(gl_FragCoord.y / 4.0), 2.0);
    if (belowMin) return vec4(_ck, 0.0, _ck, 1.0);   // magenta/black checkerboard
    else          return vec4(0.0, _ck, _ck, 1.0);    // cyan/black checkerboard
}
```

### Rewritten Shader Structure

```glsl
// [preamble: original code before main()]
// [_inspMap() function injected here]

void main() {
    vec4 _inspFC = vec4(0.0);
    /* user code up to inspectorLine, with fragColor → _inspFC */
    fragColor = _inspMap(vec4_wrapped_expr);    // inspector output
    /* remaining code (dead, but needed for GLSL validity) */
}
```

### `mainImage()` Handling

Shader-toy auto-generates a `void main()` wrapper when the user writes `mainImage(out vec4 fragColor, in vec2 fragCoord)` style. The rewrite engine must handle both:

1. **Standard `void main()`** — direct rewrite (normal path)
2. **`mainImage()` with auto-wrapper** — rewrite inside the `mainImage()` body, replacing the `fragColor` out parameter. The auto-generated `main()` wrapper calls `mainImage(fragColor, gl_FragCoord.xy)` which is untouched.

Detection:
```typescript
const hasMainImage = /\bvoid\s+mainImage\s*\(\s*out\s+vec4/.test(source);
const hasMainDirect = /\bvoid\s+main\s*\(\s*\)\s*\{/.test(source);

if (hasMainImage && !hasMainDirect) {
    // Rewrite inside mainImage body
    findMainImageFunction(source);  // variant of findMainFunction
}
```

### Testing Strategy

This is pure string-in → string-out logic, ideal for unit tests:

```typescript
// test/inspector/shader_rewrite.test.ts
describe('findMainFunction', () => {
    it('finds simple void main()');
    it('finds main with preceding functions');
    it('handles comments containing "void main"');
    it('finds mainImage() when main is auto-wrapped');
});
describe('inferType / a2 equivalent', () => {
    it('resolves builtin gl_FragCoord → vec4');
    it('resolves uniform u_time → float');
    it('resolves swizzle color.rgb → vec3');
    it('resolves #define macro');
    it('resolves user function return type');
    it('falls back to expression analysis for complex exprs');
});
describe('coerceToVec4 / K1 equivalent', () => {
    it('wraps float → vec4(v, v, v, 1.0)');
    it('wraps vec2 → vec4(v, 0.0, 1.0)');
    it('wraps mat3 → vec4(m[0], 1.0)');
});
describe('rewriteForInspector', () => {
    it('injects _inspMap for simple variable');
    it('handles for-loop scoped variables');
    it('strips subsequent fragColor assignments');
    it('handles mainImage() format');
    it('respects inspectorLine for partial execution');
    it('handles function call as inspection target');
});
describe('generateInspMap', () => {
    it('generates linear mode GLSL');
    it('generates sigmoid mode GLSL');
    it('generates log mode GLSL');
    it('generates OOR checkerboard when enabled');
});
describe('parseRangeAnnotation', () => {
    it('extracts [min, max] from inline comment');
    it('extracts from preceding line comment');
    it('returns null when no annotation');
});
```

### Deliverable
- Standalone TypeScript module with full test coverage
- No rendering side effects — purely deterministic string transformation
- Webpack-bundled for webview consumption

---

## Phase 3 — Inspector Rendering (Live Inspect)

**Goal**: When inspector mode is active and a variable is selected, the preview canvas shows the inspector-rewritten shader output instead of the original.

### New Files

```
src/inspector/inspector_render.ts    →  bundled into resources/webview/inspector_render.js
src/extensions/inspector_render_extension.ts   →  injects into preview render loop
```

### Preview Webview Module API

Exposed on `window.ShaderToy.inspector`:

```typescript
{
    rewrite: { ... },           // Phase 2
    render: {
        setMode(mode: InspectorMode): void;
        setVariable(variable: string, line: number): void;
        setMapping(config: MappingConfig): void;
        isActive(): boolean;
        getOriginalSource(): string;
        getRewrittenSource(): string | null;
        getRewriteError(): string | null;
    }
}
```

### Integration with Existing Render Loop

The key intervention point is in the **render loop** (`render()` function in `webview_base.html`, around line 404). When inspector mode is active:

1. **Before each frame**: check if inspector variable or mapping changed
2. **If changed**: rewrite shader source → recompile Three.js material
3. **Render**: use the rewritten material for the final buffer instead of the original
4. **When deactivated**: restore original material

This requires a new extension that injects code at a new placeholder:

```
// In webview_base.html, add placeholder before the render target swap:
// Inspector Render
```

### Material Swapping Strategy

```javascript
// In the render loop injection (inspector_render_extension.ts output):
if (window.ShaderToy.inspector.render.isActive()) {
    const rewritten = window.ShaderToy.inspector.render.getRewrittenSource();
    if (rewritten && rewritten !== _lastRewrittenSource) {
        // Recompile the inspector material using existing shader_compile.js
        const fragmentShader = window.ShaderToy.shaderCompile.compileFragShader(rewritten);
        if (fragmentShader) {
            _inspectorMaterial = new THREE.ShaderMaterial({
                fragmentShader: rewritten,
                uniforms: { ...buffers[buffers.length - 1].Shader.uniforms }
            });
            _lastRewrittenSource = rewritten;
        }
    }
    if (_inspectorMaterial) {
        // Swap material for final buffer render only
        const finalBuffer = buffers[buffers.length - 1];
        const savedMaterial = quad.material;
        quad.material = _inspectorMaterial;
        renderer.setRenderTarget(finalBuffer.Target);
        renderer.render(scene, camera);
        quad.material = savedMaterial;  // restore for next frame
    }
} else {
    // Normal render (existing code path)
}
```

### Shader Source Acquisition

The preview webview has shader source in `<textarea data-shadertoy='shader'>` elements (NOT `<script>` tags — this was a hard-won fix from RC1→RC2 cycle). The inspector module reads from these:

```javascript
function getShaderSource(bufferIndex) {
    const textareas = document.querySelectorAll('textarea[data-shadertoy="shader"]');
    return textareas[bufferIndex]?.value ?? '';
}
```

For multipass shaders, the inspector applies to the **final buffer** (the one that outputs to screen). This is `buffers[buffers.length - 1]`.

### Recompilation Performance

Material recompilation is expensive. Mitigations:
1. **Hash-based cache**: Cache compiled materials by source hash (port of FragCoord's `Xd()` LRU cache concept)
2. **Debounce**: Don't recompile on every cursor move — wait for selection to stabilize (100ms debounce)
3. **Incremental**: Only recompile when the rewritten source actually changes

### End-to-End Flow

```
1. User selects "uv" in editor
2. Extension host → preview: { command: 'setInspectorVariable', variable: 'uv', line: 5 }
3. Preview module: inferType(source, 'uv') → 'vec2'
4. Preview module: coerceToVec4('uv', 'vec2') → 'vec4(uv, 0.0, 1.0)'
5. Preview module: rewriteForInspector(source, 'uv', mapping, 5)
6. Rewritten source: fragColor = _inspMap(vec4(uv, 0.0, 1.0));
7. Three.js material recompiled with rewritten source
8. Canvas shows UV gradient visualization instead of original shader output
```

### Error Handling

If the rewritten shader fails to compile:
1. Show compile error in inspector panel: "Rewrite failed: ..."
2. Fall back to original shader (don't break the preview)
3. Try fallback coercion: `vec4(variable)` instead of typed coercion
4. Report to extension host for diagnostic display

### Deliverable
- Select any variable → canvas instantly shows its value as color
- Default mapping: linear, range [0, 1], no OOR highlighting
- Deselect / close inspector → original shader restored
- No visible flicker during swap (material caching)
- Compile errors reported gracefully without breaking preview

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
        <label>Min <input type="number" value="0" step="0.1" id="range-min" /></label>
        <label>Max <input type="number" value="1" step="0.1" id="range-max" /></label>
    </div>
    
    <label class="inspector-oor">
        <input type="checkbox" id="oor-toggle" /> Highlight out-of-range
    </label>
</div>
```

### IPC Messages (Phase 4 additions)

```typescript
// Inspector Panel → Extension Host → Preview Webview
{ command: 'setInspectorMapping', mapping: MappingConfig }
```

### Range Annotation Auto-Detection

When a variable is selected on a line with `// [min, max]` comment:

```typescript
// Regex from FragCoord v0.7.1's hb:
const RANGE_ANNOTATION = /\/\/\s*\[\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\]/;
```

`parseRangeAnnotation()` (port of `Pj()`) scans:
1. The same line as the selected variable for `// [min, max]`
2. The preceding line (for variables declared on a separate line from the annotation)

When detected: auto-populate min/max fields in inspector panel, show indicator "Range from annotation".

### Mapping Curve Canvas (Stretch Goal)

FragCoord 0.5.0 shows a mapping curve canvas (see `inspector(0.5.0)/inspector_canvas_handlers.txt`) with:
- Curve visualization of the current mapping function
- Draggable min/max handles
- Histogram overlay (if Phase 8 implemented)

This is a stretch goal for Phase 4 — the basic number inputs are sufficient for MVP.

### Deliverable
- Three mapping mode buttons, switching live
- Min/max range inputs with live update
- OOR checkerboard highlighting toggle
- Range annotation auto-detection from shader comments
- Mapping curve canvas in inspector panel (stretch)

---

## Phase 5 — Value Tooltip (Pixel Readback)

**Goal**: Hovering over the preview canvas shows the RGBA value of the inspected variable at that pixel position.

### Mechanism

1. Preview webview: on `mousemove` over canvas, read the pixel at cursor position
2. Send pixel data to inspector panel via extension host
3. Inspector panel displays color swatch + RGBA values

### WebGL Pixel Readback

```typescript
function readPixelAt(gl: WebGLRenderingContext, x: number, y: number): Float32Array {
    const pixel = new Float32Array(4);
    gl.readPixels(x, gl.canvas.height - y, 1, 1, gl.RGBA, gl.FLOAT, pixel);
    return pixel;
}
```

**Float vs UNSIGNED_BYTE**: For accurate value readback, the inspector needs a **float FBO** (`RGBA32F`). This requires `EXT_color_buffer_float`. Phase 5 can start with `UNSIGNED_BYTE` readback (0–1 range, 8-bit precision) and upgrade to float FBO later (shared infrastructure with NaN detection / Heatmap).

```typescript
// Float FBO creation (shared utility — also used by Errors and Heatmap features):
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

### Throttling

Mouse events are throttled to ~30fps to avoid flooding the IPC:
```typescript
let lastTooltipUpdate = 0;
canvas.addEventListener('mousemove', (e) => {
    const now = performance.now();
    if (now - lastTooltipUpdate < 33) return;  // ~30fps
    lastTooltipUpdate = now;
    // readPixelAt + postMessage
});
```

### Deliverable
- Hover over canvas → inspector panel shows live RGBA values
- Color swatch matches pixel color
- Values update at throttled rate (~30fps)
- Works with all mapping modes

---

## Phase 6 — Compare Mode (Split View)

**Goal**: Toggle a compare mode that shows original shader on the left half, inspector output on the right half, with a draggable split divider.

### WebGL Scissor Implementation (Port of FragCoord's scissor split)

```typescript
// In the render loop, when compare mode active:
const splitX = Math.floor(canvas.width * compareSplit);

// Left: original shader (normal material)
gl.enable(gl.SCISSOR_TEST);
gl.scissor(0, 0, splitX, canvas.height);
renderWithOriginalMaterial();

// Right: inspector shader (rewritten material)
gl.scissor(splitX, 0, canvas.width - splitX, canvas.height);
renderWithInspectorMaterial();

gl.disable(gl.SCISSOR_TEST);
```

### Two Rewrite Paths (v0.7.1 Split)

This is the key v0.7.1 architecture change — two distinct rewrite functions:

| Function | Path | `_inspMap()`? | Use Case |
|----------|------|---------------|----------|
| `rewriteForInspector()` (port of `Bj()`) | `vb()` | Yes | Full inspect view (right half in compare, full canvas otherwise) |
| `rewriteForCompare()` (port of `Oj()`) | `gb()` | No | Raw variable output (right half when comparing without mapping) |

In compare mode:
- **Left half**: Original shader rendered normally
- **Right half**: `rewriteForInspector()` output (with `_inspMap()`)
- Optional: `rewriteForCompare()` for raw value output (no mapping)

### Draggable Divider

```typescript
let compareSplit = 0.5;   // default: 50/50

canvas.addEventListener('mousedown', (e) => {
    const normalizedX = e.offsetX / canvas.clientWidth;
    if (Math.abs(normalizedX - compareSplit) < 0.02) {
        isDraggingSplit = true;
    }
});

window.addEventListener('mousemove', (e) => {
    if (!isDraggingSplit) return;
    compareSplit = Math.max(0.1, Math.min(0.9, e.offsetX / canvas.clientWidth));
    // Clamp to [0.1, 0.9] — same as FragCoord
});
```

### Visual Indicator

Draw a 2px vertical line at the split position on a 2D canvas overlay:
```javascript
overlayCtx.beginPath();
overlayCtx.moveTo(splitX, 0);
overlayCtx.lineTo(splitX, canvas.height);
overlayCtx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
overlayCtx.lineWidth = 2;
overlayCtx.stroke();
```

### IPC Messages (Phase 6 additions)

```typescript
// Inspector Panel → Extension Host → Preview
{ command: 'setCompareMode', enabled: boolean }
{ command: 'setCompareSplit', split: number }   // from divider drag
```

### Inspector Panel (Inspect Tab addition)

```html
<label class="inspector-compare-mode">
    <input type="checkbox" id="compare-toggle" /> Compare
</label>
```

### Deliverable
- Checkbox toggles compare mode
- Left half = original shader, right half = inspector output
- Divider is draggable (clamped to [0.1, 0.9])
- Visual divider line on canvas

---

## Phase 7 — Type Inference Enhancement & Histogram (Polish)

**Goal**: Complete the type inference system and add optional histogram computation.

### 7a. Enhanced Type Inference

Complete the full `a2()` resolution chain from v0.7.1:

1. **`#define` expansion** (`Dj()`/`s4()`) — parse `#define FOO 3.14` → when inspecting `FOO`, resolve to `float`
2. **Expression analysis** (`mb()`) — for complex expressions like `sin(uv.x * 3.14) + 0.5`:
   - Scan for type constructors: `vec3(...)` → `vec3`
   - Check function return types: `texture()` → `vec4`, `cross()` → `vec3`, `dot()` → `float`
   - Check swizzle suffixes: `.xyz` → `vec3`
   - Check uniform references
   - Fall back to highest-dimensional type found
3. **Function call inspection** (`ep()`) — when inspecting a function name:
   - Parse signature to get return type
   - Generate mock arguments via `G8()` for call-site visualization

### 7b. Histogram Computation

When the Inspect tab is active, optionally compute per-channel histogram from the inspector FBO readback:

1. Render inspector shader to float FBO
2. Read back all pixels (`readPixels` with `Float32Array`)
3. Compute 128-bin histogram for each RGBA channel (from FragCoord's `Zi = 128`)
4. Compute 1–99% quantile for auto-range
5. Send histogram data to inspector panel

**Performance**: Only compute when:
- User explicitly requests (button click or auto-range toggle)
- Inspector panel visible and Inspect tab active
- Throttle to max 2Hz

### Inspector Panel (Histogram UI)

```html
<canvas id="histogram-canvas" class="inspector-histogram" width="256" height="80"></canvas>
<div class="inspector-histogram-channels">
    <label><input type="checkbox" checked data-ch="R" /> R</label>
    <label><input type="checkbox" checked data-ch="G" /> G</label>
    <label><input type="checkbox" checked data-ch="B" /> B</label>
    <label><input type="checkbox" checked data-ch="A" /> A</label>
</div>
<button id="auto-range-btn">Auto Range</button>
```

### IPC Messages (Phase 7 additions)

```typescript
// Preview → Extension Host → Inspector Panel
{ command: 'histogramData', data: { bins: number[][], channels: number, autoRange: { min: number, max: number } } }

// Inspector Panel → Extension Host → Preview
{ command: 'requestHistogram' }
```

### Deliverable
- Type-aware coercion (no more broken `vec4()` casts)
- `#define` macro resolution
- Function return type inference
- Range annotations auto-detected and applied
- Histogram chart with channel toggles (optional)
- Auto-range button from quantile analysis (optional)

---

# Implementation Order (Recommended)

The phases can be attacked in this order for maximum early value:

| Step | Phase | Feature | Depends On | Standalone? |
|------|-------|---------|------------|-------------|
| 1 | **Phase 0** | Panel scaffold + IPC | Nothing | ✅ Yes |
| 2 | **Phase 2** | Shader rewrite engine | Nothing (pure logic) | ✅ Yes (tests) |
| 3 | **Phase 1** | Variable selection bridge | Phase 0 | ✅ Yes |
| 4 | **Phase 3** | Inspector rendering | Phase 0 + 1 + 2 | ✅ First visible result |
| 5 | **Phase 4** | Mapping modes & controls | Phase 3 | Incremental |
| 6 | **Phase 5** | Value tooltip | Phase 3 | Incremental |
| 7 | **Phase 6** | Compare mode | Phase 3 | Incremental |
| 8 | **Phase 7** | Type inference + histogram | Phase 3 | Polish |

### Milestones

**M1 — "It works"** (Steps 1–4): Panel scaffold + shader rewrite + variable selection + rendering  
**M2 — "It's useful"** (Steps 5–6): Mapping modes + value tooltip  
**M3 — "Full inspect"** (Steps 7–8): Compare mode + type inference + histogram  

### Parallelization

- **Phase 0** and **Phase 2** have zero dependencies on each other → can be developed in parallel
- **Phase 2** unit tests can be written and run without any webview infrastructure
- **Phase 4** (mapping UI) can be built in parallel with Phase 3 (rendering) once Phase 0 IPC is in place

---

# Conventions & Constraints

### TypeScript
- All new source in TypeScript (no raw JS files except webview bundles)
- Shader rewrite engine: TS source in `src/inspector/`, webpack-bundled for webview
- Inspector panel script: TS source, compiled to JS
- Follow existing project style (2-space indent, single quotes, no semicolons — match existing codebase)

### Architecture Alignment
- Follow `WebviewExtension` pattern for preview-side injections
- Follow addon panel pattern (Layer 1–5) from sequencer reference (`shadertoyPanels-overview.md`)
- Hub-and-spoke IPC through `ShaderToyManager`
- New placeholders in `webview_base.html` for inspector extensions
- Constants in `src/inspector/inspector_types.ts`
- Do NOT reuse the `WebviewContentAssembler` for the inspector panel HTML (follow sequencer precedent)

### Shader Source Handling
- Shader source is in `<textarea data-shadertoy='shader'>` elements (NOT `<script>`)
- The preamble already defines `#define iResolution u_resolution` etc. — skip `Y8()` normalization
- `mainImage()` → `void main()` wrapper is auto-generated — detect and handle both forms
- `#line` directives use `SELF_SOURCE_ID = 65535` sentinel

### Testing
- Shader rewrite engine: unit tests (pure logic, no GL needed)
- IPC round-trips: integration tests via existing test infrastructure
- Visual verification: manual with test shaders from `demos/`
- Run existing tests after changes: `npm run test`

### Build
- `npm run webpack` for development build
- `npm run compile` for TypeScript check
- New webview modules must be included in webpack config

### Branching
- Work branch: current `wip1#fragcoord` (or as directed)
- Each milestone is a reviewable commit or commit group
- Do not push to remote unless explicitly asked

---

# Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Three.js material recompilation is slow | Inspection feels laggy | Cache compiled materials by rewritten source hash; debounce 100ms |
| Shader rewrite fails on complex shaders | Inspector shows errors instead of visualization | Graceful fallback: try `vec4(variable)`, catch compile error, report in panel |
| `mainImage()` wrapper detection unreliable | Rewrite inserts at wrong position | Robust regex + fallback to whole-body replacement |
| Float FBO not available | Limited tooltip precision | Feature-gate behind `EXT_color_buffer_float`; start with UNSIGNED_BYTE readback |
| IPC latency for pixel tooltip | Tooltip feels slow | Throttle to 30fps, debounce mouse moves |
| Variable type inference wrong | Broken `vec4()` cast → compile error | Fallback chain: typed → `vec4(v)` → report error |
| Webview module loading order | Inspector module references undefined globals | Use deferred init pattern (set up on first message); ensure load order via placeholder position |
| `#define` macros with side effects | Infinite expansion / wrong type | Limit expansion depth; timeout after 10 iterations |
| Multipass shaders: wrong buffer inspected | User confused by which pass is inspected | Always inspect final buffer; show buffer index in panel |
| `#include` files change line numbers | Inspector line doesn't match editor line | Use the existing `#line` directive system for offset mapping |

---

# Cross-Reference to FragCoord Source Files

| Feature Area | FragCoord v0.7.1 Function | Snippet File |
|-------------|--------------------------|-------------|
| Inspector rewrite pipeline | `Bj()`, `Oj()`, `vb()`, `gb()` | `071_inspmap_full_pipeline.txt` |
| Mapping config & helpers | `Fj()`, `K1()`, `pb()`, `e4`, `Pj()` | `071_mapping_helpers.txt`, `071_mapping_config.txt` |
| Type inference | `a2()`, `C0()`, `mb()`, `r4()`, `ep()`, `$v()` | `071_inspmap_full_pipeline.txt`, `071_mapping_helpers.txt` |
| ShaderToy normalization | `Y8()` | `071_iResolution_rewrite.txt` (SKIP — preamble handles) |
| Main function finding | `H8()` | `071_inspmap_full_pipeline.txt` |
| For-loop scoping | `K8()` | `071_inspmap_full_pipeline.txt` |
| fragColor replacement | `Y1()` | `071_inspmap_full_pipeline.txt` |
| Insertion point calc | `q8()` | `071_inspmap_full_pipeline.txt` |
| Compare scissor | Render `Kg()` with scissor | `071_compare_scissor.txt`, `071_scissor_in_render.txt` |
| Histogram processing | `Hg()` readback + binning | `071_histogram_processing.txt` |
| Pixel hover readback | `Hg()` single pixel variant | `071_inspector_hover.txt` |
| Inspector CSS | `.inspector-*` rules | `071_inspector_css.txt`, `071_feature_css_all.txt` |
| Shader compilation cache | `Xd()` LRU | `071_shader_compile_Xd.txt` |
| Float FBO | `Ku()`/`yd()` | `071_nan_inf_oor_full.txt` |
