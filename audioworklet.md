# AudioWorklet Integration Plan (Stage 7)

## Overview
This document outlines a staged AudioWorklet integration plan for the GLSL preview/synth pipeline. It builds on the existing hot‑reload foundation (stage6) and explicitly allows stopping at stage6 without losing functionality. Each stage is intended to be delivered as its own commit (stage7A → stage7E). The end state adds a stable audio engine, tighter sync, multi‑source mixing, and optional DSP/analysis.

> Reader note: The document mixes an initial plan with living “Stage7x/Stage8x Progress” logs. The logs are chronological and capture decisions and reversals (e.g., feature additions later removed). Treat the progress logs as the authoritative history of what actually shipped, and the staged plan as design intent at the time.

---

## Why AudioWorklet
**Main benefits:**
- Stable audio clock and lower jitter (runs on audio thread).
- True real‑time streaming (producer/consumer ring buffer).
- Sample‑accurate mixing and DSP.
- Better A/V sync by letting audio drive timing.

**What it does NOT solve:**
- Autoplay policy (gesture required).
- GPU stalls or heavy shader compilation (still must handle under‑runs).

---

## Stage6 Baseline (Current)
- GPU audio synthesis writes into a buffer and plays via WebAudio on the main thread.
- Hot‑reload is dependency‑aware and keeps the webview alive.
- Works well for most creative workflows, but timing is tied to main‑thread scheduling.

**Note:** All stage7 steps are additive. If stage7 is not used, stage6 remains fully usable.

---

# Stage7A — AudioWorklet Scaffold (Audio Engine Only)
**Goal:** Introduce a persistent AudioWorklet engine without changing the GPU generation strategy yet.

> Side note: The staged goals were used as checkpoints; some later “Stage8x” work refined or simplified earlier ideas.

### What changes
- Add an `AudioWorkletProcessor` that outputs audio from a ring buffer.
- Worklet manages a transport state (playing, sampleIndex, sampleRate, blockSize).
- Main thread owns buffer fill and pushes chunks into the ring buffer.

### Key behaviors
- The worklet stays alive across hot reloads.
- On reload, the ring buffer can be reset or soft‑seeked.

### Notes
- Hot reload will become the reliable base for swapping audio generators.

---

# Stage7B — Streaming GPU Audio in Real Time
**Goal:** Replace full pre‑render with chunked streaming GPU generation.

### What changes
- Replace full‑buffer pre‑render with **block generation** (e.g. 2048–4096 samples per channel).
- Introduce a **producer/consumer** model:
  - Producer: GPU renders block(s) → ring buffer.
  - Consumer: AudioWorklet pulls data on schedule.
- Under‑run behavior: output silence or hold last block.

### Why this matters
- Audio becomes responsive to edits and interactive changes.
- Better alignment between audio and visuals.

---

# Stage7C — Multi‑Source Mixing (Per‑Channel Sound Shaders)
**Goal:** Support multiple audio sources, each from its own sound shader.

### Concept
Multiple sound shaders can be rendered and mixed:
```
#iSound0 "file://synth/supersaw_iSound.glsl"
#iSound1 "file://synth/drums_iSound.glsl"
#iSound2 "file://synth/vox_iSound.glsl"
```

### Mixing model
- Each sound shader outputs stereo blocks.
- Worklet mixes them (sum/weights/effects):
```
outL = w0*L0 + w1*L1 + w2*L2
outR = w0*R0 + w1*R1 + w2*R2
```

### Why Worklet helps
- Sample‑accurate mixing.
- Consistent timing even with multiple streams.

---

# Stage7D — DSP + Analysis in Worklet
**Goal:** Move analysis and optional DSP into the audio thread.

### What changes
- FFT, RMS, envelopes, spectral peaks computed in worklet.
- Main thread receives **downsampled analysis** at 30–60 Hz.
- Optional DSP nodes (filters, compressors) live inside the worklet.

### Result
- Reliable analysis for visuals.
- No main‑thread timing jitter in analysis.

---

# Stage7E — Audio‑Driven Sync for Visuals
**Goal:** Make audio the master clock for visuals.

### What changes
- Worklet publishes a stable `audioTime` or `sampleIndex`.
- Visuals sample this time to update `iTime` or a dedicated uniform.
- Eliminates drift between audio and animation.

---

# Stage7F — Worklet Loading Reliability + Status
**Goal:** Make worklet module loading resilient and expose status for troubleshooting.

### What changes
- Inline the worklet processor source into the webview as a `<script type="text/plain">` block.
- Loader in `audio_output.js` prefers inline blob load, then fetch+blob, then direct URL.
- Status lines report worklet readiness/failure and streaming stats in real time.

### Why this matters
- Avoids AudioWorklet module load failures in strict webview contexts.
- Provides immediate signal that streaming is active and worklet is ready.

---

# Dependency on Hot Reload (Stage6)
Stage6 is a strong foundation for stage7:
- Hot reload keeps webview + audio engine alive.
- Dependencies are tracked, so editing a sound shader re‑routes to the root preview.
- With stage7, generator updates become more fluid and real‑time.

---

# What Stage7 Adds vs Stage6
### Stage6 is enough if:
- You are okay with main‑thread scheduling.
- You want stable visual editing and audio playback.

### Stage7 is best if:
- You need tight real‑time sync.
- You want multi‑source audio composition.
- You want audio‑thread DSP and analysis.

---

# Implementation Notes & Risks
- Gesture policy still applies (no autoplay bypass).
- GPU → worklet streaming must handle buffer under‑run.
- Worklet message sizes should be small (use ring buffer / SharedArrayBuffer if feasible).

---

# Commit Strategy Summary
- **stage7A:** Worklet scaffold and audio engine base.
- **stage7B:** Real‑time block streaming from GPU.
- **stage7C:** Multi‑source mixing / per‑channel sound shaders.
- **stage7D:** DSP + analysis inside worklet.
- **stage7E:** Audio‑driven visual timing.

Each stage can be merged independently. Stopping at stage6 remains fully viable.

---

# Stage7A Progress (Implemented)
Stage7A scaffold is in place (AudioWorklet pass‑through in the audio chain). Summary:

**Added**
- Worklet processor: `resources/webview/audio_worklet_processor.js`
- URL injection extension: `src/extensions/audio/audio_worklet_url_extension.ts`

**Wired**
- Worklet URL placeholder in template + init/reload options: `resources/webview_base.html`
- URL replacement in webview content: `src/webviewcontentprovider.ts`

**Audio pipeline update**
- Worklet setup and pass‑through routing (gain → worklet → destination, fallback to gain → destination): `resources/webview/audio_output.js`

---

# Stage7B Progress (Implemented)
Stage7B streaming is in place (GPU blocks streamed to the AudioWorklet). Summary:

**Worklet processor**
- Replaced pass‑through with a queued block player that requests more audio when its queue is low: `resources/webview/audio_worklet_processor.js`.

**Streaming pipeline**
- Added block renderer + cache (one GPU block at a time) and queue‑driven streaming into the worklet: `resources/webview/audio_output.js`.
- Worklet requests blocks (`need`) and the main thread responds by rendering blocks and posting them via the worklet port.
- Streaming is used when the worklet is ready; otherwise it falls back to the previous full pre‑render path.

**Analysis hookup**
- Sound‑input splitters now attach to the worklet output when streaming is active so analyser textures still update.

---

# Stage7C Progress (Implemented)
Stage7C multi‑source mixing is in place (multiple `#iSoundN` sources mixed into the output stream). Summary:

**Parser + buffer support**
- Added `#iSoundN` parsing (indexed sound shaders) and `SoundIndices` metadata on sound buffers: `src/shaderlexer.ts`, `src/shaderparser.ts`, `src/typenames.ts`, `src/bufferprovider.ts`.

**Mixing pipeline**
- Audio output now supports multiple sound buffers, mixes them (equal‑weight) per block, and streams the combined output to the worklet: `resources/webview/audio_output.js`.
- Fallback pre‑render path also mixes multiple sound buffers.

---

# Stage7D Progress (Implemented)
Stage7D DSP/analysis wiring is in place (worklet computes simple analysis and reports it). Summary:

**Worklet analysis**
- AudioWorklet now computes RMS for left/right over a sliding window and posts analysis messages at ~30 Hz: `resources/webview/audio_worklet_processor.js`.

**Main‑thread capture**
- Audio output tracks analysis values from the worklet (`rmsL`, `rmsR`, window size) and exposes them for future use: `resources/webview/audio_output.js`.

---

# Stage7E Progress (Implemented)
Stage7E audio‑driven timing is in place (visual time follows the audio clock when available). Summary:

**Audio time source**
- Audio output now tracks transport start time and exposes `getAudioTime()` for the current playback position: `resources/webview/audio_output.js`.

**Render‑loop integration**
- Time advancement uses the audio clock when available, falling back to the previous `THREE.Clock` behavior otherwise: `src/extensions/advance_time_extension.ts`, `src/extensions/advance_time_if_not_paused_extension.ts`.

---

# Stage7F Progress (Implemented)
Stage7F worklet loading reliability + status is in place. Summary:

**Inline worklet + loader fallbacks**
- Worklet processor source is injected into the webview and loaded via inline blob, then fetch+blob, then direct URL as fallback: `resources/webview_base.html`, `resources/webview/audio_output.js`.

**Status/diagnostics**
- Runtime stats and status lines added for worklet readiness and streaming state: `resources/webview/audio_output.js`.

---

# Stage7G Progress (Implemented)
Stage7G audio UX + strict sound directives is in place. Summary:

> Side note: Later Stage8x entries further tightened sound directives and sampling semantics; see Stage8H for the reversal of self‑sampling support.

**Sound directive rules**
- `#iSound` now requires an explicit index (0..9) and duplicate `#iSoundN` in the same root is an error: `src/shaderparser.ts`, `src/bufferprovider.ts`.
- `#iChannel` sound input must be `soundN` (0..9); bare `sound`/`sound://` emits errors: `src/bufferprovider.ts`.

**Sound routing metadata**
- Sound inputs carry `SoundIndex` so each iChannel binding can track its own analysis stream: `src/typenames.ts`, `src/extensions/audio/audio_init_extension.ts`, `resources/webview/audio_output.js`.

**Webview error overlay (directive errors)**
- Directive parsing errors for invalid sound directives are routed into the webview overlay (initial load + hot reload): `src/bufferprovider.ts`, `src/webviewcontentprovider.ts`.

---

# Error-Handling Guidelines (Stage7H)
**Status:** Introduced and validated in Stage7H.

This section is the canonical playbook for surfacing shader directive errors in BOTH places:
1) the webview overlay (user-visible error list in the preview), and
2) the VS Code error popup (toast).

Use this pattern for any future error type (not just sound directives).

## 1) Parse-time safety (avoid Extension Host crashes)
**Problem addressed:** `RangeError: Invalid count value` from negative `.repeat()` during error formatting.

**Fix location:** `src/shaderparser.ts` → `ShaderParser.makeError()`

**Guideline:** Always clamp column and range sizes before building caret/tilde highlights.
- Guard `lastRangeSize` with `Math.max(0, ...)`.
- Guard `lastRangeColumn` with `Math.max(1, ...)`.
- Guard padding count with `Math.max(0, ...)`.

This keeps parser errors non-fatal and ensures the extension host keeps running even when malformed directives appear.

## 2) VS Code popup pathway (toast)
**Goal:** Show a top-right VS Code popup whenever a directive error occurs.

**Implementation:** Route through `Context.showErrorMessage()`.

**Location:** `src/bufferprovider.ts` → `BufferProvider.showErrorAtLineAndMessage()`
- After adding the diagnostic, call:
  - `this.context.showErrorMessage(
      `${message} (${file}:${line})`
    );`

This mirrors the UX of missing texture errors and ensures parity for directives.

## 3) Webview overlay pathway (in-preview error list)
**Goal:** Show directive errors inside the preview overlay, with clickable line links.

**Data collection:** `src/bufferprovider.ts`
- Track errors in `webviewErrors: { file, line, message }[]`.
- Push errors from `showErrorAtLineAndMessage()`.

**Injection:** `src/webviewcontentprovider.ts`
- Build a runtime script in `buildDirectiveErrorScript()` that:
  - Clears `#message`.
  - Prints a header (`Shader directive errors`).
  - Renders a list with clickable line anchors calling `revealError(line, file)`.
- Inject the script for both:
  - Initial load: add as a webview module near `// Error Callback`.
  - Hot reload: append to `initScriptParts` so it reruns after reload.

This keeps errors visible even when GLSL compile does not occur.

## 4) Which errors should use this path?
Any error that is detected before GLSL compilation (directive parsing, include resolution, feature gating) should use:
- `showErrorAtLineAndMessage()` for popup + overlay + diagnostics.

If the error is only visible in the webview runtime (e.g., fetch failures), use:
- `vscode.postMessage({ command: 'errorMessage', message })` from webview code.
- `src/shadertoymanager.ts` already handles `errorMessage` and shows the VS Code popup.

## 5) Summary checklist for new error types
1. **Parser safety:** ensure `ShaderParser.makeError()` remains safe for malformed tokens.
2. **Diagnostics:** call `showErrorAtLine()` to mark the editor.
3. **Popup:** call `Context.showErrorMessage(...)` for VS Code toast.
4. **Overlay:** add to `webviewErrors` and render via `buildDirectiveErrorScript()`.
5. **Hot reload:** ensure overlay is injected on reload as well as initial load.

## 6) Hot reload safety for audio analyzers (Stage7H)
When hot‑reloading from a sound‑only shader into a visual shader that reads `iChannel` audio textures, the analyzer graph can exist but the per‑frame update loop can be missing if the initial preview did not include audio inputs. To avoid “silent textures,” always keep the audio update path live and rebuild analyzer routing after reload.

**Required pieces:**
- **Always present update loop:** Inject `AudioUpdateExtension` regardless of `useAudio` so the texture update loop runs every frame.
  - File: `src/webviewcontentprovider.ts`
  - Change: move `AudioUpdateExtension` outside the `if (useAudio)` branch.
- **Ensure `audios` exists:** In the no‑audio bootstrap, create `window.ShaderToy.audios = []` so the update loop is safe and future hot‑reloads can repopulate it.
  - File: `src/extensions/audio/no_audio_extension.ts`
- **Rebuild analyzer routing after reload:** When `reloadFromGlobals()` resets analyzer state, rebuild splitters for all existing `window.ShaderToy.audios` and reconnect to the current analysis source.
  - File: `resources/webview/audio_output.js`
  - Functions: `rebuildAnalysisFromGlobals()`, called inside `reloadFromGlobals()`.

This keeps audio analyzer textures updating even when the preview starts from a pure sound shader.

---

# Stage7H Progress (Implemented)
Stage7H directive error reporting is now dual‑path (overlay + VS Code popup), and parser error formatting is hardened. Summary:

**Crash fix in parser error formatting**
- Prevented negative `.repeat()` in `ShaderParser.makeError()` by clamping column/range sizes: `src/shaderparser.ts`.

**VS Code popup path for directive errors**
- `BufferProvider.showErrorAtLineAndMessage()` now emits a VS Code toast via `Context.showErrorMessage(...)` in addition to diagnostics: `src/bufferprovider.ts`.

**Overlay remains active**
- Directive errors continue to appear in the webview overlay for both initial load and hot reload: `src/bufferprovider.ts`, `src/webviewcontentprovider.ts`.

**Guideline reference**
- For new error types, follow the “Error‑Handling Guidelines (Stage7H)” section above.

---

# Stage7I Progress (Implemented)
Stage7I hot‑reload stability fixes for sound‑only → visual transitions are in place. Summary:

**Hot‑reload analyzer stability (sound‑only → visual)**
- Always inject the audio update loop, even when the initial preview has no audio inputs: `src/webviewcontentprovider.ts`.
- Ensure `window.ShaderToy.audios` exists in the no‑audio bootstrap: `src/extensions/audio/no_audio_extension.ts`.
- Rebuild analyzer splitters after `reloadFromGlobals()` using existing `ShaderToy.audios`: `resources/webview/audio_output.js`.

**Hot‑reload visual recovery**
- Recompute renderer sizing after hot reload init script to refresh buffer targets when switching from sound‑only to visual: `resources/webview_base.html`.

**Demo update**
- Updated demo to use indexed sound directives (`#iSound0`, `#iChannel0 "sound0"`): `demos/synth_visualizer.glsl`.

---

# Audio Stats Overlay (Removed, local working change)
We removed the in‑webview audio status/stats overlay UI from `resources/webview/audio_output.js`. This keeps the core logic intact (status fields still populate), but no DOM element is created or rendered. This is intended as a clean baseline; re‑introduce it later if a feature needs on‑screen audio diagnostics.

**What was removed/neutralized**
- DOM creation for `#audio-output-status`.
- Rendering of `statusLine`, `statsLine`, `precisionDetails`, `debugDetails` into the webview.

**What remains**
- `setStatus()` / `setStats()` still update internal state, so diagnostics can be surfaced via VS Code popups or logs without UI.

**How to re‑introduce**
- Recreate the `getStatusElement()` and `showStatus()` helpers and restore `renderStatus()` to compose and paint the overlay.
- Wire the overlay to any new diagnostics by writing to `statusLine`, `statsLine`, and `debugDetails`.

**Audio stop on non‑sound shaders**
- Stop playback when reloading a shader set without any sound buffers so audio does not persist across non‑audio previews: `resources/webview/audio_output.js`.

**Sound on/off button works with Worklet**
- Route worklet output through the gain node so `setOutputEnabled()` affects streaming audio: `resources/webview/audio_output.js`.

---

# Extraction: audio‑stats (Committed)
The audio stats overlay UI was removed and consolidated as a clean extraction commit so future add‑ons can re‑introduce it intentionally. The status fields remain, but no DOM is created or rendered. See `resources/webview/audio_output.js` for the minimal “no‑overlay” baseline.

---

# Proposal: iSampleN + iAudioTime (Design Report)
This section captures the proposed architecture for per‑sound sample access while keeping the existing audio pipeline intact. It is intended to be a “full blueprint” for future implementation.

## Goals and non‑goals
**Goals**
- Provide **audio‑clock‑accurate** sample data for each `#iSoundN`.
- Enable **shader‑level DSP** (echo, delay, custom mixing) using per‑sound samples.
- Keep the existing audio path (mixing + worklet) intact.

**Non‑goals (for now)**
- Perfect zero‑latency sampling (block buffering implies latency).
- Arbitrary timeline scrubbing in the sound buffers.

---

## #1 Global audio time (`iAudioTime`)
**Goal:** Provide a single audio‑clock‑driven time for all shaders.

- `iAudioTime` is a uniform available to all shaders (visual + sound).
- The sound entry `mainSound(int sample, float time)` receives:
  - `sample = floor(iAudioTime * iSampleRate)`
  - `time = sample / iSampleRate`
- `iTime` can remain render‑clock driven, or be overridden to follow `iAudioTime` when audio‑locked visuals are desired.

**Benefit:** All shaders have a shared, stable time base derived from the audio clock.

---

## #2 Per‑sound sample buffer (ring‑buffer texture)
**Goal:** Expose recent audio blocks for each `#iSoundN` as a texture that can be sampled.

**Concept**
- For each sound buffer `N`, keep a **GPU ring‑buffer texture** containing the last *K* blocks of samples.
- Each block is **stereo** (`vec2`), packed into RG or split rows.
- A single block is indexed by `blockIndex % iSampleRingDepth`.

**Recommended layout (simple)**
- Width = `iSampleBlockSize` (samples per block)
- Height = `iSampleRingDepth`
- Format = RG (L/R)
- Row = one block
- UV mapping for sample offset `s` in block `b`:
  - `u = s / iSampleBlockSize`
  - `v = (b % iSampleRingDepth + 0.5) / iSampleRingDepth`

**Alternative layout (two rows per block)**
- Height = `2 * iSampleRingDepth` (row 0 = L, row 1 = R)
- Slightly more complex but RGBA8 friendly.

**Size considerations**
- Current audio block size is `512 * 512` (≈ 262k samples). This is **too large** for a live sample buffer.
- Suggested dedicated sample buffer size: 2048–8192 samples.
- Ring depth: 4–16 blocks (defines history window and latency).

**Update flow**
1) Audio rendering already generates blocks per `#iSoundN`.
2) After each block is produced, copy the **same PCM block** into the ring‑buffer texture for that sound.
3) Publish uniforms:
   - `iAudioTime`
   - `iSampleRate`
   - `iSampleBlockSize`
   - `iSampleRingDepth`
   - `iSampleWriteIndex` (monotonic block counter)

**Note:** There is no double rendering. The block is rendered once and copied to the buffer.

---

## #3 Explicit sampling contract (`#iSampleN var_name`)
**Goal:** Provide a simple, stable way to access the current sample for sound `N`.

**Proposed directive**
```
#iSampleN mySample
```
- Binds `vec2 mySample`.
- `mySample` is resolved from the ring buffer at `iAudioTime`.
- Future extension: `#iSampleN mySample @ iSampleTime` (explicit time input; placeholder for now).

**Core formulas**
Let:
- `sampleIndex = floor(iAudioTime * iSampleRate)`
- `blockIndex = floor(sampleIndex / iSampleBlockSize)`
- `blockOffset = sampleIndex % iSampleBlockSize`

Then:
- `ringBlock = blockIndex % iSampleRingDepth`
- sample at `(blockOffset / iSampleBlockSize, ringBlock)`

**Related helper uniforms (optional but useful)**
- `iSampleIndex` = current `blockOffset`
- `iSampleBlockIndex` = current `blockIndex` (read index)
- `iSampleWriteIndex` = most recent written block index (producer position)

**Why `iSampleWriteIndex` matters**
- Read position is usually **behind** write position by a fixed latency of 1–2 blocks.
- Avoids sampling future/uninitialized rows.

---

## History sampling (echo, delay, modulation)
With the ring buffer, you can sample **past** samples by offsetting `sampleIndex`.

Let `delaySamples` be a negative offset (e.g., 0.25s → `int(0.25 * iSampleRate)`).

```
sampleIndex' = sampleIndex - delaySamples
blockIndex'  = floor(sampleIndex' / iSampleBlockSize)
offset'      = sampleIndex' % iSampleBlockSize
ringBlock'   = blockIndex' % iSampleRingDepth
```

**History window**
```
maxHistorySamples = iSampleRingDepth * iSampleBlockSize
```
You cannot sample older than that without increasing depth.

---

## Synchronization and latency
This system is block‑based and therefore **latency‑bound**:
- You can only read blocks that are already rendered and copied.
- A fixed latency (e.g., 1–2 blocks) is expected and should be declared.
- Visual shaders sampling audio should respect this latency to avoid reading future data.

**Practical rule:**
```
iSampleBlockIndex ≈ iSampleWriteIndex - latencyBlocks
```

**Writing head (definition)**
- The **writing head** is the producer position, represented by `iSampleWriteIndex`.
- It advances as each block is rendered and uploaded into the ring buffer.
- Reads should be behind the writing head by at least `latencyBlocks`.

**Policy note (guarding future reads)**
- If the system does **not** guard reads ahead of the writing head, future reads are **undefined** (stale/garbage samples).
- This can cause unstable or “feedback‑like” behavior but does not inherently break the pipeline.
- If we choose to keep it unguarded, document that responsibility is on the shader author.


---

## Requirements and assumptions
- WebGL2 required (same as audio pipeline).
- Audio clock (`AudioContext`) is the time source for `iAudioTime`.
- Sound shaders keep the signature:
  - `vec2 mainSound(int sample, float time)`

---

## Proposed directives: per‑sound format
This adds explicit, per‑sound precision control without changing the global output pipeline.

**Per‑sound format (indexed)**
```
#iSound0 "file://synth/supersaw_iSound.glsl"
#iSound0::Format "32bFLOAT"
```
- Applies to the main GPU render target for that sound’s audio blocks.
- Allows per‑sound precision override even if a global default exists.

**Current shader format (no index)**
```
#iSound::Format "16bPACK"
```
- Applies to the current sound shader without requiring any additional marker.

---

## Output precision layering
- **Global** “Audio Output Precision” remains the default for all sounds.
- **Per‑sound** `#iSoundN::Format` and current‑shader `#iSound::Format` can override the render target.
- Final mix/output is **float32** in WebAudio; packed/half formats only affect the source render precision.

---

## Streaming overview (high‑level)
- Audio is generated in **continuous blocks** (no long one‑shot buffers).
- The **writing head** advances as each block is rendered and copied into the ring buffer.
- The worklet consumes a queue of blocks; the producer fills the queue as needed.
- `#iSampleN` always samples **behind** the writing head by a small, fixed latency.

---

## Current streaming parameters (today, Stage7B implementation)
- **Block shape:** 512 × 512 render target (2D), read back as a linear array of 262,144 samples.
- **Block duration:** $blockSeconds = blockSamples / sampleRate$.
- **Queue target:** worklet keeps ~4 blocks buffered and requests more when below the target.
- **Mixing:** equal‑weight average of all sound buffers (each block is scaled by $1 / N$).
- **Analyzer:** FFT/analyzers are fed from the **final mixed output** stream, not per‑sound.

**Note:** Keep blocks square and 2D for now (simpler GPU path + predictable throughput). The square choice is deliberate, not a hard requirement of the math.

---

## Latency targets (numeric guidance)
Latency is dominated by **block size** and **queue depth**:

```
blockSeconds = blockSamples / sampleRate
queueLatencySeconds ≈ blockSeconds × targetBlocks
```

**Typical real‑world targets**
- **Ultra‑low / instrument feel:** 5–20 ms
- **Interactive / creative tools:** 20–50 ms
- **Non‑interactive playback:** 50–200+ ms (often acceptable)

**Practical numbers (48 kHz)**
- 256 samples → ~5.3 ms per block
- 512 samples → ~10.7 ms per block
- 1024 samples → ~21.3 ms per block
- 2048 samples → ~42.7 ms per block

**Implication for our pipeline**
- With a target queue of 2–4 blocks, 1024‑sample blocks yield ~40–85 ms total latency.
- For near‑real‑time feel, keep blocks **≤ 1024** and queue **≤ 2** where feasible.
- If GPU load is heavy, increase queue depth to avoid dropouts (trade‑off: latency).


---

## Use cases (examples)
- Echo/delay (sample past blocks)
- Custom per‑sound mixing (read multiple samples)
- Sidechain (compare current/previous block energy)
- Visuals synced to raw audio samples (per‑sound)

---

## Implementation steps (staged plan)
This breaks the work into discrete, reviewable stages. Split as needed.

### Stage A — Timebase + uniforms
**Goal:** Introduce `iAudioTime` and sample metadata without sample buffers.

- Add `iAudioTime` uniform to all buffers.
- Pass audio time into `mainSound(int sample, float time)`.
- Add `iSampleRate` (already exists), `iSampleBlockSize`, `iSampleRingDepth` uniforms.

### Stage B — Per‑sound ring buffer
**Goal:** Build the per‑sound ring‑buffer texture and write blocks into it.

- Allocate textures per `#iSoundN` (size: `iSampleBlockSize × iSampleRingDepth`).
- After each block render, upload PCM data to the correct row.
- Track `iSampleWriteIndex` (monotonic).

### Stage C — Sampling contract (`#iSampleN`)
**Goal:** Bind `vec2` sample uniforms resolved from ring buffers.

- Parse `#iSampleN var_name` as a new directive.
- For each bound `iSampleN`, compute current sample from ring buffer and set `var_name`.
- Add optional uniforms: `iSampleIndex`, `iSampleBlockIndex`.

### Stage D — History sampling helpers (optional)
**Goal:** Expose ring buffer sampling helpers.

- Provide shader helper (macro or include) for computing offsets.
- Document example DSP patterns (echo, comb, chorus).

### Stage E — Per‑sound format
**Goal:** Add format override rules without any self‑sampling special cases.

- Parse and apply `#iSoundN::Format` as a per‑sound override to the render target precision.
- Allow `#iSound::Format` (no index) to apply to the current shader.
- Decide policy for future reads: clamp to zeros or leave undefined (documented).

**Global “Audio Output Precision” status**
- The global setting is **not obsolete**. It remains the **default** precision for sounds that do not specify `#iSoundN::Format`.
- `#iSoundN::Format` is an **override**, not a replacement for the global option.
- The final WebAudio output remains float32; precision settings only affect the **source render targets**.

**Note on under/super‑sampling**
- We are **dropping** per‑sound sample‑rate overrides.
- Under/super‑sampling can be emulated in shader code via `sampleSound(...)` math:
  - **Undersampling:** read every $k$‑th sample by scaling the index.
  - **Supersampling:** interpolate between neighbor samples (e.g., linear interpolation).

---

---

# Current Audio Rendering (Verbose Flow)
This is how audio is rendered today per sound shader.

## Parsing and buffer creation
- `#iSoundN` directives are parsed by the shader parser and buffer provider.
- Each sound shader becomes a buffer with `IsSound = true`.

## Webview setup
- `audio_output.js` initializes WebAudio, the worklet, and streaming state.
- Each sound buffer is compiled into a GPU shader used for audio block rendering.

## Streaming pipeline (per sound)
1) The AudioWorklet requests more blocks via `need` messages.
2) For each needed block:
  - The GPU renders a block of samples for each active sound buffer.
  - Each sound buffer produces stereo sample arrays.
  - The mixer sums the buffers (equal‑weight) into a final stereo block.
3) The mixed block is posted to the AudioWorklet for playback.

## WebAudio plumbing
- `AudioContext` owns the clock and scheduling.
- `AudioWorkletNode` consumes queued blocks and outputs audio.
- A gain node controls output volume and enables sound on/off.
- Analyzer nodes attach to the output for visual FFT/time‑domain textures.

## Visual analyzer textures (iChannel "soundN")
- Each `#iChannelX "soundN"` creates its own analyser + texture.
- Analyzer data comes from the final output stream, not per‑sound raw data.

---

# Stage8A Log
- Added `iAudioTime`, `iSampleBlockSize`, and `iSampleRingDepth` uniforms to the shader preamble and visual buffer init.
- Updated sound rendering to call `mainSound(int sample, float time)` and added a compatibility wrapper for `mainSound(float time)`.
- Wired `iAudioTime` updates in the render loop and set a block‑start value for sound rendering.
- Build compiled via `npm run webpack` (warnings unchanged from prior glslify warnings).

> Side note: Stage8A marks the shift from pure planning to practical shader‑interface evolution; later entries show refinements and removals based on usability.

# Stage8B Log
- Added per‑sound ring‑buffer textures (square 2D blocks stacked vertically by ring depth).
- Wrote each rendered block into the ring buffer and exposed block size + ring depth to visuals.
- Build compiled via `npm run webpack` (warnings unchanged from prior glslify warnings).

# Stage8C Log
- Added `#iSampleN` parsing with per‑buffer bindings and injected `uniform vec2 <name>` declarations.
- Exposed sample bindings in buffer metadata and resolved them per frame from the audio ring buffer.
- Build compiled via `npm run webpack` (warnings unchanged from prior glslify warnings).

# Stage8D Log
- Added GLSL helper functions for sample index math and linear interpolation in the shader preamble.
- Build compiled via `npm run webpack` (warnings unchanged from prior glslify warnings).

# Stage8D Update
- Removed helper functions from the preamble (kept minimal core uniforms only).
- Added demo showcase: demos/sync/sampling_iSound.glsl (helper math examples).

---

# Stage8E Log
- Added `#iSound::Format` parsing with per-sound precision overrides.
- Propagated sound precision metadata into buffers and applied per-sound precision selection in audio rendering.
- Build compiled via `npm run webpack` (warnings unchanged from prior glslify warnings).

# Stage8F Log
- Exposed `SoundIndices`/`SoundPrecision` to the webview buffer list for runtime access.
- Applied `#iSound::Format` to standalone sound shaders (when `mainSound` is present).

# Stage8G Log
- Moved sampling helpers into `demos/synth/sampler_helpers.glsl` and kept the shader preamble minimal.
- Updated sampling and echo demos to include the helper and match the final mainSound signature.
- Moved `sampling_iSound.glsl` into `demos/synth` and removed the `demos/sync` folder.
- Renamed helper prefix to `sh` in the sampler helpers and demos.
 - TODO: Clarify in docs that `#iChannelX "soundN"` analyzer textures are all sourced from the final mixed output (not per-sound).

# Stage8H Log
- Removed all sound-shader “self” pathways (no `#iSound "self"`, no indexless `#iSample`, no self helper overloads).
- Enforced explicit `#iSoundN` / `#iSampleN` usage; `#iSound::Format` without index now applies directly to the current shader without any special marker.
- Dropped self-sampling demos and restored the original chords demo content.
- Rationale: self-sampling was exploratory and unnecessary for this project’s scope; it added special cases and ambiguity without clear user value.

> Reader note: This entry is the final position on “self” for sound shaders in this codebase; earlier design notes mentioning self‑sampling are intentionally superseded here.
