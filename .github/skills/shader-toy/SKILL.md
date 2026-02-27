---
name: shader-toy
description: Reference skill for the shader-toy VSCode extension with directives, workflows, and debugging guidance for GLSL preview, multipass rendering, and audio input.
---

# Shader Toy — VSCode Extension Skill Document

> Source-verified capability map for the `shader-toy` VSCode extension (v0.11.4).
> Repository: `stevensona/shader-toy`
> Verified against: branch `wip1#fragcoord`, 2026-02-27

---

## 1. Overview

**What it is:** A Visual Studio Code extension that provides a live WebGL/WebGL2 preview of GLSL fragment shaders in a side-panel webview, analogous to [shadertoy.com](https://shadertoy.com).

**Key metrics:** 76 TypeScript source files (~6,227 lines), 62 `WebviewExtension` implementations, 7 webview runtime JS modules, 9 test suites, 28 demo shaders.

**User personas:**
- Shader authors prototyping visual effects (raymarching, SDFs, procedural textures)
- Educators and students learning real-time graphics

**Primary workflows:**
1. Open a `.glsl` file → run "Shader Toy: Show GLSL Preview" → live-edit with hot reload
2. Multi-pass rendering via `#iChannel` cross-referencing between `.glsl` files
3. Audio FFT/waveform visualization via `#iChannel` audio input (experimental)
4. Screenshot / video recording of shader output
5. Export portable standalone HTML preview

---

## 2. Build & Tooling

| Command | Purpose |
|---------|---------|
| `npm run webpack` | Development build → `dist/extension.js` |
| `npm run compile` | TypeScript only → `out/` (used by tests) |
| `npm run watch` | tsc watch mode |
| `npm run webpack-dev` | webpack watch mode |
| `npm run test` | Pretest (compile) → `node out/test/run_tests.js` (VS Code instance) |
| `npm run format` | eslint --fix on `src/**` |
| `npm run deploy` | `vsce publish` |

**Webpack:** Single entry `src/extension.ts` → `dist/extension.js`, `commonjs2` library target, `node` platform. Only TypeScript sources are bundled.

**Resources are NOT bundled** — `resources/` (HTML template, JS modules, images, libs) are loaded at runtime from the extension path via `context.getResourceUri()`. This is important: any new runtime asset must go in `resources/` and be referenced through the URI resolution chain.

**TypeScript:** `target: es6`, `module: commonjs`, `strict: true`, `outDir: out`. No path aliases.

---

## 3. Session / Project File Format

There is no dedicated project file. A shader session is defined implicitly by:

| Aspect | Mechanism |
|--------|-----------|
| Entry point | The `.glsl` file currently open in the active editor |
| Dependencies | `#iChannelN`, `#include`, `#iVertex` directives in shader source |
| Configuration | `shader-toy.*` settings in VSCode `settings.json` (workspace or user) |
| Texture assets | Local files (`file://…`), remote URLs (`https://…`), or buffer references (`"self"`, other `.glsl` files) |

The extension parses the shader tree on every preview open / reload. There is no intermediate serialization format.

---

## 4. Object / Item Model

### 4.1 BufferDefinition (core data model)

Every parsed shader file becomes a `BufferDefinition`. Source: `src/typenames.ts`.

| Property | Type | Description |
|----------|------|-------------|
| `Name` | `string` | Unique name derived from file path |
| `File` | `string` | Absolute file path |
| `Code` | `string` | Transformed GLSL source (includes inlined, directives stripped) |
| `VertexFile` | `string?` | Path to vertex shader if `#iVertex` used |
| `VertexCode` | `string?` | Transformed vertex shader source |
| `VertexLineOffset` | `number?` | Line offset for error mapping |
| `TextureInputs` | `TextureDefinition[]` | Resolved texture/buffer channel bindings |
| `AudioInputs` | `AudioDefinition[]` | Resolved audio channel bindings |
| `CustomUniforms` | `UniformDefinition[]` | `#iUniform` declarations |
| `UsesSelf` | `boolean` | Whether the buffer reads its own previous frame |
| `SelfChannel` | `number` | Channel index for self-feedback (-1 if none) |
| `Dependents` | `BufferDependency[]` | Other buffers that read from this one |
| `LineOffset` | `number` | Cumulative line offset for error remapping |
| `Includes` | `IncludeDefinition[]` | Inlined include files |
| `UsesKeyboard` | `boolean?` | True if `#iKeyboard` is declared |
| `UsesFirstPersonControls` | `boolean?` | True if `#iFirstPersonControls` is declared |

### 4.2 TextureDefinition

| Property | Type | Description |
|----------|------|-------------|
| `Channel` | `number` | iChannel index (0–9) |
| `File` | `string` | Source file path |
| `Buffer` | `string?` | Name of referenced buffer (for multi-pass) |
| `BufferIndex` | `number?` | Index into buffers array |
| `LocalTexture` | `string?` | Resolved local file path |
| `RemoteTexture` | `string?` | Remote URL |
| `Self` | `boolean?` | Self-feedback reference |
| `Mag` | `TextureMagFilter?` | Magnification filter |
| `Min` | `TextureMinFilter?` | Minification filter |
| `Wrap` | `TextureWrapMode?` | Wrap mode |
| `Type` | `TextureType?` | `Texture2D` or `CubeMap` |

### 4.3 AudioDefinition

| Property | Type | Description |
|----------|------|-------------|
| `Channel` | `number` | iChannel index |
| `LocalPath` | `string?` | Local audio file path |
| `RemotePath` | `string?` | Remote audio URL |
| `UserPath` | `string` | Original user-specified path |

### 4.4 UniformDefinition

| Property | Type | Description |
|----------|------|-------------|
| `Name` | `string` | GLSL variable name |
| `Typename` | `string` | GLSL type (`float`, `vec2`, `vec3`, `vec4`, `int`, `ivec2`–`ivec4`, `color3`) |
| `Default` | `number[]?` | Default value(s) |
| `Min` | `number[]?` | Range minimum |
| `Max` | `number[]?` | Range maximum |
| `Step` | `number[]?` | Slider increment (defaults to 1.0 for integer types) |

### 4.5 IncludeDefinition

| Property | Type | Description |
|----------|------|-------------|
| `Name` | `string` | Unique name from file path |
| `File` | `string` | Absolute file path |
| `Code` | `string` | Transformed include source |
| `LineCount` | `number` | Number of lines in transformed code |

---

## 5. Enums & Allowed Values

### 5.1 TextureMagFilter
Source: `src/typenames.ts`

| Value | Description |
|-------|-------------|
| `Linear` | Bilinear filtering (default) |
| `Nearest` | Nearest-neighbor filtering |

### 5.2 TextureMinFilter

| Value | Description |
|-------|-------------|
| `Nearest` | Nearest-neighbor |
| `NearestMipMapNearest` | Nearest with nearest mipmap |
| `NearestMipMapLinear` | Nearest with linear mipmap |
| `Linear` | Bilinear (default) |
| `LinearMipMapNearest` | Linear with nearest mipmap |
| `LinearMipMapLinear` | Trilinear filtering |

> Many mipmap options require power-of-two texture dimensions (WebGL constraint).

### 5.3 TextureWrapMode

| Value | Description |
|-------|-------------|
| `Repeat` | Tile (default, matches shadertoy.com) |
| `Clamp` | Clamp to edge |
| `Mirror` | Mirror repeat |

### 5.4 TextureType

| Value | Description |
|-------|-------------|
| `Texture2D` | Standard 2D texture (default) |
| `CubeMap` | Cubemap (requires `{}` wildcard in path) |

### 5.5 Cubemap Face Resolution Sets
Tried in order until all 6 faces resolve:

| Set | Faces |
|-----|-------|
| Short letters | `e`, `w`, `u`, `d`, `n`, `s` |
| Full words | `east`, `west`, `up`, `down`, `north`, `south` |
| OpenGL short | `px`, `nx`, `py`, `ny`, `pz`, `nz` |
| OpenGL long | `posx`, `negx`, `posy`, `negy`, `posz`, `negz` |

### 5.6 Custom Uniform Types (Lexer)
Source: `src/shaderlexer.ts`

| Type | GUI Control |
|------|-------------|
| `float` | Slider (with range) or text field |
| `vec2` | Two text fields / sliders |
| `vec3` | Three text fields / sliders |
| `vec4` | Four text fields / sliders |
| `int` | Slider with step=1 |
| `ivec2` | Two integer fields |
| `ivec3` | Three integer fields |
| `ivec4` | Four integer fields |
| `color3` | Color picker (RGB, values normalized to 0–1) |

### 5.7 WebGL Version Setting

| Value | Behavior |
|-------|----------|
| `Default` | Prefers WebGL2, falls back to WebGL1 |
| `WebGL2` | Requires WebGL2; enables GLSL ES 3.00, `#iVertex` |

### 5.8 Recording Codecs

| Value |
|-------|
| `vp8` (default) |
| `vp9` |
| `h264` |
| `avc1` |

### 5.9 Offline Recording Formats

| Value | Description |
|-------|-------------|
| `webm` | Video file (default) |
| `gif` | Animated GIF |
| `png` | PNG frames in .tar archive |
| `jpg` | JPEG frames in .tar archive |

---

## 6. Evaluation / Execution Pipeline

### 6.1 Extension Host Architecture

**Entry point:** `src/extension.ts` → `activate(extensionContext)`

1. Version check → show update notification if version bumped
2. Create `Context` (wraps `ExtensionContext` + `WorkspaceConfiguration`)
3. Create `ShaderToyManager` (singleton orchestrator)
4. Register document-change callbacks (debounced by `reloadOnEditTextDelay` seconds)
5. Register save/editor-change callbacks
6. Register configuration-change handler (recreates `Context`, migrates manager)
7. Register 5 commands → push to `extensionContext.subscriptions`

**Context facade** (`src/context.ts`):
- **Resource URI resolution:** `getResourceUri(file)` → `extensions/<extensionPath>/resources/<file>`
- **Webview URI translation:** `makeWebviewResource(webview, uri)` → `webview.asWebviewUri(uri)`
- **User path mapping:** `mapUserPath(userPath, sourcePath)` — 3-tier priority: absolute → relative-to-source → workspace-folder-relative. Supports cubemap wildcards (`{}`, `*`).
- **Diagnostics:** `showDiagnostics(batch, severity)` → VS Code `DiagnosticCollection` keyed by `'shader-toy.errors'`
- **Error reveal:** `revealLine(file, line)` → opens document and scrolls to line
- **Config access:** `getConfig<T>(section)` → typed workspace configuration reader

**ShaderToyManager** (`src/shadertoymanager.ts`) — Central hub:

| Panel Type | Field | Behavior |
|-----------|-------|---------|
| Dynamic | `webviewPanel: Webview` | Singleton. Tracks `context.activeEditor`. Disposed & recreated on each `showDynamicPreview()`. |
| Static | `staticWebviews: StaticWebview[]` | Array. Each pinned to a specific `Document`. One-per-document dedup. |

**`updateWebview()` flow** (core update path):
1. Clear diagnostics
2. Create `WebviewContentProvider` with current document text
3. `parseShaderTree()` → returns local resource paths
4. Compute `localResourceRoots` from texture/audio file paths
5. If resource roots changed → recreate `WebviewPanel` (VSCode requires roots at creation time)
6. `generateWebviewContent()` → assemble full HTML
7. Set `webview.html = content`

**State persistence:** `RenderStartingData` (in `typenames.ts`) tracks pause, time, mouse, normalized mouse, keys, fly control transform, and uniform GUI state. Reported back from webview via IPC and re-injected on reload.

### 6.2 Shader Parsing Pipeline

```
.glsl file (active editor)
  ↓
BufferProvider.parseShaderCode()
  ├─ ShaderParser (lexer + parser) extracts directives
  │   ├─ #include → inline expand with #line directives
  │   ├─ #iChannelN → TextureDefinition / AudioDefinition
  │   ├─ #iVertex → link vertex shader file
  │   ├─ #iUniform → UniformDefinition
  │   ├─ #iKeyboard → flag
  │   ├─ #iFirstPersonControls → flag
  │   └─ #StrictCompatibility → flag
  ├─ Strips directives from code (in-place via ShaderStream.mutate())
  ├─ Detects entry point: main() vs mainImage()
  ├─ Generates mainImage→main wrapper if needed
  ├─ Optional glslify transform
  └─ Pushes BufferDefinition into buffers[]
       ↓
  Recursively parses #iChannel dependencies (other .glsl files)
       ↓
  Resolves buffer cross-references and self-feedback
  Adds final-blit pass if last buffer uses self
```

**Parsing layers:**
- **`ShaderStream`** (`src/shaderstream.ts`): Character-level stream with `mutate(begin, end, source)` for in-place text replacement. Tracks mutation ranges for `originalLine()` remapping.
- **`ShaderLexer`** (`src/shaderlexer.ts`): Tokenizer for directives. Recognizes `::` as single token (for `#iChannel0::MagFilter`). Tracks `LineRange` (begin/end positions) for directive removal.
- **`ShaderParser`** (`src/shaderparser.ts`): Recursive descent parser. Dispatches to type-specific parsers: `getInclude()`, `getVertex()`, `getTextureObject()`, `getUniformObject()`. Uniform parsing is the most complex — handles typed constructors, range arrays, step values, type assignability.
- **`BufferProvider`** (`src/bufferprovider.ts`, ~843 lines): Orchestrates the complete shader-to-buffer transformation. Standalone vertex shader detection heuristic: checks for `gl_Position`/`gl_VertexID`/`gl_InstanceID`/`gl_PointSize` WITHOUT `mainImage`/`gl_FragCoord`/`gl_FragColor`/`GLSL_FRAGCOLOR`.

**Final-blit pass:** If the last buffer reads itself (`#iChannel0 "self"`), WebGL can't ping-pong the screen buffer, so a synthetic `final-blit` pass is appended that copies the buffer's feedback texture to screen via `texture2D(iChannel0, gl_FragCoord.xy / iResolution.xy)`.

### 6.3 Webview Content Assembly

**Template-driven architecture:** The webview HTML starts from `resources/webview_base.html` (~710 lines assembled). Extensions inject/replace content at specific comment/placeholder lines.

**`WebviewContentAssembler`** (`src/webviewcontentassembler.ts`):

| Injection Mode | Method | Behavior |
|---------------|--------|---------|
| **Insert** | `addWebviewModule(ext, originalLine)` | Appends `ext.generateContent()` **after** the matching template line |
| **Replace** | `addReplaceModule(ext, originalLine, replaceContent)` | Replaces `replaceContent` **within** the matching template line |

On construction, builds `Map<string, number[]>` from trimmed template lines → line numbers. Modules stored in descending-line-number order; applied during `assembleWebviewContent()`.

**`WebviewContentProvider`** (`src/webviewcontentprovider.ts`, ~520 lines) — The wiring harness. Assembly order:

| Phase | Extensions | Template Target |
|-------|-----------|----------------|
| Initial State | `InitialTime`, `InitialPaused`, `InitialMouse`, `InitialNormalizedMouse`, `InitialFlyControlPosition`, `InitialFlyControlRotation` | `<!-- Start Time -->` etc. (replace) |
| Aspect Ratio | `ForcedAspect` | `<!-- Forced Aspect -->` (replace) |
| GLSL Version | `GlslVersion` | `<!-- GLSL Version -->` (replace) |
| WebGL2 Constants | `Webgl2ExtraShaderLines` | `<!-- WebGL2 Extra Shader Lines -->` (replace) |
| Keyboard | `KeyboardInit`, `KeyboardUpdate`, `KeyboardCallbacks`, `KeyboardShader` | `// Keyboard Init` etc. (insert) |
| Preamble | `ShaderPreamble` + optional `UniformsPreamble` | `<!-- Preamble Line Numbers -->` (replace) |
| Custom Uniforms | `UniformsInit`, `UniformsUpdate`, `DatGui` | `// Uniforms Init` etc. (insert) |
| Line Offset Fixup | (computed from preamble + keyboard line counts) | N/A (modifies buffers in-place) |
| Buffers | `BuffersInit` | `// Buffers` (insert) |
| Shaders | `Shaders` (+ `Includes`) | `<!-- Shaders -->` (insert) |
| FlyControls | `ThreeFlyControls` | `<!-- FlyControls -->` (insert) |
| Includes | `IncludesInit`, `IncludesTestCompile` | `// Includes`, `// Test Compile Included Files` (insert) |
| Textures | `TexturesInit` | `// Texture Init` (insert) |
| Audio | `AudioInit` / `NoAudio`, `AudioUpdate`, `AudioPause`, `AudioResume` | `// Audio Init` etc. (insert) |
| Packages | `JQuery`, `Three`, webview runtime modules × 7 | `<!-- JQuery.js -->` etc. (replace) |
| Self Source ID | `SelfSourceId` | `<!-- Self Source Id -->` (replace) |
| Stats | `Stats` (conditional) | `<!-- Stats.js -->` (insert) |
| CCapture | `CCapture` (conditional) | `<!-- CCapture.js -->` (insert) |
| Pause | `PauseButtonStyle`, `PauseButton`, `PauseWholeRender` / `AdvanceTime` | style/element/logic placeholders |
| Screenshot/Record | `ScreenshotButton/Style`, `RecordButton/Style`, resolution/framerate/codec extensions | various placeholders |
| Reload | `ReloadButtonStyle`, `ReloadButton` (when auto-reload disabled) | `<!-- Reload Element -->` etc. |
| Error Handling | `IvertexErrorRewrite` (WebGL2 only), `GlslifyErrors` / `DiagnosticsErrors` / `DefaultErrors` | `// Error Callback` (insert) |

### 6.4 Rendering Loop (webview)

The render loop lives in an inline `<script>` block of `webview_base.html`:

```
render() → requestAnimationFrame(render)
  ├── Pause check (whole render or time-only)
  ├── Advance time (delta from THREE.Clock)
  ├── Update date uniform (iDate)
  ├── Update fly controls
  ├── Audio texture update (FFT + waveform)
  ├── For each buffer (in dependency order):
  │     ├── Set uniforms (iResolution, iTime, iTimeDelta, iFrame, iMouse, iMouseButton, iViewMatrix, iChannelResolution)
  │     ├── Set quad material = buffer.Shader
  │     ├── Set render target = buffer.Target (or screen for last pass)
  │     └── renderer.render(scene, camera)
  ├── Update custom uniform values
  ├── Update keyboard texture
  ├── Release mouse click (negate z/w)
  ├── Ping-pong buffer swap (for self-feedback buffers)
  ├── Offline recording capture (if active)
  └── Increment frameCounter
```

**THREE.js setup:** Orthographic camera, full-screen quad mesh, `ShaderMaterial` per buffer, `WebGLRenderTarget` per non-final buffer.

**Resolution handling:** `computeSize()` computes forced aspect ratio, centers canvas, resizes all render targets, resets `frameCounter` on window resize.

### 6.5 Shader Compilation Flow

1. **Source embedding:** `ShadersExtension` creates `<script id="bufferName" type="x-shader/x-fragment">` elements containing preamble + keyboard preamble + `#line 1 0` + user code.
2. **Source extraction:** `BuffersInitExtension` generates JS that reads `document.getElementById(name).textContent` and passes through `prepareFragmentShader()`.
3. **`prepareFragmentShader()` (in `shader_compile.js`):** WebGL2: prepends `#ifdef gl_FragColor` block, `layout(location=0) out highp vec4`, `#define texture2D texture`. WebGL1: prepends `#define GLSL_FRAGCOLOR gl_FragColor`.
4. **THREE.js compilation:** `new THREE.ShaderMaterial({ fragmentShader: ..., glslVersion: THREE.GLSL3 })` compiles the shader. Errors surface through `console.error` which is monkey-patched by the error display extension.
5. **Test compilation:** Each buffer is rendered once during initialization. Failed buffers tracked in `failedBufferNames` and skipped in the render loop.
6. **Include compilation:** If `testCompileIncludedFiles` is enabled, includes are compiled via `compileIncludeFragment()` which wraps source in a `void main() {}` stub.

**Line offset formula:**
```
buffer.LineOffset = ShaderPreamble.lineCount + 107 (THREE.js wrapper)
                    + [keyboardShader.lineCount if UsesKeyboard]
                    + [2 + WEBGL2_EXTRA_SHADER_LINES(16) if WebGL2]
```

### 6.6 Hot Reload

On document change (after configurable delay) or save:
1. Re-parse entire shader tree
2. If webview resource roots unchanged → post `hotReload` message with payload
3. Payload contains: new shader HTML, new include HTML, init script, preserved state (time, mouse, camera)
4. Webview replaces `<textarea>` nodes, re-runs init script, recompiles shaders
5. If resource roots changed → **full webview teardown and recreation** (VSCode requires resource roots at panel creation time)

### 6.7 Runtime Modules (`resources/webview/`)

Seven JS modules loaded as separate `<script>` tags, each wrapping into `window.ShaderToy.*`:

| Module | Namespace | Responsibility |
|--------|-----------|---------------|
| `runtime_env.js` | `ShaderToy.env` | VS Code API acquisition, global error/unhandledrejection handlers |
| `glsl_error_hook.js` | `ShaderToy.glslError` | Pluggable error rewriter registry (`registerRewriter`/`rewrite`) |
| `shader_compile.js` | `ShaderToy.shaderCompile` | `#line` normalization, fragment/vertex/include shader compilation helpers, WebGL2 `#version 300 es` header injection |
| `gl_context.js` | `ShaderToy.gl` | WebGL2/WebGL1 context acquisition with fallback |
| `ui_controls.js` | `ShaderToy.ui` | **Placeholder** (empty, reserved for future UI wiring) |
| `time_input.js` | `ShaderToy.timeInput` | **Placeholder** (empty, reserved for future clock/input handling) |
| `render_loop.js` | `ShaderToy.renderLoop` | **Placeholder** (empty, reserved for future render loop extraction) |

**Module pattern:** All use IIFE wrapping `(function(global) { ... })(typeof window !== 'undefined' ? window : globalThis)`.

**Standalone mode:** `WebviewModuleScriptExtension` can inline module source directly for portable HTML previews instead of `<script src="...">` tags.

---

## 7. Scripting / API Surface

### 7.1 Shader Directives (Preprocessor)

| Directive | Syntax | Description |
|-----------|--------|-------------|
| `#iChannelN` | `#iChannel0 "path"` | Bind texture/buffer/audio to channel N (0–9) |
| `#iChannelN::MagFilter` | `#iChannel0::MagFilter "Nearest"` | Set magnification filter |
| `#iChannelN::MinFilter` | `#iChannel0::MinFilter "LinearMipMapLinear"` | Set minification filter |
| `#iChannelN::WrapMode` | `#iChannel0::WrapMode "Repeat"` | Set wrap mode |
| `#iChannelN::Type` | `#iChannel0::Type "CubeMap"` | Set texture type |
| `#include` | `#include "path.glsl"` | Inline include (recursive, with `#line` remapping) |
| `#iVertex` | `#iVertex "vertex.glsl"` | Attach vertex shader (WebGL2 only) |
| `#iUniform` | `#iUniform float x = 1.0 in {0.0, 5.0} step 0.1` | Custom uniform with GUI |
| `#iKeyboard` | `#iKeyboard` | Enable keyboard input functions |
| `#iFirstPersonControls` | `#iFirstPersonControls` | Enable fly camera + `iViewMatrix` |
| `#StrictCompatibility` | `#StrictCompatibility` | Force shadertoy.com compatibility mode |

### 7.2 Built-in Uniforms (Shader Preamble)

Source: `src/extensions/preamble_extension.ts`

| Uniform | Type | Description |
|---------|------|-------------|
| `iResolution` | `vec3` | Viewport resolution (x=width, y=height, z=1.0) |
| `iTime` | `float` | Elapsed time in seconds |
| `iTimeDelta` | `float` | Time since last frame in seconds |
| `iFrame` | `int` | Frame counter (starts at 0) |
| `iDate` | `vec4` | (year, month, day, seconds_in_day) |
| `iMouse` | `vec4` | Mouse state (xy=current pos, zw=click pos; shadertoy.com semantics) |
| `iMouseButton` | `vec4` | (x=left_button, y=right_button, 0=up/1=down) |
| `iViewMatrix` | `mat4` | Camera view matrix (identity unless `#iFirstPersonControls`) |
| `iChannel0`–`iChannel9` | `sampler2D` | Texture channels |
| `iChannelResolution[10]` | `vec3[]` | Per-channel resolution |
| `iKeyboard` | `sampler2D` | 256×4 keyboard state texture |
| `iSampleRate` | `float` | Audio context sample rate (0 if no audio) |

**Aliases:**
- `iGlobalTime` → `iTime`
- `iGlobalFrame` → `iFrame`

**Preprocessor define:** `SHADER_TOY` is always defined.

### 7.3 Shader Entry Points

| Entry Point | Signature | Context |
|-------------|-----------|---------|
| `void main()` | Standard GLSL entry | Default fragment shader |
| `void mainImage(out vec4 fragColor, in vec2 fragCoord)` | Shadertoy.com compatible | Auto-wrapped with `void main()` |

Detection: `mainImage()` is found via regex `/void\s+mainImage\s*\(\s*out\s+vec4\s+\w+,\s*(in\s)?\s*vec2\s+\w+\s*\)\s*\{/g`. If no `void main()` exists but `mainImage()` is found, a wrapper is auto-generated.

### 7.4 Keyboard API (GLSL)

Enabled via `#iKeyboard`. Source: `src/extensions/keyboard/keyboard_shader_extension.ts`

**Functions:**
```glsl
bool isKeyDown(int key);      // Currently held
bool isKeyPressed(int key);   // Just pressed this frame
bool isKeyToggled(int key);   // Toggle state
bool isKeyReleased(int key);  // Just released this frame
```

**Key constants (partial list):**
`Key_A`–`Key_Z`, `Key_0`–`Key_9`, `Key_F1`–`Key_F12`,
`Key_Backspace`, `Key_Tab`, `Key_Enter`, `Key_Shift`, `Key_Ctrl`, `Key_Alt`,
`Key_Escape`, `Key_PageUp`, `Key_PageDown`, `Key_Home`, `Key_End`,
`Key_LeftArrow`, `Key_UpArrow`, `Key_RightArrow`, `Key_DownArrow`,
`Key_Insert`, `Key_Delete`, `Key_Pause`, `Key_Caps`,
`Key_Numpad0`–`Key_Numpad9`, `Key_NumpadMultiply`, `Key_NumpadAdd`, `Key_NumpadSubtract`, `Key_NumpadPeriod`, `Key_NumpadDivide`,
`Key_SemiColon`, `Key_Equal`, `Key_Comma`, `Key_Dash`, `Key_Period`,
`Key_ForwardSlash`, `Key_GraveAccent`, `Key_OpenBracket`, `Key_BackSlash`, `Key_CloseBraket`, `Key_SingleQuote`,
`Key_NumLock`, `Key_ScrollLock`, `Key_LeftWindow`, `Key_RightWindows`, `Key_Select`

Keyboard texture layout: 256 pixels wide × 4 rows. Row 0=held, Row 1=pressed, Row 2=toggled, Row 3=released.

### 7.5 First-Person Controls

Enabled via `#iFirstPersonControls`. Populates `iViewMatrix` uniform.

| Key | Action |
|-----|--------|
| W/A/S/D | Move forward/left/back/right |
| R / F | Move up / down |
| Q / E | Roll left / right |
| Up / Down | Pitch |
| Left / Right | Yaw |

---

## 8. Extensibility

### 8.1 Extension Architecture

Every piece of webview content is injected via `WebviewExtension`:

```typescript
export interface WebviewExtension {
    generateContent(): string;
}
```

**How to add a new extension:**
1. Create `src/extensions/my_feature_extension.ts` implementing `WebviewExtension`
2. Add a placeholder line in `resources/webview_base.html` (e.g., `// My Feature` or `<!-- My Feature -->`)
3. In `WebviewContentProvider.generateWebviewContent()`, instantiate and register:
   - Insert mode: `assembler.addWebviewModule(ext, '// My Feature')` — appends after line
   - Replace mode: `assembler.addReplaceModule(ext, 'let x = <!-- My Value -->;', '<!-- My Value -->')` — replaces token

### 8.2 Extension Categories

| Category | Extensions | Purpose |
|----------|-----------|---------|
| **Buffers** | `BuffersInitExtension`, `ShadersExtension`, `IncludesExtension`, `IncludesInitExtension`, `IncludesTestCompileExtension` | Buffer graph initialization, shader embedding |
| **Audio** | `AudioInitExtension`, `AudioUpdateExtension`, `AudioPauseExtension`, `AudioResumeExtension`, `NoAudioExtension` | Audio input pipeline (FFT + waveform textures) |
| **Keyboard** | `KeyboardInitExtension`, `KeyboardUpdateExtension`, `KeyboardCallbacksExtension`, `KeyboardShaderExtension` | Keyboard input and GLSL API |
| **Textures** | `TexturesInitExtension` | Texture/cubemap/DDS loading |
| **Uniforms** | `UniformsInitExtension`, `UniformsUpdateExtension`, `UniformsPreambleExtension` | Custom uniform GUI (dat.GUI) |
| **UI** | `PauseButtonExtension`, `ScreenshotButtonExtension`, `RecordButtonExtension`, `ReloadButtonExtension` + style extensions | Webview control buttons |
| **Packages** | `JQueryExtension`, `ThreeExtension`, `StatsExtension`, `DatGuiExtension`, `CCaptureExtension`, `ThreeFlyControlsExtension` | Third-party library injection |
| **Error Display** | `DefaultErrorsExtension`, `DiagnosticsErrorsExtension`, `GlslifyErrorsExtension`, `IvertexErrorRewriteExtension` | GLSL compile error handling |
| **State** | `InitialTimeExtension`, `InitialPausedExtension`, `InitialMouseExtension`, etc. | State preservation across reloads |

### 8.3 VSCode Extension Commands

Source: `package.json`

| Command ID | Title |
|-----------|-------|
| `shader-toy.showGlslPreview` | Shader Toy: Show GLSL Preview |
| `shader-toy.showStaticGlslPreview` | Shader Toy: Show Static GLSL Preview |
| `shader-toy.createPortableGlslPreview` | Shader Toy: Create Portable GLSL Preview |
| `shader-toy.pauseGlslPreviews` | Shader Toy: Pause/Play GLSL Previews |
| `shader-toy.saveGlslPreviewScreenShots` | Shader Toy: Save GLSL Preview Screenshots |

### 8.4 Webview ↔ Extension IPC Messages

**Extension → Webview:**

| Message | Payload | Purpose |
|---------|---------|---------|
| `pause` | — | Toggle pause state |
| `screenshot` | — | Capture current frame |
| `hotReload` | `HotReloadPayload` | Live shader update |

**Webview → Extension:**

| Message | Payload | Purpose |
|---------|---------|---------|
| `updateTime` | `{ time }` | Sync current time |
| `setPause` | `{ paused }` | Sync pause state |
| `updateMouse` | `{ mouse, normalizedMouse }` | Sync mouse state |
| `updateKeyboard` | `{ keys }` | Sync keyboard state |
| `updateFlyControlTransform` | `{ position, rotation }` | Sync camera |
| `updateUniformsGuiOpen` | `{ value }` | Sync GUI open state |
| `updateUniformsGuiValue` | `{ name, value }` | Sync uniform value |
| `reloadWebview` | — | Request full reload |
| `showGlslDiagnostic` | `{ diagnosticBatch, type }` | Push compile errors |
| `showGlslsError` | `{ file, line }` | Jump to error line |
| `errorMessage` | `{ message }` | Show error popup |
| `readDDSFile` | `{ requestId, file }` | Request DDS file read |
| `readDDSFileResult` | `{ requestId, ok, base64?, error? }` | DDS file response |

### 8.5 Extension Points (Existing)

| Extension Point | API | Purpose |
|----------------|-----|---------|
| `WebviewExtension` interface | `generateContent(): string` | Add any content to the webview template |
| `glslError.registerRewriter()` | `window.ShaderToy.glslError.registerRewriter(fn)` | Pluggable error line/message rewriting |
| `ShaderPreambleExtension.addPreambleExtension()` | Adds extra uniform declarations | Extend shader preamble |
| `TexturesInitExtension.addTextureContent()` | Adds extra texture loading code | Extend texture initialization |
| IPC `onDidReceiveMessage` | `message.command` dispatch | Handle new webview→host message types |

### 8.6 Architectural Gaps (for new feature development)

1. **No addon panel system:** Only preview panels exist. No infrastructure for auxiliary panels (inspector, heatmap, frames graph). Would need to be built.
2. **No shader rewriting pipeline:** Parser strips directives but doesn't transform GLSL code. Inspect/heatmap features require AST-level or regex-level shader rewriting.
3. **No float FBO readback:** Render pipeline uses THREE.js abstractions. Direct `gl.readPixels()` on float framebuffers would need raw WebGL alongside THREE.js.
4. **No GPU timer queries:** `EXT_disjoint_timer_query_webgl2` is unused. Performance profiling would need this.
5. **No gutter decoration API usage:** VS Code's `TextEditorDecorationType` is not used. Per-line annotations would need this.
6. **Render loop is not extensible:** Monolithic inline script. Inserting diagnostic renders requires template extension or using the placeholder modules.
7. **Three placeholder modules** (`ui_controls.js`, `time_input.js`, `render_loop.js`) are empty — designed as future extension points for exactly this kind of feature work.

---

## 9. Built-in Debugging / Diagnostics

### 9.1 GLSL Compile Errors

**Three error display modes** (mutually exclusive, selected by config):

1. **`DefaultErrorsExtension`** — In-webview error display only (HTML clickable error links)
2. **`DiagnosticsErrorsExtension`** — Same + forwards errors to VS Code diagnostics panel via IPC
3. **`GlslifyErrorsExtension`** — Simplified error display for glslify-transformed code (line numbers unreliable)

- Errors parsed from WebGL `getShaderInfoLog()` format: `ERROR: <sourceId>:<line>: <message>`
- All modes monkey-patch `console.error`, intercept THREE.js shader compilation errors
- Line numbers remapped through include expansion and preamble offsets
- `#line` directives with source IDs enable multi-file error attribution
- `SELF_SOURCE_ID = 65535` sentinel for current-file `#line` directives
- `WEBGL2_EXTRA_SHADER_LINES = 16` offset compensates for WebGL2 preamble
- Error rewriting hook: `glsl_error_hook.js` provides pluggable pipeline via `registerRewriter(fn)` — used by `IvertexErrorRewriteExtension`

### 9.2 Stats / Performance

- Stats.js frame time graph (configurable via `printShaderFrameTime`)
- Shader compile-time panel (`CT MS`) — custom Stats.js panel added during test-compile loop
- Positioned at bottom-left of viewport

### 9.3 Warnings

- Undefined texture channel usage (when `warnOnUndefinedTextures` enabled)
- Non-power-of-two texture dimensions
- Deprecated feature usage (unless `omitDeprecationWarnings`)
- glslify module resolution failures (with install suggestion)
- Vertex shader file opened as fragment shader (auto-detected)

---

## 10. Samples / Demos Catalogue

### 10.1 Visual Demos

| Demo | Features Used | Description |
|------|--------------|-------------|
| `plasma1.glsl` | `mainImage`, `iTime` | Animated plasma with iterative wave distortion |
| `metaballs.glsl` | `iMouse`, raymarching | 9 animated metaballs with soft shadows |
| `blobby.glsl` | `#include`, `mainImage` | Animated metaball-like blobs with rotation |
| `mouse.glsl` | `iMouse`, `mainImage` | Mouse position visualization (red cross + blue click) |
| `digital.glsl` | `iDate`, `mainImage` | Procedural 7-segment digital clock |
| `duck.glsl` | `#iChannel0` (texture), `iTime` | Water wave distortion on image |
| `frame.glsl` | `#define`, branchless GLSL | GPU-optimized branchless animation |
| `raymarcher_88.glsl` | `#StrictCompatibility` | Ultra-compact raymarcher (code golf) |

### 10.2 Texture / Buffer Demos

| Demo | Features Used | Description |
|------|--------------|-------------|
| `blending.glsl` | `#iChannel0`, `#iChannel1`, wrap modes | Alpha mask blending of two textures |
| `feedback.glsl` | `#iChannel0` (self), `iFrame`, `iTimeDelta` | Temporal feedback blur effect |
| `swirl_spin.glsl` | `#iChannel0` (self) | Rotating swirl with self-feedback |
| `bouncing.glsl` | `#iChannel0` (self), `iFrame` | Bouncing balls with persistent state in texture |
| `buffer_a.glsl` | `#iChannel0` (self) | Ball position storage/retrieval from texture |
| `multipass.glsl` | `#iChannel0`, `#iChannel1` | Multi-pass UV displacement composition |
| `uv-warp.glsl` | `#iChannel0`, `#iChannel1` | Texture-based UV remapping |

### 10.3 Cubemap Demo

| Demo | Features Used | Description |
|------|--------------|-------------|
| `cubemap.glsl` | `#iChannel0` (CubeMap), `#iChannel0::Type "CubeMap"` | 3D metaballs with cubemap environment reflection |

### 10.4 Input Demos

| Demo | Features Used | Description |
|------|--------------|-------------|
| `keyboard.glsl` | `#iKeyboard`, key state functions | Interactive key state visualization (circles) |
| `keyquest.glsl` | `#iKeyboard` | Text-based adventure game with keyboard navigation |
| `fly_controls.glsl` | `#iFirstPersonControls`, `iViewMatrix` | First-person SDF raymarching with fly camera |
| `audio.glsl` | `#iChannel0` (mp3 audio) | FFT spectrum + waveform visualization |

### 10.5 Custom Uniform Demos

| Demo | Features Used | Description |
|------|--------------|-------------|
| `dds_loader.glsl` | `#iChannel0/1` (DDS), `#iUniform float/color3` | LTC lookup table visualization |
| `ltc_quad.glsl` | `#iChannel0/1` (DDS), `#iUniform float/color3` | Physically-based area light with LTC |

### 10.6 WebGL2 / Vertex Shader Demos

| Demo | Features Used | Description |
|------|--------------|-------------|
| `webgl2_features.glsl` | WebGL2 builtins (`packHalf2x16`, etc.) | Pack/unpack function showcase |
| `webgl2_iVertexDemo.glsl` | `#iChannel0/1/2`, multi-pass | Composites background + two vertex shader passes |
| `vertex/pass1.glsl` | `#iVertex "pass1_iVertex.glsl"`, `in vec2 vUV` | Animated rings with custom triangle mesh |
| `vertex/pass1_iVertex.glsl` | `gl_VertexID`, `gl_Position` | Procedural triangle from vertex ID |
| `vertex/pass2.glsl` | `#iVertex "pass2_iVertex.glsl"`, `in vec2 vUV` | Striped pattern on custom triangle |
| `vertex/pass2_iVertex.glsl` | `gl_VertexID`, `gl_Position` | Second procedural triangle mesh |

### 10.7 Volumetric Demos

| Demo | Features Used | Description |
|------|--------------|-------------|
| `volume_points_0.glsl` | `#include`, `mainVolume` (custom) | 3D volumetric texture generator (2D storage) |
| `volume_points_1.glsl` | `#iChannel0`, `#iUniform`, volumetric sampling | Point cloud visualization with rotation |
| `volume_points_common.glsl` | Shared library | 3D texture packing, euler rotation, interpolation |

### 10.8 Shared Libraries

| File | Purpose |
|------|---------|
| `common/blobby.glsl` | `saturate`, `rotate` functions; includes `math-common.glsl` |
| `common/math-common.glsl` | `PI` constant |

### 10.9 Other Resources

| File | Type | Purpose |
|------|------|---------|
| `cubemap/*.jpg` | Image | Cubemap face textures (Yokohama panorama) |
| `lut/ltc_1.dds`, `lut/ltc_2.dds` | Binary | LTC lookup tables for area light shading |
| `horizon.jpg` | Image | Texture used by duck.glsl |
| `outfoxing.mp3` | Audio | Audio input for audio.glsl demo |
| `glslify.glsl` | GLSL | glslify module system demo (`#pragma glslify`) |

---

## 11. VSCode Configuration Settings (Complete)

Source: `package.json` contributes.configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `shader-toy.forceAspectRatio` | `[number, number]` | `[0, 0]` | Force rendering aspect ratio (0 = ignore) |
| `shader-toy.webglVersion` | `"Default"` \| `"WebGL2"` | `"Default"` | WebGL mode; WebGL2 enables GLSL 300 ES + `#iVertex` |
| `shader-toy.showCompileErrorsAsDiagnostics` | `boolean` | `true` | Show compile errors as VSCode diagnostics |
| `shader-toy.omitDeprecationWarnings` | `boolean` | `false` | Suppress deprecation warnings |
| `shader-toy.enableGlslifySupport` | `boolean` | `false` | Enable glslify transforms (disables line numbers) |
| `shader-toy.reloadAutomatically` | `boolean` | `true` | Master switch for auto-reload |
| `shader-toy.reloadOnEditText` | `boolean` | `true` | Reload on text change |
| `shader-toy.reloadOnEditTextDelay` | `number` | `1` | Delay (seconds) before reload after edit |
| `shader-toy.reloadOnChangeEditor` | `boolean` | `false` | Reload when switching editors |
| `shader-toy.reloadOnSaveFile` | `boolean` | `true` | Reload on file save |
| `shader-toy.resetStateOnChangeEditor` | `boolean` | `true` | Reset time/mouse/keyboard on editor change |
| `shader-toy.showScreenshotButton` | `boolean` | `true` | Show screenshot button in preview |
| `shader-toy.screenshotResolution` | `[number, number]` | `[0, 0]` | Custom screenshot resolution (0 = viewport) |
| `shader-toy.showRecordButton` | `boolean` | `true` | Show record button |
| `shader-toy.recordTargetFramerate` | `number` | `30` | Recording target FPS |
| `shader-toy.recordVideoContainer` | `string` | `"webm"` | Video container format |
| `shader-toy.recordVideoCodec` | `"vp8"` \| `"vp9"` \| `"h264"` \| `"avc1"` | `"vp8"` | Video codec |
| `shader-toy.recordVideoBitRate` | `number` | `2500000` | Video bit rate (bits/sec) |
| `shader-toy.recordMaxDuration` | `number` | `0` | Max recording duration (0 = unlimited) |
| `shader-toy.recordOffline` | `boolean` | `false` | Enable offline (frame-accurate) recording |
| `shader-toy.recordOfflineFormat` | `string` | `"webm"` | Offline format: webm, gif, png, jpg |
| `shader-toy.recordOfflineQuality` | `number` | `80` | Offline quality (0–100) |
| `shader-toy.showPauseButton` | `boolean` | `true` | Show pause button |
| `shader-toy.pauseWholeRender` | `boolean` | `true` | Pause everything vs. pause time only |
| `shader-toy.pauseMaintainedOnReload` | `boolean` | `false` | Maintain pause state across reloads |
| `shader-toy.printShaderFrameTime` | `boolean` | `true` | Show Stats.js frame time graph |
| `shader-toy.warnOnUndefinedTextures` | `boolean` | `true` | Warn on undefined iChannel usage |
| `shader-toy.enabledAudioInput` | `boolean` | `false` | Allow audio file inputs (experimental) |
| `shader-toy.audioDomainSize` | `number` | `512` | FFT domain size for audio textures |
| `shader-toy.testCompileIncludedFiles` | `boolean` | `true` | Compile included files separately |
| `shader-toy.shaderToyStrictCompatibility` | `boolean` | `false` | Force shadertoy.com-compatible mode |

---

## 12. Recipes / Playbooks

### 12.1 Fullscreen Fragment Shader

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    fragColor = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0);
}
```

### 12.2 Self-Feedback (Ping-Pong)

```glsl
#iChannel0 "self"
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec4 prev = texture2D(iChannel0, uv);
    fragColor = mix(prev, vec4(1.0, 0.0, 0.0, 1.0), 0.01);
}
```

### 12.3 Multi-Pass (Shader as Texture)

**pass_a.glsl:**
```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = vec4(sin(iTime), cos(iTime), 0.0, 1.0);
}
```

**main.glsl:**
```glsl
#iChannel0 "pass_a.glsl"
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    fragColor = texture2D(iChannel0, uv);
}
```

### 12.4 Texture Input with Sampling Options

```glsl
#iChannel0 "file://duck.png"
#iChannel0::MagFilter "Nearest"
#iChannel0::MinFilter "NearestMipMapNearest"
#iChannel0::WrapMode "Repeat"
```

### 12.5 Cubemap

```glsl
#iChannel0 "file://cubemaps/yokohama_{}.jpg"
#iChannel0::Type "CubeMap"
```

### 12.6 Custom Uniforms with GUI

```glsl
#iUniform float speed = 1.0 in { 0.0, 10.0 } step 0.1
#iUniform color3 tint = color3(1.0, 0.5, 0.2)
#iUniform vec2 offset = vec2(0.0, 0.0) in { -1.0, 1.0 }

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy + offset;
    fragColor = vec4(tint * (0.5 + 0.5 * sin(iTime * speed)), 1.0);
}
```

### 12.7 Vertex Shader (WebGL2)

**fragment.glsl:**
```glsl
#iVertex "vertex.glsl"
in vec2 vUV;
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = vec4(vUV, 0.0, 1.0);
}
```

**vertex.glsl:**
```glsl
out vec2 vUV;
void main() {
    int id = gl_VertexID;
    vUV = vec2(float(id & 1), float((id >> 1) & 1));
    gl_Position = vec4(vUV * 2.0 - 1.0, 0.0, 1.0);
}
```

### 12.8 Audio Input (Experimental)

Requires: `shader-toy.enabledAudioInput` = `true`

```glsl
#iChannel0 "file://./outfoxing.mp3"
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec4 amplitude = texture(iChannel0, vec2(uv.x, 0.25));
    vec4 frequency = texture(iChannel0, vec2(uv.x, 0.75));
    fragColor = vec4(amplitude.r, frequency.r, 0.0, 1.0);
}
```

Audio texture layout: Two rows — row 0 (y=0.25) = waveform, row 1 (y=0.75) = FFT spectrum. Values are grayscale 0–1.

### 12.9 Include Files

```glsl
// utils.glsl (no void main() allowed)
float saturate(float x) { return clamp(x, 0.0, 1.0); }

// main.glsl
#include "utils.glsl"
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = vec4(vec3(saturate(sin(iTime))), 1.0);
}
```

### 12.10 DDS Float Texture (LUT) Loading

```glsl
#iChannel0 "file://lut/ltc_1.dds"
#iChannel1 "file://lut/ltc_2.dds"
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec4 lut = texture2D(iChannel0, uv);
    fragColor = lut;
}
```
DDS files are loaded via extension-side file read (webview posts `readDDSFile` message, extension reads and returns base64).

---

## 13. Known Limits / Caveats

### 13.1 WebGL Constraints
- Mipmap filter options require power-of-two texture dimensions
- WebGL1 mode does not support `#iVertex` or GLSL ES 3.00 features
- Cubemap textures require exactly 6 faces matching one of the 4 naming conventions

### 13.2 Audio Constraints
- Audio input from files requires `enabledAudioInput` = true (disabled by default, experimental)
- Audio input does not work inside VSCode (requires standalone build with ffmpeg)
- Remote audio sources are currently broken (Electron limitation)

### 13.3 Shader Compatibility
- `void main()` detection uses regex: `/void\s+main\s*\(\s*\)\s*\{/g`
  - To define main() alongside extension's auto-generated one, use `void main(void)` signature
- `#StrictCompatibility` or `shaderToyStrictCompatibility` setting always generates mainImage wrapper
- `#version` directives are silently stripped (version is controlled by webglVersion setting)
- glslify support disables line number reporting for errors

### 13.4 Include System
- Include files must not define `void main()`
- Includes are inlined with `#line` directive remapping for error attribution
- Nested includes are supported
- Include files are optionally compiled separately (`testCompileIncludedFiles`)

### 13.5 Vertex Shaders
- Only available when `webglVersion` = `"WebGL2"`
- Must write to `gl_Position`
- Can declare `out` variables consumed by fragment shader as `in`
- `#iVertex "self"` is not supported; use `"default"` or a file path

### 13.6 Recording
- Real-time recording may drop frames on complex shaders
- Only `webm` container is currently supported for real-time recording
- Offline recording renders frame-by-frame (no drops) but is slower

### 13.7 Platform
- Static preview command opens a preview not tied to the active editor
- Hot reload preserves time, mouse, camera, keyboard, and uniform GUI state
- Portable preview export creates a standalone HTML file with inlined resources
- Three.js is used as the rendering abstraction layer (orthographic camera, fullscreen quad)

---

## 14. Key Constants & Sentinels

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `SELF_SOURCE_ID` | `65535` | `src/constants.ts` | `#line` source ID sentinel for "this file" — normalized to `0` for top-level, correct include ID for nested |
| `WEBGL2_EXTRA_SHADER_LINES` | `16` | `src/constants.ts` | Extra lines inserted by WebGL2 runtime (version, precision, compatibility shims) |
| `glslPlusThreeJsLineNumbers` | `107` | `webviewcontentprovider.ts:296` | THREE.js wrapper lines added before user shader code |
| `SHADER_TOY` | (define) | Shader preamble | Preprocessor define always available in user shaders |

## 15. Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Extension class | PascalCase + `Extension` suffix | `SelfSourceIdExtension` |
| Extension file | snake_case + `_extension.ts` | `self_source_id_extension.ts` |
| Template placeholder (HTML) | `<!-- Comment Name -->` | `<!-- Self Source Id -->` |
| Template placeholder (JS) | `// Comment Name` | `// Buffers` |
| IPC commands | camelCase strings | `updateUniformsGuiValue` |
| Config settings | camelCase under `shader-toy.*` | `shader-toy.reloadOnEditTextDelay` |
| Runtime JS namespace | `window.ShaderToy.*` | `window.ShaderToy.shaderCompile` |

## 16. Test Suite

| Test File | Coverage Area |
|-----------|--------------|
| `extension.test.ts` | Basic activation/deactivation |
| `error_lines_regression.test.ts` | Error line number offset calculations |
| `better_diag_main_injection.test.ts` | `void main()` injection edge cases |
| `better_diag_runtime_env.test.ts` | Runtime environment module loading |
| `dds_parser.test.ts` | DDS float texture parsing (DX10/legacy) |
| `glsl_es_compat.test.ts` | GLSL ES compatibility shims |
| `ivertex.test.ts` | Vertex shader detection and `#iVertex` directive processing |
| `textures_init_extension.test.ts` | Texture loading code generation |
| `webview_split.test.ts` | Webview module script loading modes |

Test runner: `run_tests.ts` → `@vscode/test-electron` with mocha. Tests run inside a VS Code instance.

## 17. Source Architecture Summary

```
src/
├── extension.ts                    # VSCode activation, command registration (~100 lines)
├── shadertoymanager.ts             # Webview lifecycle, IPC hub, state management (~350 lines)
├── webviewcontentprovider.ts       # Assembly orchestrator (~520 lines)
├── webviewcontentassembler.ts      # Template injection engine (~110 lines)
├── webviewcontent.ts               # Template file reader/mutator (~40 lines)
├── bufferprovider.ts               # Shader tree parsing, directive processing (~843 lines)
├── shaderparser.ts                 # Recursive descent directive parser (~670 lines)
├── shaderlexer.ts                  # Tokenizer (~352 lines)
├── shaderstream.ts                 # Character stream with mutation support (~122 lines)
├── typenames.ts                    # Core type definitions and enums (~123 lines)
├── constants.ts                    # SELF_SOURCE_ID, WEBGL2_EXTRA_SHADER_LINES (~11 lines)
├── context.ts                      # VSCode API facade (~210 lines)
├── utility.ts                      # removeDuplicates helper (~14 lines)
└── extensions/                     # 62 WebviewExtension implementations
    ├── audio/                      # Audio input extensions (5 files)
    ├── buffers/                    # Buffer/shader/include extensions
    ├── keyboard/                   # Keyboard input extensions (4 files)
    ├── packages/                   # Third-party library injection
    ├── textures/                   # Texture loading extensions
    ├── uniforms/                   # Custom uniform GUI extensions
    └── user_interface/             # UI button/style extensions
        └── error_display/          # GLSL error handling extensions

resources/
├── webview_base.html               # HTML template with ~41 placeholder lines
├── webview/                        # Runtime JavaScript modules
│   ├── runtime_env.js              # VSCode API wrapper, error handlers
│   ├── glsl_error_hook.js          # Pluggable error rewriting
│   ├── shader_compile.js           # GLSL compilation pipeline
│   ├── gl_context.js               # WebGL context initialization
│   ├── ui_controls.js              # PLACEHOLDER (empty)
│   ├── time_input.js               # PLACEHOLDER (empty)
│   └── render_loop.js              # PLACEHOLDER (empty)
├── three.min.js, jquery.min.js     # Bundled libraries
├── stats.min.js, dat.gui.min.js    # Performance/GUI libraries
├── CCapture.all.min.js             # Recording library
└── *.png                           # UI button icons
```

### 17.1 Dependency Graph

```
extension.ts
  ├── Context
  │     ├── vscode (ExtensionContext, WorkspaceConfiguration, DiagnosticCollection)
  │     └── typenames (DiagnosticBatch)
  ├── ShaderToyManager
  │     ├── Context
  │     ├── WebviewContentProvider
  │     │     ├── BufferProvider
  │     │     │     ├── ShaderParser → ShaderLexer → ShaderStream
  │     │     │     ├── Context, typenames, constants
  │     │     │     └── glslify (optional)
  │     │     ├── WebviewContentAssembler → WebviewContent → webview_base.html
  │     │     ├── 62 WebviewExtension implementations
  │     │     └── Context, typenames, constants
  │     └── typenames (RenderStartingData, DiagnosticBatch)
  └── compare-versions (version check)
```

### 17.2 Third-Party Libraries

| Library | Version | File | Usage |
|---------|---------|------|-------|
| THREE.js | r110 | `three.min.js` | WebGLRenderer, ShaderMaterial, scene/camera/quad, texture loading |
| jQuery | (bundled) | `jquery.min.js` | DOM manipulation for error messages |
| Stats.js | r16 | `stats.min.js` | FPS/MS/compile-time panels (optional) |
| dat.GUI | (bundled) | `dat.gui.min.js` | Uniform sliders/controls (optional) |
| CCapture.js | (bundled) | `CCapture.all.min.js` | Offline video/gif recording (optional) |
| compare-versions | (npm) | bundled by webpack | Version check on activation |
| glslify | (npm) | bundled by webpack | Optional GLSL module system |
| mime | (npm) | bundled by webpack | MIME type detection for texture/audio routing |
