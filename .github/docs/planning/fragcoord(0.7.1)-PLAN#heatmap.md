# fcPLAN — FragCoord Heatmap Transplant into Shader-Toy (v0.7.1)

> **Scope**: Implement FragCoord.xyz v0.7.1 **Heatmap** feature as an instruction-count profiling overlay in the shader-toy VSCode extension  
> **Source reports**: `references/fragcoord/fragcoord-heatmap(0.7.1)-REPORT.md` + `fragcoord-overview(0.7.1).md`  
> **Generic transplant reference**: `references/fragcoord/fragcoord-transplant-plan(0.7.1).md` §5  
> **Architecture reference**: `.github/docs/architecture/shadertoyPanels-overview.md`  
> **Skill reference**: `.github/skills/shader-toy/SKILL.md`  
> **Shared scaffold**: see `fragcoord(0.7.1)-PLAN#inspect.md` Phase 0

---

## 0. Architecture Decision

### What We're Building

A **per-pixel shader complexity profiler** that overlays a thermal/grayscale heatmap on the shader preview canvas. Unlike v0.6.2 (which used GPU wall-clock timing via `gl.finish()` stalls), v0.7.1 uses **instruction counting** — instrumenting the shader source with `_ic++` at every statement, then reading back per-pixel instruction counts. This is a fundamentally superior approach for VSCode webview environments.

### ⚠️ CRITICAL ARCHITECTURE CHANGE FROM v0.6.2

| Aspect | v0.6.2 (Old) | v0.7.1 (New) |
|--------|-------------|-------------|
| **Approach** | GPU wall-clock **timing** per tile | **Instruction counting** (`_ic++` per statement) |
| **What it measures** | Execution time (ms) | Shader complexity (instruction count) |
| **Synchronization** | `gl.finish()` CPU stall per tile | No stall needed (reads count, not time) |
| **Resolution** | Grid of tiles (e.g., 16×16) | Full pixel resolution |
| **Determinism** | Non-deterministic (GPU load dependent) | Fully deterministic (same shader → same heatmap) |
| **Performance impact** | Severe (`gl.finish()` blocks pipeline) | Minimal (single extra render pass) |
| **Per-line attribution** | Impossible | Possible (count `_ic++` per source line) |
| **GPU extension dependency** | Timer query extensions | None for heatmap itself |
| **Dead code** | Measured (but fast) | Stripped by `W8()` before counting |
| **Cross-function** | Not tracked | All functions instrumented via `_0()` |

**Why the change matters for VSCode**: `gl.finish()` stalls in a webview freeze the entire extension host thread. Instruction counting has no stalls and produces deterministic, per-pixel results.

### Relationship to Phase 0 Scaffold

This plan **depends on Phase 0** from `fragcoord(0.7.1)-PLAN#inspect.md`. The Heatmap feature adds:

- A new **"Heatmap" tab** in the inspector panel (alongside Inspect, Errors, Frames)
- Shader instrumentation engine (separate from Inspect's rewrite engine)
- GPU downsample pipeline (two shader programs)
- Overlay rendering with thermal/grayscale color ramps
- Per-line instruction counts sent to the extension host for editor gutter decorations
- Float FBO infrastructure (shared with Errors feature)

### Where Each Component Lives

```
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│   VSCode Editor  │        │  Extension Host   │        │ Preview Webview  │
│                  │        │ (ShaderToyManager) │        │  (WebGL canvas)  │
│ • Gutter counts  │◄──────┤                    │◄──────┤                  │
│   per line       │  API   │ • Route heatmap    │ postMsg│ • Instrument     │
│ • Color-coded    │        │   data to editor   │        │   shader (_ic++) │
│   decorations    │        │ • Gutter API       │        │ • Render to FBO  │
│                  │        │                    │        │ • GPU downsample │
│                  │        │                    │        │ • Overlay render │
│                  │        │                    │        │ • Temporal smooth│
│                  │        │                    │        └──────────────────┘
│                  │        │                    │
│                  │        │                    │        ┌──────────────────┐
│                  │        │                    ├──────►│ Inspector Panel  │
│                  │        │                    │ postMsg│  (Heatmap tab)   │
│                  │        │                    │◄──────┤ • Opacity slider │
│                  │        │                    │        │ • Color scheme   │
└──────────────────┘        └──────────────────┘        │ • Legend bar     │
                                                         └──────────────────┘
```

### What Happens Each Frame (Heatmap Active)

```
1. instrumentedSource = instrumentShader(originalSource)
2. if (instrumentedSource) {
3.   Allocate/reuse full-resolution float FBO
4.   Render instrumented shader → FBO (R channel = float(_ic))
5.   GPU downsample: full-res → grid (max-pool or bilinear)
6.   CPU readback of grid → extract min/max from R channel
7.   Apply temporal smoothing to min/max
8.   Render overlay: thermal/grayscale color ramp + alpha blending
9.   Compute per-line counts: $8(source) → send to extension host
}
```

### Key Shader-Toy Adaptations

1. **`mainImage()` handling** — our extension auto-generates `void main()` wrapper when `mainImage()` is present. The heatmap instrumentor must handle both forms, matching FragCoord's `Ej()` (standard) and `Sj()` (ShaderToy) paths.
2. **Preamble injection** — the `#define iResolution u_resolution` preamble adds lines before user code. Instrumentation works on raw user source (before preamble), but the final instrumented shader must include the preamble.
3. **Float FBO** — shared with the Errors feature's NaN probe. Reuse the `createFloatFBO()` helper from `src/inspector/shared/float_fbo.ts`.
4. **Three.js integration** — the preview uses Three.js for rendering. The instrumented shader must be compiled and rendered through the same Three.js material pipeline, or via a direct GL render (bypassing Three.js for the heatmap pass).

---

## Phase 1 — Shader Instrumentation Engine (Core)

**Goal**: Port the `_ic++` injection logic — pure TypeScript, no GL dependency, fully unit-testable.

### 1a. Statement-Level `_ic++` Injection (Port of `Oh()`)

This is the heart of the heatmap feature. `Oh()` processes a function body character-by-character, injecting `_ic++` after every statement:

```typescript
// src/inspector/heatmap/instrumentation.ts

/**
 * Inject _ic++ after every statement in a function body.
 * Port of FragCoord's Oh(body).
 * Ref: inspector(0.7.1)/071_heatmap_instrument_fn.txt (L2002)
 *
 * Rules:
 * - After each `;` at statement level → insert `_ic++;`
 * - After each `{` following flow control (if/else/for/while) → insert `_ic++;`
 * - Skip: for(;;) header semicolons (track paren depth)
 * - Skip: comments, string literals, preprocessor lines
 * - Skip: array initializer braces
 */
function instrumentBody(body: string): string {
  let result = ''
  let i = 0
  let parenDepth = 0
  let inSingleLineComment = false
  let inMultiLineComment = false
  let inPreprocessor = false
  let insideForHeader = -1  // paren depth when entering for()
  let pendingChars: string[] | null = null

  const emit = (ch: string) => {
    if (pendingChars !== null) {
      pendingChars.push(ch)
    } else {
      result += ch
    }
  }

  while (i < body.length) {
    // --- Multi-line comment ---
    if (!inSingleLineComment && !inPreprocessor && i + 1 < body.length &&
        body[i] === '/' && body[i + 1] === '*') {
      inMultiLineComment = true
      emit('/*')
      i += 2
      continue
    }
    if (inMultiLineComment && i + 1 < body.length &&
        body[i] === '*' && body[i + 1] === '/') {
      inMultiLineComment = false
      emit('*/')
      i += 2
      continue
    }
    if (inMultiLineComment) { emit(body[i]); i++; continue }

    // --- Single-line comment ---
    if (!inMultiLineComment && !inPreprocessor && i + 1 < body.length &&
        body[i] === '/' && body[i + 1] === '/') {
      inSingleLineComment = true
      emit('//')
      i += 2
      continue
    }

    // --- Preprocessor ---
    if (!inSingleLineComment && !inMultiLineComment &&
        body[i] === '#' && (i === 0 || body[i - 1] === '\n')) {
      inPreprocessor = true
      emit('#')
      i++
      continue
    }

    // --- Newline resets single-line comment and preprocessor ---
    if (body[i] === '\n') {
      if (inSingleLineComment) inSingleLineComment = false
      if (inPreprocessor) inPreprocessor = false
      emit('\n')
      i++
      continue
    }

    if (inSingleLineComment || inPreprocessor) { emit(body[i]); i++; continue }

    // --- Track parens ---
    if (body[i] === '(') {
      parenDepth++
      emit('(')
      i++
      continue
    }
    if (body[i] === ')') {
      parenDepth--
      emit(')')
      i++

      // Check for bare for-loop needing braces (handled by z8)
      if (parenDepth === 0 && insideForHeader >= 0) {
        insideForHeader = -1
      }
      continue
    }

    // --- Detect for() keyword to skip header semicolons ---
    if (parenDepth === 0) {
      const forMatch = body.slice(i).match(/^for\s*\(/)
      if (forMatch) {
        insideForHeader = parenDepth
        result += forMatch[0]
        i += forMatch[0].length
        parenDepth++  // for the opening paren
        continue
      }
    }

    // --- Semicolons ---
    if (body[i] === ';') {
      emit(';')
      if (parenDepth === 0 && insideForHeader < 0) {
        emit('_ic++;')
      }
      i++
      continue
    }

    // --- Opening braces after flow control ---
    if (body[i] === '{') {
      emit('{')
      // Check if preceded by flow control keyword
      const beforeBrace = result.trimEnd()
      const isFlowControl = /\b(if|else|for|while|do|switch)\s*(\([^)]*\))?\s*$/.test(beforeBrace) ||
                            /\belse\s*$/.test(beforeBrace)
      if (isFlowControl) {
        emit('_ic++;')
      }
      i++
      continue
    }

    emit(body[i])
    i++
  }

  return result
}
```

> **Note**: The actual implementation will closely follow FragCoord's character-by-character approach from `Oh()`. The above is a structural sketch — the full port will handle all edge cases: array initializers, nested comments, template strings, etc.

### 1b. For-Loop Normalization (Port of `z8()`)

```typescript
/**
 * Wrap bare for() statements in braces.
 * Port of z8(body).
 * Ref: inspector(0.7.1)/071_heatmap_for_loop.txt
 *
 * Transforms:
 *   for(int i=0; i<N; i++) x += y;
 * Into:
 *   for(int i=0; i<N; i++) { x += y; }
 *
 * Necessary so _ic++ injection at `;` works correctly for loop bodies.
 */
function normalizeForLoops(body: string): string {
  // Find `for(...)` where next non-whitespace is not `{`
  // Wrap the single statement (up to next `;`) in braces
  // Handle nested for loops recursively
  const forRegex = /\bfor\s*\(/g
  let match: RegExpExecArray | null
  let result = body

  // Process from end to start to preserve indices
  const locations: Array<{ start: number; end: number }> = []
  while ((match = forRegex.exec(body)) !== null) {
    const parenStart = body.indexOf('(', match.index)
    const parenEnd = findMatchingParen(body, parenStart)
    if (parenEnd < 0) continue

    // Check if next non-whitespace after `)` is `{`
    let next = parenEnd + 1
    while (next < body.length && /\s/.test(body[next])) next++
    if (next < body.length && body[next] === '{') continue

    // Find end of single statement (next `;` at depth 0)
    let stmtEnd = next
    let depth = 0
    while (stmtEnd < body.length) {
      if (body[stmtEnd] === '{') depth++
      else if (body[stmtEnd] === '}') depth--
      else if (body[stmtEnd] === ';' && depth === 0) {
        stmtEnd++
        break
      }
      stmtEnd++
    }

    locations.push({ start: next, end: stmtEnd })
  }

  // Wrap from end to start
  for (let i = locations.length - 1; i >= 0; i--) {
    const { start, end } = locations[i]
    result = result.slice(0, start) + '{ ' + result.slice(start, end) + ' }' + result.slice(end)
  }

  return result
}
```

### 1c. Dead Code Removal (Port of `W8()`)

```typescript
/**
 * Strip code after unconditional return/discard within each scope.
 * Port of W8(body).
 * Ref: inspector(0.7.1)/071_heatmap_rewriting_full.txt
 *
 * Prevents _ic++ from counting unreachable code paths.
 */
function stripDeadCode(body: string): string {
  // After "return ...;" or "discard;" at scope level 0:
  //   remove all subsequent statements until next `}` or end
  // Track brace depth to handle nested scopes correctly
  const lines = body.split('\n')
  const result: string[] = []
  let braceDepth = 0
  let dead = false

  for (const line of lines) {
    const trimmed = line.trim()

    // Track braces
    for (const ch of line) {
      if (ch === '{') { braceDepth++; dead = false }
      if (ch === '}') { braceDepth--; dead = false }
    }

    if (dead) continue
    result.push(line)

    // Check for unconditional return/discard at current scope level
    if (braceDepth === 0 && (/\breturn\b/.test(trimmed) || /\bdiscard\b/.test(trimmed))) {
      dead = true
    }
  }

  return result.join('\n')
}
```

> **Note**: The actual W8() implementation is character-based, not line-based. The above is simplified — the full port will match FragCoord's exact behavior.

### 1d. Cross-Function Instrumentation (Port of `_0()`)

```typescript
/**
 * Instrument ALL user-defined functions (not just main).
 * Port of _0(source, skipFuncName).
 * Ref: inspector(0.7.1)/071_heatmap_instrument_fn.txt (L2002)
 *
 * Finds every function definition (ignoring GLSL keywords and skipFuncName),
 * extracts the body, applies Oh() instrumentation, and replaces it.
 */
const GLSL_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
  'return', 'break', 'continue', 'discard', 'layout', 'in', 'out',
  'inout', 'uniform', 'varying', 'attribute', 'precision',
  'highp', 'mediump', 'lowp'
])

function instrumentAllFunctions(source: string, skipFuncName?: string): string {
  const funcRegex = /\b(\w+)\s+(\w+)\s*\([^)]*\)\s*\{/g
  const locations: Array<{ bodyStart: number; bodyEnd: number }> = []
  let match: RegExpExecArray | null

  while ((match = funcRegex.exec(source)) !== null) {
    const returnType = match[1]
    const funcName = match[2]
    if (GLSL_KEYWORDS.has(returnType)) continue
    if (skipFuncName && funcName === skipFuncName) continue

    const bodyStart = match.index + match[0].length
    let depth = 1, pos = bodyStart
    while (pos < source.length && depth > 0) {
      if (source[pos] === '{') depth++
      else if (source[pos] === '}') depth--
      pos++
    }
    locations.push({ bodyStart, bodyEnd: pos - 1 })
  }

  // Replace from end to preserve indices
  let result = source
  for (let i = locations.length - 1; i >= 0; i--) {
    const { bodyStart, bodyEnd } = locations[i]
    const body = result.slice(bodyStart, bodyEnd)
    const instrumented = instrumentBody(body)
    result = result.slice(0, bodyStart) + instrumented + result.slice(bodyEnd)
  }

  return result
}
```

### 1e. `_ic` Declaration Preamble (Port of `V8()`)

```typescript
/**
 * Insert `int _ic;` declaration before the first user function.
 * Port of V8(prefix).
 * Ref: inspector(0.7.1)/071_heatmap_rewriting_full.txt
 */
function insertIcDeclaration(source: string): string {
  const funcRegex = /\b(\w+)\s+(\w+)\s*\([^)]*\)\s*\{/g
  let match: RegExpExecArray | null
  while ((match = funcRegex.exec(source)) !== null) {
    if (!GLSL_KEYWORDS.has(match[1])) {
      return source.slice(0, match.index) + 'int _ic;\n' + source.slice(match.index)
    }
  }
  return source + '\nint _ic;\n'
}
```

### Deliverable
- `instrumentBody()` — core `_ic++` injection
- `normalizeForLoops()` — wrap bare for-loop bodies
- `stripDeadCode()` — remove unreachable code
- `instrumentAllFunctions()` — instrument all user functions
- `insertIcDeclaration()` — add `int _ic;` preamble
- All pure TypeScript, fully unit-testable with shader source strings

---

## Phase 2 — Full Shader Rewriting (Standard + ShaderToy Formats)

**Goal**: Port `Ej()` and `Sj()` — the two complete shader rewriting entry points.

### 2a. Standard Format Rewriter (Port of `Ej()`)

For shaders with `void main() { ... }`:

```typescript
// src/inspector/heatmap/heatmap_rewriter.ts

const IC_OUTPUT = 'fragColor = vec4(float(_ic), 0.0, 0.0, 1.0)'

/**
 * Rewrite a standard-format shader for heatmap rendering.
 * Port of Ej(source).
 * Ref: inspector(0.7.1)/071_heatmap_rewrite_Ej.txt
 *
 * Output structure:
 *   [code before main]
 *   int _ic;                              ← V8()
 *   void main() {
 *     _ic = 0;
 *     fragColor = vec4(0.0);              ← only if fragColor is used
 *     [instrumented body: Oh + z8 + W8]
 *     fragColor = vec4(float(_ic), ...);  ← IC_OUTPUT
 *   }
 *   [code after main]
 */
function rewriteStandardShader(source: string): string | null {
  // 1. Instrument all user functions except main
  let src = instrumentAllFunctions(source, 'main')

  // 2. Find main() boundaries
  const mainMatch = src.match(/\bvoid\s+main\s*\(\s*\)\s*\{/)
  if (!mainMatch || mainMatch.index === undefined) return null
  const bodyStart = mainMatch.index + mainMatch[0].length

  let depth = 1, pos = bodyStart
  while (pos < src.length && depth > 0) {
    if (src[pos] === '{') depth++
    else if (src[pos] === '}') depth--
    pos++
  }
  const bodyEnd = pos - 1

  // 3. Extract and instrument main body
  let body = src.slice(bodyStart, bodyEnd)
  body = instrumentBody(body)
  body = normalizeForLoops(body)
  body = stripDeadCode(body)

  // 4. Build output
  const prefix = src.slice(0, mainMatch.index)
  const suffix = src.slice(pos)
  const hasFragColor = /\bfragColor\b/.test(body)

  return insertIcDeclaration(prefix) +
    'void main() {\n' +
    '  _ic = 0;\n' +
    (hasFragColor ? '  fragColor = vec4(0.0);\n' : '') +
    body + '\n' +
    '  ' + IC_OUTPUT + ';\n' +
    '}\n' + suffix
}
```

### 2b. ShaderToy Format Rewriter (Port of `Sj()`)

For shaders with `void mainImage(out vec4 fragColor, in vec2 fragCoord)`:

```typescript
/**
 * Rewrite a ShaderToy-format shader for heatmap rendering.
 * Port of Sj(source).
 * Ref: inspector(0.7.1)/071_heatmap_rewrite_Sj.txt
 *
 * Output structure:
 *   [code with mainImage renamed to _ic_entry]
 *   [all functions instrumented via _0()]
 *   int _ic;
 *   void main() {
 *     _ic = 0;
 *     vec4 _dummyColor;
 *     _ic_entry(_dummyColor, gl_FragCoord.xy);
 *     fragColor = vec4(float(_ic), 0.0, 0.0, 1.0);
 *   }
 */
function rewriteShaderToyShader(source: string): string | null {
  // 1. Rename mainImage → _ic_entry
  let src = source.replace(/\bmainImage\b/g, '_ic_entry')

  // 2. Instrument ALL functions (including _ic_entry)
  src = instrumentAllFunctions(src)

  // 3. Add _ic declaration and wrapper main()
  src = insertIcDeclaration(src)
  src += '\nvoid main() {\n'
  src += '  _ic = 0;\n'
  src += '  vec4 _dummyColor;\n'
  src += '  _ic_entry(_dummyColor, gl_FragCoord.xy);\n'
  src += '  ' + IC_OUTPUT + ';\n'
  src += '}\n'

  return src
}
```

### 2c. Top-Level Entry Point (Port of `wj()`)

```typescript
/**
 * Instrument shader for heatmap rendering.
 * Port of wj(source).
 * Detects format (standard vs ShaderToy) and delegates.
 */
export function instrumentShaderForHeatmap(source: string): string | null {
  const hasMain = /\bvoid\s+main\s*\(\s*\)\s*\{/.test(source)
  const hasMainImage = /\bvoid\s+mainImage\s*\(/.test(source)

  if (hasMain) return rewriteStandardShader(source)
  if (hasMainImage) return rewriteShaderToyShader(source)
  return null
}
```

### Deliverable
- `instrumentShaderForHeatmap()` — main entry point
- Handles both `void main()` and `void mainImage()` formats
- Output shader renders `float(_ic)` to the R channel
- Fully unit-testable with shader source strings

---

## Phase 3 — Float FBO & Instrumented Shader Rendering

**Goal**: Render the instrumented shader to a float FBO at full resolution, capturing per-pixel instruction counts in the R channel.

### 3a. Float FBO (Shared Infrastructure)

Reuse the `createFloatFBO()` helper from `src/inspector/shared/float_fbo.ts` (established in the Errors plan Phase 2a). If not yet implemented, implement it here.

### 3b. Render Instrumented Shader to FBO

```typescript
// In the preview webview's heatmap module:

let heatmapFBO: FloatFBO | null = null

function renderHeatmapPass(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  source: string,
  uniforms: Uniforms
): boolean {
  const instrumented = instrumentShaderForHeatmap(source)
  if (!instrumented) return false

  // Allocate/reuse FBO at canvas resolution
  heatmapFBO = createFloatFBO(gl, canvas.width, canvas.height, heatmapFBO)
  if (!heatmapFBO) return false

  // Render instrumented shader to FBO
  const result = renderShaderToFBO(gl, canvas, instrumented, uniforms, heatmapFBO)
  return result.success
}
```

**Important**: The instrumented shader outputs `float(_ic)` in the R channel. The float FBO (`RGBA32F`) preserves the full floating-point value — typical instruction counts range from 0 to ~10,000+.

### 3c. Integration with Three.js Render

The heatmap pass runs **after** the normal render pass. It uses the same uniforms (`u_time`, `u_resolution`, etc.) but renders to the heatmap FBO instead of the screen:

```typescript
// In the render loop, when heatmap is active:
function onFrame(gl, canvas, source, uniforms) {
  // 1. Normal render (to screen / preview FBO)
  renderShader(gl, canvas, source, uniforms)

  // 2. Heatmap pass (to heatmap FBO)
  if (heatmapEnabled) {
    if (renderHeatmapPass(gl, canvas, source, uniforms)) {
      // Continue to Phase 4 (downsample) and Phase 5 (overlay)
    }
  }
}
```

### Deliverable
- Instrumented shader compiled and rendered to float FBO
- R channel contains per-pixel `_ic` instruction count as float
- Reuses shared float FBO infrastructure

---

## Phase 4 — GPU Downsampling & Min/Max Extraction

**Goal**: Reduce the full-resolution heatmap FBO to a grid for efficient CPU readback of min/max values.

### 4a. Two Downsample Paths

FragCoord v0.7.1 provides two downsample strategies:

| Path | When | Shader | Grid Size | Method |
|------|------|--------|-----------|--------|
| **A** — SIMD max-pool (`wM`/`yM`) | `chunkSize > 0` (user-specified) | `yM` (max-pool) | `ceil(W/chunk) × ceil(H/chunk)` | Max of all pixels in each chunk |
| **B** — Simple bilinear (`M3`/`mM`) | `chunkSize === 0` (default) | `mM` (bilinear) | 64×64 | Bilinear downsample |

For our initial implementation, **start with Path B (simple 64×64 bilinear)** — it's simpler to implement and sufficient for min/max extraction. Path A can be added later for higher accuracy.

### 4b. Simple Downsample Shader (Port of `mM`)

```glsl
// GLSL shader source — compiled once, reused
#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform vec2 u_targetSize;
layout(location = 0) out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / u_targetSize;
  fragColor = texture(u_source, uv);
}
```

### 4c. SIMD Max-Pool Downsample Shader (Port of `yM`)

```glsl
// GLSL shader source — for Path A (optional)
#version 300 es
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
  for (int y = srcMin.y; y < srcMax.y; y++) {
    for (int x = srcMin.x; x < srcMax.x; x++) {
      vec2 uv = (vec2(x, y) + 0.5) / u_sourceSize;
      maxVal = max(maxVal, texture(u_source, uv).r);
    }
  }
  fragColor = vec4(maxVal, 0.0, 0.0, 1.0);
}
```

### 4d. Downsample + Readback (Port of `M3()` / `wM()`)

```typescript
// src/inspector/heatmap/heatmap_downsample.ts

const DOWNSAMPLE_SIZE = 64  // Default grid size for Path B

let downsampleFBO: FloatFBO | null = null

/**
 * Downsample the heatmap FBO and extract min/max instruction counts.
 * Port of M3(gl, srcTex, dstFBO, w, h) for Path B.
 */
function downsampleAndExtractMinMax(
  gl: WebGL2RenderingContext,
  heatmapTexture: WebGLTexture,
  canvasW: number,
  canvasH: number
): { min: number; max: number; texture: WebGLTexture } | null {
  // Allocate/reuse downsample FBO at 64×64
  downsampleFBO = createFloatFBO(gl, DOWNSAMPLE_SIZE, DOWNSAMPLE_SIZE, downsampleFBO)
  if (!downsampleFBO) return null

  // Render downsample shader
  renderDownsample(gl, heatmapTexture, downsampleFBO, DOWNSAMPLE_SIZE, DOWNSAMPLE_SIZE)

  // CPU readback
  const pixels = readbackPixels(gl, downsampleFBO)
  if (!pixels) return null

  // Extract min/max from R channel
  let min = Infinity, max = -Infinity
  const totalPixels = DOWNSAMPLE_SIZE * DOWNSAMPLE_SIZE
  for (let i = 0; i < totalPixels; i++) {
    const val = pixels[i * 4]  // R channel = _ic count
    if (val < min) min = val
    if (val > max) max = val
  }

  if (!isFinite(min)) { min = 0; max = 0 }

  return { min, max, texture: heatmapTexture }
}
```

### Deliverable
- Full-resolution FBO downsampled to 64×64 grid
- Min/max instruction counts extracted via CPU readback
- Float32Array readback preserves full precision
- Path A (SIMD max-pool) available as optional upgrade

---

## Phase 5 — Overlay Rendering & Temporal Smoothing

**Goal**: Render the heatmap overlay on top of the normal preview using thermal/grayscale color ramps with alpha blending.

### 5a. Heatmap Overlay Shader (Port of `xM`)

```glsl
// GLSL shader source — the overlay renderer
#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform vec2 u_viewportSize;
uniform float u_minCount;
uniform float u_maxCount;
uniform float u_opacity;
uniform int u_colorScheme;
layout(location = 0) out vec4 fragColor;

vec3 thermalRamp(float t) {
  const vec3 c0 = vec3(0.0, 0.0, 0.0);      // t=0.0: black
  const vec3 c1 = vec3(0.0, 0.0, 0.627);     // t=0.2: blue
  const vec3 c2 = vec3(0.784, 0.0, 0.0);     // t=0.4: red
  const vec3 c3 = vec3(1.0, 0.588, 0.0);     // t=0.6: orange
  const vec3 c4 = vec3(1.0, 1.0, 0.0);       // t=0.8: yellow
  const vec3 c5 = vec3(1.0, 1.0, 1.0);       // t=1.0: white
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
}
```

### 5b. Overlay Render Function (Port of `bM()`)

```typescript
/**
 * Render the heatmap overlay to the screen with alpha blending.
 * Port of bM(gl, texture, viewW, viewH, minCount, maxCount, opacity, colorScheme).
 * Ref: inspector(0.7.1)/071_gpu_timer_query.txt (L245)
 */
function renderHeatmapOverlay(
  gl: WebGL2RenderingContext,
  heatmapTexture: WebGLTexture,
  viewW: number,
  viewH: number,
  minCount: number,
  maxCount: number,
  opacity: number,
  colorScheme: number  // 0 = thermal, 1 = grayscale
): void {
  const { program } = compileShader(gl, HEATMAP_OVERLAY_SHADER_SOURCE)
  if (!program) return

  gl.useProgram(program)

  // Bind heatmap texture
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, heatmapTexture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)

  // Set uniforms
  setUniform1i(gl, program, 'u_source', 0)
  setUniform2f(gl, program, 'u_viewportSize', viewW, viewH)
  setUniform1f(gl, program, 'u_minCount', minCount)
  setUniform1f(gl, program, 'u_maxCount', maxCount)
  setUniform1f(gl, program, 'u_opacity', opacity)
  setUniform1i(gl, program, 'u_colorScheme', colorScheme)

  // Alpha blending
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  // Render to screen
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.drawBuffers([gl.BACK])
  gl.viewport(0, 0, viewW, viewH)
  drawFullscreenQuad(gl, program)

  gl.disable(gl.BLEND)
}
```

### 5c. Temporal Smoothing (Port of v0.7.1's Frame-Rate-Independent Smoothing)

```typescript
// src/inspector/heatmap/heatmap_smoothing.ts

interface SmoothingState {
  smoothMin: number
  smoothMax: number
  initialized: boolean
}

/**
 * Apply frame-rate-independent temporal smoothing to min/max.
 * Port of FragCoord's smoothing formula: alpha = 1 - exp(-9.75 * dt)
 *
 * At 60fps (dt ≈ 0.0167): alpha ≈ 0.15 (gentle smoothing)
 * At 30fps (dt ≈ 0.0333): alpha ≈ 0.28 (adapts to lower frame rate)
 */
function smoothMinMax(
  currentMin: number,
  currentMax: number,
  state: SmoothingState,
  dt: number  // frame delta in seconds
): void {
  if (!state.initialized) {
    state.smoothMin = currentMin
    state.smoothMax = currentMax
    state.initialized = true
    return
  }

  const alpha = 1 - Math.exp(-9.75 * dt)
  state.smoothMin += (currentMin - state.smoothMin) * alpha
  state.smoothMax += (currentMax - state.smoothMax) * alpha
}
```

### 5d. Full Render Loop Integration

```typescript
// Pseudocode — in the preview webview's render callback:
let smoothing: SmoothingState = { smoothMin: 0, smoothMax: 0, initialized: false }
let lastHeatmapTime = 0

function renderHeatmapFrame(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  source: string,
  uniforms: Uniforms
): void {
  // 1. Instrument shader
  const instrumented = instrumentShaderForHeatmap(source)
  if (!instrumented) return

  // 2. Render to float FBO
  heatmapFBO = createFloatFBO(gl, canvas.width, canvas.height, heatmapFBO)
  if (!heatmapFBO) return
  const result = renderShaderToFBO(gl, canvas, instrumented, uniforms, heatmapFBO)
  if (!result.success) return

  // 3. Downsample + min/max extraction
  const minMax = downsampleAndExtractMinMax(gl, heatmapFBO.texture, canvas.width, canvas.height)
  if (!minMax) return

  // 4. Temporal smoothing
  const now = performance.now()
  const dt = lastHeatmapTime > 0 ? (now - lastHeatmapTime) / 1000 : 0
  lastHeatmapTime = now
  smoothMinMax(minMax.min, minMax.max, smoothing, dt)

  // 5. Render overlay
  const colorScheme = heatmapColorScheme === 'grayscale' ? 1 : 0
  renderHeatmapOverlay(
    gl, heatmapFBO.texture,
    canvas.width, canvas.height,
    smoothing.smoothMin, smoothing.smoothMax,
    heatmapOpacity, colorScheme
  )

  // 6. Report data to extension host
  vscode.postMessage({
    command: 'heatmapData',
    minCount: smoothing.smoothMin,
    maxCount: smoothing.smoothMax
  })
}
```

### Deliverable
- Thermal heatmap overlay rendered on top of the preview canvas
- 6-stop thermal color ramp: black → blue → red → orange → yellow → white
- Grayscale alternative
- Frame-rate-independent temporal smoothing
- Alpha blending for adjustable opacity

---

## Phase 6 — Per-Line Instruction Counts & Editor Gutter

**Goal**: Compute per-line `_ic++` counts from the instrumented source and display them as editor gutter decorations.

### 6a. Per-Line Count Computation (Port of `$8()` / `_j()` / `Cj()`)

```typescript
// src/inspector/heatmap/line_counts.ts

/**
 * Count _ic++ occurrences per line in instrumented source.
 * Port of Bv(source).
 */
function countIcPerLine(source: string): number[] {
  const re = /_ic\+\+/g
  return source.split(/\r?\n/).map(line => (line.match(re) || []).length)
}

/**
 * Compute line offset (number of newlines before a given position).
 * Port of Ov(source, position).
 */
function lineAtOffset(source: string, offset: number): number {
  let count = 0
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') count++
  }
  return count
}

/**
 * Compute per-line instruction counts for a standard-format shader.
 * Port of _j(source).
 * Ref: inspector(0.7.1)/071_heatmap_rewriting_full.txt (L1988)
 */
function computeLineCounts_standard(source: string): number[] | null {
  const totalLines = (source.match(/\n/g) || []).length + 1
  const counts = new Array(totalLines).fill(0)

  // 1. Instrument all functions except main
  let src = instrumentAllFunctions(source, 'main')

  // 2. Find main() body
  const mainMatch = src.match(/\bvoid\s+main\s*\(\s*\)\s*\{/)
  if (!mainMatch || mainMatch.index === undefined) return null
  const bodyStart = mainMatch.index + mainMatch[0].length
  let depth = 1, pos = bodyStart
  while (pos < src.length && depth > 0) {
    if (src[pos] === '{') depth++
    else if (src[pos] === '}') depth--
    pos++
  }
  const bodyEnd = pos - 1

  // 3. Instrument main body
  let body = src.slice(bodyStart, bodyEnd)
  body = instrumentBody(body)
  body = normalizeForLoops(body)
  body = stripDeadCode(body)

  // 4. Count _ic++ per line in main body
  const mainLineOffset = lineAtOffset(src, bodyStart)
  const mainCounts = countIcPerLine(body)
  for (let i = 0; i < mainCounts.length; i++) {
    const line = mainLineOffset + i
    if (line < counts.length) counts[line] += mainCounts[i]
  }

  // 5. Count _ic++ in all other user functions
  const funcRegex = /\b(\w+)\s+(\w+)\s*\([^)]*\)\s*\{/g
  let match: RegExpExecArray | null
  while ((match = funcRegex.exec(src)) !== null) {
    if (GLSL_KEYWORDS.has(match[1]) || match[2] === 'main') continue
    const fBodyStart = match.index + match[0].length
    let fDepth = 1, fPos = fBodyStart
    while (fPos < src.length && fDepth > 0) {
      if (src[fPos] === '{') fDepth++
      else if (src[fPos] === '}') fDepth--
      fPos++
    }
    const fBody = src.slice(fBodyStart, fPos - 1)
    const fCounts = countIcPerLine(instrumentBody(fBody))
    const fLineOffset = lineAtOffset(src, fBodyStart)
    for (let i = 0; i < fCounts.length; i++) {
      const line = fLineOffset + i
      if (line < counts.length) counts[line] += fCounts[i]
    }
  }

  return counts
}

/**
 * Compute per-line instruction counts for a ShaderToy-format shader.
 * Port of Cj(source).
 */
function computeLineCounts_shaderToy(source: string): number[] | null {
  const totalLines = (source.match(/\n/g) || []).length + 1
  const counts = new Array(totalLines).fill(0)

  // Rename mainImage → _ic_entry, then instrument ALL functions
  const renamed = source.replace(/\bmainImage\b/g, '_ic_entry')
  const instrumented = instrumentAllFunctions(renamed)

  // Count _ic++ per line across all functions
  const funcRegex = /\b(\w+)\s+(\w+)\s*\([^)]*\)\s*\{/g
  let match: RegExpExecArray | null
  while ((match = funcRegex.exec(instrumented)) !== null) {
    if (GLSL_KEYWORDS.has(match[1])) continue
    const bodyStart = match.index + match[0].length
    let depth = 1, pos = bodyStart
    while (pos < instrumented.length && depth > 0) {
      if (instrumented[pos] === '{') depth++
      else if (instrumented[pos] === '}') depth--
      pos++
    }
    const body = instrumented.slice(bodyStart, pos - 1)
    const fCounts = countIcPerLine(instrumentBody(body))
    const lineOffset = lineAtOffset(instrumented, bodyStart)
    for (let i = 0; i < fCounts.length; i++) {
      const line = lineOffset + i
      if (line < counts.length) counts[line] += fCounts[i]
    }
  }

  return counts
}

/**
 * Top-level entry: compute per-line _ic counts.
 * Port of $8(source).
 */
export function computePerLineCounts(source: string): number[] | null {
  const hasMain = /\bvoid\s+main\s*\(\s*\)\s*\{/.test(source)
  const hasMainImage = /\bvoid\s+mainImage\s*\(/.test(source)
  if (hasMain) return computeLineCounts_standard(source)
  if (hasMainImage) return computeLineCounts_shaderToy(source)
  return null
}
```

### 6b. IPC: Preview → Extension Host

```typescript
// In the preview webview, after computing line counts:
const counts = computePerLineCounts(source)
if (counts) {
  // Convert to sparse array (only non-zero lines)
  const lineCounts = counts
    .map((count, lineIdx) => ({ line: lineIdx + 1, count }))
    .filter(entry => entry.count > 0)

  vscode.postMessage({
    command: 'heatmapLineCounts',
    counts: lineCounts
  })
}
```

### 6c. Editor Gutter Decorations (Extension Host)

```typescript
// In ShaderToyManager or a dedicated heatmap display module:

const heatmapDecorationType = vscode.window.createTextEditorDecorationType({
  // Base style — individual decorations override via renderOptions
})

function handleHeatmapLineCounts(
  editor: vscode.TextEditor,
  lineCounts: Array<{ line: number; count: number }>
) {
  if (lineCounts.length === 0) {
    editor.setDecorations(heatmapDecorationType, [])
    return
  }

  const maxCount = Math.max(...lineCounts.map(c => c.count))
  const padWidth = String(maxCount).length

  const decorations = lineCounts.map(({ line, count }) => {
    const intensity = count / maxCount
    const color = thermalColorCSS(intensity)
    return {
      range: new vscode.Range(line - 1, 0, line - 1, 0),
      renderOptions: {
        before: {
          contentText: String(count).padStart(padWidth),
          color,
          fontWeight: intensity > 0.7 ? 'bold' : 'normal',
          margin: '0 8px 0 0',
          fontStyle: 'normal'
        }
      }
    }
  })

  editor.setDecorations(heatmapDecorationType, decorations)
}
```

### 6d. JavaScript Thermal Color Ramp (Port of `pj()` / `mj()` / `Jx()`)

```typescript
// src/inspector/heatmap/color_ramp.ts

/**
 * Thermal color ramp — mirrors GLSL thermalRamp().
 * Port of pj(t).
 */
function thermalColor(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t))
  if (t < 0.2) {
    const s = t * 5
    return [0, 0, Math.round(s * 160)]
  } else if (t < 0.4) {
    const s = (t - 0.2) * 5
    return [Math.round(s * 200), 0, Math.round((1 - s) * 160)]
  } else if (t < 0.6) {
    const s = (t - 0.4) * 5
    return [200 + Math.round(s * 55), Math.round(s * 150), 0]
  } else if (t < 0.8) {
    const s = (t - 0.6) * 5
    return [255, 150 + Math.round(s * 105), 0]
  } else {
    const s = (t - 0.8) * 5
    return [255, 255, Math.round(s * 255)]
  }
}

/**
 * Grayscale color ramp. Port of mj(t).
 */
function grayscaleColor(t: number): [number, number, number] {
  const v = Math.round(Math.max(0, Math.min(1, t)) * 255)
  return [v, v, v]
}

/**
 * Get color as CSS string. Port of gj(t, scheme).
 */
function thermalColorCSS(t: number, scheme: 'thermal' | 'grayscale' = 'thermal'): string {
  const [r, g, b] = scheme === 'grayscale' ? grayscaleColor(t) : thermalColor(t)
  return `rgb(${r},${g},${b})`
}

/**
 * Generate CSS linear-gradient for the heatmap legend.
 * Port of vj(scheme).
 */
function heatmapGradientCSS(scheme: 'thermal' | 'grayscale' = 'thermal'): string {
  const stops: string[] = []
  for (let i = 0; i <= 10; i++) {
    const t = i / 10
    const [r, g, b] = scheme === 'grayscale' ? grayscaleColor(t) : thermalColor(t)
    stops.push(`rgb(${r},${g},${b}) ${(t * 100).toFixed(0)}%`)
  }
  return `linear-gradient(to right, ${stops.join(', ')})`
}
```

### 6e. Throttling Per-Line Computation

Per-line counts only change when the shader source changes (they're deterministic). Compute once per source change, not per frame:

```typescript
let lastSourceHash = ''

function maybeComputeLineCounts(source: string) {
  const hash = simpleHash(source)
  if (hash === lastSourceHash) return
  lastSourceHash = hash

  const counts = computePerLineCounts(source)
  if (counts) {
    const sparse = counts
      .map((count, i) => ({ line: i + 1, count }))
      .filter(e => e.count > 0)
    vscode.postMessage({ command: 'heatmapLineCounts', counts: sparse })
  }
}
```

### Deliverable
- Per-line `_ic++` counts computed from instrumented source
- Editor gutter shows color-coded instruction counts
- Counts update when shader source changes
- Thermal/grayscale color ramp mirroring GLSL overlay
- CSS gradient helper for legend bar

---

## Phase 7 — Inspector Panel Heatmap Tab & Controls

**Goal**: Build the Heatmap tab UI in the inspector panel with opacity slider, color scheme toggle, and legend bar.

### 7a. Heatmap Tab HTML

```html
<div class="inspector-heatmap-tab" data-tab="heatmap">
  <div class="heatmap-controls">
    <!-- Opacity slider -->
    <label class="heatmap-control-row">
      <span class="heatmap-label">Opacity</span>
      <input type="range" class="heatmap-opacity-slider"
             min="0" max="1" step="0.05" value="0.7" />
      <span class="heatmap-opacity-value">70%</span>
    </label>

    <!-- Color scheme toggle -->
    <div class="heatmap-control-row">
      <span class="heatmap-label">Color</span>
      <button class="heatmap-scheme-btn active" data-scheme="thermal">Thermal</button>
      <button class="heatmap-scheme-btn" data-scheme="grayscale">Grayscale</button>
    </div>

    <!-- Legend bar -->
    <div class="heatmap-legend">
      <div class="heatmap-legend-bar"></div>
      <div class="heatmap-legend-labels">
        <span class="heatmap-legend-min">0</span>
        <span class="heatmap-legend-label">Instruction Count</span>
        <span class="heatmap-legend-max">0</span>
      </div>
    </div>

    <!-- Stats -->
    <div class="heatmap-stats">
      <span class="heatmap-stat-min">Min: 0</span>
      <span class="heatmap-stat-max">Max: 0</span>
    </div>
  </div>
</div>
```

### 7b. Controls Wiring

```typescript
// Inspector panel script:

// Opacity slider
const opacitySlider = document.querySelector('.heatmap-opacity-slider') as HTMLInputElement
const opacityValue = document.querySelector('.heatmap-opacity-value')!
opacitySlider.addEventListener('input', () => {
  const opacity = parseFloat(opacitySlider.value)
  opacityValue.textContent = `${Math.round(opacity * 100)}%`
  vscode.postMessage({ command: 'setHeatmapOpacity', opacity })
})

// Color scheme toggle
document.querySelectorAll('.heatmap-scheme-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const scheme = btn.getAttribute('data-scheme')!
    document.querySelectorAll('.heatmap-scheme-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    vscode.postMessage({ command: 'setHeatmapColorScheme', scheme })

    // Update legend gradient
    updateLegendGradient(scheme)
  })
})

function updateLegendGradient(scheme: string) {
  const bar = document.querySelector('.heatmap-legend-bar') as HTMLElement
  bar.style.background = heatmapGradientCSS(scheme as any)
}
```

### 7c. Legend Bar Updates

When heatmap data arrives, update the legend labels:

```typescript
window.addEventListener('message', (event) => {
  const msg = event.data
  if (msg.command === 'heatmapData') {
    document.querySelector('.heatmap-legend-min')!.textContent = String(Math.round(msg.minCount))
    document.querySelector('.heatmap-legend-max')!.textContent = String(Math.round(msg.maxCount))
    document.querySelector('.heatmap-stat-min')!.textContent = `Min: ${Math.round(msg.minCount)}`
    document.querySelector('.heatmap-stat-max')!.textContent = `Max: ${Math.round(msg.maxCount)}`
  }
})
```

### 7d. IPC Messages (Complete Set for Heatmap)

```typescript
// Preview → Extension Host → Inspector Panel:
{ command: 'heatmapData', minCount: number, maxCount: number }
{ command: 'heatmapLineCounts', counts: Array<{ line: number, count: number }> }

// Inspector Panel → Extension Host → Preview:
{ command: 'setHeatmapOpacity', opacity: number }           // 0.0–1.0
{ command: 'setHeatmapColorScheme', scheme: string }         // 'thermal' | 'grayscale'
{ command: 'setHeatmapEnabled', enabled: boolean }           // toggle on/off

// Extension Host → Editor:
// (direct API: setDecorations for gutter counts)
```

### 7e. CSS

```css
.heatmap-controls {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.heatmap-control-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.heatmap-label {
  font-size: 11px;
  opacity: 0.7;
  min-width: 50px;
}

.heatmap-opacity-slider {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  background: rgba(128, 128, 128, 0.3);
  border-radius: 2px;
  outline: none;
}

.heatmap-opacity-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--vscode-focusBorder, #007acc);
  cursor: pointer;
}

.heatmap-opacity-value {
  font-size: 11px;
  font-family: monospace;
  min-width: 30px;
  text-align: right;
}

.heatmap-scheme-btn {
  background: transparent;
  border: 1px solid rgba(128, 128, 128, 0.3);
  color: inherit;
  padding: 2px 8px;
  font-size: 10px;
  border-radius: 3px;
  cursor: pointer;
}

.heatmap-scheme-btn.active {
  background: rgba(128, 128, 128, 0.25);
  border-color: rgba(128, 128, 128, 0.5);
}

.heatmap-legend {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.heatmap-legend-bar {
  height: 8px;
  border-radius: 4px;
  /* Set via JS: background: linear-gradient(...) */
}

.heatmap-legend-labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  font-family: monospace;
  opacity: 0.6;
}

.heatmap-stats {
  display: flex;
  gap: 16px;
  font-size: 10px;
  font-family: monospace;
  opacity: 0.7;
}
```

### Deliverable
- Heatmap tab with opacity slider, color scheme toggle, legend bar
- Legend updates with live min/max instruction counts
- Controls send IPC messages to configure preview overlay

---

## Phase 8 — SIMD Max-Pool Downsample (Optional Upgrade)

**Goal**: Add Path A (SIMD max-pool) for more accurate min/max extraction when user specifies a chunk size.

### 8a. Configuration

Expose chunk size as a setting:

```json
"shader-toy.inspector.heatmapChunkSize": {
  "type": "number",
  "default": 0,
  "description": "Heatmap downsample chunk size (0 = auto 64×64, >0 = custom max-pool grid)"
}
```

### 8b. Max-Pool Downsample

When `chunkSize > 0`, use the `yM` shader for SIMD max-pool downsampling:

```typescript
function downsampleMaxPool(
  gl: WebGL2RenderingContext,
  sourceTexture: WebGLTexture,
  sourceW: number,
  sourceH: number,
  chunkSize: number
): { fbo: FloatFBO; gridW: number; gridH: number } | null {
  const gridW = Math.max(1, Math.ceil(sourceW / chunkSize))
  const gridH = Math.max(1, Math.ceil(sourceH / chunkSize))

  const fbo = createFloatFBO(gl, gridW, gridH, null)
  if (!fbo) return null

  renderMaxPoolShader(gl, sourceTexture, sourceW, sourceH, fbo, gridW, gridH)
  return { fbo, gridW, gridH }
}
```

This provides more accurate min/max values since each grid cell contains the **maximum** instruction count within its chunk (vs bilinear interpolation which averages).

### Deliverable
- Optional SIMD max-pool downsample for advanced users
- Configurable chunk size via settings
- Falls back to 64×64 bilinear when chunk size = 0

---

# Implementation Order (Recommended)

| Step | Phase | Feature | Depends On | Standalone? |
|------|-------|---------|------------|-------------|
| 1 | **Phase 0** (from Inspect plan) | Panel scaffold + IPC | Nothing | ✅ Yes |
| 2 | **Phase 1** | Instrumentation engine | Nothing (pure logic) | ✅ Yes (tests) |
| 3 | **Phase 2** | Full shader rewriting | Phase 1 | ✅ Yes (tests) |
| 4 | **Phase 3** | Float FBO + instrumented render | Phase 2 + shared FBO | ✅ First GL test |
| 5 | **Phase 4** | GPU downsample + min/max | Phase 3 | ✅ Pipeline works |
| 6 | **Phase 5** | Overlay rendering + smoothing | Phase 4 | ✅ First visible heatmap |
| 7 | **Phase 6** | Per-line counts + gutter | Phase 1 + 2 (pure logic) | ✅ Editor integration |
| 8 | **Phase 7** | Inspector panel Heatmap tab | Phase 0 + 5 | UI polish |
| 9 | **Phase 8** | SIMD max-pool downsample | Phase 4 | Optional upgrade |

### Milestones

**M1 — "Instrumentation works"** (Steps 1–3): Shader instrumentation engine passes unit tests, full rewriting produces valid GLSL  
**M2 — "Heatmap renders"** (Steps 4–6): Full GPU pipeline — instrumented render → downsample → overlay → visible heatmap on canvas  
**M3 — "Editor integration"** (Step 7): Per-line instruction counts in editor gutter  
**M4 — "Full heatmap"** (Steps 8–9): Inspector panel UI + optional SIMD downsample

### Parallelization

- **Phase 1** (instrumentation engine) has zero dependencies on any webview infrastructure → start immediately
- **Phase 6** (per-line counts) depends only on Phase 1 + 2 (pure logic) → can be developed in parallel with Phases 3–5 (GL pipeline)
- **Phase 7** (inspector panel UI) can be built in parallel with the GL pipeline once Phase 0 scaffold is in place
- **Phase 2** unit tests can exercise full shader rewriting without any GL context

---

# Conventions & Constraints

### TypeScript
- All new source in TypeScript
- Instrumentation engine: `src/inspector/heatmap/` — pure logic, no GL dependency
- Overlay shaders: GLSL source as template literals in TypeScript
- Color ramp: `src/inspector/heatmap/color_ramp.ts` — shared between JS (gutter) and GLSL (overlay)
- Follow existing project style (2-space indent, single quotes, no semicolons)

### Architecture Alignment
- Heatmap tab lives inside the inspector panel (Phase 0 scaffold)
- IPC messages routed through `ShaderToyManager` hub
- Float FBO helper shared with Errors feature (`src/inspector/shared/`)
- Overlay shaders compiled via shader cache (`Xd()` equivalent)
- Per-line counts sent to extension host for gutter decorations (not rendered in webview)

### Shader Source Handling
- Instrumentation runs on raw user source (before preamble injection)
- Final instrumented shader must include preamble for compilation
- Handle both `void main()` and `void mainImage()` formats
- `_ic` variable name is highly unlikely to collide — but check for conflicts
- Cross-function instrumentation: ALL user functions, not just main

### Performance Considerations
- Instrumentation: cache instrumented source (deterministic per source hash)
- Per-line counts: compute only on source change, not per frame
- Float FBO: reuse across frames (only reallocate on canvas resize)
- Downsample: 64×64 readback = 4096 pixels = 64KB → negligible
- Overlay: single fullscreen quad draw with texture lookup → fast
- Temporal smoothing: prevents jarring min/max jumps

### Testing
- `instrumentBody()`: unit tests with known shader snippets → verify `_ic++` placement
- `normalizeForLoops()`: unit tests with bare for-loops → verify braces added
- `stripDeadCode()`: unit tests with return/discard → verify dead code removed
- `instrumentAllFunctions()`: unit tests with multi-function shaders
- `instrumentShaderForHeatmap()`: full rewrite tests → verify valid GLSL output
- `computePerLineCounts()`: unit tests → verify per-line count arrays
- Color ramp: unit tests → verify t=0.0→black, t=0.5→red/orange, t=1.0→white
- Run existing tests: `npm run test`

### Build
- `npm run webpack` for development build
- `npm run compile` for TypeScript check
- GLSL shader sources embedded as string literals (no separate .glsl files)

---

# Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Instrumentation breaks on complex shaders | Heatmap shows errors instead of visualization | Graceful fallback: catch compile error, report in panel, disable overlay |
| `_ic` name collision with user code | Compile error | Prefix with unlikely name (`_stIc`); scan source for conflicts |
| `_ic` exceeds int precision (~2^31) | Overflow for extremely complex shaders | Use `float _ic` instead of `int _ic` if needed; or cap at high value |
| `EXT_color_buffer_float` not available | Can't use float FBO | Fall back to RGBA8 FBO → limited precision for `_ic` readback |
| For-loop normalization misses edge cases | `_ic++` not counted inside loop bodies | Comprehensive unit tests; handle `while`, `do-while`, nested for |
| Dead code stripper removes live code | Wrong instruction count | Conservative approach: only strip after unconditional return at depth 0 |
| Three.js material recompilation per frame | Performance degradation | Cache instrumented shader by source hash; only recompile on change |
| Overlay shader compile error on some GPUs | Heatmap overlay not visible | GLSL 300 es is widely supported; fall back to basic overlay |
| Per-line count computation slow for large shaders | Blocks main thread | Run once per source change (not per frame); consider web worker |
| Gutter decorations flicker during editing | Distracting UX | Debounce decoration updates (500ms after last change) |
| Temporal smoothing too aggressive | Heatmap responds slowly | Tune time constant (9.75); allow user override |
| Cross-function `_ic` accumulation inaccurate | Counts double-attributed to caller | This is by design — `_ic` is a global counter, counts reflect total work |

---

# Cross-Reference to FragCoord Source Files

| Feature Area | FragCoord v0.7.1 Function | Snippet File |
|-------------|--------------------------|-------------|
| Shader format detection | `wj()` | `071_heatmap_rewriting_full.txt` |
| Standard rewriter | `Ej()` | `071_heatmap_rewrite_Ej.txt` |
| ShaderToy rewriter | `Sj()` | `071_heatmap_rewrite_Sj.txt` |
| Statement instrumentation | `Oh()` | `071_heatmap_instrument_fn.txt` |
| Cross-function instrumentation | `_0()` | `071_heatmap_instrument_fn.txt` |
| For-loop normalization | `z8()` | `071_heatmap_for_loop.txt` |
| Dead code removal | `W8()` | `071_heatmap_rewriting_full.txt` |
| `_ic` declaration | `V8()` | `071_heatmap_rewriting_full.txt` |
| `_ic` output constant | `q1` | `071_heatmap_rewriting_full.txt` |
| GLSL keyword set | `w0` | `071_heatmap_rewriting_full.txt` |
| Per-line counts (standard) | `_j()` | `071_heatmap_rewrite__j.txt` |
| Per-line counts (ShaderToy) | `Cj()` | `071_heatmap_rewrite_Cj.txt` |
| Per-line entry | `$8()` | `071_heatmap_rewriting_full.txt` |
| `_ic++` counter | `Bv()` | `071_heatmap_rewriting_full.txt` |
| Line offset | `Ov()` | `071_heatmap_rewriting_full.txt` |
| Overlay shader (thermal/grayscale) | `xM` | `071_heatmap_shader_xM_full.txt` |
| SIMD max-pool shader | `yM` | `071_heatmap_shader_yM_full.txt` |
| Simple bilinear shader | `mM` | `071_heatmap_shader_mM.txt` |
| Overlay render function | `bM()` | `071_bM_heatmap_overlay.txt` |
| SIMD downsample function | `wM()` | `071_gpu_timer_query.txt` |
| Simple downsample function | `M3()` | `071_gpu_timer_query.txt` |
| Render loop integration | L2058 `Rt.current` | `071_heatmap_mode_render.txt` |
| Temporal smoothing | `1 - exp(-9.75 * dt)` | `071_heatmap_mode_render.txt` |
| Float FBO helper | `Ku()` | `071_nan_inf_oor_full.txt`, `071_webgl_engine.txt` |
| Pixel readback | `Hg()` | `071_webgl_engine.txt` |
| JS thermal ramp | `pj()` / `Jx()` | `071_heatmap_rewriting_full.txt` |
| JS grayscale ramp | `mj()` | `071_heatmap_rewriting_full.txt` |
| CSS gradient helper | `vj()` | `071_heatmap_rewriting_full.txt` |
| Canvas 2D heatmap render | `xj()` | `071_heatmap_rewriting_full.txt` |
| Heatmap refs in viewport | `Rt`, `Zt`, `At`, `nr`, `Mr`, `pr`, `ls`, `Or` | `071_heatmap_refs_in_viewport.txt` |
| Heatmap CSS | `.heatmap-*` rules | `071_heatmap_css.txt` |
| All heatmap identifiers | Summary list | `071_heatmap_all_refs.txt` |
