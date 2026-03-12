# Shader Toy — Complete Architecture Report

> **Scope:** Full deep-dive examination of the `shader-toy` VSCode extension (v0.11.4) — master branch codebase.
> **Date:** 2026-03-12 (pass 2 — metrics-verified, gap-filled rewrite of 2026-02-27 pass 1)
> **Method:** Automated agent sweep of every source file, verified via `wc -l` / `Get-ChildItem` counts, cross-referenced against AST-level token inspection and runtime template analysis.
> **Audience:** Engineers planning feature work, extension contributors, and anyone needing a ground-truth architectural reference.

---

## Table of Contents

1. [Project Overview & Metrics](#1-project-overview--metrics)
2. [Build & Tooling](#2-build--tooling)
3. [Extension Host Layer](#3-extension-host-layer)
   - 3.1 [Activation & Command Registration](#31-activation--command-registration)
   - 3.2 [Context](#32-context)
   - 3.3 [ShaderToyManager — The Hub](#33-shadertoymanager--the-hub)
4. [Shader Parsing Pipeline](#4-shader-parsing-pipeline)
   - 4.1 [ShaderStream](#41-shaderstream)
   - 4.2 [ShaderLexer](#42-shaderlexer)
   - 4.3 [ShaderParser](#43-shaderparser)
   - 4.4 [BufferProvider — Directive Processing & Tree Walk](#44-bufferprovider--directive-processing--tree-walk)
5. [Webview Content Assembly](#5-webview-content-assembly)
   - 5.1 [WebviewContent — Raw Template](#51-webviewcontent--raw-template)
   - 5.2 [WebviewContentAssembler — Injection Engine](#52-webviewcontentassembler--injection-engine)
   - 5.3 [WebviewContentProvider — Orchestrator](#53-webviewcontentprovider--orchestrator)
   - 5.4 [Extension Interface & Extension Registry](#54-extension-interface--extension-registry)
6. [Webview Runtime Layer (Browser Side)](#6-webview-runtime-layer-browser-side)
   - 6.1 [Template: `webview_base.html`](#61-template-webview_basehtml)
   - 6.2 [Runtime Modules (`resources/webview/`)](#62-runtime-modules-resourceswebview)
   - 6.3 [Third-Party Libraries](#63-third-party-libraries)
   - 6.4 [Render Loop](#64-render-loop)
   - 6.5 [Shader Compilation Flow](#65-shader-compilation-flow)
7. [IPC Bridge (Extension Host ↔ Webview)](#7-ipc-bridge-extension-host--webview)
8. [Feature Subsystems](#8-feature-subsystems)
   - 8.1 [Multi-Pass Buffers & Ping-Pong](#81-multi-pass-buffers--ping-pong)
   - 8.2 [Includes & `#line` Tracking](#82-includes--line-tracking)
   - 8.3 [Custom Vertex Shaders (`#iVertex`)](#83-custom-vertex-shaders-ivertex)
   - 8.4 [Texture Loading (2D, CubeMap, DDS)](#84-texture-loading-2d-cubemap-dds)
   - 8.5 [Audio Input](#85-audio-input)
   - 8.6 [Custom Uniforms (`#iUniform`) & dat.gui](#86-custom-uniforms-iuniform--datgui)
   - 8.7 [Keyboard Input](#87-keyboard-input)
   - 8.8 [First-Person Camera Controls](#88-first-person-camera-controls)
   - 8.9 [Error Display & Diagnostics](#89-error-display--diagnostics)
   - 8.10 [Screenshot & Recording](#810-screenshot--recording)
   - 8.11 [Frame Time Stats](#811-frame-time-stats)
   - 8.12 [Pause / Reload Controls](#812-pause--reload-controls)
   - 8.13 [Portable (Standalone) Preview](#813-portable-standalone-preview)
   - 8.14 [glslify Integration](#814-glslify-integration)
9. [Configuration Surface](#9-configuration-surface)
10. [Test Suite](#10-test-suite)
11. [Key Constants & Sentinels](#11-key-constants--sentinels)
12. [Architectural Patterns & Conventions](#12-architectural-patterns--conventions)
13. [Extension Points & Gaps](#13-extension-points--gaps)
14. [Dependency Map](#14-dependency-map)
15. [Full File Inventory](#15-full-file-inventory)

---

## 1. Project Overview & Metrics

| Metric | Value |
|---|---|
| Extension ID | `stevensona.shader-toy` |
| Version | 0.11.4 |
| Min VS Code | 1.103.0 |
| Language | TypeScript (strict mode) |
| TypeScript source files | 76 |
| TypeScript source lines | 6,426 (verified `wc -l src/**/*.ts`) |
| WebviewExtension implementations | 60 files (+ 4 non-impl support files) |
| Webview runtime JS modules | 7 files |
| Test files | 9 test suites + 2 runners (~1,259 test lines) |
| Test coverage (line ratio) | ~20 % (1,259 / 6,426) |
| Demo shaders | 28 `.glsl` files |
| Template placeholders | 44 (22 HTML `<!-- … -->` + 22 JS `// …`) |
| Dependencies (runtime) | `compare-versions`, `glslify`, `mime` |
| Dependencies (dev) | webpack, ts-loader, eslint, mocha, @vscode/test-electron |
| Bundle target | `dist/extension.js` (webpack, commonjs2, node target) |
| Webview rendering | THREE.js r110 (bundled) + raw WebGL2/WebGL1 context |

The extension provides live GLSL shader preview inside VS Code WebView panels. Shaders are parsed for custom directives (`#include`, `#iChannel`, `#iUniform`, `#iVertex`, `#iKeyboard`, `#iFirstPersonControls`, `#StrictCompatibility`), assembled into a self-contained HTML document, and rendered via THREE.js ShaderMaterial in an orthographic full-screen quad setup.

---

## 2. Build & Tooling

| Command | Purpose |
|---|---|
| `npm run webpack` | Development build → `dist/extension.js` |
| `npm run compile` | TypeScript only → `out/` (used by tests) |
| `npm run watch` | tsc watch mode |
| `npm run webpack-dev` | webpack watch mode |
| `npm run test` | `pretest` (compile) → `node out/test/run_tests.js` |
| `npm run format` | eslint --fix on `src/**` |
| `npm run deploy` | `vsce publish` |

**Webpack config** (`webpack.config.js`): Single entry `src/extension.ts` → `dist/extension.js`, `commonjs2` library target, `node` platform target, source maps enabled. Only TypeScript sources are bundled; resources (HTML, JS, images) are shipped alongside via `.vscodeignore`.

**TypeScript config** (`tsconfig.json`): `target: es6`, `module: commonjs`, `strict: true`, `outDir: out`. No path aliases.

**Resources** are NOT bundled by webpack — they are loaded at runtime from the extension path (`resources/`). The webview HTML template and JS modules are read from disk when constructing webview content.

### CI / GitHub Actions

Two workflows exist under `.github/workflows/`:

| Workflow | File | Trigger | Steps |
|---|---|---|---|
| **Test** | `tests.yml` | push / PR to `master` | Checkout → Node 14.x → `npm install` → `xvfb-run npm test` (Ubuntu only) |
| **Publish** | `publish.yml` | workflow_run (after "Tests" succeeds on `master`) | Checkout → Node **10.x** → `npm install` → `vsce publish` |

**CI risks identified:**

1. **Severely outdated Action versions** — both workflows pin `actions/checkout@v1`, `actions/setup-node@v1` (current: v4). These use deprecated Node 12/16 runners and miss security patches.
2. **Publish uses Node 10.x** — Node 10 has been EOL since 2021-04-30. `vsce` may break silently on newer npm lockfile formats.
3. **Fragile cross-workflow trigger** — `publish.yml` fires on `workflow_run` completion of a workflow named `"Tests"` with branch `test_publish` and a check on `conclusion == 'success'`. If the test workflow name or branch filter changes, publishing silently stops.
4. **No matrix testing** — only Ubuntu. No Windows / macOS coverage despite the extension targeting all platforms.
5. **No lint / typecheck step** — only `npm test` (which runs `tsc` + mocha). ESLint is configured but never run in CI.

---

## 3. Extension Host Layer

### 3.1 Activation & Command Registration

**Entry point:** `src/extension.ts` (103 lines) → `activate(extensionContext)`

Activation flow:
1. Version check → show update notification if version bumped
2. Create `Context` (wraps `ExtensionContext` + `WorkspaceConfiguration`)
3. Create `ShaderToyManager` (singleton orchestrator)
4. Register document-change callbacks (debounced by `reloadOnEditTextDelay` seconds)
5. Register save/editor-change callbacks
6. Register configuration-change handler (recreates `Context`, migrates manager)
7. Register 5 commands → push to `extensionContext.subscriptions`

**`deactivate()` (lines 102–103):** Empty — no cleanup of event listeners, timers, or panels. The `events[]` disposable array and `timeout` handle are module-scoped globals; they are not disposed on deactivation, relying entirely on VS Code's process teardown. This is a latent resource-leak risk if the extension is deactivated without a full window reload.

**Registered commands:**

| Command ID | Action |
|---|---|
| `shader-toy.showGlslPreview` | Open dynamic preview (tracks active editor) |
| `shader-toy.showStaticGlslPreview` | Open static preview (pinned to current document) |
| `shader-toy.createPortableGlslPreview` | Generate self-contained `.html` file |
| `shader-toy.pauseGlslPreviews` | Toggle pause on all previews |
| `shader-toy.saveGlslPreviewScreenShots` | Trigger screenshot on all previews |

**Callback architecture:** Callbacks are re-registered on every config change. The `events` array collects disposables; old ones are disposed before re-registering. A global `timeout` handle provides debouncing for `onDidChangeTextDocument`.

### 3.2 Context

**File:** `src/context.ts` (209 lines) — Wraps VS Code APIs into a testable facade.

Key responsibilities:
- **Resource URI resolution:** `getResourceUri(file)` → `extensions/<extensionPath>/resources/<file>`
- **Webview URI translation:** `makeWebviewResource(webview, uri)` → `webview.asWebviewUri(uri)`
- **User path mapping:** `mapUserPath(userPath, sourcePath)` — resolves user-specified paths with 3-tier priority: absolute → relative-to-source → workspace-folder-relative. Supports cubemap wildcards (`{}`, `*`).
- **Diagnostics:** `showDiagnostics(batch, severity)` → VS Code `DiagnosticCollection` keyed by `'shader-toy.errors'`. Diagnostics accumulate per file until `clearDiagnostics()`.
- **Error reveal:** `revealLine(file, line)` → opens document and scrolls to line.
- **Config access:** `getConfig<T>(section)` → typed workspace configuration reader.

### 3.3 ShaderToyManager — The Hub

**File:** `src/shadertoymanager.ts` (403 lines) — Central orchestrator for all preview panels.

**Panel types:**

| Type | Field | Behavior |
|---|---|---|
| Dynamic | `webviewPanel: Webview` | Singleton. Tracks `context.activeEditor`. Disposed & recreated on each `showDynamicPreview()`. |
| Static | `staticWebviews: StaticWebview[]` | Array. Each pinned to a specific `Document`. One-per-document dedup. |

**`Webview` type:** `{ Panel: WebviewPanel, OnDidDispose: () => void }`
**`StaticWebview` type:** extends `Webview` with `Document: TextDocument`

**State persistence:** `RenderStartingData` tracks pause state, time, mouse, normalized mouse, keys, fly control transform, and uniforms GUI state across webview reloads.

**`updateWebview()` flow** (the core update path):
1. Clear diagnostics
2. Create `WebviewContentProvider` with current document text
3. `parseShaderTree()` → returns local resource paths
4. Compute `localResourceRoots` from texture/audio file paths
5. If resource roots changed → recreate the `WebviewPanel` (VSCode requires roots at creation time)
6. `generateWebviewContent()` → assemble full HTML string
7. Set `webview.html = content`

**IPC handling:** `onDidReceiveMessage` in `createWebview()` handles:

| Webview → Host Message | Handler |
|---|---|
| `readDDSFile` | Read `.dds` binary, respond with base64 (sandbox-safe file I/O) |
| `reloadWebview` | Trigger `updateWebview` |
| `updateTime` | Persist time to `startingData` |
| `setPause` | Persist pause state |
| `updateMouse` | Persist mouse coordinates |
| `updateKeyboard` | Persist key states |
| `updateFlyControlTransform` | Persist camera position + rotation |
| `updateUniformsGuiOpen` | Persist GUI open/close state |
| `updateUniformsGuiValue` | Persist individual uniform values |
| `showGlslDiagnostic` | Forward to `context.showDiagnostics()` |
| `showGlslsError` | Forward to `context.revealLine()` |
| `errorMessage` | Forward to `vscode.window.showErrorMessage()` |

**Host → Webview Messages:**

| Host → Webview Message | Trigger |
|---|---|
| `pause` | `pauseGlslPreviews` command |
| `screenshot` | `saveGlslPreviewScreenShots` command |
| `readDDSFileResult` | Reply to `readDDSFile` |
| `hotReload` | Document change/save when resource roots are unchanged |

### 3.4 Hot Reload (Incremental Update Path)

When a shader document changes and the computed `localResourceRoots` are identical to the current panel's roots, `ShaderToyManager` avoids tearing down and recreating the `WebviewPanel`. Instead it posts a `hotReload` message to the existing webview:

**Payload:** `{ shaderHtml, includeHtml, initScript, startingData }`

- `shaderHtml` — regenerated `<script type="x-shader/x-fragment">` blocks for each buffer
- `includeHtml` — regenerated include shader blocks
- `initScript` — regenerated buffer-init JS (texture bindings, buffer wiring)
- `startingData` — persisted `RenderStartingData` (time, mouse, pause, uniforms, etc.)

**Browser-side handling:**
1. Replace `<textarea>` / `<script>` nodes that hold shader/include source with the new HTML
2. Re-run the init script (recompiles shaders, rebinds textures)
3. Preserve all interactive state from `startingData` (no time/mouse/uniform reset)
4. If compilation succeeds, rendering continues seamlessly; if it fails, error display updates in-place

**Fallback:** If resource roots _have_ changed (e.g., a new texture path was added), the full teardown path (`createWebview` → `updateWebview`) is used because VS Code requires `localResourceRoots` to be set at panel creation time.

**Why this matters:** Hot reload is the mechanism that makes live-editing feel instantaneous — it avoids the flicker and state reset of a full panel rebuild. Pass 1 did not document this path at all.

---

## 4. Shader Parsing Pipeline

The parsing pipeline is a 3-layer stack: `ShaderStream` → `ShaderLexer` → `ShaderParser`, orchestrated by `BufferProvider`.

### 4.1 ShaderStream

**File:** `src/shaderstream.ts` (121 lines) — Character-level stream with position/line/column tracking.

Key features:
- **Mutation support:** `mutate(begin, end, source)` — in-place text replacement (used by `BufferProvider.replaceLastObject` to strip directives and inline includes). Tracks mutation ranges for `originalLine()` remapping.
- **`originalLine()`:** Compensates for inserted/removed lines from mutations, returning the line number in the user's original source file.
- **Stream primitives:** `peek(ahead)`, `next()`, `pos()`, `line()`, `column()`, `eof()`, `reset(position)`, `code()`, `getCurrentLine()`.

### 4.2 ShaderLexer

**File:** `src/shaderlexer.ts` (351 lines) — Tokenizer for the custom directive subset of GLSL.

**Token types:** `Punctuation`, `Operator`, `String`, `Integer`, `Float`, `Identifier`, `PreprocessorKeyword`, `Keyword`, `Type`, `Unkown`

**Preprocessor keywords** (trigger directive parsing): `include`, `iVertex`, `iKeyboard`, `iFirstPersonControls`, `iUniform`, `StrictCompatibility`, and anything starting with `iChannel`.

**Keywords:** `MinFilter`, `MagFilter`, `WrapMode`, `Type`, `in`, `out`, `inout`, `step`

**Types:** `float`, `vec2`, `vec3`, `vec4`, `int`, `ivec2`, `ivec3`, `ivec4`, `color3`

**Features:**
- Skips whitespace and both `//` and `/* */` comments
- Recognizes `::` as a single punctuation token (for texture parameter syntax `#iChannel0::MagFilter`)
- Number parsing handles signs, dots, and scientific notation (`eE`)
- String parsing handles escape sequences (`\\`)
- Range tracking (`LineRange`) — begin/end character positions of each token, used for directive removal

### 4.3 ShaderParser

**File:** `src/shaderparser.ts` (669 lines) — Recursive descent parser for shader-toy directives.

> **Note:** Contains the only `TODO` in the entire codebase: _"Check if type is array type"_ (uniform type validation).

**Parse objects:** `Include`, `Vertex`, `Texture`, `TextureMagFilter`, `TextureMinFilter`, `TextureWrapMode`, `TextureType`, `Uniform`, `Keyboard`, `FirstPersonControls`, `StrictCompatibility`, `Error`

**`next()` method:** Scans forward for `PreprocessorKeyword` tokens, then dispatches to type-specific parsers:
- `getInclude()` → `#include "path"`
- `getVertex()` → `#iVertex "path"`
- `getTextureObject()` → `#iChannelN "path"` or `#iChannelN::Parameter "value"`
- `getUniformObject()` → `#iUniform type name [= default] [in {min, max}] [step value]`

**Uniform parsing** is the most complex: handles typed constructors (`vec3(1.0, 2.0, 3.0)`), range arrays (`in {0.0, 1.0}`), step values, type assignability checking (including vec→array promotion), and integer vs. float distinction.

**Mutation integration:** `lastObjectRange` tracks the character range of the most recently parsed object, enabling `BufferProvider` to call `parser.mutate()` to strip directives from the shader source (they become GLSL comments/blanks in the final output).

### 4.4 BufferProvider — Directive Processing & Tree Walk

**File:** `src/bufferprovider.ts` (843 lines) — The largest single source file. Orchestrates the complete shader-to-buffer transformation.

**Core method:** `parseShaderCode(file, code, buffers, commonIncludes, generateStandalone)`

**Processing stages:**

1. **`parseShaderCodeInternal()`** — Recursive. Visits each file at most once (`visitedFiles` dedup).
   - Standalone vertex shader detection: heuristic regex check for `gl_Position` without `mainImage`/`gl_FragCoord` → replaces with error-marker fragment stub.

2. **`transformCode()`** — Core directive processing loop:
   - Creates `ShaderParser` over the shader code
   - Iterates `parser.next()`, dispatching each object:
     - **`Texture`:** Resolves path (absolute, `file://`, remote), pushes to `pendingTextures`, strips directive
     - **`TextureMagFilter/MinFilter/WrapMode/Type`:** Stores in `pendingTextureSettings` map, strips directive
     - **`Include`:** Reads include file, recursively calls `transformCode()`, inlines with `#line` bracketing using source IDs, strips directive
     - **`Vertex`:** Validates WebGL2 mode, resolves vertex shader path, strips directive
     - **`Uniform`:** Validates types, resolves defaults from range if missing, pushes to `pendingUniforms`, strips directive
     - **`Keyboard/FirstPersonControls/StrictCompatibility`:** Sets boolean flags, strips directive
   - Returns modified code string

3. **Post-processing in `parseShaderCodeInternal()`:**
   - Normalizes `SELF_SOURCE_ID` sentinels → `#line N 0` for top-level files
   - Reads & transforms vertex shader if `#iVertex` was specified
   - Resolves textures: text → recursive buffer parse; image → local/remote texture; audio → audio input
   - Assigns texture settings (mag/min/wrap/type)
   - Strips `#version` directives (with diagnostic info)
   - Injects `void main()` wrapper if missing and `mainImage()` present (or `StrictCompatibility`)
   - Checks for undefined texture channel usage → warning
   - Applies glslify transform if enabled
   - Pushes final `BufferDefinition` to `buffers` array (after dependencies, ensuring topological order)

4. **Post-tree-walk in `parseShaderCode()`:**
   - Resolves buffer name → index cross-references
   - Detects self-read (feedback) buffers
   - Builds dependency graph (`Dependents` array)

---

## 5. Webview Content Assembly

### 5.1 WebviewContent — Raw Template

**File:** `src/webviewcontent.ts` (39 lines) — Reads `resources/webview_base.html` and provides mutation primitives.

- `getLines()` → split on `\r?\n`
- `insertAfterLine(content, lineNumber)` → splices new lines after the specified line, preserving indentation
- `replaceWithinLine(source, dest, lineNumber)` → string replacement within a single line
- `getContent()` → joins lines back with `\n`

### 5.2 WebviewContentAssembler — Injection Engine

**File:** `src/webviewcontentassembler.ts` (110 lines) — Maps extensions to template injection points.

**Two injection modes:**

| Mode | Method | Behavior |
|---|---|---|
| **Insert** | `addWebviewModule(ext, originalLine)` | Appends `ext.generateContent()` after the matching template line |
| **Replace** | `addReplaceModule(ext, originalLine, replaceContent)` | Replaces `replaceContent` within the matching template line with `ext.generateContent()` |

**Line mapping:** On construction, builds a `Map<string, number[]>` from trimmed template lines → line numbers. This enables multiple extensions to target the same template line (e.g., multiple `<!-- Shaders -->` inserts).

**Module ordering:** Modules are stored in a sorted array (by descending line number) and applied in order during `assembleWebviewContent()`. Insert-mode modules splice after the line, so multiple inserts at the same line appear in registration order.

### 5.3 WebviewContentProvider — Orchestrator

**File:** `src/webviewcontentprovider.ts` (529 lines) — The "wiring harness" that connects all subsystems.

**Two-phase operation:**

1. **`parseShaderTree()`** — Delegates to `BufferProvider`, returns local resource paths for WebView CSP.
2. **`generateWebviewContent(webview, startingState)`** — Assembles the complete HTML:

**Assembly order (matches template placeholder order):**

| Phase | Extensions Wired | Template Target |
|---|---|---|
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
| Screenshot/Record | `ScreenshotButton/Style`, `RecordButton/Style`, resolution/framerate/codec/etc. extensions | various placeholders |
| Reload | `ReloadButtonStyle`, `ReloadButton` (when auto-reload disabled) | `<!-- Reload Element -->` etc. |
| Error Handling | `IvertexErrorRewrite` (WebGL2 only), `GlslifyErrors` / `DiagnosticsErrors` / `DefaultErrors` | `// Error Callback` (insert) |
| Final Assembly | `assembleWebviewContent()` | Returns complete HTML string |

### 5.4 Extension Interface & Extension Registry

**Interface:** `src/extensions/webview_extension.ts`
```typescript
export interface WebviewExtension {
    generateContent(): string;
}
```

Every extension is a class implementing `generateContent() → string`. The returned string is either inserted after a template line or used to replace a placeholder token within a template line.

**Non-implementation files in `extensions/`:** 4 files do NOT implement `WebviewExtension`:

| File | Lines | Role |
|---|---|---|
| `webview_extension.ts` | 5 | The `WebviewExtension` interface definition itself |
| `glsl_version_extension.ts` | 3 | Plain string constant export (`glslVersionString`) |
| `texture_extension_extension.ts` | 5 | `TextureExtension` interface (for texture content providers) |
| `error_display_wrapper.ts` | 138 | Shared error display utility — generates the `console.error` monkey-patch, WebGL error log parser, `#line`-based source mapping, and clickable error links. Used by all three error display extensions (`DefaultErrors`, `DiagnosticsErrors`, `GlslifyErrors`) as a common base. |

**Extension count:** 60 files implement `WebviewExtension` + 4 support files = 64 total in `src/extensions/`. The 60 implementations break down into 15 in `user_interface/` (buttons, styles) + 5 in `error_display/` + 40 in the root `extensions/` directory.

**Extension categories:**

| Category | Count | Examples |
|---|---|---|
| Initial state | 6 | `InitialTimeExtension`, `InitialPausedExtension` |
| Configuration | 5 | `ForcedAspectExtension`, `GlslVersionExtension` |
| Shader assembly | 5 | `ShadersExtension`, `BuffersInitExtension`, `IncludesExtension` |
| Preamble | 3 | `ShaderPreambleExtension`, `UniformsPreambleExtension` |
| Keyboard | 4 | `KeyboardInitExtension`, `KeyboardShaderExtension` |
| Textures | 2 | `TexturesInitExtension`, `TextureExtensionExtension` |
| Audio | 5 | `AudioInitExtension`, `NoAudioExtension` |
| Uniforms | 3 | `UniformsInitExtension`, `UniformsUpdateExtension` |
| Packages | 6 | `ThreeExtension`, `JQueryExtension`, `WebviewModuleScriptExtension` |
| UI Controls | 15 | Pause, Screenshot, Record (button + style pairs), Reload |
| Error display | 5 | `DefaultErrorsExtension`, `DiagnosticsErrorsExtension`, `IvertexErrorRewriteExtension` |
| Time / Render | 3 | `AdvanceTimeExtension`, `PauseWholeRenderExtension` |
| Constants | 3 | `SelfSourceIdExtension`, `Webgl2ExtraShaderLinesExtension` |
| Meta | 1 | `WebviewModuleScriptExtension` (generic script loader) |

---

## 6. Webview Runtime Layer (Browser Side)

### 6.1 Template: `webview_base.html`

The template (773 lines, ~710 after assembly) is a single HTML document containing **44 injection anchors** (22 HTML-style `<!-- … -->` comments + 22 JS-style `// …` comments) that extensions target for content insertion or replacement.

- **`<head>`:** CSS for canvas, error display, button overlays, dat.gui container
- **`<body>`:** `#message` div (error/info display), `#dat_gui_container`, `#container` (pause button), screenshot/record/reload elements
- **`<canvas id="canvas">`:** The WebGL rendering surface
- **`<script>` blocks:** Shader sources (injected as `<script type="x-shader/x-fragment">`), inline JS for the main render loop and all interaction

### 6.2 Runtime Modules (`resources/webview/`)

Seven JS modules loaded as separate `<script>` tags, each wrapping into `window.ShaderToy.*`:

| Module | Namespace | Responsibility |
|---|---|---|
| `runtime_env.js` | `ShaderToy.env` | VS Code API acquisition, global error/unhandledrejection handlers |
| `glsl_error_hook.js` | `ShaderToy.glslError` | Pluggable error rewriter registry (`registerRewriter`/`rewrite`) |
| `shader_compile.js` | `ShaderToy.shaderCompile` | `#line` normalization, fragment/vertex/include shader compilation helpers, WebGL2 `#version 300 es` header injection |
| `gl_context.js` | `ShaderToy.gl` | WebGL2/WebGL1 context acquisition with fallback |
| `ui_controls.js` | `ShaderToy.ui` | Placeholder (empty, reserved for future UI wiring) |
| `time_input.js` | `ShaderToy.timeInput` | Placeholder (empty, reserved for future clock/input handling) |
| `render_loop.js` | `ShaderToy.renderLoop` | Placeholder (empty, reserved for future render loop extraction) |

**Module pattern:** All modules use IIFE wrapping `(function(global) { ... })(typeof window !== 'undefined' ? window : globalThis)` for browser + test compatibility.

**Standalone mode:** `WebviewModuleScriptExtension` can inline module source directly (via `getResourceText`) for portable HTML previews instead of generating `<script src="...">` tags.

### 6.3 Third-Party Libraries

| Library | Version | File | Usage |
|---|---|---|---|
| THREE.js | r110 | `three.min.js` | WebGLRenderer, ShaderMaterial, scene/camera/quad, texture loading, math types (Vector3, Vector4, Matrix4) |
| jQuery | (minified) | `jquery.min.js` | DOM manipulation for error messages (`$('#message').append(...)`) |
| Stats.js | r16 | `stats.min.js` | FPS/MS/compile-time panels (optional, bottom-left overlay) |
| dat.GUI | (minified) | `dat.gui.min.js` | Uniform sliders/controls (optional, top-left overlay) |
| CCapture.js | (minified) | `CCapture.all.min.js` | Offline video/gif recording (optional) |

### 6.4 Render Loop

The render loop lives in the inline `<script>` block of `webview_base.html`:

```
render() → requestAnimationFrame(render)
  ├── Pause check (whole render or time-only)
  ├── Advance time (delta from THREE.Clock)
  ├── Update date uniform
  ├── Update fly controls
  ├── Audio update
  ├── For each buffer:
  │     ├── Set uniforms (iResolution, iTime, iTimeDelta, iFrame, iMouse, iMouseButton, iViewMatrix, resolution, time, mouse)
  │     ├── Set quad material = buffer.Shader
  │     ├── Set render target = buffer.Target
  │     └── Render scene
  ├── Update custom uniforms
  ├── Update keyboard texture
  ├── Release mouse click (z/w negation)
  ├── Ping-pong buffer swap
  ├── Offline recording capture
  └── Increment frameCounter
```

**Resolution handling:** `computeSize()` computes forced aspect ratio, centers canvas, resizes all render targets, and resets `frameCounter` on window resize.

### 6.5 Shader Compilation Flow

1. **Source embedding:** `ShadersExtension` creates `<script id="bufferName" type="x-shader/x-fragment">` elements containing preamble + keyboard preamble + `#line 1 0` + user code.

2. **Source extraction:** `BuffersInitExtension` generates JS that reads `document.getElementById(name).textContent` and passes through `prepareFragmentShader()`.

3. **`prepareFragmentShader()` (in `shader_compile.js`):**
   - WebGL2: Prepends `#ifdef gl_FragColor` block, `layout(location=0) out highp vec4`, `#define texture2D texture`
   - WebGL1: Prepends `#define GLSL_FRAGCOLOR gl_FragColor`

4. **THREE.js compilation:** `new THREE.ShaderMaterial({ fragmentShader: ..., glslVersion: THREE.GLSL3 })` compiles the shader. Errors surface through `console.error` which is monkey-patched by the error display extension.

5. **Test compilation:** Each buffer is rendered once during initialization (the "compile test" loop). Failed buffers are tracked in `failedBufferNames` and skipped in the render loop.

6. **Include compilation:** If `testCompileIncludedFiles` is enabled, includes are compiled via `compileIncludeFragment()` which wraps the source in a `void main() {}` stub.

---

## 7. IPC Bridge (Extension Host ↔ Webview)

Communication is bidirectional via VS Code's `postMessage` / `onDidReceiveMessage` API.

**Direction: Webview → Extension Host**

| Message | Payload | Purpose |
|---|---|---|
| `readDDSFile` | `{ requestId, file }` | Binary file read (sandbox bypass) |
| `reloadWebview` | — | Request content refresh |
| `updateTime` | `{ time }` | Persist current time for reload |
| `setPause` | `{ paused }` | Persist pause state |
| `updateMouse` | `{ mouse, normalizedMouse }` | Persist mouse for reload |
| `updateKeyboard` | `{ keys }` | Persist key states |
| `updateFlyControlTransform` | `{ position, rotation }` | Persist camera transform |
| `updateUniformsGuiOpen` | `{ value }` | Persist GUI open state |
| `updateUniformsGuiValue` | `{ name, value }` | Persist uniform value |
| `showGlslDiagnostic` | `{ type, diagnosticBatch }` | Forward errors to VS Code diagnostics |
| `showGlslsError` | `{ line, file }` | Navigate to error line |
| `errorMessage` | `{ message }` | Show VS Code error popup |

**Direction: Extension Host → Webview**

| Message | Payload | Purpose |
|---|---|---|
| `pause` | — | Toggle pause |
| `screenshot` | — | Trigger screenshot |
| `readDDSFileResult` | `{ requestId, ok, base64?, error? }` | Reply to DDS file request |

**Security model:** The webview has `enableScripts: true`. `localResourceRoots` are dynamically computed from texture/audio file paths + extension root. DDS file reads enforce path-within-roots checking.

---

## 8. Feature Subsystems

### 8.1 Multi-Pass Buffers & Ping-Pong

Shaders can reference other shader files as texture inputs via `#iChannel0 "other.glsl"`. BufferProvider recursively parses referenced files, building buffers in dependency order (leaf dependencies first).

- Each non-final buffer gets a `WebGLRenderTarget` (with `framebufferType` based on float extension availability)
- Ping-pong: If a buffer reads itself (`#iChannel0 "self"`), it gets a second `PingPongTarget`. After each frame, targets are swapped and the self-channel uniform is updated.
- Final-buffer feedback: If the last buffer reads itself, a synthetic `final-blit` pass is appended that samples the buffer via `iChannel0`.
- Dependents: Tracked explicitly (`Dependents[]` on each buffer) so downstream buffers update their texture references after a ping-pong swap.

### 8.2 Includes & `#line` Tracking

`#include "file.glsl"` inlines the included file's code with `#line` directive bracketing:

```glsl
#line 1 <includeSourceId>
// ... included code ...
#line <resumeLine> 65535
// ... remainder of parent ...
```

- Source ID 0 = top-level buffer file
- Source IDs 1..N = shared includes (in `commonIncludes` order)
- Source ID `65535` (`SELF_SOURCE_ID`) = sentinel for "this file" — normalized to 0 for top-level files before final emission, and to the correct include ID for nested includes
- `ShaderStream.originalLine()` compensates for mutation-induced line shifts
- The error display code reverse-maps source IDs to filenames using `commonIncludes[sid-1].File`

### 8.3 Custom Vertex Shaders (`#iVertex`)

- Requires `webglVersion: "WebGL2"` config setting
- Syntax: `#iVertex "path.glsl"` (must be local `.glsl` file)
- `#iVertex "default"` → use THREE.js default vertex shader
- `#iVertex "self"` → error (not supported)
- Only the last `#iVertex` directive wins (with warning)
- Vertex code is transformed through the same `transformCode()` pipeline
- `#version` directives are stripped (with info diagnostic)
- Vertex code gets a separate `<script type="x-shader/x-vertex">` element
- `prepareVertexShader()` adds `#define texture2D texture` compatibility shim
- Error rewriting: `IvertexErrorRewriteExtension` registers a GLSL error hook to catch `ERROR_IVERTEX_SOURCE` markers from standalone-vertex-shader detection

### 8.4 Texture Loading (2D, CubeMap, DDS)

**2D textures:** Loaded via `THREE.TextureLoader` with configurable mag/min/wrap filters. Supports local (`file://`) and remote (`https://`) paths.

**CubeMap textures:** Loaded via `THREE.CubeTextureLoader`. Requires local path with `{}` wildcard and auto-detects face naming conventions (e/w/u/d/n/s, px/nx/py/ny/pz/nz, etc.).

**DDS float textures:** Custom loader supporting:
- DX10 header formats: RGBA32F (DXGI 2), RGB32F (DXGI 6), RG32F (DXGI 16), R32F (DXGI 41)
- Legacy FourCC 116 (A32B32G32R32F)
- RG32F and R32F are expanded to RGBA32F on load
- Local DDS files use the `readDDSFile` IPC bridge (base64 round-trip through extension host)
- Remote DDS files use `THREE.FileLoader` with `arraybuffer` response type
- Float filtering falls back to `NearestFilter` if `OES_texture_float_linear` is unavailable

**Power-of-two warnings:** Non-POT textures with custom filter settings trigger diagnostics at the setting definition line.

### 8.5 Audio Input

- Enabled via `enabledAudioInput` config (default: false, experimental)
- `AudioInitExtension`: Creates `AudioContext`, `AnalyserNode` with configurable FFT size (`audioDomainSize`)
- Audio data → `DataTexture` updated each frame
- Supports local and remote audio files
- Pause/resume integrated with render pause

### 8.6 Custom Uniforms (`#iUniform`) & dat.gui

Syntax: `#iUniform type name [= default] [in {min, max}] [step value]`

Supported types: `float`, `int`, `vec2`-`vec4`, `ivec2`-`ivec4`, `color3`

- `UniformsPreambleExtension`: Adds `uniform` declarations to shader preamble
- `UniformsInitExtension`: Generates dat.gui controls (sliders, color pickers) with persisted starting values
- `UniformsUpdateExtension`: Generates per-frame uniform update code
- `DatGuiExtension`: Loads dat.gui library
- GUI state persisted across reloads via `RenderStartingData.UniformsGui`

### 8.7 Keyboard Input

- Activated by `#iKeyboard` directive in shader
- 256×4 pixel `DataTexture` encoding key states (down/pressed/toggled/released)
- `KeyboardShaderExtension`: Adds GLSL helper functions (`isKeyDown()`, `isKeyPressed()`, `isKeyToggled()`, `isKeyReleased()`) and key constant definitions
- Key state updates via `document.onkeydown`/`onkeyup` callbacks
- States persisted across reloads via `RenderStartingData.Keys`

### 8.8 First-Person Camera Controls

- Activated by `#iFirstPersonControls` directive
- Uses THREE.js `FlyControls` (loaded from `resources/` via `ThreeFlyControlsExtension`)
- Camera state exposed as `iViewMatrix` uniform (world matrix)
- Position and rotation persisted across reloads via `RenderStartingData.FlyControlPosition/Rotation`

### 8.9 Error Display & Diagnostics

**Three error display modes** (mutually exclusive):

1. **`DefaultErrorsExtension`** — In-webview error display only (HTML clickable error links)
2. **`DiagnosticsErrorsExtension`** — Same + forwards errors to VS Code diagnostics panel via IPC
3. **`GlslifyErrorsExtension`** — Simplified error display for glslify-transformed code (line numbers unreliable)

**Error parsing:** All modes monkey-patch `console.error`, intercept THREE.js shader compilation errors, and parse the WebGL shader info log format: `ERROR: <sourceId>:<line>: <message>`.

**Error rewriting hook:** `glsl_error_hook.js` provides a pluggable pipeline:
- `window.ShaderToy.glslError.registerRewriter(fn)` — register a transform function
- Called during error parsing; can modify `lineNumber`, `file`, `error` fields
- Used by `IvertexErrorRewriteExtension` to rewrite `ERROR_IVERTEX_SOURCE` markers

**Line offset compensation:**
- `buffer.LineOffset` = preamble lines + THREE.js wrapper lines (107) + keyboard preamble lines (if applicable)
- WebGL2 adds `WEBGL2_EXTRA_SHADER_LINES` (16) additional lines
- Error line numbers are offset-corrected before display/diagnostic emission

### 8.10 Screenshot & Recording

**Screenshot:**
- Triggered by button click or command
- `canvas.toBlob()` → download as `shadertoy.png`
- Supports forced resolution: temporarily resizes renderer, renders, captures, restores

**Recording (two modes):**
1. **MediaRecorder** (default): `canvas.captureStream()` → WebM/VP8/VP9/H264 encoding
2. **CCapture.js** (offline): Frame-by-frame capture → WebM/GIF/PNG/JPG tar, configurable quality/framerate

Both modes toggle via the record button, with optional max duration auto-stop.

### 8.11 Frame Time Stats

- Optional (`printShaderFrameTime` config)
- Stats.js r16 with compile-time panel (`CT MS`) added as custom panel
- Positioned at bottom-left of viewport
- Compile time measured during initial shader test-compile loop
- **Frames Panel** (`src/framespanel.ts`, 121 lines): A dedicated `WebviewPanel`-based frame timing display. Registered as a separate panel alongside preview panels, receives frame timing data from the webview via IPC. This is separate from the Stats.js overlay — it provides a VS Code panel-level view of frame timings.

### 8.12 Pause / Reload Controls

**Pause:**
- Button: `PauseButtonExtension` + `PauseButtonStyleExtension` (custom checkbox + CSS background images)
- Two modes: `pauseWholeRender` (skips entire `render()`) or time-only pause (still renders, freezes `iTime`)
- Pause state maintained across reloads if `pauseMaintainedOnReload` is enabled

**Reload:**
- Button shown when `reloadAutomatically` is disabled
- Sends `reloadWebview` IPC message to extension host

### 8.13 Portable (Standalone) Preview

`createPortableGlslPreview` generates a self-contained `.html` file:
- All resource URIs resolve to CDN URLs (THREE.js from cdnjs)
- `WebviewModuleScriptExtension` inlines JS source instead of generating `<script src>` tags
- `generateStandalone = true` flag propagates through all extensions
- Texture paths become relative to the output file

### 8.14 glslify Integration

- Enabled via `enableGlslifySupport` config
- Applied post-transform (after all directive processing)
- Uses `glslify.compile(code, {basedir})` where basedir = workspace root or shader directory
- Error handling: Missing module detection with actionable install suggestions
- **Caveat:** Line numbers are unreliable after glslify transform → uses `GlslifyErrorsExtension`

---

## 9. Configuration Surface

All settings under `shader-toy.*`:

| Setting | Type | Default | Category |
|---|---|---|---|
| `forceAspectRatio` | `[number, number]` | `[0, 0]` | Rendering |
| `webglVersion` | `"Default" \| "WebGL2"` | `"Default"` | Rendering |
| `showCompileErrorsAsDiagnostics` | `boolean` | `true` | Diagnostics |
| `omitDeprecationWarnings` | `boolean` | `false` | Diagnostics |
| `enableGlslifySupport` | `boolean` | `false` | Transform |
| `reloadAutomatically` | `boolean` | `true` | Reload |
| `reloadOnEditText` | `boolean` | `true` | Reload |
| `reloadOnEditTextDelay` | `number` | `1` (sec) | Reload |
| `reloadOnChangeEditor` | `boolean` | `false` | Reload |
| `reloadOnSaveFile` | `boolean` | `true` | Reload |
| `resetStateOnChangeEditor` | `boolean` | `true` | State |
| `showScreenshotButton` | `boolean` | `true` | UI |
| `screenshotResolution` | `[number, number]` | `[0, 0]` | UI |
| `showRecordButton` | `boolean` | `true` | UI |
| `recordTargetFramerate` | `number` | `30` | Recording |
| `recordVideoContainer` | `string` | `"webm"` | Recording |
| `recordVideoCodec` | `"vp8" \| "vp9" \| "h264" \| "avc1"` | `"vp8"` | Recording |
| `recordVideoBitRate` | `number` | `2500000` | Recording |
| `recordMaxDuration` | `number` | `0` (unlimited) | Recording |
| `recordOffline` | `boolean` | `false` | Recording |
| `recordOfflineFormat` | `string` | `"webm"` | Recording |
| `recordOfflineQuality` | `number` | `80` | Recording |
| `showPauseButton` | `boolean` | `true` | UI |
| `pauseWholeRender` | `boolean` | `true` | Pause |
| `pauseMaintainedOnReload` | `boolean` | `false` | Pause |
| `printShaderFrameTime` | `boolean` | `true` | UI |
| `warnOnUndefinedTextures` | `boolean` | `true` | Diagnostics |
| `enabledAudioInput` | `boolean` | `false` | Audio |
| `audioDomainSize` | `number` | `512` | Audio |
| `testCompileIncludedFiles` | `boolean` | `true` | Compilation |
| `shaderToyStrictCompatibility` | `boolean` | `false` | Compatibility |

---

## 10. Test Suite

| Test File | Coverage Area |
|---|---|
| `extension.test.ts` | Basic activation/deactivation |
| `error_lines_regression.test.ts` | Error line number offset calculations |
| `better_diag_main_injection.test.ts` | `void main()` injection edge cases |
| `better_diag_runtime_env.test.ts` | Runtime environment module loading |
| `dds_parser.test.ts` | DDS float texture parsing (DX10/legacy) |
| `glsl_es_compat.test.ts` | GLSL ES compatibility shims |
| `ivertex.test.ts` | Vertex shader detection and `#iVertex` directive processing |
| `textures_init_extension.test.ts` | Texture loading code generation |
| `webview_split.test.ts` | Webview module script loading modes |

**Test runner:** `run_tests.ts` → `@vscode/test-electron` with mocha. Tests run in a VS Code instance.

### Test Coverage Analysis

**Approximate coverage:** ~1,259 test lines / 6,426 source lines ≈ **20% line ratio** (not instrumented; this is a structural estimate).

**Well-tested subsystems:**
- Lexer / parser directive recognition and edge cases
- Error line offset calculations (regression suite)
- `void main()` injection heuristics
- DDS float texture parsing (DX10 + legacy formats)
- WebGL2/GLSL ES compatibility shims
- Webview module script loading modes (inline vs. URI)
- Texture init code generation

**NOT tested (zero coverage):**
- Audio input pipeline (`AudioInitExtension`, `AudioUpdateExtension`)
- Keyboard input (`KeyboardInitExtension` and related)
- CubeMap texture loading and face detection
- Multi-pass buffer wiring and ping-pong logic
- Screenshot and recording (MediaRecorder + CCapture paths)
- glslify integration
- First-person camera controls
- Hot reload (incremental update path)
- Portable/standalone HTML generation
- Configuration change handling and event re-registration
- `ShaderToyManager` panel lifecycle (dynamic/static creation, disposal, IPC routing)

**Structural gap:** No integration tests exercise the full `activate → open preview → edit shader → observe update` cycle. All tests are unit-level, testing individual modules in isolation.

---

## 11. Key Constants & Sentinels

| Constant | Value | Location | Purpose |
|---|---|---|---|
| `SELF_SOURCE_ID` | `65535` | `src/constants.ts` | `#line` source string number sentinel for "this file" |
| `WEBGL2_EXTRA_SHADER_LINES` | `16` | `src/constants.ts` | Extra lines inserted by WebGL2 runtime (version, precision, compatibility shims) |
| `glslPlusThreeJsLineNumbers` | `107` | `webviewcontentprovider.ts:296` | THREE.js wrapper lines added before user shader code |

---

## 12. Architectural Patterns & Conventions

### Extension Pattern
All webview content injection follows the `WebviewExtension` interface. To add new functionality:
1. Create a class implementing `WebviewExtension`
2. In `WebviewContentProvider.generateWebviewContent()`, instantiate it and register via `addWebviewModule()` or `addReplaceModule()`
3. Add a corresponding placeholder line in `webview_base.html`

### Template-Driven Assembly
The webview is NOT built programmatically — it starts from a real HTML template (`webview_base.html`) and extensions inject content at specific comment/placeholder lines. This keeps the HTML structure readable and allows the template to function as documentation.

### State Persistence via IPC
All user-interactive state (time, mouse, pause, keyboard, camera, uniforms) is reported back to the extension host via IPC and stored in `RenderStartingData`. On reload, these values are injected as initial state into the new webview content.

### Resource Loading
Resources are loaded from the extension's `resources/` directory using `context.getResourceUri()`. In webview context, these are translated to webview-safe URIs via `webview.asWebviewUri()`. In standalone mode, CDN URLs or inline scripts are used instead.

### Shader Preamble
Every shader receives a standard preamble (uniforms for `iResolution`, `iTime`, `iMouse`, channels 0-9, keyboard, etc.) plus optional keyboard and custom uniform preambles. The preamble line count is tracked precisely for error line offset correction.

### Error Hook Pipeline
The error display system uses a pluggable hook pattern (`glsl_error_hook.js`) allowing feature-specific error transforms without modifying the core error display logic. This is the intended extension point for FragCoord error rewriting.

### Naming Conventions
- Extension classes: `PascalCase` with `Extension` suffix
- Extension files: `snake_case_extension.ts`
- Template placeholders: `<!-- Comment Name -->` (HTML comments) or `// Comment Name` (JS comments)
- IPC commands: `camelCase` strings
- Config settings: `camelCase` under `shader-toy.*`

---

## 13. Extension Points & Gaps

### Existing Extension Points
- **`WebviewExtension` interface** — add any content to the webview template
- **`glslError.registerRewriter()`** — pluggable error line/message rewriting
- **`ShaderPreambleExtension.addPreambleExtension()`** — extend shader preamble
- **`TexturesInitExtension.addTextureContent()`** — extend texture loading
- **IPC `onDidReceiveMessage`** — handle new webview→host message types

### Architectural Gaps (relevant for feature integration)
1. **No addon panel system:** Only preview panels exist. There's no infrastructure for auxiliary panels (inspector, heatmap, frames graph). The sequencer-based pattern documented in `shadertoyPanels-overview.md` would need to be built.
2. **No shader rewriting pipeline:** The parser strips directives but doesn't transform GLSL code. Inspect/heatmap features require AST-level or regex-level shader rewriting.
3. **No float FBO readback:** The render pipeline uses THREE.js abstractions. Direct `gl.readPixels()` on float framebuffers would need to bypass THREE.js or use raw WebGL alongside it.
4. **No GPU timer queries:** `EXT_disjoint_timer_query_webgl2` is not used. Frame profiling would need to add this.
5. **No gutter decoration API usage:** VS Code's `TextEditorDecorationType` API is not currently used. Heatmap per-line counts would need this.
6. **Render loop is not extensible:** The render loop is a monolithic inline script. Inserting diagnostic renders (inspect overlay, heatmap pass) would require either extending the template or using the placeholder modules (`render_loop.js`, `ui_controls.js`, `time_input.js`).
7. **Three placeholder modules** (`ui_controls.js`, `time_input.js`, `render_loop.js`) are empty — designed as future extension points for exactly this kind of feature work.
8. **Empty `deactivate()`:** No cleanup of event listeners, panels, or timers on deactivation (see §3.1). If the extension is ever hot-reloaded by the Extension Development Host without a window reload, leaked handlers may cause ghost callbacks.
9. **CI fragility:** GitHub Actions workflows use severely outdated action versions (v1/v2) and the publish workflow targets Node 10.x (EOL). No matrix testing, no lint in CI (see §2 CI section).
10. **Only 1 TODO in the entire codebase:** `src/shaderparser.ts` — _"Check if type is array type"_ — suggesting uniform array types may not be fully validated.

---

## 14. Dependency Map

```
extension.ts
  ├── Context
  │     ├── vscode (ExtensionContext, WorkspaceConfiguration, DiagnosticCollection)
  │     └── typenames (DiagnosticBatch)
  ├── ShaderToyManager
  │     ├── Context
  │     ├── WebviewContentProvider
  │     │     ├── BufferProvider
  │     │     │     ├── ShaderParser
  │     │     │     │     ├── ShaderLexer
  │     │     │     │     │     └── ShaderStream
  │     │     │     │     └── ShaderStream
  │     │     │     ├── Context
  │     │     │     ├── typenames
  │     │     │     └── constants (SELF_SOURCE_ID)
  │     │     ├── WebviewContentAssembler
  │     │     │     ├── WebviewContent
  │     │     │     │     └── resources/webview_base.html (file read)
  │     │     │     └── WebviewExtension (interface)
  │     │     ├── 60 WebviewExtension implementations + 4 support files
  │     │     ├── Context
  │     │     ├── typenames
  │     │     └── constants (SELF_SOURCE_ID, WEBGL2_EXTRA_SHADER_LINES)
  │     └── typenames (RenderStartingData, DiagnosticBatch)
  └── compare-versions (version check)

Webview Runtime (browser)
  ├── THREE.js r110
  ├── jQuery
  ├── Stats.js (optional)
  ├── dat.GUI (optional)
  ├── CCapture.js (optional)
  └── resources/webview/*.js (7 modules)
```

---

## 15. Full File Inventory

### Source (`src/`)

| File | Lines | Role |
|---|---|---|
| `extension.ts` | 103 | Entry point, command registration, event wiring |
| `context.ts` | 209 | VS Code API facade |
| `shadertoymanager.ts` | 403 | Panel lifecycle, IPC hub, state management, hot reload |
| `webviewcontentprovider.ts` | 529 | Assembly orchestrator |
| `webviewcontentassembler.ts` | 110 | Template injection engine |
| `webviewcontent.ts` | 39 | Template file reader/mutator |
| `bufferprovider.ts` | 843 | Shader tree walk, directive processing |
| `shaderparser.ts` | 669 | Recursive descent directive parser |
| `shaderlexer.ts` | 351 | Tokenizer |
| `shaderstream.ts` | 121 | Character stream with mutation support |
| `typenames.ts` | 122 | Shared type definitions |
| `constants.ts` | 10 | SELF_SOURCE_ID, WEBGL2_EXTRA_SHADER_LINES |
| `utility.ts` | 13 | `removeDuplicates()` |
| `extensions/` | 60 impl + 4 support | WebviewExtension implementations + support files |

### Resources (`resources/`)

| File/Dir | Role |
|---|---|
| `webview_base.html` | Master HTML template (773 lines, 44 injection anchors) |
| `webview/*.js` | 7 runtime JS modules |
| `three.min.js` | THREE.js r110 |
| `jquery.min.js` | jQuery |
| `stats.min.js` | Stats.js r16 |
| `dat.gui.min.js` | dat.GUI |
| `CCapture.all.min.js` | CCapture.js |
| `*.png` | Button icons (pause, play, record, stop, screenshot, reload, thumb) |

### Tests (`test/`)

| File | Focus |
|---|---|
| `extension.test.ts` | Activation smoke test |
| `error_lines_regression.test.ts` | Error line offset correctness |
| `better_diag_main_injection.test.ts` | `main()` injection heuristics |
| `better_diag_runtime_env.test.ts` | Runtime env module |
| `dds_parser.test.ts` | DDS texture parser |
| `glsl_es_compat.test.ts` | GLSL ES shims |
| `ivertex.test.ts` | Vertex shader directive |
| `textures_init_extension.test.ts` | Texture code gen |
| `webview_split.test.ts` | Module script loading |

---

---

## Appendix: Pass 2 Changelog

Changes from the pass 1 report (2026-02-27):

1. **All line counts verified** via `wc -l` — corrected 14 file-level metrics (most were off by 1, `shadertoymanager.ts` was off by ~50).
2. **Hot Reload mechanism documented** (§3.4) — entirely missing from pass 1. This is a critical path for the live-editing UX.
3. **`deactivate()` risk identified** (§3.1) — empty cleanup function noted as latent resource-leak risk.
4. **CI / GitHub Actions section added** (§2) — outdated action versions, Node 10.x publish risk, fragile cross-workflow trigger, no matrix/lint.
5. **4 non-WebviewExtension files identified** (§5.4) — `error_display_wrapper.ts` (138 lines) is a significant shared utility that was invisible in pass 1's "62 extensions" count.
6. **Test coverage gap analysis added** (§10) — ~20% structural coverage, with specific subsystems identified as untested.
7. **Template placeholder inventory** — exact count of 44 anchors (22 HTML + 22 JS) now in §6.1.
8. **Frames Panel** documented (§8.11) — `framespanel.ts` (121 lines) was not mentioned in pass 1.
9. **Single TODO noted** (§4.3) — `shaderparser.ts` array type check.
10. **Extension count corrected** — 60 implementations + 4 support files (not "62 implementations").
11. **Branch/scope corrected** — report now references master branch, not `wip1#fragcoord`.
12. **Gaps section expanded** (§13) — added `deactivate()`, CI, and codebase TODO risks.

---

*End of report (pass 2).*
