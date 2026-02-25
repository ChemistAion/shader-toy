---
name: shader-toy
description: Reference skill for the shader-toy VSCode extension with directives, workflows, and debugging guidance for GLSL preview, multipass rendering, and audio synthesis.
---

# Shader Toy — VSCode Extension Skill Document

> Source-verified capability map for the `shader-toy` VSCode extension (v0.11.4).
> Repository: `stevensona/shader-toy`

---

## 1. Overview

**What it is:** A Visual Studio Code extension that provides a live WebGL/WebGL2 preview of GLSL fragment shaders in a side-panel webview, analogous to [shadertoy.com](https://shadertoy.com).

**User personas:**
- Shader authors prototyping visual effects (raymarching, SDFs, procedural textures)
- Audio/synth developers writing GPU-based sound synthesis (`mainSound`)
- Educators and students learning real-time graphics

**Primary workflows:**
1. Open a `.glsl` file → run "Shader Toy: Show GLSL Preview" → live-edit with hot reload
2. Multi-pass rendering via `#iChannel` cross-referencing between `.glsl` files
3. Audio synthesis via `#iSound` directives and `mainSound()` entry points (WebGL2 only)
4. Screenshot / video recording of shader output
5. Export portable standalone HTML preview

---

## 2. Session / Project File Format

There is no dedicated project file. A shader session is defined implicitly by:

| Aspect | Mechanism |
|--------|-----------|
| Entry point | The `.glsl` file currently open in the active editor |
| Dependencies | `#iChannelN`, `#include`, `#iVertex`, `#iSoundN` directives in shader source |
| Configuration | `shader-toy.*` settings in VSCode `settings.json` (workspace or user) |
| Texture assets | Local files (`file://…`), remote URLs (`https://…`), or buffer references (`"self"`, other `.glsl` files) |

The extension parses the shader tree on every preview open / reload. There is no intermediate serialization format.

---

## 3. Object / Item Model

### 3.1 BufferDefinition (core data model)

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
| `IsSound` | `boolean?` | True if buffer defines `mainSound()` or is an `#iSound` target |
| `SoundIndices` | `number[]?` | Which `#iSoundN` indices target this buffer |
| `SoundPrecision` | `string?` | `"32bFLOAT"`, `"16bFLOAT"`, or `"16bPACK"` |
| `UsesKeyboard` | `boolean?` | True if `#iKeyboard` is declared |
| `UsesFirstPersonControls` | `boolean?` | True if `#iFirstPersonControls` is declared |

### 3.2 TextureDefinition

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

### 3.3 AudioDefinition

| Property | Type | Description |
|----------|------|-------------|
| `Channel` | `number` | iChannel index |
| `LocalPath` | `string?` | Local audio file path |
| `RemotePath` | `string?` | Remote audio URL |
| `UserPath` | `string` | Original user-specified path |
| `FromSound` | `boolean?` | True if channel is fed by a sound shader output |
| `SoundIndex` | `number?` | Index of the sound shader feeding this channel |

### 3.4 UniformDefinition

| Property | Type | Description |
|----------|------|-------------|
| `Name` | `string` | GLSL variable name |
| `Typename` | `string` | GLSL type (`float`, `vec2`, `vec3`, `vec4`, `int`, `ivec2`–`ivec4`, `color3`) |
| `Default` | `number[]?` | Default value(s) |
| `Min` | `number[]?` | Range minimum |
| `Max` | `number[]?` | Range maximum |
| `Step` | `number[]?` | Slider increment (defaults to 1.0 for integer types) |

### 3.5 IncludeDefinition

| Property | Type | Description |
|----------|------|-------------|
| `Name` | `string` | Unique name from file path |
| `File` | `string` | Absolute file path |
| `Code` | `string` | Transformed include source |
| `LineCount` | `number` | Number of lines in transformed code |

---

## 4. Enums & Allowed Values

### 4.1 TextureMagFilter
Source: `src/typenames.ts`

| Value | Description |
|-------|-------------|
| `Linear` | Bilinear filtering (default) |
| `Nearest` | Nearest-neighbor filtering |

### 4.2 TextureMinFilter

| Value | Description |
|-------|-------------|
| `Nearest` | Nearest-neighbor |
| `NearestMipMapNearest` | Nearest with nearest mipmap |
| `NearestMipMapLinear` | Nearest with linear mipmap |
| `Linear` | Bilinear (default) |
| `LinearMipMapNearest` | Linear with nearest mipmap |
| `LinearMipMapLinear` | Trilinear filtering |

> Many mipmap options require power-of-two texture dimensions (WebGL constraint).

### 4.3 TextureWrapMode

| Value | Description |
|-------|-------------|
| `Repeat` | Tile (default, matches shadertoy.com) |
| `Clamp` | Clamp to edge |
| `Mirror` | Mirror repeat |

### 4.4 TextureType

| Value | Description |
|-------|-------------|
| `Texture2D` | Standard 2D texture (default) |
| `CubeMap` | Cubemap (requires `{}` wildcard in path) |

### 4.5 Cubemap Face Resolution Sets
Tried in order until all 6 faces resolve:

| Set | Faces |
|-----|-------|
| Short letters | `e`, `w`, `u`, `d`, `n`, `s` |
| Full words | `east`, `west`, `up`, `down`, `north`, `south` |
| OpenGL short | `px`, `nx`, `py`, `ny`, `pz`, `nz` |
| OpenGL long | `posx`, `negx`, `posy`, `negy`, `posz`, `negz` |

### 4.6 Custom Uniform Types (Lexer)
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

### 4.7 Sound Precision Formats
Source: `src/bufferprovider.ts` (ObjectType.SoundFormat)

| Value | Description |
|-------|-------------|
| `32bFLOAT` | 32-bit float per channel (default) |
| `16bFLOAT` | 16-bit half-float per channel |
| `16bPACK` | 16-bit packed encoding |

### 4.8 WebGL Version Setting

| Value | Behavior |
|-------|----------|
| `Default` | Prefers WebGL2, falls back to WebGL1 |
| `WebGL2` | Requires WebGL2; enables GLSL ES 3.00, `#iVertex`, `mainSound` |

### 4.9 Recording Codecs

| Value |
|-------|
| `vp8` (default) |
| `vp9` |
| `h264` |
| `avc1` |

### 4.10 Offline Recording Formats

| Value | Description |
|-------|-------------|
| `webm` | Video file (default) |
| `gif` | Animated GIF |
| `png` | PNG frames in .tar archive |
| `jpg` | JPEG frames in .tar archive |

---

## 5. Evaluation / Execution Pipeline

### 5.1 Shader Parsing Pipeline

```
.glsl file (active editor)
  ↓
BufferProvider.parseShaderCode()
  ├─ ShaderParser (lexer + parser) extracts directives
  │   ├─ #include → inline expand with #line directives
  │   ├─ #iChannelN → TextureDefinition / AudioDefinition
  │   ├─ #iVertex → link vertex shader file
  │   ├─ #iSoundN → register sound shader file
  │   ├─ #iUniform → UniformDefinition
  │   ├─ #iKeyboard → flag
  │   ├─ #iFirstPersonControls → flag
  │   └─ #StrictCompatibility → flag
  ├─ Strips directives from code (mutates stream)
  ├─ Detects entry point: main() vs mainImage() vs mainSound()
  ├─ Generates mainImage→main wrapper if needed
  ├─ Generates mainSound(float)↔mainSound(int,float) adapters
  ├─ Optional glslify transform
  └─ Pushes BufferDefinition into buffers[]
       ↓
  Recursively parses #iChannel dependencies (other .glsl files)
  Recursively parses #iSound target files
       ↓
  Resolves buffer cross-references and self-feedback
  Adds final-blit pass if last buffer uses self
```

### 5.2 Webview Content Assembly

```
WebviewContentProvider
  ├─ parseShaderTree() → buffers[], commonIncludes[], localResources[]
  └─ generateWebviewContent() / generateHotReloadPayload()
       ├─ WebviewContentAssembler reads webview_base.html template
       ├─ Extensions inject/replace content at placeholder lines
       ├─ Shader code embedded in <textarea data-shadertoy='shader'>
       ├─ Include code embedded in <textarea data-shadertoy='include'>
       └─ Returns assembled HTML string → set as webview.html
```

### 5.3 Rendering Loop (webview)

```
Three.js scene with orthographic camera
  ├─ For each buffer (in dependency order):
  │   ├─ Bind textures (iChannel0–9, iKeyboard, iSampleRing0–9)
  │   ├─ Update uniforms (iTime, iTimeDelta, iFrame, iMouse, iDate, etc.)
  │   ├─ Render to offscreen RenderTarget (or screen for last pass)
  │   └─ Ping-pong targets if UsesSelf
  ├─ Update audio textures (FFT + waveform)
  ├─ Update keyboard texture
  ├─ requestAnimationFrame loop
  └─ Stats.js overlay (optional)
```

### 5.4 Hot Reload

On document change (after configurable delay) or save:
1. Re-parse entire shader tree
2. If webview resource roots unchanged → post `hotReload` message with payload
3. Payload contains: new shader HTML, new include HTML, init script, preserved state (time, mouse, camera)
4. Webview replaces `<textarea>` nodes, re-runs init script, recompiles shaders
5. If resource roots changed → full webview teardown and recreation

### 5.5 Audio Synthesis Pipeline (WebGL2 only)

```
mainSound() shader
  ├─ Compiled as fragment shader with audio footer (packs samples to pixels)
  ├─ Rendered to offscreen render target (dimensions from audioBlockSize)
  ├─ GPU readback: PBO+fence (WebGL2) or readPixels fallback
  ├─ Decoded to Float32 audio samples
  └─ Pushed to AudioWorklet via MessagePort
       ├─ Worklet queues blocks, requests more via "need" messages
       ├─ Worklet drives playback at native sample rate (48kHz typical)
       └─ Ring buffers (iSampleRingN) provide sample history for DSP
```

---

## 6. Scripting / API Surface

### 6.1 Shader Directives (Preprocessor)

| Directive | Syntax | Description |
|-----------|--------|-------------|
| `#iChannelN` | `#iChannel0 "path"` | Bind texture/buffer/audio to channel N (0–9) |
| `#iChannelN::MagFilter` | `#iChannel0::MagFilter "Nearest"` | Set magnification filter |
| `#iChannelN::MinFilter` | `#iChannel0::MinFilter "LinearMipMapLinear"` | Set minification filter |
| `#iChannelN::WrapMode` | `#iChannel0::WrapMode "Repeat"` | Set wrap mode |
| `#iChannelN::Type` | `#iChannel0::Type "CubeMap"` | Set texture type |
| `#include` | `#include "path.glsl"` | Inline include (recursive, with `#line` remapping) |
| `#iVertex` | `#iVertex "vertex.glsl"` | Attach vertex shader (WebGL2 only) |
| `#iSoundN` | `#iSound0 "synth.glsl"` | Bind sound shader at index N (0–9, WebGL2 only) |
| `#iSoundN::Format` | `#iSound0::Format "16bPACK"` | Set sound output precision |
| `#iSound::Format` | `#iSound::Format "32bFLOAT"` | Set precision for self (mainSound in same file) |
| `#iUniform` | `#iUniform float x = 1.0 in {0.0, 5.0} step 0.1` | Custom uniform with GUI |
| `#iKeyboard` | `#iKeyboard` | Enable keyboard input functions |
| `#iFirstPersonControls` | `#iFirstPersonControls` | Enable fly camera + `iViewMatrix` |
| `#StrictCompatibility` | `#StrictCompatibility` | Force shadertoy.com compatibility mode |

### 6.2 Built-in Uniforms (Shader Preamble)

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
| `iAudioTime` | `float` | Current audio playback time |
| `iSampleBlockSize` | `int` | Audio render block size in samples |
| `iSampleRingBlockSize` | `int` | Ring buffer block size |
| `iSampleRingDepth` | `int` | Ring buffer depth (number of history blocks) |
| `iSoundIndex` | `int` | Current sound shader index being rendered |
| `iSampleRing0`–`iSampleRing9` | `sampler2D` | Audio sample ring buffer textures |

**Aliases:**
- `iGlobalTime` → `iTime`
- `iGlobalFrame` → `iFrame`

**Preprocessor define:** `SHADER_TOY` is always defined.

### 6.3 Shader Entry Points

| Entry Point | Signature | Context |
|-------------|-----------|---------|
| `void main()` | Standard GLSL entry | Default fragment shader |
| `void mainImage(out vec4 fragColor, in vec2 fragCoord)` | Shadertoy.com compatible | Auto-wrapped with `void main()` |
| `vec2 mainSound(float sampleTime)` | Sound shader (time-based) | WebGL2 only; auto-generates `int` overload |
| `vec2 mainSound(int sampleIndex, float sampleTime)` | Sound shader (index+time) | WebGL2 only; auto-generates `float` overload |

### 6.4 Keyboard API (GLSL)

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

### 6.5 First-Person Controls

Enabled via `#iFirstPersonControls`. Populates `iViewMatrix` uniform.

| Key | Action |
|-----|--------|
| W/A/S/D | Move forward/left/back/right |
| R / F | Move up / down |
| Q / E | Roll left / right |
| Up / Down | Pitch |
| Left / Right | Yaw |

---

## 7. Extensibility

### 7.1 Extension Architecture

The webview HTML is assembled from a template (`resources/webview_base.html`) using a module system:

```
WebviewContentAssembler
  ├─ Reads webview_base.html
  ├─ Finds placeholder lines (e.g. "// Buffers", "<!-- Shaders -->")
  ├─ WebviewExtension.generateContent() → inserts/replaces content
  └─ Returns assembled HTML
```

Each extension implements `WebviewExtension` interface with a single method: `generateContent(): string`.

### 7.2 Extension Categories

| Category | Extensions | Purpose |
|----------|-----------|---------|
| **Buffers** | `BuffersInitExtension`, `ShadersExtension`, `IncludesExtension`, `IncludesInitExtension`, `IncludesTestCompileExtension` | Buffer graph initialization, shader embedding |
| **Audio** | `AudioInitExtension`, `AudioUpdateExtension`, `AudioPauseExtension`, `AudioResumeExtension`, `NoAudioExtension`, `AudioOutputPrecisionExtension`, `AudioBlockSizeExtension`, `AudioWorkletUrlExtension`, `AudioWorkletSourceExtension` | Audio pipeline setup |
| **Keyboard** | `KeyboardInitExtension`, `KeyboardUpdateExtension`, `KeyboardCallbacksExtension`, `KeyboardShaderExtension` | Keyboard input and GLSL API |
| **Textures** | `TexturesInitExtension` | Texture/cubemap/DDS loading |
| **Uniforms** | `UniformsInitExtension`, `UniformsUpdateExtension`, `UniformsPreambleExtension` | Custom uniform GUI (dat.GUI) |
| **UI** | `PauseButtonExtension`, `ScreenshotButtonExtension`, `RecordButtonExtension`, `ReloadButtonExtension`, `SoundButtonExtension` + style extensions | Webview control buttons |
| **Packages** | `JQueryExtension`, `ThreeExtension`, `StatsExtension`, `DatGuiExtension`, `CCaptureExtension`, `ThreeFlyControlsExtension` | Third-party library injection |
| **Error Display** | `DefaultErrorsExtension`, `DiagnosticsErrorsExtension`, `GlslifyErrorsExtension`, `IvertexErrorRewriteExtension` | GLSL compile error handling |
| **State** | `InitialTimeExtension`, `InitialPausedExtension`, `InitialMouseExtension`, etc. | State preservation across reloads |

### 7.3 VSCode Extension Commands

Source: `package.json`

| Command ID | Title |
|-----------|-------|
| `shader-toy.showGlslPreview` | Shader Toy: Show GLSL Preview |
| `shader-toy.showStaticGlslPreview` | Shader Toy: Show Static GLSL Preview |
| `shader-toy.createPortableGlslPreview` | Shader Toy: Create Portable GLSL Preview |
| `shader-toy.pauseGlslPreviews` | Shader Toy: Pause/Play GLSL Previews |
| `shader-toy.saveGlslPreviewScreenShots` | Shader Toy: Save GLSL Preview Screenshots |

### 7.4 Webview ↔ Extension IPC Messages

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

---

## 8. Built-in Debugging / Diagnostics

### 8.1 GLSL Compile Errors

- Errors parsed from WebGL `getShaderInfoLog()` and displayed:
  - Inline in the webview (clickable to jump to source line)
  - As VSCode diagnostics (when `showCompileErrorsAsDiagnostics` is enabled)
- Line numbers remapped through include expansion and preamble offsets
- `#line` directives with source IDs enable multi-file error attribution
- `SELF_SOURCE_ID = 65535` sentinel for current-file `#line` directives
- `WEBGL2_EXTRA_SHADER_LINES = 16` offset compensates for WebGL2 preamble

### 8.2 Stats / Performance

- Stats.js frame time graph (configurable via `printShaderFrameTime`)
- Shader compile-time panel
- Audio debug overlay (when audio pipeline active):
  - Precision, sample rate, block duration
  - Render dimensions, rendered block count
  - Buffer pool state (free/total)
  - Worklet queue depth (samples + ms)
  - Worklet underruns
  - Ring buffer capacity
  - RMS audio levels

### 8.3 Warnings

- Undefined texture channel usage (when `warnOnUndefinedTextures` enabled)
- Non-power-of-two texture dimensions
- Deprecated feature usage (unless `omitDeprecationWarnings`)
- glslify module resolution failures (with install suggestion)
- Vertex shader file opened as fragment shader (auto-detected)

---

## 9. Samples / Demos Catalogue

### 9.1 Visual Demos

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

### 9.2 Texture / Buffer Demos

| Demo | Features Used | Description |
|------|--------------|-------------|
| `blending.glsl` | `#iChannel0`, `#iChannel1`, wrap modes | Alpha mask blending of two textures |
| `feedback.glsl` | `#iChannel0` (self), `iFrame`, `iTimeDelta` | Temporal feedback blur effect |
| `swirl_spin.glsl` | `#iChannel0` (self) | Rotating swirl with self-feedback |
| `bouncing.glsl` | `#iChannel0` (self), `iFrame` | Bouncing balls with persistent state in texture |
| `buffer_a.glsl` | `#iChannel0` (self) | Ball position storage/retrieval from texture |
| `multipass.glsl` | `#iChannel0`, `#iChannel1` | Multi-pass UV displacement composition |
| `uv-warp.glsl` | `#iChannel0`, `#iChannel1` | Texture-based UV remapping |

### 9.3 Cubemap Demo

| Demo | Features Used | Description |
|------|--------------|-------------|
| `cubemap.glsl` | `#iChannel0` (CubeMap), `#iChannel0::Type "CubeMap"` | 3D metaballs with cubemap environment reflection |

### 9.4 Input Demos

| Demo | Features Used | Description |
|------|--------------|-------------|
| `keyboard.glsl` | `#iKeyboard`, key state functions | Interactive key state visualization (circles) |
| `keyquest.glsl` | `#iKeyboard` | Text-based adventure game with keyboard navigation |
| `fly_controls.glsl` | `#iFirstPersonControls`, `iViewMatrix` | First-person SDF raymarching with fly camera |
| `audio.glsl` | `#iChannel0` (mp3 audio) | FFT spectrum + waveform visualization |

### 9.5 Custom Uniform Demos

| Demo | Features Used | Description |
|------|--------------|-------------|
| `dds_loader.glsl` | `#iChannel0/1` (DDS), `#iUniform float/color3` | LTC lookup table visualization |
| `ltc_quad.glsl` | `#iChannel0/1` (DDS), `#iUniform float/color3` | Physically-based area light with LTC |

### 9.6 WebGL2 / Vertex Shader Demos

| Demo | Features Used | Description |
|------|--------------|-------------|
| `webgl2_features.glsl` | WebGL2 builtins (`packHalf2x16`, etc.) | Pack/unpack function showcase |
| `webgl2_iVertexDemo.glsl` | `#iChannel0/1/2`, multi-pass | Composites background + two vertex shader passes |
| `vertex/pass1.glsl` | `#iVertex "pass1_iVertex.glsl"`, `in vec2 vUV` | Animated rings with custom triangle mesh |
| `vertex/pass1_iVertex.glsl` | `gl_VertexID`, `gl_Position` | Procedural triangle from vertex ID |
| `vertex/pass2.glsl` | `#iVertex "pass2_iVertex.glsl"`, `in vec2 vUV` | Striped pattern on custom triangle |
| `vertex/pass2_iVertex.glsl` | `gl_VertexID`, `gl_Position` | Second procedural triangle mesh |

### 9.7 Volumetric Demos

| Demo | Features Used | Description |
|------|--------------|-------------|
| `volume_points_0.glsl` | `#include`, `mainVolume` (custom) | 3D volumetric texture generator (2D storage) |
| `volume_points_1.glsl` | `#iChannel0`, `#iUniform`, volumetric sampling | Point cloud visualization with rotation |
| `volume_points_common.glsl` | Shared library | 3D texture packing, euler rotation, interpolation |

### 9.8 Audio Synthesis Demos (WebGL2)

| Demo | Features Used | Description |
|------|--------------|-------------|
| `synth/supersaw_iSound.glsl` | `mainSound` | Complete synth: sawtooth unison, drums, noise percussion |
| `synth/rain_iSound.glsl` | `mainSound` | Procedural rain with lightning and distortion |
| `synth/chords_iSound.glsl` | `#iSound0`, `#include`, `mainSound` | Chord synth with sawtooth waves and echo |
| `synth/echo_iSound.glsl` | `#iSound0`, ring-buffer sampling | Echo effect with delay taps via iSampleRing |
| `synth/sampling_iSound.glsl` | Ring-buffer sampling | Audio rate manipulation (undersample / supersample) |
| `synth_visualizer.glsl` | `#iSound1`, `#iSound2`, `#iChannel0 "sound0"` | FFT bars + L/R waveform visualization |

### 9.9 Shared Libraries

| File | Purpose |
|------|---------|
| `common/blobby.glsl` | `saturate`, `rotate` functions; includes `math-common.glsl` |
| `common/math-common.glsl` | `PI` constant |
| `synth/common.glsl` | Hash function, MIDI note-to-frequency conversion |
| `synth/sampler_helpers.glsl` | Ring-buffer audio history sampling utilities |

### 9.10 Other Resources

| File | Type | Purpose |
|------|------|---------|
| `cubemap/*.jpg` | Image | Cubemap face textures (Yokohama panorama) |
| `lut/ltc_1.dds`, `lut/ltc_2.dds` | Binary | LTC lookup tables for area light shading |
| `horizon.jpg` | Image | Texture used by duck.glsl |
| `outfoxing.mp3` | Audio | Audio input for audio.glsl demo |
| `glslify.glsl` | GLSL | glslify module system demo (`#pragma glslify`) |

---

## 10. VSCode Configuration Settings (Complete)

Source: `package.json` contributes.configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `shader-toy.forceAspectRatio` | `[number, number]` | `[0, 0]` | Force rendering aspect ratio (0 = ignore) |
| `shader-toy.webglVersion` | `"Default"` \| `"WebGL2"` | `"Default"` | WebGL mode; WebGL2 enables GLSL 300 ES + `#iVertex` + `mainSound` |
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

> **Undocumented in package.json but used in code:** `audioOutputPrecision` (string, default `"32bFLOAT"`), `audioBlockSize` (number, default `1024`), `showSoundButton` (boolean, default `true`). These are read by `WebviewContentProvider` but not declared in `package.json` contributes — they appear to be from the sound synth RC branches not yet merged to manifest.

---

## 11. Recipes / Playbooks

### 11.1 Fullscreen Fragment Shader

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    fragColor = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0);
}
```

### 11.2 Self-Feedback (Ping-Pong)

```glsl
#iChannel0 "self"
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec4 prev = texture2D(iChannel0, uv);
    fragColor = mix(prev, vec4(1.0, 0.0, 0.0, 1.0), 0.01);
}
```

### 11.3 Multi-Pass (Shader as Texture)

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

### 11.4 Texture Input with Sampling Options

```glsl
#iChannel0 "file://duck.png"
#iChannel0::MagFilter "Nearest"
#iChannel0::MinFilter "NearestMipMapNearest"
#iChannel0::WrapMode "Repeat"
```

### 11.5 Cubemap

```glsl
#iChannel0 "file://cubemaps/yokohama_{}.jpg"
#iChannel0::Type "CubeMap"
```

### 11.6 Custom Uniforms with GUI

```glsl
#iUniform float speed = 1.0 in { 0.0, 10.0 } step 0.1
#iUniform color3 tint = color3(1.0, 0.5, 0.2)
#iUniform vec2 offset = vec2(0.0, 0.0) in { -1.0, 1.0 }

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy + offset;
    fragColor = vec4(tint * (0.5 + 0.5 * sin(iTime * speed)), 1.0);
}
```

### 11.7 Vertex Shader (WebGL2)

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

### 11.8 Audio Synthesis (WebGL2)

Requires: `shader-toy.webglVersion` = `"WebGL2"`

```glsl
vec2 mainSound(float sampleTime) {
    float freq = 440.0;
    float val = sin(6.2831853 * freq * sampleTime);
    return vec2(val);
}
```

### 11.9 Sound Shader with Ring-Buffer Sampling

```glsl
#iSound0 "synth.glsl"
#include "sampler_helpers.glsl"
vec2 mainSound(float t) {
    vec2 dry = sampleSound(iSampleRing0, t, iSampleRate,
                           iSampleRingBlockSize, iSampleRingDepth);
    vec2 echo = sampleSound(iSampleRing0, t - 0.3, iSampleRate,
                            iSampleRingBlockSize, iSampleRingDepth);
    return dry + echo * 0.5;
}
```

### 11.10 Include Files

```glsl
// utils.glsl (no void main() allowed)
float saturate(float x) { return clamp(x, 0.0, 1.0); }

// main.glsl
#include "utils.glsl"
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = vec4(vec3(saturate(sin(iTime))), 1.0);
}
```

### 11.11 DDS Float Texture (LUT) Loading

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

## 12. Known Limits / Caveats

### 12.1 WebGL Constraints
- Mipmap filter options require power-of-two texture dimensions
- WebGL1 mode does not support `#iVertex`, `mainSound`, or GLSL ES 3.00 features
- Cubemap textures require exactly 6 faces matching one of the 4 naming conventions

### 12.2 Audio Constraints
- Audio input from files requires `enabledAudioInput` = true (disabled by default)
- Audio input does not work inside VSCode (requires standalone build with ffmpeg)
- Remote audio sources are currently broken (Electron limitation)
- Audio synthesis (`mainSound`) requires `webglVersion` = `"WebGL2"`
- Audio output is AudioWorklet-only; no fallback if AudioWorklet fails
- `#iSound "self"` is not supported; use explicit file paths

### 12.3 Shader Compatibility
- `void main()` detection uses regex: `/void\s+main\s*\(\s*\)\s*\{/g`
  - To define main() alongside extension's auto-generated one, use `void main(void)` signature
- `#StrictCompatibility` or `shaderToyStrictCompatibility` setting always generates mainImage wrapper
- `#version` directives are silently stripped (version is controlled by webglVersion setting)
- glslify support disables line number reporting for errors
- `#iSample` is deprecated and no longer supported; use `iSampleRingN` instead

### 12.4 Include System
- Include files must not define `void main()`
- Includes are inlined with `#line` directive remapping for error attribution
- Nested includes are supported
- Include files are optionally compiled separately (`testCompileIncludedFiles`)

### 12.5 Vertex Shaders
- Only available when `webglVersion` = `"WebGL2"`
- Must write to `gl_Position`
- Can declare `out` variables consumed by fragment shader as `in`
- `#iVertex "self"` is not supported; use `"default"` or a file path

### 12.6 Recording
- Real-time recording may drop frames on complex shaders
- Only `webm` container is currently supported for real-time recording
- Offline recording renders frame-by-frame (no drops) but is slower

### 12.7 Platform
- Static preview command opens a preview not tied to the active editor
- Hot reload preserves time, mouse, camera, keyboard, and uniform GUI state
- Portable preview export creates a standalone HTML file with inlined resources
- Three.js is used as the rendering abstraction layer (orthographic camera, fullscreen quad)

### 12.8 Undocumented / In-Progress Features
- `audioOutputPrecision`, `audioBlockSize`, `showSoundButton` settings are used in code but not declared in `package.json` — these come from the sound synth RC branches
- Audio debug overlay is available when the audio pipeline is active
- PBO+fence readback path is used for audio GPU readback on WebGL2 (falls back to `readPixels`)

---

## 13. Source Architecture Summary

```
src/
├── extension.ts                    # VSCode activation, command registration
├── shadertoymanager.ts             # Webview lifecycle, IPC message handling
├── webviewcontentprovider.ts       # Orchestrates parsing + HTML generation
├── webviewcontentassembler.ts      # Template-based HTML assembly
├── webviewcontent.ts               # Line-oriented HTML file manipulation
├── bufferprovider.ts               # Shader tree parsing, directive processing
├── shaderparser.ts                 # Directive parser (lexer-driven)
├── shaderlexer.ts                  # Tokenizer for shader directives
├── shaderstream.ts                 # Character stream with mutation support
├── typenames.ts                    # Core type definitions and enums
├── constants.ts                    # SELF_SOURCE_ID, WEBGL2_EXTRA_SHADER_LINES
├── context.ts                      # VSCode API wrapper (config, diagnostics, paths)
├── utility.ts                      # removeDuplicates helper
└── extensions/                     # Modular content generators
    ├── audio/                      # Audio pipeline extensions
    ├── buffers/                    # Buffer/shader/include extensions
    ├── keyboard/                   # Keyboard input extensions
    ├── packages/                   # Third-party library injection
    ├── textures/                   # Texture loading extensions
    ├── uniforms/                   # Custom uniform GUI extensions
    └── user_interface/             # UI button/style extensions
        └── error_display/          # GLSL error handling extensions

resources/
├── webview_base.html               # HTML template with placeholders
├── webview/                        # Runtime JavaScript modules
│   ├── audio_output.js             # AudioWorklet streaming pipeline
│   ├── audio_shader_wrapper.js     # mainSound() shader footer generation
│   ├── audio_worklet_processor.js  # AudioWorklet processor (separate thread)
│   ├── shader_compile.js           # GLSL compilation pipeline
│   ├── glsl_error_hook.js          # Pluggable error rewriting
│   ├── gl_context.js               # WebGL context initialization
│   └── runtime_env.js              # VSCode API wrapper, error handlers
├── three.min.js, jquery.min.js     # Bundled libraries
├── stats.min.js, dat.gui.min.js    # Performance/GUI libraries
├── CCapture.all.min.js             # Recording library
└── *.png                           # UI button icons
```
