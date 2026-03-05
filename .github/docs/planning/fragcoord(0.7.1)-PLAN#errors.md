# fcPLAN — FragCoord Errors Transplant into Shader-Toy (v0.7.1)

> **Scope**: Implement FragCoord.xyz v0.7.1 **Errors** feature as a multi-layer error detection system in the shader-toy VSCode extension  
> **Source reports**: `references/fragcoord/fragcoord-errors(0.7.1)-REPORT.md` + `fragcoord-overview(0.7.1).md`  
> **Generic transplant reference**: `references/fragcoord/fragcoord-transplant-plan(0.7.1).md` §4  
> **Architecture reference**: `.github/docs/architecture/shadertoyPanels-overview.md`  
> **Skill reference**: `.github/skills/shader-toy/SKILL.md`  
> **Shared scaffold**: see `fragcoord(0.7.1)-PLAN#inspect.md` Phase 0

---

## 0. Architecture Decision

### What We're Building

A **three-layer error detection system** integrated into the shader-toy preview webview and the inspector panel:

1. **Compile-time errors** — parse `gl.getShaderInfoLog()` output, correct line offsets, surface as VSCode Diagnostics
2. **Runtime pixel errors** — NaN / Inf / Out-of-Range pixel scanning at reduced resolution (32×32) every 60 frames
3. **Shader analysis warnings** — static analysis of 9 dangerous-operation categories, surfaced as VSCode Diagnostics (warnings)

### Relationship to Phase 0 Scaffold

This plan **depends on Phase 0** from `fragcoord(0.7.1)-PLAN#inspect.md`. The inspector panel scaffold, IPC bridge, and tab structure are established there. The Errors feature adds:

- A new **"Errors" tab** in the inspector panel (alongside Inspect)
- New IPC messages between preview webview → extension host → inspector panel
- VSCode Diagnostics integration (editor-side error/warning decorations)
- A new webview module for runtime error detection (NaN/Inf/OOR probe)

### Where Does Each Layer Live?

```
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│   VSCode Editor  │        │  Extension Host   │        │ Preview Webview  │
│                  │        │ (ShaderToyManager) │        │  (WebGL canvas)  │
│ • Diagnostics    │◄──────┤                    │◄──────┤                  │
│   (red=compile   │  API   │ • DiagnosticColl.  │ postMsg│ • Compile errors │
│    yellow=warn)  │        │ • Status bar item  │        │ • NaN/Inf/OOR    │
│ • Gutter icons   │        │ • IPC hub          │        │   pixel probe    │
│                  │        │                    │        │ • Float FBO      │
│                  │        │                    │        └──────────────────┘
│                  │        │                    │
│                  │        │                    │        ┌──────────────────┐
│                  │        │                    ├──────►│ Inspector Panel  │
│                  │        │                    │ postMsg│  (Errors tab)    │
│                  │        │                    │◄──────┤ • Error summary  │
│                  │        │                    │        │ • Toggle pills   │
└──────────────────┘        └──────────────────┘        │ • Warning list   │
                                                         └──────────────────┘
```

### What's New in v0.7.1 vs v0.6.2

| Aspect | v0.6.2 | v0.7.1 |
|--------|--------|--------|
| **Compile errors** | Same parsing + line offset | Same parsing + line offset (unchanged) |
| **NaN/Inf/OOR** | 32×32 probe, every 60 frames | Same constants (`Zu=32`, `Kj=60`) |
| **OOR thresholds** | ±0.002 | ±0.002 (unchanged) |
| **Shader analysis** | Not present | **9 warning categories** with static analysis (`Mj()`) |
| **NaN probe helpers** | Implicit type handling | Explicit `_npR()` GLSL overloads for typed reduction |
| **Warning categories** | N/A | division, sqrt, inversesqrt, log, pow, asin, acos, atan, mod |
| **Warning metadata** | N/A | Color-coded per category, with line/column/length/reason |

### Key Shader-Toy Adaptations

1. **Compile error parsing** — our extension already has basic error display via `DefaultErrorsExtension` (see `src/extensions/user_interface/error_display/`). We extend, not replace, this existing infrastructure.
2. **Line offset correction** — FragCoord's `ZC()` computes the preamble line count. In our extension, `WEBGL2_EXTRA_SHADER_LINES = 16` and `SELF_SOURCE_ID = 65535` already handle this. We adapt `ZC()`'s logic to use our constants.
3. **Float FBO** — shared infrastructure with the Inspect feature. If Inspect's Phase 3 already creates float FBOs, reuse them; otherwise, create the float FBO helper as part of this plan.
4. **`_npR()` overloads** — inject before `main()` in the probe shader variant. Since the preamble already handles `#define iResolution u_resolution` etc., no `Y8()` normalization is needed.

---

## Phase 1 — Compile Error Integration

**Goal**: Parse GLSL compilation errors from the WebGL context and surface them as VSCode Diagnostics.

### 1a. Error Parsing (Preview Webview)

Port the `getShaderInfoLog()` parser from FragCoord's error pipeline:

```typescript
// src/inspector/errors/compile_error_parser.ts

interface CompileError {
  line: number
  message: string
}

/**
 * Parse structured errors from GLSL compiler output.
 * Port of FragCoord's getShaderInfoLog parser.
 * Ref: inspector(0.7.1)/071_getShaderInfoLog_L102.txt
 */
function parseCompileErrors(infoLog: string): CompileError[] {
  const errors: CompileError[] = []
  const regex = /^ERROR:\s*\d+:(\d+):\s*(.+)/gim
  let match: RegExpExecArray | null
  while ((match = regex.exec(infoLog)) !== null) {
    errors.push({
      line: parseInt(match[1], 10),
      message: match[2].trim()
    })
  }
  return errors
}
```

### 1b. Line Offset Correction

Port FragCoord's `ZC()` — compute the line offset introduced by the shader source builder (`XC()` equivalent). In our extension, this is the preamble injection:

```typescript
/**
 * Compute the number of lines injected by the preamble/wrapper.
 * Port of ZC(source, passCount).
 * Our preamble adds ~16 lines (WEBGL2_EXTRA_SHADER_LINES).
 */
function computePreambleLineOffset(passCount: number): number {
  // Start with our known constant
  let offset = WEBGL2_EXTRA_SHADER_LINES  // 16
  // If multi-pass: each pass sampler uniform adds a line
  offset += passCount
  return offset
}

function correctErrorLines(errors: CompileError[], lineOffset: number): CompileError[] {
  return errors.map(e => ({
    ...e,
    line: Math.max(1, e.line - lineOffset)
  }))
}
```

### 1c. IPC: Preview → Extension Host

When the shader compiles (or fails), the preview webview posts compile errors:

```typescript
// In the preview webview render module:
const { program, errors } = compileShader(gl, source)
if (errors.length > 0) {
  const corrected = correctErrorLines(errors, computePreambleLineOffset(passCount))
  vscode.postMessage({
    command: 'compileErrors',
    errors: corrected
  })
}
```

### 1d. VSCode Diagnostics API (Extension Host)

```typescript
// In ShaderToyManager or dedicated error handler:
const diagnosticCollection = vscode.languages.createDiagnosticCollection('shader-toy')

function handleCompileErrors(document: vscode.TextDocument, errors: CompileError[]) {
  const diagnostics = errors.map(err => {
    const range = new vscode.Range(err.line - 1, 0, err.line - 1, 999)
    return new vscode.Diagnostic(range, err.message, vscode.DiagnosticSeverity.Error)
  })
  diagnosticCollection.set(document.uri, diagnostics)
}
```

### Integration with Existing Error Display

The extension already has `DefaultErrorsExtension` and `IVertexErrorRewriteExtension`. The new compile error path **supplements** these:

- **Existing path**: `glsl_error_hook.js` + registered rewriters → displayed in webview error overlay
- **New path**: Structured errors → IPC → VSCode Diagnostics → red squiggles in editor

Both paths coexist. The webview error overlay remains for in-canvas error display; the Diagnostics API provides editor integration.

### Deliverable
- GLSL compile errors appear as red Diagnostics in the VSCode editor
- Clicking an error jumps to the correct line (line offset corrected)
- Existing error overlay in webview still works

---

## Phase 2 — Runtime Pixel Error Detection (NaN/Inf/OOR)

**Goal**: Detect runtime pixel anomalies (NaN, Infinity, out-of-range) by rendering the shader to a low-resolution float FBO and scanning the result.

### 2a. Float FBO Helper (Shared Infrastructure)

This is shared with the Inspect feature's Phase 3. If already implemented, reuse; otherwise:

```typescript
// src/inspector/shared/float_fbo.ts

interface FloatFBO {
  fbo: WebGLFramebuffer
  texture: WebGLTexture
  width: number
  height: number
}

/**
 * Create or reuse a float FBO at the given dimensions.
 * Port of Ku(gl, w, h, existing).
 * Requires EXT_color_buffer_float.
 */
function createFloatFBO(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  existing?: FloatFBO | null
): FloatFBO | null {
  // Reuse if dimensions match
  if (existing && existing.width === width && existing.height === height) {
    return existing
  }
  // Clean up old
  if (existing) {
    gl.deleteFramebuffer(existing.fbo)
    gl.deleteTexture(existing.texture)
  }
  // Require float extension
  const ext = gl.getExtension('EXT_color_buffer_float')
  if (!ext) return null

  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)

  const fbo = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)

  return { fbo, texture: tex, width, height }
}
```

### 2b. Pixel Readback Helper

```typescript
/**
 * Read back all pixels from an FBO as Float32Array.
 * Port of Hg(gl, fbo).
 */
function readbackPixels(gl: WebGL2RenderingContext, target: FloatFBO): Float32Array | null {
  const pixels = new Float32Array(target.width * target.height * 4)
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
  gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.FLOAT, pixels)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return pixels
}
```

### 2c. NaN/Inf/OOR Scanner

Port of FragCoord's pixel scanning loop from `071_nan_inf_oor_full.txt`:

```typescript
// src/inspector/errors/pixel_error_scanner.ts

const NAN_PROBE_SIZE = 32    // Zu — 32×32 pixel probe resolution
const NAN_PROBE_INTERVAL = 60  // Kj — every 60 frames

interface PixelErrorResult {
  hasNan: boolean
  hasInf: boolean
  hasOor: boolean
  nanPixels: number
  infPixels: number
  oorPixels: number
  totalSampled: number
}

function scanPixelErrors(pixels: Float32Array, totalPixels: number): PixelErrorResult {
  let nanCount = 0, infCount = 0, oorCount = 0

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]

    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      nanCount++
    } else if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      infCount++
    } else if (
      r < -0.002 || g < -0.002 || b < -0.002 ||
      r > 1.002 || g > 1.002 || b > 1.002
    ) {
      oorCount++
    }
  }

  return {
    hasNan: nanCount > 0,
    hasInf: infCount > 0,
    hasOor: oorCount > 0,
    nanPixels: nanCount,
    infPixels: infCount,
    oorPixels: oorCount,
    totalSampled: totalPixels
  }
}
```

### 2d. Render Loop Integration

In the preview webview's render loop (the `requestAnimationFrame` callback), add the NaN probe:

```typescript
// Pseudocode — integrated into the existing render callback:
let nanProbeCounter = 0
let nanProbeFBO: FloatFBO | null = null

function onFrame(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement, shaderSource: string, uniforms: Uniforms) {
  // ... normal render ...

  // NaN probe (every NAN_PROBE_INTERVAL frames)
  if (errorsEnabled) {
    nanProbeCounter++
    if (nanProbeCounter >= NAN_PROBE_INTERVAL) {
      nanProbeCounter = 0

      // Allocate/reuse 32×32 float FBO
      nanProbeFBO = createFloatFBO(gl, NAN_PROBE_SIZE, NAN_PROBE_SIZE, nanProbeFBO)
      if (nanProbeFBO) {
        // Render shader at 32×32 to float FBO
        const result = renderShaderToFBO(gl, canvas, shaderSource, uniforms, nanProbeFBO)
        if (result.success) {
          const pixels = readbackPixels(gl, nanProbeFBO)
          if (pixels) {
            const errors = scanPixelErrors(pixels, NAN_PROBE_SIZE * NAN_PROBE_SIZE)
            // Post to extension host
            vscode.postMessage({ command: 'nanDetected', ...errors })
          }
        }
      }
      // Restore viewport
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
  }
}
```

**Key detail**: The probe renders the **unmodified** shader at 32×32 resolution. The float FBO preserves NaN/Inf values that would be clamped in a regular UNSIGNED_BYTE framebuffer.

### 2e. OOR Thresholds

| Check | Threshold | Rationale |
|-------|-----------|-----------|
| NaN | `Number.isNaN(v)` | IEEE 754 NaN detection |
| Infinity | `!Number.isFinite(v)` | Catches ±Infinity |
| Out-of-range | `< -0.002` or `> 1.002` | ±0.002 tolerance for FP precision noise |

The ±0.002 tolerance matches FragCoord exactly. This avoids false positives from floating-point imprecision near [0.0, 1.0] boundaries.

### Deliverable
- Every ~1 second (at 60fps), the shader is probed for NaN/Inf/OOR pixels
- Results posted to extension host for status bar and inspector panel display
- Float FBO helper is reusable by other features (Inspect, Heatmap)

---

## Phase 3 — Status Bar & Inspector Panel Error Display

**Goal**: Show runtime error indicators in the VSCode status bar and in the inspector panel's Errors tab.

### 3a. Status Bar Item (Extension Host)

```typescript
// In ShaderToyManager or a dedicated error display module:

const nanStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
nanStatusBarItem.name = 'Shader-Toy Pixel Errors'

function handleNanDetected(result: PixelErrorResult) {
  if (result.hasNan || result.hasInf || result.hasOor) {
    const parts: string[] = []
    if (result.hasNan) parts.push(`NaN:${result.nanPixels}`)
    if (result.hasInf) parts.push(`Inf:${result.infPixels}`)
    if (result.hasOor) parts.push(`OOR:${result.oorPixels}`)

    nanStatusBarItem.text = `$(warning) ${parts.join(' ')}`
    nanStatusBarItem.tooltip = `Pixel errors in ${result.totalSampled} sampled pixels`
    nanStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
    nanStatusBarItem.show()
  } else {
    nanStatusBarItem.hide()
  }
}
```

### 3b. Inspector Panel — Errors Tab

The Errors tab (within the inspector panel from Phase 0) shows:

```html
<div class="inspector-errors-tab" data-tab="errors">
  <!-- Runtime error summary -->
  <div class="error-runtime-summary">
    <span class="error-pill error-pill-nan" data-count="0">NaN</span>
    <span class="error-pill error-pill-inf" data-count="0">Inf</span>
    <span class="error-pill error-pill-oor" data-count="0">OOR</span>
  </div>

  <!-- Compile errors list -->
  <div class="error-compile-list">
    <!-- Populated dynamically -->
  </div>

  <!-- Shader analysis warnings list -->
  <div class="error-warnings-list">
    <!-- Populated dynamically in Phase 4 -->
  </div>
</div>
```

### 3c. Error Pills (Toggle Behavior)

Each pill toggles whether that error category is highlighted in the diagnostic overlay:

```typescript
// Inspector panel script:
document.querySelectorAll('.error-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    pill.classList.toggle('active')
    const checks = {
      nan: document.querySelector('.error-pill-nan')!.classList.contains('active'),
      inf: document.querySelector('.error-pill-inf')!.classList.contains('active'),
      oor: document.querySelector('.error-pill-oor')!.classList.contains('active')
    }
    vscode.postMessage({ command: 'setErrorChecks', checks })
  })
})
```

### 3d. IPC Messages (Phase 3)

```typescript
// Preview → Extension Host → Inspector Panel:
{ command: 'compileErrors', errors: CompileError[] }
{ command: 'nanDetected', hasNan, hasInf, hasOor, nanPixels, infPixels, oorPixels, totalSampled }

// Inspector Panel → Extension Host → Preview:
{ command: 'setErrorChecks', checks: { nan: boolean, inf: boolean, oor: boolean } }
```

### 3e. Error Count Badges

When errors are detected, show count badges on the Errors tab header:

```typescript
function updateErrorBadge(tabElement: HTMLElement, result: PixelErrorResult) {
  const total = result.nanPixels + result.infPixels + result.oorPixels
  const badge = tabElement.querySelector('.tab-badge')
  if (total > 0) {
    badge!.textContent = String(total)
    badge!.classList.add('visible')
  } else {
    badge!.classList.remove('visible')
  }
}
```

### Deliverable
- Status bar shows `$(warning) NaN:3 Inf:1 OOR:12` when runtime errors are detected
- Status bar hides when no errors are present
- Inspector panel Errors tab shows toggleable error pills
- Error count badge on tab header

---

## Phase 4 — Shader Analysis Warnings (Static Analysis)

**Goal**: Port FragCoord v0.7.1's `Mj()` static analyzer to detect potentially dangerous GLSL operations and surface them as VSCode Diagnostics (warnings).

### 4a. Warning Data Types

```typescript
// src/inspector/errors/shader_analysis.ts

type WarningKind = 'division' | 'sqrt' | 'inversesqrt' | 'log' | 'pow' | 'asin' | 'acos' | 'atan' | 'mod'

interface ShaderWarning {
  kind: WarningKind
  line: number
  column: number
  endColumn: number
  label: string       // e.g., "sqrt(x)" or "a / b"
  rawExpr: string     // full extracted expression
  reason: string      // human-readable description
}

/** Warning category metadata (port of FragCoord's Sm object) */
const WARNING_CATEGORIES: Record<WarningKind, { color: string; description: string }> = {
  division:     { color: '#ff6666', description: 'Division — 0/0 produces NaN' },
  sqrt:         { color: '#66ccff', description: 'sqrt of negative → NaN' },
  inversesqrt:  { color: '#66ccff', description: 'inversesqrt of ≤0 → NaN' },
  log:          { color: '#88ddaa', description: 'log/log2 of ≤0 → undefined' },
  pow:          { color: '#ffaa44', description: 'pow with negative base → NaN' },
  asin:         { color: '#cc88ff', description: 'asin of |x|>1 → NaN' },
  acos:         { color: '#cc88ff', description: 'acos of |x|>1 → NaN' },
  atan:         { color: '#cc88ff', description: 'atan(0,0) → undefined' },
  mod:          { color: '#ffcc44', description: 'mod(x,0) → NaN' }
}
```

### 4b. Comment Stripper

Port of `kj()` — replaces comments with equal-length whitespace to preserve line/column positions:

```typescript
/**
 * Strip comments while preserving character positions.
 * Port of kj(source).
 * Ref: inspector(0.7.1)/071_shader_warnings_full.txt
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length))
}
```

### 4c. Position Utility

```typescript
/**
 * Convert character offset to line/column.
 * Port of i2(source, offset).
 */
function offsetToPosition(source: string, offset: number): { line: number; column: number } {
  const prefix = source.slice(0, offset)
  const lastNL = prefix.lastIndexOf('\n')
  const line = (prefix.match(/\n/g)?.length ?? 0) + 1
  const column = lastNL >= 0 ? offset - lastNL : offset + 1
  return { line, column }
}
```

### 4d. Constant Detection

```typescript
/**
 * Check if a string is a non-zero numeric constant.
 * Port of Mj(str) [the inner constant checker, not the analyzer].
 * Used to suppress division warnings when denominator is a known non-zero constant.
 */
function isNonZeroConstant(str: string): boolean {
  const trimmed = str.trim()
  if (/^[+-]?(\d+\.?\d*|\d*\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
    const val = parseFloat(trimmed)
    return !isNaN(val) && val !== 0
  }
  return false
}
```

### 4e. Parenthesis Matcher

```typescript
/**
 * Find the matching closing parenthesis.
 * Port of Rj(source, openIndex).
 */
function findMatchingParen(source: string, openIndex: number): number {
  let depth = 1
  for (let i = openIndex + 1; i < source.length; i++) {
    if (source[i] === '(') depth++
    else if (source[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}
```

### 4f. Label Truncation

```typescript
/** Truncate expression labels to 30 chars. Port of o2(). */
function truncateLabel(expr: string): string {
  const trimmed = expr.trim()
  return trimmed.length <= 30 ? trimmed : trimmed.slice(0, 27) + '…'
}
```

### 4g. Main Analyzer — Port of `Mj(source)`

```typescript
/**
 * Analyze shader source for potentially dangerous operations.
 * Port of the outer Mj(source) analyzer.
 * Ref: inspector(0.7.1)/071_shader_warnings_full.txt (L2008–2016)
 */
function analyzeShader(source: string): ShaderWarning[] {
  const cleaned = stripComments(source)
  const warnings: ShaderWarning[] = []

  // --- Division detection ---
  const divRegex = /(?<!\/)\/(?![\/\*=])/g
  let match: RegExpExecArray | null
  while ((match = divRegex.exec(cleaned)) !== null) {
    const pos = match.index
    // Extract left operand (up to 60 chars before /)
    const leftCtx = cleaned.slice(Math.max(0, pos - 60), pos)
    const rightCtx = cleaned.slice(pos + 1, Math.min(cleaned.length, pos + 61))
    const leftMatch = leftCtx.match(/(\b[\w.]+(?:\([^)]*\))?)\s*$/)
    const rightMatch = rightCtx.match(/^\s*([\w.]+(?:\([^)]*\))?)/)
    const left = leftMatch?.[1] ?? '…'
    const right = rightMatch?.[1] ?? '…'

    // Suppress if denominator is a known non-zero constant
    if (isNonZeroConstant(right)) continue

    const { line, column } = offsetToPosition(source, pos)
    warnings.push({
      kind: 'division',
      line,
      column,
      endColumn: column + 1,
      label: `${truncateLabel(left)} / ${truncateLabel(right)}`,
      rawExpr: `(${left}) / (${right})`,
      reason: 'Division by zero: 0/0 produces NaN, x/0 produces ±Inf'
    })
  }

  // --- Function call detection ---
  const functionPatterns: Array<{ re: RegExp; kind: WarningKind; reason: string }> = [
    { re: /\bsqrt\s*\(/g,         kind: 'sqrt',         reason: 'sqrt(x) is NaN when x < 0' },
    { re: /\binversesqrt\s*\(/g,   kind: 'inversesqrt',  reason: 'inversesqrt(x) is undefined when x ≤ 0' },
    { re: /\blog2?\s*\(/g,         kind: 'log',          reason: 'log/log2(x) is undefined when x ≤ 0' },
    { re: /\bpow\s*\(/g,           kind: 'pow',          reason: 'pow(x,y) is undefined when x < 0 or x = 0 with y ≤ 0' },
    { re: /\basin\s*\(/g,          kind: 'asin',         reason: 'asin(x) is undefined when |x| > 1' },
    { re: /\bacos\s*\(/g,          kind: 'acos',         reason: 'acos(x) is undefined when |x| > 1' },
    { re: /\batan\s*\(/g,          kind: 'atan',         reason: 'atan(y, x) is undefined when x = 0 and y = 0' },
    { re: /\bmod\s*\(/g,           kind: 'mod',          reason: 'mod(x, y) is undefined when y = 0' }
  ]

  for (const { re, kind, reason } of functionPatterns) {
    while ((match = re.exec(cleaned)) !== null) {
      const funcStart = match.index
      const parenOpen = cleaned.indexOf('(', funcStart)
      if (parenOpen < 0) continue
      const parenClose = findMatchingParen(cleaned, parenOpen)
      if (parenClose < 0) continue

      const args = cleaned.slice(parenOpen + 1, parenClose).trim()
      const funcName = match[0].replace(/\s*\($/, '')
      const fullExpr = cleaned.slice(funcStart, parenClose + 1).trim()
      const { line, column } = offsetToPosition(source, funcStart)
      const endCol = offsetToPosition(source, parenClose).column + 1

      warnings.push({
        kind,
        line,
        column,
        endColumn: endCol,
        label: `${funcName}(${truncateLabel(args)})`,
        rawExpr: fullExpr,
        reason
      })
    }
  }

  return warnings.sort((a, b) => a.line - b.line || a.column - b.column)
}
```

### 4h. Where Does Analysis Run?

**In the extension host** (not the webview). Rationale:
- The analyzer needs the raw user source (before preamble injection)
- The extension host has direct access to the `TextDocument`
- Results go straight to the VSCode Diagnostics API (no IPC round-trip needed)
- Analysis is triggered on document change (debounced)

```typescript
// In the shader document change handler:
let analysisTimer: NodeJS.Timeout | undefined

function onShaderDocumentChange(document: vscode.TextDocument) {
  clearTimeout(analysisTimer)
  analysisTimer = setTimeout(() => {
    const source = document.getText()
    const warnings = analyzeShader(source)

    const diagnostics = warnings.map(w => {
      const range = new vscode.Range(w.line - 1, w.column - 1, w.line - 1, w.endColumn - 1)
      const diag = new vscode.Diagnostic(range, w.reason, vscode.DiagnosticSeverity.Warning)
      diag.source = `shader-analysis (${w.kind})`
      return diag
    })

    // Merge with compile errors (don't overwrite)
    const compileErrors = getCompileErrorDiagnostics(document.uri)
    diagnosticCollection.set(document.uri, [...compileErrors, ...diagnostics])
  }, 500)  // 500ms debounce
}
```

### 4i. Inspector Panel — Warnings Display

Warnings are also sent to the inspector panel for display in the Errors tab:

```typescript
// Extension host → Inspector Panel:
inspectorPanel.webview.postMessage({
  command: 'shaderWarnings',
  warnings: warnings.map(w => ({
    kind: w.kind,
    line: w.line,
    label: w.label,
    reason: w.reason,
    color: WARNING_CATEGORIES[w.kind].color
  }))
})
```

Inspector panel renders them as a scrollable list:

```html
<div class="warning-item" style="border-left: 3px solid ${color}">
  <span class="warning-kind">${kind}</span>
  <span class="warning-line">L${line}</span>
  <span class="warning-label">${label}</span>
  <span class="warning-reason">${reason}</span>
</div>
```

### Deliverable
- 9 warning categories detected and displayed
- Warnings appear as yellow squiggles in the VSCode editor
- Warning list in inspector panel Errors tab with color-coded borders
- Analysis runs on document change with 500ms debounce
- Division warnings suppressed for known non-zero constant denominators

---

## Phase 5 — NaN Probe Helpers (Per-Expression Probing) (Optional)

**Goal**: Port the `_npR()` GLSL overloads to enable per-expression NaN/Inf probing — when a user clicks a specific pixel, determine which sub-expression produces NaN/Inf.

### 5a. GLSL Overloads

```typescript
/**
 * _npR() overloads — reduce any GLSL type to a float for NaN/Inf testing.
 * Port of FragCoord's fb[] array.
 * Ref: inspector(0.7.1)/071_nan_probe_full.txt
 */
const NAN_PROBE_OVERLOADS = [
  'float _npR(float v) { return v; }',
  'float _npR(vec2 v) { return v.x + v.y; }',
  'float _npR(vec3 v) { return v.x + v.y + v.z; }',
  'float _npR(vec4 v) { return v.x + v.y + v.z + v.w; }'
]
```

### 5b. Probe Shader Rewriting

Port of `Lj(source, line, variable)`:

```typescript
/**
 * Rewrite shader to probe a specific expression for NaN/Inf.
 * Port of Lj(source, targetLine, expression).
 *
 * Inserts _npR() overloads before main() and adds a check block
 * at the target line that outputs a checkerboard pattern for NaN (red/cyan)
 * or Inf (green/magenta).
 */
function rewriteForNanProbe(
  source: string,
  targetLine: number,
  expression: string
): string | null {
  const lines = source.split('\n')
  if (targetLine < 1 || targetLine > lines.length) return null

  // Insert _npR overloads before void main() / void mainImage()
  let inserted = false
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*void\s+(main|mainImage)\s*\(/.test(lines[i])) {
      lines.splice(i, 0, ...NAN_PROBE_OVERLOADS)
      inserted = true
      if (i < targetLine) targetLine += NAN_PROBE_OVERLOADS.length
      break
    }
  }
  if (!inserted) return null

  // Insert NaN/Inf check at the target line
  const checkBlock = [
    `{ float _npS = _npR(${expression});`,
    `  float _npCk = mod(floor(gl_FragCoord.x / 4.0) + floor(gl_FragCoord.y / 4.0), 2.0);`,
    `  if (isnan(_npS)) { fragColor = vec4(_npCk, 1.0 - _npCk, 1.0 - _npCk, 1.0); return; }`,
    `  if (isinf(_npS)) { fragColor = vec4(1.0 - _npCk, _npCk, 1.0 - _npCk, 1.0); return; } }`
  ].join(' ')

  lines.splice(targetLine, 0, checkBlock)
  return lines.join('\n')
}
```

### 5c. Checkerboard Pattern

When NaN is detected at a pixel, the probe shader outputs a **red/cyan 4×4 checkerboard**. When Inf is detected, it outputs a **green/magenta 4×4 checkerboard**. This makes the affected pixel region visually obvious:

| Error Type | Color A | Color B | Pattern |
|-----------|---------|---------|---------|
| NaN | `(1, 0, 0, 1)` red | `(0, 1, 1, 1)` cyan | 4×4 checkerboard |
| Inf | `(0, 1, 0, 1)` green | `(1, 0, 1, 1)` magenta | 4×4 checkerboard |

### 5d. Interaction Model

This is an advanced feature, triggered when:
1. User is in Errors mode
2. User clicks on the canvas at a specific pixel
3. Extension host stores the click coordinates
4. On next frame, the probe shader variant is compiled and rendered
5. Pixel result is read back and reported

### Deliverable
- Click-to-probe for NaN/Inf at specific expressions
- Checkerboard overlay shows which pixels are affected
- Per-expression drill-down in the inspector panel

---

## Phase 6 — Diagnostic Overlay (Error Visualization)

**Goal**: When Errors mode is active, render the shader through a diagnostic-aware path that visually highlights error pixels on the canvas.

### 6a. Diagnostic Overlay Rendering

Port of FragCoord's `dl()` function — a variant of the render function `Kg()` that accepts a `diagnosticOverlay` option:

```typescript
/**
 * Render shader with optional diagnostic overlay.
 * When diagnosticOverlay is set, the shader source builder (XC equivalent)
 * injects additional code for error visualization.
 *
 * Port of dl(gl, canvas, source, uniforms, fbo, w, h, ..., options).
 */
function renderWithDiagnostics(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  source: string,
  uniforms: Uniforms,
  options: {
    diagnosticOverlay?: boolean
    scissor?: { x: number; y: number; width: number; height: number }
  }
): RenderResult {
  const fullSource = buildShaderSource(source, passCount, options.diagnosticOverlay)
  return compileAndRender(gl, canvas, fullSource, uniforms, options)
}
```

The diagnostic overlay modifies the shader source builder (`XC()` equivalent) to inject error-checking code that colors NaN pixels red, Inf pixels green, and OOR pixels yellow — overlaid on the original output.

### 6b. Toggle Integration

The diagnostic overlay is toggled from the Errors tab:

```typescript
// Inspector Panel → Extension Host → Preview:
{ command: 'setDiagnosticOverlay', enabled: boolean }
```

### Deliverable
- Error pixels visually highlighted on the preview canvas
- NaN = red, Inf = green, OOR = yellow overlay
- Toggled from the Errors tab in the inspector panel

---

# Implementation Order (Recommended)

| Step | Phase | Feature | Depends On | Standalone? |
|------|-------|---------|------------|-------------|
| 1 | **Phase 0** (from Inspect plan) | Panel scaffold + IPC | Nothing | ✅ Yes |
| 2 | **Phase 1** | Compile error → VSCode Diagnostics | Nothing (uses existing compile) | ✅ Yes |
| 3 | **Phase 2** | NaN/Inf/OOR pixel scanning | Phase 0 (for IPC) | ✅ Core detection |
| 4 | **Phase 3** | Status bar + Errors tab UI | Phase 1 + Phase 2 | ✅ First visible result |
| 5 | **Phase 4** | Shader analysis warnings | Nothing (pure analysis) | ✅ Yes (tests) |
| 6 | **Phase 6** | Diagnostic overlay | Phase 2 | Incremental |
| 7 | **Phase 5** | NaN probe helpers | Phase 2 + Phase 6 | Optional / Polish |

### Milestones

**M1 — "Compile errors in editor"** (Steps 1–2): Compile errors as VSCode Diagnostics  
**M2 — "Runtime detection"** (Steps 3–4): NaN/Inf/OOR scanning + status bar + inspector panel  
**M3 — "Static analysis"** (Step 5): 9-category shader analysis warnings  
**M4 — "Full errors"** (Steps 6–7): Diagnostic overlay + per-expression NaN probe

### Parallelization

- **Phase 1** (compile errors) and **Phase 4** (shader analysis) have zero dependencies on each other → can be developed in parallel
- **Phase 4** is pure TypeScript analysis — fully unit-testable without any webview infrastructure
- **Phase 2** (NaN/Inf scanning) can be developed in parallel with Phases 1 and 4

---

# Conventions & Constraints

### TypeScript
- All new source in TypeScript
- Shader analysis engine: `src/inspector/errors/` — pure logic, no GL dependency
- NaN probe module: `src/inspector/errors/` — webview-side, webpack-bundled
- Follow existing project style (2-space indent, single quotes, no semicolons)

### Architecture Alignment
- Compile errors: supplement existing `DefaultErrorsExtension`, don't replace
- Diagnostics: use single `DiagnosticCollection` (`'shader-toy'`), merge compile + analysis
- Float FBO helper: shared module in `src/inspector/shared/`
- IPC messages through `ShaderToyManager` hub
- Status bar item: standard VSCode API, right-aligned

### Shader Source Handling
- Analysis runs on raw user source (before preamble injection)
- Compile error line offset corrected using `WEBGL2_EXTRA_SHADER_LINES` + pass count
- `_npR()` overloads injected before `main()` in probe variant only

### Testing
- Shader analysis: unit tests with known-dangerous shader snippets
- Compile error parser: unit tests with sample `getShaderInfoLog` output
- NaN/Inf scanner: unit tests with synthetic Float32Array data
- Visual verification: manual with demo shaders that produce NaN/Inf
- Run existing tests: `npm run test`

### Build
- `npm run webpack` for development build
- `npm run compile` for TypeScript check

---

# Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| `EXT_color_buffer_float` not available | Can't detect NaN/Inf (UNSIGNED_BYTE clamps them) | Feature-gate NaN probe; fall back to OOR-only detection |
| Shader analysis false positives (e.g., `1.0/x` where x is always positive) | Noisy warnings annoy users | Make analysis warnings opt-in; add "suppress" comment syntax |
| Float FBO readback is slow | Impacts render performance every 60 frames | 32×32 resolution = 1024 pixels = 16KB readback — negligible |
| Compile error line offset wrong for `#include` files | Errors point to wrong line | Use existing `#line` directive system for offset tracking |
| Diagnostic overlay compile error | Overlay shader variant fails on some GPUs | Graceful fallback: disable overlay, show errors in panel only |
| DiagnosticCollection conflicts with other extensions | Doubled error markers | Use unique source identifier (`'shader-toy'`); clear on document close |
| Large shaders slow down analysis | Editor feels laggy on save | 500ms debounce; consider web worker for analysis if > 50ms |
| `_npR()` overloads conflict with user code | Compile error | Use highly unlikely prefix (`_stNpR`); check for name collision |

---

# Cross-Reference to FragCoord Source Files

| Feature Area | FragCoord v0.7.1 Function | Snippet File |
|-------------|--------------------------|-------------|
| Compile error parsing | `getShaderInfoLog` parser | `071_getShaderInfoLog_L102.txt` |
| Shader compilation + cache | `Xd()` | `071_shader_compile_Xd.txt` |
| Line offset computation | `ZC()` | `071_shader_compile_Xd.txt` |
| Shader source builder | `XC()` | `071_shader_compile_Xd.txt` |
| NaN/Inf/OOR pixel scanning | L2058 render callback | `071_nan_inf_oor_full.txt` |
| Float FBO helper | `Ku()`/`yd()` | `071_nan_inf_oor_full.txt`, `071_webgl_engine.txt` |
| Pixel readback | `Hg()` | `071_webgl_engine.txt` |
| Shader analysis (9 categories) | `Mj()` | `071_shader_warnings_full.txt` |
| Comment stripper | `kj()` | `071_shader_warnings_full.txt` |
| Position utility | `i2()` | `071_shader_warnings_full.txt` |
| Constant checker | Inner `Mj()` (confusingly same name) | `071_shader_warnings_full.txt` |
| Paren matcher | `Rj()` | `071_shader_warnings_full.txt` |
| NaN probe helpers | `_npR` overloads (`fb[]`) | `071_nan_probe_full.txt` |
| Probe shader rewriting | `Lj()` | `071_nan_probe_full.txt` |
| Warning category metadata | `Sm` object | `071_shader_warnings_full.txt` |
| Diagnostic overlay render | `dl()` | `071_diagnostic_overlay_render.txt` |
| Diagnostic overlay viewport | L2058 `B4`/`V6` integration | `071_diagnostic_overlay_viewport.txt` |
| Error panel UI | React component | `071_error_panel_ui.txt` |
| Error CSS | `.error-*` rules | `071_error_css.txt` |
| Render function | `Kg()` | `071_gpu_timer_query.txt` |
