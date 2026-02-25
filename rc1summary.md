# RC1 Summary (rc1#sound_synth)

> Scope: This report summarizes the **rc1#sound_synth** branch progression from Stage1–Stage4, patch1–patch7, and final1–final5, including regressions, fixes, and design clarifications. It is intended as a standalone handoff for planning RC2.

---

## 0) Baseline and intent

**Initial baseline:** Master branch after earlier PRs (WebGL2/iVertex support, diagnostics improvements, etc.).

**Branch goal:** Build a clean, AudioWorklet‑only sound pipeline with hot reload, streaming, ring‑buffer sampling, and message‑port streaming. Keep progress readable through staged commits (Stage1–Stage4), then apply patch fixes, then complete a final refined pipeline via final1–final5.

**Invariant constraints enforced throughout RC1:**
- Audio output must be **AudioWorklet‑only** (no fallback render path if worklet fails).
- Sound shaders must use explicit `#iSoundN` indices.
- Sound/analysis uniforms must be unified (no parallel uniform universe).

---

## 1) Stage commits (Stage1–Stage4)

### stage1: parse sound/sample directives (commit:  f24bc26 → stage1 later in log)
**Purpose:** Establish directive parsing foundations for sound shaders and sample bindings.

**Key changes:**
- Implemented parsing for `#iSoundN` and `#iSampleN` directives.
- Added metadata for sound buffers (names, indices, references) in buffer provider / parser.

**Impact:**
- Enabled sound shader references to be tracked in shader trees.
- Laid groundwork for later mixing and streaming.

**Notes:**
- This was the core scaffolding necessary for reliable downstream audio logic.

---

### stage2: hot reload pipeline (commit: 5d50d0d)
**Purpose:** Keep the webview alive and reload shaders with dependency‑aware updates.

**Key changes:**
- Introduced hot reload pipeline with state preservation (time/mouse/camera).
- Ensured reload doesn’t tear down the preview.

**Impact:**
- Reliable edit‑compile‑refresh loop.
- Became the “reload spine” for all later audio work.

**Notes:**
- Set the foundation for streaming to survive reloads.

---

### stage3: audio worklet streaming (commit: 711577e)
**Purpose:** Replace offline render with real‑time streaming via AudioWorklet.

**Key changes:**
- Introduced `audio_worklet_processor.js`.
- Implemented main‑thread GPU block rendering and worklet push/pull queue.
- Established worklet request model (“need → render → push”).

**Impact:**
- Streaming audio became real‑time and responsive.
- Audio clock moved to worklet.

**Notes:**
- Set the stage for multi‑source mixing and ring buffers.

---

### stage4: sample ring bindings (commit: ab7a1c6)
**Purpose:** Add ring‑buffer textures for sample history (`iSampleRingN`).

**Key changes:**
- Allocated per‑sound ring buffers.
- Exposed `iSampleRingBlockSize`, `iSampleRingDepth`, `iSampleRingN` uniforms.

**Impact:**
- Sound shaders can read history for DSP (echo/delay) and analysis.

**Notes:**
- This unlocked sample‑level effects without external DSP.

---

## 2) Patch series (patch1–patch7)

### patch1: restore audio UI + gesture flow; AudioWorklet‑only (commit: 29093a5)
**Problem:** Earlier changes left audio UI and gesture flow inconsistent with AudioWorklet.

**Fix:**
- Re‑introduced the audio UI toggles and gesture gating.
- Ensured AudioWorklet is the only output path.

**Impact:**
- Audio respects autoplay policy and user gestures.
- Worklet‑only path enforced.

---

### patch2: gesture gating + explicit play (commit: fbef57b)
**Problem:** Gesture handling and “play” logic were not properly gated.

**Fix:**
- Explicit gating added for start/resume.
- Avoided premature worklet start before gesture.

**Impact:**
- Stable audio start UX.

---

### patch3: fix iSample demo usage (commit: df7937c)
**Problem:** Demo shaders still referenced deprecated `iSample` semantics.

**Fix:**
- Updated demos to match `iSampleRing` contract.

**Impact:**
- Demos compile and run under the new sample ring pipeline.

---

### patch4: drop iSample bindings, use iSampleRing (commit: c934caf)
**Problem:** Legacy `iSample` bindings conflicted with new pipeline.

**Fix:**
- Removed `iSample` token handling.
- Enforced `iSampleRingN` usage only.

**Impact:**
- Simplified semantics; avoided parallel uniform universe.

---

### patch5: global audio precision + 8bPACK (commit: 484edb4)
**Problem:** Precision control was fragmented and per‑buffer.

**Fix:**
- Added global precision setting `shader‑toy.audioOutputPrecision`.
- Added `8bPACK` output support.

**Impact:**
- Unified precision configuration; improved portability.

---

### patch6: ring block history streaming (commit: 4449cc1)
**Problem:** Ring buffer write logic and block timing needed refinement.

**Fix:**
- Introduced ring block size and deeper ring history.
- Streamed blocks in smaller ring block sizes while keeping larger render blocks.
- Updated uniforms (`iSampleRingBlockSize`).

**Impact:**
- Lower latency in history access; reliable history sampling.

---

### patch7: self echo demo + output priming (commit: e45cf8e)
**Problem:** No demonstration of self‑sampling or priming of output.

**Fix:**
- Added self‑echo demo (chords_iSound.glsl) and priming to avoid initial glitch.
- Added documentation: messageport_audio_pipeline.md.

**Impact:**
- Useful demo and stability improvements.

**Regression note:** Later RC constraints removed “self” semantics; demo remained as a temporary proof of concept.

---

## 3) Final series (final1–final5)

### final1: configurable audio block size (commit: 02dc90f)
**Purpose:** Make GPU block size configurable via settings.

**Key changes:**
- Added `shader‑toy.audioBlockSize` config and extension.
- Injected block size into webview init/reload options.
- Applied validation and dimension mapping in audio_output.js.

**Impact:**
- Allows tuning of latency vs stability.

---

### final2: worklet base‑sample requests (commit: b3b51e8)
**Purpose:** Worklet should request by absolute sample index.

**Key changes:**
- Worklet now tracks `playheadSample` and `queueFrames`.
- Need messages include `wantBaseSample`/`framesWanted`.
- Main thread renders blocks at the requested sample base.

**Impact:**
- Sample‑accurate scheduling and reduced drift.

---

### final3: buffer pool + recycle (commit: 2569d5a)
**Purpose:** Reduce per‑block allocations and enable pool reuse.

**Key changes:**
- Introduced pooled planar buffers (`L/R` in one ArrayBuffer).
- Worklet recycles buffers to main thread.
- Main thread tracks pool sizes and uses transferables.

**Impact:**
- Reduced allocations; smoother streaming.

**Regression note:** Pool starvation warnings became frequent under heavy load; debug overlay later added to inspect.

---

### final4: worklet stats (commit: 62ebd1f)
**Purpose:** Surface worklet queue and underrun stats.

**Key changes:**
- Worklet posts periodic stats (`queueFrames`, `underruns`).
- Main thread stores stats and includes them in streaming status output.

**Impact:**
- Visibility into worklet health and latency.

---

### final5: PBO readback + debug overlay (commit: c41a37b)
**Purpose:** Reduce GPU readback stalls and add live debug overlay.

**Key changes:**
- Optional WebGL2 PBO+fence readback (fallback to readPixels).
- Overlay added in preview to show live audio stats.
- Warning popups replaced by overlay details.

**Impact:**
- Reduced stalls in readback (especially on heavier shaders).
- Continuous runtime visibility into audio health.

---

## 4) Regression investigations and fixes (RC1 narrative)

### A) GLSL parsed as JS → `Unexpected token 'const'`
**Symptom:** Webview reported `SyntaxError: Unexpected token 'const'` even for simple shaders.

**Root cause:** Shader contents were still inserted as `<script>` tags or placeholders were breaking JS.

**Fixes applied:**
- **Changed shader/include containers** from `<script>` to `<textarea>` (safe, non‑executable).
- Updated hot reload to replace `[data‑shadertoy='shader']` nodes.
- Added safe placeholder defaults for `audioBlockSize` and `showSoundButton` to prevent unexpanded placeholders from breaking JS.

**Outcome:**
- Both fragment and sound shaders compile again.
- Issue confirmed resolved.

---

### B) Audio start error → `Cannot access 'blockSamples' before initialization`
**Symptom:** Audio start failed after gesture for empty sound shader.

**Root cause:** `blockSamples` referenced before initialization in `requestBlocks`.

**Fix:**
- Reordered initialization to compute `blockSamples` first, then use it.

**Outcome:**
- Audio playback works again.

---

### C) Excessive pool starvation warnings
**Symptom:** Repeated “Audio buffer pool exhausted” messages.

**Fix:**
- Popups removed; overlay shows detailed live stats.
- Warning now indicates pool sizes, block size, and render count.

**Outcome:**
- Noise reduced; debugging improved.

---

## 5) Current RC1 state (post‑final5)

### Audio pipeline
- AudioWorklet only; no fallback output.
- Worklet pulls via `need` with absolute base samples.
- Main thread renders GPU blocks at requested sample index.
- Ring buffers provide history for `iSampleRingN`.
- PBO readback path improves performance on WebGL2.

### UI / Debug
- Live overlay shows queue, underruns, pool, block size, and precision.
- Popups removed for pool starvation.

### Shader embedding
- Shader sources embedded as `<textarea>` to prevent JS parse errors.

---

## 6) Suggested mapping to RC2 staged plan (6 stages)

> The following is a **guidance mapping** of RC1 commits to a cleaner RC2 six‑stage plan. This is intentionally high‑level and for planning only.

**Stage A — Core parsing + hot reload spine**
- stage1, stage2

**Stage B — Worklet engine + streaming base**
- stage3

**Stage C — Sample history + precision**
- stage4, patch4, patch5, patch6

**Stage D — UX and gesture discipline**
- patch1, patch2

**Stage E — Streaming refinements**
- final1, final2, final3, final4

**Stage F — Performance + diagnostics**
- final5, overlay + PBO readback

---

## 7) Known deviations from RC plan
- Self‑sound semantics were temporarily used for demo/echo testing, but later declared out of scope.
- Debug overlay was initially removed in earlier notes, then reintroduced for live diagnostics in final5.
- Shader embedding strategy changed to fix JS parse errors (`<textarea>` instead of `<script>`).

---

## 8) Files touched most frequently (reference)
- resources/webview/audio_output.js
- resources/webview/audio_worklet_processor.js
- resources/webview_base.html
- src/webviewcontentprovider.ts
- src/extensions/buffers/shaders_extension.ts
- src/extensions/buffers/includes_extension.ts
- src/extensions/audio/*
- demos/synth/* (temporary updates during patch cycle)

---

## 9) Final RC1 takeaway
RC1 achieved a stable, streaming, AudioWorklet‑only pipeline with sound directives, ring‑buffer sampling, and a robust hot‑reload spine. The late regression around shader embedding was fixed by switching to safe non‑executable containers. The optional performance step (PBO+fence) is now in place and diagnostics are visible via overlay. This provides a strong base for a clean RC2 plan with fewer detours and a clearer commit progression.
